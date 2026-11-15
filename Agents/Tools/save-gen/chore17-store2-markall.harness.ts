// @vitest-environment node
/**
 * CHORE-17 measurement (diagnostic experiment, not a regression test): what a store2 save pass costs when a plugin's
 * `setDatabase` marks every resident character, against no marks, one mark, and a per-resident `verdictOf` loop.
 * Everything runs through the real `createSaveEncoder` plan, `commitRequest().build` and `acknowledge` over an
 * acknowledged encoding made by the real `encodeDatabase` (the write-amplification rig's `rigBase`). No backend, no
 * commit. The live characters are plain objects (no `$state` proxies: this file is not a `.svelte` module), so the read
 * cost of a reactive proxy is not included.
 *
 * Run (from the repo root; the file is named, never the whole folder):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts chore17-store2-markall
 *
 * Output: one JSON line per arm on stdout and the same rows in the file named by RISU_C17_OUT (default: the OS temp
 * directory). Data is seeded and synthetic. Optional: RISU_C17_REPEATS (default 7), RISU_C17_COUNT (default 500).
 * Numbers are one machine's best case; they say nothing about a phone or a Pi.
 */
import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createSaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import type { Database, character } from 'src/ts/storage/database.svelte'
import type { PreviousEncoding } from 'src/ts/storage/store2/codec'
import {
    appendRigText, buildCharactersProfile, measureRigPass, rigBase, rigRequest, RIG_NOW,
} from 'src/ts/storage/tests/store2/writeAmplificationRig'
import {
    asDatabase, buildSmall, chat, fakeLists, loreEntry, message, mulberry32, prosePool, seededEnv, sparseCharacter, uuidLike,
    type Obj,
} from 'src/ts/storage/tests/store2/codecFixtures'

const OUT = process.env.RISU_C17_OUT ?? path.join(os.tmpdir(), 'chore17-store2-markall.json')
const REPEATS = Number(process.env.RISU_C17_REPEATS ?? 7)
const COUNT = Number(process.env.RISU_C17_COUNT ?? 500)
const WARMUPS = 2

/** The heavier profile: `count` characters, two chats of 200 messages of about 400 characters, 20 alternatives each. */
function buildHeavyProfile(count: number, seed = 1717): { db: Database, characters: Obj[] } {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    const characters: Obj[] = []
    for (let c = 0; c < count; c++) {
        const chats = [0, 1].map(chatIndex => {
            const messages = Array.from({ length: 200 }, (_, m) => message(rng, pool, m, 400))
            const one = chat(rng, chatIndex, messages)
            one.alt = Array.from({ length: 20 }, (_, a) => ({ m: message(rng, pool, a, 400), p: null, a: a + 1 }))
            return one
        })
        characters.push(sparseCharacter(rng, pool, uuidLike(rng), `Heavy Character ${c}`, chats, [loreEntry(rng, pool, 0, 300)]))
    }
    const base = buildSmall(1) as unknown as Obj
    return { db: asDatabase({ ...base, characters, characterOrder: characters.map(slot => slot.chaId) }), characters }
}

function round(value: number): number {
    return Math.round(value * 100) / 100
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function stat(values: number[]): { median: number, min: number, max: number } {
    return { median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) }
}

function heapNow(): number {
    const gc = (globalThis as { gc?: () => void }).gc
    gc?.()
    return process.memoryUsage().heapUsed
}

interface PassSample {
    planMs: number
    buildMs: number
    acknowledgeMs: number
    totalMs: number
    writtenUnits: number
    encodedCount: number
    heapDeltaMb: number
    /** Longest time between two yields inside `plan` (the last slice runs to the end of the plan). */
    longestPlanSliceMs: number
    yieldCount: number
}

/** One plan, build and acknowledge pass, timed by phase. The encoder is made before the clock starts. */
async function timedPass(db: Database, base: PreviousEncoding, request: SavePassRequest, withYield: boolean, apply?: () => () => void): Promise<PassSample> {
    const revert = apply?.()
    try {
        const slices: number[] = []
        let sliceStart = 0
        const passRequest: SavePassRequest = withYield
            ? {
                ...request,
                yield: async () => {
                    slices.push(performance.now() - sliceStart)
                    await new Promise<void>(resolve => setTimeout(resolve, 0))
                    sliceStart = performance.now()
                },
            }
            : request
        const encoder = createSaveEncoder({ previous: base, lists: fakeLists, env: seededEnv(77), now: () => RIG_NOW })
        const { mint } = createKeyMint(seededEnv(900), null)
        const heapBefore = heapNow()
        const t0 = performance.now()
        sliceStart = t0
        const plan = await encoder.plan(db, passRequest)
        const t1 = performance.now()
        slices.push(t1 - sliceStart)
        const built = await plan.commitRequest().build({ mint, seq: 2, now: RIG_NOW })
        const t2 = performance.now()
        plan.acknowledge()
        const t3 = performance.now()
        const heapAfter = process.memoryUsage().heapUsed
        return {
            planMs: t1 - t0,
            buildMs: t2 - t1,
            acknowledgeMs: t3 - t2,
            totalMs: t3 - t0,
            // The built list excludes the manifest, which every pass writes.
            writtenUnits: built.units.length + 1,
            encodedCount: plan.encoded.length,
            heapDeltaMb: (heapAfter - heapBefore) / 1048576,
            longestPlanSliceMs: Math.max(...slices),
            yieldCount: withYield ? slices.length - 1 : 0,
        }
    } finally {
        revert?.()
    }
}

