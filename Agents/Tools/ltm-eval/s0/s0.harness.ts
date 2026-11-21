// @vitest-environment node
// Guards for the ChroMemory S0 harness (tokeniser, scorer, corpora, turns, engine simulation, controls, ledger, tune
// selection). Every guard is for new code; there is no pre-fix base. They bite through scratch mutants of the
// directory named by LTM_S0_DIR (default: this folder); the generator directory is its sibling. Corpora come from the
// real generator. Test seeds are never a TUNE, GATE, GATE-R, FALLBACK or FALLBACK-R seed.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const HERE = fileURLToPath(new URL('./', import.meta.url))
const S0 = process.env.LTM_S0_DIR ? path.resolve(process.env.LTM_S0_DIR) : path.resolve(HERE)
const GEN = path.resolve(S0, '..', 'gen')
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..')
const SLOW = 240000
const TEST_SEED = 990001

const imp = async <T>(file: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(file).href)) as T
const s0 = <T>(rel: string): Promise<T> => imp<T>(path.join(S0, rel))
const gen = <T>(rel: string): Promise<T> => imp<T>(path.join(GEN, rel))

// ---- shapes of the modules under test (only what the guards use) ----
type Rng = { (): number; int(n: number): number; pick<T>(a: T[]): T; shuffle<T>(a: T[]): T[]; chance(p: number): boolean }
type Span = { msg: number; start: number; end: number }
type Msg = { id: number; role: string; text: string; name?: string }
type Question = { id: string; category: string; key: string; answer: string | null; staleAnswer: string | null; paraphrase: string; slots: Record<string, unknown>; gold: number[]; stale: number[]; goldSpans: Span[]; staleSpans: Span[]; mergedKU: boolean }
type Chat = { id: string; lang: 'en' | 'ko'; seed: number; i: number; names: { user: string; char: string }; packId: string; nf: { cast: string[]; decoyCast: string[]; subjects: string[]; terms: string[] }; meta: Record<string, number | boolean>; messages: Msg[]; questions: Question[] }
type Overlap = { count: number; units: number; ratio: number }
type Turn = { idx: number; kind: string; qid: string | null; category: string | null; style: string | null; regime: string; lenTarget: number; cueFrac: number; cue: string | null; prefix: string; suffix: string; text: string; query: string; cueInTail: boolean | null; overlap?: Overlap; entities: string[] }
type Profile = { name: string; sample(r: Rng, role: string): number }
type Counter = { kind: string; len(s: string): number }
type Hist = { edges: number[]; counts: number[]; max: number }
type Bm25 = { add(t: string): number; size: number; df(t: string): number; idf(t: string): number; score(t: string): Float64Array; scoreTokens(t: string[]): Float64Array }
type Lexical = {
    tokenize(t: string): string[]
    STOPWORDS: Set<string>
    Bm25Index: new () => Bm25
    rrf(r: number[][], k?: number): number[]
    rrfScores(r: number[][], k?: number): Map<number, number>
    topIdfTerms(i: Bm25, t: string, k: number): string[]
    rareTerms(i: Bm25, t: string, share: number): string[]
    admits(i: Bm25, u: string | string[], q: string[], tau: number | null): boolean
}
type Unit = { rec: number; off: number; text: string }
type Pack = { picks: Unit[]; block: string; T: number; assemble(p: Unit[]): { block: string; T: number } }
type Sim = {
    splitRecord(t: string, L: number): { off: number; text: string }[]
    makeUnits(r: { text: string }[], L: number | null): Unit[]
    trimCosts(c: (i: number) => number, n: number, C: number): { first: number; kept: number[]; sum: number }
    packUnits(a: { order: Unit[]; budget: number; count: (s: string) => number; nameOf: (r: number) => string }): Pack
    makeRoom(a: { keptCosts: number[]; T: number; C: number; F: number; pack: Pack }): { picks: Unit[]; T: number; droppedCount: number; evicted: number }
    recallOf(q: Pick<Question, 'goldSpans' | 'staleSpans'>, units: Unit[], packed: Set<Unit>, first: number): { kept: boolean; hit: boolean | null; staleOnly: boolean | null }
    ChatSim: new (c: Chat, ctr: Counter) => { chat: Chat; costs: Map<number, number> }
    runTurn(sim: object, chat: Chat, turn: Pick<Turn, 'text'>, q: Question | null, settings: Settings, hooks?: Hooks): { baseUnits: boolean; kept?: boolean; engine: Pack; recall: { hit: boolean | null } | null }
    evalChatRecord(c: Chat, ctr: Counter, st: Settings, o: Record<string, unknown>): { rows: unknown[]; kept: Record<string, number>; ask: Agg; allude: Agg }
    engineRanker(sim: unknown, turn: unknown, d0: unknown, scorer: Scorer, st: Settings): number[]
    goldUnitIdx(d0: { units: Unit[]; first: number }, q: Question): number[]
}
type Agg = { n: number; e: number; b: number; bw: number; dl: number }
type Scorer = (index: Bm25, tokens: string[]) => Float64Array
type Settings = Record<string, unknown>
type Hooks = { scorer?: Scorer; ranker?: (turn: { q: Question; cue: string | null; idx: number }, d0: { units: Unit[]; first: number }, scorer: Scorer, st: Settings, ctx: { chat: Chat; sim: unknown }) => number[] }
type CellChat = Record<string, { n: number; e?: number; b?: number; or?: number; oq?: number; nl?: number; bu?: number; rd?: number }>
type Stats = {
    bootstrapDraws(n: number, B: number, seed?: number): Int32Array[]
    resampleRatios(c: { n: number; v: number }[], B: number): Float64Array
    intervals(c: { n: number; v: number }[], B?: number): { point: number; boot: { lo: number; hi: number; width: number }; t: { lo: number; hi: number; se: number; width: number } }
    cellStats(c: CellChat[], B?: number): Record<string, { recall: { point: number; boot: { width: number } }; d: { point: number } }>
    stopRuleMet(c: CellChat[], p?: StopP, B?: number): boolean
    growCell(f: (k: number) => CellChat, p?: StopP, B?: number): { chats: CellChat[]; status: string }
    verdictOf(cells: Record<string, CellChat[]>): { verdict: string; rows: { cell: string; style: string; ok: boolean; borderline: boolean; reportOnly?: boolean }[] }
    outcomeOf(g: Record<string, { chats: CellChat[]; status: string }>): { verdict: string }
    kthSmallest(a: Float64Array, k: number): number
    tQuantile(p: number, df: number): number
    STOP: StopP
    B_CONTROL: number
    B_VERDICT: number
}
type StopP = { minChats: number; minTurns: number; cap: number; step: number; width: number }
type CTest = { cell: string; style: string; control: string; point: number; boot: number; t: number; failConfirmed: boolean; notConfirmed: boolean }
type Controls = {
    controlTests(c: Record<string, CellChat[]>, o?: { B?: number; familywise?: number; m?: number }): { m: number; alpha: number; B: number; tests: CTest[]; invalid: boolean }
    pickDonor(c: { castTokens: Set<string>; cue(cat: string, st: string, excludeKey?: string): string | null }[], i: number, cat: string, st: string, key?: string): { j: number; cue: string; fallback: boolean } | null
    donorEntry(chat: Chat, turns: Pick<Turn, 'kind' | 'qid' | 'category' | 'style' | 'cue'>[]): { castTokens: Set<string>; cue(cat: string, st: string, excludeKey?: string): string | null }
    roundRobin(lists: number[][]): number[]
    oracleQueryHit(sim: unknown, turn: Turn, q: Question, st: Settings, hooks: Hooks | undefined): number | null
    controlArms(sim: unknown, turn: Turn, q: Question, st: Settings, hooks: Hooks | undefined, donor: string): { rand: number; oracleRank: number; oracleQuery: number } | null
    RANDOM_SHUFFLES: number
    RANDOM_SEED: number
}
type Entry = Record<string, unknown>
type Ledger = { recordedSettings: Record<string, string>; entries: Entry[] }
type Attempts = {
    emptyLedger(): Ledger
    recordSettings(l: Ledger, b: string, sha: string): Ledger
    appendDefect(l: Ledger, d: { builder: string; reproducerTest: string; gate2Path: string }): Ledger
    appendOverride(l: Ledger, d: { builder: string; newSettingsSha: string; drawSeed: number; ref: string }): Ledger
    tryAttempt(l: Ledger, e: Entry): { ok: boolean; reason?: string; ledger: Ledger }
    builderState(l: Ledger, b: string): { report: boolean }
}
type GateResult = { status: string; verdict?: string; invalidClass?: string; ledger: Ledger; rows?: unknown; validity?: { m: number; tests: CTest[] }; cellChats?: Record<string, number>; reportOnly?: Record<string, { chats: number; styles: Record<string, { n: number; recall: number }> }>; reportOnlyError?: string; diagnostics?: unknown; diagnosticsError?: string }
type GateOpts = Record<string, unknown>
type Gate = {
    runGateAttempt(o: GateOpts): Promise<GateResult>
    settingsDigest(s: Settings): string
    checkGateArgs(a: { drawSeed: number; builder: string; settings: Settings; kind?: string }): void
    assertGateBuilder(b: string): void
    assertTunePredictsPass(s: Settings): void
    recordSettingsCommand(l: Ledger, a: { builder: string; settings: Settings }): Ledger
    gateVerdictCommand(l: Ledger, b: string): string
    recordOverrideCommand(l: Ledger, a: { builder: string; settings: Settings; drawSeed: number; cap: number; ref: string }): Ledger
    resolveLedgerPath(argv: string[]): string
    defaultLedgerPath(): string
}
type Corpus = {
    drawChat(s: { drawSeed: number; corpus: string; lang: string; i: number }, c?: Record<string, unknown>): Chat
    drawWithReserve(s: { drawSeed: number; corpus: string; lang: string; i: number }, c?: Record<string, unknown>): { chat: Chat; replacements: { index: number; reason: string }[] }
    chatSeed(d: number, c: number, l: number, i: number): number
    derivedSeeds(s: number): { r2: number; r3: number; r4: number }
    assertSeedsDisjoint(extra?: number[]): void
    SEEDS: Record<string, number>
}
type TurnsMod = {
    buildTurns(c: Chat, o: { regime?: string; profile: Profile; lenMode?: string | number }): Turn[]
    overlap(c: unknown, q: unknown, cue: string, e: string[]): Overlap
    capOk(o: { count: number }[]): boolean
    tailOf(t: string, n?: number): string
    chatVocab(c: Chat): { tokens: Set<string>; syllables: Set<string> }
    OVERLAP_CAP: number
    allKey(q: Question): string
}
type ProfileMod = {
    specProfile(k: string): Profile
    histogramSampler(h: Hist): (r: Rng) => number
    realProfileFromAgg(a: unknown): Profile
}
type CounterMod = { loadCounter(k?: string): Promise<Counter>; stubCounter(f?: (s: string) => number): Counter; chatCost(c: Counter, r: Msg): number }
type ReportMod = { assertOutsideRepo(p: string, what: string, roots?: string[]): string; repoRoots(): string[]; writeReport(d: string, r: unknown): string; renderReport(r: unknown): string }
type Select = { selectSettings(ev: (s: Settings, r: string) => unknown, o: Record<string, unknown>): Record<string, unknown>; deltaOf(r: unknown): number; TUNE_CHATS: number; BUDGETS: number[]; RARE_SHARES: number[] }
type Tune = {
    PROCEDURE: Record<string, unknown>
    runTune(o: Record<string, unknown>): Promise<{ settings: Record<string, Record<string, unknown>>; diagnostics: Record<string, { controls: { tests: CTest[] }; d1: D1 }> }>
    summarizeControls(c: { tests: Pick<CTest, 'cell' | 'style' | 'control' | 'failConfirmed' | 'notConfirmed'>[] }): D1
    controlSummaryLines(b: string, s: D1): string[]
    checkTuneArgs(a: { drawSeed: number }): void
    controlErrorRates(o: Record<string, unknown>): Record<string, { oracleRate: number; nullRate: number; familywiseBound: number }>
    writeTuneOutputs(o: Record<string, unknown>): void
}
type D1 = { status: string; failConfirmed: number; cells: Record<string, { status: string; controls: { style: string; control: string; status: string }[] }> }
type Content = { SF: { key: string }[]; KU: { key: string }[]; TRD: { key: string }[]; MM: { key: string }[]; IN: { key: string }[] }
type RngMod = { rng(s: number): Rng }
type Build = { buildChat(c: Record<string, unknown>, o?: Record<string, unknown>): { questions: Record<string, unknown>[]; messages: { text: string; plants?: { start: number; end: number; factIndex: number }[] }[]; nf?: { subjects: string[] } } }
type Turns = { ALLUDE: Record<string, unknown> }

let LEX: Lexical, SIM: Sim, STATS: Stats, CTL: Controls, ATT: Attempts, GATE: Gate, CORPUS: Corpus, TURNS: TurnsMod, PROF: ProfileMod, CNT: CounterMod, REPORT: ReportMod, SEL: Select, TUNE: Tune
let GENRNG: RngMod, BUILD: Build, EN: Content, KO: Content, TEN: Turns, TKO: Turns
let M4en: Chat, M4ko: Chat, NFen: Chat, NFko: Chat
let short: Profile, real: Profile

const FAKE_AGG = {
    messageLength: { byRole: { user: { edges: [0, 100, 500, 2000], counts: [10, 30, 40, 20], max: 5000 }, char: { edges: [0, 500, 2000, 6000, 12000], counts: [5, 20, 50, 25], max: 20000 } } },
    messagesPerChat: { edges: [0, 1, 10, 50], counts: [40, 20, 30, 10] },
}

beforeAll(async () => {
    LEX = await s0<Lexical>('lexical.ts')
    SIM = await s0<Sim>('sim.mjs')
    STATS = await s0<Stats>('stats.mjs')
    CTL = await s0<Controls>('controls.mjs')
    ATT = await s0<Attempts>('attempts.mjs')
    GATE = await s0<Gate>('gate.mjs')
    CORPUS = await s0<Corpus>('corpus.mjs')
    TURNS = await s0<TurnsMod>('turns.mjs')
    PROF = await s0<ProfileMod>('profile.mjs')
    CNT = await s0<CounterMod>('counter.mjs')
    REPORT = await s0<ReportMod>('report.mjs')
    SEL = await s0<Select>('select.mjs')
    TUNE = await s0<Tune>('tune.mjs')
    GENRNG = await gen<RngMod>('lib.mjs')
    BUILD = await gen<Build>('build.mjs')
    EN = await gen<Content>('content_en.mjs')
    KO = await gen<Content>('content_ko.mjs')
    TEN = await s0<Turns>('turns_en.mjs')
    TKO = await s0<Turns>('turns_ko.mjs')
    short = PROF.specProfile('short')
    real = PROF.realProfileFromAgg(FAKE_AGG)
    M4en = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'M4', lang: 'en', i: 0 })
    M4ko = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'M4', lang: 'ko', i: 0 })
    NFen = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'NF-specShort', lang: 'en', i: 0 }, { nOut: 120 })
    NFko = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'NF-specShort', lang: 'ko', i: 0 }, { nOut: 120 })
}, SLOW)

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const stub = () => CNT.stubCounter()
const rec = (n: number, e: number, b = 0): { n: number; e: number; b: number } => ({ n, e, b })
const cellOf = (k: number, f: (i: number) => CellChat): CellChat[] => Array.from({ length: k }, (_, i) => f(i))
// A tiny hand-built chat for the engine guards: message i holds only the word w<i> (plus a long shared tail).
const tinyChat = (n: number, goldMsg: number): { chat: Chat; q: Question } => {
    const messages: Msg[] = Array.from({ length: n }, (_, i) => ({ id: i, role: i % 2 === 0 ? 'user' : 'char', text: `w${i} ` + 'filler '.repeat(8), ...(i % 2 ? { name: 'Bob' } : {}) }))
    const text = messages[goldMsg].text
    const q = { id: 'q', category: 'single_fact', key: 'k', answer: 'a', staleAnswer: null, paraphrase: '', slots: {}, gold: [goldMsg], stale: [], goldSpans: [{ msg: goldMsg, start: 0, end: text.length }], staleSpans: [], mergedKU: false } as Question
    const chat = { id: 'tiny', lang: 'en', seed: 1, i: 0, names: { user: 'Al', char: 'Bob' }, packId: 'en1', nf: { cast: [], decoyCast: [], subjects: [], terms: [] }, meta: {}, messages, questions: [q] } as Chat
    return { chat, q }
}

