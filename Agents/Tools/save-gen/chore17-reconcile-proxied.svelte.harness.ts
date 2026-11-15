// @vitest-environment node
/**
 * CHORE-17 measurement N1 (diagnostic experiment, not a regression test): the shipped compare of a plugin's whole-list
 * write of `characters` (`reconcileCharacters` over `sameStoredValue`) against the like-for-like mark-all store2 pass,
 * with the live trees in `$state` (this file is a `.svelte` module, so the live characters are real Svelte proxies).
 *
 * Compare arm: the live list is fully read once by the real `copyCharactersWithoutAlt`; the incoming list is a
 * `structuredClone` of that copy followed by the real `keepLiveAlt`; the timed step is `reconcileCharacters(live,
 * incoming)`. The copy is timed on the same tree (warm: proxies already made) and its first, cold run is kept apart.
 *
 * Baseline arm: a persistent `createSaveEncoder` (so its `ChunkMemo` stays warm), one untimed warm-up pass, then per
 * repeat the fresh copy (built as above) is installed into the `$state` holder and a mark-all plan is timed, then built
 * and acknowledged untimed-by-plan (timed separately) so the encoder stays persistent. Plain repeats give the totals;
 * separate yielded repeats give the longest slice of the plan (a yield per resident boundary as the request supplies).
 *
 * Run (repo root, file named, never the folder):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts chore17-reconcile-proxied
 *
 * Env: RISU_C17_REPEATS (default 7), RISU_C17_COUNT (default 500), RISU_C17_OUT (default OS temp dir). Seeded, synthetic.
 * Numbers are one machine's best case (i9); they say nothing about a phone or a Pi.
 */
import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createSaveEncoder, type SavePassRequest } from 'src/ts/storage/store2/saveEncoder'
import type { Database } from 'src/ts/storage/database.svelte'
import type { PreviousEncoding } from 'src/ts/storage/store2/codec'
import { reconcileCharacters, sameStoredValue } from 'src/ts/plugins/characterReconcile'
import { copyCharactersWithoutAlt } from 'src/ts/plugins/apiV3/pluginCopy.svelte'
import { keepLiveAlt } from 'src/ts/plugins/chatAltBridge'
import { rigBase, rigRequest, RIG_NOW } from 'src/ts/storage/tests/store2/writeAmplificationRig'
import {
    asDatabase, buildSmall, chat, fakeLists, loreEntry, message, mulberry32, prosePool, seededEnv, sparseCharacter, uuidLike,
    type Obj,
} from 'src/ts/storage/tests/store2/codecFixtures'

const OUT = process.env.RISU_C17_OUT ?? path.join(os.tmpdir(), 'chore17-reconcile-proxied.json')
const REPEATS = Number(process.env.RISU_C17_REPEATS ?? 7)
const COUNT = Number(process.env.RISU_C17_COUNT ?? 500)
const WARMUPS = 2

interface Profile {
    name: string
    description: string
    build: () => Database
}

/** Heavy: `count` characters, two chats of 200 messages of about 400 characters, 20 alternatives each (seed 1717). */
function buildHeavy(count: number, seed = 1717): Database {
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
    return withCharacters(characters)
}

/**
 * Device-shaped: `count` characters with 3,3,3,4,4 chats by slot (mean 3.4), each chat 40 messages of about 300
 * characters and 5 alternatives (seed 3434). The message and alternative sizes are this harness's assumption.
 */
function buildDeviceShaped(count: number, seed = 3434): Database {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    const chatsBySlot = [3, 3, 3, 4, 4]
    const characters: Obj[] = []
    for (let c = 0; c < count; c++) {
        const chats = Array.from({ length: chatsBySlot[c % chatsBySlot.length] }, (_, chatIndex) => {
            const messages = Array.from({ length: 40 }, (_, m) => message(rng, pool, m, 300))
            const one = chat(rng, chatIndex, messages)
            one.alt = Array.from({ length: 5 }, (_, a) => ({ m: message(rng, pool, a, 300), p: null, a: a + 1 }))
            return one
        })
        characters.push(sparseCharacter(rng, pool, uuidLike(rng), `Device Character ${c}`, chats, [loreEntry(rng, pool, 0, 300)]))
    }
    return withCharacters(characters)
}

