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
    getLiteLLMData,
    getLiteLLMFetchedAt,
    getModelPricing,
    modelDataStatus,
    resetModelDataForTests,
    seedLiteLLMForTests,
    seedModelDataForTests,
    subscribeDataset,
    type ModelDataResponse,
    type ModelDataService,
    type TaskOutcome,
} from '../modelDataService.svelte'
import {
    LITELLM_DATA_KEY,
    LITELLM_DATA_URL,
    LITELLM_MAX_FILE_BYTES,
    decodeLiteLLMData,
    encodeLiteLLMData,
    parseLiteLLMDataset,
    type LiteLLMData,
} from '../litellmData'
import fixture from './openrouterRows.fixture.json'

const T = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const gpt4o = { id: 'gpt-4o', provider: LLMProvider.OpenAI }
/** ModelDataResponse also reads text (the LiteLLM source); the OpenRouter source never does. */
const noText = async (): Promise<string> => ''
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
        options.respond ?? (async () => ({ ok: true, text: noText, json: async () => listing() })))
    const getStore = vi.fn(async (): Promise<ByteStore> => store)
    const canWrite = vi.fn(options.canWrite ?? (async () => true))
    // These cases run the OpenRouter runner alone; the two-source cases follow.
    const service = createModelDataService({ fetchImpl, getStore, canWrite, now: () => clock.now }, { sources: ['openrouter'] })
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
        ['an HTTP error', async () => ({ ok: false, text: noText, json: async () => listing() })],
        ['a thrown fetch', async () => { throw new TypeError('offline') }],
        ['a body that is not JSON', async () => ({ ok: true, text: noText, json: async () => { throw new SyntaxError('bad json') } })],
        ['a listing with no rows', async () => ({ ok: true, text: noText, json: async () => ({ data: [] }) })],
        ['a body that is not a listing', async () => ({ ok: true, text: noText, json: async () => ({ error: 'nope' }) })],
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
        const h = harness({ respond: async () => ({ ok: true, text: noText, json: () => new Promise<unknown>(() => { }) }) })
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
            return { ok: true, text: noText, json: async () => listing() }
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
        const h = harness({ respond: async () => { await answer.wait; return { ok: true, text: noText, json: async () => listing() } } })
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
        const h = harness({ respond: async () => { await answer.wait; return { ok: true, text: noText, json: async () => listing() } } })
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

/** A dataset with one row, whose context identifies the fetch (or the saved file) that produced it. */
function litellmBody(context = 999000): string {
    return JSON.stringify({ 'gpt-4o': { litellm_provider: 'openai', mode: 'chat', max_input_tokens: context, input_cost_per_token: 0.5 } })
}

function savedLiteLLM(fetchedAt: number, context = 777000): LiteLLMData {
    const data = parseLiteLLMDataset(JSON.parse(litellmBody(context)), fetchedAt)
    if (data === null) {
        throw new Error('dataset must parse')
    }
    return data
}

function litellmBytes(fetchedAt: number, context = 777000): Uint8Array {
    const bytes = encodeLiteLLMData(savedLiteLLM(fetchedAt, context))
    if (bytes === null) {
        throw new Error('dataset must encode')
    }
    return bytes
}

const noJson = async (): Promise<unknown> => { throw new Error('the LiteLLM source reads text, not json') }

/** Both sources, routed by URL. `respondLiteLLM` and `respondOpenRouter` override one source. */
function bothHarness(options: {
    store?: FakeStore
    respondLiteLLM?: () => Promise<ModelDataResponse>
    respondOpenRouter?: () => Promise<ModelDataResponse>
    canWrite?: () => Promise<boolean>
} = {}) {
    const store = options.store ?? fakeStore()
    const clock = { now: T }
    const fetchImpl = vi.fn<(url: string, init: { credentials: 'omit', signal: AbortSignal }) => Promise<ModelDataResponse>>(async (url) => {
        if (url === LITELLM_DATA_URL) {
            return options.respondLiteLLM ? options.respondLiteLLM() : { ok: true, text: async () => litellmBody(), json: noJson }
        }
        return options.respondOpenRouter ? options.respondOpenRouter() : { ok: true, text: noText, json: async () => listing() }
    })
    const getStore = vi.fn(async (): Promise<ByteStore> => store)
    const canWrite = vi.fn(options.canWrite ?? (async () => true))
    const service = createModelDataService({ fetchImpl, getStore, canWrite, now: () => clock.now })
    return { store, service, fetchImpl, getStore, canWrite, clock }
}

