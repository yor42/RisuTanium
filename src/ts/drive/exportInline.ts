import type { Database, character, groupChat } from '../storage/database.svelte'
import { applyStubStateOnRestore } from '../process/coldCharacter'
import { readColdCharacterCopy } from '../process/coldCharacterRestore'
import { collectColdStorageBackupPayloads, type ColdStorageBackupCollection, type ColdStorageBackupPayload } from '../process/coldstorage.svelte'
import { getColdStorageBackupName, listColdBackupRoots, listColdPluginStorageKeys } from '../process/coldstorageData'
import { getResidency, isEntityUnitKey } from '../storage/store2/residencyActive'

/**
 * A `.bin` carries each character whole, or as an upstream-shaped stub with a unit payload. A store2 page may hold a
 * character as a stub whose `coldstorage` names a store2 entity: that is no unit file an importer places, so the export
 * reads the entity and puts the whole character in the database entry in the stub's place. A stub whose entity cannot
 * be read stays a stub in the export, is named in the incomplete-data prompt like any unit the backup cannot carry, and
 * is imported as a placeholder.
 */

type Slot = character | groupChat

/** The identity of a stub in an export: its entity and its `chaId`, never the object, which a page may replace while the export runs. */
export function inlineKeyOf(u: string, chaId: unknown): string {
    return `${u}\u0000${String(chaId ?? '')}`
}

export interface StubsForExport {
    /** The character read from each stub's entity, by `inlineKeyOf`. */
    inlined: ReadonlyMap<string, Slot>
    /** The entities whose read did not give a character. */
    failedKeys: string[]
}

/** Reads, one at a time, the character of every stub of `db` that names a store2 entity. Installs nothing and marks nothing. */
export async function readStubsForExport(db: Pick<Database, 'characters'>): Promise<StubsForExport> {
    const inlined = new Map<string, Slot>()
    const failedKeys: string[] = []
    const list: unknown = db.characters
    if (!Array.isArray(list)) {
        return { inlined, failedKeys }
    }
    // A copy: the list is the page's own and may change across the awaits below, which must not make a stub skipped.
    for (const slot of [...(list as Slot[])]) {
        const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
        if (typeof u !== 'string' || !isEntityUnitKey(u)) {
            continue
        }
        const key = inlineKeyOf(u, slot.chaId)
        if (inlined.has(key)) {
            continue
        }
        const copy = await readColdCharacterCopy(slot)
        if (copy.status === 'ok') {
            inlined.set(key, copy.character)
        } else if (!failedKeys.includes(u)) {
            failedKeys.push(u)
        }
    }
    return { inlined, failedKeys }
}

/**
 * `slot`, or the whole character that was read for it. The stub's trash time and last interaction are applied here, at
 * the time of the encode, so a character trashed while the export copies assets is exported trashed.
 */
export function inlinedCharacter(slot: Slot, inlined: ReadonlyMap<string, Slot>): Slot {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u)) {
        return slot
    }
    const whole = inlined.get(inlineKeyOf(u, slot.chaId))
    return whole === undefined ? slot : applyStubStateOnRestore(slot, whole)
}

export interface BackupColdStorage {
    /** The legacy units to carry. No store2 entity is among them. */
    collected: ColdStorageBackupCollection
    inlined: ReadonlyMap<string, Slot>
    failedKeys: readonly string[]
    /** Every key the backup cannot carry; the incomplete-data prompt names them. */
    unavailableKeys: string[]
}

/**
 * The first cold-storage collection of an export: the stubs are read first, and the collector is given the roots that
 * are legacy units and the unreadable entities as already settled, so it neither reads an entity nor carries one under
 * a payload name.
 */
export async function collectBackupColdStorage(db: Database): Promise<BackupColdStorage> {
    const { inlined, failedKeys } = await readStubsForExport(db)
    const plugin = pluginStorageForExport(db)
    const collected = await collectColdStorageBackupPayloads(db, {
        roots: listColdBackupRoots(db).filter((root) => !isEntityUnitKey(root.key) && !plugin.ids.has(root.key)),
        settledKeys: new Set([...failedKeys, ...plugin.ids]),
    })
    const merged = mergePluginStorage(collected, plugin)
    return { collected: merged, inlined, failedKeys, unavailableKeys: [...merged.missingKeys, ...merged.invalidKeys, ...failedKeys] }
}

