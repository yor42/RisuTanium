import type { Database } from '../../storage/database.svelte'
import type { ByteStore } from '../../storage/store/contract'
import type { LLMModel } from '../types'
import {
    OPENROUTER_DATA_KEY,
    OPENROUTER_MODELS_URL,
    buildIndex,
    contextLimitFor,
    decodeOpenRouterData,
    encodeOpenRouterData,
    isStale,
    parseOpenRouterModels,
    pricingFor,
    type OpenRouterData,
    type OpenRouterIndex,
    type OpenRouterPricing,
} from './openrouterData'

/**
 * Reactive holder and refresh service for the OpenRouter model data.
 *
 * The data lives in one `$state.raw` cell that is replaced whole and never
 * mutated. The lookup index is built when the cell is replaced and stored in
 * the same object, so the getters are pure reads: they never build, never
 * write a rune (a write while a `$derived` evaluates would throw) and never
 * touch the byte store.
 */

interface Snapshot {
    data: OpenRouterData
    index: OpenRouterIndex
}

let snapshot = $state.raw<Snapshot | null>(null)

export type ModelDataOutcome = 'ok' | 'failed'

/** `refreshing` disables the manual button; `lastOutcome` is null until an attempt finishes. */
export const modelDataStatus = $state<{ refreshing: boolean, lastOutcome: ModelDataOutcome | null }>({
    refreshing: false,
    lastOutcome: null,
})

function setSnapshot(data: OpenRouterData | null): void {
    snapshot = data === null ? null : { data, index: buildIndex(data) }
}

/** The time the current snapshot was fetched, or null before any data is held. */
export function getModelDataFetchedAt(): number | null {
    return snapshot?.data.fetchedAt ?? null
}

type LookupModel = Pick<LLMModel, 'id' | 'internalID' | 'provider'>
type LookupDb = Pick<Database, 'openrouterRequestModel'>

/** The listed context window of a catalog model, or undefined when unknown. Never throws. */
export function getModelContextLimit(modelInfo: LookupModel, db: LookupDb): number | undefined {
    try {
        const held = snapshot
        return held ? contextLimitFor(held.index, modelInfo, db.openrouterRequestModel) : undefined
    } catch {
        return undefined
    }
}

/** The listed prices of a catalog model, or undefined when unknown. Never throws. */
export function getModelPricing(modelInfo: LookupModel, db: LookupDb): OpenRouterPricing | undefined {
    try {
        const held = snapshot
        return held ? pricingFor(held.index, modelInfo, db.openrouterRequestModel) : undefined
    } catch {
        return undefined
    }
}

/** Test seam: replaces the held data as a completed load or refresh does. */
export function seedModelDataForTests(data: OpenRouterData | null): void {
    setSnapshot(data)
}

export function resetModelDataForTests(): void {
    snapshot = null
    modelDataStatus.refreshing = false
    modelDataStatus.lastOutcome = null
}

const FETCH_TIMEOUT_MS = 15_000

export interface ModelDataResponse {
    ok: boolean
    json(): Promise<unknown>
}

export interface ModelDataServiceDeps {
    fetchImpl: (url: string, init: { credentials: 'omit', signal: AbortSignal }) => Promise<ModelDataResponse>
    getStore: () => Promise<ByteStore>
    /** False on a page that must not write (transitional OPFS, read-only mode). */
    canWrite: () => Promise<boolean>
    now: () => number
}

export interface ModelDataService {
    /** Loads the saved data; with `autoRefresh` also refreshes when the data is missing or stale. Never rejects. */
    boot(autoRefresh: boolean): Promise<void>
    /** Refreshes only when the data is missing or stale. Never rejects. */
    refreshIfStale(): Promise<void>
    /** Refreshes now, whatever the age and the registry option. Never rejects. */
    refreshNow(): Promise<ModelDataOutcome>
}

/**
 * Memoised state (`loadPromise`, the refresh in flight, `writesDisabled`) lives
 * in the instance. Every public entry awaits the load first, so no fetch, write
 * or snapshot replacement can happen before the saved file was read.
 */
export function createModelDataService(deps: ModelDataServiceDeps): ModelDataService {
    let loadPromise: Promise<void> | null = null
    let inFlight: Promise<ModelDataOutcome> | null = null
    let writesDisabled = false

    // Created by the first entry, never at module evaluation: the page's store
    // is chosen during boot. A missing, corrupt or foreign file is simply empty
    // data; an unreadable one also disables writes, so it is not overwritten.
    async function load(): Promise<void> {
        try {
            const { bytes } = await (await deps.getStore()).read(OPENROUTER_DATA_KEY)
            const data = bytes === null ? null : decodeOpenRouterData(bytes)
            if (data !== null) {
                setSnapshot(data)
            }
        } catch (error) {
            writesDisabled = true
            console.error('Model data could not be read', error)
        }
    }

    function ensureLoaded(): Promise<void> {
        loadPromise ??= load()
        return loadPromise
    }

    // One abort covers the connection and the body. The race also ends a body
    // that never settles, which an abort alone does not guarantee.
    async function fetchListing(): Promise<unknown> {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
            const aborted = new Promise<never>((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('Model data request timed out')), { once: true })
            })
            const request = (async () => {
                const res = await deps.fetchImpl(OPENROUTER_MODELS_URL, { credentials: 'omit', signal: controller.signal })
                if (!res.ok) {
                    throw new Error('Model data request failed')
                }
                return await res.json()
            })()
            request.catch(() => { })
            return await Promise.race([request, aborted])
        } finally {
            clearTimeout(timer)
        }
    }

    // A failed write leaves the fresh in-memory data in place: only the cache
    // is behind, so the refresh itself still counts as done.
    async function persist(data: OpenRouterData): Promise<void> {
        try {
            if (writesDisabled || !await deps.canWrite()) {
                return
            }
            const store = await deps.getStore()
            await store.write(OPENROUTER_DATA_KEY, encodeOpenRouterData(data), 'unconditional')
        } catch (error) {
            console.error('Model data could not be saved', error)
        }
    }

    async function runRefresh(): Promise<ModelDataOutcome> {
        modelDataStatus.refreshing = true
        try {
            const data = parseOpenRouterModels(await fetchListing(), deps.now())
            if (data === null) {
                throw new Error('Model data response had no usable rows')
            }
            setSnapshot(data)
            await persist(data)
            modelDataStatus.lastOutcome = 'ok'
            return 'ok'
        } catch (error) {
            console.error('Model data refresh failed', error)
            modelDataStatus.lastOutcome = 'failed'
            return 'failed'
        } finally {
            modelDataStatus.refreshing = false
        }
    }

    // The single-flight point: a caller arriving while a refresh runs shares it.
    function doRefresh(): Promise<ModelDataOutcome> {
        if (inFlight === null) {
            inFlight = runRefresh().finally(() => { inFlight = null })
        }
        return inFlight
    }

    async function refreshIfStale(): Promise<void> {
        await ensureLoaded()
        if (snapshot !== null && !isStale(snapshot.data.fetchedAt, deps.now())) {
            return
        }
        await doRefresh()
    }

    async function refreshNow(): Promise<ModelDataOutcome> {
        await ensureLoaded()
        return doRefresh()
    }

    async function boot(autoRefresh: boolean): Promise<void> {
        await ensureLoaded()
        if (autoRefresh) {
            await refreshIfStale()
        }
    }

    return { boot, refreshIfStale, refreshNow }
}
