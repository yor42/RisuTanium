// @vitest-environment node
// ChroMemory S3 dense/hybrid measurement (spec 9 sizes, spec 11 S3 row, D1). CI skips this file; run it by hand:
//   $env:LTM_S3_OUT = "<dir under the temp folder>"   (optional; default <temp>\ltm-s3-dense-out)
//   node --expose-gc node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/s3-dense.harness.ts
//
// Everything is synthetic and offline: seeded chats at spec 9's message lengths (short and long profile, 5,000 messages,
// 40% Hangul), seeded unit vectors, and the concept embedder of the dense test fixtures. No provider is called, so the
// embedding build numbers are a request-count and character projection, never a latency. PC numbers are lower bounds.
// Reports go to LTM_S3_OUT only, which must lie under the temp folder.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import v8 from 'node:v8'
import vm from 'node:vm'
import { describe, expect, test } from 'vitest'
import { ChatUnitIndex, RARE_SHARE, type IndexedUnit } from '../../../src/ts/process/memory/chroMemory/chatIndex'
import { DENSE_BATCH, DENSE_TOP_K, DenseStore, denseOrder, fuseOrders } from '../../../src/ts/process/memory/chroMemory/dense'
import { recordOf, type MessageRecord } from '../../../src/ts/process/memory/chroMemory/records'
import { getLastChroMemoryTrace, resetChroMemoryShadowForTests, runChroMemorySafely } from '../../../src/ts/process/memory/chroMemory/shadow'
import { buildSend, conceptEmbedder, deps, directIndexer, len, ltmOf, sharedTokens } from '../../../src/ts/process/memory/chroMemory/tests/denseFixtures'

const MESSAGES = 5000
const HANGUL_SHARE = 0.4
const DIMS = [384, 1024, 1536, 3072]
const QUERIES = 50
const LOAD_TARGET_MS = 1000
const REMOTE_BATCH = 50
/** The JSON form is measured on this many entries and scaled; a whole-chat JSON string passes V8's string limit at large dimensions. */
const JSON_SAMPLE = 1000
const LENGTHS = {
    short: { median: 220, p90: 900, max: 4000 },
    long: { median: 1000, p90: 3000, max: 8000 },
} as const
type Profile = keyof typeof LENGTHS

function outDir(): string {
    const dir = process.env.LTM_S3_OUT ?? path.join(os.tmpdir(), 'ltm-s3-dense-out')
    const abs = path.resolve(dir)
    const tmp = path.resolve(os.tmpdir()) + path.sep
    if (!(abs + path.sep).toLowerCase().startsWith(tmp.toLowerCase())) throw new Error('LTM_S3_OUT must lie under the temp folder')
    fs.mkdirSync(abs, { recursive: true })
    return abs
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6D2B79F5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function getGc(): (() => void) | null {
    const own = (globalThis as { gc?: () => void }).gc
    if (own) return own
    try {
        v8.setFlagsFromString('--expose-gc')
        return vm.runInNewContext('gc') as () => void
    } catch {
        return null
    }
}
const gc = getGc()
function collect(): void {
    if (!gc) return
    gc()
    gc()
}

const MiB = 1024 * 1024
const mib = (n: number): number => Math.round((n / MiB) * 10) / 10
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
function percentile(xs: number[], p: number): number {
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]
}
const ms = (n: number): number => Math.round(n * 100) / 100

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic chat: the same shape as `synth-bin-gen.mjs --ltm-bench` (log-linear length quantiles, 40% Hangul text from a
// seeded vocabulary, one message of exactly the maximum length, roles alternating with the character first).

function lengthAt(u: number, l: { median: number, p90: number, max: number }): number {
    const min = 12
    const points: Array<[number, number]> = [[0, min], [0.5, l.median], [0.9, l.p90], [1, l.max]]
    let upper = 1
    while (upper < points.length - 1 && points[upper][0] < u) upper++
    const [lowU, lowLen] = points[upper - 1]
    const [highU, highLen] = points[upper]
    return Math.max(min, Math.min(l.max, Math.round(lowLen * (highLen / lowLen) ** ((u - lowU) / (highU - lowU)))))
}

interface Msg { role: 'char' | 'user', text: string }

function benchMessages(seed: number, profile: Profile, count: number): Msg[] {
    const rnd = mulberry32(seed)
    const l = LENGTHS[profile]
    const syllables = ['ka', 'lo', 'mi', 'ren', 'tha', 'vel', 'dor', 'an', 'is', 'ul', 'ex', 'or', 'qui', 'na', 'be', 'sha']
    const words = Array.from({ length: 3000 }, () => {
        let w = ''
        for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) w += syllables[Math.floor(rnd() * syllables.length)]
        return w
    })
    const hangulWords = Array.from({ length: 800 }, () => {
        let w = ''
        for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) w += String.fromCharCode(0xAC00 + Math.floor(rnd() * 11172))
        return w
    })
    const text = (length: number, hangul: boolean): string => {
        const list = hangul ? hangulWords : words
        const parts: string[] = []
        let size = 0
        while (size < length) {
            const wordCount = 6 + Math.floor(rnd() * 9)
            for (let w = 0; w < wordCount && size < length; w++) {
                const word = list[Math.floor(rnd() * list.length)] + (w === wordCount - 1 ? '.' : '')
                parts.push(word)
                size += word.length + 1
            }
        }
        return parts.join(' ').slice(0, length)
    }
    const flags = Array.from({ length: count }, (_, m) => m < Math.round(count * HANGUL_SHARE))
    for (let k = count - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1))
        ;[flags[k], flags[j]] = [flags[j], flags[k]]
    }
    return Array.from({ length: count }, (_, m) => ({
        role: m % 2 === 0 ? 'char' : 'user',
        text: text(m === 7 ? l.max : lengthAt(rnd(), l), flags[m]),
    }))
}

