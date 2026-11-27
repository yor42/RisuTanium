import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { DenseEmbedder } from '../dense'
import { tokenize } from '../lexical'
import { discardChroMemoryIndex, getLastChroMemoryTrace, resetChroMemoryShadowForTests, runChroMemorySafely, type ChroMemoryTrace, type ShadowDeps } from '../shadow'
import { DIMS, buildSend, conceptEmbedder, deps, directIndexer, len, ltmOf, paraphraseChat, sharedTokens, type ConceptEmbedder } from './denseFixtures'

const hooks = vi.hoisted(() => ({ fuseThrows: false }))
vi.mock('../dense', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../dense')>()
    return {
        ...actual,
        fuseOrders: (...args: Parameters<typeof actual.fuseOrders>) => {
            if (hooks.fuseThrows) throw new Error('fuse boom')
            return actual.fuseOrders(...args)
        },
    }
})

const unhandled = vi.fn()

beforeEach(() => {
    resetChroMemoryShadowForTests()
    hooks.fuseThrows = false
    unhandled.mockClear()
    process.on('unhandledRejection', unhandled)
})
afterEach(() => {
    process.off('unhandledRejection', unhandled)
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const EN = { target: 'My puppy chewed the sofa again yesterday.', query: 'Remind me about the dog' }
const KO = { target: '어제 강아지가 소파를 물어뜯었어요.', query: '반려견에 대해 알려줘' }
/** Where the paraphrase target sits among the dropped records. */
const TARGET_AT = 5

function chatOf(c: { target: string, query: string }) {
    return paraphraseChat(c.target, c.query, { targetAt: TARGET_AT })
}

/** The keyword run of the same chat on its own chat id: the order a failed hybrid send must equal. */
async function lexicalRun(texts: string[], d0: number) {
    const b = await buildSend({ texts, d0, chatId: 'lexical-twin', ltm: ltmOf({ budgetTokens: 400 }) })
    const placed = await runChroMemorySafely(b.args, deps().d)
    return { block: placed?.block ?? null, trace: getLastChroMemoryTrace() as ChroMemoryTrace }
}

interface Rig {
    embedder: ConceptEmbedder
    indexer: ReturnType<typeof directIndexer>
    send(spec?: { texts?: string[], raws?: string[], chatId?: string, embedder?: ShadowDeps['embedder'] }): Promise<{ block: string | null, trace: ChroMemoryTrace }>
}

/** A hybrid chat: the first send finds no vectors and schedules the test indexer; later sends recall by meaning. */
function rig(c: { target: string, query: string }, embedder: ConceptEmbedder = conceptEmbedder()): Rig {
    const indexer = directIndexer()
    const base = chatOf(c)
    return {
        embedder,
        indexer,
        async send(spec = {}) {
            const b = await buildSend({ texts: spec.texts ?? base.texts, d0: base.d0, raws: spec.raws, chatId: spec.chatId })
            const placed = await runChroMemorySafely(b.args, deps({ embedder: spec.embedder ?? (() => ({ embedder, reason: null })), scheduleDense: indexer.schedule }).d)
            await indexer.idle()
            return { block: placed?.block ?? null, trace: getLastChroMemoryTrace() as ChroMemoryTrace }
        },
    }
}

describe('fixture self-check', () => {
    test.each([['English', EN], ['Korean', KO]])('%s: the query shares no token with any chat text and the keyword order misses the target', async (_name, c) => {
        const { texts, d0 } = chatOf(c)
        for (const t of texts.slice(0, -1)) expect(sharedTokens(c.query, t), t).toEqual([])
        expect(tokenize(c.query).length).toBeGreaterThan(0)
        const lex = await lexicalRun(texts, d0)
        expect(lex.block).not.toBeNull()
        expect(lex.block).not.toContain(c.target)
        expect(lex.trace.query?.terms).toEqual([])
    })
})

describe('R1 hybrid recalls a paraphrase the keyword order misses', () => {
    test.each([['English', EN], ['Korean', KO]])('regression reproducer, %s: the second send packs the target', async (_name, c) => {
        const r = rig(c)
        const first = await r.send()
        expect(first.trace.dense).toMatchObject({ state: 'building', vectors: 0 })
        const second = await r.send()
        expect(second.block).toContain(c.target)
        expect(second.trace.outcome).toBe('injected')
        expect(second.trace.dense).toMatchObject({ state: 'ready', reason: null })
    })
})

describe('R2 a dense failure keeps the keyword result and says why', () => {
    test('regression reproducer: a throwing query gives the lexical block and items, paused with the error reason', async () => {
        const { texts, d0 } = chatOf(EN)
        const lex = await lexicalRun(texts, d0)
        resetChroMemoryShadowForTests()
        const e = conceptEmbedder('concept-v1', { embedQuery: async () => { throw new Error('upstream exploded') } })
        const r = rig(EN, e)
        await r.send()
        const second = await r.send()
        expect(second.trace.dense).toMatchObject({ state: 'paused', reason: 'error' })
        expect(second.trace.outcome).not.toBe('error')
        expect(second.block).toBe(lex.block)
        expect(second.trace.items).toEqual(lex.trace.items)
    })

    test('regression reproducer: an auth-looking failure is reported as auth', async () => {
        const e = conceptEmbedder('concept-v1', { embedQuery: async () => { throw new Error('{"error":"invalid_api_key"}') } })
        const r = rig(EN, e)
        await r.send()
        expect((await r.send()).trace.dense).toMatchObject({ state: 'paused', reason: 'auth' })
    })

    test('regression reproducer: no embedder gives the lexical result and the refusal reason, and nothing is indexed', async () => {
        const { texts, d0 } = chatOf(EN)
        const lex = await lexicalRun(texts, d0)
        resetChroMemoryShadowForTests()
        const r = rig(EN)
        const out = await r.send({ embedder: () => ({ embedder: null, reason: 'local-model-on-phone' }) })
        expect(out.trace.dense).toMatchObject({ state: 'paused', reason: 'local-model-on-phone' })
        expect(out.block).toBe(lex.block)
        expect(r.indexer.jobs).toEqual([])
        expect(r.embedder.queries).toEqual([])
    })

    test('regression reproducer: a throwing factory reads as no provider', async () => {
        const r = rig(EN)
        const out = await r.send({ embedder: () => { throw new Error('factory boom') } })
        expect(out.trace.dense).toMatchObject({ state: 'paused', reason: 'no-provider' })
        expect(out.trace.outcome).not.toBe('error')
    })

    test('regression reproducer: after a failure the next send skips the query while the pause lasts', async () => {
        const e = conceptEmbedder('concept-v1', { embedQuery: async () => { throw new Error('socket hang up') } })
        const calls = vi.fn(e.embedQuery)
        e.embedQuery = calls
        const r = rig(EN, e)
        await r.send()
        await r.send()
        expect(calls).toHaveBeenCalledTimes(1)
        const third = await r.send()
        expect(calls).toHaveBeenCalledTimes(1)
        expect(third.trace.dense).toMatchObject({ state: 'paused', reason: 'error' })
    })
})

describe('R3 a hung query is cut at the time limit', () => {
    test('regression reproducer: timeout at 1500 ms, a late rejection stays handled, and the next send skips the query', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        let rejectLate: (e: Error) => void = () => {}
        let queries = 0
        const e = conceptEmbedder('concept-v1', {
            embedQuery: () => {
                queries++
                return new Promise<Float32Array>((_, reject) => { rejectLate = reject })
            },
        })
        const r = rig(EN, e)
        await r.send()
        const pending = r.send()
        await vi.advanceTimersByTimeAsync(1499)
        let settled = false
        void pending.then(() => { settled = true })
        await vi.advanceTimersByTimeAsync(0)
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        const second = await pending
        expect(second.trace.dense).toMatchObject({ state: 'paused', reason: 'timeout' })
        expect(second.trace.dense?.queryMs).toBeGreaterThanOrEqual(0)
        expect(second.trace.outcome).toBe('injected')
        rejectLate(new Error('late socket error'))
        await vi.advanceTimersByTimeAsync(3000)
        expect(unhandled).not.toHaveBeenCalled()
        const third = await r.send()
        expect(queries).toBe(1)
        expect(third.trace.dense).toMatchObject({ state: 'paused', reason: 'timeout' })
        await vi.advanceTimersByTimeAsync(60_000)
        const fourth = r.send()
        await vi.advanceTimersByTimeAsync(1500)
        await fourth
        expect(queries).toBe(2)
    }, 20_000)
})

describe('R4 one query per send, none without vectors', () => {
    test('regression reproducer: an empty store makes no query, a filled one makes exactly one', async () => {
        const r = rig(EN)
        await r.send()
        expect(r.embedder.queries).toEqual([])
        await r.send()
        expect(r.embedder.queries).toHaveLength(1)
        await r.send()
        expect(r.embedder.queries).toHaveLength(2)
    })

    test('the query is the newest message text', async () => {
        const r = rig(EN)
        await r.send()
        await r.send()
        expect(r.embedder.queries).toEqual([EN.query])
    })
})

describe('R5 the trace ranks', () => {
    test('regression reproducer: items carry numeric dense and fused ranks and the lexical place', async () => {
        const r = rig(EN)
        await r.send()
        const second = await r.send()
        const hit = second.trace.items.find((i) => i.source.index === TARGET_AT)
        expect(hit).toBeDefined()
        // The keyword order is newest first when no term matches: 30 dropped records, the target is the sixth oldest.
        expect(hit!.rank).toEqual({ lexical: 30 - TARGET_AT, dense: 1, fused: 1 })
        for (const item of second.trace.items) {
            expect(typeof item.rank.dense).toBe('number')
            expect(typeof item.rank.fused).toBe('number')
        }
        expect(second.trace.dense).toMatchObject({ state: 'ready', vectors: 30, units: 30 })
    })
})

describe('G-lex the keyword path is untouched', () => {
    const settings: Array<[string, unknown]> = [
        ['absent', undefined],
        ['lexical', ltmOf({ budgetTokens: 400, retrieval: 'lexical' })],
        ['a different case', { budgetTokens: 400, retrieval: 'Hybrid' }],
        ['a boolean', { budgetTokens: 400, retrieval: true }],
        ['an object', { budgetTokens: 400, retrieval: { mode: 'hybrid' } }],
    ]
    test.each(settings)('compatibility guard (passes before and after), %s: no factory read, no hook read, trace unchanged with a null dense', async (_name, ltm) => {
        const { texts, d0 } = chatOf(EN)
        const plain = await buildSend({ texts, d0, ltm })
        await runChroMemorySafely(plain.args, deps().d)
        const expected = getLastChroMemoryTrace() as ChroMemoryTrace
        resetChroMemoryShadowForTests()
        const watched = deps().d
        Object.defineProperty(watched, 'embedder', { get() { throw new Error('embedder read on the keyword path') } })
        Object.defineProperty(watched, 'scheduleDense', { get() { throw new Error('hook read on the keyword path') } })
        const b = await buildSend({ texts, d0, ltm })
        await runChroMemorySafely(b.args, watched)
        const trace = getLastChroMemoryTrace() as ChroMemoryTrace
        expect(trace.outcome).toBe('injected')
        expect(trace).toEqual(expected)
        expect(trace.dense ?? null).toBeNull()
        for (const item of trace.items) expect(item.rank.dense ?? null).toBeNull()
    })
})

/** Microtask turns until a promise settles. */
async function turnsOf(p: Promise<unknown>): Promise<number> {
    let done = false
    void p.then(() => { done = true }, () => { done = true })
    let n = 0
    while (!done && n < 100_000) {
        await Promise.resolve()
        n++
    }
    return n
}

/** Measured on base 63f72b3d7 with this same fixture; a lexical send must not gain an await. */
const LEXICAL_SEND_TURNS = 58

describe('G-ticks the keyword path adds no await', () => {
    test('compatibility guard pinned to base: a lexical send settles in the base number of microtask turns', async () => {
        const { texts, d0 } = chatOf(EN)
        const b = await buildSend({ texts, d0, ltm: ltmOf({ budgetTokens: 400 }) })
        const turns = await turnsOf(runChroMemorySafely(b.args, deps().d))
        expect(turns).toBe(LEXICAL_SEND_TURNS)
    })
})

describe('G-shadow hybrid in a shadow send stays lexical', () => {
    test('compatibility guard: no factory call, no query, no indexing after a minute; the trace says off', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        const embedder = conceptEmbedder()
        const factory = vi.fn(() => ({ embedder, reason: null }))
        const indexer = directIndexer()
        const { texts, d0 } = chatOf(EN)
        const b = await buildSend({ texts, d0 })
        const out = await runChroMemorySafely({ ...b.args, inject: null }, deps({ embedder: factory, scheduleDense: indexer.schedule }).d)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(out).toBeNull()
        expect(factory).not.toHaveBeenCalled()
        expect(embedder.queries).toEqual([])
        expect(embedder.documents).toEqual([])
        expect(indexer.jobs).toEqual([])
        const trace = getLastChroMemoryTrace() as ChroMemoryTrace
        expect(trace.mode).toBe('shadow')
        expect(trace.dense).toMatchObject({ state: 'off', reason: 'shadow-mode' })
        expect(trace.items.every((i) => i.rank.dense === null && i.rank.fused === null)).toBe(true)
    })
})

