import type { Database } from '../../storage/database.svelte'
import type { ByteStore } from '../../storage/store/contract'
import type { LLMModel } from '../types'
import {
    LITELLM_DATA_KEY,
    LITELLM_DATA_URL,
    buildLiteLLMIndex,
    choosePricing,
    chooseContextLimit,
    decodeLiteLLMData,
    encodeLiteLLMData,
    parseLiteLLMText,
    type LiteLLMData,
    type LiteLLMIndex,
} from './litellmData'
import {
    OPENROUTER_DATA_KEY,
    OPENROUTER_MODELS_URL,
    buildIndex,
    decodeOpenRouterData,
    encodeOpenRouterData,
    isStale,
    parseOpenRouterModels,
    type OpenRouterData,
    type OpenRouterIndex,
    type OpenRouterPricing,
} from './openrouterData'

/**
 * Reactive holder and refresh service for the model data: the OpenRouter
 * listing and the LiteLLM dataset, two independent sources.
 *
 * Each source's data lives in one `$state.raw` cell that is replaced whole and
 * never mutated. The lookup index is built when a cell is replaced and stored
 * in the same object, so the getters are pure reads: they never build, never
 * write a rune (a write while a `$derived` evaluates would throw) and never
 * touch the byte store.
 */

interface Snapshot {
    data: OpenRouterData
    index: OpenRouterIndex
}

interface LiteLLMSnapshot {
    data: LiteLLMData
    index: LiteLLMIndex
}

let snapshot = $state.raw<Snapshot | null>(null)
let litellmSnapshot = $state.raw<LiteLLMSnapshot | null>(null)

/** What one attempt did: a source that was fresh (or a pass with no key) is skipped, not failed. */
export type TaskOutcome = 'ok' | 'failed' | 'skipped'

/** `partial`: some attempted tasks succeeded and some failed. */
export type ModelDataOutcome = 'ok' | 'failed' | 'partial'

/**
 * `refreshing` disables the manual button; `lastOutcome` is null until an
 * attempt finishes. Only `runAggregate` writes either flag.
 */
export const modelDataStatus = $state<{ refreshing: boolean, lastOutcome: ModelDataOutcome | null }>({
    refreshing: false,
    lastOutcome: null,
})

let activeAggregates = 0

/**
 * Runs the tasks together as one attempt. The aggregate alone owns the status:
 * `refreshing` stays true while any aggregate is active, and `lastOutcome` is
 * the last finisher's (`ok` when every attempted task succeeded, `failed` when
 * none did, else `partial`; skipped tasks are not attempts). A task that throws
 * counts as failed. Never rejects.
 */
async function runAggregate(tasks: readonly (() => Promise<TaskOutcome>)[]): Promise<ModelDataOutcome> {
    activeAggregates++
    modelDataStatus.refreshing = true
    try {
        const outcomes = await Promise.all(tasks.map(async (task): Promise<TaskOutcome> => {
            try {
                return await task()
            } catch (error) {
                console.error('Model data refresh failed', error)
                return 'failed'
            }
        }))
        const attempted = outcomes.filter(outcome => outcome !== 'skipped')
        if (attempted.length === 0) {
            return 'ok'
        }
        const succeeded = attempted.filter(outcome => outcome === 'ok').length
        const result: ModelDataOutcome = succeeded === attempted.length ? 'ok' : succeeded === 0 ? 'failed' : 'partial'
        modelDataStatus.lastOutcome = result
        return result
    } finally {
        activeAggregates--
        modelDataStatus.refreshing = activeAggregates > 0
    }
}

const datasetListeners = new Set<() => void>()

function setSnapshot(data: OpenRouterData | null): void {
    snapshot = data === null ? null : { data, index: buildIndex(data) }
}

function setLiteLLMSnapshot(data: LiteLLMData | null): void {
    litellmSnapshot = data === null ? null : { data, index: buildLiteLLMIndex(data) }
    for (const listener of [...datasetListeners]) {
        try {
            listener()
        } catch (error) {
            console.error('Model data', error)
        }
    }
}

/**
 * Calls `listener` after each replacement of the LiteLLM snapshot (a load, a
 * refresh, a test seed), never for a failed refresh. The listener runs after
 * the cell holds the new data. Returns the unsubscribe function.
 */
export function subscribeDataset(listener: () => void): () => void {
    datasetListeners.add(listener)
    return () => { datasetListeners.delete(listener) }
}

/** The LiteLLM data currently held, or null. A pure read. */
export function getLiteLLMData(): LiteLLMData | null {
    return litellmSnapshot?.data ?? null
}

/** The time the current OpenRouter snapshot was fetched, or null before any data is held. */
export function getModelDataFetchedAt(): number | null {
    return snapshot?.data.fetchedAt ?? null
}

