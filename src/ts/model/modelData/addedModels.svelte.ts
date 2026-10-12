import { DBState } from '../../stores.svelte'
import type { LLMModel } from '../types'
import { localDateString } from '../modelStatus'
import {
    ADDED_FAMILIES,
    RESPONSE_API_SUFFIX,
    addedSpecKey,
    buildAddedModel,
    emptyAddedState,
    isValidAddedId,
    reconcileAdded,
    resolveAddedModel,
    type AddedFamily,
    type AddedLists,
    type AddedSpec,
    type AddedState,
    type CatalogModel,
} from './addedModelsData'
import { getLiteLLMData, subscribeDataset } from './modelDataService.svelte'
import type { ProviderListItem, ProviderListsData } from './providerListData'

/**
 * Registry of the models added beyond the built-in catalog, from the provider's own
 * model list and from the LiteLLM dataset.
 *
 * The reconciled result lives in one `$state.raw` cell that is replaced whole, and only
 * at the three points where an input changes: a live list (`setProviderList`), a saved
 * list (`seedProviderLists`) and a new dataset (the subscription). The cell holds nothing
 * that depends on a key, the option or the clock, and the getters below only read: a rune
 * write inside a `$derived` would throw, and a picker reads these inside one.
 *
 * This module imports no store, no byte store and not `modellist.ts` (the catalog is
 * handed in), so `modellist.ts` can import it statically.
 */

/** Where an added entry is known from. `both` is white in the picker; the others are gray. */
export type AddedSource = 'both' | 'dataset' | 'provider'

let state = $state.raw<AddedState>(emptyAddedState())

/** Null until the catalog registers: with no catalog nothing is created or admitted (fail closed). */
let catalogSource: (() => readonly CatalogModel[]) | null = null

/** Lists fetched this session. A live list always wins over a saved one of the same family. */
const liveLists: Partial<Record<AddedFamily, readonly ProviderListItem[]>> = {}
const savedLists: Partial<Record<AddedFamily, readonly ProviderListItem[]>> = {}

let unsubscribeDataset: (() => void) | null = null

/** Runs only from the replacement points, never from a getter. */
function recompute(): void {
    const lists: AddedLists = {}
    for (const family of ADDED_FAMILIES) {
        lists[family] = liveLists[family] ?? savedLists[family] ?? null
    }
    state = reconcileAdded(catalogSource === null ? null : catalogSource(), getLiteLLMData(), lists)
}

function followDataset(): void {
    unsubscribeDataset?.()
    unsubscribeDataset = subscribeDataset(recompute)
}

followDataset()

export function registerCatalog(source: () => readonly CatalogModel[]): void {
    catalogSource = source
    recompute()
}

/** A successful fetch of one family: replaces that family's list and recomputes at once. */
export function setProviderList(family: AddedFamily, items: readonly ProviderListItem[]): void {
    liveLists[family] = [...items]
    recompute()
}

/** The saved lists: fills only the families that have no live list yet. */
export function seedProviderLists(saved: ProviderListsData): void {
    for (const family of ADDED_FAMILIES) {
        const list = saved.lists[family]
        if (list !== undefined && liveLists[family] === undefined) {
            savedLists[family] = list.items
        }
    }
    recompute()
}

/** The entry a saved id names, or null (the caller then falls back to the as-is entry). A pure read. */
export function resolveAdded(id: string): LLMModel | null {
    return resolveAddedModel(id, state)
}

function hasKey(family: AddedFamily): boolean {
    const db = DBState.db
    switch (family) {
        case 'google':
            return !!db?.google?.accessToken
        case 'anthropic':
            return !!db?.claudeAPIKey
        case 'openai':
            return !!db?.openAIKey
    }
}

/** Both sources count only while the family's key is present; without it the entry is known from the dataset alone. */
function sourceOf(spec: AddedSpec): AddedSource {
    if (spec.inList && spec.inDataset) {
        return hasKey(spec.family) ? 'both' : 'dataset'
    }
    return spec.inDataset ? 'dataset' : 'provider'
}

function specOfId(id: string): AddedSpec | undefined {
    if (id.startsWith('dynamic_google_')) {
        return state.index.get(addedSpecKey('google', id.slice('dynamic_google_'.length)))
    }
    if (id.startsWith('dynamic_anthropic_')) {
        return state.index.get(addedSpecKey('anthropic', id.slice('dynamic_anthropic_'.length)))
    }
    const direct = state.index.get(addedSpecKey('openai', id))
    if (direct !== undefined || !id.endsWith(RESPONSE_API_SUFFIX)) {
        return direct
    }
    return state.index.get(addedSpecKey('openai', id.slice(0, -RESPONSE_API_SUFFIX.length)))
}

/**
 * The source of an added id, listed or hidden alike, so a hidden one-sided id still reports
 * its source. Undefined for a built-in, for an id the registry does not hold, and for a
 * `dynamic_*` id with no registry entry. The source never depends on the clock, so a
 * date-hidden entry still reports it.
 */
export function addedSourceOf(id: string): AddedSource | undefined {
    const spec = specOfId(id)
    return spec === undefined ? undefined : sourceOf(spec)
}

/**
 * The added entries the picker lists now. Read at call time, so a cleared key, the option
 * and the date apply without a refetch: nothing when the option is off; never a hidden
 * (near-duplicate or non-chat) id; a provider-only entry needs its key; a dataset-sourced
 * entry is dropped from its deprecation date on (local date, as the status table compares).
 * `recommended` is set on a copy: true only for `both`; a Response API twin never is.
 */
export function getListedAddedModels(now: Date = new Date()): LLMModel[] {
    if (!DBState.db?.dynamicModelRegistry) {
        return []
    }
    const today = localDateString(now)
    const listed: LLMModel[] = []
    for (const spec of state.specs) {
        if (spec.hidden !== undefined || !isValidAddedId(spec.rawId)) {
            continue
        }
        const source = sourceOf(spec)
        if (source === 'provider' && !hasKey(spec.family)) {
            continue
        }
        if (source === 'dataset' && spec.datasetDeprecated !== undefined && spec.datasetDeprecated <= today) {
            continue
        }
        if (spec.family !== 'openai') {
            listed.push({ ...buildAddedModel(spec.family, spec.rawId, spec.displayName), recommended: source === 'both' })
            continue
        }
        if (spec.twins.bare) {
            listed.push({ ...buildAddedModel('openai', spec.rawId, spec.displayName), recommended: source === 'both' })
        }
        if (spec.twins.responseApi) {
            listed.push({ ...buildAddedModel('openai', spec.rawId, spec.displayName, 'response-api'), recommended: false })
        }
    }
    return listed
}

/** Test seam: forgets every list and re-subscribes to the dataset (the service's own reset drops its listeners). */
export function resetAddedModelsForTests(): void {
    for (const family of ADDED_FAMILIES) {
        delete liveLists[family]
        delete savedLists[family]
    }
    followDataset()
    recompute()
}