describe('S0 lexical (spec 5.3)', () => {
    it('L1: the tokeniser edge-case table', () => {
        const t = LEX.tokenize
        expect(t('')).toEqual([])
        expect(t('...!!')).toEqual([])
        expect(t('ＲＯＷＡＮ')).toEqual(['rowan'])
        expect(t('B급')).toEqual(['b', '급'])
        expect(t('A급')).toEqual(['급']) // 'a' is a stopword
        const kk = 'ㅋㅋ'.normalize('NFKC')
        expect(t('ㅋㅋㅋ')).toEqual([kk, kk])
        expect(t('ラーメン')).toEqual(['ラー', 'ーメ', 'メン'])
        expect(t('2025년')).toEqual(['2025', '년'])
        expect(t('😀')).toEqual([])
        expect(t('서울 역')).toEqual(['서울', '역'])
        expect(t('서울역에서')).toEqual(['서울', '울역', '역에', '에서'])
        expect(t('𠀀')).toEqual(['𠀀'])
        expect(t('The Rowan and the Tamsin')).toEqual(['rowan', 'tamsin'])
    })

    it('L2: BM25 equals an independent formula, idf is never negative, empty cases, a repeated query term counts once', () => {
        const docs = ['alpha beta beta gamma', 'beta gamma gamma delta', 'alpha alpha epsilon', 'beta zeta', 'beta eta theta iota', 'kappa lambda']
        const idx = new LEX.Bm25Index()
        for (const d of docs) idx.add(d)
        const toks = docs.map((d) => d.split(' '))
        const avg = mean(toks.map((x) => x.length))
        const oracle = (q: string[]) =>
            toks.map((d) => {
                let s = 0
                for (const term of new Set(q)) {
                    const df = toks.filter((x) => x.includes(term)).length
                    if (!df) continue
                    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5))
                    const c = d.filter((x) => x === term).length
                    s += (idf * c * 2.2) / (c + 1.2 * (0.25 + (0.75 * d.length) / avg))
                }
                return s
            })
        const want = oracle(['beta', 'gamma', 'delta', 'beta'])
        const got = idx.score('beta gamma delta beta')
        want.forEach((w, i) => expect(Math.abs(got[i] - w)).toBeLessThan(1e-12))
        expect(idx.idf('beta')).toBeGreaterThan(0) // df 4 of 6: above N / 2
        expect(idx.idf('beta')).toBeCloseTo(Math.log(1 + 2.5 / 4.5), 12)
        expect(new LEX.Bm25Index().score('x').length).toBe(0)
        expect(Array.from(idx.score('')).every((v) => v === 0)).toBe(true)
        const once = idx.scoreTokens(['beta']), twice = idx.scoreTokens(['beta', 'beta'])
        once.forEach((v, i) => expect(twice[i]).toBe(v))
    })

    it('L3: RRF at k = 60, absent units, ties to the newer unit, topIdfTerms order and the df >= 1 rule', () => {
        const sc = LEX.rrfScores([[7, 3], [3]])
        expect(sc.get(7)).toBeCloseTo(1 / 61, 15)
        expect(sc.get(3)).toBeCloseTo(1 / 62 + 1 / 61, 15)
        expect(LEX.rrf([[5, 9], [9, 5]])).toEqual([9, 5]) // equal scores: the newer unit first
        expect(LEX.rrf([[1], [2]])).toEqual([2, 1])
        const idx = new LEX.Bm25Index()
        for (const d of ['common rare1 common', 'common rare2', 'common mid mid', 'mid']) idx.add(d)
        // rare1, rare2 df 1; mid df 2; common df 3; unseen has df 0
        expect(LEX.topIdfTerms(idx, 'unseen common mid rare2 rare1', 3)).toEqual(['rare2', 'rare1', 'mid'])
        expect(LEX.topIdfTerms(idx, 'unseen unseen2 common', 5)).toEqual(['common'])
        expect(LEX.topIdfTerms(idx, 'rare2 rare1', 2)).toEqual(['rare2', 'rare1']) // equal idf: first position first
    })

    it('L4: admits at N = 3 with tau .01 (the max(1, .) case) and with admission off', () => {
        const idx = new LEX.Bm25Index()
        for (const d of ['one two', 'two three', 'four']) idx.add(d)
        expect(LEX.admits(idx, 'one x', ['one'], 0.01)).toBe(true) // df 1 <= max(1, floor(.03))
        expect(LEX.admits(idx, 'two x', ['two'], 0.01)).toBe(false) // df 2
        expect(LEX.admits(idx, 'two x', ['two'], null)).toBe(true)
        expect(LEX.admits(idx, ['four'], ['one'], 0.01)).toBe(false)
    })

    it('TC: tsc accepts s0/lexical.ts (diagnostic)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-tsc-'))
        const cfg = path.join(dir, 'tsconfig.json')
        fs.writeFileSync(cfg, JSON.stringify({ compilerOptions: { target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true, lib: ['es2023'], types: [] }, files: [path.join(S0, 'lexical.ts')] }))
        const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', cfg], { encoding: 'utf8' })
        fs.rmSync(dir, { recursive: true, force: true })
        expect(r.stdout + r.stderr).toBe('')
        expect(r.status).toBe(0)
    }, 120000)
})

describe('S0 generator, corpora, profiles', () => {
    const buildCfg = (lang: 'en' | 'ko') => ({ id: lang + '1', mod: lang === 'en' ? EN : KO, pack: lang + '1', seed: TEST_SEED + 7, N: 700 })
    const stripLeak = (qs: Record<string, unknown>[]) => qs.map((q) => ({ ...q, answer_in_other_messages: 0 }))

    it('G1: the same seed pairs M4 and NF: questions, gold, stale and answers are deep-equal', () => {
        for (const lang of ['en', 'ko'] as const) {
            const a = BUILD.buildChat(buildCfg(lang), { emitSlots: true, emitPlantSpans: true })
            const b = BUILD.buildChat(buildCfg(lang), { emitSlots: true, emitPlantSpans: true, namedFiller: true })
            expect(stripLeak(b.questions)).toEqual(stripLeak(a.questions))
            expect(b.messages.map((m) => m.text)).not.toEqual(a.messages.map((m) => m.text))
        }
    })

    it('G2: NF puts subject names into at least 2% of the messages', () => {
        for (const lang of ['en', 'ko'] as const) {
            const nf = BUILD.buildChat(buildCfg(lang), { emitPlantSpans: true, namedFiller: true })
            const m4 = BUILD.buildChat(buildCfg(lang), { emitPlantSpans: true })
            // fact subjects other than the user and the character, whose names are in every message anyway
            const subjects = (nf.nf as { subjects: string[]; cast: string[] }).subjects.filter((s) => !(nf.nf as { cast: string[] }).cast.slice(0, 2).includes(s))
            expect(subjects.length).toBeGreaterThan(3)
            const share = (b: typeof nf) => mean(subjects.map((s) => b.messages.filter((m) => m.text.includes(s)).length / b.messages.length))
            expect(share(nf)).toBeGreaterThanOrEqual(0.02)
            expect(share(m4)).toBeLessThan(0.02)
        }
    })

    it('G3: plant spans slice out the planted sentence, before and after the merge', () => {
        const check = (chat: Chat) => {
            let n = 0
            for (const q of chat.questions) {
                if (!['single_fact', 'knowledge_update'].includes(q.category) || !q.answer) continue
                for (const sp of q.goldSpans) {
                    const text = chat.messages[sp.msg].text
                    const slice = text.slice(sp.start, sp.end)
                    expect(slice.toLowerCase()).toContain(q.answer.toLowerCase())
                    expect(sp.start === 0 || /\s/.test(text[sp.start - 1])).toBe(true)
                    expect(sp.end === text.length || /\s/.test(text[sp.end])).toBe(true)
                    n++
                }
            }
            expect(n).toBeGreaterThan(10)
        }
        check(M4en)
        check(M4ko)
        check(NFen)
        check(NFko)
        const merged = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'NF-real', lang: 'en', i: 1 }, { profiles: { real } })
        check(merged)
    })

    it('G4: a floor and extension instead of a skip, reserve replacement reported, more than 5% replacements is INVALID', async () => {
        const flat = PROF.realProfileFromAgg({ messageLength: { byRole: { user: { edges: [40, 41], counts: [1, 0], max: 40 }, char: { edges: [40, 41], counts: [1, 0], max: 40 } } }, messagesPerChat: FAKE_AGG.messagesPerChat })
        const c = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'NF-real', lang: 'en', i: 2 }, { profiles: { real: flat } })
        expect(c.meta.floorFlag).toBe(true)
        expect(c.meta.Nout as number).toBeGreaterThan(60)
        expect(c.meta.factor as number).toBeGreaterThanOrEqual(1)
        expect(c.messages.length).toBe(c.meta.Nout)
        // a non-length throw is replaced from the reserve sequence and reported with its reason
        const target = CORPUS.chatSeed(TEST_SEED, 0, 0, 0)
        const thrower = (cfg: { seed: number }, o?: Record<string, unknown>) => {
            if (cfg.seed === target) throw new Error('terms')
            return BUILD.buildChat(cfg as never, o)
        }
        const r = CORPUS.drawWithReserve({ drawSeed: TEST_SEED, corpus: 'M4', lang: 'en', i: 0 }, { build: thrower })
        expect(r.replacements).toEqual([{ index: 0, reason: 'terms' }])
        expect(r.chat.i).toBe(10000)
        // more than 5% replacements in a cell is an INVALID EXPERIMENT (class GENERATOR)
        const settings: Settings = { builder: 'rare', C: 4096, L: null, rareShare: 0.01, budget: 600, queries: 1, tau: null, F: 2, tuneDrawSeed: 510001 }
        settings.sha256 = GATE.settingsDigest(settings)
        const ledger = ATT.recordSettings(ATT.emptyLedger(), 'rare', settings.sha256 as string)
        const every3 = (cfg: { seed: number }, o?: Record<string, unknown>) => {
            if (cfg.seed % 3 === 0) throw new Error('terms')
            return BUILD.buildChat(cfg as never, o)
        }
        const res = await GATE.runGateAttempt({ builder: 'rare', kind: 'FIRST', drawSeed: TEST_SEED, seedFamily: 'GATE', settings, ledger, counter: stub(), profiles: {}, cells: [{ corpus: 'M4', lang: 'en' }], stop: { minChats: 4, minTurns: 1, cap: 4, step: 4, width: 9 }, build: every3, controlsB: 2000 })
        expect(res.status).toBe('INVALID')
        expect(res.invalidClass).toBe('GENERATOR')
    }, SLOW)

    it('R1: a made-up 4-bucket histogram is sampled by bucket share and inside its buckets; the spec median holds', () => {
        const h = { edges: [0, 100, 500, 2000], counts: [10, 30, 40, 20], max: 5000 }
        const samp = PROF.histogramSampler(h)
        const r = GENRNG.rng(1)
        const xs = Array.from({ length: 20000 }, () => samp(r))
        const bucket = (v: number) => (v < 100 ? 0 : v < 500 ? 1 : v < 2000 ? 2 : 3)
        const share = [0, 0, 0, 0]
        for (const v of xs) share[bucket(v)] += 1 / xs.length
        ;[0.1, 0.3, 0.4, 0.2].forEach((p, i) => expect(Math.abs(share[i] - p)).toBeLessThan(0.01))
        expect(Math.max(...xs)).toBeLessThanOrEqual(5000)
        const expectedMean = 0.1 * 50 + 0.3 * 300 + 0.4 * 1250 + 0.2 * 3500
        expect(Math.abs(mean(xs) - expectedMean) / expectedMean).toBeLessThan(0.05)
        const lg = PROF.specProfile('long')
        const ys = Array.from({ length: 20000 }, () => lg.sample(r, 'char')).sort((a, b) => a - b)
        expect(Math.abs(ys[10000] - 1000) / 1000).toBeLessThan(0.05)
    })

    it('R2: the merge yields exactly N_out messages, the text is the source with the drawn joiners, KU merges are flagged', () => {
        const c = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'NF-real', lang: 'en', i: 3 }, { profiles: { real } })
        const seed = c.seed
        const src = BUILD.buildChat({ id: c.packId, mod: EN, pack: c.packId, seed, N: c.meta.Nsrc as number }, { namedFiller: true, emitSlots: true, emitPlantSpans: true })
        expect(c.messages.length).toBe(c.meta.Nout)
        const all = c.messages.map((m) => m.text).join('')
        let at = 0
        const gaps = new Set<string>()
        src.messages.forEach((m, k) => {
            const j = all.indexOf(m.text, at)
            expect(j).toBeGreaterThanOrEqual(at)
            if (k > 0) gaps.add(all.slice(at, j))
            at = j + m.text.length
        })
        expect(all.length - at).toBe(0)
        expect(gaps.has(' ')).toBe(true)
        expect(gaps.has('\n\n')).toBe(true)
        for (const g of gaps) expect(['', ' ', '\n\n']).toContain(g)
        // merged KU: huge targets put whole stretches of the source into one message
        const huge = PROF.realProfileFromAgg({ messageLength: { byRole: { user: { edges: [100000], counts: [1], max: 100000 }, char: { edges: [100000], counts: [1], max: 100000 } } }, messagesPerChat: FAKE_AGG.messagesPerChat })
        const m = CORPUS.drawChat({ drawSeed: TEST_SEED, corpus: 'NF-real', lang: 'en', i: 4 }, { profiles: { real: huge }, nOut: 3 })
        const ku = m.questions.filter((q) => q.category === 'knowledge_update')
        expect(ku.some((q) => q.mergedKU)).toBe(true)
        for (const q of ku) expect(q.mergedKU).toBe(q.goldSpans[0].msg === q.staleSpans[0].msg)
    })

    it('R3: repository paths are refused by real path: a dot-dot path, a junction, the main checkout, a case variant, out dir and ledger', () => {
        const roots = REPORT.repoRoots()
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-r3-'))
        const link = path.join(tmp, 'link')
        fs.symlinkSync(HERE, link, 'junction')
        try {
            expect(() => REPORT.assertOutsideRepo(path.join(HERE, '..', '..'), '--real-agg')).toThrow(/repository/)
            expect(() => REPORT.assertOutsideRepo(path.join(HERE, 'not-yet-created', 'out'), 'the out dir')).toThrow(/repository/)
            expect(() => REPORT.assertOutsideRepo(path.join(link, 'gate-attempts.json'), 'the attempt ledger')).toThrow(/repository/)
            expect(() => REPORT.assertOutsideRepo(path.join(link, 'sub', 'x'), 'the out dir')).toThrow(/repository/)
            expect(() => REPORT.assertOutsideRepo(path.join(roots[1], 'anything.json'), '--real-agg')).toThrow(/repository/)
            if (process.platform === 'win32') expect(() => REPORT.assertOutsideRepo(HERE.toUpperCase(), 'the out dir')).toThrow(/repository/)
            expect(() => REPORT.assertOutsideRepo(path.join(tmp, 'ok', 'out'), 'the out dir')).not.toThrow()
        } finally {
            try { fs.rmdirSync(link) } catch { fs.unlinkSync(link) }
            fs.rmSync(tmp, { recursive: true, force: true })
        }
    }, SLOW) // every assertOutsideRepo call spawns git: the default 5 s limit flakes under host load

    it('R4: the default ledger is one fixed path whatever the out dir, an explicit --ledger wins, and it lies outside the repository', () => {
        const a = GATE.resolveLedgerPath(['--draw', '610001', '--settings', 's.json', path.join(os.tmpdir(), 'ltm-out-a')])
        const b = GATE.resolveLedgerPath(['--draw', '610001', '--settings', 's.json', path.join(os.tmpdir(), 'ltm-out-b')])
        expect(a).toBe(b)
        expect(a).toBe(GATE.defaultLedgerPath())
        expect(path.basename(a)).toBe('gate-attempts.json')
        expect(GATE.resolveLedgerPath(['--ledger', 'x.json', path.join(os.tmpdir(), 'ltm-out-a')])).toBe('x.json')
        expect(() => REPORT.assertOutsideRepo(a, 'the attempt ledger')).not.toThrow()
    })

    it('G5: NF-specLong builds at the default N_out in both languages on several seeds, with every invented term unique', () => {
        // drawChat, not drawWithReserve: a reserve replacement would hide a pool that cannot serve a 2000-message chat
        for (const lang of ['ko', 'en'] as const) {
            let beyondBase = 0
            for (const drawSeed of [120001, 120002, 130001]) {
                const c = CORPUS.drawChat({ drawSeed, corpus: 'NF-specLong', lang, i: 0 })
                expect(c.messages.length).toBeGreaterThanOrEqual(2000)
                const terms = c.nf.terms
                expect(new Set(terms).size).toBe(terms.length)
                const base = (lang === 'ko' ? KO : EN) as unknown as { TERM: { onset: string[]; coda: string[] } }
                const baseSize = base.TERM.onset.length * base.TERM.coda.length
                if (terms.length > baseSize) beyondBase++
                // a spill term never contains a base-pool term, so a base term never matches inside it
                const basePool = new Set(base.TERM.onset.flatMap((o) => base.TERM.coda.map((k) => o + k)))
                for (const t of terms) if (!basePool.has(t)) for (const b of basePool) expect(t.includes(b)).toBe(false)
            }
            // the Korean chats need more terms than the base pool holds: the case this guards
            if (lang === 'ko') expect(beyondBase).toBe(3)
        }
        expect(CORPUS.drawWithReserve({ drawSeed: 120001, corpus: 'NF-specLong', lang: 'ko', i: 0 }).replacements).toEqual([])
    }, SLOW)
})