/** The time the current LiteLLM snapshot was fetched, or null before any data is held. */
export function getLiteLLMFetchedAt(): number | null {
    return litellmSnapshot?.data.fetchedAt ?? null
}

type LookupModel = Pick<LLMModel, 'id' | 'internalID' | 'provider'>
type LookupDb = Pick<Database, 'openrouterRequestModel'>

/** The context window of a catalog model, or undefined when unknown. Never throws. */
export function getModelContextLimit(modelInfo: LookupModel, db: LookupDb): number | undefined {
    try {
        return chooseContextLimit(snapshot?.index ?? null, litellmSnapshot?.index ?? null, modelInfo, db.openrouterRequestModel)
    } catch {
        return undefined
    }
}

/** The prices of a catalog model, or undefined when unknown. Never throws. */
export function getModelPricing(modelInfo: LookupModel, db: LookupDb): OpenRouterPricing | undefined {
    try {
        return choosePricing(snapshot?.index ?? null, litellmSnapshot?.index ?? null, modelInfo, db.openrouterRequestModel)
    } catch {
        return undefined
    }
}

/** Test seam: replaces the held OpenRouter data as a completed load or refresh does. */
export function seedModelDataForTests(data: OpenRouterData | null): void {
    setSnapshot(data)
}

/** Test seam: replaces the held LiteLLM data as a completed load or refresh does (listeners run). */
export function seedLiteLLMForTests(data: LiteLLMData | null): void {
    setLiteLLMSnapshot(data)
}

export function resetModelDataForTests(): void {
    snapshot = null
    litellmSnapshot = null
    datasetListeners.clear()
    activeAggregates = 0
    modelDataStatus.refreshing = false
    modelDataStatus.lastOutcome = null
}

const FETCH_TIMEOUT_MS = 15_000

export interface ModelDataResponse {
    ok: boolean
    json(): Promise<unknown>
    text(): Promise<string>
}

export interface ModelDataServiceDeps {
    fetchImpl: (url: string, init: { credentials: 'omit', signal: AbortSignal }) => Promise<ModelDataResponse>
    getStore: () => Promise<ByteStore>
    /** False on a page that must not write (transitional OPFS, read-only mode). */
    canWrite: () => Promise<boolean>
    now: () => number
}

export type ModelDataSource = 'openrouter' | 'litellm'

export interface ModelDataServiceOptions {
    /** The sources this service runs; both by default. */
    sources?: readonly ModelDataSource[]
}

export interface ModelDataService {
    /** Loads the saved data; with `autoRefresh` also refreshes the sources whose data is missing or stale. Never rejects. */
    boot(autoRefresh: boolean): Promise<void>
    /** Refreshes the sources whose data is missing or stale. Never rejects. */
    refreshIfStale(): Promise<void>
    /** Refreshes every source now, whatever the age and the registry option. Never rejects. */
    refreshNow(): Promise<ModelDataOutcome>
    /** Like `refreshNow`, with one more task counted in the same outcome (the provider list pass). Never rejects. */
    refreshAll(extra?: () => Promise<TaskOutcome>): Promise<ModelDataOutcome>
}

/** What distinguishes one source from another; the runner below is shared. */
interface SourceSpec<T> {
    key: string
    decode(bytes: Uint8Array): T | null
    /** Null when the data does not fit its file: the write is skipped. */
    encode(data: T): Uint8Array | null
    apply(data: T): void
    fetchedAt(): number | null
    /** Fetches and parses; throws when the request fails or the body holds nothing usable. */
    fetchData(): Promise<T>
}

interface SourceRunner {
    load(): Promise<void>
    refreshIfStale(): Promise<TaskOutcome>
    refresh(): Promise<TaskOutcome>
}

/**
 * Memoised state (`loadPromise`, the refresh in flight, `writesDisabled`) lives
 * in the instance, one set per source. Every public entry awaits every load
 * first, so no fetch, write or snapshot replacement can happen before the saved
 * files were read.
 */
