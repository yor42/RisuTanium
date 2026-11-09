/**
 * Where a character sat in `characterOrder` when it was moved to the trash, so a restore can put it back.
 *
 * The record lives in the optional profile-root array `Database.trashOrigins`. It is plain data beside
 * `characterOrder` (no slot field, no cold-stub field), so every store and the `.bin` carry it as an unknown root
 * key. A record belongs to one trashing: it names the character (`chaId`) and the `trashTime` it was written for
 * (`t`), so a record left over from an earlier trashing never matches a later one.
 *
 * Everything here is total over any JSON a profile can hold: a record or order entry of an unexpected shape is
 * skipped or left untouched, and the worst outcome is that a character is restored to the end of the top level.
 * A `trashOrigins` that is not an array is never read or written.
 *
 * It has no module state and imports types only; `placeRestored`, `recordTrashOrigins` and `releaseTrashOrigin`
 * write to the order or database they are given.
 */
import type { Database, folder } from './storage/database.svelte'

/**
 * `folder` is the id of the folder that held the character. `after` is the entry just before it in the same
 * container: a character id, or at top level a folder id. `after` is absent when the character was first.
 */
export type TrashOrigin = {
    chaId: string
    t: number
    folder?: string
    after?: { char?: string, folder?: string }
}

type OrderEntry = string | folder
type OriginHost = Pick<Database, 'characters' | 'characterOrder' | 'trashOrigins'>

function isFolderEntry(entry: unknown): entry is folder {
    return typeof entry === 'object' && entry !== null && 'data' in entry && Array.isArray(entry.data)
}

/** A record that can be matched: a text `chaId` and a finite number `t`. Anything else is left alone. */
function isWellFormed(record: unknown): record is TrashOrigin {
    return typeof record === 'object' && record !== null
        && 'chaId' in record && typeof record.chaId === 'string'
        && 't' in record && typeof record.t === 'number' && Number.isFinite(record.t)
}

/** How many folder entries carry `id`. The same predicate GridCatalog uses for its kept-folder picks. */
export function folderIdCount(order: readonly OrderEntry[] | undefined, id: string): number {
    if (!Array.isArray(order)) {
        return 0
    }
    return order.filter((entry) => isFolderEntry(entry) && entry.id === id).length
}

/** The index of the one folder entry with this id; -1 when the id is empty, absent or shared. */
function uniqueFolderIndex(order: readonly OrderEntry[], id: unknown): number {
    if (typeof id !== 'string' || id === '' || folderIdCount(order, id) !== 1) {
        return -1
    }
    return order.findIndex((entry) => isFolderEntry(entry) && entry.id === id)
}

function orderedAnywhere(order: readonly OrderEntry[], chaId: string): boolean {
    return order.some((entry) => entry === chaId || (isFolderEntry(entry) && entry.data.includes(chaId)))
}

/**
 * The record for `chaId` trashed at `t`, read from the order before anything edits it; undefined when the id is
 * not ordered or the place cannot be named safely. Only the first occurrence of the id counts.
 *
 * A folder is named only when its id is a non-empty text that no other folder shares, and the same goes for a
 * folder that anchors a top-level character. `dissolved` lists folder entries the caller is about to replace by
 * their members: nothing can be restored into them, so no record names them.
 */
export function captureOrigin(order: readonly OrderEntry[] | undefined, chaId: string, t: number, dissolved: readonly unknown[] = []): TrashOrigin | undefined {
    if (!Array.isArray(order) || typeof chaId !== 'string' || chaId === '' || typeof t !== 'number' || !Number.isFinite(t)) {
        return undefined
    }
    for (let at = 0; at < order.length; at++) {
        const entry: unknown = order[at]
        if (entry === chaId) {
            return topLevelOrigin(order, at, chaId, t)
        }
        if (isFolderEntry(entry)) {
            const inside = entry.data.indexOf(chaId)
            if (inside !== -1) {
                return folderOrigin(order, entry, inside, chaId, t, dissolved)
            }
        }
    }
    return undefined
}

function topLevelOrigin(order: readonly OrderEntry[], at: number, chaId: string, t: number): TrashOrigin | undefined {
    for (let before = at - 1; before >= 0; before--) {
        const previous: unknown = order[before]
        if (typeof previous === 'string') {
            if (previous === chaId) {
                continue
            }
            return { chaId, t, after: { char: previous } }
        }
        if (isFolderEntry(previous)) {
            return uniqueFolderIndex(order, previous.id) !== -1 ? { chaId, t, after: { folder: previous.id } } : undefined
        }
    }
    return { chaId, t }
}

function folderOrigin(order: readonly OrderEntry[], entry: folder, inside: number, chaId: string, t: number, dissolved: readonly unknown[]): TrashOrigin | undefined {
    if (uniqueFolderIndex(order, entry.id) === -1 || dissolved.includes(entry)) {
        return undefined
    }
    for (let before = inside - 1; before >= 0; before--) {
        const previous: unknown = entry.data[before]
        if (typeof previous === 'string' && previous !== chaId) {
            return { chaId, t, folder: entry.id, after: { char: previous } }
        }
    }
    return { chaId, t, folder: entry.id }
}