describe('S0 turns', () => {
    it('T1: no turn holds the answer or the stale answer; the query is at most 500 code points; allude covers all 45 keys', () => {
        for (const chat of [M4en, M4ko, NFen, NFko]) {
            const turns = TURNS.buildTurns(chat, { regime: 'POOL', profile: short })
            expect(turns.filter((t) => t.kind === 'fact').length).toBeGreaterThan(40)
            for (const t of turns) {
                expect(Array.from(t.query).length).toBeLessThanOrEqual(500)
                if (t.kind !== 'fact') continue
                const q = chat.questions.find((x) => x.id === t.qid) as Question
                // two answers sit in the wording by construction: an order question names its two events, and an answer that is
                // the user's or the character's own name is in every turn through the speaker names
                const speakers = (chat.names.user + ' ' + chat.names.char).toLowerCase()
                const inWording = (q.key === 'order' && q.category === 'temporal') || speakers.includes((q.answer as string).toLowerCase())
                if (!inWording) expect(t.text.toLowerCase()).not.toContain((q.answer as string).toLowerCase())
                if (q.staleAnswer) expect(t.text.toLowerCase()).not.toContain(q.staleAnswer.toLowerCase())
            }
        }
        const emoji = 'a'.repeat(300) + '😀'.repeat(300) // 600 code points, 900 UTF-16 units: a 500-unit cut would split a pair
        const tail = TURNS.tailOf(emoji, 500)
        expect(Array.from(tail).length).toBe(500)
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(tail)).toBe(false)
        const keys = [...EN.SF, ...EN.KU, ...EN.TRD, ...EN.MM].map((t) => t.key).concat('order', ...EN.IN.map((t) => 'IN.' + t.key)).sort()
        expect(keys.length).toBe(45)
        expect(Object.keys(TEN.ALLUDE).sort()).toEqual(keys)
        expect(Object.keys(TKO.ALLUDE).sort()).toEqual(keys)
        expect([...KO.SF, ...KO.KU, ...KO.TRD, ...KO.MM].map((t) => t.key).concat('order', ...KO.IN.map((t) => 'IN.' + t.key)).sort()).toEqual(keys)
    })

    it('T2: the regimes are paired; DISJOINT filler has df = 0 in the chat corpus; KO DISJOINT syllables are absent from the chat', () => {
        for (const chat of [NFen, NFko]) {
            const a = TURNS.buildTurns(chat, { regime: 'POOL', profile: short })
            const b = TURNS.buildTurns(chat, { regime: 'DISJOINT', profile: short })
            const c = TURNS.buildTurns(chat, { regime: 'SELF', profile: short })
            expect(b.length).toBe(a.length)
            expect(c.length).toBe(a.length)
            const vocab = TURNS.chatVocab(chat)
            let differ = 0
            a.forEach((t, i) => {
                for (const o of [b[i], c[i]]) {
                    expect([o.qid, o.style, o.kind, o.lenTarget, o.cueFrac, o.cue]).toEqual([t.qid, t.style, t.kind, t.lenTarget, t.cueFrac, t.cue])
                }
                if (b[i].prefix !== t.prefix || b[i].suffix !== t.suffix) differ++
                const filler = b[i].prefix + ' ' + b[i].suffix
                if (chat.lang === 'en') for (const tok of filler.toLowerCase().match(/[a-z]+/g) ?? []) expect(vocab.tokens.has(tok)).toBe(false)
                else for (const ch of filler) if (/[가-힣]/.test(ch)) expect(vocab.syllables.has(ch)).toBe(false)
            })
            expect(differ).toBeGreaterThan(a.length / 2)
        }
    })

    const ovChat = (lang: 'en' | 'ko', texts: string[], span: [number, string], extra?: { msg: number; text: string }) => {
        const messages = texts.map((text, id) => ({ id, role: 'user', text }))
        const goldSpans = [{ msg: span[0], start: texts[span[0]].indexOf(span[1]), end: texts[span[0]].indexOf(span[1]) + span[1].length }]
        if (extra) goldSpans.push({ msg: extra.msg, start: texts[extra.msg].indexOf(extra.text), end: texts[extra.msg].indexOf(extra.text) + extra.text.length })
        return { chat: { lang, messages, nf: { cast: ['Tamsin', '하린'], decoyCast: [] } }, q: { goldSpans, staleSpans: [] } }
    }

    it('O1: overlap counts against the plant span per language unit, with a per-turn cap and the union for multi-gold', () => {
        const gold = 'The ferryman named Corvin kept silver coins hidden.'
        const text = `Early sentence about harbor lanterns. ${gold} Later sentence about rain.`
        const { chat, q } = ovChat('en', [text, 'Another message mentions the lighthouse keeper and brass compass.'], [0, gold])
        expect(TURNS.overlap(chat, q, 'Tamsin wondered about the lanterns.', []).count).toBe(0) // in the message, outside the span
        const two = TURNS.overlap(chat, q, 'The ferryman has silver now.', [])
        expect(two.count).toBe(2)
        expect(TURNS.capOk([two])).toBe(false)
        expect(TURNS.capOk([two, ...Array.from({ length: 9 }, () => ({ count: 0 }))])).toBe(false) // a low mean is not the test
        expect(TURNS.capOk([{ count: 1 }, { count: 0 }])).toBe(true)
        const multi = ovChat('en', [text, 'Another message mentions the lighthouse keeper and brass compass.'], [0, gold], { msg: 1, text: 'the lighthouse keeper and brass compass.' })
        expect(TURNS.overlap(multi.chat, multi.q, 'Everyone mentioned the lighthouse tonight.', []).count).toBe(1) // the second span counts
        // KO: eojeol words, function bigrams excluded, entity words count 0
        const filler = Array.from({ length: 20 }, (_, i) => `오늘은 바람이 불었다고 말했다. 번호${i}`)
        const kgold = '서울역에서 약속했다.'
        const k = ovChat('ko', [...filler, `${kgold} 다른 문장이다.`], [20, kgold])
        const ko = (cue: string) => TURNS.overlap(k.chat, k.q, cue, [])
        expect(ko('서울역 소식').count).toBe(1) // a 3-syllable shared word (2 bigrams) counts once
        expect(ko('서울을 보았다').count).toBe(1) // a 2-syllable stem with another particle counts once
        expect(ko('서울역 약속은').count).toBe(2) // two different shared words
        expect(TURNS.capOk([ko('서울역 약속은')])).toBe(false)
        expect(ko('청소했다').count).toBe(0) // shares only a function bigram (df far above 5% of the messages)
        expect(ko('하린이 서울역에서 왔다').count).toBe(1) // the cast name word counts 0
    })
})

describe('S0 engine simulation', () => {
    const settings = (o: Settings = {}): Settings => ({ builder: 'fulltext', C: 100, L: null, budget: 200, queries: 1, tau: null, F: 2, ...o })

    it('P1: trim keeps the newest suffix and the turn, counting lazily', () => {
        const calls: number[] = []
        const costOf = (i: number) => { calls.push(i); return 10 }
        const r = SIM.trimCosts(costOf, 5, 25)
        expect(r.first).toBe(3)
        expect(r.kept).toEqual([10, 10])
        expect(new Set(calls).size).toBeLessThanOrEqual(r.kept.length + 1) // lazy: kept + 1 counts
        expect(calls.length).toBe(new Set(calls).size)
        expect(new Set(calls).has(0)).toBe(false)
        expect(SIM.trimCosts((i) => (i === 2 ? 100 : 5), 3, 50).first).toBe(2) // the turn alone exceeds C and is kept
        const uneven = [30, 5, 5, 5, 5]
        expect(SIM.trimCosts((i) => uneven[i], 5, 25).first).toBe(1) // the newest four fit; the old 30 does not
    })

    it('P2: an oversized top unit is skipped, an assembled overcount drops the lowest-ranked unit, the block is chronological, baselines are newest-first', () => {
        const mk = (rec: number, len: number): Unit => ({ rec, off: 0, text: 'x'.repeat(len) })
        const count = (s: string) => Math.ceil(s.length / 4)
        const nameOf = () => 'N'
        const big = mk(5, 400), small = mk(2, 8)
        const a = SIM.packUnits({ order: [big, small], budget: 60, count, nameOf })
        expect(a.picks).toEqual([small])
        const overcount = (s: string) => Math.ceil(s.length / 4) + 3 * (s.split('\n').length - 1)
        const u = [mk(1, 20), mk(4, 20), mk(3, 20)]
        const lineSum = u.reduce((s, x) => s + overcount(`[#${x.rec}] N: ${x.text}`) + 1, 0) + overcount('Earlier in this chat') + 1
        const b = SIM.packUnits({ order: u, budget: lineSum, count: overcount, nameOf })
        expect(b.picks.length).toBe(2) // the assembled block counted more than the sum of its lines
        expect(b.picks).toEqual([u[0], u[1]]) // the lowest-ranked (last) unit went
        expect(b.T).toBeLessThanOrEqual(lineSum)
        const c = SIM.packUnits({ order: [mk(9, 8), mk(1, 8), mk(5, 8)], budget: 400, count, nameOf })
        expect(c.block.split('\n').slice(1).map((l) => l.slice(0, 4))).toEqual(['[#1]', '[#5]', '[#9]'])
        // baselines: the newest dropped message fits, the oldest does not need to
        const { chat, q } = tinyChat(10, 6)
        const sim = new SIM.ChatSim(chat, stub())
        const r = SIM.runTurn(sim, chat, { text: 'zz '.repeat(30) }, q, settings({ C: 60, budget: 80 }))
        expect(r.kept).toBe(false)
        expect(r.baseUnits).toBe(true)
    })

    it('P3: pieces stay within L and a paragraph, long sentences are hard-cut, coverage is strict, multi-gold needs all, KU stale-only scores 0', () => {
        const t = 'AAA. BBB.\n\nCCC.'
        expect(SIM.splitRecord(t, 20).map((p) => p.text)).toEqual(['AAA. BBB.', 'CCC.'])
        expect(SIM.splitRecord(t, 5).map((p) => p.text)).toEqual(['AAA.', 'BBB.', 'CCC.'])
        const long = 'x'.repeat(25)
        expect(SIM.splitRecord(long, 10).map((p) => Array.from(p.text).length)).toEqual([10, 10, 5])
        for (const p of SIM.splitRecord('Hello there. ' + 'y'.repeat(30) + '. Ok then.\n\nNext para.', 12)) expect(Array.from(p.text).length).toBeLessThanOrEqual(12)
        const units = SIM.makeUnits([{ text: 'one. two. three.' }, { text: 'alpha. beta.' }], 6)
        const span = { msg: 0, start: 0, end: 9 } // 'one. two.' covers two pieces
        const both = new Set(units.filter((u) => u.rec === 0 && u.off < 9))
        expect(both.size).toBe(2)
        expect(SIM.recallOf({ goldSpans: [span], staleSpans: [] }, units, new Set([...both].slice(0, 1)), 2).hit).toBe(false)
        expect(SIM.recallOf({ goldSpans: [span], staleSpans: [] }, units, both, 2).hit).toBe(true)
        const second = { msg: 1, start: 0, end: 12 }
        const onlyFirst = new Set(units.filter((u) => u.rec === 0))
        expect(SIM.recallOf({ goldSpans: [span, second], staleSpans: [] }, units, onlyFirst, 2).hit).toBe(false)
        const staleOnly = SIM.recallOf({ goldSpans: [second], staleSpans: [span] }, units, new Set(units.filter((u) => u.rec === 0)), 2)
        expect(staleOnly.hit).toBe(false)
        expect(staleOnly.staleOnly).toBe(true)
    })

    it('P4: make-room drops the oldest kept messages first and the lowest-ranked pack unit last', () => {
        const assemble = (ps: Unit[]) => ({ block: '', T: 5 * ps.length })
        const pack = { picks: [{ rec: 1, off: 0, text: 'a' }, { rec: 2, off: 0, text: 'b' }, { rec: 3, off: 0, text: 'c' }], block: '', T: 15, assemble } as Pack
        const a = SIM.makeRoom({ keptCosts: [10, 10, 10, 10], T: 15, C: 45, F: 2, pack })
        expect(a.droppedCount).toBe(1)
        expect(a.evicted).toBe(10)
        expect(a.picks.length).toBe(3)
        const b = SIM.makeRoom({ keptCosts: [10, 10, 10, 10], T: 15, C: 45, F: 4, pack })
        expect(b.droppedCount).toBe(0)
        expect(b.picks.map((u) => u.rec)).toEqual([1]) // the floor holds, so the lowest-ranked units go: 40 + 5 <= 45 with one left
    })

    it('P5: a turn whose gold is all in K0 is in neither population; make-room never goes below F kept messages', () => {
        const { chat } = tinyChat(12, 11) // gold in the last message: kept
        const r = SIM.evalChatRecord(chat, stub(), settings({ C: 60, budget: 40 }), { profile: short, turns: [{ kind: 'fact', qid: 'q', style: 'ask', text: 'zz '.repeat(10), cueInTail: true }] })
        expect(r.kept.ask).toBe(1)
        expect(r.rows.length).toBe(0)
        // T never shrinks with the pack here, so the limit stays below the three newest kept messages: the floor binds
        const assemble = () => ({ block: '', T: 75 })
        const pack = { picks: [{ rec: 1, off: 0, text: 'a' }, { rec: 2, off: 0, text: 'b' }], block: '', T: 75, assemble } as Pack
        const m = SIM.makeRoom({ keptCosts: [10, 10, 10, 10, 10], T: 75, C: 100, F: 3, pack })
        expect(5 - m.droppedCount).toBeGreaterThanOrEqual(3)
    })

    it('C1: the app counter is llama3 (38 and 54 on the probe sentences); o200k is the sensitivity counter (37 and 56)', async () => {
        const probe = await s0<{ PROBE: { en: string; ko: string } }>('counter.mjs')
        const l = await CNT.loadCounter()
        expect([l.len(probe.PROBE.en), l.len(probe.PROBE.ko)]).toEqual([38, 54])
        const o = await CNT.loadCounter('o200k')
        expect([o.len(probe.PROBE.en), o.len(probe.PROBE.ko)]).toEqual([37, 56])
    }, SLOW)

    it('C2: a char record costs its tokens + 3 + the name tokens + 1; a user record costs its tokens + 3', () => {
        const c = stub()
        expect(CNT.chatCost(c, { id: 0, role: 'char', text: 'abcd', name: 'xxxxxxxx' })).toBe(1 + 3 + 2 + 1)
        expect(CNT.chatCost(c, { id: 0, role: 'user', text: 'abcd', name: 'xxxxxxxx' })).toBe(1 + 3)
    })

    // ---- the rare-word builder (MC-2661): whole user turn, terms with 1 <= df <= max(1, floor(rareShare x N)) ----
    type RareSim = { d0(first: number, L: number | null): { index: Bm25; units: Unit[]; tokens: string[][] } }
    const w = (i: number) => `w${i} ` + 'filler '.repeat(8)
    const chatN = (n: number, over: Record<number, string> = {}): Chat => ({
        ...tinyChat(1, 0).chat,
        messages: Array.from({ length: n }, (_, i) => ({ id: i, role: i % 2 === 0 ? 'user' : 'char', text: over[i] ?? w(i), ...(i % 2 ? { name: 'Bob' } : {}) })),
        questions: [],
    })
    const longMsg = (i: number) => `head${i} ` + 'filler '.repeat(100) + `tail${i}`
    // Runs engineRanker over D0 = every message of the chat, with a spy scorer that records the tokens of each query.
    const rareRun = (chat: Chat, text: string, st: Settings = {}) => {
        const sim = new SIM.ChatSim(chat, stub())
        const d0 = (sim as unknown as RareSim).d0(chat.messages.length, null)
        const calls: string[][] = []
        const scorer: Scorer = (index, tokens) => {
            calls.push([...tokens])
            return index.scoreTokens(tokens)
        }
        const order = SIM.engineRanker(sim, { text }, d0, scorer, { builder: 'rare', rareShare: 0.01, queries: 1, tau: null, ...st })
        return { calls, order, d0 }
    }
    // chat of 40 records: `filler` has df 40, `w7` df 1, and the limit at share 0.01 is max(1, floor(0.4)) = 1
    const tiny40 = (over: Record<number, string> = {}) => chatN(40, over)
    const tieChat = () => tiny40({ 1: w(1) + ' alpha', 2: w(2) + ' alpha', 3: w(3) + ' alpha', 4: w(4) + ' beta', 5: w(5) + ' beta', 6: w(6) + ' beta', 7: w(7) + ' gamma', 8: w(8) + ' gamma', 9: w(9) + ' gamma', 10: w(10) + ' gamma', 11: w(11) + ' gamma' })

    it('RW1 (MC-2661): the rare query drops a token seen in every record and keeps a token seen once', () => {
        expect(rareRun(tiny40(), 'filler w7').calls[0]).toEqual(['w7'])
    })

    it('RW2 (MC-2661): the df limit is floor(share x N), not ceil', () => {
        const over: Record<number, string> = {}
        for (const i of [10, 11]) over[i] = w(i) + ' pair'
        for (const i of [20, 21, 22]) over[i] = w(i) + ' trio'
        const r = rareRun(chatN(250, over), 'trio pair w5') // 0.01 x 250 = 2.5: limit 2
        expect(r.calls[0]).toContain('pair')
        expect(r.calls[0]).toContain('w5')
        expect(r.calls[0]).not.toContain('trio')
    })

    it('RW3 (MC-2661): the query is the whole turn: a rare token more than 500 code points before its end is kept', () => {
        const text = 'w7 ' + 'filler '.repeat(100)
        expect(Array.from(text).length).toBeGreaterThan(500)
        expect(rareRun(tiny40(), text).calls[0]).toContain('w7')
    })

    it('RW4 (MC-2661): with no qualifying token the whole smallest-df level is kept, and a token absent from the index never counts', () => {
        const r = rareRun(tieChat(), 'zzz gamma beta alpha filler') // df: zzz 0, gamma 5, beta 3, alpha 3, filler 40; limit 1
        expect(r.calls[0]).toEqual(['beta', 'alpha'])
    })

    it('RW5 (MC-2661): no indexed token gives an empty query and the newest-first order', () => {
        const r = rareRun(tiny40(), 'zzz qqq')
        expect(r.calls[0]).toEqual([])
        expect(r.order).toEqual(Array.from({ length: 40 }, (_, i) => 39 - i))
    })

    it('RW6 (MC-2661): with three queries the first is the whole turn and the others are the 500-code-point tails of the two newest earlier messages, all through the rare rule', () => {
        const chat = tiny40({ 38: longMsg(38), 39: longMsg(39) })
        const r = rareRun(chat, 'filler w7', { queries: 3 })
        expect(r.calls.length).toBe(3)
        expect(r.calls[0]).toEqual(['w7'])
        expect(r.calls[1]).toContain('tail39')
        expect(r.calls[1]).not.toContain('head39')
        expect(r.calls[1]).not.toContain('filler')
        expect(r.calls[2]).toContain('tail38')
        expect(r.calls[2]).not.toContain('head38')
    })

    it('RW10 (MC-2661): the rare builder ignores tailChars for every query', () => {
        const chat = tiny40({ 38: longMsg(38), 39: longMsg(39) })
        const plain = rareRun(chat, 'filler w7', { queries: 3 })
        const wide = rareRun(chat, 'filler w7', { queries: 3, tailChars: 1e9 })
        expect(wide.calls).toEqual(plain.calls)
        expect(wide.calls[1]).not.toContain('head39')
        expect(wide.calls[2]).not.toContain('head38')
    })

    it('RW7 (MC-2661): a rare settings object without rareShare is refused', () => {
        const chat = tiny40()
        const sim = new SIM.ChatSim(chat, stub())
        const d0 = (sim as unknown as RareSim).d0(40, null)
        const scorer: Scorer = (index, tokens) => index.scoreTokens(tokens)
        expect(() => SIM.engineRanker(sim, { text: 'w7' }, d0, scorer, { builder: 'rare', queries: 1, tau: null })).toThrow(/rareShare/)
    })

    it('RW8: fulltext and idf keep their token lists and fulltext keeps honouring tailChars', () => {
        const text = 'w7 ' + 'filler '.repeat(100)
        const full = rareRun(tiny40(), text, { builder: 'fulltext' })
        expect(full.calls[0]).toEqual(LEX.tokenize(TURNS.tailOf(text)))
        const idf = rareRun(tiny40(), text, { builder: 'idf', k: 8 })
        expect(idf.calls[0]).toEqual(LEX.topIdfTerms(idf.d0.index, TURNS.tailOf(text), 8))
        const whole = rareRun(tiny40(), text, { builder: 'fulltext', tailChars: 1e9 })
        expect(whole.calls[0]).toEqual(LEX.tokenize(text))
        expect(whole.calls[0]).not.toEqual(full.calls[0])
    })

    it('RW9 (MC-2661): rareTerms keeps query order, dedupes, keeps a whole tie level and returns [] on an empty index', () => {
        const r = rareRun(tieChat(), 'w7')
        const idx = r.d0.index
        expect(LEX.rareTerms(idx, 'w7 w7 filler w3', 0.01)).toEqual(['w7', 'w3'])
        expect(LEX.rareTerms(idx, 'gamma beta alpha', 0.01)).toEqual(['beta', 'alpha'])
        expect(LEX.rareTerms(idx, 'gamma beta alpha', 0.125)).toEqual(['gamma', 'beta', 'alpha']) // limit 5: all three qualify
        expect(LEX.rareTerms(new LEX.Bm25Index(), 'abc', 0.01)).toEqual([])
    })
})