describe('G-internal a fault inside the dense step never fails the send', () => {
    test('compatibility guard: a vector whose length throws gives the lexical result, internal, and sets no pause', async () => {
        const { texts, d0 } = chatOf(EN)
        const lex = await lexicalRun(texts, d0)
        resetChroMemoryShadowForTests()
        const bad = new Float32Array(DIMS)
        Object.defineProperty(bad, 'length', { get() { throw new Error('length boom') } })
        const e = conceptEmbedder('concept-v1', { embedQuery: async () => bad })
        const calls = vi.fn(e.embedQuery)
        e.embedQuery = calls
        const r = rig(EN, e)
        await r.send()
        const second = await r.send()
        expect(second.trace.dense).toMatchObject({ state: 'paused', reason: 'internal' })
        expect(second.trace.outcome).toBe('injected')
        expect(second.block).toBe(lex.block)
        await r.send()
        expect(calls).toHaveBeenCalledTimes(2)
    })

    test('compatibility guard: fusion itself throwing is caught the same way', async () => {
        const { texts, d0 } = chatOf(EN)
        const lex = await lexicalRun(texts, d0)
        resetChroMemoryShadowForTests()
        const r = rig(EN)
        await r.send()
        hooks.fuseThrows = true
        const second = await r.send()
        expect(second.trace.dense).toMatchObject({ state: 'paused', reason: 'internal' })
        expect(second.trace.outcome).toBe('injected')
        expect(second.block).toBe(lex.block)
        hooks.fuseThrows = false
        await r.send()
        expect(r.embedder.queries).toHaveLength(2)
    })
})

