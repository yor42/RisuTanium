import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    DENSE_IDLE_MS,
    DENSE_TOP_K,
    DenseStore,
    DenseTimeoutError,
    PAUSE_AUTH_MS,
    PAUSE_ERROR_MS,
    QUERY_TIMEOUT_MS,
    RRF_K,
    classifyDenseError,
    currentDensePause,
    denseOrder,
    fuseOrders,
    pauseDenseAfter,
    queryInput,
    raceTimeout,
    resetDensePauseForTests,
} from '../dense'
import { rawHash } from '../records'
import { UNIT_CHARS } from '../units'
import { unitOf } from './denseFixtures'

describe('constants', () => {
    test('compatibility guard: the settled values', () => {
        expect(DENSE_TOP_K).toBe(200)
        expect(RRF_K).toBe(60)
        expect(QUERY_TIMEOUT_MS).toBe(1500)
        expect(DENSE_IDLE_MS).toBe(12_000)
        expect(PAUSE_AUTH_MS).toBe(600_000)
        expect(PAUSE_ERROR_MS).toBe(60_000)
    })
})

describe('G-fuse reciprocal rank fusion', () => {
    const [A, B, C] = [unitOf('a'), unitOf('b'), unitOf('c')]

    test('guard (new module): k = 60 puts the doubly ranked unit first where k = 0 would tie it away', () => {
        // Lexical A,B; dense C,B. B holds ranks 2 and 2 (1/62 + 1/62); A and C hold one rank 1 each (1/61).
        const { order } = fuseOrders([A, B], 2, [A, B, C], [2, 1])
        expect(order).toEqual([B, C, A])
    })

    test('guard (new module): the newer unit wins a tie', () => {
        expect(fuseOrders([A], 1, [A, B], [1]).order).toEqual([B, A])
        expect(fuseOrders([A], 1, [B, A], [0]).order).toEqual([A, B])
    })

    test('guard (new module): a unit without a vector keeps its keyword place', () => {
        // C leads the dense list alone; A and B are scored by keywords and have no vector.
        const { order } = fuseOrders([A, B, C], 2, [C, A, B], [0])
        expect(order).toEqual([A, C, B])
    })

    test('guard (new module): the unscored tail follows in its keyword order and nothing repeats or goes missing', () => {
        const us = Array.from({ length: 6 }, (_, i) => unitOf(`u${i}`))
        const lexical = [us[3], us[1], us[5], us[4], us[2], us[0]]
        const { order, ranks } = fuseOrders(lexical, 2, us, [0, 5])
        expect(new Set(order).size).toBe(6)
        expect(order).toHaveLength(6)
        // The two units outside both lists keep their keyword order behind the fused head.
        expect(order).toEqual([us[3], us[0], us[5], us[1], us[4], us[2]])
        expect(ranks.get(us[3])).toMatchObject({ lexical: 1, dense: null })
        expect(ranks.get(us[0])).toMatchObject({ lexical: 6, dense: 1 })
        expect(ranks.get(us[5])).toMatchObject({ lexical: 3, dense: 2 })
        order.forEach((u, i) => expect(ranks.get(u)?.fused).toBe(i + 1))
    })

    test('guard (new module): an empty dense list leaves the keyword order', () => {
        const us = Array.from({ length: 5 }, (_, i) => unitOf(`u${i}`))
        const lexical = [us[2], us[4], us[3], us[1], us[0]]
        expect(fuseOrders(lexical, 2, us, []).order).toEqual(lexical)
        expect(fuseOrders(lexical, 0, us, []).order).toEqual(lexical)
    })
})

