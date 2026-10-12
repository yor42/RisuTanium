import { getPageStorageMode } from '../../storage/pageStorageMode'
import { getAppStore, pageStoreIsOpfsTransitional } from '../../storage/store/appStore'
import { createModelDataService, type ModelDataOutcome } from './modelDataService.svelte'

/**
 * Production wiring of the model data service: the page's byte store, the
 * global fetch (looked up at call time) and the real clock. This is the only
 * module that reaches `appStore`; the reactive getters never do.
 *
 * Nothing is written on a page that runs from the transitional OPFS store or
 * in read-only mode.
 */
const service = createModelDataService({
    fetchImpl: (url, init) => globalThis.fetch(url, init),
    getStore: getAppStore,
    canWrite: async () => !(await pageStoreIsOpfsTransitional()) && getPageStorageMode().kind !== 'read-only',
    now: Date.now,
})

/** Not awaited by boot: loads the saved data, and refreshes when stale if `autoRefresh`. */
export function startModelData(autoRefresh: boolean): void {
    void service.boot(autoRefresh).catch(error => console.error('Model data', error))
}

export function refreshModelDataNow(): Promise<ModelDataOutcome> {
    return service.refreshNow()
}
