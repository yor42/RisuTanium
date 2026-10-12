import { getPageStorageMode } from '../../storage/pageStorageMode'
import type { ReadResult } from '../../storage/store/contract'
import { getAppStore, pageStoreIsOpfsTransitional } from '../../storage/store/appStore'
import { ADDED_FAMILIES, type AddedFamily } from './addedModelsData'
import { createModelDataService, type ModelDataOutcome, type TaskOutcome } from './modelDataService.svelte'
import {
    PROVIDER_LISTS_KEY,
    decodeProviderLists,
    emptyProviderLists,
    encodeProviderLists,
    type ProviderList,
    type ProviderListsData,
} from './providerListData'

/**
 * Production wiring of the model data service and of the saved provider lists:
 * the page's byte store, the global fetch (looked up at call time) and the real
 * clock. This is the only module that reaches `appStore`; the reactive getters
 * never do.
 *
 * Nothing is written on a page that runs from the transitional OPFS store or
 * in read-only mode.
 */
async function canWrite(): Promise<boolean> {
    return !(await pageStoreIsOpfsTransitional()) && getPageStorageMode().kind !== 'read-only'
}

const service = createModelDataService({
    fetchImpl: (url, init) => globalThis.fetch(url, init),
    getStore: getAppStore,
    canWrite,
    now: Date.now,
})

/**
 * Not awaited by boot: loads the saved data, and refreshes the stale sources
 * when `autoRefresh`; also reads the saved provider lists and hands them to
 * `seed` (the registry, which never reaches the store itself). A throwing seeder
 * is logged and changes nothing else.
 */
export function startModelData(autoRefresh: boolean, seed?: (saved: ProviderListsData) => void): void {
    void service.boot(autoRefresh).catch(error => console.error('Model data', error))
    void loadProviderLists()
        .then(saved => seed?.(saved))
        .catch(error => console.error('Model data', error))
}

/** Refreshes both data sources now (no list pass, no key involved). */
export function refreshModelDataNow(): Promise<ModelDataOutcome> {
    return service.refreshNow()
}

/**
 * The Refresh button: both data sources, plus the provider list pass when the
 * registry option is on, as one attempt. The pass gets `isRegistryOn` so it can
 * stop between families and pages. With the option off only the data sources run
 * and no key is read.
 */
export function refreshAllNow(
    listPass: (isRegistryOn: () => boolean) => Promise<TaskOutcome>,
    isRegistryOn: () => boolean,
): Promise<ModelDataOutcome> {
    return service.refreshAll(isRegistryOn() ? () => listPass(isRegistryOn) : undefined)
}

// ---- Saved provider lists -------------------------------------------------

const LIST_SAVE_TIMEOUT_MS = 30_000

/** Set when the saved file could not be read: it is then never overwritten this session. */
let listWritesDisabled = false

/**
 * Lists whose save failed or timed out. The next successful save writes them
 * again, unless the file already holds a newer copy of the family.
 */
const carried: Partial<Record<AddedFamily, ProviderList>> = {}

/** Same-tab saves run one after another: the store does not order operations on a key. */
let saveChain: Promise<void> = Promise.resolve()

export function resetProviderListsStateForTests(): void {
    listWritesDisabled = false
    for (const family of ADDED_FAMILIES) {
        delete carried[family]
    }
    saveChain = Promise.resolve()
}

/**
 * The saved lists. An absent, corrupt, foreign or oversized file is no lists
 * (writes stay allowed, the next success rewrites it); a read that throws is no
 * lists and disables list writes for the session. Never rejects.
 */
export async function loadProviderLists(): Promise<ProviderListsData> {
    try {
        const { bytes } = await (await getAppStore()).read(PROVIDER_LISTS_KEY)
        return bytes === null ? emptyProviderLists() : decodeProviderLists(bytes)
    } catch (error) {
        listWritesDisabled = true
        console.error('Model data could not be read', error)
        return emptyProviderLists()
    }
}

