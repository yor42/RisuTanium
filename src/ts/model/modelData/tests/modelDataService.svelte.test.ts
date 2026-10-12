/**
 * The stateful half of the OpenRouter model data: load, single-flight refresh,
 * the one write after each successful fetch, and the reactive getters. The
 * fetch, the byte store, the write permission and the clock are all injected
 * fakes; no test reaches a network or a real store.
 *
 * Labels: (F) feature test that fails against a missing or wrong
 * implementation on its own assertion; (G) guard.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushSync } from 'svelte'
import { LLMProvider } from '../../types'
import type { ByteStore, ReadResult, StoreCondition, WriteResult } from '../../../storage/store/contract'
import {
    OPENROUTER_DATA_KEY,
    decodeOpenRouterData,
    encodeOpenRouterData,
    parseOpenRouterModels,
    type OpenRouterData,
} from '../openrouterData'
import {
    createModelDataService,
    getModelContextLimit,
    getModelDataFetchedAt,
    getModelPricing,
    modelDataStatus,
    resetModelDataForTests,
    seedModelDataForTests,
    type ModelDataResponse,
    type ModelDataService,
} from '../modelDataService.svelte'
import fixture from './openrouterRows.fixture.json'

const T = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const gpt4o = { id: 'gpt-4o', provider: LLMProvider.OpenAI }
const db = { openrouterRequestModel: 'openai/gpt-3.5-turbo' }

/** A listing with one row, whose context identifies the fetch that produced it. */
function listing(context = 128000) {
    return { data: [{ id: 'openai/gpt-4o', context_length: context, pricing: { prompt: '0.0000025', completion: '0.00001' } }] }
}

function savedData(fetchedAt: number, context = 111): OpenRouterData {
    const data = parseOpenRouterModels(listing(context), fetchedAt)
    if (data === null) {
        throw new Error('listing must parse')
    }
    return data
}

interface WriteLog {
    key: string
    condition: StoreCondition
    bytes: Uint8Array
}

interface FakeStore extends ByteStore {
    files: Map<string, Uint8Array>
    writes: WriteLog[]
    reads: string[]
    /** While set, `read` waits for it; resolve it to continue. */
    readGate: Promise<void> | null
    readError: Error | null
    writeError: Error | null
}

function fakeStore(initial?: Uint8Array): FakeStore {
    const store: FakeStore = {
        capabilities: { conditionalWrites: false },
        files: new Map(),
        writes: [],
        reads: [],
        readGate: null,
        readError: null,
        writeError: null,
        async read(key: string): Promise<ReadResult> {
            store.reads.push(key)
            // The value as it was when the read started: a slow read hands back the old file.
            const bytes = store.files.get(key)
            if (store.readGate !== null) {
                await store.readGate
            }
            if (store.readError !== null) {
                throw store.readError
            }
            return { bytes: bytes ? bytes.slice() : null, version: null }
        },
        async write(key: string, bytes: Uint8Array, condition: StoreCondition): Promise<WriteResult> {
            if (store.writeError !== null) {
                throw store.writeError
            }
            store.writes.push({ key, condition, bytes: bytes.slice() })
            store.files.set(key, bytes.slice())
            return { version: null }
        },
        async delete(): Promise<void> { throw new Error('not used') },
        async deleteMany(): Promise<void> { throw new Error('not used') },
        async list(): Promise<string[]> { throw new Error('not used') },
        async has(key: string): Promise<boolean> { return store.files.has(key) },
    }
    if (initial) {
        store.files.set(OPENROUTER_DATA_KEY, initial)
    }
    return store
}

/** A gate: `wait` settles when `open` or `fail` is called. */
function gate() {
    let open!: () => void
    let fail!: (error: Error) => void
    const wait = new Promise<void>((resolve, reject) => { open = resolve; fail = reject })
    wait.catch(() => { })
    return { wait, open, fail }
}