function recordsOf(msgs: Msg[]): MessageRecord[] {
    return msgs.map((m, i) => recordOf({ msg: { chatId: `m${i}`, role: m.role, data: m.text }, chatIndex: i, name: 'Bot', preWrap: m.text, data: m.text }, 'User'))
}

// ---------------------------------------------------------------------------------------------------------------------
// Vectors and the persisted candidate forms

function gaussianUnit(rnd: () => number, dim: number): Float32Array {
    const v = new Float32Array(dim)
    let n = 0
    for (let i = 0; i < dim; i++) {
        const x = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
        v[i] = x
        n += x * x
    }
    n = Math.sqrt(n)
    for (let i = 0; i < dim; i++) v[i] /= n
    return v
}

const f32Tmp = new Float32Array(1)
const u32Tmp = new Uint32Array(f32Tmp.buffer)
function toHalf(x: number): number {
    f32Tmp[0] = x
    const b = u32Tmp[0]
    const sign = (b >>> 16) & 0x8000
    const e = ((b >>> 23) & 0xff) - 127 + 15
    let m = b & 0x7fffff
    if (e >= 31) return sign | 0x7c00
    if (e <= 0) {
        if (e < -10) return sign
        m = (m | 0x800000) >> (1 - e)
        return sign | ((m + 0x1000) >> 13)
    }
    return sign | (e << 10) | ((m + 0x1000) >> 13)
}
function fromHalf(h: number): number {
    const s = h & 0x8000 ? -1 : 1
    const e = (h >> 10) & 31
    const m = h & 1023
    if (e === 0) return s * m * 2 ** -24
    if (e === 31) return m ? NaN : s * Infinity
    return s * (1 + m / 1024) * 2 ** (e - 15)
}
/** Decoding a half is a table lookup in a real loader; the table is built once, outside the timed load. */
const HALF_TABLE = new Float32Array(65536)
for (let h = 0; h < 65536; h++) HALF_TABLE[h] = fromHalf(h)

interface Forms {
    keysJson: string
    f32: ArrayBuffer
    f16: ArrayBuffer
    i8: ArrayBuffer
    scales: ArrayBuffer
}