describe('S0 statistics', () => {
    it('ST1: the bootstrap is deterministic, resamples chats whole and shares one stream; the t interval matches a hand formula', () => {
        const a = [{ n: 10, v: 3 }, { n: 10, v: 6 }, { n: 10, v: 5 }, { n: 10, v: 8 }]
        expect(STATS.intervals(a, 4000)).toEqual(STATS.intervals(a, 4000))
        // one shared resample stream: the same series resampled twice, or as another style, gives the same resample values
        expect(Array.from(STATS.resampleRatios(a, 4000))).toEqual(Array.from(STATS.resampleRatios(a, 4000)))
        expect(Array.from(STATS.resampleRatios(a, 4000))).toEqual(Array.from(STATS.resampleRatios(a.map((c) => ({ ...c })), 4000)))
        const flat = STATS.intervals(Array.from({ length: 12 }, () => ({ n: 10, v: 5 })), 4000)
        expect(flat.boot.width).toBe(0)
        expect(flat.t.width).toBe(0)
        const wide = STATS.intervals([{ n: 10, v: 10 }, { n: 10, v: 0 }], 4000)
        expect(wide.boot.width).toBeGreaterThan(0.5)
        // chats of unequal size: whole-chat resampling gives a wide interval, turn-level resampling would not
        const skew = STATS.intervals([{ n: 1, v: 1 }, { n: 99, v: 0 }], 4000)
        expect(skew.boot.width).toBeGreaterThan(0.5)
        // identical styles per turn give identical per-style intervals (one resample stream)
        const cell = cellOf(12, (i) => ({ ask: rec(10, 3 + (i % 5), i % 3), allude: rec(10, 3 + (i % 5), i % 3) }))
        const st = STATS.cellStats(cell)
        expect(st.ask.recall).toEqual(st.allude.recall)
        // t interval against a hand formula (df = 2 has a closed-form quantile)
        const c3 = [{ n: 10, v: 4 }, { n: 20, v: 12 }, { n: 30, v: 9 }]
        const R = 25 / 60
        const ss = (4 - R * 10) ** 2 + (12 - R * 20) ** 2 + (9 - R * 30) ** 2
        const se = Math.sqrt((3 / 2) * ss) / 60
        const p = 0.975
        const crit = (2 * p - 1) / Math.sqrt(2 * p * (1 - p))
        const iv = STATS.intervals(c3, 4000)
        expect(Math.abs(iv.t.lo - (R - crit * se))).toBeLessThan(1e-9)
        expect(Math.abs(iv.t.hi - (R + crit * se))).toBeLessThan(1e-9)
        expect(Math.abs(STATS.tQuantile(0.975, 1) - 12.706204736174694)).toBeLessThan(1e-9)
        expect(Math.abs(STATS.tQuantile(0.975, 11) - 2.200985160082949)).toBeLessThan(1e-6)
    })

    it('ST2: minimums of 12 chats and 120 turns per style, both interval widths for recall and d, the cap, the per-style rule', () => {
        const spread = (i: number) => ({ ask: rec(15, 2 + (i % 3), 0), allude: rec(15, 2 + (i % 3), 0) })
        // constant chats: width 0 from the start; 15 turns per chat reach 120 turns at 8 chats, the 12-chat minimum binds
        expect(STATS.growCell(() => ({ ask: rec(15, 7, 0), allude: rec(15, 7, 0) })).chats.length).toBe(12)
        // 5 turns per chat: 12 chats hold only 60 turns, so the cell keeps growing to 24 chats
        expect(STATS.growCell(() => ({ ask: rec(5, 3, 0), allude: rec(5, 3, 0) })).chats.length).toBe(24)
        // the rule itself holds both minimums: 8 chats of 15 turns (120 turns) and 12 chats of 5 turns (60 turns) do not stop
        expect(STATS.stopRuleMet(cellOf(8, () => ({ ask: rec(15, 7, 0), allude: rec(15, 7, 0) })))).toBe(false)
        expect(STATS.stopRuleMet(cellOf(12, () => ({ ask: rec(5, 3, 0), allude: rec(5, 3, 0) })))).toBe(false)
        expect(STATS.stopRuleMet(cellOf(12, () => ({ ask: rec(15, 7, 0), allude: rec(15, 7, 0) })))).toBe(true)
        // strict width: a width of exactly 0 never satisfies a limit of 0
        const p0 = { ...STATS.STOP, width: 0 }
        expect(STATS.growCell(() => ({ ask: rec(15, 7, 0), allude: rec(15, 7, 0) }), p0).status).toBe('CAP')
        // bootstrap width below the limit but the t width above it keeps going
        const fx = cellOf(12, (i) => spread(i))
        const s = STATS.cellStats(fx)
        const bw = Math.max(s.ask.recall.boot.width, s.allude.recall.boot.width)
        const iv = STATS.intervals(fx.map((c) => ({ n: c.ask.n, v: c.ask.e as number })), 4000)
        expect(iv.boot.width).toBeLessThan(iv.t.width)
        expect(bw).toBeLessThan(iv.t.width)
        expect(STATS.stopRuleMet(fx, { ...STATS.STOP, width: (iv.boot.width + iv.t.width) / 2 })).toBe(false)
        expect(STATS.stopRuleMet(fx, { ...STATS.STOP, width: iv.t.width + 0.01 })).toBe(true)
        // recall widths are tiny but the d width is not
        const dfx = cellOf(12, (i) => ({ ask: rec(15, 7, i % 2 ? 0 : 7), allude: rec(15, 7, i % 2 ? 0 : 7) }))
        expect(STATS.stopRuleMet(dfx, { ...STATS.STOP, width: 0.15 })).toBe(false)
        // the cap gives INCONCLUSIVE, read only after every cell has stopped
        const noisy = (i: number) => ({ ask: rec(10, i % 2 ? 9 : 1, 0), allude: rec(10, i % 2 ? 9 : 1, 0) })
        const capped = STATS.growCell(noisy)
        expect(capped.status).toBe('CAP')
        expect(capped.chats.length).toBe(48)
        const ok = STATS.growCell(() => ({ ask: rec(15, 12, 0), allude: rec(15, 12, 0) }))
        expect(STATS.outcomeOf({ a: ok, b: capped }).verdict).toBe('INCONCLUSIVE')
        expect(() => STATS.outcomeOf({ a: ok, b: { chats: [], status: 'RUNNING' } })).toThrow()
        // ask-only rule (MC-2661): the ask style below 0.5 is a FAIL however well allude does; the converse passes (ST-ASK1a)
        const mixed = cellOf(12, () => ({ ask: rec(15, 3, 0), allude: rec(15, 14, 0) }))
        expect(STATS.verdictOf({ cell: mixed }).verdict).toBe('FAIL')
        expect(STATS.verdictOf({ cell: cellOf(12, () => ({ ask: rec(15, 14, 0), allude: rec(15, 12, 0) })) }).verdict).toMatch(/^PASS/)
    })

    // ---- MC-2661: ask turns gate, allude is computed and reported only ----
    it('ST-ASK1a (MC-2661): a cell whose ask recall passes and whose allude recall fails is a PASS; the allude row is marked report-only', () => {
        const r = STATS.verdictOf({ cell: cellOf(12, () => ({ ask: rec(15, 14, 0), allude: rec(15, 3, 0) })) })
        expect(r.verdict).toMatch(/^PASS/)
        expect(r.rows.find((x) => x.style === 'allude')?.reportOnly).toBe(true)
        expect(r.rows.find((x) => x.style === 'ask')?.reportOnly).not.toBe(true)
    })

    it('ST-ASK1b: a cell whose ask recall fails is a FAIL even when allude passes', () => {
        expect(STATS.verdictOf({ cell: cellOf(12, () => ({ ask: rec(15, 3, 0), allude: rec(15, 14, 0) })) }).verdict).toBe('FAIL')
    })

    it('ST-ASK2 (MC-2661): BORDERLINE reads the ask interval only', () => {
        // allude alternates 15 and 0 of 15: point 0.5 passes, its lower bound does not; ask is constant
        const cell = cellOf(12, (i) => ({ ask: rec(15, 13, 0), allude: rec(15, i % 2 ? 15 : 0, 0) }))
        expect(STATS.verdictOf({ cell }).verdict).toBe('PASS')
    })

    it('ST-ASK3 (MC-2661): the stop rule reads the ask minimum turns and widths only', () => {
        const noisyAllude = (i: number) => ({ ask: rec(15, 7, 0), allude: rec(15, i % 2 ? 15 : 0, 0) })
        expect(STATS.stopRuleMet(cellOf(12, noisyAllude))).toBe(true)
        const fewAllude = () => ({ ask: rec(15, 7, 0), allude: rec(5, 3, 0) })
        expect(STATS.stopRuleMet(cellOf(12, fewAllude))).toBe(true)
        expect(STATS.growCell(fewAllude).chats.length).toBe(12)
    })

    it('RP1 (MC-2661): the report labels allude cell rows and allude validity rows as report-only, never the ask rows', () => {
        const v = STATS.verdictOf({ cell: cellOf(12, () => ({ ask: rec(15, 14, 0), allude: rec(15, 3, 0) })) })
        const test = (style: string) => ({ cell: 'cell', style, control: 'ORACLE-RANK', point: 1, boot: 1, t: 1, threshold: 0.9, failConfirmed: false, notConfirmed: false })
        const md = REPORT.renderReport({ builder: 'rare', seedFamily: 'GATE', attemptNo: 1, drawSeed: 610001, status: 'VALID', verdict: v.verdict, rows: v.rows, provenance: { commit: 'c', diffHash: 'd', node: 'n', counter: 'stub', settingsSha: 's' }, validity: { m: 12, alpha: 0.004, B: 1, rank: 1, tests: [test('ask'), test('allude')] } })
        const lines = md.split('\n')
        const line = (re: RegExp) => lines.find((l) => re.test(l)) as string
        for (const re of [/^- cell allude:/, /^- cell allude ORACLE-RANK:/]) expect(line(re)).toContain('(report-only, MC-2661')
        for (const re of [/^- cell ask:/, /^- cell ask ORACLE-RANK:/]) expect(line(re)).not.toContain('report-only')
    })

    it('ST3+: the gate refuses the tune seed and foreign settings; the tune refuses other seeds; the FALLBACK families are reserved', () => {
        const base: Settings = { builder: 'rare', rareShare: 0.01, tuneDrawSeed: 510001, evidence: { budgetFlag: null, finalFlag: null } }
        base.sha256 = GATE.settingsDigest(base)
        expect(() => GATE.checkGateArgs({ drawSeed: 510001, builder: 'rare', settings: base })).toThrow(/TUNE draw seed/)
        expect(() => GATE.checkGateArgs({ drawSeed: 610001, builder: 'rare', settings: base })).not.toThrow()
        expect(() => GATE.checkGateArgs({ drawSeed: 710001, builder: 'rare', settings: base })).toThrow()
        const foreign: Settings = { builder: 'rare', tuneDrawSeed: 123 }
        foreign.sha256 = GATE.settingsDigest(foreign)
        expect(() => GATE.checkGateArgs({ drawSeed: 610001, builder: 'rare', settings: foreign })).toThrow()
        for (const s of [610001, 620001, 710001, 720001]) expect(() => TUNE.checkTuneArgs({ drawSeed: s })).toThrow()
        expect(() => TUNE.checkTuneArgs({ drawSeed: 510001 })).not.toThrow()
        // ledger: the rare FIRST attempt needs its settings hash recorded; a FALLBACK family never runs
        const SHA = 'a'.repeat(64)
        const e = (o: Entry): Entry => ({ builder: 'rare', kind: 'FIRST', seedFamily: 'GATE', drawSeed: 610001, settingsSha: SHA, harness: { commit: 'c', diffHash: 'd' }, outcome: 'VALID', verdict: 'FAIL', ...o })
        expect(ATT.tryAttempt(ATT.recordSettings(ATT.emptyLedger(), 'rare', SHA), e({})).ok).toBe(true)
        expect(ATT.tryAttempt(ATT.emptyLedger(), e({})).reason).toMatch(/not recorded/)
        expect(ATT.tryAttempt(ATT.recordSettings(ATT.emptyLedger(), 'rare', SHA), e({ seedFamily: 'FALLBACK', drawSeed: 710001 })).ok).toBe(false)
    })

    it('ST4: seeds of TUNE, GATE, GATE-R, FALLBACK and FALLBACK-R, with reserves and derived streams, never collide', () => {
        expect(() => CORPUS.assertSeedsDisjoint()).not.toThrow()
        expect(() => CORPUS.assertSeedsDisjoint([CORPUS.SEEDS.GATE_R])).toThrow(/collision/)
        expect(() => CORPUS.assertSeedsDisjoint([CORPUS.SEEDS.FALLBACK_R])).toThrow(/collision/)
        expect(() => CORPUS.assertSeedsDisjoint([CORPUS.SEEDS.TUNE])).toThrow(/collision/)
        const d = CORPUS.derivedSeeds(CORPUS.chatSeed(610001, 1, 0, 3))
        expect(new Set([d.r2, d.r3, d.r4]).size).toBe(3)
    })
})