/** Lets every already-queued promise continuation run: a macrotask turn drains the microtask queue. */
async function flush(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

interface Harness {
    store: FakeStore
    service: ModelDataService
    fetchImpl: ReturnType<typeof vi.fn<(url: string, init: { credentials: 'omit', signal: AbortSignal }) => Promise<ModelDataResponse>>>
    getStore: ReturnType<typeof vi.fn<() => Promise<ByteStore>>>
    canWrite: ReturnType<typeof vi.fn<() => Promise<boolean>>>
    clock: { now: number }
}

function harness(options: {
    store?: FakeStore
    respond?: () => Promise<ModelDataResponse>
    canWrite?: () => Promise<boolean>
} = {}): Harness {
    const store = options.store ?? fakeStore()
    const clock = { now: T }
    const fetchImpl = vi.fn<(url: string, init: { credentials: 'omit', signal: AbortSignal }) => Promise<ModelDataResponse>>(
        options.respond ?? (async () => ({ ok: true, json: async () => listing() })))
    const getStore = vi.fn(async (): Promise<ByteStore> => store)
    const canWrite = vi.fn(options.canWrite ?? (async () => true))
    const service = createModelDataService({ fetchImpl, getStore, canWrite, now: () => clock.now })
    return { store, service, fetchImpl, getStore, canWrite, clock }
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    resetModelDataForTests()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
})

afterEach(() => {
    vi.useRealTimers()
    errorSpy.mockRestore()
    resetModelDataForTests()
})

describe('load ordering: every entry waits for the saved file', () => {
    test('(F) S1a a refresh that finishes before a slow load does not lose to the late file', async () => {
        const store = fakeStore(encodeOpenRouterData(savedData(T - 2 * DAY, 111)))
        const slow = gate()
        store.readGate = slow.wait
        const h = harness({ store })

        const loading = h.service.boot(false)
        const refreshing = h.service.refreshNow()
        await flush()
        slow.open()
        await Promise.all([loading, refreshing])

        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(getModelDataFetchedAt()).toBe(T)
        expect(h.fetchImpl).toHaveBeenCalledTimes(1)
        expect(h.store.writes).toHaveLength(1)
    })

    test('(F) S1b a slow read that then fails: the refresh started meanwhile writes nothing', async () => {
        const store = fakeStore()
        const slow = gate()
        store.readGate = slow.wait
        const h = harness({ store })

        const loading = h.service.boot(false)
        const refreshing = h.service.refreshNow()
        await flush()
        slow.fail(new Error('read failed'))
        await expect(refreshing).resolves.toBe('ok')
        await loading

        expect(h.store.writes).toHaveLength(0)
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
    })

    test('(F) S1c saved data from an hour ago: refreshIfStale neither fetches nor writes, refreshNow does both', async () => {
        const h = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })

        await h.service.refreshIfStale()
        expect(h.fetchImpl).not.toHaveBeenCalled()
        expect(h.store.writes).toHaveLength(0)
        expect(getModelContextLimit(gpt4o, db)).toBe(111)

        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(h.fetchImpl).toHaveBeenCalledTimes(1)
        expect(h.store.writes).toHaveLength(1)
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
    })

    test('(F) the file is read once however many entries start', async () => {
        const h = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        await Promise.all([h.service.boot(false), h.service.refreshIfStale(), h.service.refreshNow()])
        expect(h.store.reads).toEqual([OPENROUTER_DATA_KEY])
    })

    test('(G) nothing is read before the first entry', async () => {
        const h = harness()
        await flush()
        expect(h.getStore).not.toHaveBeenCalled()
        expect(h.store.reads).toEqual([])
    })
})

