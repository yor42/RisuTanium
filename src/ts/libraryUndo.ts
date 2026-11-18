import { language } from 'src/lang'
import { restoreCharacterFromTrash, type TrashedBatch } from 'src/ts/characters'
import { checkCharOrder } from 'src/ts/globalApi.svelte'
import type { folder } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { postUndoToast, type UndoAction } from 'src/ts/toast/toastHost.svelte'
import { findOrigin, folderIdCount } from 'src/ts/trashOrigin'

type Slot = (typeof DBState.db.characters)[number]

/**
 * The Undo for one move to the trash. It closes over plain data only (the trash time and the chaIds) and
 * re-reads the live list when it runs: a slot is taken for each id when it carries that id and the batch's
 * `trashTime`, so a character restored, trashed again later or deleted for good since is left alone, and a
 * slot swapped in for a stub (same id, copied `trashTime`) is found. Every write is the one
 * `restoreCharacterFromTrash` makes for the trash list's Restore, so placement, the save mark and the origin
 * release are identical. The slots that still match come back and the text says how many; it refuses only when
 * none does. Several undo toasts can be live at once; each one's identity rule keeps them independent.
 */
export function trashUndoAction(batch: TrashedBatch): UndoAction {
    const at = batch.at
    const chaIds = [...batch.chaIds]
    return {
        id: 'library-trash:' + at + ':' + chaIds.join(','),
        failedText: language.othersUi.libraryUndoTrashFailed,
        run() {
            const used = new Set<Slot>()
            const slots: Slot[] = []
            for (const id of chaIds) {
                const slot = DBState.db.characters.find((c) => c.chaId === id && c.trashTime === at && !used.has(c))
                if (slot) {
                    used.add(slot)
                    slots.push(slot)
                }
            }
            if (slots.length === 0) {
                return { ok: false, text: language.othersUi.libraryUndoTrashRefused }
            }
            for (const slot of slots) {
                restoreCharacterFromTrash(slot)
            }
            return { ok: true, text: language.othersUi.libraryUndoRestored(slots.length) }
        },
    }
}

/**
 * Whether at least one character of the batch will come back at the top-level end: it has no origin record (a
 * deleted or dissolved folder records none), or its folder is gone or no longer unique. Same-id twins trashed
 * together share one record, so the second twin may go to the end while this says no; that is the existing
 * placement rule for twins.
 */
function returnsToEnd(batch: TrashedBatch): boolean {
    return batch.chaIds.some((id) => {
        const origin = findOrigin(DBState.db.trashOrigins, id, batch.at)
        if (origin === undefined) {
            return true
        }
        return origin.folder !== undefined && folderIdCount(DBState.db.characterOrder, origin.folder) !== 1
    })
}

/** Posts "Moved N to the trash" with Undo. Plain reads only, so it cannot disturb the trash it reports. */
export function postTrashUndo(batch: TrashedBatch): void {
    const kept: TrashedBatch = { at: batch.at, chaIds: [...batch.chaIds] }
    postUndoToast({
        text: language.othersUi.libraryUndoTrashed(kept.chaIds.length),
        sub: returnsToEnd(kept) ? language.othersUi.libraryUndoTrashedEndNote : undefined,
        actionLabel: language.uiCommon.undo,
        action: trashUndoAction(kept),
    })
}

export type OrderCopy = (string | folder)[]

export type OrderUndoKind = 'grouped' | 'merged' | 'folderRemoved' | 'movedIntoFolder' | 'ungrouped' | 'folderDeleted'

/**
 * A fresh plain copy of the saved order. It is deep because `checkCharOrder` splices a folder's member list in
 * place and deletes an emptied folder: a shallow copy would change with the live order and could not restore it.
 */
export function copyOrder(order: readonly (string | folder)[] | undefined): OrderCopy {
    return (order ?? []).map((entry) => {
        if (typeof entry === 'object' && entry !== null) {
            return Array.isArray(entry.data) ? { ...entry, data: [...entry.data] } : { ...entry }
        }
        return entry
    })
}

