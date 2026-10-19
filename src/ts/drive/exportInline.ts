import type { Database, character, groupChat } from '../storage/database.svelte'
import { applyStubStateOnRestore } from '../process/coldCharacter'
import { readColdCharacterCopy } from '../process/coldCharacterRestore'
import { collectColdStorageBackupPayloads, type ColdStorageBackupCollection, type ColdStorageBackupPayload } from '../process/coldstorage.svelte'
import { getColdStorageBackupName, listColdBackupRoots, listColdPluginStorageKeys } from '../process/coldstorageData'
import { getResidency, isEntityUnitKey } from '../storage/store2/residencyActive'
import { coldUnitCharacter } from '../process/coldCharacter'
import { isCharacterEntry, isUsableCharacterId } from '../storage/characterIds'
import { v4 as uuidv4 } from 'uuid'

/**
 * A `.bin` carries each character whole, or as an upstream-shaped stub with a unit payload. A store2 page may hold a
 * character as a stub whose `coldstorage` names a store2 entity: that is no unit file an importer places, so the export
 * reads the entity and, by mode, either puts the whole character in the database entry in the stub's place (`inline`) or
 * keeps a stub whose `coldstorage` is a uuid minted for this export and writes the character as the unit
 * `coldstorage_<uuid>.json` (`stub`). A stub whose entity cannot be read stays a stub in the export, is named in the
 * incomplete-data prompt like any unit the backup cannot carry, and is imported as a placeholder.
 */

type Slot = character | groupChat

/** How an export carries a character that a store2 page holds as a stub: whole in the database entry, or as a stub plus a unit entry. */
export type UnloadedCharacterMode = 'stub' | 'inline'

/**
 * The production mode. It stays `inline` until an upstream build is shown to restore a fork stub; flipping it is this
 * one line, and tests pass the other mode as a parameter instead of changing it.
 */
export const EXPORT_UNLOADED_CHARACTERS: UnloadedCharacterMode = 'inline'

/**
 * How a read of an entity that failed without saying why (a store failure, not a missing or damaged unit) is retried.
 * `pausesMs` are the pauses before the successive retries of one character. For the whole collection, `budgetMs` bounds
 * the total of the pauses and `maxRetries` bounds the number of retry reads, so the added wait is constant in the number
 * of characters. A retry read can itself take as long as the store's own retry of a rate limit (Node's client retries a
 * 429 before a read reports failure); these bounds do not shorten that.
 */
export interface ReadRetryPolicy {
    pausesMs: readonly number[]
    budgetMs: number
    maxRetries: number
    pause: (ms: number) => Promise<void>
}