describe('G-topk the dense list is capped and partial stores are counted', () => {
    function storeOf(units: ReturnType<typeof unitOf>[], vectored: number): DenseStore {
        const store = new DenseStore()
        units.slice(0, vectored).forEach((u, i) => store.set(u, Float32Array.of(1, i / 100)))
        return store
    }

    test('guard (new module): only 200 vectored units join; the 201st stays behind a newer unvectored unit', () => {
        const units = Array.from({ length: 300 }, (_, i) => unitOf(`u${i}`))
        // u0..u249 have vectors, the cosine falling with the index; u250..u299 have none and are newer.
        const store = storeOf(units, 250)
        const ranking = denseOrder(store, units, Float32Array.of(1, 0))
        expect(ranking.valid).toBe(250)
        expect(ranking.top).toHaveLength(DENSE_TOP_K)
        expect(ranking.top[0]).toBe(0)
        const lexical = [...units].reverse()
        const { order } = fuseOrders(lexical, 0, units, ranking.top)
        expect(order[DENSE_TOP_K]).toBe(units[299])
        expect(order.indexOf(units[249])).toBeGreaterThan(order.indexOf(units[299]))
    })

    test('guard (new module): a half-vectored chat counts only the vectored units', () => {
        const units = Array.from({ length: 10 }, (_, i) => unitOf(`u${i}`))
        const ranking = denseOrder(storeOf(units, 5), units, Float32Array.of(1, 0))
        expect(ranking.valid).toBe(5)
        expect(ranking.top).toHaveLength(5)
    })

    test('guard (new module): a wrong dimension or a zero vector is no vector, and a zero query ranks nothing', () => {
        const units = [unitOf('a'), unitOf('b'), unitOf('c')]
        const store = new DenseStore()
        store.set(units[0], Float32Array.of(1, 0))
        store.set(units[1], Float32Array.of(1, 0, 0))
        store.set(units[2], Float32Array.of(0, 0))
        expect(denseOrder(store, units, Float32Array.of(1, 0))).toEqual({ top: [0], valid: 1 })
        expect(denseOrder(store, units, Float32Array.of(0, 0))).toEqual({ top: [], valid: 0 })
    })

    test('guard (new module): equal cosines put the newer unit first', () => {
        const units = [unitOf('a'), unitOf('b')]
        const store = new DenseStore()
        for (const u of units) store.set(u, Float32Array.of(1, 0))
        expect(denseOrder(store, units, Float32Array.of(1, 0)).top).toEqual([1, 0])
    })
})

describe('G-query the query text', () => {
    test('guard (new module): the tail wins, never the head', () => {
        const text = 'HEAD' + 'a'.repeat(3000) + 'TAIL'
        const q = queryInput(text)
        expect(Array.from(q)).toHaveLength(UNIT_CHARS)
        expect(q.endsWith('TAIL')).toBe(true)
        expect(q.includes('HEAD')).toBe(false)
    })

    test('guard (new module): a surrogate pair is never cut', () => {
        const q = queryInput('x'.repeat(1799) + '\u{1F600}' + 'y'.repeat(1199))
        expect(q.startsWith('\u{1F600}')).toBe(true)
        expect(Array.from(q)).toHaveLength(UNIT_CHARS)
        const emoji = queryInput('\u{1F600}'.repeat(3000))
        expect(Array.from(emoji)).toHaveLength(UNIT_CHARS)
        expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(emoji)).toBe(false)
    })

    test('guard (new module): a short text is unchanged', () => {
        expect(queryInput('hello')).toBe('hello')
    })
})

describe('DenseStore', () => {
    test('guard (new module): a vector counts only while the unit text is the text it was embedded from', () => {
        const store = new DenseStore()
        const v = Float32Array.of(1, 2)
        store.set(unitOf('k', 'old text'), v)
        expect(store.get(unitOf('k', 'old text'))).toBe(v)
        expect(store.get(unitOf('k', 'new text'))).toBeUndefined()
        expect(store.get(unitOf('other', 'old text'))).toBeUndefined()
        expect(store.get(unitOf('k', 'old text', 1))).toBeUndefined()
    })

    test('guard (new module): a model change clears, prune drops departed units, a disposed store takes no writes', () => {
        const store = new DenseStore()
        store.useModel('a')
        const u0 = unitOf('k', 'x', 0)
        const u1 = unitOf('k', 'y', 1)
        const gone = unitOf('gone')
        store.set(u0, Float32Array.of(1))
        store.set(u1, Float32Array.of(1))
        store.set(gone, Float32Array.of(1))
        expect(store.size).toBe(3)
        store.prune([u0])
        expect(store.size).toBe(1)
        expect(store.get(u1)).toBeUndefined()
        store.useModel('a')
        expect(store.size).toBe(1)
        store.useModel('b')
        expect(store.size).toBe(0)
        store.dispose()
        store.set(u0, Float32Array.of(1))
        expect(store.size).toBe(0)
        expect(store.disposed).toBe(true)
    })
})

describe('provider pause', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        resetDensePauseForTests()
    })
    afterEach(() => {
        vi.useRealTimers()
        resetDensePauseForTests()
    })

    test('guard (new module): an authorization or quota body pauses 10 minutes, any other 60 seconds', () => {
        expect(classifyDenseError(new Error('HTTP 401 Unauthorized'))).toBe('auth')
        expect(classifyDenseError('{"error":{"message":"You exceeded your current quota"}}')).toBe('auth')
        expect(classifyDenseError(new Error('429 too many'))).toBe('auth')
        expect(classifyDenseError(new Error('fetch failed'))).toBe('error')
        expect(classifyDenseError(new Error('port 14015 refused'))).toBe('error')

        expect(pauseDenseAfter(new Error('invalid_api_key'))).toBe('auth')
        vi.advanceTimersByTime(PAUSE_AUTH_MS - 1)
        expect(currentDensePause()?.reason).toBe('auth')
        vi.advanceTimersByTime(1)
        expect(currentDensePause()).toBeNull()

        expect(pauseDenseAfter(new Error('socket hang up'))).toBe('error')
        vi.advanceTimersByTime(PAUSE_ERROR_MS - 1)
        expect(currentDensePause()?.reason).toBe('error')
        vi.advanceTimersByTime(1)
        expect(currentDensePause()).toBeNull()

        expect(pauseDenseAfter(new DenseTimeoutError())).toBe('timeout')
        vi.advanceTimersByTime(PAUSE_ERROR_MS)
        expect(currentDensePause()).toBeNull()
    })
})

