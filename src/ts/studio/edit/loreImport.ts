// Lorebook import (spec 3.6): `prepareLoreImport` turns the elements of the picked files into the rows a step appends, and
// `loreImport` is the builder the service completes against the live list. Both are pure: the list is read inside the
// build, so an insert that landed while the picker was open is already part of the collision check.
import type { loreBook } from '../../storage/database.svelte'
import { migrateLoreEntryToV2 } from '../../process/loreEntryMigration'
import type { ObjDraft, ObjEntry } from '../history/objectListOps'
import { LORE_FOLDER_PREFIX, idOf, isFolderRow, isLoreRow, type LoreHost } from './loreListModel'
import { defaultLoreIds, labelOf, makeOp, plainRow, ready, type LoreIds, type LoreOp } from './loreListOps'

const ID_TRIES = 8

export interface LoreImportPlan {
    entries: ObjEntry[]
    /** Elements that are not plain objects, or whose version migration threw. */
    skipped: number
    /** Entries whose own id was taken and got a fresh one; ids given to id-less entries are not counted. */
    renamedIds: number
    renamedFolders: number
}

export interface LoreImportSummary {
    count: number
    skipped: number
    renamedIds: number
    renamedFolders: number
}

export interface LoreImportOp extends LoreOp {
    /** What the last build saw: null when that build refused. */
    summary: () => LoreImportSummary | null
}

function fresh(taken: ReadonlySet<string>, make: () => string): string | null {
    for (let n = 0; n < ID_TRIES; n++) {
        const candidate = make()
        if (candidate !== '' && !taken.has(candidate)) return candidate
    }
    return null
}

/**
 * Null when no fresh id or folder key could be found. A skipped element never reaches the taken set, the remap or the
 * counts. Live rows are only read.
 */
export function prepareLoreImport(host: LoreHost, live: readonly unknown[], imported: readonly unknown[], ids: LoreIds): LoreImportPlan | null {
    // Pass 0: accept a plain copy; character and module lists are written at version 2 (D7), chat lists verbatim.
    const copies: ObjEntry[] = []
    let skipped = 0
    for (const element of imported) {
        const copy = isLoreRow(element) ? plainRow(element) : null
        if (copy === null) {
            skipped++
            continue
        }
        if (host !== 'chat') {
            try {
                migrateLoreEntryToV2(copy as unknown as loreBook)
            } catch {
                skipped++
                continue
            }
        }
        copies.push(copy)
    }

    // Pass 1: ids and folder keys over one taken set that grows with every accepted copy.
    const taken = new Set<string>()
    for (const row of live) {
        const id = idOf(row)
        if (id !== null) taken.add(id)
        if (isFolderRow(row)) taken.add(row.key)
    }
    const remap = new Map<string, string>()
    let renamedIds = 0
    let renamedFolders = 0
    for (const copy of copies) {
        const own = idOf(copy)
        let id: string | null = own
        if (own === null) {
            if (copy.mode !== 'folder') {
                id = fresh(taken, () => ids.newId())
                if (id === null) return null
                copy.id = id
            }
        } else if (taken.has(own)) {
            id = fresh(taken, () => ids.newId())
            if (id === null) return null
            copy.id = id
            renamedIds++
        }
        let key: string | null = null
        if (isFolderRow(copy)) {
            key = copy.key
            if (taken.has(key)) {
                const next = fresh(taken, () => LORE_FOLDER_PREFIX + ids.newFolderKey())
                if (next === null) return null
                if (!remap.has(key)) remap.set(key, next)
                copy.key = next
                key = next
                renamedFolders++
            } else if (!remap.has(key)) {
                // The first folder to hold a key owns its children: a later same-key folder is re-keyed with no effective remap.
                remap.set(key, key)
            }
        }
        if (id !== null) taken.add(id)
        if (key !== null) taken.add(key)
    }

    // Pass 2: each reference is rewritten once, from its original folder string.
    for (const copy of copies) {
        if (typeof copy.folder !== 'string') continue
        const next = remap.get(copy.folder)
        if (next !== undefined) copy.folder = next
    }
    return { entries: copies, skipped, renamedIds, renamedFolders }
}

/** One step appending every accepted element at the end of the list, in pick and file order. */
export function loreImport(host: LoreHost, imported: readonly unknown[], ids: LoreIds = defaultLoreIds): LoreImportOp {
    let summary: LoreImportSummary | null = null
    const op = makeOp((_id, live) => {
        summary = null
        const rows = live.objList?.('lore') ?? null
        if (rows === null) return { result: { ok: false, reason: 'precondition' }, landing: null }
        const plan = prepareLoreImport(host, rows, imported, ids)
        if (plan === null) return { result: { ok: false, reason: 'precondition' }, landing: null }
        summary = { count: plan.entries.length, skipped: plan.skipped, renamedIds: plan.renamedIds, renamedFolders: plan.renamedFolders }
        if (plan.entries.length === 0) return { result: { ok: false, reason: 'unchanged' }, landing: null }
        const index = rows.length
        const drafts: ObjDraft[] = plan.entries.map((entry, k) => ({ op: 'objInsert', list: 'lore', index: index + k, entry }))
        return ready(labelOf('import', null, { count: plan.entries.length }), drafts, null, { index })
    })
    return { ...op, summary: () => summary }
}