function sameEntry(a: string | folder, b: string | folder): boolean {
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return a === b
    }
    const left = a as unknown as Record<string, unknown>
    const right = b as unknown as Record<string, unknown>
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) {
        return false
    }
    return keys.every((key) => {
        if (!Object.hasOwn(right, key)) {
            return false
        }
        const x = left[key]
        const y = right[key]
        if (Array.isArray(x) && Array.isArray(y)) {
            return x.length === y.length && x.every((item, at) => item === y[at])
        }
        return x === y
    })
}

/** Strict equality of two orders: same length, strings by value, folders by every field (key order ignored). */
export function sameOrder(a: readonly (string | folder)[], b: readonly (string | folder)[]): boolean {
    return a.length === b.length && a.every((entry, at) => sameEntry(entry, b[at]))
}

// A folder entry is an object with an array `data`, as `folderIdCount` counts it. An entry whose id is not a
// string is not counted.
function folderIdCounts(order: readonly (string | folder)[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const entry of order) {
        if (typeof entry === 'object' && entry !== null && Array.isArray(entry.data) && typeof entry.id === 'string') {
            counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
        }
    }
    return counts
}

/**
 * Whether the write removed a folder: for some folder id, fewer entries carry it after than before. It counts
 * occurrences, not a Set of ids, so a lost twin of a repeated folder id counts too. It covers a dissolved
 * dragged folder and a source folder the write emptied.
 */
export function foldersLost(before: readonly (string | folder)[], after: readonly (string | folder)[]): boolean {
    const now = folderIdCounts(after)
    for (const [id, count] of folderIdCounts(before)) {
        if ((now.get(id) ?? 0) < count) {
            return true
        }
    }
    return false
}

let orderUndoCounter = 0

function orderUndoText(kind: OrderUndoKind, count: number): string {
    switch (kind) {
        case 'grouped': return language.othersUi.libraryUndoGrouped
        case 'merged': return language.othersUi.libraryUndoMerged
        case 'folderRemoved': return language.othersUi.libraryUndoFolderRemoved
        case 'movedIntoFolder': return language.othersUi.libraryUndoMovedIntoFolder(count)
        case 'ungrouped': return language.othersUi.libraryUndoUngrouped
        case 'folderDeleted': return language.othersUi.libraryUndoFolderDeleted
    }
}

/**
 * The Undo for one change of the library order. It holds two deep copies: the order before the action and the
 * order the action left. It writes only when the live order still equals the "after" copy, so a later change of
 * any kind (a move, a rename, a trash that edits the order) is never overwritten; otherwise it refuses. The
 * write is the hosts' own pair: assign the order, then `checkCharOrder`. A second run refuses, because the live
 * order is then the "before" copy. Several undo toasts can be live at once; this rule keeps them safe.
 */
export function orderUndoAction(kind: OrderUndoKind, before: OrderCopy, after: OrderCopy, count: number = 0): UndoAction {
    const was = copyOrder(before)
    const left = copyOrder(after)
    return {
        id: 'library-order:' + kind + ':' + (++orderUndoCounter),
        failedText: language.othersUi.libraryUndoOrderFailed,
        run() {
            const live = DBState.db.characterOrder
            if (!Array.isArray(live) || !sameOrder(live, left)) {
                return { ok: false, text: language.othersUi.libraryUndoOrderRefused }
            }
            DBState.db.characterOrder = copyOrder(was)
            checkCharOrder()
            return { ok: true, text: language.othersUi.libraryUndoOrderRestored }
        },
    }
}

/** Posts the toast of one order change with its Undo. Plain reads only. */
export function postOrderUndo(kind: OrderUndoKind, before: OrderCopy, after: OrderCopy, count: number = 0): void {
    postUndoToast({
        text: orderUndoText(kind, count),
        actionLabel: language.uiCommon.undo,
        action: orderUndoAction(kind, before, after, count),
    })
}