function withCharacters(characters: Obj[]): Database {
    const base = buildSmall(1) as unknown as Obj
    return asDatabase({ ...base, characters, characterOrder: characters.map(slot => slot.chaId) })
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

/** The incoming list as the V3 bridge makes it: a structured clone of the plugin's copy, then `keepLiveAlt`. */
function makeIncoming(live: Database): { incoming: Obj[], copyMs: number, cloneMs: number, keepAltMs: number } {
    const c0 = performance.now()
    const copy = copyCharactersWithoutAlt(live.characters) as Obj[]
    const c1 = performance.now()
    const incoming = structuredClone(copy)
    const c2 = performance.now()
    keepLiveAlt(live.characters as unknown as readonly unknown[], incoming)
    const c3 = performance.now()
    return { incoming, copyMs: c1 - c0, cloneMs: c2 - c1, keepAltMs: c3 - c2 }
}

function measureCompareArm(profile: Profile): Record<string, unknown> {
    const raw = profile.build()
    const holder = $state<{ db: Database }>({ db: raw })
    const live = holder.db
    const first = makeIncoming(live)
    const copyMs: number[] = []
    const cloneMs: number[] = []
    const keepAltMs: number[] = []
    const compareMs: number[] = []
    const longestOne: number[] = []
    let kept = 0
    let nullResult = false
    for (let i = 0; i < WARMUPS + REPEATS; i++) {
        const made = makeIncoming(live)
        const t0 = performance.now()
        const result = reconcileCharacters(live.characters as unknown as Obj[], made.incoming)
        const t1 = performance.now()
        // Per-element cost of the shipped element compare, outside the whole-list call.
        let slowest = 0
        for (let k = 0; k < made.incoming.length; k++) {
            const e0 = performance.now()
            sameStoredValue(made.incoming[k], (live.characters as unknown as Obj[])[k])
            slowest = Math.max(slowest, performance.now() - e0)
        }
        if (i >= WARMUPS) {
            copyMs.push(made.copyMs)
            cloneMs.push(made.cloneMs)
            keepAltMs.push(made.keepAltMs)
            compareMs.push(t1 - t0)
            longestOne.push(slowest)
        }
        kept = result === null ? 0 : result.keptSlots.size
        nullResult = result === null
    }
    return {
        profile: profile.name,
        description: profile.description,
        arm: 'compare-proxied',
        residents: live.characters.length,
        repeats: REPEATS,
        coldFirstCopyMs: round(first.copyMs),
        copyMsWarm: stat(copyMs),
        cloneMs: stat(cloneMs),
        keepLiveAltMs: stat(keepAltMs),
        compareMs: stat(compareMs),
        longestSingleElementCompareMs: stat(longestOne),
        keptSlots: kept,
        resultNull: nullResult,
        ratioCompareOverCopyWarm: round(median(compareMs) / median(copyMs)),
        ratioCompareOverCopyCold: round(median(compareMs) / first.copyMs),
    }
}

async function measureBaselineArm(profile: Profile): Promise<Record<string, unknown>> {
    const raw = profile.build()
    const base: PreviousEncoding = rigBase(raw)
    const holder = $state<{ db: Database }>({ db: raw })
    const live = holder.db
    const allIds = (raw.characters as unknown as Obj[]).map(slot => String(slot.chaId))
    const encoder = createSaveEncoder({ previous: base, lists: fakeLists, env: seededEnv(77), now: () => RIG_NOW })
    const { mint } = createKeyMint(seededEnv(900), null)
    let seq = 2
    const slices: number[] = []
    let sliceStart = 0

    async function pass(withYield: boolean): Promise<{ planMs: number, buildMs: number, ackMs: number, longest: number, encoded: number, yields: number }> {
        const { incoming } = makeIncoming(live)
        live.characters = incoming as unknown as Database['characters']
        slices.length = 0
        const request: SavePassRequest = withYield
            ? {
                ...rigRequest(allIds),
                yield: async () => {
                    slices.push(performance.now() - sliceStart)
                    await new Promise<void>(resolve => setTimeout(resolve, 0))
                    sliceStart = performance.now()
                },
            }
            : rigRequest(allIds)
        const t0 = performance.now()
        sliceStart = t0
        const plan = await encoder.plan(live, request)
        const t1 = performance.now()
        slices.push(t1 - sliceStart)
        await plan.commitRequest().build({ mint, seq: seq++, now: RIG_NOW })
        const t2 = performance.now()
        plan.acknowledge()
        const t3 = performance.now()
        return {
            planMs: t1 - t0,
            buildMs: t2 - t1,
            ackMs: t3 - t2,
            longest: Math.max(...slices),
            encoded: plan.encoded.length,
            yields: withYield ? slices.length - 1 : 0,
        }
    }

    for (let i = 0; i < WARMUPS; i++) {
        await pass(false)
    }
    const plain: Array<Awaited<ReturnType<typeof pass>>> = []
    for (let i = 0; i < REPEATS; i++) {
        plain.push(await pass(false))
    }
    const yielded: Array<Awaited<ReturnType<typeof pass>>> = []
    for (let i = 0; i < REPEATS; i++) {
        yielded.push(await pass(true))
    }
    const totals = plain.map(s => s.planMs + s.buildMs + s.ackMs)
    return {
        profile: profile.name,
        description: profile.description,
        arm: 'baseline-install-then-markall-persistent-warm-memo',
        residents: live.characters.length,
        repeats: REPEATS,
        planMs: stat(plain.map(s => s.planMs)),
        buildMs: stat(plain.map(s => s.buildMs)),
        acknowledgeMs: stat(plain.map(s => s.ackMs)),
        totalPlanBuildAckMs: stat(totals),
        encodedCount: [...new Set(plain.map(s => s.encoded))],
        yielded: {
            longestPlanSliceMs: stat(yielded.map(s => s.longest)),
            planMsIncludingTimerWaits: stat(yielded.map(s => s.planMs)),
            yieldCount: yielded[0].yields,
        },
        chunkMemo: encoder.chunkMemoStats(),
    }
}

describe('CHORE-17 N1 proxied compare against mark-all', () => {
    test('measures both profiles', async () => {
        const rows: Array<Record<string, unknown>> = []
        const profiles: Profile[] = [
            { name: 'heavy', description: `${COUNT} residents, 2 chats of 200 msgs x ~400 ch, 20 alt each, seed 1717`, build: () => buildHeavy(COUNT) },
            { name: 'device-shaped', description: `${COUNT} residents, chats 3,3,3,4,4 by slot (mean 3.4), 40 msgs x ~300 ch, 5 alt each, seed 3434`, build: () => buildDeviceShaped(COUNT) },
        ]
        for (const profile of profiles) {
            const compare = measureCompareArm(profile)
            rows.push(compare)
            console.log(JSON.stringify(compare))
            const baseline = await measureBaselineArm(profile)
            rows.push(baseline)
            console.log(JSON.stringify(baseline))
            const compareMedian = (compare.compareMs as { median: number }).median
            const plan = (baseline.planMs as { median: number }).median
            const total = (baseline.totalPlanBuildAckMs as { median: number }).median
            const verdict = {
                profile: profile.name,
                compareMsMedian: compareMedian,
                planMsMedian: plan,
                totalPlanBuildAckMsMedian: total,
                compareOverPlan: round(compareMedian / plan),
                compareOverTotal: round(compareMedian / total),
            }
            rows.push({ verdict })
            console.log(JSON.stringify({ verdict }))
        }
        fs.writeFileSync(OUT, JSON.stringify(rows, null, 1))
        expect(rows.length).toBeGreaterThan(0)
    }, 3_000_000)
})