export interface PluginStorageForExport {
    /** `db` without the plain keys of the values carried as units; `db` itself when none are. */
    tree: Database
    /** One unit payload per mapped id that has a value in the tree, in the shape the legacy collector writes. */
    payloads: ColdStorageBackupPayload[]
    /** The mapped ids with no value in the tree. */
    missingKeys: string[]
    /** For each missing id, the plugin slot that names it, in the form the incomplete-data prompt lists characters. */
    owners: Map<string, string[]>
    /** Every mapped id: the legacy collector must not read, carry or report these. */
    ids: Set<string>
}

/**
 * While a store2 residency is registered, a plugin slot's value lives in `pluginCustomStorage[<id>]` of the tree and the
 * legacy unit store holds none or a stale one. The export writes each mapped value as the `coldstorage_<id>` payload the
 * legacy collector would write, so the fork's re-import restores it, and leaves the plain key out of the exported copy,
 * never out of the page.
 * `skip` holds ids an earlier collection already settled. Without a residency nothing changes: the legacy collector
 * reads the units.
 */
export function pluginStorageForExport(db: Database, skip: ReadonlySet<string> = new Set()): PluginStorageForExport {
    const result: PluginStorageForExport = { tree: db, payloads: [], missingKeys: [], owners: new Map(), ids: new Set() }
    const storage = db.pluginCustomStorage
    if (getResidency() === null || typeof storage !== 'object' || storage === null) {
        return result
    }
    const slots = new Map<string, string>()
    for (const [slot, id] of Object.entries(storage._coldplugin ?? {})) {
        if (typeof id === 'string' && !slots.has(id)) {
            slots.set(id, slot)
        }
    }
    // The listing the legacy collector uses, so the two cannot disagree on which ids are mapped.
    for (const id of listColdPluginStorageKeys(db)) {
        result.ids.add(id)
    }
    for (const id of result.ids) {
        if (skip.has(id)) {
            continue
        }
        let encoded: Uint8Array | null = null
        try {
            const json: string | undefined = storage[id] === undefined ? undefined : JSON.stringify(storage[id])
            encoded = json === undefined ? null : new TextEncoder().encode(json)
        } catch {
            encoded = null
        }
        if (encoded === null) {
            result.missingKeys.push(id)
            result.owners.set(id, [`Plugin storage "${slots.get(id)}"`])
        } else {
            result.payloads.push({ key: id, backupName: getColdStorageBackupName(id), encoded })
        }
    }
    if (result.ids.size > 0) {
        result.tree = {
            ...db,
            pluginCustomStorage: Object.fromEntries(Object.entries(storage).filter(([key]) => !result.ids.has(key))),
        }
    }
    return result
}

/** `collected` with the plugin payloads, missing ids and their owners added; `collected` itself when there are none. */
export function mergePluginStorage(collected: ColdStorageBackupCollection, plugin: PluginStorageForExport): ColdStorageBackupCollection {
    if (plugin.ids.size === 0) {
        return collected
    }
    const owners = new Map(collected.owners ?? [])
    for (const [key, names] of plugin.owners) {
        owners.set(key, names)
    }
    return {
        payloads: [...collected.payloads, ...plugin.payloads],
        missingKeys: [...collected.missingKeys, ...plugin.missingKeys],
        invalidKeys: collected.invalidKeys,
        owners: owners.size > 0 ? owners : undefined,
        settledKeys: new Set([...(collected.settledKeys ?? []), ...plugin.ids]),
    }
}

/** The keys the late collection must not read again: everything the first collection settled and every entity it could not read. */
export function lateSettledKeys(collected: ColdStorageBackupCollection, failedKeys: readonly string[]): Set<string> {
    return new Set([...(collected.settledKeys ?? []), ...failedKeys])
}
