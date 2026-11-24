// Test-local draft builders for lorebook edits, written the way the S7-1 `loreListOps.ts` builders will emit them: one
// `ObjDraft[]` per user action, handed to `objEdit`. Each builder reads the live list through the reader the service
// passes, so an index the list no longer has still yields drafts and the planner's refusal is what the test sees.
// S7-1 must re-run the property test with its real builders in place of these.

import { getLoreBookSubtree } from 'src/ts/process/lorebookFolders'
import type { LiveReader } from '../historyModel'
import type { ObjBuildResult } from '../ownerHistory.svelte'
import type { ObjDraft, ObjEntry, ObjFieldValue, ObjValue } from '../objectListOps'

export type LoreBuilder = (id: string, live: LiveReader) => ObjBuildResult
type BuildLabel = Extract<ObjBuildResult, { ok: true }>['label']

const refusal: ObjBuildResult = { ok: false, reason: 'precondition' }

export function isRow(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rowsOf(live: LiveReader): readonly unknown[] {
    return live.objList?.('lore') ?? []
}

function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value))
}

function label(action: 'add' | 'delete' | 'edit' | 'move' | 'duplicate' | 'folderDelete' | 'bulkActive' | 'newId', field?: string, count?: number): BuildLabel {
    return { kind: 'obj', list: 'lore', action, name: null, ...(count === undefined ? {} : { count }), ...(field === undefined ? {} : { field }) }
}

function ready(drafts: ObjDraft[], built: BuildLabel): ObjBuildResult {
    return { ok: true, label: built, drafts, coalesceKey: null }
}

// One field of one row, as a step of its own.
export function fieldEdit(index: number, field: string, after: ObjFieldValue): LoreBuilder {
    return () => ready([{ op: 'objSet', list: 'lore', index, field, after }], label('edit', field))
}

// Case sensitive: spreads the row's `extentions` container so its other keys stay.
export function caseSensitive(index: number, on: boolean): LoreBuilder {
    return (_id, live) => {
        const row = rowsOf(live)[index]
        if (!isRow(row)) {
            return refusal
        }
        const container = row.extentions === undefined ? {} : row.extentions
        if (!isRow(container)) {
            return refusal
        }
        const value = { ...plain(container), risu_case_sensitive: on } as ObjEntry
        return ready([{ op: 'objSet', list: 'lore', index, field: 'extentions', after: { had: true, value } }], label('edit', 'extentions'))
    }
}

export function addEntry(index: number, entry: ObjEntry): LoreBuilder {
    return () => ready([{ op: 'objInsert', list: 'lore', index, entry: plain(entry) }], label('add'))
}

// A copy right after the source row; a row with an id gets a new one, an id-less row becomes an exact twin.
export function duplicateEntry(index: number, newId: string): LoreBuilder {
    return (_id, live) => {
        const row = rowsOf(live)[index]
        if (!isRow(row)) {
            return refusal
        }
        const copy = plain(row)
        if (typeof copy.id === 'string' && copy.id !== '') {
            copy.id = newId
        }
        return ready([{ op: 'objInsert', list: 'lore', index: index + 1, entry: copy as ObjEntry }], label('duplicate'))
    }
}

export function deleteEntry(index: number, deletedId: string): LoreBuilder {
    return () => ready([{ op: 'objRemove', list: 'lore', index, deletedId }], label('delete', undefined, 1))
}

// A folder and everything under it, through the real subtree walk; removes run highest index first and carry one id.
export function deleteSubtree(index: number, deletedId: string): LoreBuilder {
    return (_id, live) => {
        const rows = rowsOf(live)
        const target = rows[index]
        if (!isRow(target)) {
            return refusal
        }
        const objects = rows.filter(isRow)
        const removed = getLoreBookSubtree(objects as unknown as Parameters<typeof getLoreBookSubtree>[0], target as unknown as Parameters<typeof getLoreBookSubtree>[1])
        const indexes = rows.map((row, i) => (removed.has(row as never) ? i : -1)).filter((i) => i >= 0).sort((a, b) => b - a)
        const drafts: ObjDraft[] = indexes.map((i) => ({ op: 'objRemove', list: 'lore', index: i, deletedId }))
        return ready(drafts, label('folderDelete', undefined, drafts.length))
    }
}

// Moves a row into another folder (or out of every folder with an empty key) and to a new place: `objSet folder`, then
// remove, then insert of the row as it is after the set. `to` is an index of the list without the row.
export function moveEntry(index: number, folder: string, to: number): LoreBuilder {
    return (_id, live) => {
        const row = rowsOf(live)[index]
        if (!isRow(row)) {
            return refusal
        }
        const after: ObjFieldValue = folder === '' ? { had: false } : { had: true, value: folder }
        const moved = plain(row)
        if (folder === '') {
            delete moved.folder
        } else {
            moved.folder = folder
        }
        return ready(
            [
                { op: 'objSet', list: 'lore', index, field: 'folder', after },
                { op: 'objRemove', list: 'lore', index },
                { op: 'objInsert', list: 'lore', index: to, entry: moved as ObjEntry },
            ],
            label('move'),
        )
    }
}

// Give new ID: the row is removed and inserted again with another id at the same index.
export function giveNewId(index: number, newId: string): LoreBuilder {
    return (_id, live) => {
        const row = rowsOf(live)[index]
        if (!isRow(row)) {
            return refusal
        }
        const next = plain(row)
        next.id = newId
        return ready(
            [
                { op: 'objRemove', list: 'lore', index },
                { op: 'objInsert', list: 'lore', index, entry: next as ObjEntry },
            ],
            label('newId'),
        )
    }
}

// One boolean field set on several rows as one step.
export function bulkSet(indexes: readonly number[], field: string, value: ObjValue): LoreBuilder {
    return () => ready(indexes.map((index): ObjDraft => ({ op: 'objSet', list: 'lore', index, field, after: { had: true, value } })), label('bulkActive', field, indexes.length))
}

export function loreSettingsSet(value: ObjEntry | null): LoreBuilder {
    return () => ({
        ok: true,
        label: { kind: 'prop', prop: 'loreSettings' },
        drafts: [{ op: 'propSet', prop: 'loreSettings', after: value === null ? { had: false } : { had: true, value } }],
        coalesceKey: null,
    })
}