export const DEFAULT_READ_RETRY: ReadRetryPolicy = {
    pausesMs: [400, 1200],
    budgetMs: 6000,
    maxRetries: 6,
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/**
 * Whether the export has to run the character-id repair on `list`: it is a list and some entry is not a character with a
 * usable id. The repair rewrites ids in the tree it is given (group member lists, chat speakers, folder order), and the
 * bodies of stub unit entries are fixed at collection, so a stub's unit body is written only when the export tree's ids
 * are the ones the body holds. When this holds, the export carries every unloaded character inline instead.
 */
export function characterListNeedsRepair(list: unknown): boolean {
    return Array.isArray(list) && !list.every((entry) => isCharacterEntry(entry) && isUsableCharacterId(entry.chaId))
}

export interface ExportCollectionOptions {
    mode?: UnloadedCharacterMode
    readRetry?: Partial<ReadRetryPolicy>
}

/** The identity of a stub in an export: its entity and its `chaId`, never the object, which a page may replace while the export runs. */
export function inlineKeyOf(u: string, chaId: unknown): string {
    return `${u}\u0000${String(chaId ?? '')}`
}

/** A stub's character as the unit entry of this export: the minted uuid the exported stub names, and the entry's bytes. */
export interface MintedStubEntry {
    uuid: string
    payload: ColdStorageBackupPayload
}

export interface StubsForExport {
    /** The character read from each stub's entity, by `inlineKeyOf`. */
    inlined: ReadonlyMap<string, Slot>
    /** In `stub` mode, the unit entry minted for each stub's entity, by `inlineKeyOf`. Only the entry's bytes are held, not the character. */
    stubEntries: ReadonlyMap<string, MintedStubEntry>
    /** The entities whose read did not give a character. */
    failedKeys: string[]
}

/** The unit entry of `character`: `{ character }` without the trash time, which only the stub carries. */
function stubUnitEntry(character: Slot): MintedStubEntry | null {
    let encoded: Uint8Array
    try {
        encoded = new TextEncoder().encode(JSON.stringify({ character: coldUnitCharacter(character) }))
    } catch {
        return null
    }
    const uuid = uuidv4()
    return { uuid, payload: { key: uuid, backupName: getColdStorageBackupName(uuid), encoded } }
}

/**
 * Reads, one at a time, the character of every stub of `db` that names a store2 entity. Installs nothing and marks nothing.
 * In `stub` mode a stub is kept as a stub and only its unit entry is held, unless the list needs the id repair
 * (`characterListNeedsRepair`): then every stub is inlined, so no unit body is minted with ids the repair will change.
 */
export async function readStubsForExport(db: Pick<Database, 'characters'>, options: ExportCollectionOptions = {}): Promise<StubsForExport> {
    const mode = (options.mode ?? EXPORT_UNLOADED_CHARACTERS) === 'stub' && !characterListNeedsRepair(db.characters) ? 'stub' : 'inline'
    const retry: ReadRetryPolicy = { ...DEFAULT_READ_RETRY, ...options.readRetry }
    const inlined = new Map<string, Slot>()
    const stubEntries = new Map<string, MintedStubEntry>()
    const failedKeys: string[] = []
    const list: unknown = db.characters
    if (!Array.isArray(list)) {
        return { inlined, stubEntries, failedKeys }
    }
    let waitedMs = 0
    let retries = 0
    // A copy: the list is the page's own and may change across the awaits below, which must not make a stub skipped.
    for (const slot of [...(list as Slot[])]) {
        const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
        if (typeof u !== 'string' || !isEntityUnitKey(u)) {
            continue
        }
        const key = inlineKeyOf(u, slot.chaId)
        if (inlined.has(key) || stubEntries.has(key)) {
            continue
        }
        let copy = await readColdCharacterCopy(slot)
        // A read that failed without a kind of its own may succeed a moment later; a missing or damaged unit never will.
        for (const pause of retry.pausesMs) {
            if (copy.status !== 'unreadable' || copy.kind !== undefined || waitedMs + pause > retry.budgetMs || retries >= retry.maxRetries) {
                break
            }
            waitedMs += pause
            retries++
            await retry.pause(pause)
            copy = await readColdCharacterCopy(slot)
        }
        if (copy.status !== 'ok') {
            if (!failedKeys.includes(u)) {
                failedKeys.push(u)
            }
            continue
        }
        const entry = mode === 'stub' ? stubUnitEntry(copy.character) : null
        if (entry === null) {
            inlined.set(key, copy.character)
        } else {
            stubEntries.set(key, entry)
        }
    }
    return { inlined, stubEntries, failedKeys }
}

/**
 * `slot` with its `coldstorage` replaced by the uuid minted for its entity in `stub` mode, or `null` when no entry was
 * minted for it. The stub keeps its trash time, last interaction and every other field.
 */
export function stubWithMintedKey(slot: Slot, stubEntries: ReadonlyMap<string, MintedStubEntry>): Slot | null {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u)) {
        return null
    }
    const entry = stubEntries.get(inlineKeyOf(u, slot.chaId))
    return entry === undefined ? null : { ...slot, coldstorage: entry.uuid }
}