/**
 * The output of one save: this pass's family as given, every other family from
 * the freshly read file or the carried copy, whichever has the larger
 * `fetchedAt` (the file's on a tie).
 */
function mergeLists(disk: ProviderListsData, family: AddedFamily, list: ProviderList): ProviderListsData {
    const merged = emptyProviderLists()
    for (const other of ADDED_FAMILIES) {
        if (other === family) {
            merged.lists[other] = list
            continue
        }
        const onDisk = disk.lists[other]
        const pending = carried[other]
        const chosen = pending !== undefined && (onDisk === undefined || pending.fetchedAt > onDisk.fetchedAt) ? pending : onDisk
        if (chosen !== undefined) {
            merged.lists[other] = chosen
        }
    }
    return merged
}

async function saveOnce(family: AddedFamily, list: ProviderList, isAbandoned: () => boolean): Promise<void> {
    if (listWritesDisabled || !await canWrite()) {
        return
    }
    const store = await getAppStore()
    // A guarded write that loses a race is re-read, re-merged and tried once more.
    for (let attempt = 0; attempt < 2; attempt++) {
        let read: ReadResult
        try {
            read = await store.read(PROVIDER_LISTS_KEY)
        } catch (error) {
            listWritesDisabled = true
            console.error('Model data could not be read', error)
            return
        }
        const merged = mergeLists(read.bytes === null ? emptyProviderLists() : decodeProviderLists(read.bytes), family, list)
        const bytes = encodeProviderLists(merged)
        if (bytes === null) {
            console.error('Model data', new Error('Saved provider lists do not fit their file'))
            return
        }
        if (isAbandoned()) {
            return
        }
        const guarded = store.capabilities.conditionalWrites && read.version !== null
        try {
            await store.write(PROVIDER_LISTS_KEY, bytes, guarded && read.version !== null ? { ifVersion: read.version } : 'unconditional')
        } catch (error) {
            if (guarded && attempt === 0) {
                continue
            }
            throw error
        }
        // An abandoned save already handed its list to `carried`; a later save may have replaced it.
        if (isAbandoned()) {
            return
        }
        for (const other of ADDED_FAMILIES) {
            if (carried[other] !== undefined && merged.lists[other] === carried[other]) {
                delete carried[other]
            }
        }
        // Only this list, or an older copy it supersedes, is dropped; a newer carried copy stays.
        const pending = carried[family]
        if (pending === list || (pending !== undefined && pending.fetchedAt <= list.fetchedAt)) {
            delete carried[family]
        }
        return
    }
}

async function runSave(family: AddedFamily, list: ProviderList): Promise<void> {
    let abandoned = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>(resolve => {
        timer = setTimeout(() => {
            abandoned = true
            resolve('timeout')
        }, LIST_SAVE_TIMEOUT_MS)
    })
    try {
        const result = await Promise.race([saveOnce(family, list, () => abandoned), timedOut])
        if (result === 'timeout') {
            console.error('Model data', new Error('Saving the provider lists timed out'))
            carried[family] = list
        }
    } catch (error) {
        console.error('Model data', error)
        carried[family] = list
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Persists one family's list after a successful, non-empty fetch (an empty list
 * is never written, so a family is never emptied). Saves are serialised by a
 * module-level chain and each link is bounded by 30 seconds, so a store write
 * that never settles cannot stall later saves. Each save re-reads the file the
 * previous one wrote and merges (this family wins; the others by larger
 * `fetchedAt`). With conditional writes the write presents the version it read.
 * Never rejects; failures are logged once as `'Model data'` and the list is
 * carried to the next successful save.
 */
export function saveProviderLists(family: AddedFamily, list: ProviderList): Promise<void> {
    if (list.items.length === 0) {
        return Promise.resolve()
    }
    const link = saveChain.then(() => runSave(family, list))
    saveChain = link
    return link
}