function encode(keys: string[], vecs: Float32Array[], dim: number): Forms {
    const n = vecs.length
    const f32 = new Float32Array(n * dim)
    const f16 = new Uint16Array(n * dim)
    const i8 = new Int8Array(n * dim)
    const scales = new Float32Array(n)
    for (let i = 0; i < n; i++) {
        const v = vecs[i]
        f32.set(v, i * dim)
        let max = 0
        for (let d = 0; d < dim; d++) {
            f16[i * dim + d] = toHalf(v[d])
            max = Math.max(max, Math.abs(v[d]))
        }
        const scale = max / 127 || 1
        scales[i] = scale
        for (let d = 0; d < dim; d++) i8[i * dim + d] = Math.round(v[d] / scale)
    }
    return { keysJson: JSON.stringify(keys), f32: f32.buffer, f16: f16.buffer, i8: i8.buffer, scales: scales.buffer }
}

function loadF32(f: Forms, dim: number): Map<string, Float32Array> {
    const keys = JSON.parse(f.keysJson) as string[]
    const map = new Map<string, Float32Array>()
    for (let i = 0; i < keys.length; i++) map.set(keys[i], new Float32Array(f.f32.slice(i * dim * 4, (i + 1) * dim * 4)))
    return map
}
function loadF16(f: Forms, dim: number): Map<string, Float32Array> {
    const keys = JSON.parse(f.keysJson) as string[]
    const src = new Uint16Array(f.f16)
    const map = new Map<string, Float32Array>()
    for (let i = 0; i < keys.length; i++) {
        const out = new Float32Array(dim)
        for (let d = 0; d < dim; d++) out[d] = HALF_TABLE[src[i * dim + d]]
        map.set(keys[i], out)
    }
    return map
}
function loadI8(f: Forms, dim: number): Map<string, Float32Array> {
    const keys = JSON.parse(f.keysJson) as string[]
    const src = new Int8Array(f.i8)
    const scales = new Float32Array(f.scales)
    const map = new Map<string, Float32Array>()
    for (let i = 0; i < keys.length; i++) {
        const out = new Float32Array(dim)
        const s = scales[i]
        for (let d = 0; d < dim; d++) out[d] = src[i * dim + d] * s
        map.set(keys[i], out)
    }
    return map
}

function timeLoad(fn: () => Map<string, Float32Array>): { ms: number, map: Map<string, Float32Array> } {
    const times: number[] = []
    let map = new Map<string, Float32Array>()
    for (let r = 0; r < 3; r++) {
        collect()
        const t = performance.now()
        map = fn()
        times.push(performance.now() - t)
    }
    return { ms: median(times), map }
}

function cosine(a: Float32Array, b: Float32Array): number {
    let d = 0
    let x = 0
    let y = 0
    for (let i = 0; i < a.length; i++) {
        d += a[i] * b[i]
        x += a[i] * a[i]
        y += b[i] * b[i]
    }
    return d / Math.sqrt(x * y)
}

// ---------------------------------------------------------------------------------------------------------------------

interface DimResult {
    dim: number
    units: number
    computedMiB: number
    ramArrayBuffersMiB: number | null
    ramHeapUsedMiB: number | null
    send: { denseOrderP50: number, denseOrderP95: number, bothP50: number, bothP95: number, valid: number }
    store: Record<'f32' | 'f16' | 'int8' | 'json', { mib: number, loadMs: number, passesLoadTarget: boolean, note?: string }>
    quantCosineMin: { f16: number, int8: number }
}