describe('writes', () => {
    test('(F) S3 a successful fetch writes exactly one key, unconditionally, with the fetched data', async () => {
        const h = harness()
        await h.service.refreshNow()
        expect(h.store.writes).toHaveLength(1)
        expect(h.store.writes[0].key).toBe('modeldata/openrouter.json')
        expect(h.store.writes[0].condition).toBe('unconditional')
        expect(decodeOpenRouterData(h.store.writes[0].bytes)).toEqual(parseOpenRouterModels(listing(), T))
        expect([...h.store.files.keys()]).toEqual(['modeldata/openrouter.json'])
    })

    test('(F) S3 (E2) fetched content equal to the saved file is still written once', async () => {
        const same = encodeOpenRouterData(savedData(T, 128000))
        const h = harness({ store: fakeStore(same) })
        await h.service.refreshNow()
        expect(h.store.writes).toHaveLength(1)
        expect(h.store.writes[0].bytes).toEqual(same)
        await h.service.refreshNow()
        expect(h.store.writes).toHaveLength(2)
    })

    test('(F) S5 an unreadable file: data is fetched and shown, nothing is written for the session', async () => {
        const store = fakeStore()
        store.readError = new Error('disk gone')
        const h = harness({ store })
        await h.service.boot(false)
        expect(getModelContextLimit(gpt4o, db)).toBeUndefined()
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        await h.service.refreshNow()
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(h.store.writes).toHaveLength(0)
    })

    test('(F) S5 a store that cannot be reached counts as an unreadable file', async () => {
        const h = harness()
        h.getStore.mockRejectedValue(new Error('no store'))
        await expect(h.service.boot(true)).resolves.toBeUndefined()
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(h.store.writes).toHaveLength(0)
    })

    test.each([
        ['no file', undefined],
        ['garbage bytes', new TextEncoder().encode('not json')],
        ['another version', new TextEncoder().encode(JSON.stringify({ v: 2, priceUnit: 'usd-per-token', fetchedAt: T, limits: {}, pricing: {} }))],
    ])('(F) S5 %s: empty data, and the next success rewrites the file', async (_name, bytes) => {
        const h = harness({ store: fakeStore(bytes) })
        await h.service.boot(false)
        expect(getModelDataFetchedAt()).toBeNull()
        expect(h.fetchImpl).not.toHaveBeenCalled()
        await h.service.refreshNow()
        expect(h.store.writes).toHaveLength(1)
        expect(decodeOpenRouterData(h.store.files.get(OPENROUTER_DATA_KEY)!)?.limits['openai/gpt-4o']).toEqual({ context: 128000 })
    })

    test('(F) S6 a page that must not write: data is fetched and shown, nothing is written', async () => {
        const h = harness({ canWrite: async () => false })
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(h.canWrite).toHaveBeenCalled()
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(h.store.writes).toHaveLength(0)
    })

    test('(F) S6 a failing permission check or write keeps the fresh data and the ok outcome', async () => {
        const noPermission = harness({ canWrite: async () => { throw new Error('selection failed') } })
        await expect(noPermission.service.refreshNow()).resolves.toBe('ok')
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(modelDataStatus.lastOutcome).toBe('ok')

        resetModelDataForTests()
        const store = fakeStore()
        store.writeError = new Error('quota')
        const failing = harness({ store })
        await expect(failing.service.refreshNow()).resolves.toBe('ok')
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(modelDataStatus.lastOutcome).toBe('ok')
        expect(errorSpy).toHaveBeenCalled()
    })
})