const urlsOf = (h: ReturnType<typeof bothHarness>): string[] => h.fetchImpl.mock.calls.map(call => call[0]).sort()

describe('two sources: independent runners behind one aggregate', () => {
    test('(F) both sources refresh: two keyless fetches, two unconditional writes, both snapshots held', async () => {
        const h = bothHarness()
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(urlsOf(h)).toEqual([LITELLM_DATA_URL, 'https://openrouter.ai/api/v1/models'].sort())
        for (const [, init] of h.fetchImpl.mock.calls) {
            expect(init.credentials).toBe('omit')
        }
        expect(h.store.writes.map(w => w.key).sort()).toEqual([LITELLM_DATA_KEY, OPENROUTER_DATA_KEY].sort())
        expect(h.store.writes.every(w => w.condition === 'unconditional')).toBe(true)
        expect(decodeLiteLLMData(h.store.files.get(LITELLM_DATA_KEY)!)).toEqual(savedLiteLLM(T, 999000))
        expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(999000)
        expect(getLiteLLMFetchedAt()).toBe(T)
        expect(getModelDataFetchedAt()).toBe(T)
        expect(modelDataStatus.lastOutcome).toBe('ok')
    })

    test('(F) one source failing is partial: the other still applies and writes, the failed one is untouched', async () => {
        const h = bothHarness({
            store: fakeStore(encodeOpenRouterData(savedData(T - 2 * DAY, 111))),
            respondLiteLLM: async () => { throw new TypeError('offline') },
        })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - 2 * DAY, 777000))
        await h.service.boot(false)
        await expect(h.service.refreshNow()).resolves.toBe('partial')
        expect(getModelDataFetchedAt()).toBe(T)
        expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(777000)
        expect(getLiteLLMFetchedAt()).toBe(T - 2 * DAY)
        expect(h.store.writes.map(w => w.key)).toEqual([OPENROUTER_DATA_KEY])
        expect(modelDataStatus.lastOutcome).toBe('partial')
        expect(modelDataStatus.refreshing).toBe(false)
    })

    test('(F) the other source failing is partial the other way, and both failing is failed', async () => {
        const half = bothHarness({ respondOpenRouter: async () => { throw new TypeError('offline') } })
        await expect(half.service.refreshNow()).resolves.toBe('partial')
        expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(999000)
        expect(getModelDataFetchedAt()).toBeNull()
        expect(half.store.writes.map(w => w.key)).toEqual([LITELLM_DATA_KEY])

        resetModelDataForTests()
        const none = bothHarness({
            respondOpenRouter: async () => { throw new TypeError('offline') },
            respondLiteLLM: async () => ({ ok: false, text: noText, json: noJson }),
        })
        await expect(none.service.refreshNow()).resolves.toBe('failed')
        expect(modelDataStatus.lastOutcome).toBe('failed')
        expect(none.store.writes).toHaveLength(0)
    })

    test('(F) a LiteLLM response with no usable rows or not JSON text fails the source and keeps the saved data', async () => {
        for (const text of ['{}', '<html>', JSON.stringify({ 'gpt-4o': { litellm_provider: 'openai', mode: 'embedding', max_input_tokens: 5 } })]) {
            resetModelDataForTests()
            const h = bothHarness({ respondLiteLLM: async () => ({ ok: true, text: async () => text, json: noJson }) })
            h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - 2 * DAY))
            await h.service.boot(false)
            await expect(h.service.refreshNow()).resolves.toBe('partial')
            expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(777000)
            expect(h.store.writes.map(w => w.key)).not.toContain(LITELLM_DATA_KEY)
        }
    })

    test('(F) a LiteLLM body above 8 MB is rejected before JSON.parse and changes nothing', async () => {
        const h = bothHarness({ respondLiteLLM: async () => ({ ok: true, text: async () => 'x'.repeat(8 * 1024 * 1024 + 1), json: noJson }) })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - 2 * DAY))
        await h.service.boot(false)
        const spy = vi.spyOn(JSON, 'parse')
        try {
            await expect(h.service.refreshNow()).resolves.toBe('partial')
            expect(spy).not.toHaveBeenCalled()
        } finally {
            spy.mockRestore()
        }
        expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(777000)
        expect(h.store.writes.map(w => w.key)).not.toContain(LITELLM_DATA_KEY)
    })

    test('(F) a saved LiteLLM file above 1 MB is not parsed, reads as empty, and the next success rewrites it', async () => {
        const h = bothHarness()
        h.store.files.set(LITELLM_DATA_KEY, new Uint8Array(LITELLM_MAX_FILE_BYTES + 1).fill(0x20))
        const spy = vi.spyOn(JSON, 'parse')
        try {
            await h.service.boot(false)
            expect(spy).not.toHaveBeenCalled()
        } finally {
            spy.mockRestore()
        }
        expect(getLiteLLMData()).toBeNull()
        await h.service.refreshNow()
        expect(decodeLiteLLMData(h.store.files.get(LITELLM_DATA_KEY)!)?.rows['gpt-4o'].ctx).toBe(999000)
    })

    test('(F) boot loads both saved files once each, whatever the entries', async () => {
        const h = bothHarness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - HOUR))
        await Promise.all([h.service.boot(false), h.service.refreshIfStale(), h.service.refreshNow()])
        expect([...h.store.reads].sort()).toEqual([LITELLM_DATA_KEY, OPENROUTER_DATA_KEY].sort())
    })
})

