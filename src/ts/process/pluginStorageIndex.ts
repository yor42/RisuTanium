/**
 * Upstream's plugin storage index, read the way upstream's loader reads it.
 *
 * Upstream keeps plugin storage in one index unit (`risu-plugin-storage-index`):
 * each entry is a key with either its value as JSON text (`s`) or the id of a
 * unit that holds a large value (`l`); the database holds only the pointer
 * `pluginCustomStorage._coldpluginIndex`. The fork keeps one unit per key under
 * `pluginCustomStorage._coldplugin` and never stores the pointer, so a pointer
 * that arrives in an imported database is converted here into `_coldplugin`
 * slots. No Svelte, database or storage imports: callers pass the unit reader
 * and writer in.
 */

export const PLUGIN_STORAGE_INDEX_KEY = '_coldpluginIndex'
export const PLUGIN_STORAGE_INDEX_TYPE = 'risu-plugin-storage-index'
export const PLUGIN_STORAGE_LEGACY_MAP_KEY = '_coldplugin'

/** The id shape a restore places a unit under (`coldstorage_<uuid>.json`). */
const UNIT_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isPluginUnitId(id: string): boolean {
    return UNIT_ID_PATTERN.test(id)
}

/** What the loader requires of an index unit; `trash` and `version` are never read for their content. */
export type PluginStorageIndex = {
    type: typeof PLUGIN_STORAGE_INDEX_TYPE
    entries: readonly unknown[]
    trash: readonly unknown[]
}

export function isPluginStorageIndex(data: unknown): data is PluginStorageIndex {
    if (!data || typeof data !== 'object') {
        return false
    }
    const candidate = data as { type?: unknown, entries?: unknown, trash?: unknown }
    return candidate.type === PLUGIN_STORAGE_INDEX_TYPE
        && Array.isArray(candidate.entries)
        && Array.isArray(candidate.trash)
}

/** The index unit id the database points at; a pointer that is not a string, or is empty, is no pointer (upstream reads it the same way). */
export function pluginIndexPointer(storage: unknown): string | null {
    const pointer = (storage as { _coldpluginIndex?: unknown } | null | undefined)?._coldpluginIndex
    return typeof pointer === 'string' && pointer !== '' ? pointer : null
}

export type PluginIndexSlot =
    | { key: string, kind: 'large', id: string }
    | { key: string, kind: 'small', json: string }

/**
 * The slots the index defines, in first-seen key order. An entry without a
 * string `k` is skipped, `l` wins over `s` in the same entry, an entry with
 * neither is skipped, and a later entry for the same key replaces an earlier one.
 */
export function slotsOfIndex(index: PluginStorageIndex): PluginIndexSlot[] {
    const slots = new Map<string, PluginIndexSlot>()
    for (const entry of index.entries) {
        if (!entry || typeof entry !== 'object') {
            continue
        }
        const { k, l, s } = entry as { k?: unknown, l?: unknown, s?: unknown }
        if (typeof k !== 'string') {
            continue
        }
        if (typeof l === 'string') {
            slots.set(k, { key: k, kind: 'large', id: l })
        }
        else if (typeof s === 'string') {
            slots.set(k, { key: k, kind: 'small', json: s })
        }
    }
    return [...slots.values()]
}

/**
 * Every large-value unit id any entry names, whether or not a later entry
 * replaces it (upstream's backup lists them the same way). A caller that keeps
 * or carries units uses this set, so it can only be larger than the live slots.
 */
export function largeIdsOfIndex(index: PluginStorageIndex): string[] {
    const ids: string[] = []
    for (const entry of index.entries) {
        const l = (entry as { l?: unknown } | null | undefined)?.l
        if (typeof l === 'string') {
            ids.push(l)
        }
    }
    return ids
}

/**
 * The `_coldplugin` map after the index is applied: `legacy` entries stay unless
 * the index defines the key (the index wins) or `dropped` names it (the index
 * defined it and its value could not be placed, so the older value is not left
 * standing in its place). Built through a Map so a key such as `__proto__` stays
 * an own property.
 */
export function mergeIndexIntoSlotMap(
    legacy: unknown,
    indexed: ReadonlyMap<string, string>,
    dropped: ReadonlySet<string>,
): Record<string, unknown> {
    const merged = new Map<string, unknown>()
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        for (const [key, value] of Object.entries(legacy)) {
            merged.set(key, value)
        }
    }
    for (const key of dropped) {
        merged.delete(key)
    }
    for (const [key, id] of indexed) {
        merged.set(key, id)
    }
    return Object.fromEntries(merged)
}

export type PluginIndexRead =
    | { status: 'ok', value: unknown }
    | { status: 'missing' }
    | { status: 'error', error?: unknown }

export type PluginIndexIo = {
    read(id: string): Promise<PluginIndexRead>
    /** Whether the unit was stored. `value` is never `undefined`. */
    write(id: string, value: unknown): Promise<boolean>
    /** A new unit id; `isPluginUnitId` must hold for it. */
    mint(): string
}

export type PluginIndexConversion = {
    /** Units this conversion wrote. */
    minted: string[]
    /** Unit ids the converted tree cannot be completed without; the caller reports them. */
    missing: string[]
}

/**
 * Replaces `storage._coldpluginIndex` by `_coldplugin` slots, in place.
 *
 * Large entries map their key to the unit the index names (the unit is not
 * read here; the caller's presence check covers it). Small entries become new
 * units, and a key is mapped only after its unit was written. A missing,
 * unreadable or non-index index unit, an index value that is not JSON, a
 * failed write and a large id that is no unit id are all returned in `missing`
 * and never turned into an empty value. The pointer is removed whatever the
 * outcome, so it can never be exported or kept without its units.
 */
export async function convertPluginStorageIndex(
    storage: Record<string, unknown> | null | undefined,
    io: PluginIndexIo,
): Promise<PluginIndexConversion> {
    const result: PluginIndexConversion = { minted: [], missing: [] }
    if (!storage || !Object.prototype.hasOwnProperty.call(storage, PLUGIN_STORAGE_INDEX_KEY)) {
        return result
    }
    const pointer = pluginIndexPointer(storage)
    delete storage[PLUGIN_STORAGE_INDEX_KEY]
    if (pointer === null) {
        return result
    }
    if (!isPluginUnitId(pointer)) {
        result.missing.push(pointer)
        return result
    }

    let read: PluginIndexRead
    try {
        read = await io.read(pointer)
    }
    catch (error) {
        read = { status: 'error', error }
    }
    if (read.status !== 'ok' || !isPluginStorageIndex(read.value)) {
        result.missing.push(pointer)
        return result
    }

    const indexed = new Map<string, string>()
    const dropped = new Set<string>()
    for (const slot of slotsOfIndex(read.value)) {
        if (slot.kind === 'large') {
            if (isPluginUnitId(slot.id)) {
                indexed.set(slot.key, slot.id)
            }
            else {
                dropped.add(slot.key)
                result.missing.push(slot.id)
            }
            continue
        }
        const id = io.mint()
        let written = false
        try {
            written = await io.write(id, JSON.parse(slot.json))
        }
        catch {
            written = false
        }
        if (written) {
            indexed.set(slot.key, id)
            result.minted.push(id)
        }
        else {
            dropped.add(slot.key)
            result.missing.push(id)
        }
    }
    if (indexed.size > 0 || dropped.size > 0) {
        storage[PLUGIN_STORAGE_LEGACY_MAP_KEY] = mergeIndexIntoSlotMap(storage[PLUGIN_STORAGE_LEGACY_MAP_KEY], indexed, dropped)
    }
    return result
}
