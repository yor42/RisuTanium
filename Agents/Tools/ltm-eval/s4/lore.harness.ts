// ChroMemory S4 usefulness gate and timing diagnostic for lore recall (spec 9, plan A7). Synthetic data only; CI skips this
// file and `pnpm test` never collects it. Run it by hand, one file at a time:
//   $env:LTM_S4_OUT = "<dir under the temp folder>"
//   node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/s4/vitest.s4.config.ts Agents/Tools/ltm-eval/s4/lore.harness.ts
//
// The engine under test is the shipped `loreIndex.ts` and `loreRecall.ts`, called directly with the real `pickHashRand` as the
// entry hash, an identity render and the S0 stub counter for tokens. Procedure: tune (tau, N) on seed A over the grid, then
// report on a fresh seed B at the tuned settings with Wilson 95% intervals, raising n until every gating interval has a
// half-width of at most 0.05 (or the cap binds, which the report states). It also asserts that no recalled entry is in the
// never-recall set, and measures build ms, scoring ms and hash calls per send (D1).
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { get } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import type { Message } from '../../../../src/ts/storage/database.svelte'

vi.mock('src/ts/parser/parser.svelte', () => ({ risuChatParser: (text: string) => text }))
vi.mock('src/ts/process/modules', () => ({ moduleUpdate: () => {}, getModules: () => [] }))

import { pickHashRand } from 'src/ts/util'
import { tokenize } from '../../../../src/ts/process/memory/chroMemory/lexical'
import { createLoreIndexStore, type LoreIndexStore } from '../../../../src/ts/process/memory/chroMemory/loreIndex'
import { createLoreRecallStep, loreQueryOf, scoreLoreCandidates, LORE_MAX_PICKS, LORE_MAX_RENDERS, LORE_TAU, type LoreRecallView } from '../../../../src/ts/process/memory/chroMemory/loreRecall'
import { chroLoreTrace } from '../../../../src/ts/process/memory/chroMemory/traceStore'

// The config pins the vitest root, and so the working directory, to the repository root.
const HERE = path.resolve(process.cwd(), 'Agents', 'Tools', 'ltm-eval', 's4')
const imp = async <T>(file: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(file).href)) as T
// S0's counter reads `import.meta.url` as a file URL, which the happy-dom transform does not give; Node's own loader (here
// `require` of an ES module without top-level await) does.
const nodeRequire = createRequire(path.join(process.cwd(), 'package.json'))
const importNative = async <T>(file: string): Promise<T> => nodeRequire(file) as T

type Lang = 'en' | 'ko'
type Stratum = 'high' | 'low' | 'allude'
// 'common': every content word of a chit-chat turn is in a large share of the entries; 'mixed': at least one is in only a few percent.
type ChatTier = 'common' | 'mixed'
interface Rng { (): number; int(n: number): number; pick<T>(a: T[]): T; shuffle<T>(a: T[]): T[]; chance(p: number): boolean }
interface HEntry { key: string, comment: string, content: string, id?: string, mode: string, insertorder: number, alwaysActive: boolean, secondkey: string, selective: boolean, useRegex?: boolean }
interface TopicRec { index: number, pair: number, attrs: Record<string, string>, syn: Record<string, string[]> }
interface LoreSet { lang: Lang, seed: number, entries: HEntry[], topic: TopicRec[], never: Set<number>, cast: { user: string, char: string }, decoratorOf(e: HEntry): string | null }
interface GenMod {
    STRATA: Stratum[]
    genLoreSet(o: { lang: Lang, seed: number, scale?: number, idless?: boolean, equalLength?: boolean }): LoreSet
    genParaphrase(set: LoreSet, r: Rng, stratum: Stratum, target: TopicRec): { text: string, verbatim: string[], synonyms: string[] }
    genChitchat(set: LoreSet, r: Rng): { text: string, tier: ChatTier }
    turnSeed(seed: number, lang: Lang, kind: 'para' | 'none', i: number): number
}
interface Counter { len(s: string): number }

const GEN = await imp<GenMod>(path.join(HERE, 'loreGen.mjs'))
const { rng } = await imp<{ rng(seed: number): Rng }>(path.join(HERE, '..', 'gen', 'lib.mjs'))
const { stubCounter } = await importNative<{ stubCounter(): Counter }>(path.join(HERE, '..', 's0', 'counter.mjs'))
const STUB = stubCounter()

// ---- protocol constants ----
const LANGS: Lang[] = ['en', 'ko']
const SEED_A = 870001
const SEED_B = 870002
const SET_COUNT = 4
const TAU_GRID: Array<number | null> = [0.01, 0.02, 0.05, 0.1, 0.2, null]
const N_GRID = [1, 2, 3, 4, 5]
const MAX_K = 5
const TUNE_TURNS = 600
const START_TURNS = 300
const STEP_TURNS = 300
const CAP_TURNS = 3000
const HALF_WIDTH = 0.05
// The O1 recommended pass rule (precision, no-evidence recall rate, hit rate @N) is what the tune tries to meet.
const RULE_PRECISION = 0.6
const RULE_NER = 0.2
const RULE_HIT = 0.3
const BUDGET = 5000
const OWNER_KEY = 'harness-owner'