describe('a failed refresh changes nothing', () => {
    const bodies: [string, () => Promise<ModelDataResponse>][] = [
        ['an HTTP error', async () => ({ ok: false, json: async () => listing() })],
        ['a thrown fetch', async () => { throw new TypeError('offline') }],
        ['a body that is not JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json') } })],
        ['a listing with no rows', async () => ({ ok: true, json: async () => ({ data: [] }) })],
        ['a body that is not a listing', async () => ({ ok: true, json: async () => ({ error: 'nope' }) })],
    ]

    test.each(bodies)('(F) S4 %s', async (_name, respond) => {
        const h = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - 2 * DAY, 111))), respond })
        await h.service.boot(false)
        await expect(h.service.refreshNow()).resolves.toBe('failed')
        expect(h.store.writes).toHaveLength(0)
        expect(getModelContextLimit(gpt4o, db)).toBe(111)
        expect(getModelDataFetchedAt()).toBe(T - 2 * DAY)
        expect(modelDataStatus.lastOutcome).toBe('failed')
        expect(modelDataStatus.refreshing).toBe(false)
    })

    test('(F) S4 a fetch that never answers is abandoned after 15 seconds', async () => {
        vi.useFakeTimers()
        const h = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - 2 * DAY))), respond: () => new Promise(() => { }) })
        const result = h.service.refreshNow()
        await vi.advanceTimersByTimeAsync(14_999)
        expect(modelDataStatus.refreshing).toBe(true)
        await vi.advanceTimersByTimeAsync(1)
        await expect(result).resolves.toBe('failed')
        expect(h.store.writes).toHaveLength(0)
        expect(modelDataStatus.refreshing).toBe(false)
        expect(modelDataStatus.lastOutcome).toBe('failed')
        expect(getModelDataFetchedAt()).toBe(T - 2 * DAY)
    })

    test('(F) S4 the 15 second limit covers a body that never arrives', async () => {
        vi.useFakeTimers()
        const h = harness({ respond: async () => ({ ok: true, json: () => new Promise<unknown>(() => { }) }) })
        const result = h.service.refreshNow()
        await vi.advanceTimersByTimeAsync(15_000)
        await expect(result).resolves.toBe('failed')
        expect(h.store.writes).toHaveLength(0)
    })

    test('(F) S4 the abort timer is cleared after a success and after a failure', async () => {
        vi.useFakeTimers()
        const ok = harness()
        await ok.service.refreshNow()
        expect(vi.getTimerCount()).toBe(0)
        const failed = harness({ respond: async () => { throw new Error('offline') } })
        await failed.service.refreshNow()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('(F) S4 the request is keyless: no credentials, an abort signal, the public listing URL', async () => {
        const h = harness()
        await h.service.refreshNow()
        const [url, init] = h.fetchImpl.mock.calls[0]
        expect(url).toBe('https://openrouter.ai/api/v1/models')
        expect(init.credentials).toBe('omit')
        expect(init.signal).toBeInstanceOf(AbortSignal)
        expect(Object.keys(init).sort()).toEqual(['credentials', 'signal'])
    })

    test('(G) a later success after a failure recovers', async () => {
        let attempt = 0
        const h = harness({ respond: async () => {
            attempt++
            if (attempt === 1) {
                throw new Error('offline')
            }
            return { ok: true, json: async () => listing() }
        } })
        await expect(h.service.refreshNow()).resolves.toBe('failed')
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(modelDataStatus.lastOutcome).toBe('ok')
        expect(h.store.writes).toHaveLength(1)
    })
})

describe('single flight', () => {
    test('(F) S7 two simultaneous manual refreshes make one fetch', async () => {
        const answer = gate()
        const h = harness({ respond: async () => { await answer.wait; return { ok: true, json: async () => listing() } } })
        const first = h.service.refreshNow()
        const second = h.service.refreshNow()
        await flush()
        expect(modelDataStatus.refreshing).toBe(true)
        answer.open()
        await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok'])
        expect(h.fetchImpl).toHaveBeenCalledTimes(1)
        expect(h.store.writes).toHaveLength(1)
    })

    test('(F) S7 a click during the boot auto-refresh shares its fetch', async () => {
        const answer = gate()
        const h = harness({ respond: async () => { await answer.wait; return { ok: true, json: async () => listing() } } })
        const booting = h.service.boot(true)
        await flush()
        expect(h.fetchImpl).toHaveBeenCalledTimes(1)
        const clicked = h.service.refreshNow()
        await flush()
        answer.open()
        await expect(clicked).resolves.toBe('ok')
        await booting
        expect(h.fetchImpl).toHaveBeenCalledTimes(1)
        expect(h.store.writes).toHaveLength(1)
    })

    test('(F) S7 sequential refreshes each fetch again', async () => {
        const h = harness()
        await h.service.refreshNow()
        await h.service.refreshNow()
        expect(h.fetchImpl).toHaveBeenCalledTimes(2)
    })
})

