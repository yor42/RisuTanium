import type { Database, character, groupChat } from '../storage/database.svelte'
import { applyStubStateOnRestore } from '../process/coldCharacter'
import { readColdCharacterCopy } from '../process/coldCharacterRestore'
import { collectColdStorageBackupPayloads, type ColdStorageBackupCollection } from '../process/coldstorage.svelte'
import { listColdBackupRoots } from '../process/coldstorageData'
import { isEntityUnitKey } from '../storage/store2/residencyActive'

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
    const collected = await collectColdStorageBackupPayloads(db, {
        roots: listColdBackupRoots(db).filter((root) => !isEntityUnitKey(root.key)),
        settledKeys: new Set(failedKeys),
    })
    return { collected, inlined, failedKeys, unavailableKeys: [...collected.missingKeys, ...collected.invalidKeys, ...failedKeys] }
}

/** The keys the late collection must not read again: everything the first collection settled and every entity it could not read. */
export function lateSettledKeys(collected: ColdStorageBackupCollection, failedKeys: readonly string[]): Set<string> {
    return new Set([...(collected.settledKeys ?? []), ...failedKeys])
}