// ---- statistics ----
interface Ci { k: number, n: number, p: number, lo: number, hi: number, half: number }
const Z = 1.959964
function wilson(k: number, n: number): Ci {
    if (n === 0) return { k, n, p: Number.NaN, lo: 0, hi: 1, half: Number.POSITIVE_INFINITY }
    const p = k / n
    const z2 = Z * Z
    const d = 1 + z2 / n
    const centre = (p + z2 / (2 * n)) / d
    const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / d
    return { k, n, p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), half }
}
const num = (v: number): number => (Number.isNaN(v) ? 0 : v)
const f3 = (v: number): string => (Number.isNaN(v) ? 'n/a' : v.toFixed(3))
const fci = (c: Ci): string => `${f3(c.p)} [${f3(c.lo)}, ${f3(c.hi)}] (${c.k}/${c.n})`

// ---- prepared lore sets ----
interface Prepared {
    set: LoreSet
    store: LoreIndexStore
    hashCalls: { n: number }
    keys: string[][]
    buildMs: number
}

function drainScheduler(queue: Array<() => void>): void {
    while (queue.length > 0) queue.shift()!()
}

function prepare(set: LoreSet): Prepared {
    const queue: Array<() => void> = []
    const hashCalls = { n: 0 }
    const store = createLoreIndexStore({
        hash: (c) => {
            hashCalls.n++
            return pickHashRand(5555, c)
        },
        schedule: (run) => { queue.push(run) },
        now: () => performance.now(),
    })
    const view = { entries: set.entries, characterCount: set.entries.length, chatCount: 0, moduleOwners: [] as string[] }
    const t0 = performance.now()
    if (store.ensure(OWNER_KEY, view) !== null) throw new Error('a fresh store cannot be ready')
    drainScheduler(queue)
    const buildMs = performance.now() - t0
    if (store.ensure(OWNER_KEY, view) === null) throw new Error('the index did not become ready')
    const keys = set.entries.map((e) => e.key.split(',').map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0))
    return { set, store, hashCalls, keys, buildMs }
}

// ---- turns ----
interface TurnSpec { kind: 'para' | 'none', stratum: Stratum | null, tier: ChatTier | null, set: number, target: number, text: string, overlap: number }

function makeTurn(sets: LoreSet[], seed: number, lang: Lang, kind: 'para' | 'none', i: number): TurnSpec {
    const r = rng(GEN.turnSeed(seed, lang, kind, i))
    const si = i % sets.length
    const set = sets[si]
    if (kind === 'none') {
        const chat = GEN.genChitchat(set, r)
        return { kind, stratum: null, tier: chat.tier, set: si, target: -1, text: chat.text, overlap: 0 }
    }
    const stratum = GEN.STRATA[i % GEN.STRATA.length]
    for (let attempt = 0; attempt < 120; attempt++) {
        const target = r.pick(set.topic)
        const g = GEN.genParaphrase(set, r, stratum, target)
        const lower = g.text.toLowerCase()
        const key = set.entries[target.index].key.toLowerCase()
        if (lower.includes(key)) continue
        const body = new Set(tokenize(set.entries[target.index].content))
        if (g.synonyms.some((w) => tokenize(w).some((t) => body.has(t)))) continue
        const shared = new Set(tokenize(g.text).filter((t) => body.has(t)))
        if (stratum === 'allude' && shared.size > 0) continue
        const contributing = g.verbatim.filter((w) => tokenize(w).some((t) => shared.has(t))).length
        if (stratum === 'high' && contributing < 2) continue
        if (stratum === 'low' && contributing < 1) continue
        return { kind, stratum, tier: null, set: si, target: target.index, text: g.text, overlap: shared.size }
    }
    throw new Error(`no ${stratum} turn found for set ${si} turn ${i}`)
}

// ---- one send ----
interface TurnResult { kind: 'para' | 'none', stratum: Stratum | null, tier: ChatTier | null, target: number, picks: number[], tokens: number[], ms: number, hashCalls: number, staticExcluded: number, outcome: string }
interface Cfg { tau: number | null, maxPicks: number }
interface Audit { sends: number, neverRecalled: number, staticExcluded: number }

function viewOf(p: Prepared, missed: LoreRecallView['missed']): LoreRecallView {
    return {
        entries: p.set.entries,
        characterCount: p.set.entries.length,
        chatCount: 0,
        moduleOwners: [],
        missed,
        cutForBudget: false,
        loreToken: BUDGET,
        unusedTokens: BUDGET,
        limit: BUDGET,
        linkedIds: new Set<string>(),
        render: async (index) => {
            const text = p.set.entries[index].content
            return { text, tokens: STUB.len(text) }
        },
    }
}