describe('two sources: staleness and single flight are per source', () => {
    test('(F) boot(true) refreshes only the stale source, and skipped sources do not count in the outcome', async () => {
        const h = bothHarness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - 2 * DAY))
        await h.service.boot(true)
        expect(urlsOf(h)).toEqual([LITELLM_DATA_URL])
        expect(modelDataStatus.lastOutcome).toBe('ok')
        expect(getModelDataFetchedAt()).toBe(T - HOUR)
    })

    test('(F) boot(true) with both fresh fetches nothing and leaves the status alone', async () => {
        const h = bothHarness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - HOUR))
        await h.service.boot(true)
        expect(h.fetchImpl).not.toHaveBeenCalled()
        expect(modelDataStatus.lastOutcome).toBeNull()
    })

    test.each([
        ['exactly a day old', T - DAY, false],
        ['older than a day', T - DAY - 1, true],
        ['dated in the future', T + HOUR, true],
    ])('(F) the LiteLLM TTL boundary: data %s', async (_name, fetchedAt, fetches) => {
        const h = bothHarness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(fetchedAt))
        await h.service.refreshIfStale()
        expect(urlsOf(h)).toEqual(fetches ? [LITELLM_DATA_URL] : [])
    })

    test('(F) concurrent refreshes make one fetch per source', async () => {
        const answer = gate()
        const h = bothHarness({
            respondLiteLLM: async () => { await answer.wait; return { ok: true, text: async () => litellmBody(), json: noJson } },
            respondOpenRouter: async () => { await answer.wait; return { ok: true, text: noText, json: async () => listing() } },
        })
        const first = h.service.refreshNow()
        const second = h.service.refreshAll()
        const booting = h.service.boot(true)
        await flush()
        answer.open()
        await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok'])
        await booting
        expect(h.fetchImpl).toHaveBeenCalledTimes(2)
        expect(h.store.writes).toHaveLength(2)
    })
})