async function measureArm(profile: string, arm: string, db: Database, base: PreviousEncoding, request: SavePassRequest, apply?: () => () => void): Promise<Record<string, unknown>> {
    for (let i = 0; i < WARMUPS; i++) {
        await timedPass(db, base, request, false, apply)
    }
    const plain: PassSample[] = []
    for (let i = 0; i < REPEATS; i++) {
        plain.push(await timedPass(db, base, request, false, apply))
    }
    const yielded: PassSample[] = []
    for (let i = 0; i < REPEATS; i++) {
        yielded.push(await timedPass(db, base, request, true, apply))
    }
    return {
        profile,
        arm,
        residents: (db.characters as unknown[]).length,
        repeats: REPEATS,
        totalMs: stat(plain.map(s => s.totalMs)),
        planMs: stat(plain.map(s => s.planMs)),
        buildMs: stat(plain.map(s => s.buildMs)),
        acknowledgeMs: stat(plain.map(s => s.acknowledgeMs)),
        writtenUnitsIncludingManifest: [...new Set(plain.map(s => s.writtenUnits))],
        encodedCount: [...new Set(plain.map(s => s.encodedCount))],
        heapDeltaMb: stat(plain.map(s => s.heapDeltaMb)),
        yielded: {
            longestPlanSliceMs: stat(yielded.map(s => s.longestPlanSliceMs)),
            yieldCount: yielded[0].yieldCount,
            totalMsIncludingTimerWaits: stat(yielded.map(s => s.totalMs)),
        },
    }
}

interface Sink {
    total: number[]
    longest: number[]
    heap: number[]
}

/** `verdictOf` over every resident on a fresh encoder: cold (no shadows), then warm (the shadows the cold loop admitted). */
function measureVerdictArms(profile: string, characters: Obj[], base: PreviousEncoding): Array<Record<string, unknown>> {
    const cold: Sink = { total: [], longest: [], heap: [] }
    const warm: Sink = { total: [], longest: [], heap: [] }
    let coldCounts: Record<string, number> = {}
    let warmCounts: Record<string, number> = {}
    let shadows = { entries: 0, charged: 0 }
    const loop = (encoder: ReturnType<typeof createSaveEncoder>, into: Sink): Record<string, number> => {
        const counts: Record<string, number> = {}
        let longest = 0
        const heapBefore = heapNow()
        const t0 = performance.now()
        for (const slot of characters) {
            const c0 = performance.now()
            const verdict = encoder.verdictOf(slot as unknown as character)
            longest = Math.max(longest, performance.now() - c0)
            counts[verdict] = (counts[verdict] ?? 0) + 1
        }
        const total = performance.now() - t0
        into.total.push(total)
        into.longest.push(longest)
        into.heap.push((process.memoryUsage().heapUsed - heapBefore) / 1048576)
        return counts
    }
    for (let i = 0; i < WARMUPS + REPEATS; i++) {
        const encoder = createSaveEncoder({ previous: base, lists: fakeLists, env: seededEnv(77), now: () => RIG_NOW })
        const keep = i >= WARMUPS
        coldCounts = loop(encoder, keep ? cold : { total: [], longest: [], heap: [] })
        warmCounts = loop(encoder, keep ? warm : { total: [], longest: [], heap: [] })
        const stats = encoder.shadowStats()
        shadows = { entries: stats.entries, charged: stats.charged }
    }
    const row = (arm: string, sink: Sink, counts: Record<string, number>): Record<string, unknown> => ({
        profile,
        arm,
        residents: characters.length,
        repeats: REPEATS,
        totalMs: stat(sink.total),
        longestSingleCallMs: stat(sink.longest),
        heapDeltaMb: stat(sink.heap),
        verdictCounts: counts,
        shadowEntriesAfter: shadows.entries,
        shadowChargedMbAfter: round(shadows.charged / 1048576),
    })
    return [row('d-verdict-loop-cold', cold, coldCounts), row('d-verdict-loop-warm-shadows', warm, warmCounts)]
}