// Every non-folder entry whose keys are absent from the turn is a miss; the never-recall entries are always misses, so the
// static rule is exercised on each of them.
function missedOf(p: Prepared, text: string): LoreRecallView['missed'] {
    const lower = text.toLowerCase()
    const missed = new Map<number, { body: string, decorators: readonly string[] }>()
    p.set.entries.forEach((e, i) => {
        if (e.mode === 'folder') return
        const forced = p.set.never.has(i)
        if (!forced && p.keys[i].some((k) => lower.includes(k))) return
        const deco = p.set.decoratorOf(e)
        missed.set(i, { body: '', decorators: deco ? [deco] : [] })
    })
    return missed
}

async function sendTurn(p: Prepared, turn: TurnSpec, text: string, cfg: Cfg, audit: Audit): Promise<TurnResult> {
    const query = loreQueryOf([{ role: 'user', data: text } as Message], (m) => ({ sent: m }))
    const view = viewOf(p, missedOf(p, text))
    p.hashCalls.n = 0
    const step = createLoreRecallStep({
        mode: 'inject',
        settings: { loreRecallCap: BUDGET },
        query,
        ownerKey: OWNER_KEY,
        chatKey: 'harness',
        deps: { store: p.store, hash: (c) => { p.hashCalls.n++; return pickHashRand(5555, c) }, now: () => performance.now(), tau: cfg.tau, maxPicks: cfg.maxPicks, maxRenders: 2 * cfg.maxPicks + 2 },
    })
    const t0 = performance.now()
    const picks = [...(await step.run(view))]
    const ms = performance.now() - t0
    const trace = get(chroLoreTrace)
    const result: TurnResult = {
        kind: turn.kind,
        stratum: turn.stratum,
        tier: turn.tier,
        target: turn.target,
        picks,
        tokens: picks.map((i) => STUB.len(p.set.entries[i].content)),
        ms,
        hashCalls: p.hashCalls.n,
        staticExcluded: trace?.candidates.staticExcluded ?? 0,
        outcome: trace?.outcome ?? 'none',
    }
    audit.sends++
    audit.staticExcluded += result.staticExcluded
    assertNoNever(p.set, picks, audit)
    return result
}

function assertNoNever(set: LoreSet, picks: readonly number[], audit: Audit): void {
    for (const i of picks) {
        if (set.never.has(i)) {
            audit.neverRecalled++
            throw new Error(`never-recall entry ${i} (${set.entries[i].key}) was recalled`)
        }
    }
}

async function runTurns(preps: Prepared[], specs: TurnSpec[], cfg: Cfg, audit: Audit): Promise<TurnResult[]> {
    const out: TurnResult[] = []
    for (const s of specs) out.push(await sendTurn(preps[s.set], s, s.text, cfg, audit))
    return out
}

// ---- metrics ----
interface Metrics {
    precPara: Ci
    precAll: Ci
    hit: Record<Stratum | 'highLow', Ci>
    ner: Ci
    nerByTier: Record<ChatTier, Ci>
    tokNone: number
    tokPara: number
}

const hitIn = (r: TurnResult, n: number): boolean => r.picks.slice(0, n).includes(r.target)

function metricsOf(res: TurnResult[], N: number): Metrics {
    let paraPicks = 0, paraCorrect = 0, allPicks = 0
    const hits: Record<Stratum, { k: number, n: number }> = { high: { k: 0, n: 0 }, low: { k: 0, n: 0 }, allude: { k: 0, n: 0 } }
    let noneTurns = 0, noneRecall = 0, noneTok = 0, paraTurns = 0, paraTok = 0
    const tiers: Record<ChatTier, { k: number, n: number }> = { common: { k: 0, n: 0 }, mixed: { k: 0, n: 0 } }
    for (const r of res) {
        const picks = r.picks.slice(0, N)
        const tok = r.tokens.slice(0, N).reduce((a, b) => a + b, 0)
        allPicks += picks.length
        if (r.kind === 'para') {
            paraTurns++
            paraTok += tok
            paraPicks += picks.length
            const hit = hitIn(r, N)
            if (hit) paraCorrect++
            const h = hits[r.stratum!]
            h.n++
            if (hit) h.k++
        } else {
            noneTurns++
            noneTok += tok
            if (picks.length > 0) noneRecall++
            const tr = tiers[r.tier!]
            tr.n++
            if (picks.length > 0) tr.k++
        }
    }
    return {
        precPara: wilson(paraCorrect, paraPicks),
        precAll: wilson(paraCorrect, allPicks),
        hit: {
            high: wilson(hits.high.k, hits.high.n),
            low: wilson(hits.low.k, hits.low.n),
            allude: wilson(hits.allude.k, hits.allude.n),
            highLow: wilson(hits.high.k + hits.low.k, hits.high.n + hits.low.n),
        },
        ner: wilson(noneRecall, noneTurns),
        nerByTier: { common: wilson(tiers.common.k, tiers.common.n), mixed: wilson(tiers.mixed.k, tiers.mixed.n) },
        tokNone: noneTurns ? noneTok / noneTurns : 0,
        tokPara: paraTurns ? paraTok / paraTurns : 0,
    }
}