describe('aggregate status: one owner for the flags', () => {
    function gatedExtra(outcome: TaskOutcome) {
        const g = gate()
        return { open: g.open, task: async (): Promise<TaskOutcome> => { await g.wait; return outcome } }
    }

    test('(F) overlapping aggregates: refreshing holds until both finish and lastOutcome is the last finisher', async () => {
        const h = bothHarness()
        const a = gatedExtra('failed')
        const b = gatedExtra('ok')
        const first = h.service.refreshAll(a.task)
        const second = h.service.refreshAll(b.task)
        await flush()
        expect(modelDataStatus.refreshing).toBe(true)

        b.open()
        await expect(second).resolves.toBe('ok')
        expect(modelDataStatus.refreshing).toBe(true)
        expect(modelDataStatus.lastOutcome).toBe('ok')

        a.open()
        await expect(first).resolves.toBe('partial')
        expect(modelDataStatus.refreshing).toBe(false)
        expect(modelDataStatus.lastOutcome).toBe('partial')
    })

    test('(F) the extra task counts: failed beside two ok is partial, skipped is not counted, all failed is failed', async () => {
        const failedExtra = bothHarness()
        await expect(failedExtra.service.refreshAll(async () => 'failed')).resolves.toBe('partial')

        resetModelDataForTests()
        const skipped = bothHarness()
        await expect(skipped.service.refreshAll(async () => 'skipped')).resolves.toBe('ok')

        resetModelDataForTests()
        const allFailed = bothHarness({
            respondOpenRouter: async () => { throw new TypeError('offline') },
            respondLiteLLM: async () => { throw new TypeError('offline') },
        })
        await expect(allFailed.service.refreshAll(async () => 'failed')).resolves.toBe('failed')
        expect(modelDataStatus.lastOutcome).toBe('failed')
    })

    test('(F) an extra task that throws counts as failed and never rejects', async () => {
        const h = bothHarness()
        await expect(h.service.refreshAll(async () => { throw new Error('list pass blew up') })).resolves.toBe('partial')
        expect(modelDataStatus.refreshing).toBe(false)
    })

    test('(F) the runners set no flags: refreshing stays false until an aggregate starts', async () => {
        const h = bothHarness()
        await h.service.boot(false)
        expect(modelDataStatus.refreshing).toBe(false)
        expect(modelDataStatus.lastOutcome).toBeNull()
    })
})

describe('write permission and unreadable files are per source', () => {
    test('(F) a LiteLLM file that cannot be read disables only its own writes', async () => {
        const h = bothHarness()
        const read = h.store.read
        h.store.read = async (key: string) => {
            if (key === LITELLM_DATA_KEY) {
                throw new Error('disk gone')
            }
            return read(key)
        }
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(h.store.writes.map(w => w.key)).toEqual([OPENROUTER_DATA_KEY])
        expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(999000)
    })

    test('(F) a page that must not write fetches and shows both sources but writes neither', async () => {
        const h = bothHarness({ canWrite: async () => false })
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(h.store.writes).toHaveLength(0)
        expect(getLiteLLMData()?.rows['gpt-4o'].ctx).toBe(999000)
        expect(getModelDataFetchedAt()).toBe(T)
    })
})

describe('dataset subscription', () => {
    test('(F) listeners run after each LiteLLM snapshot replacement: load, refresh and seed, not a failed refresh', async () => {
        const h = bothHarness({ store: fakeStore(encodeOpenRouterData(savedData(T - HOUR))) })
        h.store.files.set(LITELLM_DATA_KEY, litellmBytes(T - 2 * DAY))
        const seen: (number | undefined)[] = []
        subscribeDataset(() => seen.push(getLiteLLMData()?.rows['gpt-4o'].ctx))

        await h.service.boot(false)
        expect(seen).toEqual([777000])
        await h.service.refreshNow()
        expect(seen).toEqual([777000, 999000])
        seedLiteLLMForTests(savedLiteLLM(T, 5))
        expect(seen).toEqual([777000, 999000, 5])

        const failing = bothHarness({ respondLiteLLM: async () => { throw new TypeError('offline') } })
        await failing.service.refreshNow()
        expect(seen).toEqual([777000, 999000, 5])
    })

    test('(F) the OpenRouter source does not notify, an unsubscribed listener is not called, and a throwing listener breaks nothing', async () => {
        const h = bothHarness()
        const calls: string[] = []
        const stop = subscribeDataset(() => calls.push('removed'))
        subscribeDataset(() => { throw new Error('listener failed') })
        subscribeDataset(() => calls.push('kept'))
        stop()
        seedModelDataForTests(savedData(T))
        expect(calls).toEqual([])
        await expect(h.service.refreshNow()).resolves.toBe('ok')
        expect(calls).toEqual(['kept'])
        expect(errorSpy).toHaveBeenCalled()
    })

    test('(F) resetModelDataForTests drops the listeners', () => {
        const calls: number[] = []
        subscribeDataset(() => calls.push(1))
        resetModelDataForTests()
        seedLiteLLMForTests(savedLiteLLM(T))
        expect(calls).toEqual([])
    })
})