function measureDim(units: readonly IndexedUnit[], lexicalOf: Array<{ order: IndexedUnit[], scored: number }>, dim: number): DimResult {
    const rnd = mulberry32(0xD1 + dim)
    const n = units.length
    const keys = units.map((u) => `${u.key}#${u.ordinal}`)

    // RAM of the filled store: arrayBuffers and heapUsed after gc, around building the store alone.
    collect()
    const m0 = process.memoryUsage()
    const store = new DenseStore()
    for (const u of units) store.set(u, gaussianUnit(rnd, dim))
    collect()
    const m1 = process.memoryUsage()
    const ramOk = gc !== null

    // Send cost: cosine over the whole store plus fusion, per query.
    const queryRnd = mulberry32(0xA11CE + dim)
    const dOnly: number[] = []
    const both: number[] = []
    let valid = 0
    for (let q = -3; q < QUERIES; q++) {
        const query = gaussianUnit(queryRnd, dim)
        const lex = lexicalOf[Math.max(0, q) % lexicalOf.length]
        const t0 = performance.now()
        const ranking = denseOrder(store, units, query)
        const t1 = performance.now()
        fuseOrders(lex.order, lex.scored, units, ranking.top)
        const t2 = performance.now()
        valid = ranking.valid
        if (q >= 0) {
            dOnly.push(t1 - t0)
            both.push(t2 - t0)
        }
    }

    // Persisted forms. The vectors are read back from the store, so the forms hold exactly what it held.
    const vecs = units.map((u) => store.get(u) as Float32Array)
    const forms = encode(keys, vecs, dim)
    const keyBytes = Buffer.byteLength(forms.keysJson)
    const f32 = timeLoad(() => loadF32(forms, dim))
    const f16 = timeLoad(() => loadF16(forms, dim))
    const i8 = timeLoad(() => loadI8(forms, dim))
    let minF16 = 1
    let minI8 = 1
    const step = Math.max(1, Math.floor(n / 200))
    for (let i = 0; i < n; i += step) {
        minF16 = Math.min(minF16, cosine(vecs[i], f16.map.get(keys[i]) as Float32Array))
        minI8 = Math.min(minI8, cosine(vecs[i], i8.map.get(keys[i]) as Float32Array))
    }

    // The JSON number[] form: a sample is stringified and parsed, then scaled to all entries.
    const m = Math.min(n, JSON_SAMPLE)
    const parts: string[] = []
    for (let i = 0; i < m; i++) parts.push(`${JSON.stringify(keys[i])}:${JSON.stringify(Array.from(vecs[i]))}`)
    const doc = `{${parts.join(',')}}`
    const jsonLoads: number[] = []
    for (let r = 0; r < 3; r++) {
        collect()
        const t = performance.now()
        const parsed = JSON.parse(doc) as Record<string, number[]>
        const out = new Map<string, Float32Array>()
        for (const k of Object.keys(parsed)) out.set(k, new Float32Array(parsed[k]))
        jsonLoads.push(performance.now() - t)
    }
    const scale = n / m
    const jsonBytes = Buffer.byteLength(doc) * scale
    const jsonMs = median(jsonLoads) * scale
    const jsonNote = m < n ? `extrapolated from ${m} of ${n} entries` : undefined
    const stored = (blob: number) => keyBytes + blob
    const result: DimResult = {
        dim,
        units: n,
        computedMiB: mib(n * dim * 4),
        ramArrayBuffersMiB: ramOk ? mib(m1.arrayBuffers - m0.arrayBuffers) : null,
        ramHeapUsedMiB: ramOk ? mib(m1.heapUsed - m0.heapUsed) : null,
        send: { denseOrderP50: ms(median(dOnly)), denseOrderP95: ms(percentile(dOnly, 0.95)), bothP50: ms(median(both)), bothP95: ms(percentile(both, 0.95)), valid },
        store: {
            f32: { mib: mib(stored(n * dim * 4)), loadMs: ms(f32.ms), passesLoadTarget: f32.ms <= LOAD_TARGET_MS },
            f16: { mib: mib(stored(n * dim * 2)), loadMs: ms(f16.ms), passesLoadTarget: f16.ms <= LOAD_TARGET_MS },
            int8: { mib: mib(stored(n * dim + n * 4)), loadMs: ms(i8.ms), passesLoadTarget: i8.ms <= LOAD_TARGET_MS },
            json: { mib: mib(jsonBytes), loadMs: ms(jsonMs), passesLoadTarget: jsonMs <= LOAD_TARGET_MS, note: jsonNote },
        },
        quantCosineMin: { f16: Math.round(minF16 * 1e6) / 1e6, int8: Math.round(minI8 * 1e6) / 1e6 },
    }
    store.dispose()
    return result
}

const codePoints = (s: string): number => Array.from(s).length