interface Curves {
    precisionAtK: Ci[]
    hitAtK: Ci[]
    marginal: Ci[]
    ceiling: number[]
    nRule: number
}

// k = 1..MAX_K from a MAX_K-pick run: precision@k over picks inside the first k, hit@k over high plus low turns, and the
// marginal precision of the k-th pick. With one target per turn at most one pick per turn can be right, so precision@k is at
// most 1/k when k picks are made.
function curvesOf(res: TurnResult[]): Curves {
    const para = res.filter((r) => r.kind === 'para')
    const precisionAtK: Ci[] = [], hitAtK: Ci[] = [], marginal: Ci[] = [], ceiling: number[] = []
    for (let k = 1; k <= MAX_K; k++) {
        let picks = 0, correct = 0, hitK = 0, hitN = 0, atRank = 0, rightAtRank = 0
        for (const r of para) {
            const first = r.picks.slice(0, k)
            picks += first.length
            if (first.includes(r.target)) correct++
            if (r.stratum !== 'allude') {
                hitN++
                if (first.includes(r.target)) hitK++
            }
            if (r.picks.length >= k) {
                atRank++
                if (r.picks[k - 1] === r.target) rightAtRank++
            }
        }
        precisionAtK.push(wilson(correct, picks))
        hitAtK.push(wilson(hitK, hitN))
        marginal.push(wilson(rightAtRank, atRank))
        ceiling.push(1 / k)
    }
    let nRule = 0
    while (nRule < MAX_K && num(marginal[nRule].p) >= 0.5) nRule++
    return { precisionAtK, hitAtK, marginal, ceiling, nRule }
}

// ---- tune ----
interface TuneCell { tau: number | null, N: number, perLang: Record<Lang, Metrics> }

// How far a cell is from the O1 recommended rule, summed over both languages: precision below 0.6, no-evidence recall above
// 0.2 and hit rate @N below 0.3 (high plus low turns). Zero means the cell passes.
function shortfall(c: TuneCell): number {
    return LANGS.reduce((acc, l) => {
        const m = c.perLang[l]
        return acc + Math.max(0, RULE_PRECISION - num(m.precPara.p)) + Math.max(0, num(m.ner.p) - RULE_NER) + Math.max(0, RULE_HIT - num(m.hit.highLow.p))
    }, 0)
}

const passesRule = (c: TuneCell): boolean => shortfall(c) === 0

// Tier 1: some cell passes the rule in both languages; take the one with the best weaker-language hit rate. Tier 2: none
// does, so take the cell closest to the rule (smallest shortfall) and say so.
function chooseTune(cells: TuneCell[]): { tier: 1 | 2, choice: TuneCell } {
    const passing = cells.filter(passesRule)
    const hit = (c: TuneCell): number => Math.min(...LANGS.map((l) => num(c.perLang[l].hit.highLow.p)))
    const tokens = (c: TuneCell): number => LANGS.reduce((a, l) => a + c.perLang[l].tokPara, 0)
    const order = (c: TuneCell): number => TAU_GRID.indexOf(c.tau)
    const tail = (a: TuneCell, b: TuneCell): number => hit(b) - hit(a) || tokens(a) - tokens(b) || a.N - b.N || order(a) - order(b)
    if (passing.length > 0) return { tier: 1, choice: [...passing].sort(tail)[0] }
    return { tier: 2, choice: [...cells].sort((a, b) => shortfall(a) - shortfall(b) || tail(a, b))[0] }
}

const tauName = (t: number | null): string => (t === null ? 'null' : String(t))

// ---- report on seed B ----
interface LangReport {
    lang: Lang
    nPara: number
    nNone: number
    capBound: boolean
    metrics: Metrics
    curves: Curves
    prefixMismatch: number
    byStratumOverlap: Record<Stratum, number>
}

const gating = (m: Metrics): Ci[] => [m.precPara, m.precAll, m.hit.highLow, m.hit.high, m.hit.low, m.ner]

function setsOf(seed: number, lang: Lang): LoreSet[] {
    return Array.from({ length: SET_COUNT }, (_, j) => GEN.genLoreSet({ lang, seed: seed * 100 + j }))
}