export function createModelDataService(deps: ModelDataServiceDeps, options: ModelDataServiceOptions = {}): ModelDataService {
    // One abort covers the connection and the body. The race also ends a body
    // that never settles, which an abort alone does not guarantee.
    async function fetchBody<R>(url: string, read: (res: ModelDataResponse) => Promise<R>): Promise<R> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
            const aborted = new Promise<never>((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('Model data request timed out')), { once: true })
            })
            const request = (async () => {
                const res = await deps.fetchImpl(url, { credentials: 'omit', signal: controller.signal })
                if (!res.ok) {
                    throw new Error('Model data request failed')
                }
                return await read(res)
            })()
            request.catch(() => { })
            return await Promise.race([request, aborted])
        } finally {
            clearTimeout(timer)
        }
    }

    function createRunner<T>(spec: SourceSpec<T>): SourceRunner {
        let loadPromise: Promise<void> | null = null
        let inFlight: Promise<TaskOutcome> | null = null
        let writesDisabled = false

        // Created by the first entry, never at module evaluation: the page's store
        // is chosen during boot. A missing, corrupt or foreign file is simply empty
        // data; an unreadable one also disables writes, so it is not overwritten.
        async function load(): Promise<void> {
            try {
                const { bytes } = await (await deps.getStore()).read(spec.key)
                const data = bytes === null ? null : spec.decode(bytes)
                if (data !== null) {
                    spec.apply(data)
                }
            } catch (error) {
                writesDisabled = true
                console.error('Model data could not be read', error)
            }
        }

        // A failed write leaves the fresh in-memory data in place: only the cache
        // is behind, so the refresh itself still counts as done.
        async function persist(data: T): Promise<void> {
            try {
                if (writesDisabled || !await deps.canWrite()) {
                    return
                }
                const bytes = spec.encode(data)
                if (bytes === null) {
                    console.error('Model data could not be saved', new Error('Model data does not fit its file'))
                    return
                }
                const store = await deps.getStore()
                await store.write(spec.key, bytes, 'unconditional')
            } catch (error) {
                console.error('Model data could not be saved', error)
            }
        }

        async function runRefresh(): Promise<TaskOutcome> {
            try {
                const data = await spec.fetchData()
                spec.apply(data)
                await persist(data)
                return 'ok'
            } catch (error) {
                console.error('Model data refresh failed', error)
                return 'failed'
            }
        }

        // The single-flight point: a caller arriving while a refresh runs shares it.
        function refresh(): Promise<TaskOutcome> {
            if (inFlight === null) {
                inFlight = runRefresh().finally(() => { inFlight = null })
            }
            return inFlight
        }

        function ensureLoaded(): Promise<void> {
            loadPromise ??= load()
            return loadPromise
        }

        return {
            load: ensureLoaded,
            async refreshIfStale() {
                await ensureLoaded()
                const fetchedAt = spec.fetchedAt()
                if (fetchedAt !== null && !isStale(fetchedAt, deps.now())) {
                    return 'skipped'
                }
                return refresh()
            },
            async refresh() {
                await ensureLoaded()
                return refresh()
            },
        }
    }

    const openrouter = createRunner<OpenRouterData>({
        key: OPENROUTER_DATA_KEY,
        decode: decodeOpenRouterData,
        encode: encodeOpenRouterData,
        apply: setSnapshot,
        fetchedAt: () => snapshot?.data.fetchedAt ?? null,
        async fetchData() {
            const data = parseOpenRouterModels(await fetchBody(OPENROUTER_MODELS_URL, res => res.json()), deps.now())
            if (data === null) {
                throw new Error('Model data response had no usable rows')
            }
            return data
        },
    })

    const litellm = createRunner<LiteLLMData>({
        key: LITELLM_DATA_KEY,
        decode: decodeLiteLLMData,
        encode: encodeLiteLLMData,
        apply: setLiteLLMSnapshot,
        fetchedAt: () => litellmSnapshot?.data.fetchedAt ?? null,
        async fetchData() {
            // The body is read as text so its size is checked before any parse.
            const data = parseLiteLLMText(await fetchBody(LITELLM_DATA_URL, res => res.text()), deps.now())
            if (data === null) {
                throw new Error('Model data response had no usable rows')
            }
            return data
        },
    })

    const wanted = options.sources ?? ['openrouter', 'litellm']
    const runners: SourceRunner[] = []
    if (wanted.includes('openrouter')) {
        runners.push(openrouter)
    }
    if (wanted.includes('litellm')) {
        runners.push(litellm)
    }

    let loadAll: Promise<void> | null = null

    function ensureAllLoaded(): Promise<void> {
        loadAll ??= Promise.all(runners.map(runner => runner.load())).then(() => undefined)
        return loadAll
    }

    async function refreshIfStale(): Promise<void> {
        await ensureAllLoaded()
        await runAggregate(runners.map(runner => () => runner.refreshIfStale()))
    }

    async function refreshAll(extra?: () => Promise<TaskOutcome>): Promise<ModelDataOutcome> {
        await ensureAllLoaded()
        const tasks = runners.map(runner => () => runner.refresh())
        if (extra) {
            tasks.push(extra)
        }
        return runAggregate(tasks)
    }

    async function boot(autoRefresh: boolean): Promise<void> {
        await ensureAllLoaded()
        if (autoRefresh) {
            await refreshIfStale()
        }
    }

    return { boot, refreshIfStale, refreshNow: () => refreshAll(), refreshAll }
}
