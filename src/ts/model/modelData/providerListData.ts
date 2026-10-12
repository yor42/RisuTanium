import {
    ADDED_FAMILIES,
    cleanDisplayName,
    isValidAddedId,
    passesFamilyFilter,
    type AddedFamily,
} from './addedModelsData'

/**
 * Pure data layer for the saved provider model lists: reading one page of a
 * provider's listing, the cumulative item cap, and the stored file. Nothing
 * here touches the network, the store or a rune.
 *
 * Ids and names come from a remote response. An item is kept only when its id
 * passes the id rule and the family filter; names are cleaned and capped. The
 * item cap counts items that pass those filters, and is cumulative across
 * pages. Provider responses arrive already parsed (`fetchNative(...).json()`),
 * so their size is bounded by the item cap after parsing, not before.
 */

export const PROVIDER_LISTS_KEY = 'modeldata/providerlists.json'
export const PROVIDER_LIST_MAX_ITEMS = 2000
export const PROVIDER_LISTS_MAX_FILE_BYTES = 256 * 1024
export const PROVIDER_LIST_MAX_PAGES = 10

export interface ProviderListItem {
    id: string
    name?: string
}

export interface ProviderList {
    fetchedAt: number
    items: ProviderListItem[]
}

export interface ProviderListsData {
    v: 1
    lists: Partial<Record<AddedFamily, ProviderList>>
}

/** Family keys are fixed, but the object comes from a remote-derived file: no prototype keeps lookups own-only. */
function dictionary<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function emptyProviderLists(): ProviderListsData {
    return { v: 1, lists: dictionary<ProviderList>() }
}

function itemOf(id: unknown, name: unknown, family: AddedFamily): ProviderListItem | null {
    if (!isValidAddedId(id) || !passesFamilyFilter(family, id)) {
        return null
    }
    const clean = cleanDisplayName(name)
    return clean === undefined ? { id } : { id, name: clean }
}

/**
 * The usable items of one response page, or null when the response is not a
 * page or holds more than the item cap after filtering. Google keeps models
 * that list `generateContent` and strips `models/`; Anthropic and Google read
 * the display name, OpenAI has none. A missing array is an empty page for
 * Google and Anthropic (the provider-list rule) and an invalid response for OpenAI.
 */
export function parseProviderListPage(family: AddedFamily, json: unknown): ProviderListItem[] | null {
    if (!isRecord(json)) {
        return null
    }
    const field = family === 'google' ? json.models : json.data
    let entries: unknown[]
    if (field === undefined || field === null) {
        if (family === 'openai') {
            return null
        }
        entries = []
    } else if (Array.isArray(field)) {
        entries = field as unknown[]
    } else {
        return null
    }
    const items: ProviderListItem[] = []
    const seen = new Set<string>()
    for (const entry of entries) {
        if (!isRecord(entry)) {
            continue
        }
        let item: ProviderListItem | null
        if (family === 'google') {
            const methods = entry.supportedGenerationMethods
            if (!Array.isArray(methods) || !(methods as unknown[]).includes('generateContent') || typeof entry.name !== 'string') {
                continue
            }
            const bare = entry.name.startsWith('models/') ? entry.name.slice('models/'.length) : entry.name
            item = itemOf(bare, entry.displayName, family)
        } else if (family === 'anthropic') {
            item = itemOf(entry.id, entry.display_name, family)
        } else {
            item = itemOf(entry.id, undefined, family)
        }
        if (item === null || seen.has(item.id)) {
            continue
        }
        seen.add(item.id)
        items.push(item)
        if (items.length > PROVIDER_LIST_MAX_ITEMS) {
            return null
        }
    }
    return items
}

/**
 * Adds a page to the items read so far. An id seen earlier keeps its first
 * entry. Null when the cumulative count would pass the item cap: the whole
 * family then fails. The input arrays are not changed.
 */
export function appendListPage(accumulated: readonly ProviderListItem[], page: readonly ProviderListItem[]): ProviderListItem[] | null {
    const items = accumulated.map(item => ({ ...item }))
    const seen = new Set(items.map(item => item.id))
    for (const item of page) {
        if (seen.has(item.id)) {
            continue
        }
        seen.add(item.id)
        items.push(item.name === undefined ? { id: item.id } : { id: item.id, name: item.name })
        if (items.length > PROVIDER_LIST_MAX_ITEMS) {
            return null
        }
    }
    return items
}

/** Null when the encoded file would exceed the cap: the caller skips the write and logs. */
export function encodeProviderLists(data: ProviderListsData): Uint8Array | null {
    const lists = dictionary<ProviderList>()
    for (const family of ADDED_FAMILIES) {
        const list = data.lists[family]
        if (list !== undefined) {
            lists[family] = list
        }
    }
    const bytes = new TextEncoder().encode(JSON.stringify({ v: data.v, lists }))
    return bytes.length > PROVIDER_LISTS_MAX_FILE_BYTES ? null : bytes
}

function listFromStored(family: AddedFamily, value: unknown): ProviderList | null {
    if (!isRecord(value) || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt) || !Array.isArray(value.items)) {
        return null
    }
    const items: ProviderListItem[] = []
    const seen = new Set<string>()
    for (const entry of value.items as unknown[]) {
        if (!isRecord(entry)) {
            continue
        }
        const item = itemOf(entry.id, entry.name, family)
        if (item === null || seen.has(item.id)) {
            continue
        }
        seen.add(item.id)
        items.push(item)
        if (items.length > PROVIDER_LIST_MAX_ITEMS) {
            return null
        }
    }
    return { fetchedAt: value.fetchedAt, items }
}

/**
 * Reads the stored file. The byte length is checked before JSON.parse. A file
 * that is absent, over the cap, corrupt, foreign or of another version reads as
 * no lists (the next successful fetch rewrites it); a malformed family is
 * dropped alone; an item that fails the rules is dropped alone; unknown
 * fields and families are ignored.
 */
export function decodeProviderLists(bytes: Uint8Array): ProviderListsData {
    const empty = emptyProviderLists()
    if (bytes.length > PROVIDER_LISTS_MAX_FILE_BYTES) {
        return empty
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        return empty
    }
    if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.lists)) {
        return empty
    }
    const lists = dictionary<ProviderList>()
    for (const family of ADDED_FAMILIES) {
        if (!Object.prototype.hasOwnProperty.call(parsed.lists, family)) {
            continue
        }
        const list = listFromStored(family, parsed.lists[family])
        if (list !== null) {
            lists[family] = list
        }
    }
    return { v: 1, lists }
}