async function reportSeedB(lang: Lang, cfg: Cfg, N: number, audit: Audit): Promise<LangReport> {
    const sets = setsOf(SEED_B, lang)
    const preps = sets.map(prepare)
    const para: TurnSpec[] = [], none: TurnSpec[] = []
    const runN: TurnResult[] = [], runK: TurnResult[] = []
    const run = async (specs: TurnSpec[]): Promise<void> => {
        runN.push(...await runTurns(preps, specs, cfg, audit))
        runK.push(...await runTurns(preps, specs, { tau: cfg.tau, maxPicks: MAX_K }, audit))
    }
    let n = START_TURNS
    let capBound = false
    // Turns are generated by index, so a longer list extends a shorter one and results are appended, never recomputed.
    let done = 0
    for (;;) {
        const grown: TurnSpec[] = []
        for (let i = done; i < n; i++) {
            const a = makeTurn(sets, SEED_B, lang, 'para', i)
            const b = makeTurn(sets, SEED_B, lang, 'none', i)
            para.push(a)
            none.push(b)
            grown.push(a, b)
        }
        done = n
        await run(grown)
        const m = metricsOf(runN, N)
        if (gating(m).every((c) => c.half <= HALF_WIDTH)) break
        if (n >= CAP_TURNS) {
            capBound = true
            break
        }
        n = Math.min(CAP_TURNS, n + STEP_TURNS)
    }
    const byStratumOverlap: Record<Stratum, number> = { high: 0, low: 0, allude: 0 }
    const counts: Record<Stratum, number> = { high: 0, low: 0, allude: 0 }
    for (const t of para) {
        byStratumOverlap[t.stratum!] += t.overlap
        counts[t.stratum!]++
    }
    for (const s of GEN.STRATA) byStratumOverlap[s] = counts[s] ? byStratumOverlap[s] / counts[s] : 0
    // The N-pick run must equal the first N picks of the MAX_K-pick run (the budget never binds here).
    let prefixMismatch = 0
    runN.forEach((r, i) => {
        if (r.picks.join(',') !== runK[i].picks.slice(0, N).join(',')) prefixMismatch++
    })
    return { lang, nPara: para.length, nNone: none.length, capBound, metrics: metricsOf(runN, N), curves: curvesOf(runK), prefixMismatch, byStratumOverlap }
}

// ---- D1 timing ----
interface D1Row { lang: Lang, entries: number, variant: string, buildMsPer300: { median: number, min: number, max: number }, buildMsTotal: number, scoreMsPerSend: { median: number, p95: number, max: number }, stepMsPerSend: { median: number, p95: number, max: number }, hashCallsPerSend: { mean: number, max: number }, hashUsPerCall: number }

const quantile = (xs: number[], q: number): number => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

async function d1Row(lang: Lang, scale: number, variant: string, opts: { idless?: boolean, equalLength?: boolean }, cfg: Cfg): Promise<D1Row> {
    const set = GEN.genLoreSet({ lang, seed: 880001 + scale, scale, ...opts })
    const reps: number[] = []
    for (let i = 0; i < 12; i++) reps.push(prepare(set).buildMs)
    const prep = prepare(set)
    const audit: Audit = { sends: 0, neverRecalled: 0, staticExcluded: 0 }
    const specs: TurnSpec[] = []
    for (let i = 0; i < 150; i++) specs.push(makeTurn([set], SEED_B, lang, i % 3 === 2 ? 'none' : 'para', i))
    const step: number[] = [], score: number[] = [], hashes: number[] = []
    const view = { entries: set.entries, characterCount: set.entries.length, chatCount: 0, moduleOwners: [] as string[] }
    for (const s of specs) {
        const r = await sendTurn(prep, s, s.text, cfg, audit)
        step.push(r.ms)
        hashes.push(r.hashCalls)
        const ready = prep.store.ensure(OWNER_KEY, view)
        if (!ready) throw new Error('index not ready')
        const t0 = performance.now()
        scoreLoreCandidates(ready.bm25, loreQueryOf([{ role: 'user', data: s.text } as Message], (m) => ({ sent: m })), cfg.tau)
        score.push(performance.now() - t0)
    }
    const probe = set.entries.slice(0, 200).map((e) => e.content)
    const h0 = performance.now()
    for (const c of probe) pickHashRand(5555, c)
    const hashUs = ((performance.now() - h0) / probe.length) * 1000
    const perChunk = reps.map((ms) => (ms / set.entries.length) * 300)
    return {
        lang,
        entries: set.entries.length,
        variant,
        buildMsPer300: { median: quantile(perChunk, 0.5), min: Math.min(...perChunk), max: Math.max(...perChunk) },
        buildMsTotal: quantile(reps, 0.5),
        scoreMsPerSend: { median: quantile(score, 0.5), p95: quantile(score, 0.95), max: Math.max(...score) },
        stepMsPerSend: { median: quantile(step, 0.5), p95: quantile(step, 0.95), max: Math.max(...step) },
        hashCallsPerSend: { mean: hashes.reduce((a, b) => a + b, 0) / hashes.length, max: Math.max(...hashes) },
        hashUsPerCall: hashUs,
    }
}

// ---- output ----
function outDir(): string {
    const dir = process.env.LTM_S4_OUT
    if (!dir) throw new Error('LTM_S4_OUT is not set')
    const abs = path.resolve(dir)
    const tmp = path.resolve(os.tmpdir()) + path.sep
    if (!(abs + path.sep).toLowerCase().startsWith(tmp.toLowerCase())) throw new Error('LTM_S4_OUT must lie under the temp folder')
    fs.mkdirSync(abs, { recursive: true })
    return abs
}