/**
 * Puts `chaId` back into `order` in place, from the record.
 *
 * - An id that is already ordered anywhere stays where it is (a held save keeps ids the order would drop).
 * - With a folder in the record: that folder takes the id when exactly one folder has the id, after the anchor if
 *   the anchor is still inside it, first if the character was first, otherwise at its end. A folder that is gone,
 *   or whose id is now shared, sends the id to the top-level end.
 * - Without a folder: after the anchor if it is still at top level (a character, or a folder with a unique id),
 *   first if the character was first, otherwise at the top-level end.
 */
export function placeRestored(order: OrderEntry[], chaId: string, record: TrashOrigin): void {
    if (!Array.isArray(order) || orderedAnywhere(order, chaId)) {
        return
    }
    const anchored = record.after !== undefined
    const anchorChar = typeof record.after?.char === 'string' ? record.after.char : undefined
    if (record.folder !== undefined) {
        const folderAt = uniqueFolderIndex(order, record.folder)
        const target = folderAt === -1 ? undefined : order[folderAt]
        if (!isFolderEntry(target)) {
            order.push(chaId)
            return
        }
        const anchorAt = anchorChar === undefined ? -1 : target.data.indexOf(anchorChar)
        if (anchorAt !== -1) {
            target.data.splice(anchorAt + 1, 0, chaId)
        } else if (!anchored) {
            target.data.splice(0, 0, chaId)
        } else {
            target.data.push(chaId)
        }
        return
    }
    let anchorAt = -1
    if (anchorChar !== undefined) {
        anchorAt = order.indexOf(anchorChar)
    } else {
        anchorAt = uniqueFolderIndex(order, record.after?.folder)
    }
    if (anchorAt !== -1) {
        order.splice(anchorAt + 1, 0, chaId)
    } else if (!anchored) {
        order.splice(0, 0, chaId)
    } else {
        order.push(chaId)
    }
}

/** The record for exactly this trashing, or undefined. `list` and `t` may be anything a profile holds. */
export function findOrigin(list: unknown, chaId: string, t: unknown): TrashOrigin | undefined {
    if (!Array.isArray(list) || typeof t !== 'number' || !Number.isFinite(t)) {
        return undefined
    }
    const records: readonly unknown[] = list
    for (const record of records) {
        if (isWellFormed(record) && record.chaId === chaId && record.t === t) {
            return record
        }
    }
    return undefined
}

/** `list` with `record` added; a well-formed record for the same (`chaId`, `t`) is replaced. Others are kept as they are. */
export function withOrigin(list: readonly TrashOrigin[], record: TrashOrigin): TrashOrigin[] {
    return [...list.filter((entry: unknown) => !(isWellFormed(entry) && entry.chaId === record.chaId && entry.t === record.t)), record]
}

/** `list` without the record for exactly this (`chaId`, `t`); a twin trashed at another time keeps its record. */
export function withoutOrigin(list: readonly TrashOrigin[], chaId: string, t: number): TrashOrigin[] {
    return list.filter((entry: unknown) => !(isWellFormed(entry) && entry.chaId === chaId && entry.t === t))
}

/**
 * `list` without the well-formed records that no slot of `characters` matches by `chaId` and `trashTime === t`:
 * records of restored, purged or deleted characters. A record of an unexpected shape is kept (it may come from a
 * newer build).
 */
export function pruneOrigins(list: readonly TrashOrigin[], characters: readonly unknown[]): TrashOrigin[] {
    const trashedAt = new Map<string, Set<number>>()
    for (const slot of Array.isArray(characters) ? characters : []) {
        if (typeof slot === 'object' && slot !== null && 'chaId' in slot && 'trashTime' in slot
            && typeof slot.chaId === 'string' && typeof slot.trashTime === 'number') {
            const times = trashedAt.get(slot.chaId) ?? new Set<number>()
            times.add(slot.trashTime)
            trashedAt.set(slot.chaId, times)
        }
    }
    return list.filter((entry: unknown) => !isWellFormed(entry) || (trashedAt.get(entry.chaId)?.has(entry.t) ?? false))
}

/**
 * Records where each of `trashed` sat, then prunes. Call it right after the `trashTime` write (`t` is that value,
 * so the prune keeps the new records) and before the order is edited. A `trashOrigins` that is not an array is not
 * written. The array is written only when it exists or a record was made.
 */
export function recordTrashOrigins(db: OriginHost, trashed: readonly { chaId: string }[], t: number, dissolved: readonly unknown[] = []): void {
    const existing = db.trashOrigins
    if (existing !== undefined && !Array.isArray(existing)) {
        return
    }
    let list: TrashOrigin[] = existing === undefined ? [] : [...existing]
    for (const slot of trashed) {
        const record = captureOrigin(db.characterOrder, slot.chaId, t, dissolved)
        if (record) {
            list = withOrigin(list, record)
        }
    }
    list = pruneOrigins(list, db.characters)
    if (existing === undefined && list.length === 0) {
        return
    }
    db.trashOrigins = list
}

/** After a restore: drops the record of exactly this trashing (a twin keeps its own), then prunes. */
export function releaseTrashOrigin(db: OriginHost, chaId: string, t: number): void {
    const existing = db.trashOrigins
    if (!Array.isArray(existing)) {
        return
    }
    db.trashOrigins = pruneOrigins(withoutOrigin(existing, chaId, t), db.characters)
}