/** JSON semantics: undefined-valued keys and functions are absent, arrays by index, objects by key set. */
function jsonEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true
    }
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        return false
    }
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false
        }
        for (let i = 0; i < a.length; i++) {
            if (!jsonEqual(a[i], b[i])) {
                return false
            }
        }
        return true
    }
    const left = a as Obj
    const right = b as Obj
    const keysOf = (value: Obj) => Object.keys(value).filter(key => value[key] !== undefined && typeof value[key] !== 'function')
    const leftKeys = keysOf(left)
    if (leftKeys.length !== keysOf(right).length) {
        return false
    }
    for (const key of leftKeys) {
        if (!jsonEqual(left[key], right[key])) {
            return false
        }
    }
    return true
}

function measureCompare(profile: string, characters: Obj[]): Record<string, unknown> {
    const cloneMs: number[] = []
    const compareMs: number[] = []
    const longest: number[] = []
    let equalCount = 0
    for (let i = 0; i < WARMUPS + REPEATS; i++) {
        const c0 = performance.now()
        const incoming = structuredClone(characters)
        const c1 = performance.now()
        let slowest = 0
        equalCount = 0
        for (let k = 0; k < characters.length; k++) {
            const k0 = performance.now()
            if (jsonEqual(incoming[k], characters[k])) {
                equalCount++
            }
            slowest = Math.max(slowest, performance.now() - k0)
        }
        const c2 = performance.now()
        if (i >= WARMUPS) {
            cloneMs.push(c1 - c0)
            compareMs.push(c2 - c1)
            longest.push(slowest)
        }
    }
    return {
        profile,
        arm: 'layer1-compare-plain-vs-plain',
        note: 'structuredClone copies vs the live plain objects (no $state proxies in this file); compare excludes the clone',
        residents: characters.length,
        repeats: REPEATS,
        cloneMs: stat(cloneMs),
        compareMs: stat(compareMs),
        longestSingleCharacterCompareMs: stat(longest),
        equalCount,
    }
}

describe('CHORE-17 store2 mark-all cost', () => {
    test('measures every arm for both profiles', async () => {
        const rows: unknown[] = []
        const profiles: Array<{ name: string, db: Database, characters: Obj[] }> = [
            { name: 'small-3msg-1chat', ...buildCharactersProfile(COUNT) },
            { name: 'heavy-2chats-200msg-400ch-20alt', ...buildHeavyProfile(COUNT) },
        ]
        for (const profile of profiles) {
            const { name, db, characters } = profile
            const base = rigBase(db)
            const allIds = characters.map(slot => String(slot.chaId))
            const census = {
                profile: name,
                residents: characters.length,
                acknowledgedUnits: base.units.size,
                jsonBytes: JSON.stringify(characters).length,
            }
            rows.push({ census })
            console.log(JSON.stringify({ census }))

            // Cross-check of units written, through the repository rig itself.
            const rigNone = await measureRigPass(db, base, rigRequest([]))
            const rigAll = await measureRigPass(db, base, rigRequest(allIds))
            const rigEdit = await measureRigPass(db, base, rigRequest(allIds), () => appendRigText(characters[7], 'desc'))
            const cross = {
                rigCrossCheck: {
                    profile: name,
                    noneWritten: rigNone.written.length,
                    allWritten: rigAll.written.length,
                    totalUnits: rigAll.totalUnits,
                    editWritten: rigEdit.written.map(unit => unit.identity),
                },
            }
            rows.push(cross)
            console.log(JSON.stringify(cross))

            const arms: Array<[string, SavePassRequest, (() => () => void) | undefined]> = [
                ['a-no-marks', rigRequest([]), undefined],
                ['b-mark-all', rigRequest(allIds), undefined],
                ['c-mark-one', rigRequest([allIds[7]]), undefined],
                ['e-mark-all-one-changed', rigRequest(allIds), () => appendRigText(characters[7], 'desc')],
            ]
            for (const [arm, request, apply] of arms) {
                const row = await measureArm(name, arm, db, base, request, apply)
                rows.push(row)
                console.log(JSON.stringify(row))
            }
            for (const row of measureVerdictArms(name, characters, base)) {
                rows.push(row)
                console.log(JSON.stringify(row))
            }
            const compare = measureCompare(name, characters)
            rows.push(compare)
            console.log(JSON.stringify(compare))
        }
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 1))
        expect(rows.length).toBeGreaterThan(0)
    }, 3_000_000)
})