describe('S4 lore recall usefulness gate and D1 timing', () => {
    test('G0: the generator has the plan composition, the keys never appear in a turn and the never-recall assertion bites', () => {
        for (const lang of LANGS) {
            const set = GEN.genLoreSet({ lang, seed: 123 })
            expect(set.entries.length).toBe(300)
            expect(set.topic.length).toBe(200)
            expect(set.never.size).toBe(50)
            for (const i of set.never) expect(set.entries[i].content === '' || set.entries[i].mode !== 'normal' || set.entries[i].selective || set.entries[i].useRegex === true || set.entries[i].content.startsWith('@@') || !set.entries[i].key.replace(/,/g, '').trim()).toBe(true)
            for (let i = 0; i < 60; i++) {
                const t = makeTurn([set], 5, lang, 'para', i)
                expect(t.text.toLowerCase()).not.toContain(set.entries[t.target].key.toLowerCase())
            }
        }
        const set = GEN.genLoreSet({ lang: 'en', seed: 123 })
        const audit: Audit = { sends: 0, neverRecalled: 0, staticExcluded: 0 }
        expect(() => assertNoNever(set, [[...set.never][0]], audit)).toThrow(/never-recall/)
        expect(() => assertNoNever(set, [set.topic[0].index], audit)).not.toThrow()
    })

    test('G1: the never-recall assertion bites on the real engine when the exclusion inputs are neutralised', async () => {
        const base = GEN.genLoreSet({ lang: 'en', seed: 123 })
        // Every never-recall entry becomes a plain normal entry with a real key, so no rule keeps it out of recall.
        const entries = base.entries.map((e, i) => (base.never.has(i) ? { ...e, mode: 'normal', selective: false, useRegex: false, alwaysActive: false, key: e.comment, content: e.content.replace(/^@@.*\n/, '') || base.entries[0].content } : e))
        const plain: LoreSet = { ...base, entries, decoratorOf: () => null }
        const prep = prepare(plain)
        const audit: Audit = { sends: 0, neverRecalled: 0, staticExcluded: 0 }
        const bait = base.topic.slice(0, 40).map((t): TurnSpec => ({ kind: 'para', stratum: 'high', tier: null, set: 0, target: t.index, text: `Tell me again about ${t.attrs.ruler} and ${t.attrs.creature}, ${t.attrs.event}.`, overlap: 0 }))
        let thrown = ''
        try {
            await runTurns([prep], bait, { tau: null, maxPicks: 5 }, audit)
        } catch (e) {
            thrown = (e as Error).message
        }
        expect(thrown).toMatch(/never-recall/)
        expect(audit.neverRecalled).toBeGreaterThan(0)
        // The same turns against the real never-recall entries recall none of them.
        const real = prepare(base)
        const clean: Audit = { sends: 0, neverRecalled: 0, staticExcluded: 0 }
        await runTurns([real], bait, { tau: null, maxPicks: 5 }, clean)
        expect(clean.neverRecalled).toBe(0)
        expect(clean.staticExcluded).toBeGreaterThan(0)
    })

    test('G2: the Wilson interval matches known values', () => {
        const c = wilson(50, 100)
        expect(c.lo).toBeCloseTo(0.4038, 3)
        expect(c.hi).toBeCloseTo(0.5962, 3)
        expect(c.half).toBeCloseTo(0.0962, 3)
        const z = wilson(0, 400)
        expect(z.lo).toBe(0)
        expect(z.hi).toBeCloseTo(0.0095, 3)
        expect(wilson(0, 0).half).toBe(Number.POSITIVE_INFINITY)
    })

    test('S4 gate: tune on seed A, report on seed B, D1', async () => {
        const out = outDir()
        const audit: Audit = { sends: 0, neverRecalled: 0, staticExcluded: 0 }
        const started = Date.now()

        // Tune: for each tau one MAX_K-pick run, read at every N by prefix (the budget never binds, so this equals a run at N).
        const tuneRuns = new Map<string, Record<Lang, TurnResult[]>>()
        const tuneCurves = new Map<string, Record<Lang, Curves>>()
        for (const lang of LANGS) {
            const sets = setsOf(SEED_A, lang)
            const preps = sets.map(prepare)
            const specs: TurnSpec[] = []
            for (let i = 0; i < TUNE_TURNS; i++) {
                specs.push(makeTurn(sets, SEED_A, lang, 'para', i))
                specs.push(makeTurn(sets, SEED_A, lang, 'none', i))
            }
            for (const tau of TAU_GRID) {
                const res = await runTurns(preps, specs, { tau, maxPicks: MAX_K }, audit)
                const key = tauName(tau)
                tuneRuns.set(key, { ...(tuneRuns.get(key) ?? ({} as Record<Lang, TurnResult[]>)), [lang]: res })
                tuneCurves.set(key, { ...(tuneCurves.get(key) ?? ({} as Record<Lang, Curves>)), [lang]: curvesOf(res) })
            }
        }
        const cells: TuneCell[] = []
        for (const tau of TAU_GRID) for (const N of N_GRID) {
            const runs = tuneRuns.get(tauName(tau))!
            cells.push({ tau, N, perLang: { en: metricsOf(runs.en, N), ko: metricsOf(runs.ko, N) } })
        }
        const { tier, choice } = chooseTune(cells)
        const cfg: Cfg = { tau: choice.tau, maxPicks: choice.N }

        // Report on the fresh seed B.
        const report: LangReport[] = []
        for (const lang of LANGS) report.push(await reportSeedB(lang, cfg, choice.N, audit))

        // D1 at 300 and 3000 entries, with the tuned settings.
        const d1: D1Row[] = []
        for (const lang of LANGS) {
            d1.push(await d1Row(lang, 1, 'mixed ids', {}, cfg))
            d1.push(await d1Row(lang, 10, 'mixed ids', {}, cfg))
            d1.push(await d1Row(lang, 10, 'no ids', { idless: true }, cfg))
            d1.push(await d1Row(lang, 10, 'no ids, equal length', { idless: true, equalLength: true }, cfg))
        }

        expect(audit.neverRecalled).toBe(0)
        for (const r of report) expect(r.prefixMismatch).toBe(0)

        const result = {
            procedure: { seedA: SEED_A, seedB: SEED_B, setsPerLanguage: SET_COUNT, tauGrid: TAU_GRID, nGrid: N_GRID, tuneTurnsPerKind: TUNE_TURNS, halfWidth: HALF_WIDTH, capTurnsPerKind: CAP_TURNS, tuneRule: { precision: RULE_PRECISION, noEvidenceRecall: RULE_NER, hitRate: RULE_HIT }, budget: BUDGET, placeholders: { tau: LORE_TAU, maxPicks: LORE_MAX_PICKS, maxRenders: LORE_MAX_RENDERS } },
            tune: { tier, chosen: { tau: choice.tau, N: choice.N, perLang: choice.perLang }, grid: cells.map((c) => ({ ...c, shortfall: shortfall(c) })), curves: Object.fromEntries(tuneCurves) },
            report,
            d1,
            audit: { ...audit, neverRecallSetSizePerSet: 50 },
            elapsedMs: Date.now() - started,
        }
        fs.writeFileSync(path.join(out, 'harness-results.json'), JSON.stringify(result, null, 2) + '\n')
        fs.writeFileSync(path.join(out, 'harness-results.md'), renderMarkdown(cells, tier, choice, report, d1, audit, tuneCurves))
    }, 3_600_000)
})