/**
 * The whole character of a stub that has a minted entry, read back from the entry's bytes, with the stub's trash time and
 * last interaction; `null` when no entry was minted for it or the bytes do not hold a character. The fallback of an export
 * whose list turns out to need the id repair after the entries were minted.
 */
export function inlinedFromMinted(slot: Slot, stubEntries: ReadonlyMap<string, MintedStubEntry>): Slot | null {
    const u = typeof slot === 'object' && slot !== null ? slot.coldstorage : undefined
    if (typeof u !== 'string' || !isEntityUnitKey(u)) {
        return null
    }
    const entry = stubEntries.get(inlineKeyOf(u, slot.chaId))
    if (entry === undefined) {
        return null
    }
    try {
        const body = JSON.parse(new TextDecoder().decode(entry.payload.encoded)) as { character?: Slot }
        return body.character === undefined ? null : applyStubStateOnRestore(slot, body.character)
    } catch {
        return null
    }
}

/**
 * The unit entries to write for `characters`, the list that is encoded: one for each minted uuid some stub of it names,
 * in list order. An entry whose stub is not in the list (the character was loaded while the export ran) is not written.
 */
export function stubEntriesInTree(characters: unknown, stubEntries: ReadonlyMap<string, MintedStubEntry>): ColdStorageBackupPayload[] {
    if (!Array.isArray(characters) || stubEntries.size === 0) {
        return []
    }
    const byUuid = new Map<string, ColdStorageBackupPayload>()
    for (const entry of stubEntries.values()) {
        byUuid.set(entry.uuid, entry.payload)
    }
    const written = new Set<string>()
    const payloads: ColdStorageBackupPayload[] = []
    for (const slot of characters as unknown[]) {
        const key = typeof slot === 'object' && slot !== null ? (slot as Slot).coldstorage : undefined
        const payload = typeof key === 'string' ? byUuid.get(key) : undefined
        if (payload !== undefined && !written.has(key as string)) {
            written.add(key as string)
            payloads.push(payload)
        }
    }
    return payloads
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
    /** In `stub` mode, the unit entries minted for the stubs that stay stubs; which are written is decided by the encoded tree. */
    stubEntries: ReadonlyMap<string, MintedStubEntry>
    failedKeys: readonly string[]
    /** Every key the backup cannot carry; the incomplete-data prompt names them. */
    unavailableKeys: string[]
}

/**
 * The first cold-storage collection of an export: the stubs are read first, and the collector is given the roots that
 * are legacy units and the unreadable entities as already settled, so it neither reads an entity nor carries one under
 * a payload name.
 */
export async function collectBackupColdStorage(db: Database, options: ExportCollectionOptions = {}): Promise<BackupColdStorage> {
    const { inlined, stubEntries, failedKeys } = await readStubsForExport(db, options)
    const plugin = pluginStorageForExport(db)
    const collected = await collectColdStorageBackupPayloads(db, {
        roots: listColdBackupRoots(db).filter((root) => !isEntityUnitKey(root.key) && !plugin.ids.has(root.key)),
        settledKeys: new Set([...failedKeys, ...plugin.ids]),
    })
    const merged = mergePluginStorage(collected, plugin)
    return { collected: merged, inlined, stubEntries, failedKeys, unavailableKeys: [...merged.missingKeys, ...merged.invalidKeys, ...failedKeys] }
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

/**
 * The keys the late collection must not read again: everything the first collection settled, every entity it could not
 * read, and every uuid minted for a stub of this export, which names an entry this export writes and no legacy unit.
 */
export function lateSettledKeys(collected: ColdStorageBackupCollection, failedKeys: readonly string[], stubEntries: ReadonlyMap<string, MintedStubEntry> = new Map()): Set<string> {
    return new Set([...(collected.settledKeys ?? []), ...failedKeys, ...[...stubEntries.values()].map((entry) => entry.uuid)])
}