describe('G-sched a scheduler fault never fails the send', () => {
    test('compatibility guard: scheduleDense throwing on a hybrid send still resolves with the block', async () => {
        const { texts, d0 } = chatOf(EN)
        const lex = await lexicalRun(texts, d0)
        resetChroMemoryShadowForTests()
        const b = await buildSend({ texts, d0 })
        const scheduleDense = vi.fn(() => { throw new Error('schedule boom') })
        const placed = await runChroMemorySafely(b.args, deps({ embedder: () => ({ embedder: conceptEmbedder(), reason: null }), scheduleDense }).d)
        expect(scheduleDense).toHaveBeenCalled()
        expect(placed?.block).toBe(lex.block)
        expect((getLastChroMemoryTrace() as ChroMemoryTrace).outcome).toBe('injected')
    })
})

describe('G-model a model change drops the vectors', () => {
    test('compatibility guard: a new modelKey clears the store and makes no query until it is filled', async () => {
        const a = conceptEmbedder('model-a')
        const r = rig(EN, a)
        await r.send()
        expect((await r.send()).trace.dense).toMatchObject({ state: 'ready', vectors: 30 })
        const b = conceptEmbedder('model-b')
        const out = await r.send({ embedder: () => ({ embedder: b, reason: null }) })
        expect(out.trace.dense).toMatchObject({ state: 'building', vectors: 0 })
        expect(b.queries).toEqual([])
    })
})