function renderMarkdown(cells: TuneCell[], tier: 1 | 2, choice: TuneCell, report: LangReport[], d1: D1Row[], audit: Audit, tuneCurves: Map<string, Record<Lang, Curves>>): string {
    const L: string[] = []
    const row = (...c: string[]): void => { L.push('| ' + c.join(' | ') + ' |') }
    const head = (...c: string[]): void => { row(...c); row(...c.map(() => '---')) }
    L.push('# S4 lore recall usefulness gate (synthetic, seed A tune, seed B report)', '')
    L.push(`Seeds: tune ${SEED_A}, report ${SEED_B}; ${SET_COUNT} lore sets of 300 entries per language and seed (200 topic in 100 distractor pairs, 50 filler, 50 never-recall). Placeholders in src: tau ${LORE_TAU}, N ${LORE_MAX_PICKS}, R ${LORE_MAX_RENDERS}.`, '')
    L.push(`Never-recall assertion: ${audit.sends} sends, ${audit.neverRecalled} never-recall entries recalled. Static-rule rejections of ranked candidates across all sends: ${audit.staticExcluded} (the exclusion rules were exercised).`, '')
    L.push('## Tune (seed A)', '')
    L.push(`Tune result tier ${tier}. Tier 1: some cell meets the O1 recommended rule in both languages (precision >= ${RULE_PRECISION}, no-evidence recall <= ${RULE_NER}, hit rate @N on high plus low turns >= ${RULE_HIT}); the cell with the best weaker-language hit rate wins. Tier 2: no cell meets it, so the cell closest to the rule wins (smallest summed shortfall, then best weaker-language hit rate, fewer tokens, smaller N). The shortfall column is that distance; 0 is a pass.`, '')
    L.push(`**Chosen tau = ${tauName(choice.tau)}, N = ${choice.N}** (R = 2N + 2 = ${2 * choice.N + 2}).`, '')
    head('tau', 'N', 'EN precision', 'EN hit@N hi+lo', 'EN no-evid.', 'KO precision', 'KO hit@N hi+lo', 'KO no-evid.', 'shortfall')
    for (const c of cells) row(tauName(c.tau), String(c.N), f3(c.perLang.en.precPara.p), f3(c.perLang.en.hit.highLow.p), f3(c.perLang.en.ner.p), f3(c.perLang.ko.precPara.p), f3(c.perLang.ko.hit.highLow.p), f3(c.perLang.ko.ner.p), shortfall(c).toFixed(3))
    L.push('', 'N by the A6 rule (largest k whose k-th pick still has marginal precision >= 0.5, contiguous from 1; 0 means the first pick already fails):', '')
    head('tau', 'EN N', 'KO N')
    for (const tau of TAU_GRID) {
        const c = tuneCurves.get(tauName(tau))!
        row(tauName(tau), String(c.en.nRule), String(c.ko.nRule))
    }
    L.push('')
    for (const r of report) {
        const m = r.metrics
        L.push(`## Seed B, ${r.lang.toUpperCase()} (tau ${tauName(choice.tau)}, N ${choice.N})`, '')
        L.push(`n = ${r.nPara} paraphrase turns and ${r.nNone} no-relevant turns. ${r.capBound ? `CAP BOUND at ${CAP_TURNS} turns per kind: not every gating interval reached +/-${HALF_WIDTH}.` : `Every gating interval is within +/-${HALF_WIDTH}.`} Intervals are Wilson 95% (turns treated as independent; targets recur across the ${SET_COUNT} sets). The N-pick run equalled the first N picks of the ${MAX_K}-pick run on all but ${r.prefixMismatch} turns.`, '')
        head('Number', 'Value [95% CI] (k/n)')
        row('Recalled-lore precision, paraphrase turns', fci(m.precPara))
        row('Recalled-lore precision, overall (incl. no-relevant)', fci(m.precAll))
        row('Hit rate @N, high overlap', fci(m.hit.high))
        row('Hit rate @N, low overlap', fci(m.hit.low))
        row('Hit rate @N, high plus low (gating)', fci(m.hit.highLow))
        row('Hit rate @N, allude (reported only)', fci(m.hit.allude))
        row('No-evidence recall rate', fci(m.ner))
        row('No-evidence recall rate, chit-chat with only very common words', fci(m.nerByTier.common))
        row('No-evidence recall rate, chit-chat with at least one mid-frequency word', fci(m.nerByTier.mixed))
        row('Mean recalled tokens per send, no-relevant (approx., stub counter)', m.tokNone.toFixed(1))
        row('Mean recalled tokens per send, paraphrase (approx., stub counter)', m.tokPara.toFixed(1))
        row('Mean shared tokens with the target body (high / low / allude)', `${r.byStratumOverlap.high.toFixed(2)} / ${r.byStratumOverlap.low.toFixed(2)} / ${r.byStratumOverlap.allude.toFixed(2)}`)
        L.push('')
        head('k', 'precision@k [CI]', 'hit@k high+low [CI]', 'marginal precision of k-th pick', 'ceiling 1/k')
        r.curves.precisionAtK.forEach((_, i) => row(String(i + 1), `${f3(r.curves.precisionAtK[i].p)} [${f3(r.curves.precisionAtK[i].lo)}, ${f3(r.curves.precisionAtK[i].hi)}]`, `${f3(r.curves.hitAtK[i].p)} [${f3(r.curves.hitAtK[i].lo)}, ${f3(r.curves.hitAtK[i].hi)}]`, fci(r.curves.marginal[i]), f3(r.curves.ceiling[i])))
        L.push('', `Structural ceiling: with a single target per turn, at most one of the k picks can be the target, so per-entry precision@k is at most 1/k whenever k entries are recalled (0.5 at k = 2, 0.33 at k = 3). Only a send that recalls a single entry can exceed 0.5.`, '')
        const tuned = choice.perLang[r.lang]
        L.push(`Tune-seed values at the chosen settings: precision ${fci(tuned.precPara)}; hit@N high+low ${fci(tuned.hit.highLow)}; no-evidence recall ${fci(tuned.ner)}; tokens no-relevant ${tuned.tokNone.toFixed(1)}, paraphrase ${tuned.tokPara.toFixed(1)}.`, '')
    }
    L.push('## D1 timing (this PC; best-case hardware, see the device rows for the phone)', '')
    head('lang', 'entries', 'variant', 'build ms / 300 (median, min-max)', 'build ms total', 'scoring ms / send (median, p95, max)', 'whole step ms / send (median, p95, max)', 'hash calls / send (mean, max)', 'us / hash call')
    for (const d of d1) row(d.lang, String(d.entries), d.variant, `${d.buildMsPer300.median.toFixed(2)} (${d.buildMsPer300.min.toFixed(2)}-${d.buildMsPer300.max.toFixed(2)})`, d.buildMsTotal.toFixed(1), `${d.scoreMsPerSend.median.toFixed(3)}, ${d.scoreMsPerSend.p95.toFixed(3)}, ${d.scoreMsPerSend.max.toFixed(3)}`, `${d.stepMsPerSend.median.toFixed(3)}, ${d.stepMsPerSend.p95.toFixed(3)}, ${d.stepMsPerSend.max.toFixed(3)}`, `${d.hashCallsPerSend.mean.toFixed(1)}, ${d.hashCallsPerSend.max}`, d.hashUsPerCall.toFixed(1))
    L.push('', 'Spec 9 rows: build within 100 ms per 300 entries, scoring within 10 ms per send. "scoring" is `scoreLoreCandidates` alone; "whole step" is the recall step including the live lookup, hashing and the identity render.', '')
    return L.join('\n') + '\n'
}