describe('S0 attempt ledger', () => {
    const SHA = 'a'.repeat(64)
    const SHA2 = 'b'.repeat(64)
    const ent = (o: Entry = {}): Entry => ({ builder: 'rare', kind: 'FIRST', seedFamily: 'GATE', drawSeed: 610001, settingsSha: SHA, harness: { commit: 'c', diffHash: 'd' }, outcome: 'INVALID', invalidClass: 'CONTROL', ...o })
    const fresh = () => ATT.recordSettings(ATT.emptyLedger(), 'rare', SHA)
    const go = (l: Ledger, o: Entry) => ATT.tryAttempt(l, o)

    it('ST5: the INVALID procedure, caps, first valid attempt final, no verdict number in an INVALID record, the override', () => {
        // an INVALID with no defect entry allows only GATE-R next
        let l = go(fresh(), ent()).ledger
        expect(go(l, ent({ kind: 'NOISE', seedFamily: 'GATE' })).ok).toBe(false)
        expect(go(l, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(true)
        // a DEFECT rerun needs a defect entry (reproducer id and Gate 2 path) and the same seed family
        expect(go(l, ent({ kind: 'DEFECT' })).ok).toBe(false)
        const withDefect = ATT.appendDefect(l, { builder: 'rare', reproducerTest: 'CT1', gate2Path: 'x/gate2.md' })
        expect(() => ATT.appendDefect(l, { builder: 'rare', reproducerTest: '', gate2Path: '' })).toThrow()
        expect(go(withDefect, ent({ kind: 'DEFECT', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(false)
        expect(go(withDefect, ent({ kind: 'DEFECT' })).ok).toBe(true)
        expect(go(withDefect, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(false) // a defect is recorded
        // a NOISE rerun that is INVALID goes to MAINTAINER REPORT; every later attempt is refused, a second NOISE rerun too
        const noise = go(l, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 }))
        expect(ATT.builderState(noise.ledger, 'rare').report).toBe(true)
        expect(go(noise.ledger, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(false)
        expect(go(ATT.appendDefect(noise.ledger, { builder: 'rare', reproducerTest: 'CT1', gate2Path: 'p' }), ent({ kind: 'DEFECT', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(false)
        // a fourth attempt is refused
        let four = go(fresh(), ent()).ledger
        for (let k = 0; k < 2; k++) {
            four = ATT.appendDefect(four, { builder: 'rare', reproducerTest: 'CT1', gate2Path: 'p' })
            const r = go(four, ent({ kind: 'DEFECT' }))
            expect(r.ok).toBe(true)
            four = r.ledger
        }
        const fourth = go(four, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 }))
        expect(fourth.ok).toBe(false)
        // after a valid attempt (PASS, FAIL or INCONCLUSIVE) no further attempt for that builder
        for (const v of ['PASS', 'FAIL', 'INCONCLUSIVE']) {
            const done = go(fresh(), ent({ outcome: 'VALID', verdict: v, invalidClass: undefined })).ledger
            expect(go(done, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(false)
            expect(go(done, ent()).ok).toBe(false)
        }
        // a NOISE rerun with a different settings sha256 is refused
        const changed = ATT.recordSettings(l, 'rare', SHA2)
        expect(go(changed, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001, settingsSha: SHA2 })).ok).toBe(false)
        // no verdict field or number on an INVALID entry; no --verdict on an INVALID attempt
        expect(go(fresh(), ent({ verdict: 'PASS' })).ok).toBe(false)
        expect(go(fresh(), ent({ recall: 0.4 })).ok).toBe(false)
        expect(go(fresh(), ent({ widths: [0.1] })).ok).toBe(false)
        expect(go(fresh(), ent({ controls: [{ cell: 'c', style: 'ask', control: 'NULL', recall: 0.3 }] })).ok).toBe(false)
        expect(go(fresh(), ent({ controls: [{ cell: 'c', style: 'ask', control: 'NULL', point: 0.3, boot: 0.1, t: 0.1, threshold: 0.05, failConfirmed: false, notConfirmed: true, alpha: 0.002 }] })).ok).toBe(true)
        expect(() => GATE.gateVerdictCommand(l, 'rare')).toThrow(/INVALID/)
        // the report-only builders and the FALLBACK families have no ledger line (MC-2661)
        const ft = go(fresh(), ent({ outcome: 'VALID', verdict: 'FAIL', invalidClass: undefined })).ledger
        for (const b of ['idf', 'fulltext']) expect(go(ATT.recordSettings(ft, b, SHA), ent({ builder: b, seedFamily: 'FALLBACK', drawSeed: 710001 })).ok).toBe(false)
        // INCONCLUSIVE is final for its settings; a maintainer-approved larger run is an override with a new procedure block
        const inc = go(fresh(), ent({ outcome: 'VALID', verdict: 'INCONCLUSIVE', invalidClass: undefined })).ledger
        expect(go(inc, ent({ kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001 })).ok).toBe(false)
        expect(() => ATT.appendOverride(inc, { builder: 'rare', newSettingsSha: SHA, drawSeed: 630001, ref: 'MC-1' })).toThrow()
        const ov = ATT.appendOverride(inc, { builder: 'rare', newSettingsSha: SHA2, drawSeed: 630001, ref: 'MC-1' })
        expect(go(ov, ent({ kind: 'FIRST', settingsSha: SHA2 })).ok).toBe(false)
        const big = go(ov, ent({ kind: 'OVERRIDE', seedFamily: 'OVERRIDE', drawSeed: 630001, settingsSha: SHA2, outcome: 'VALID', verdict: 'PASS', invalidClass: undefined }))
        expect(big.ok).toBe(true)
        expect(go(big.ledger, ent({ kind: 'OVERRIDE', seedFamily: 'OVERRIDE', drawSeed: 630001, settingsSha: SHA2 })).ok).toBe(false)
    })
})

describe('S0 validity controls', () => {
    // a cell of chats whose control sums are given per chat: [n, or, oq, nl, bu, rd]
    const mk = (rows: number[][]): CellChat[] => rows.map(([n, or, oq, nl, bu, rd]) => ({ ask: { n, or, oq, nl, bu, rd }, allude: { n, or, oq, nl, bu, rd } }))
    const clean = (k: number) => Array.from({ length: k }, () => [10, 10, 10, 2, 2, 2])
    const find = (r: ReturnType<Controls['controlTests']>, c: string) => r.tests.find((t) => t.control === c && t.style === 'ask') as CTest

    it('CT1: interval controls: NOT CONFIRMED is not INVALID, the final sample decides, Bonferroni, both bounds, a max inside each resample, B_c and the shared stream', () => {
        // (a) an oracle at 0.88 with an interval reaching 0.9 is NOT CONFIRMED; 0.60 with a tight interval is INVALID
        const soft = mk(Array.from({ length: 12 }, (_, i) => [10, i % 2 ? 10 : 7.6, 10, 2, 2, 2]))
        const rs = CTL.controlTests({ c: soft })
        expect(find(rs, 'ORACLE-RANK').notConfirmed).toBe(true)
        expect(rs.invalid).toBe(false)
        const hard = mk(Array.from({ length: 12 }, () => [10, 6, 10, 2, 2, 2]))
        expect(CTL.controlTests({ c: hard }).invalid).toBe(true)
        // (b) NULL: a point 0.07 above the comparator with a lower bound at or below 0.05 is valid; 0.40 tight is INVALID
        const weak = mk(Array.from({ length: 12 }, (_, i) => [10, 10, 10, i % 2 ? 4 : 0, 1, 1]))
        const w = CTL.controlTests({ c: weak })
        expect(find(w, 'NULL').notConfirmed).toBe(true)
        expect(w.invalid).toBe(false)
        expect(CTL.controlTests({ c: mk(Array.from({ length: 12 }, () => [10, 10, 10, 5, 1, 1])) }).invalid).toBe(true)
        // (c) the final sample decides, not the first 12 chats
        const front = [...Array.from({ length: 12 }, () => [10, 5, 10, 2, 2, 2]), ...Array.from({ length: 20 }, () => [10, 10, 10, 2, 2, 2])]
        expect(CTL.controlTests({ c: mk(front) }).invalid).toBe(false)
        const back = [...Array.from({ length: 12 }, () => [10, 10, 10, 2, 2, 2]), ...Array.from({ length: 20 }, () => [10, 5, 10, 2, 2, 2])]
        expect(CTL.controlTests({ c: mk(back) }).invalid).toBe(true)
        // (d) Bonferroni: m = cells x gating styles x 3 (MC-2661), and a bound that excludes at 0.05 but not at 0.05 / m gives no INVALID
        expect(CTL.controlTests({ a: mk(clean(12)), b: mk(clean(12)) }).m).toBe(6)
        expect(CTL.controlTests({ a: mk(clean(12)), b: mk(clean(12)), c: mk(clean(12)), d: mk(clean(12)) }).m).toBe(12)
        const mid = mk([5, 7, 8, 9, 10, 6, 10, 5, 8, 7, 9, 6].map((x) => [10, x, 10, 2, 2, 2]))
        const four = { a: mid, b: mid, c: mid, d: mid }
        expect(CTL.controlTests({ a: mid }, { m: 1 }).tests.some((t) => t.control === 'ORACLE-RANK' && t.failConfirmed)).toBe(true)
        expect(CTL.controlTests(four).invalid).toBe(false)
        // (e) the bootstrap bound excludes the threshold and the t bound does not: no INVALID
        // ten chats at 0.85 and two at 0.1: the bootstrap cannot exceed 0.85, the symmetric t bound reaches past 0.9
        const tight = mk([8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 1, 1].map((x) => [10, x, 10, 2, 2, 2]))
        const rt = CTL.controlTests({ c: tight })
        const orank = find(rt, 'ORACLE-RANK')
        expect(orank.boot).toBeLessThan(0.9)
        expect(orank.t).toBeGreaterThanOrEqual(0.9)
        expect(orank.failConfirmed).toBe(false)
        // (f) baseline and RANDOM with equal points and negatively correlated per-chat values: the bound takes the max inside each resample
        const frac = (i: number) => (i * 0.7919 + 0.13) % 1 // distinct per-chat values, so a tail bound identifies its resamples
        const negs = mk(Array.from({ length: 12 }, (_, i) => [10, 10, 10, 2 + 3 * frac(i), 4 * frac(i), 4 * (1 - frac(i))]))
        const rn = CTL.controlTests({ c: negs })
        const rows = STATS.bootstrapDraws(12, STATS.B_CONTROL)
        const ratios = (key: 'nl' | 'bu' | 'rd') => {
            const out = new Float64Array(rows.length)
            rows.forEach((row, b) => {
                let n = 0, v = 0
                for (const c of row) { n += negs[c].ask.n; v += negs[c].ask[key] as number }
                out[b] = v / n
            })
            return out
        }
        const a = ratios('nl'), b2 = ratios('bu'), c2 = ratios('rd')
        const ref = new Float64Array(a.map((x, i) => x - Math.max(b2[i], c2[i])))
        expect(find(rn, 'NULL').boot).toBe(STATS.kthSmallest(ref, Math.ceil((0.05 / 3) * STATS.B_CONTROL)))
        // (g) B_c = 20000 and its first 4000 resamples are the verdict interval's
        expect(rn.B).toBe(20000)
        const r4 = STATS.bootstrapDraws(12, 4000), r20 = STATS.bootstrapDraws(12, 20000)
        expect(r20.length).toBe(20000)
        for (let i = 0; i < 4000; i += 397) expect(Array.from(r20[i])).toEqual(Array.from(r4[i]))
        const series = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((x) => ({ n: 10, v: x % 10 }))
        const big = STATS.resampleRatios(series, 20000), small = STATS.resampleRatios(series, 4000)
        for (let i = 0; i < 4000; i += 397) expect(big[i]).toBe(small[i])
    })

    // ---- MC-2661: allude controls are computed and reported with the same alpha, and never make an attempt INVALID ----
    const mkAA = (ask: number[][], allude: number[][]): CellChat[] => ask.map(([n, or, oq, nl, bu, rd], i) => {
        const [n2, or2, oq2, nl2, bu2, rd2] = allude[i]
        return { ask: { n, or, oq, nl, bu, rd }, allude: { n: n2, or: or2, oq: oq2, nl: nl2, bu: bu2, rd: rd2 } }
    })
    const alludeBad = () => {
        const cells: Record<string, CellChat[]> = {}
        for (const name of ['a', 'b', 'c', 'd']) cells[name] = mkAA(clean(12), Array.from({ length: 12 }, () => [10, 2, 10, 2, 2, 2]))
        return cells
    }

    it('CT-ASK1 (MC-2661): an allude-only confirmed control failure is reported and never INVALID', () => {
        const r = CTL.controlTests(alludeBad())
        expect(r.invalid).toBe(false)
        expect(r.tests.find((t) => t.style === 'allude' && t.control === 'ORACLE-RANK')?.failConfirmed).toBe(true)
    })

    it('CT-ASK2 (MC-2661): the Bonferroni family is cells x gating styles x 3', () => {
        const r = CTL.controlTests({ a: mk(clean(12)), b: mk(clean(12)), c: mk(clean(12)), d: mk(clean(12)) })
        expect(r.m).toBe(12)
        expect(r.alpha).toBeCloseTo(0.05 / 12, 12)
    })

    it('CT-ASK3: an ask confirmed control failure is still INVALID', () => {
        const bad = mkAA(Array.from({ length: 12 }, () => [10, 6, 10, 2, 2, 2]), clean(12))
        expect(CTL.controlTests({ a: bad, b: mk(clean(12)), c: mk(clean(12)), d: mk(clean(12)) }).invalid).toBe(true)
    })

    it('D1-ASK (MC-2661): the D1 summary shows an allude failure as report-only and counts only gating rows', () => {
        const d1 = TUNE.summarizeControls(CTL.controlTests(alludeBad()))
        expect(d1.status).toBe('PASS')
        expect(d1.failConfirmed).toBe(0)
        const row = d1.cells.a.controls.find((x) => x.style === 'allude' && x.control === 'ORACLE-RANK')
        expect(row?.status).toBe('FAIL-CONFIRMED (report-only)')
        expect(d1.cells.a.status).toBe('PASS')
    })

    const mkSettings = (o: Settings = {}): Settings => ({ builder: 'rare', C: 4096, L: null, k: null, rareShare: 0.01, budget: 600, queries: 1, tau: null, F: 2, tuneDrawSeed: 510001, evidence: { budgetFlag: null, finalFlag: null }, ...o })
    const runV1 = async (hooks: Hooks | undefined, over: Settings = {}, extra: GateOpts = {}) => {
        const settings = mkSettings(over)
        settings.sha256 = GATE.settingsDigest(settings)
        const ledger = ATT.recordSettings(ATT.emptyLedger(), 'rare', settings.sha256 as string)
        return GATE.runGateAttempt({ builder: 'rare', kind: 'FIRST', drawSeed: TEST_SEED, seedFamily: 'GATE', settings, ledger, counter: stub(), profiles: {}, cells: [{ corpus: 'M4', lang: 'en' }], stop: { minChats: 4, minTurns: 20, cap: 12, step: 4, width: 0.15 }, hooks, ...extra })
    }
    const goldFirst = (turn: { q: Question | null }, d0: { units: Unit[]; first: number }) => (turn.q ? SIM.goldUnitIdx(d0, turn.q) : d0.units.map((_, i) => i))

    it('V1: the real pipeline returns PASS, FAIL and INVALID on constructed inputs through the named injection points', async () => {
        // (a) a cue-keyed oracle in the ranker slot: a cue with no entry falls back to the engine order, so NULL stays low
        const table = new Map<string, Map<string, string>>()
        const oracle: Hooks['ranker'] = (turn, d0, scorer, st, ctx) => {
            if (!table.has(ctx.chat.id)) table.set(ctx.chat.id, new Map(TURNS.buildTurns(ctx.chat, { regime: 'POOL', profile: short }).filter((t) => t.cue).map((t) => [t.cue as string, t.qid as string])))
            const qid = table.get(ctx.chat.id)?.get(turn.cue as string)
            const q = qid ? ctx.chat.questions.find((x) => x.id === qid) : undefined
            const engine = SIM.engineRanker(ctx.sim, turn, d0, scorer, st)
            if (!q) return engine
            const g = SIM.goldUnitIdx(d0, q)
            return [...g, ...engine.filter((i) => !g.includes(i))]
        }
        const a = await runV1({ ranker: oracle })
        expect(a.status).toBe('VALID')
        expect(a.verdict).toMatch(/^PASS/)
        // (b) a gold-id cheater in the ranker slot ignores the cue: INVALID by NULL, no verdict
        const b = await runV1({ ranker: (turn, d0) => goldFirst(turn, d0) })
        expect(b.status).toBe('INVALID')
        expect(b.validity?.tests.find((t) => t.control === 'NULL' && t.failConfirmed)).toBeTruthy()
        expect(b.verdict).toBeUndefined()
        // (c) a uniform shuffle in the ranker slot with the real scorer: FAIL, the oracles still pass
        const c = await runV1({ ranker: (turn, d0) => GENRNG.rng(4242 + turn.idx).shuffle(d0.units.map((_, i) => i)) })
        expect(c.status).toBe('VALID')
        expect(c.verdict).toBe('FAIL')
        // (d) a scorer returning 0 in the scorer slot with the real ranker: INVALID by ORACLE-QUERY
        const d = await runV1({ scorer: (index) => new Float64Array(index.size) })
        expect(d.status).toBe('INVALID')
        expect(d.validity?.tests.find((t) => t.control === 'ORACLE-QUERY' && t.failConfirmed)).toBeTruthy()
        expect(d.verdict).toBeUndefined()
        expect(d.rows).toBeUndefined()
        // (e) a budget below the gold piece cost: INVALID by ORACLE-RANK
        const e = await runV1(undefined, { budget: 5 })
        expect(e.status).toBe('INVALID')
        expect(e.validity?.tests.find((t) => t.control === 'ORACLE-RANK' && t.failConfirmed)).toBeTruthy()
        expect(e.verdict).toBeUndefined()
    }, SLOW)

    it('V1: an INVALID run writes, prints and records no engine-arm statistic on verdict cues', async () => {
        const lines: string[] = []
        const r = await runV1({ scorer: (index) => new Float64Array(index.size) }, {}, { log: (m: string) => lines.push(m) })
        expect(r.status).toBe('INVALID')
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-inv-'))
        try {
            const { ledger, ...report } = r as GateResult & { ledger: Ledger }
            REPORT.writeReport(out, report)
            const files = fs.readdirSync(out).map((f) => fs.readFileSync(path.join(out, f), 'utf8')).join('\n')
            const text = files + '\n' + lines.join('\n') + '\n' + JSON.stringify(ledger)
            for (const k of ['"rows"', '"breakdown"', '"nofact"', '"tokens"', '"recall"', '"width"', 'recallCI', 'dCI']) expect(text).not.toContain(k)
            expect(lines.join(' ')).not.toMatch(/recall|width|\bCI\b/i)
            expect(JSON.stringify(ledger)).not.toContain('"verdict"')
        } finally {
            fs.rmSync(out, { recursive: true, force: true })
        }
    }, SLOW)

    it('D1: each control is PASS or FAIL-CONFIRMED per cell, the builder is INVALID when any fails, and the lines carry no statistic', () => {
        const cells = { good: mk(clean(12)), bad: mk(Array.from({ length: 12 }, () => [10, 6, 10, 2, 2, 2])) }
        const s = TUNE.summarizeControls(CTL.controlTests(cells))
        expect(s.status).toBe('INVALID')
        expect(s.cells.good.status).toBe('PASS')
        expect(s.cells.bad.status).toBe('INVALID')
        expect(s.failConfirmed).toBe(1) // gating (ask) rows only (MC-2661)
        const failed = s.cells.bad.controls.filter((c) => c.status === 'FAIL-CONFIRMED')
        expect(failed.map((c) => `${c.style} ${c.control}`)).toEqual(['ask ORACLE-RANK'])
        expect(s.cells.bad.controls.find((c) => c.style === 'allude' && c.control === 'ORACLE-RANK')?.status).toBe('FAIL-CONFIRMED (report-only)')
        expect(s.cells.good.controls.every((c) => c.status === 'PASS')).toBe(true)
        const lines = TUNE.controlSummaryLines('fulltext', s)
        expect(lines).toContain('D1 fulltext good: PASS')
        expect(lines).toContain('D1 fulltext bad: INVALID (ask ORACLE-RANK FAIL-CONFIRMED)')
        expect(lines.some((l) => l.startsWith('D1 fulltext: INVALID, 1 FAIL-CONFIRMED'))).toBe(true)
        expect(lines.join('\n')).not.toMatch(/\d\.\d/)
        const ok = TUNE.summarizeControls(CTL.controlTests({ good: mk(clean(12)) }))
        expect(ok).toMatchObject({ status: 'PASS', failConfirmed: 0 })
        expect(TUNE.controlSummaryLines('idf', ok).pop()).toBe('D1 idf: PASS, 0 FAIL-CONFIRMED control(s)')
    })

    it('TU3 (MC-2661): an INVALID line calls every builder but rare report-only', () => {
        const bad = TUNE.summarizeControls(CTL.controlTests({ bad: mk(Array.from({ length: 12 }, () => [10, 6, 10, 2, 2, 2])) }))
        expect(bad.status).toBe('INVALID')
        expect(TUNE.controlSummaryLines('fulltext', bad).pop()).toMatch(/report-only \(MC-2661\)/)
        expect(TUNE.controlSummaryLines('rare', bad).pop()).toMatch(/do not run it/)
    })

    const oracleRank: NonNullable<Hooks['ranker']> = (turn, d0, scorer, st, ctx) => {
        const qid = TURNS.buildTurns(ctx.chat, { regime: 'POOL', profile: short }).find((t) => t.cue === turn.cue)?.qid
        const q = qid ? ctx.chat.questions.find((x) => x.id === qid) : undefined
        const engine = SIM.engineRanker(ctx.sim, turn, d0, scorer, st)
        if (!q) return engine
        const g = SIM.goldUnitIdx(d0, q)
        return [...g, ...engine.filter((i) => !g.includes(i))]
    }
    // an oracle on the gate cell (a PASS) and a shuffle on every other chat, so a report-only cell that leaked into the verdict would flip it
    const mixed = (seen: string[]): Hooks => ({ ranker: (turn, d0, scorer, st, ctx) => {
        if (ctx.chat.id.startsWith('M4')) return oracleRank(turn, d0, scorer, st, ctx)
        seen.push(ctx.chat.id)
        return GENRNG.rng(4242 + turn.idx).shuffle(d0.units.map((_, i) => i))
    } })
    const REPORT_CELLS = [{ corpus: 'NF-specLong', lang: 'en' }, { corpus: 'NF-specShort', lang: 'en' }]

    it('F5: the ledger holding the verdict is saved before the diagnostics run; a failing diagnostic keeps the verdict', async () => {
        const order: string[] = []
        const saved: Ledger[] = []
        const r = await runV1({ ranker: (turn, d0) => GENRNG.rng(4242 + turn.idx).shuffle(d0.units.map((_, i) => i)) }, {}, {
            onLedger: (l: Ledger) => { order.push('ledger'); saved.push(l) },
            diagnostics: async () => { order.push('diagnostics'); throw new Error('o200k failed') },
        })
        expect(r.status).toBe('VALID')
        expect(r.verdict).toBe('FAIL')
        expect(order).toEqual(['ledger', 'diagnostics'])
        expect(saved[0].entries.find((x) => x.type === 'attempt')).toMatchObject({ outcome: 'VALID', verdict: 'FAIL' })
        expect(r.diagnosticsError).toBe('o200k failed')
    }, SLOW)

    it('F4: NF-specLong and NF-specShort are reported after the verdict is saved and never change it; an INVALID attempt reports none', async () => {
        const extra = (order: string[]): GateOpts => ({ reportOnlyCells: REPORT_CELLS, reportOnlyChats: 2, drawCtx: { nOut: 120 }, onLedger: () => order.push('ledger') })
        const plain = await runV1(mixed([]))
        expect(plain.verdict).toBe('PASS')
        const seen: string[] = []
        const withReport = await runV1(mixed(seen), {}, extra(seen))
        expect(withReport.verdict).toBe('PASS')
        expect(withReport.cellChats).toEqual(plain.cellChats)
        expect(withReport.ledger.entries).toEqual(plain.ledger.entries)
        expect(Object.keys(withReport.reportOnly ?? {})).toEqual(['NF-specLong-en', 'NF-specShort-en'])
        expect(withReport.reportOnly?.['NF-specLong-en'].chats).toBe(2)
        // non-vacuous: a report-only style under 0.5 would fail the verdict were it gated
        const recalls = Object.values(withReport.reportOnly ?? {}).flatMap((c) => Object.values(c.styles).map((s) => s.recall))
        expect(Math.min(...recalls)).toBeLessThan(0.5)
        // the ledger save comes first; every report-only chat was evaluated after it
        expect(seen[0]).toBe('ledger')
        expect(new Set(seen.slice(1))).toEqual(new Set(['NF-specLong-en-0', 'NF-specLong-en-1', 'NF-specShort-en-0', 'NF-specShort-en-1']))
        // an INVALID attempt computes no report-only cell
        const bad = await runV1({ scorer: (index) => new Float64Array(index.size) }, {}, extra([]))
        expect(bad.status).toBe('INVALID')
        expect(bad.reportOnly).toBeUndefined()
        // the report prints the cells under their own heading, apart from the verdict rows
        const md = REPORT.renderReport({ ...withReport, ledger: undefined })
        expect(md).toContain('## Report-only cells')
        expect(md).toContain('NF-specLong-en ask')
    }, SLOW)

    it('F4b: a report-only cell that throws is recorded under its own name, the other cells and the verdict survive, the report prints it', async () => {
        const failKo = (cfg: { mod: { lang: string } }, o?: Record<string, unknown>) => {
            if (cfg.mod.lang === 'ko') throw new Error('boom: ko cell')
            return BUILD.buildChat(cfg as never, o)
        }
        const cells = [{ corpus: 'NF-specLong', lang: 'en' }, { corpus: 'NF-specLong', lang: 'ko' }, { corpus: 'NF-specShort', lang: 'en' }]
        const plain = await runV1(mixed([]))
        const r = await runV1(mixed([]), {}, { reportOnlyCells: cells, reportOnlyChats: 2, drawCtx: { nOut: 120 }, build: failKo })
        expect(r.verdict).toBe(plain.verdict)
        expect(r.reportOnlyError).toBeUndefined()
        const ro = r.reportOnly as unknown as Record<string, { chats?: number; error?: string }>
        expect(Object.keys(ro)).toEqual(['NF-specLong-en', 'NF-specLong-ko', 'NF-specShort-en'])
        expect(ro['NF-specLong-ko'].error).toBe('boom: ko cell')
        expect(ro['NF-specLong-en'].chats).toBe(2)
        expect(ro['NF-specShort-en'].chats).toBe(2)
        const md = REPORT.renderReport({ ...r, ledger: undefined })
        expect(md).toContain('- NF-specLong-ko: failed: boom: ko cell')
        expect(md).toContain('NF-specShort-en ask')
    }, SLOW)

    it('F3: record-override validates, an OVERRIDE run uses the recorded fresh seed and cap, and a protected or other seed is refused', async () => {
        const s0v = mkSettings({})
        s0v.sha256 = GATE.settingsDigest(s0v)
        const s1 = mkSettings({ budget: 700 })
        s1.sha256 = GATE.settingsDigest(s1)
        let l = ATT.recordSettings(ATT.emptyLedger(), 'rare', s0v.sha256 as string)
        l = ATT.tryAttempt(l, { builder: 'rare', kind: 'FIRST', seedFamily: 'GATE', drawSeed: 610001, settingsSha: s0v.sha256, harness: { commit: 'c', diffHash: 'd' }, outcome: 'VALID', verdict: 'INCONCLUSIVE' }).ledger
        const ok = { builder: 'rare', settings: s1, drawSeed: TEST_SEED, cap: 96, ref: 'MC-1' }
        expect(() => GATE.recordOverrideCommand(l, { ...ok, drawSeed: 610001 })).toThrow(/fresh/)
        expect(() => GATE.recordOverrideCommand(l, { ...ok, drawSeed: 510001 })).toThrow(/TUNE/)
        expect(() => GATE.recordOverrideCommand(l, { ...ok, cap: 48 })).toThrow(/larger/)
        expect(() => GATE.recordOverrideCommand(l, { ...ok, settings: s0v })).toThrow(/new settings hash/)
        expect(() => GATE.recordOverrideCommand(l, { ...ok, settings: { ...s1, sha256: 'x' } })).toThrow(/sha256/)
        expect(() => GATE.recordOverrideCommand(ATT.recordSettings(ATT.emptyLedger(), 'rare', s0v.sha256 as string), ok)).toThrow(/INCONCLUSIVE/)
        const ov = GATE.recordOverrideCommand(l, ok)
        expect(ov.entries[ov.entries.length - 1]).toMatchObject({ type: 'override', drawSeed: TEST_SEED, cap: 96, newSettingsSha: s1.sha256 })
        expect(() => GATE.checkGateArgs({ drawSeed: TEST_SEED, builder: 'rare', settings: s1, kind: 'OVERRIDE' })).not.toThrow()
        expect(() => GATE.checkGateArgs({ drawSeed: TEST_SEED, builder: 'rare', settings: s1 })).toThrow(/not a gate seed/)
        expect(() => GATE.checkGateArgs({ drawSeed: 620001, builder: 'rare', settings: s1, kind: 'OVERRIDE' })).toThrow(/fresh/)
        const shuffle: Hooks = { ranker: (turn, d0) => GENRNG.rng(4242 + turn.idx).shuffle(d0.units.map((_, i) => i)) }
        const run = (ledger: Ledger, drawSeed: number) => GATE.runGateAttempt({ builder: 'rare', kind: 'OVERRIDE', drawSeed, settings: s1, ledger, counter: stub(), profiles: {}, cells: [{ corpus: 'M4', lang: 'en' }], stop: { minChats: 4, minTurns: 20, cap: 12, step: 4, width: 0.15 }, hooks: shuffle })
        const wrong = await run(ov, TEST_SEED + 2)
        expect(wrong.status).toBe('REFUSED')
        expect(wrong.reason).toMatch(/seed mismatch/)
        const good = await run(ov, TEST_SEED)
        expect(good.status).toBe('VALID')
        expect(good.ledger.entries.find((x) => x.type === 'attempt' && x.kind === 'OVERRIDE')).toMatchObject({ seedFamily: 'OVERRIDE', drawSeed: TEST_SEED, settingsSha: s1.sha256 })
        expect((await run(good.ledger, TEST_SEED)).status).toBe('REFUSED')
    }, SLOW)

    it('V2: the NULL donor is a cast-disjoint same-category turn in cyclic order with no fixed point, the fallback is counted, RANDOM is a 20-shuffle mean', () => {
        const mkc = (cast: string[]) => ({ castTokens: new Set(cast), cue: (cat: string, st: string) => (cat === 'x' && st === 'ask' ? 'cue of ' + cast.join(',') : null) })
        const cands = [mkc(['a', 'b']), mkc(['b', 'c']), mkc(['x']), mkc(['y'])]
        const donors = cands.map((_, i) => CTL.pickDonor(cands, i, 'x', 'ask'))
        donors.forEach((d, i) => expect(d?.j).not.toBe(i))
        expect(donors[0]).toMatchObject({ j: 2, fallback: false }) // chat 1 shares the cast token b: skipped
        expect(donors[3]).toMatchObject({ j: 0, fallback: false })
        expect(CTL.pickDonor(cands, 0, 'zz', 'ask')).toBeNull()
        const overlapping = [mkc(['a']), mkc(['a']), mkc(['a'])]
        expect(CTL.pickDonor(overlapping, 0, 'x', 'ask')).toMatchObject({ j: 1, fallback: true })
        // RANDOM: the mean over the 20 named streams, recomputed independently
        const settings = { builder: 'fulltext', C: 4096, L: null, budget: 600, queries: 1, tau: null, F: 2 } as Settings
        const sim = new SIM.ChatSim(M4en, stub())
        const turns = TURNS.buildTurns(M4en, { regime: 'POOL', profile: short })
        let arms: ReturnType<Controls['controlArms']> = null
        let q: Question | undefined
        let turn: Turn | undefined
        for (const t of turns) {
            if (t.kind !== 'fact') continue
            q = M4en.questions.find((x) => x.id === t.qid) as Question
            arms = CTL.controlArms(sim, t, q, settings, undefined, 'a donor cue')
            if (arms) { turn = t; break }
        }
        expect(arms).not.toBeNull()
        const again = CTL.controlArms(sim, turn as Turn, q as Question, settings, undefined, 'a donor cue')
        expect(again).toEqual(arms)
        const tr = sim.constructor === Object ? null : (sim as unknown as { trim(t: Turn, C: number): { first: number }; d0(f: number, L: number | null): { units: Unit[] } }).trim(turn as Turn, 4096)
        const d0 = (sim as unknown as { d0(f: number, L: number | null): { units: Unit[] } }).d0((tr as { first: number }).first, null)
        const all = d0.units.map((_, i) => i)
        let sum = 0
        for (let j = 0; j < 20; j++) {
            const order = GENRNG.rng(9101 + j).shuffle(all).map((i) => d0.units[i])
            const pk = SIM.packUnits({ order, budget: 600, count: (s) => stub().len(s), nameOf: (r) => (M4en.messages[r].role === 'char' ? M4en.names.char : M4en.names.user) })
            sum += +(SIM.recallOf(q as Question, d0.units, new Set(pk.picks), (tr as { first: number }).first).hit as boolean)
        }
        expect(arms?.rand).toBeCloseTo(sum / 20, 12)
        expect(CTL.RANDOM_SHUFFLES).toBe(20)
        expect(CTL.RANDOM_SEED).toBe(9101)
    }, SLOW)

    it('MC-2653 ORACLE-QUERY: the per-span lists merge round-robin, so a shared non-gold unit cannot outrank both gold units', () => {
        expect(CTL.roundRobin([[0, 4], [1, 4]])).toEqual([0, 1, 4])
        expect(CTL.roundRobin([[2, 3, 4], [3, 5]])).toEqual([2, 3, 5, 4])
        expect(CTL.roundRobin([])).toEqual([])
        // two gold messages, each its own list's first hit; message 4 (not gold) is second in both lists
        const { chat } = tinyChat(14, 0)
        const q = { ...chat.questions[0], gold: [0, 1], goldSpans: [0, 1].map((m) => ({ msg: m, start: 0, end: chat.messages[m].text.length })) } as Question
        const c2 = { ...chat, questions: [q] } as Chat
        const scorer: Scorer = (index, tokens) => {
            const s = new Float64Array(index.size)
            if (tokens.includes('w0')) { s[0] = 3; s[4] = 2 }
            if (tokens.includes('w1')) { s[1] = 3; s[4] = 2 }
            return s
        }
        const sim = new SIM.ChatSim(c2, stub())
        const turn = { idx: 14, kind: 'fact', qid: 'q', category: 'single_fact', style: 'ask', cue: 'hi', prefix: '', suffix: '', text: 'hi', query: 'hi' } as unknown as Turn
        const settings = { builder: 'fulltext', C: 100, L: null, budget: 50, queries: 1, tau: null, F: 2 } as Settings
        const hooks: Hooks = { scorer }
        expect(CTL.controlArms(sim, turn, q, settings, hooks, 'a donor cue')?.oracleQuery).toBe(1)
        expect(CTL.oracleQueryHit(sim, turn, q, settings, hooks)).toBe(1)
        // a gold-kept turn is in neither population
        expect(CTL.oracleQueryHit(sim, turn, q, { ...settings, C: 100000 }, hooks)).toBeNull()
    })

    it('MC-2653 NULL donor: a donor cue never asks the recipient\'s own fact key while another same-category cue exists', () => {
        const q = (id: string, key: string) => ({ id, category: 'single_fact', key }) as Question
        const t = (qid: string, cue: string) => ({ kind: 'fact', qid, category: 'single_fact', style: 'ask', cue }) as Turn
        const chatOf = (cast: string[], qs: Question[]) => ({ nf: { cast }, questions: qs }) as unknown as Chat
        const a = chatOf(['rowan'], [q('a1', 'K1'), q('a2', 'K2')])
        const b = chatOf(['tamsin'], [q('b1', 'K1'), q('b2', 'K3')])
        const cands = [CTL.donorEntry(a, [t('a1', 'cue A K1'), t('a2', 'cue A K2')]), CTL.donorEntry(b, [t('b1', 'cue B K1'), t('b2', 'cue B K3')])]
        expect(CTL.pickDonor(cands, 0, 'single_fact', 'ask', 'K1')).toMatchObject({ j: 1, cue: 'cue B K3', fallback: false })
        expect(CTL.pickDonor(cands, 1, 'single_fact', 'ask', 'K3')).toMatchObject({ j: 0, cue: 'cue A K1' })
        // without a distinct key the first cue is used, as before
        expect(CTL.pickDonor(cands, 0, 'single_fact', 'ask')).toMatchObject({ j: 1, cue: 'cue B K1' })
    })

    // ---- MC-2661: the rare builder carries the verdict; the gate runs only when the tune predicts PASS ----
    const PASSING = { budgetFlag: null, finalFlag: null }
    const FINAL_FAIL = { budgetFlag: null, finalFlag: 'tune predicts FAIL at the final settings' }
    const rareSettings = (evidence?: Settings | null): Settings => {
        const s: Settings = { builder: 'rare', C: 32768, L: 800, k: null, rareShare: 0.01, budget: 1200, queries: 1, tau: null, F: 2, tuneDrawSeed: 510001, ...(evidence === undefined ? {} : { evidence }) }
        s.sha256 = GATE.settingsDigest(s)
        return s
    }
    // the literal seeds are arguments to pure refusal functions: nothing is drawn
    const gateArgs = (settings: Settings, extra: Record<string, unknown> = {}) => ({ drawSeed: 610001, builder: 'rare', settings, ...extra })

    it('GB1 (MC-2661): rare is the only gate builder; fulltext and idf are report-only', () => {
        expect(() => GATE.assertGateBuilder('rare')).not.toThrow()
        for (const b of ['fulltext', 'idf']) expect(() => GATE.assertGateBuilder(b)).toThrow(/MC-2661/)
    })

    it('GB2: rare is accepted on the GATE and GATE-R seeds only; fulltext is refused everywhere, an override included', () => {
        const s = rareSettings(PASSING)
        expect(() => GATE.checkGateArgs(gateArgs(s))).not.toThrow()
        expect(() => GATE.checkGateArgs(gateArgs(s, { drawSeed: 620001 }))).not.toThrow()
        for (const seed of [710001, 720001]) expect(() => GATE.checkGateArgs(gateArgs(s, { drawSeed: seed }))).toThrow()
        expect(() => GATE.checkGateArgs(gateArgs(s, { builder: 'fulltext' }))).toThrow(/MC-2661/)
        expect(() => GATE.checkGateArgs(gateArgs(s, { builder: 'fulltext', drawSeed: TEST_SEED, kind: 'OVERRIDE' }))).toThrow(/MC-2661/)
    })

    it('GB3: the ledger takes rare attempts and refuses fulltext and idf as unknown builders', () => {
        const SHA = 'a'.repeat(64)
        const entry = (b: string): Entry => ({ builder: b, kind: 'FIRST', seedFamily: 'GATE', drawSeed: 610001, settingsSha: SHA, harness: { commit: 'c', diffHash: 'd' }, outcome: 'VALID', verdict: 'PASS' })
        expect(ATT.tryAttempt(ATT.recordSettings(ATT.emptyLedger(), 'rare', SHA), entry('rare')).ok).toBe(true)
        for (const b of ['fulltext', 'idf']) {
            const r = ATT.tryAttempt(ATT.recordSettings(ATT.emptyLedger(), b, SHA), entry(b))
            expect(r.ok).toBe(false)
            expect(r.reason).toMatch(/unknown builder/)
        }
    })

    it('GB4 (MC-2661): every gate run, an OVERRIDE included, refuses settings unless budgetFlag, finalFlag and oracleFlag are clear', () => {
        const refused = (evidence: Settings | null | undefined, re: RegExp, extra: Record<string, unknown> = {}) => expect(() => GATE.checkGateArgs(gateArgs(rareSettings(evidence), extra))).toThrow(re)
        refused(undefined, /predicts PASS.*evidence/)
        refused(null, /predicts PASS.*evidence/)
        refused({ budgetFlag: 'tune predicts FAIL', finalFlag: null }, /budgetFlag/)
        refused(FINAL_FAIL, /finalFlag/)
        refused({ finalFlag: null }, /budgetFlag/)
        refused({ ...PASSING, oracleFlag: 'no oracle-eligible L/budget' }, /oracleFlag/)
        expect(() => GATE.checkGateArgs(gateArgs(rareSettings(PASSING)))).not.toThrow()
        expect(() => GATE.checkGateArgs(gateArgs(rareSettings({ ...PASSING, oracleFlag: null })))).not.toThrow()
        refused(FINAL_FAIL, /finalFlag/, { kind: 'OVERRIDE', drawSeed: TEST_SEED })
        // the digest is checked first: a hand-edited flag fails on the hash, not on the flag
        expect(() => GATE.checkGateArgs(gateArgs({ ...rareSettings(FINAL_FAIL), sha256: 'x' }))).toThrow(/sha256/)
    })

    it('GB5: record-settings refuses the same settings and records only passing, digest-true rare settings', () => {
        const rec = (settings: Settings, builder = 'rare') => GATE.recordSettingsCommand(ATT.emptyLedger(), { builder, settings })
        expect(() => rec(rareSettings(undefined))).toThrow(/predicts PASS.*evidence/)
        expect(() => rec(rareSettings(FINAL_FAIL))).toThrow(/finalFlag/)
        expect(() => rec(rareSettings({ ...PASSING, oracleFlag: 'no oracle-eligible L/budget' }))).toThrow(/oracleFlag/)
        for (const b of ['fulltext', 'idf']) expect(() => rec(rareSettings(PASSING), b)).toThrow(/MC-2661/)
        expect(() => rec({ ...rareSettings(PASSING), sha256: 'x' })).toThrow(/sha256/)
        const good = rareSettings(PASSING)
        expect(rec(good).recordedSettings.rare).toBe(good.sha256)
    })

    it('GB6: the record-settings command line refuses flagged settings without writing the ledger and records passing ones', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-gb6-'))
        try {
            const run = (settings: Settings, name: string) => {
                const file = path.join(dir, name + '.json')
                const ledger = path.join(dir, name + '-ledger.json')
                fs.writeFileSync(file, JSON.stringify(settings, null, 1), 'utf8')
                const r = spawnSync(process.execPath, [path.join(S0, 'gate.mjs'), 'record-settings', '--builder', 'rare', '--settings', file, '--ledger', ledger], { encoding: 'utf8', env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir } })
                return { r, ledger }
            }
            const bad = run(rareSettings(FINAL_FAIL), 'bad')
            expect(bad.r.status).not.toBe(0)
            expect(bad.r.stderr).toMatch(/finalFlag/)
            expect(fs.existsSync(bad.ledger)).toBe(false)
            const good = rareSettings(PASSING)
            const ok = run(good, 'good')
            expect(ok.r.status).toBe(0)
            expect((JSON.parse(fs.readFileSync(ok.ledger, 'utf8')) as Ledger).recordedSettings.rare).toBe(good.sha256)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }, SLOW)

    it('PR1 (MC-2661): the pre-registered procedure carries the rare rule, the ask-only gating and the refusal predicate', () => {
        const p = TUNE.PROCEDURE as Record<string, Record<string, unknown> | string | string[]>
        expect(p.verdictBuilder).toMatch(/^rare/)
        expect(p.gatingStyles).toEqual(['ask'])
        const rare = p.rare as Record<string, unknown>
        expect(rare.query).toMatch(/whole user turn/)
        expect(rare.query).toMatch(/tailChars is ignored/)
        expect(rare.terms).toMatch(/floor\(rareShare x N\)/)
        expect(rare.rareShareGrid).toEqual([0.005, 0.01, 0.02, 0.03])
        expect((p.budgets as { grid: number[] }).grid).toContain(5215)
        expect(p.gateOnlyIfTunePredictsPass).toMatch(/finalFlag/)
        expect(p.gateOnlyIfTunePredictsPass).toMatch(/oracleFlag/)
        expect((p.controls as { alphaC: string }).alphaC).toMatch(/gating styles/)
    })
})

describe('S0 selection and tune', () => {
    const CELLS = ['M4-en', 'M4-ko', 'NF-real-en', 'NF-real-ko']
    type Fake = { p: number; het: number; empty?: number; dl?: number }
    const clamp = (x: number) => Math.max(0, Math.min(10, Math.round(x)))
    const fakeEv = (fn: (st: Settings, regime: string) => Fake) => (st: Settings, regime: string) => {
        const f = fn(st, regime)
        const recs: Record<string, unknown[]> = {}
        for (const cell of CELLS) {
            recs[cell] = Array.from({ length: 24 }, (_, c) => {
                const sgn = c % 2 === 0 ? 1 : -1
                const e = clamp(10 * (f.p + sgn * f.het))
                const dl = clamp(10 * ((f.dl ?? f.p) + sgn * f.het))
                const one = { n: 10, e, b: 0, dl }
                return { ask: one, allude: one, nf: { n: 10, empty: Math.round(10 * (f.empty ?? 0)) } }
            })
        }
        return { recs, oracle: Object.fromEntries(CELLS.map((c) => [c, { ask: 1, allude: 1 }])) }
    }

    it('SEL1: budget by lower bound, delta from the tune CI, builders tuned apart, the smallest qualifying tau, 24 tune chats', async () => {
        // budget: 400 passes by its point but its lower bound does not; 600 and up clear
        const budgetFn = (st: Settings): Fake => (st.budget === 400 ? { p: 0.55, het: 0.45 } : { p: 0.6, het: 0.1 })
        const s = SEL.selectSettings(fakeEv(budgetFn), { builder: 'fulltext' })
        expect(s.budget).toBe(600)
        expect(s.rareShare).toBeNull() // the report-only builders carry no rareShare
        const base = fakeEv(budgetFn)({ builder: 'fulltext', budget: 1200 }, 'POOL')
        expect(s.delta).toBe(SEL.deltaOf(base))
        expect(Math.abs((s.delta as number) - 0.02)).toBeGreaterThan(0.005)
        // tau: a non-contiguous qualifying set, take the smallest
        const tauFn = (st: Settings, regime: string): Fake => {
            void regime
            const t = st.tau as number | null
            if (t === null) return { p: 0.6, het: 0.1, empty: 0 }
            const empty: Record<number, number> = { 0.002: 0.02, 0.005: 0.5, 0.01: 0.6, 0.02: 0.6, 0.05: 0.7 }
            const p = t === 0.01 ? 0.3 : 0.6
            return { p, het: 0.1, empty: empty[t] }
        }
        const st = SEL.selectSettings(fakeEv(tauFn), { builder: 'fulltext' })
        expect(st.tau).toBe(0.005)
        // the idf settings carry their own L and k, and the tune runs 24 chats per cell
        const builderFn = (s2: Settings): Fake => {
            const bonus = s2.builder === 'fulltext' ? (s2.L === 1200 ? 0.2 : 0) : s2.L === 500 && s2.k === 12 ? 0.2 : 0
            return { p: 0.5 + bonus, het: 0.05 }
        }
        const seen: number[] = []
        const res = await TUNE.runTune({ drawSeed: TEST_SEED, counter: stub(), profiles: {}, diagnostics: false, builders: ['fulltext', 'idf'], makeEvaluator: (o: { nChats: number }) => { seen.push(o.nChats); return { ev: fakeEv(builderFn), chats: {} } } })
        expect(seen).toEqual([24])
        expect(SEL.TUNE_CHATS).toBe(24)
        expect(res.settings.fulltext).toMatchObject({ L: 1200 })
        expect(res.settings.idf).toMatchObject({ L: 500, k: 12 })
        expect(res.settings.idf.sha256).not.toBe(res.settings.fulltext.sha256)
    }, SLOW)

    // ORACLE-QUERY points per cell and style come from the evaluator beside ORACLE-RANK
    const withQuery = (fn: (st: Settings, regime: string) => Fake, oq: (st: Settings) => number) => (st: Settings, regime: string) => ({
        ...fakeEv(fn)(st, regime),
        oracleQuery: Object.fromEntries(CELLS.map((c) => [c, { ask: oq(st), allude: oq(st) }])),
    })

    it('MC-2653 SEL-OQ: a candidate whose ORACLE-QUERY is under 0.9 is not eligible even when its ORACLE-RANK passes', () => {
        const fn = (st: Settings): Fake => ({ p: st.L === 1200 ? 0.7 : 0.6, het: 0.05 })
        const s = SEL.selectSettings(withQuery(fn, (st) => (st.L === 300 ? 0.95 : 0.8)), { builder: 'fulltext' })
        expect(s.L).toBe(300)
    })

    it('MC-2654 SEL-WALK: with no eligible candidate at the default budget the grid walks to the next budget with one', () => {
        const fn = (): Fake => ({ p: 0.6, het: 0.05 })
        const s = SEL.selectSettings(withQuery(fn, (st) => ((st.budget as number) >= 1600 ? 0.95 : 0.5)), { builder: 'fulltext' })
        expect(s.budget as number).toBeGreaterThanOrEqual(1600)
        expect((s.evidence as { gridBudget: number }).gridBudget).toBe(1600)
        const none = SEL.selectSettings(withQuery(fn, () => 0.5), { builder: 'fulltext' })
        expect((none.evidence as { oracleFlag: string }).oracleFlag).toMatch(/no oracle-eligible/)
    })

    // ---- MC-2661: selection reads ask turns only; allude is evaluated and reported ----
    type SplitFake = { ask: Fake; allude: Fake; oracle?: { ask: number; allude: number }; oracleQuery?: { ask: number; allude: number } }
    const splitEv = (fn: (st: Settings, regime: string) => SplitFake) => (st: Settings, regime: string) => {
        const f = fn(st, regime)
        const recs: Record<string, unknown[]> = {}
        for (const cell of CELLS) {
            recs[cell] = Array.from({ length: 24 }, (_, c) => {
                const sgn = c % 2 === 0 ? 1 : -1
                const one = (x: Fake) => ({ n: 10, e: clamp(10 * (x.p + sgn * x.het)), b: 0, dl: clamp(10 * ((x.dl ?? x.p) + sgn * x.het)) })
                return { ask: one(f.ask), allude: one(f.allude), nf: { n: 10, empty: Math.round(10 * (f.ask.empty ?? 0)) } }
            })
        }
        const per = (o: { ask: number; allude: number }) => Object.fromEntries(CELLS.map((c) => [c, { ...o }]))
        return { recs, oracle: per(f.oracle ?? { ask: 1, allude: 1 }), ...(f.oracleQuery ? { oracleQuery: per(f.oracleQuery) } : {}) }
    }

    it('SEL-ASK1 (MC-2661): the budget clears on ask turns alone', () => {
        const s = SEL.selectSettings(splitEv(() => ({ ask: { p: 0.7, het: 0.05 }, allude: { p: 0.3, het: 0.05 } })), { builder: 'rare' })
        expect((s.evidence as { budgetFlag: string | null }).budgetFlag).toBeNull()
    })

    it('SEL-ASK1g: a failing ask recall still gives the FAIL flag', () => {
        const s = SEL.selectSettings(splitEv(() => ({ ask: { p: 0.3, het: 0.05 }, allude: { p: 0.7, het: 0.05 } })), { builder: 'rare' })
        expect((s.evidence as { budgetFlag: string | null }).budgetFlag).toBe('tune predicts FAIL')
    })

    it('SEL-ASK2 (MC-2661): oracle eligibility reads ask turns only', () => {
        const fn = (): SplitFake => ({ ask: { p: 0.7, het: 0.05 }, allude: { p: 0.7, het: 0.05 }, oracleQuery: { ask: 1, allude: 0.5 } })
        const s = SEL.selectSettings(splitEv(fn), { builder: 'rare' })
        const ev = s.evidence as { oracleFlag?: string; gridBudget: number }
        expect(ev.oracleFlag).toBeUndefined()
        expect(ev.gridBudget).toBe(1200)
    })

    it('SEL-ASK3 (MC-2661): the objective is the minimum over cells of the ask lower bound', () => {
        const fn = (st: Settings): SplitFake => (st.L === 300 ? { ask: { p: 0.9, het: 0.05 }, allude: { p: 0.2, het: 0.05 } } : { ask: { p: 0.6, het: 0.05 }, allude: { p: 0.6, het: 0.05 } })
        expect(SEL.selectSettings(splitEv(fn), { builder: 'rare' }).L).toBe(300)
    })

    it('SEL-ASK4 (MC-2661): delta is the smallest ask half-width', () => {
        const ev = splitEv(() => ({ ask: { p: 0.6, het: 0.15 }, allude: { p: 0.6, het: 0 } }))
        const s = SEL.selectSettings(ev, { builder: 'rare' })
        const r0 = ev({}, 'POOL') as { recs: Record<string, { ask: { n: number; e: number } }[]> }
        const half = Math.min(...CELLS.map((cell) => {
            const b = STATS.intervals(r0.recs[cell].map((c) => ({ n: c.ask.n, v: c.ask.e })), 4000).boot
            return (b.hi - b.lo) / 2
        }))
        expect(half).toBeGreaterThan(0)
        expect(s.delta).toBe(half)
    })

    it('SEL-ASK5 (MC-2661): the cheapest-budget loss guard reads ask turns only', () => {
        const fn = (st: Settings): SplitFake => ({ ask: { p: 0.8, het: 0.05 }, allude: { p: (st.budget as number) >= 1200 ? 0.8 : 0.5, het: 0.05 } })
        expect(SEL.selectSettings(splitEv(fn), { builder: 'rare' }).budget).toBe(400)
    })

    // ---- MC-2661: the rareShare grid, its threading, the budget cap and the final check ----
    it('SEL-RHO: rareShare is selected from the grid; a flat objective takes the share nearest 0.01 with the larger L', () => {
        const fn = (st: Settings): Fake => ({ p: 0.5 + (st.L === 500 && st.rareShare === 0.02 ? 0.2 : 0), het: 0.05 })
        expect(SEL.selectSettings(fakeEv(fn), { builder: 'rare' })).toMatchObject({ L: 500, rareShare: 0.02, k: null })
        const flat = SEL.selectSettings(fakeEv(() => ({ p: 0.6, het: 0.05 })), { builder: 'rare' })
        expect(flat).toMatchObject({ L: 1200, rareShare: 0.01, k: null })
    })

    // Integer-exact evaluator: per cell 24 chats of n = 20; even chats recall hi, odd chats lo; ask and allude alike.
    type Ladder = { hi: number; lo: number; empty: number }
    const ladderEv = (fn: (st: Settings, regime: string) => Ladder, calls?: Settings[], oracleOf: (st: Settings) => number = () => 1) => (st: Settings, regime: string) => {
        calls?.push({ ...st })
        const { hi, lo, empty } = fn(st, regime)
        const recs: Record<string, unknown[]> = {}
        for (const cell of CELLS) {
            recs[cell] = Array.from({ length: 24 }, (_, c) => {
                const e = c % 2 === 0 ? hi : lo
                const one = { n: 20, e, b: 0, dl: e }
                return { ask: one, allude: one, nf: { n: 20, empty } }
            })
        }
        const o = oracleOf(st)
        return { recs, oracle: Object.fromEntries(CELLS.map((c) => [c, { ask: o, allude: o }])) }
    }
    const L7_5: Ladder = { hi: 7, lo: 5, empty: 0 }

    it('SEL-THREADa: the picked rareShare is used by the budget step and every later evaluation', () => {
        // rareShare 0.02 gives 10/8 at the default budget and 16/12 from 2400; every other share stays at 7/5
        const fn = (st: Settings): Ladder => (st.rareShare === 0.02 ? ((st.budget as number) >= 2400 ? { hi: 16, lo: 12, empty: 0 } : { hi: 10, lo: 8, empty: 0 }) : L7_5)
        const calls: Settings[] = []
        const s = SEL.selectSettings(ladderEv(fn, calls), { builder: 'rare', tuneDrawSeed: 510001 })
        const evidence = s.evidence as { budgetFlag: string | null; finalFlag: string | null }
        expect(evidence.budgetFlag).toBeNull()
        expect(s.budget).toBe(2400)
        expect(s.rareShare).toBe(0.02)
        expect(evidence.finalFlag).toBeNull()
        // the first evaluation is the step-0 delta run at the default; every later non-grid run carries the pick
        const later = calls.filter((c) => c.oracle !== true).slice(1)
        expect(later.length).toBeGreaterThan(5)
        expect(later.every((c) => c.rareShare === 0.02)).toBe(true)
    })

    it('SEL-THREADb: the recheck at the chosen budget may change rareShare and the change reaches the settings', () => {
        // 0.03 leads at the default budget; from 2400 it gives 14/10 and 0.02 gives 16/12
        const fn = (st: Settings): Ladder => {
            const high = (st.budget as number) >= 2400
            if (st.rareShare === 0.03) return high ? { hi: 14, lo: 10, empty: 0 } : { hi: 10, lo: 8, empty: 0 }
            if (st.rareShare === 0.02) return high ? { hi: 16, lo: 12, empty: 0 } : L7_5
            return L7_5
        }
        const s = SEL.selectSettings(ladderEv(fn), { builder: 'rare', tuneDrawSeed: 510001 })
        expect(s.rareShare).toBe(0.02)
        expect(s.budget).toBe(2400)
        expect((s.evidence as { recheck: unknown }).recheck).toMatchObject({ rareShare: 0.02, changed: true })
    })

    it('SEL-CAP: the budget grid reaches 4800 and the cap 5215', () => {
        const clearsFrom = (from: number) => (st: Settings): Fake => ((st.budget as number) >= from ? { p: 0.8, het: 0.05 } : { p: 0.3, het: 0.05 })
        expect(SEL.BUDGETS.at(-1)).toBe(5215)
        expect(SEL.selectSettings(fakeEv(clearsFrom(4800)), { builder: 'rare' }).budget).toBe(4800)
        expect(SEL.selectSettings(fakeEv(clearsFrom(5000)), { builder: 'rare' }).budget).toBe(5215)
    })

    it('SEL-FINALa (S2): settings that clear at the chosen budget but not at the final settings carry finalFlag, and the gate refuses them', () => {
        // tau null gives 16/8; any tau costs a constant 0.05 of paired loss (within delta) and drops the lower bound under 0.5
        const fn = (st: Settings): Ladder => (st.tau === null ? { hi: 16, lo: 8, empty: 0 } : { hi: 15, lo: 7, empty: 10 })
        const s = SEL.selectSettings(ladderEv(fn), { builder: 'rare', tuneDrawSeed: 510001 })
        const evidence = s.evidence as { budgetFlag: string | null; finalFlag: string | null }
        expect(evidence.budgetFlag).toBeNull()
        expect(s.tau).toBe(0.002)
        expect(evidence.finalFlag).toBe('tune predicts FAIL at the final settings')
        s.sha256 = GATE.settingsDigest(s)
        expect(() => GATE.checkGateArgs({ drawSeed: 610001, builder: 'rare', settings: s })).toThrow(/predicts PASS.*finalFlag/)
    })

    it('SEL-FINALb: settings that clear at the final settings carry finalFlag null', () => {
        const fn = (st: Settings): Ladder => (st.tau === null ? { hi: 16, lo: 8, empty: 0 } : { hi: 16, lo: 8, empty: 10 })
        const s = SEL.selectSettings(ladderEv(fn), { builder: 'rare', tuneDrawSeed: 510001 })
        expect(s.tau).toBe(0.002)
        expect((s.evidence as { finalFlag: string | null }).finalFlag).toBeNull()
    })

    it('SEL-ORFLAG: a recheck pick that is not oracle-eligible at the chosen budget sets oracleFlag and the gate refuses', () => {
        // clears only from 2400; ORACLE-RANK is fine at the default budget and under the floor from 2400 up
        const fn = (st: Settings): Ladder => ((st.budget as number) >= 2400 ? { hi: 16, lo: 12, empty: 0 } : L7_5)
        const s = SEL.selectSettings(ladderEv(fn, undefined, (st) => ((st.budget as number) >= 2400 ? 0.5 : 1)), { builder: 'rare', tuneDrawSeed: 510001 })
        const evidence = s.evidence as { budgetFlag: string | null; gridBudget: number; oracleFlag?: string }
        expect(s.budget).toBe(2400)
        expect(evidence.gridBudget).toBe(1200)
        expect(evidence.budgetFlag).toBeNull()
        expect(evidence.oracleFlag).toMatch(/no oracle-eligible/)
        s.sha256 = GATE.settingsDigest(s)
        expect(() => GATE.checkGateArgs({ drawSeed: 610001, builder: 'rare', settings: s })).toThrow(/oracleFlag/)
        // eligible at the chosen budget: no flag
        const fine = SEL.selectSettings(ladderEv(fn), { builder: 'rare', tuneDrawSeed: 510001 })
        expect((fine.evidence as { oracleFlag?: string }).oracleFlag).toBeUndefined()
    })

    // ---- MC-2662: when the final settings do not clear, selection walks to the next larger budget that cleared ----
    // The delivered-recall column is zeroed so a larger F never costs paired loss: F 4 is chosen wherever the ladder lets it,
    // and the ladder alone decides whether the final settings clear.
    const walkEv = (fn: (st: Settings) => Ladder, calls?: Settings[]) => (st: Settings, regime: string) => {
        const r = ladderEv((s) => fn(s), calls)(st, regime)
        for (const cell of CELLS) for (const c of r.recs[cell] as { ask: { dl: number }; allude: { dl: number } }[]) { c.ask = { ...c.ask, dl: 0 }; c.allude = { ...c.allude, dl: 0 } }
        return r
    }
    const GOOD: Ladder = { hi: 16, lo: 8, empty: 0 }
    const BAD_F4: Ladder = { hi: 15, lo: 7, empty: 0 }
    type Walk = { budget: number; finalOk: boolean }
    // clears from 1600 up; F 4 drops the final lower bound under 0.5 at the budgets badAt names (a larger budget keeps it above)
    const walkLadder = (badAt: (budget: number) => boolean) => (st: Settings): Ladder => {
        const b = st.budget as number
        const base: Ladder = b >= 1600 ? GOOD : { hi: 10, lo: 2, empty: 0 }
        const out = st.F === 4 && badAt(b) ? BAD_F4 : base
        return { ...out, empty: st.tau === null ? 0 : 10 }
    }
    const walkOf = (s: Record<string, unknown>) => (s.evidence as { finalWalk: Walk[] }).finalWalk

    it('FW1 (MC-2662): a failing final check walks to the next larger clearing budget and returns its settings', () => {
        const s = SEL.selectSettings(walkEv(walkLadder((b) => b === 1600)), { builder: 'rare', tuneDrawSeed: 510001 })
        const evidence = s.evidence as { budgetClears: number[]; finalFlag: string | null }
        expect(evidence.budgetClears.slice(0, 2)).toEqual([1600, 2400])
        expect(s.budget).toBe(2400)
        expect(s.F).toBe(4)
        expect(evidence.finalFlag).toBeNull()
        expect(walkOf(s)).toMatchObject([{ budget: 1600, finalOk: false }, { budget: 2400, finalOk: true }])
    })

    it('FW2 (MC-2662): no clearing budget passes the final check: every larger one is tried, the last is returned and finalFlag stays set', () => {
        const s = SEL.selectSettings(walkEv(walkLadder(() => true)), { builder: 'rare', tuneDrawSeed: 510001 })
        const evidence = s.evidence as { budgetClears: number[]; finalFlag: string | null }
        expect(evidence.budgetClears).toEqual([1600, 2400, 3600, 4800, 5215])
        expect(walkOf(s).map((w) => w.budget)).toEqual(evidence.budgetClears)
        expect(walkOf(s).every((w) => !w.finalOk)).toBe(true)
        expect(s.budget).toBe(5215)
        expect(evidence.finalFlag).toBe('tune predicts FAIL at the final settings')
        s.sha256 = GATE.settingsDigest(s)
        expect(() => GATE.checkGateArgs({ drawSeed: 610001, builder: 'rare', settings: s })).toThrow(/predicts PASS.*finalFlag/)
    })

    it('FW3 (MC-2662): a first budget whose final settings clear takes no walk step', () => {
        const s = SEL.selectSettings(walkEv(walkLadder(() => false)), { builder: 'rare', tuneDrawSeed: 510001 })
        expect(s.budget).toBe(1600)
        expect((s.evidence as { finalFlag: string | null }).finalFlag).toBeNull()
        expect(walkOf(s)).toMatchObject([{ budget: 1600, finalOk: true }])
        expect(walkOf(s)).toHaveLength(1)
    })

    it('FW4 (MC-2662): every later-step evaluation of the walk carries the walked budget and the shipped rareShare', () => {
        // rareShare 0.02 leads at the default budget and from 1600; F 4 breaks the final check at 1600 only
        const fn = (st: Settings): Ladder => {
            if (st.rareShare !== 0.02) return L7_5
            const b = st.budget as number
            if (b < 1600) return { hi: 10, lo: 8, empty: 0 }
            return { ...(st.F === 4 && b === 1600 ? { hi: 11, lo: 7 } : { hi: 16, lo: 12 }), empty: st.tau === null ? 0 : 10 }
        }
        const calls: Settings[] = []
        const s = SEL.selectSettings(walkEv(fn, calls), { builder: 'rare', tuneDrawSeed: 510001 })
        expect(s.budget).toBe(2400)
        expect(s.rareShare).toBe(0.02)
        expect(walkOf(s)).toMatchObject([{ budget: 1600, finalOk: false }, { budget: 2400, finalOk: true }])
        // only steps 3-7 carry queries 3, a tau or a changed F; the snippet floor evaluates at 0.75 x the settled budget
        const later = calls.filter((c) => c.oracle !== true && (c.queries === 3 || c.tau !== null || c.F !== 2))
        const atWalk = later.filter((c) => c.budget === 2400 || c.budget === 1800)
        expect(atWalk.some((c) => c.budget === 2400 && c.queries === 3)).toBe(true)
        expect(atWalk.some((c) => c.budget === 2400 && c.tau !== null)).toBe(true)
        expect(atWalk.some((c) => c.budget === 1800)).toBe(true)
        expect(later.every((c) => c.rareShare === 0.02)).toBe(true)
        // the recheck at the walked budget is oracle-evaluated at that budget
        expect(calls.some((c) => c.oracle === true && c.budget === 2400)).toBe(true)
    })

    it('FW5 (MC-2662): the walk redoes the oracle check at the walked budget; an ineligible walked pick sets oracleFlag', () => {
        // the first budget fails the final check; ORACLE-RANK is fine at 1600 and under the floor from 2400 up
        const ladder = walkLadder((b) => b === 1600)
        const withOracle = (floorAt: number) => (st: Settings, regime: string) => {
            const r = walkEv(ladder)(st, regime)
            const o = (st.budget as number) >= floorAt ? 0.5 : 1
            return { ...r, oracle: Object.fromEntries(CELLS.map((c) => [c, { ask: o, allude: o }])) }
        }
        const fine = SEL.selectSettings(withOracle(Infinity), { builder: 'rare', tuneDrawSeed: 510001 })
        expect(fine.budget).toBe(2400)
        expect((fine.evidence as { oracleFlag?: string }).oracleFlag).toBeUndefined()
        const flagged = SEL.selectSettings(withOracle(2400), { builder: 'rare', tuneDrawSeed: 510001 })
        expect(flagged.budget).toBe(2400)
        expect((flagged.evidence as { oracleFlag?: string }).oracleFlag).toMatch(/no oracle-eligible/)
    })

    it('FW5b (MC-2662): an oracleFlag set at a rejected earlier walk budget does not leak into the returned settings', () => {
        // ORACLE-RANK is under the floor only at 1600; F 4 breaks the final check there, so 2400 (eligible) is returned
        const ladder = walkLadder((b) => b === 1600)
        const ev = (st: Settings, regime: string) => {
            const r = walkEv(ladder)(st, regime)
            const o = (st.budget as number) === 1600 ? 0.5 : 1
            return { ...r, oracle: Object.fromEntries(CELLS.map((c) => [c, { ask: o, allude: o }])) }
        }
        const s = SEL.selectSettings(ev, { builder: 'rare', tuneDrawSeed: 510001 })
        expect(walkOf(s)).toMatchObject([{ budget: 1600, finalOk: false }, { budget: 2400, finalOk: true }])
        expect(s.budget).toBe(2400)
        expect((s.evidence as { oracleFlag?: string }).oracleFlag).toBeUndefined()
    })

    it('FW6: PROCEDURE carries finalBudgetWalk', () => {
        const p = TUNE.PROCEDURE as Record<string, string>
        expect(p.finalBudgetWalk).toMatch(/next larger budget that cleared at the budget step/)
        expect(p.finalBudgetWalk).toMatch(/MC-2662/)
    })
})

describe('S0 diagnostics and end to end', () => {
    it('D2: the control error-rate diagnostic runs at the thresholds and reports a familywise bound', () => {
        const r = TUNE.controlErrorRates({ ns: [12], replicates: 20, icc: 0.1, B: 2000 })
        expect(r[12].oracleRate).toBeGreaterThanOrEqual(0)
        expect(r[12].nullRate).toBeLessThanOrEqual(1)
        expect(Number.isFinite(r[12].familywiseBound)).toBe(true)
    }, SLOW)

    it('T1: the tune writes its settings first; a failing report-only NF-specLong trigger is recorded, a failing gated profile stops the run', () => {
        const settings = { fulltext: { budget: 600, sha256: 'aa' }, idf: { budget: 800, sha256: 'bb' } }
        const res = { settings, diagnostics: { fulltext: { icc: 0.1 }, idf: { icc: 0.1 } }, chats: { 'NF-real-ko': [NFko] } }
        const run = (draw: (s: { corpus: string; drawSeed: number; lang: string; i: number }, c?: Record<string, unknown>) => unknown) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-t1-'))
            const call = () => TUNE.writeTuneOutputs({ real: dir, res, counter: stub(), profiles: { real }, drawSeed: TEST_SEED, draw, nSpecLong: 2, d2Options: { ns: [12], replicates: 5, B: 200 } })
            return { dir, call }
        }
        const dirs: string[] = []
        try {
            const specLongFails = run((s, c) => { if (s.corpus === 'NF-specLong') throw new Error('generator: no usable reserve index for 0'); return CORPUS.drawWithReserve(s, c) })
            dirs.push(specLongFails.dir)
            specLongFails.call()
            expect(fs.existsSync(path.join(specLongFails.dir, 'settings-fulltext.json'))).toBe(true)
            expect(fs.existsSync(path.join(specLongFails.dir, 'settings-idf.json'))).toBe(true)
            const report = JSON.parse(fs.readFileSync(path.join(specLongFails.dir, 'tune-report.json'), 'utf8')) as { specLongError: string; trigger: Record<string, { nfReal: unknown; specLong: unknown }> }
            expect(report.specLongError).toMatch(/no usable reserve index/)
            expect(report.trigger.fulltext.specLong).toBeNull()
            expect(report.trigger.fulltext.nfReal).not.toBeNull()
            const nfRealFails = run((s, c) => { if (s.corpus === 'NF-real') throw new Error('real boom'); return CORPUS.drawWithReserve(s, c) })
            dirs.push(nfRealFails.dir)
            expect(nfRealFails.call).toThrow(/NF-real pieces report \(gated profile\) failed.*real boom/)
            expect(fs.existsSync(path.join(nfRealFails.dir, 'settings-fulltext.json'))).toBe(true)
            expect(fs.existsSync(path.join(nfRealFails.dir, 'tune-report.json'))).toBe(false)
        } finally {
            for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
        }
    }, SLOW)

    it('TU1: the tune runs the rare builder only by default', async () => {
        const res = await TUNE.runTune({ drawSeed: TEST_SEED, counter: stub(), profiles: {}, diagnostics: false, makeEvaluator: () => ({ ev: () => ({ recs: { 'M4-en': [{ ask: { n: 10, e: 8, b: 0, dl: 8 }, allude: { n: 10, e: 8, b: 0, dl: 8 }, nf: { n: 10, empty: 0 } }] }, oracle: { 'M4-en': { ask: 1, allude: 1 } } }), chats: {} }) })
        expect(Object.keys(res.settings)).toEqual(['rare'])
    }, SLOW)

    it('TU2: the tune outputs work for any builder subset', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-tu2-'))
        try {
            const res = { settings: { rare: { budget: 600, sha256: 'aa' } }, diagnostics: { rare: { icc: 0.1 } }, chats: { 'NF-real-ko': [NFko] } }
            TUNE.writeTuneOutputs({ real: dir, res, counter: stub(), profiles: { real }, drawSeed: TEST_SEED, nSpecLong: 1, d2Options: { ns: [12], replicates: 2, B: 100 } })
            expect(fs.existsSync(path.join(dir, 'settings-rare.json'))).toBe(true)
            expect(fs.existsSync(path.join(dir, 'tune-report.json'))).toBe(true)
        } finally {
            fs.rmSync(dir, { recursive: true, force: true })
        }
    }, SLOW)

    it('E1: a tiny draw through tune-lite and the gate gives the report shape and a ledger entry', async () => {
        const cells = [{ corpus: 'M4', lang: 'en' }, { corpus: 'M4', lang: 'ko' }, { corpus: 'NF-real', lang: 'en' }, { corpus: 'NF-real', lang: 'ko' }]
        const grid = { L: [500], K: [8], rareShares: [0.01], budgets: [800], budgetDefault: 800, taus: [0.01], Fs: [2] }
        const tuneLog: string[] = []
        const tuned = await TUNE.runTune({ drawSeed: TEST_SEED, counter: stub(), profiles: { real }, nChats: 1, cells, grid, C: 4096, builders: ['rare'], log: (m: string) => tuneLog.push(m) })
        const settings = tuned.settings.rare
        expect(settings.sha256).toBe(GATE.settingsDigest(settings))
        // PR2: the procedure block and both selection flags travel with the settings and under their digest
        expect(settings.procedure).toEqual(TUNE.PROCEDURE)
        expect(Object.keys(settings.evidence as object)).toEqual(expect.arrayContaining(['budgetFlag', 'finalFlag']))
        expect(settings.rareShare).toBe(0.01)
        expect(Object.keys(tuned.diagnostics)).toEqual(['rare'])
        // D1 reaches stdout (the tune log) and the report: one status line per cell and one for the builder
        const d1 = tuned.diagnostics.rare.d1
        expect(d1.status).toBe(tuned.diagnostics.rare.controls.tests.some((t) => t.failConfirmed && t.style === 'ask') ? 'INVALID' : 'PASS')
        expect(Object.keys(d1.cells).sort()).toEqual(['M4-en', 'M4-ko', 'NF-real-en', 'NF-real-ko'])
        expect(TUNE.controlSummaryLines('rare', d1).length).toBe(5)
        for (const line of TUNE.controlSummaryLines('rare', d1)) expect(tuneLog).toContain(line)
        let ledger = ATT.recordSettings(ATT.emptyLedger(), 'rare', settings.sha256 as string)
        const res = await GATE.runGateAttempt({ builder: 'rare', kind: 'FIRST', drawSeed: TEST_SEED, seedFamily: 'GATE', settings, ledger, counter: stub(), profiles: { real }, cells, stop: { minChats: 1, minTurns: 1, cap: 1, step: 1, width: 1.5 }, controlsB: 2000 })
        expect(res.status).toBe('VALID')
        expect(res.verdict).toBe('INCONCLUSIVE') // one chat per cell reaches the cap
        expect(Object.keys(res.cellChats as object).sort()).toEqual(['M4-en', 'M4-ko', 'NF-real-en', 'NF-real-ko'])
        ledger = res.ledger
        const e = ledger.entries.find((x) => x.type === 'attempt') as Entry
        expect(e).toMatchObject({ builder: 'rare', outcome: 'VALID', verdict: 'INCONCLUSIVE', seedFamily: 'GATE', settingsSha: settings.sha256 })
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ltm-s0-e1-'))
        try {
            const { ledger: _l, ...report } = res
            REPORT.writeReport(out, report)
            const json = JSON.parse(fs.readFileSync(path.join(out, 'gate-report.json'), 'utf8')) as Record<string, unknown>
            for (const k of ['builder', 'status', 'verdict', 'validity', 'cellChats', 'provenance', 'settings', 'history']) expect(Object.keys(json)).toContain(k)
            expect(fs.existsSync(path.join(out, 'gate-report.md'))).toBe(true)
        } finally {
            fs.rmSync(out, { recursive: true, force: true })
        }
        // the first valid attempt is final: nothing more for this builder
        expect(ATT.tryAttempt(ledger, { ...e, kind: 'NOISE', seedFamily: 'GATE_R', drawSeed: 620001, outcome: 'INVALID', invalidClass: 'CONTROL', verdict: undefined }).ok).toBe(false)
    }, SLOW)
})