describe('G-edit an edited record never uses the old vector', () => {
    test('compatibility guard: the edited unit counts as unvectored', async () => {
        const r = rig(EN)
        await r.send()
        expect((await r.send()).trace.dense).toMatchObject({ vectors: 30 })
        const edited = chatOf(EN).texts.slice()
        edited[TARGET_AT] = 'A pooch ate my shoe last night.'
        const out = await r.send({ texts: edited })
        expect(out.trace.dense).toMatchObject({ state: 'partial', vectors: 29, units: 30 })
    })
})

describe('G-ping chats switch without re-embedding, and only two chats keep vectors', () => {
    test('compatibility guard: A-B-A re-embeds nothing for A', async () => {
        const r = rig(EN)
        await r.send({ chatId: 'A' })
        expect((await r.send({ chatId: 'A' })).trace.dense).toMatchObject({ state: 'ready' })
        await r.send({ chatId: 'B' })
        const documentCalls = r.embedder.documents.length
        const back = await r.send({ chatId: 'A' })
        expect(back.trace.dense).toMatchObject({ state: 'ready', vectors: 30 })
        expect(back.block).toContain(EN.target)
        expect(r.embedder.documents.length).toBe(documentCalls)
    })

    test('compatibility guard: the same raw text with a new wrapped text gets no vector after a switch', async () => {
        const r = rig(EN)
        const { texts } = chatOf(EN)
        await r.send({ chatId: 'A' })
        await r.send({ chatId: 'A' })
        await r.send({ chatId: 'B' })
        const rewritten = texts.slice()
        rewritten[TARGET_AT] = 'A pooch ate my shoe last night.'
        const back = await r.send({ chatId: 'A', texts: rewritten, raws: texts })
        expect(back.trace.dense).toMatchObject({ state: 'partial', vectors: 29, units: 30 })
    })

    test('compatibility guard: a third chat disposes the oldest, and returning to it starts empty', async () => {
        const r = rig(EN)
        await r.send({ chatId: 'A' })
        await r.send({ chatId: 'B' })
        const storeA = r.indexer.jobs[0].store
        expect(storeA.disposed).toBe(false)
        await r.send({ chatId: 'C' })
        expect(storeA.disposed).toBe(true)
        const back = await r.send({ chatId: 'A' })
        expect(back.trace.dense).toMatchObject({ state: 'building', vectors: 0 })
    })

    test('compatibility guard: a discard disposes the chat\'s store', async () => {
        const r = rig(EN)
        await r.send({ chatId: 'A' })
        const store = r.indexer.jobs[0].store
        discardChroMemoryIndex('owner:A')
        expect(store.disposed).toBe(true)
        expect(r.indexer.jobs[0].isLive()).toBe(false)
    })
})