describe('when to refresh', () => {
    test.each([
        ['absent', undefined, true],
        ['older than a day', T - DAY - 1, true],
        ['exactly a day old', T - DAY, false],
        ['an hour old', T - HOUR, false],
        ['dated in the future', T + HOUR, true],
    ])('(F) S8 refreshIfStale with data %s', async (_name, fetchedAt, fetches) => {
        const bytes = fetchedAt === undefined ? undefined : encodeOpenRouterData(savedData(fetchedAt))
        const h = harness({ store: fakeStore(bytes) })
        await h.service.refreshIfStale()
        expect(h.fetchImpl).toHaveBeenCalledTimes(fetches ? 1 : 0)
        expect(h.store.writes).toHaveLength(fetches ? 1 : 0)
    })

    test('(F) S8 refreshNow ignores the age', async () => {
        const h = harness({ store: fakeStore(encodeOpenRouterData(savedData(T))) })
        await h.service.refreshNow()
        expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    })

    test('(F) S8 boot(false) loads the saved data and never fetches, even when there is none', async () => {
        const saved = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - 5 * DAY))) })
        await saved.service.boot(false)
        expect(getModelContextLimit(gpt4o, db)).toBe(111)
        expect(saved.fetchImpl).not.toHaveBeenCalled()

        resetModelDataForTests()
        const empty = harness()
        await empty.service.boot(false)
        expect(empty.fetchImpl).not.toHaveBeenCalled()
        expect(empty.store.writes).toHaveLength(0)
    })

    test('(F) S8 boot(true) fetches when the data is stale or missing and not when it is fresh', async () => {
        const stale = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - 2 * DAY))) })
        await stale.service.boot(true)
        expect(stale.fetchImpl).toHaveBeenCalledTimes(1)

        resetModelDataForTests()
        const missing = harness()
        await missing.service.boot(true)
        expect(missing.fetchImpl).toHaveBeenCalledTimes(1)

        resetModelDataForTests()
        const fresh = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        await fresh.service.boot(true)
        expect(fresh.fetchImpl).not.toHaveBeenCalled()
        expect(getModelContextLimit(gpt4o, db)).toBe(111)
    })

    test('(G) a failed automatic attempt moves no time, so the next boot tries again', async () => {
        const h = harness({ respond: async () => { throw new Error('offline') } })
        await h.service.boot(true)
        await h.service.boot(true)
        expect(h.fetchImpl).toHaveBeenCalledTimes(2)
    })
})

describe('getters', () => {
    test('(F) S9 they answer undefined before any data and never touch the store', () => {
        const h = harness()
        expect(getModelContextLimit(gpt4o, db)).toBeUndefined()
        expect(getModelPricing(gpt4o, db)).toBeUndefined()
        expect(getModelDataFetchedAt()).toBeNull()
        seedModelDataForTests(savedData(T, 128000))
        expect(getModelContextLimit(gpt4o, db)).toBe(128000)
        expect(getModelPricing(gpt4o, db)).toEqual({ input: '0.0000025', output: '0.00001' })
        expect(h.getStore).not.toHaveBeenCalled()
    })

    test('(F) a routed model reads the exact row of db.openrouterRequestModel', () => {
        seedModelDataForTests(parseOpenRouterModels(fixture, T))
        const routed = { id: 'openrouter', provider: LLMProvider.AsIs }
        expect(getModelContextLimit(routed, { openrouterRequestModel: 'anthropic/claude-sonnet-4.6' })).toBe(1000000)
        expect(getModelContextLimit(routed, { openrouterRequestModel: 'risu/free' })).toBeUndefined()
    })

    test('(F) boot makes the saved data visible to the getters', async () => {
        const h = harness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR, 4242))) })
        await h.service.boot(false)
        expect(getModelContextLimit(gpt4o, db)).toBe(4242)
    })

    test('(F) replacing the data re-runs an effect that read a getter', () => {
        const seen: (number | undefined)[] = []
        const stop = $effect.root(() => {
            $effect(() => {
                seen.push(getModelContextLimit(gpt4o, db))
            })
        })
        flushSync()
        expect(seen).toEqual([undefined])
        seedModelDataForTests(savedData(T, 111))
        flushSync()
        seedModelDataForTests(savedData(T, 222))
        flushSync()
        stop()
        expect(seen).toEqual([undefined, 111, 222])
    })

    test('(F) a derived value that reads a getter follows a seeded snapshot without a state write inside it', () => {
        let figure: number | undefined
        const stop = $effect.root(() => {
            const limit = $derived(getModelContextLimit(gpt4o, db))
            $effect(() => {
                figure = limit
            })
        })
        flushSync()
        seedModelDataForTests(savedData(T, 333))
        flushSync()
        stop()
        expect(figure).toBe(333)
    })
})
