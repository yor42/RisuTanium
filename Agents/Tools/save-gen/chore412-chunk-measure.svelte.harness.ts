// @vitest-environment node
/**
 * CHORE-412 stage S2 measurement M1 (diagnostic experiment, not a regression test): how the chat-chunk parameter set
 * (target, min, max) decides the chunk shapes, the chunk units a save pass writes after one small edit, the size of the
 * holder's chunk Refs and the one-time re-split from a greedy store. Every pass runs through the real
 * `createSaveEncoder` plan, `commitRequest().build` and `acknowledge` (the `writeAmplificationRig` pass), over an
 * acknowledged encoding made by the real `encodeDatabase`; no backend, no commit.
 *
 * Run (from the repo root; the file is named, never the whole folder, because the folder run rewrites golden fixtures):
 *   npx vitest run --config Agents/Tools/vitest.harness.config.ts chore412-chunk-measure
 *
 * Environment: RISU_C412_M1_OUT is the rows JSON path (default: the OS temp directory), RISU_C412_M1_SEEDS the seed
 * count per profile (default 300). The data is seeded and synthetic; one character holds one long chat.
 *
 * Parameter sets (the `chunkParams` module is replaced by a mutable object, as in chunkResplitCommit.test.ts):
 *   G greedy {min 0, target 0, max 131072}; W32 {2048, 32768, 131072}; W64 {4096, 65536, 131072}.
 * Profiles: `harness` (messages of 200-900 B, 1,000 messages) and `real` (lognormal sizes, 5.4 KB median, sigma 0.8,
 * 1,000 messages). Edits: early delete (the first message), anchor delete (the last message of the middle chunk under
 * the set in force), early grow (2 KB into message 1), mid grow (2 KB into message 500) and an append of one message.
 * Chunk units written are the units of type chat chunk in the built commit (reused units are not in it), their bytes
 * are framed bytes.
 */
import { describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import { splitChat } from 'src/ts/storage/store2/codec'
import { canonicalJson, UNIT_TYPE } from 'src/ts/storage/store2/format'
import {
    chat as chatFixture, dbWithCharacters, encodeWith, message, mulberry32, prosePool, sparseCharacter, type Obj,
} from 'src/ts/storage/tests/store2/codecFixtures'
import { measureRigPass, rigBase, rigRequest, type RigPass } from 'src/ts/storage/tests/store2/writeAmplificationRig'

const params = vi.hoisted(() => ({ min: 2_048, target: 32_768, max: 131_072 }))
vi.mock('src/ts/storage/store2/codec/chunkParams', () => ({ MESSAGE_CHUNKING: params }))

const OUT = process.env.RISU_C412_M1_OUT ?? path.join(os.tmpdir(), 'chore412-chunk-measure.json')
const SEEDS = Number(process.env.RISU_C412_M1_SEEDS ?? '300')
const MESSAGES = 1_000
const CHA_ID = 'cha-m1'
const GROW_BYTES = 2_048

interface ParamSet {
    name: string
    min: number
    target: number
    max: number
}

const GREEDY: ParamSet = { name: 'G', min: 0, target: 0, max: 131_072 }
const SETS: ParamSet[] = [
    GREEDY,
    { name: 'W32', min: 2_048, target: 32_768, max: 131_072 },
    { name: 'W64', min: 4_096, target: 65_536, max: 131_072 },
]

type ProfileName = 'harness' | 'real'
const PROFILES: ProfileName[] = ['harness', 'real']
const EDITS = ['early-delete', 'anchor-delete', 'early-grow', 'mid-grow', 'append'] as const
type EditName = typeof EDITS[number]

function useSet(set: ParamSet): void {
    params.min = set.min
    params.target = set.target
    params.max = set.max
}

function utf8(text: string): number {
    return new TextEncoder().encode(text).length
}

function normal(rng: () => number): number {
    const u = Math.max(rng(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** The next message size of a profile. */
function sizeOf(profile: ProfileName, rng: () => number): number {
    if (profile === 'harness') {
        return 200 + Math.floor(rng() * 700)
    }
    return Math.min(100_000, Math.max(200, Math.round(5_400 * Math.exp(0.8 * normal(rng)))))
}

interface Built {
    db: ReturnType<typeof dbWithCharacters>
    chatObj: Obj
    messages: Obj[]
    pool: string[]
    growText: string
    appendRng: () => number
    appendSize: number
}

function build(profile: ProfileName, seed: number): Built {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    const messages = Array.from({ length: MESSAGES }, (_, i) => message(rng, pool, i, sizeOf(profile, rng), i % 2 === 1 && rng() < 0.15))
    const chatObj = chatFixture(rng, 0, messages)
    const slot = sparseCharacter(rng, pool, CHA_ID, 'M1 Character', [chatObj], [])
    const db = dbWithCharacters([slot])
    let growText = ''
    while (growText.length < GROW_BYTES) {
        growText += ' ' + pool[Math.floor(rng() * pool.length)]
    }
    return { db, chatObj, messages, pool, growText: growText.slice(0, GROW_BYTES), appendRng: mulberry32(seed + 7_919), appendSize: sizeOf(profile, rng) }
}

interface ChunkShape {
    count: number
    meanBytes: number
    maxBytes: number
    cutAtMax: number
    /** Chunks that can be sealed by the max rule (the last chunk is never cut). */
    cuttable: number
    refsJsonBytes: number
}

/** The chunk census of a chat under the set in force, from the real encode of a first save. */
function shapeOf(built: Built, set: ParamSet): ChunkShape {
    const tree = encodeWith(built.db)
    const units = tree.units.filter(unit => unit.type === UNIT_TYPE.chatChunk)
    const split = splitChat(built.chatObj as unknown as JsonObject, 'chat')
    const sizes = units.map(unit => (unit.reused === false ? unit.bytes.length : 0))
    let cutAtMax = 0
    let offset = 0
    split.chunks.forEach((chunk, index) => {
        const lengths = chunk.msgs.map(item => utf8(canonicalJson(item)))
        offset += chunk.msgs.length
        if (index < split.chunks.length - 1) {
            const raw = 2 + lengths.reduce((sum, value) => sum + value, 0) + (lengths.length - 1)
            const next = utf8(canonicalJson(built.messages[offset]))
            if (raw + next + 1 > set.max) {
                cutAtMax++
            }
        }
    })
    const refs = units.map((unit, index) => [unit.ref[0], unit.ref[1], unit.ref[2], split.chunks[index].msgs.length])
    return {
        count: units.length,
        meanBytes: sizes.reduce((sum, value) => sum + value, 0) / units.length,
        maxBytes: Math.max(...sizes),
        cutAtMax,
        cuttable: Math.max(0, units.length - 1),
        refsJsonBytes: utf8(JSON.stringify(refs)),
    }
}

/** Index in `messages` of the last message of the middle chunk under the set in force. */
function anchorIndex(built: Built): number {
    const split = splitChat(built.chatObj as unknown as JsonObject, 'chat')
    const target = Math.min(split.chunks.length - 1, Math.floor(split.chunks.length / 2))
    let end = 0
    for (let i = 0; i <= target; i++) {
        end += split.chunks[i].msgs.length
    }
    return end - 1
}

function applyEdit(built: Built, edit: EditName): () => void {
    const { messages } = built
    switch (edit) {
        case 'early-delete': {
            const removed = messages.splice(0, 1)
            return () => { messages.splice(0, 0, ...removed) }
        }
        case 'anchor-delete': {
            const at = anchorIndex(built)
            const removed = messages.splice(at, 1)
            return () => { messages.splice(at, 0, ...removed) }
        }
        case 'early-grow':
        case 'mid-grow': {
            const target = messages[edit === 'early-grow' ? 1 : 500]
            const before = target.data as string
            target.data = before + built.growText
            return () => { target.data = before }
        }
        case 'append': {
            const added = message(built.appendRng, built.pool, messages.length, built.appendSize)
            messages.push(added)
            return () => { messages.pop() }
        }
    }
}

function chunkRows(pass: RigPass): { units: number, bytes: number } {
    const chunks = pass.written.filter(unit => unit.type === UNIT_TYPE.chatChunk)
    return { units: chunks.length, bytes: chunks.reduce((sum, unit) => sum + unit.bytes, 0) }
}

function percentile(sorted: number[], p: number): number {
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]
}

function mean(values: number[]): number {
    return values.reduce((sum, value) => sum + value, 0) / values.length
}

function summary(values: number[]): { p50: number, p90: number, p99: number, max: number, mean: number } {
    const sorted = [...values].sort((a, b) => a - b)
    return { p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), p99: percentile(sorted, 0.99), max: sorted[sorted.length - 1], mean: mean(values) }
}

function round(value: number, digits = 1): number {
    const scale = 10 ** digits
    return Math.round(value * scale) / scale
}

interface Collected {
    shape: { count: number[], mean: number[], max: number[], cutAtMax: number[], cuttable: number[], refs: number[] }
    edits: Record<EditName, { units: number[], bytes: number[] }>
    resplit: { units: number[], bytes: number[], chunkUnits: number[], chunkBytes: number[] }
}

function emptyCollected(): Collected {
    const edits = {} as Collected['edits']
    for (const edit of EDITS) {
        edits[edit] = { units: [], bytes: [] }
    }
    return {
        shape: { count: [], mean: [], max: [], cutAtMax: [], cuttable: [], refs: [] },
        edits,
        resplit: { units: [], bytes: [], chunkUnits: [], chunkBytes: [] },
    }
}

describe('CHORE-412 M1 chunk parameter measurement', () => {
    test('measures every (set, profile)', async () => {
        const collected = new Map<string, Collected>()
        const started = Date.now()
        for (const profile of PROFILES) {
            for (const set of SETS) {
                collected.set(`${profile}/${set.name}`, emptyCollected())
            }
            for (let seed = 1; seed <= SEEDS; seed++) {
                const built = build(profile, seed)
                useSet(GREEDY)
                const greedyBase = rigBase(built.db)
                for (const set of SETS) {
                    const into = collected.get(`${profile}/${set.name}`) as Collected
                    useSet(set)
                    const shape = shapeOf(built, set)
                    into.shape.count.push(shape.count)
                    into.shape.mean.push(shape.meanBytes)
                    into.shape.max.push(shape.maxBytes)
                    into.shape.cutAtMax.push(shape.cutAtMax)
                    into.shape.cuttable.push(shape.cuttable)
                    into.shape.refs.push(shape.refsJsonBytes)
                    const base = set === GREEDY ? greedyBase : rigBase(built.db)
                    for (const edit of EDITS) {
                        const pass = await measureRigPass(built.db, base, rigRequest([CHA_ID]), () => applyEdit(built, edit))
                        const rows = chunkRows(pass)
                        into.edits[edit].units.push(rows.units)
                        into.edits[edit].bytes.push(rows.bytes)
                    }
                    if (set !== GREEDY) {
                        const pass = await measureRigPass(built.db, greedyBase, rigRequest([CHA_ID]))
                        const rows = chunkRows(pass)
                        into.resplit.units.push(pass.written.length + 1)
                        into.resplit.bytes.push(pass.writtenBytes)
                        into.resplit.chunkUnits.push(rows.units)
                        into.resplit.chunkBytes.push(rows.bytes)
                    }
                }
                if (seed % 10 === 0) {
                    console.log(`progress ${profile} seed ${seed}/${SEEDS} elapsed ${Math.round((Date.now() - started) / 1000)} s`)
                }
            }
        }

        const rows: Array<Record<string, unknown>> = []
        const lines: string[] = []
        for (const profile of PROFILES) {
            for (const set of SETS) {
                const c = collected.get(`${profile}/${set.name}`) as Collected
                const cutShare = c.shape.cutAtMax.reduce((a, b) => a + b, 0) / Math.max(1, c.shape.cuttable.reduce((a, b) => a + b, 0))
                const shape = {
                    chunks: summary(c.shape.count),
                    meanChunkBytes: round(mean(c.shape.mean)),
                    maxChunkBytes: summary(c.shape.max),
                    cutAtMaxShareOfSealedChunks: round(cutShare * 100, 2),
                    refsJsonBytes: summary(c.shape.refs),
                }
                rows.push({ kind: 'shape', profile, set: set.name, seeds: SEEDS, ...shape })
                lines.push(`SHAPE ${profile} ${set.name}: chunks mean ${round(shape.chunks.mean)} p50 ${shape.chunks.p50} max ${shape.chunks.max}; chunk bytes mean ${shape.meanChunkBytes} worst ${shape.maxChunkBytes.max}; cut-at-max ${shape.cutAtMaxShareOfSealedChunks}%; refs JSON bytes mean ${round(shape.refsJsonBytes.mean)} p99 ${shape.refsJsonBytes.p99} max ${shape.refsJsonBytes.max}`)
                for (const edit of EDITS) {
                    const units = summary(c.edits[edit].units)
                    const bytes = mean(c.edits[edit].bytes)
                    rows.push({ kind: 'edit', profile, set: set.name, edit, seeds: SEEDS, unitsP50: units.p50, unitsP90: units.p90, unitsP99: units.p99, unitsMax: units.max, unitsMean: round(units.mean, 2), writtenBytesMean: Math.round(bytes) })
                    lines.push(`EDIT ${profile} ${set.name} ${edit}: units p50 ${units.p50} p90 ${units.p90} p99 ${units.p99} max ${units.max} (mean ${round(units.mean, 2)}); written bytes mean ${Math.round(bytes)}`)
                }
                if (set !== GREEDY) {
                    const units = summary(c.resplit.units)
                    const bytes = summary(c.resplit.bytes)
                    const chunkUnits = summary(c.resplit.chunkUnits)
                    const over = c.resplit.units.filter(value => value > 59).length
                    rows.push({
                        kind: 'resplit', profile, set: set.name, seeds: SEEDS,
                        unitsP50: units.p50, unitsP90: units.p90, unitsP99: units.p99, unitsMax: units.max, unitsMin: Math.min(...c.resplit.units),
                        bytesMean: Math.round(bytes.mean), bytesP99: bytes.p99, bytesMax: bytes.max,
                        chunkUnitsP50: chunkUnits.p50, chunkUnitsMax: chunkUnits.max, chunkBytesMean: Math.round(mean(c.resplit.chunkBytes)),
                        seedsOver59: over,
                    })
                    lines.push(`RESPLIT G->${set.name} ${profile}: units (manifest incl.) p50 ${units.p50} p99 ${units.p99} max ${units.max} min ${Math.min(...c.resplit.units)}; seeds over 59: ${over}/${SEEDS}; bytes mean ${Math.round(bytes.mean)} max ${bytes.max}; chunk units p50 ${chunkUnits.p50} max ${chunkUnits.max}`)
                }
            }
        }
        for (const line of lines) {
            console.log(line)
        }
        console.log(`elapsed ${Math.round((Date.now() - started) / 1000)} s`)
        fs.writeFileSync(OUT, JSON.stringify({ seeds: SEEDS, messages: MESSAGES, sets: SETS, rows }, null, 1))
        // Sensitivity: an edit of the second message writes at least one chunk under every set.
        for (const profile of PROFILES) {
            for (const set of SETS) {
                const c = collected.get(`${profile}/${set.name}`) as Collected
                expect(Math.min(...c.edits['early-grow'].units)).toBeGreaterThan(0)
            }
        }
    }, 3_600_000)
})