describe('G-pack the pack drops by the fused order', () => {
    const X = 'zebra xmark'
    const Y = 'kangaroo kangaroo ymark'
    const Z = 'zzmark'
    const texts = [X, Y, Z, 'Tail 0 keeps going.', 'Tail 1 keeps going.', 'Tail 2 keeps going.', 'Tail 3 keeps going.', 'zebra kangaroo']
    const countBlock = async (b: string): Promise<number> => (b.split('\n').length > 2 ? 10_000 : len(b) + 3)
    const query = Float32Array.of(1, 0, 0)

    test('compatibility guard: with fused X,Y,Z and lexical Y,X,Z one forced drop leaves X, where the keyword order leaves Y', async () => {
        const lexB = await buildSend({ texts, d0: 3, chatId: 'lexical-twin', ltm: ltmOf({ budgetTokens: 400 }) })
        const lexPlaced = await runChroMemorySafely(lexB.args, deps({ countBlock }).d)
        expect(lexPlaced?.block).toContain(Y)
        expect(lexPlaced?.block).not.toContain(X)
        expect(getLastChroMemoryTrace()?.query?.terms).toEqual(['zebra', 'kangaroo'])
        resetChroMemoryShadowForTests()

        const e: DenseEmbedder = {
            modelKey: 'seeded',
            embedQuery: async () => query,
            embedDocuments: async (t) => t.map(() => new Float32Array(3)),
        }
        const indexer = directIndexer()
        const run = async () => {
            const b = await buildSend({ texts, d0: 3 })
            return runChroMemorySafely(b.args, deps({ countBlock, embedder: () => ({ embedder: e, reason: null }), scheduleDense: indexer.schedule }).d)
        }
        await run()
        await indexer.idle()
        const job = indexer.jobs[0]
        const vec: Record<string, Float32Array> = { [X]: Float32Array.of(1, 0, 0), [Z]: Float32Array.of(0.8, 0.6, 0), [Y]: Float32Array.of(0.5, 0.866, 0) }
        for (const u of job.units()) job.store.set(u, vec[u.text])
        const placed = await run()
        const trace = getLastChroMemoryTrace() as ChroMemoryTrace
        expect(trace.dense).toMatchObject({ state: 'ready', vectors: 3 })
        expect(placed?.block).toContain(X)
        expect(placed?.block).not.toContain(Y)
        expect(trace.items.map((i) => i.rank.fused)).toEqual([1])
    })
})