describe('raceTimeout', () => {
    afterEach(() => vi.useRealTimers())

    test('guard (new module): the value wins and clears the timer', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        await expect(raceTimeout(Promise.resolve(7), 1500)).resolves.toBe(7)
        expect(vi.getTimerCount()).toBe(0)
    })

    test('guard (new module): the timer wins with a timeout error and a later rejection stays handled', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        try {
            let reject: (e: Error) => void = () => {}
            const raced = raceTimeout(new Promise<number>((_, r) => { reject = r }), 1500)
            const outcome = raced.then(() => 'value', (e: unknown) => e)
            await vi.advanceTimersByTimeAsync(1500)
            expect(await outcome).toBeInstanceOf(DenseTimeoutError)
            reject(new Error('late'))
            await vi.advanceTimersByTimeAsync(10)
            expect(unhandled).not.toHaveBeenCalled()
        } finally {
            process.off('unhandledRejection', unhandled)
        }
    })

    test('guard (new module): a rejection before the limit passes through', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
        await expect(raceTimeout(Promise.reject(new Error('nope')), 1500)).rejects.toThrow('nope')
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('G6 a loaded entry is served only on its text hash', () => {
    const loaded = (u: ReturnType<typeof unitOf>, over: Partial<{ textHash: string, seq: number }> = {}) => ({
        kind: 'loaded' as const,
        modelKey: 'm',
        head: { f: 'chromemory-vectors' as const, v: 1 as const, g: 3, w: '', owner: 'o', chat: 'c', model: 'x', label: 'l', dim: 2, chunks: [4], at: 1 },
        rows: [{ key: u.key, ordinal: u.ordinal, textHash: over.textHash ?? rawHash(u.text), vec: new Float32Array([1, 0]), seq: over.seq ?? 4 }],
        chunks: [4],
        dropped: 0,
        rowsRead: 1,
    })

    test('guard (new API): the unit with the persisted text gets the vector, another text does not, and the text is then cached', () => {
        const store = new DenseStore()
        store.useModel('m')
        const u = unitOf('k', 'the text')
        store.importLoaded(loaded(u))
        expect(store.get(unitOf('k', 'another text'))).toBeUndefined()
        expect(store.get(u)).toEqual(new Float32Array([1, 0]))
        expect(store.get(unitOf('k', 'another text'))).toBeUndefined()
        expect(store.persistedG).toBe(3)
    })

    test('guard (new API): an import fills only absent keys, never replaces a fresh vector, and is refused for another model or a disposed store', () => {
        const store = new DenseStore()
        store.useModel('m')
        const u = unitOf('k', 'the text')
        store.set(u, new Float32Array([0, 1]))
        store.importLoaded(loaded(u))
        expect(store.get(u)).toEqual(new Float32Array([0, 1]))
        const other = new DenseStore()
        other.useModel('another')
        other.importLoaded(loaded(u))
        expect(other.size).toBe(0)
        const gone = new DenseStore()
        gone.useModel('m')
        gone.dispose()
        gone.importLoaded(loaded(u))
        expect(gone.size).toBe(0)
    })

    test('guard (new API): a set entry is unpersisted, a snapshot marks rows, a model change forgets the marks, dispose keeps them', () => {
        const store = new DenseStore()
        store.useModel('m')
        store.set(unitOf('a'), new Float32Array([1]))
        store.set(unitOf('b'), new Float32Array([1]))
        expect(store.hasUnpersisted()).toBe(true)
        const rows = store.snapshot()
        expect(rows.map((r) => r.seq)).toEqual([0, 0])
        rows.forEach((r) => r.mark(7))
        expect(store.hasUnpersisted()).toBe(false)
        store.persistedG = 2
        store.dispose()
        expect(store.persistedG).toBe(2)
        const second = new DenseStore()
        second.useModel('m')
        second.set(unitOf('a'), new Float32Array([1]))
        second.persistedG = 2
        second.useModel('other')
        expect(second.persistedG).toBeNull()
        expect(second.size).toBe(0)
    })
})