describe('S3 dense measurement (synthetic, offline)', () => {
    for (const profile of ['short', 'long'] as Profile[]) {
        test(`profile ${profile}`, async () => {
            const out = outDir()
            const msgs = benchMessages(profile === 'short' ? 3301 : 3302, profile, MESSAGES)
            const records = recordsOf(msgs)
            const index = new ChatUnitIndex(`s3-${profile}`)
            const rec = index.reconcile(records)
            const units = index.units()

            const rnd = mulberry32(777)
            const lexicalOf = Array.from({ length: QUERIES }, () => {
                const text = msgs[Math.floor(rnd() * msgs.length)].text
                const lex = index.rank(text.slice(Math.max(0, text.length - 200)), RARE_SHARE)
                return { order: lex.order, scored: lex.scored }
            })

            const chars = units.map((u) => codePoints(u.text))
            const total = chars.reduce((a, b) => a + b, 0)
            const messageChars = msgs.reduce((a, m) => a + codePoints(m.text), 0)
            const batchRows = [DENSE_BATCH, REMOTE_BATCH].map((b) => {
                const per: number[] = []
                for (let i = 0; i < chars.length; i += b) per.push(chars.slice(i, i + b).reduce((a, c) => a + c, 0))
                return { batch: b, requests: per.length, charsPerRequestMean: Math.round(total / per.length), charsPerRequestMax: Math.max(...per) }
            })

            const dims: DimResult[] = []
            for (const dim of DIMS) dims.push(measureDim(units, lexicalOf, dim))

            const report = {
                profile,
                messages: msgs.length,
                hangulShare: HANGUL_SHARE,
                messageCharsTotal: messageChars,
                reconcileUnits: rec.units,
                indexUnits: units.length,
                unitCharsTotal: total,
                unitCharsMax: Math.max(...chars),
                denseTopK: DENSE_TOP_K,
                loadTargetMs: LOAD_TARGET_MS,
                gcAvailable: gc !== null,
                buildProjection: { note: 'estimate: request count and characters only; provider latency is not measured', rows: batchRows },
                dims,
            }
            fs.writeFileSync(path.join(out, `profile-${profile}.json`), JSON.stringify(report, null, 2))
            expect(rec.units).toBeGreaterThan(MESSAGES - 1)
            expect(dims).toHaveLength(DIMS.length)
        }, 3_600_000)
    }
})

// ---------------------------------------------------------------------------------------------------------------------
// Paraphrase diagnostic: mechanism only. The concept embedder knows eight concepts by construction, so a hybrid hit shows
// that the fusion path can surface a unit the keywords cannot; it says nothing about a real embedding model.

const CONCEPT_TERMS: Array<{ en: string[], ko: string[] }> = [
    { en: ['puppy', 'dog', 'hound', 'canine'], ko: ['강아지', '반려견'] },
    { en: ['rain', 'drizzle', 'storm', 'downpour'], ko: ['폭우', '소나기'] },
    { en: ['bread', 'loaf', 'bakery', 'baguette'], ko: ['빵', '베이커리'] },
    { en: ['ship', 'vessel', 'harbor', 'sailor'], ko: ['선박', '항구'] },
    { en: ['music', 'melody', 'guitar', 'song'], ko: ['음악', '기타'] },
    { en: ['garden', 'flower', 'tulip', 'soil'], ko: ['정원', '화단'] },
    { en: ['money', 'coin', 'wallet', 'price'], ko: ['지갑', '동전'] },
    { en: ['sleep', 'nap', 'pillow', 'dream'], ko: ['낮잠', '베개'] },
]
/** Filler words that name none of the eight concepts, so the fillers cannot crowd the target out by meaning. */
const NEUTRAL = ['table', 'cloud', 'lamp', 'stone', 'river', 'window', 'paper']

interface Case { lang: 'en' | 'ko', stratum: 'allude' | 'low', target: string, query: string }

function cases(): Case[] {
    const list: Case[] = []
    for (const c of CONCEPT_TERMS) {
        const en: Array<[string, string]> = [[c.en[0], c.en[1]], [c.en[2], c.en[3]]]
        for (const [a, b] of en) {
            list.push({ lang: 'en', stratum: 'allude', target: `Yesterday my ${a} was seen by the market stall.`, query: `Tell me about the ${b} again` })
            list.push({ lang: 'en', stratum: 'low', target: `Yesterday my ${a} was seen by the market stall.`, query: `Tell me about the ${a} and the ${b} again` })
        }
        const [ka, kb] = c.ko
        list.push({ lang: 'ko', stratum: 'allude', target: `어제 ${ka}를 시장에서 봤어요.`, query: `${kb}에 대해 알려줘` })
        list.push({ lang: 'ko', stratum: 'low', target: `어제 ${ka}를 시장에서 봤어요.`, query: `${ka}와 ${kb}에 대해 알려줘` })
    }
    return list
}

function chatFor(c: Case, at: number): { texts: string[], d0: number } {
    const texts: string[] = []
    for (let i = 0; i < 30; i++) texts.push(i === at ? c.target : `Entry ${i}: the ${NEUTRAL[i % NEUTRAL.length]} item${i} moved along near place${i}.`)
    const d0 = texts.length
    for (let i = 0; i < 4; i++) texts.push(`Tail ${i} keeps going with filler${i}.`)
    texts.push(c.query)
    return { texts, d0 }
}

describe('S3 paraphrase diagnostic (mechanism only, never gating)', () => {
    test('lexical against hybrid through the shadow engine with a dense embedder', async () => {
        const out = outDir()
        const rows: Array<{ lang: string, stratum: string, n: number, lexicalHit: number, hybridHit: number, allude: number }> = []
        const tally = new Map<string, { n: number, lex: number, hyb: number }>()
        let skipped = 0
        let caseNo = 0
        for (const c of cases()) {
            // The allude stratum must share no keyword with its target, or the keyword order could find it for free.
            if (c.stratum === 'allude' && sharedTokens(c.query, c.target).length) {
                skipped++
                continue
            }
            const at = 3 + (caseNo++ % 22)
            const base = chatFor(c, at)
            const budget = 50
            resetChroMemoryShadowForTests()
            const lexSend = await buildSend({ ...base, chatId: `lex-${caseNo}`, budget, ltm: ltmOf({ budgetTokens: budget }) })
            const lex = await runChroMemorySafely(lexSend.args, deps().d)
            const lexHit = lex?.block.includes(c.target) === true

            resetChroMemoryShadowForTests()
            const embedder = conceptEmbedder()
            const indexer = directIndexer()
            let hybHit = false
            for (let pass = 0; pass < 2; pass++) {
                const send = await buildSend({ ...base, chatId: `hyb-${caseNo}`, budget, ltm: ltmOf({ budgetTokens: budget, retrieval: 'hybrid' }) })
                const placed = await runChroMemorySafely(send.args, deps({ embedder: () => ({ embedder, reason: null }), scheduleDense: indexer.schedule }).d)
                await indexer.idle()
                if (pass === 1) hybHit = placed?.block.includes(c.target) === true
            }
            const trace = getLastChroMemoryTrace()
            expect(trace?.dense?.state).toBe('ready')
            const key = `${c.lang}/${c.stratum}`
            const t = tally.get(key) ?? { n: 0, lex: 0, hyb: 0 }
            t.n++
            if (lexHit) t.lex++
            if (hybHit) t.hyb++
            tally.set(key, t)
        }
        resetChroMemoryShadowForTests()
        for (const [key, t] of tally) {
            const [lang, stratum] = key.split('/')
            rows.push({ lang, stratum, n: t.n, lexicalHit: t.lex, hybridHit: t.hyb, allude: stratum === 'allude' ? 1 : 0 })
        }
        const report = { label: 'mechanism-only: synthetic concept embedder, report only, never gating', budgetTokens: 50, skippedForSharedTokens: skipped, tokenEstimate: `chars/4 (${len('abcd')} per 4 chars)`, rows }
        fs.writeFileSync(path.join(out, 'paraphrase.json'), JSON.stringify(report, null, 2))
        expect(rows.length).toBeGreaterThan(0)
    }, 600_000)
})
