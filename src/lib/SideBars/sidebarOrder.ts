import type { folder } from 'src/ts/storage/database.svelte'

/**
 * Pure, id-based operations over the sidebar's `characterOrder` value.
 *
 * Every operation addresses a character or folder by its id plus the occurrence number of
 * that id (the n-th entry carrying it), never by its position in the rendered list, so a
 * stale id, a duplicate entry or a hidden entry cannot change which entry an operation
 * reaches. Operations never mutate their input: they return the same array reference when
 * they do nothing, and otherwise a new array in which every changed folder is a fresh copy.
 * They only read through ordinary property access, so they work on a `$state` proxy.
 *
 * The shape of `characterOrder` is not changed: strings and folders only. A `null` entry or
 * a folder without a `data` array (possible in upstream data) is carried through untouched.
 */

/** One order entry. `null` can occur in data written by other tools. */
export type OrderEntry = string | folder | null

export interface CharRef {
    kind: 'char'
    id: string
    occurrence: number
}

export interface FolderRef {
    kind: 'folder'
    id: string
    occurrence: number
}

export interface MemberRef {
    kind: 'member'
    folder: FolderRef
    id: string
    occurrence: number
}

export type TopRef = CharRef | FolderRef
export type ItemRef = TopRef | MemberRef

/**
 * A drop position between rows. `after: null` is the start of the list (or of the folder).
 * `after` names the row the position follows, so the position does not move when other
 * entries come or go.
 */
export type Gap =
    | { in: 'top'; after: TopRef | null }
    | { in: 'folder'; folder: FolderRef; after: MemberRef | null }

export interface CharRow {
    kind: 'char'
    key: string
    ref: CharRef
    id: string
}

export interface MemberRow {
    kind: 'member'
    key: string
    ref: MemberRef
    id: string
}

export interface FolderRow {
    kind: 'folder'
    key: string
    ref: FolderRef
    id: string
    entry: folder
    members: MemberRow[]
}

export type TopRow = CharRow | FolderRow

export interface NewFolderSpec {
    id: string
    name: string
}

function isFolderEntry(entry: OrderEntry | undefined): entry is folder {
    return typeof entry === 'object' && entry !== null && Array.isArray(entry.data)
}

/**
 * A key that is unique for every ref in one order, whatever the order holds: the kind keeps
 * a folder id apart from a character id, the occurrence keeps duplicates apart, and the
 * JSON encoding keeps ids containing separators apart.
 */
export function refKey(ref: ItemRef): string {
    if (ref.kind === 'member') {
        return JSON.stringify(['m', ref.folder.id, ref.folder.occurrence, ref.id, ref.occurrence])
    }
    return JSON.stringify([ref.kind === 'char' ? 'c' : 'f', ref.id, ref.occurrence])
}

/**
 * Rows for the entries of `order` whose character is known (`isKnown`), one per occurrence.
 * A folder always has a row. A `null` entry and a folder without a `data` array have none.
 * An occurrence number counts the entries with the same id over the whole order, the way
 * moveToGap and dropOnItem resolve a ref, so a row's ref names the entry those operations
 * will find. The count is per id, so an entry with another id never changes a ref.
 */
export function listRows(order: readonly OrderEntry[], isKnown: (id: string) => boolean): TopRow[] {
    const rows: TopRow[] = []
    const charSeen = new Map<string, number>()
    const folderSeen = new Map<string, number>()
    for (const entry of order) {
        if (typeof entry === 'string') {
            const occurrence = charSeen.get(entry) ?? 0
            charSeen.set(entry, occurrence + 1)
            if (isKnown(entry)) {
                const ref: CharRef = { kind: 'char', id: entry, occurrence }
                rows.push({ kind: 'char', key: refKey(ref), ref, id: entry })
            }
        }
        else if (isFolderEntry(entry)) {
            const occurrence = folderSeen.get(entry.id) ?? 0
            folderSeen.set(entry.id, occurrence + 1)
            const ref: FolderRef = { kind: 'folder', id: entry.id, occurrence }
            const members: MemberRow[] = []
            const memberSeen = new Map<string, number>()
            for (const memberId of entry.data) {
                if (typeof memberId !== 'string') {
                    continue
                }
                const memberOccurrence = memberSeen.get(memberId) ?? 0
                memberSeen.set(memberId, memberOccurrence + 1)
                if (isKnown(memberId)) {
                    const memberRef: MemberRef = { kind: 'member', folder: ref, id: memberId, occurrence: memberOccurrence }
                    members.push({ kind: 'member', key: refKey(memberRef), ref: memberRef, id: memberId })
                }
            }
            rows.push({ kind: 'folder', key: refKey(ref), ref, id: entry.id, entry, members })
        }
    }
    return rows
}

function findChar(order: readonly OrderEntry[], ref: CharRef): number {
    let seen = 0
    for (let i = 0; i < order.length; i++) {
        if (order[i] === ref.id) {
            if (seen === ref.occurrence) {
                return i
            }
            seen++
        }
    }
    return -1
}

function findFolder(order: readonly OrderEntry[], ref: FolderRef): number {
    let seen = 0
    for (let i = 0; i < order.length; i++) {
        const entry = order[i]
        if (isFolderEntry(entry) && entry.id === ref.id) {
            if (seen === ref.occurrence) {
                return i
            }
            seen++
        }
    }
    return -1
}

function findTop(order: readonly OrderEntry[], ref: TopRef): number {
    return ref.kind === 'char' ? findChar(order, ref) : findFolder(order, ref)
}

function findMember(data: readonly string[], ref: MemberRef): number {
    let seen = 0
    for (let i = 0; i < data.length; i++) {
        if (data[i] === ref.id) {
            if (seen === ref.occurrence) {
                return i
            }
            seen++
        }
    }
    return -1
}

/**
 * A working copy of the order in which a folder is copied the first time it is edited, so
 * the input order and its folders are never mutated.
 */
class Draft {
    readonly top: OrderEntry[]
    private readonly copies = new Set<folder>()

    constructor(order: readonly OrderEntry[]) {
        this.top = order.slice()
    }

    editable(index: number): folder {
        const current = this.top[index]
        if (!isFolderEntry(current)) {
            throw new Error('sidebarOrder: entry is not a folder')
        }
        if (this.copies.has(current)) {
            return current
        }
        const copy: folder = { ...current, data: current.data.slice() }
        this.copies.add(copy)
        this.top[index] = copy
        return copy
    }

    /** Removes a folder this draft emptied. Folders that were already empty are left alone. */
    dropIfEmpty(copy: folder): void {
        if (copy.data.length === 0) {
            const at = this.top.indexOf(copy)
            if (at !== -1) {
                this.top.splice(at, 1)
            }
        }
    }
}

/** Where an item being moved sits in the order. */
type Source =
    | { where: 'top'; index: number; isFolder: boolean }
    | { where: 'member'; folderIndex: number; index: number; id: string }

function resolveSource(order: readonly OrderEntry[], ref: ItemRef): Source | null {
    if (ref.kind === 'member') {
        const folderIndex = findFolder(order, ref.folder)
        if (folderIndex === -1) {
            return null
        }
        const owner = order[folderIndex]
        if (!isFolderEntry(owner)) {
            return null
        }
        const index = findMember(owner.data, ref)
        return index === -1 ? null : { where: 'member', folderIndex, index, id: ref.id }
    }
    const index = findTop(order, ref)
    return index === -1 ? null : { where: 'top', index, isFolder: ref.kind === 'folder' }
}

/**
 * Moves the dragged item to a gap. Returns the same array when nothing changes: unknown
 * source or target, a folder dropped into a folder, or a drop into the item's own gap.
 * A folder this empties is removed, as `checkCharOrder` would remove it.
 */
export function moveToGap<E extends OrderEntry>(order: readonly E[], source: ItemRef, gap: Gap): (E | folder)[] {
    const result = moveToGapInternal(order, source, gap)
    return (result ?? order) as (E | folder)[]
}

function moveToGapInternal(order: readonly OrderEntry[], sourceRef: ItemRef, gap: Gap): OrderEntry[] | null {
    const src = resolveSource(order, sourceRef)
    if (!src) {
        return null
    }
    if (src.where === 'top' && src.isFolder && gap.in === 'folder') {
        return null
    }

    if (gap.in === 'top') {
        let anchor = -1
        if (gap.after) {
            anchor = findTop(order, gap.after)
            if (anchor === -1) {
                return null
            }
        }
        const draft = new Draft(order)
        if (src.where === 'top') {
            let insertAt = anchor + 1
            if (insertAt === src.index || insertAt === src.index + 1) {
                return null
            }
            const [item] = draft.top.splice(src.index, 1)
            if (src.index < insertAt) {
                insertAt--
            }
            draft.top.splice(insertAt, 0, item)
            return draft.top
        }
        const owner = draft.editable(src.folderIndex)
        owner.data.splice(src.index, 1)
        draft.top.splice(anchor + 1, 0, src.id)
        draft.dropIfEmpty(owner)
        return draft.top
    }

    const targetIndex = findFolder(order, gap.folder)
    if (targetIndex === -1) {
        return null
    }
    const targetFolder = order[targetIndex]
    if (!isFolderEntry(targetFolder)) {
        return null
    }
    let anchor = -1
    if (gap.after) {
        anchor = findMember(targetFolder.data, gap.after)
        if (anchor === -1) {
            return null
        }
    }
    let insertAt = anchor + 1

    if (src.where === 'member' && src.folderIndex === targetIndex) {
        if (insertAt === src.index || insertAt === src.index + 1) {
            return null
        }
        const draft = new Draft(order)
        const data = draft.editable(targetIndex).data
        const [id] = data.splice(src.index, 1)
        if (src.index < insertAt) {
            insertAt--
        }
        data.splice(insertAt, 0, id)
        return draft.top
    }

    const draft = new Draft(order)
    const target = draft.editable(targetIndex)
    if (src.where === 'member') {
        const owner = draft.editable(src.folderIndex)
        owner.data.splice(src.index, 1)
        target.data.splice(insertAt, 0, src.id)
        draft.dropIfEmpty(owner)
        return draft.top
    }
    const [id] = draft.top.splice(src.index, 1)
    if (typeof id !== 'string') {
        return null
    }
    target.data.splice(insertAt, 0, id)
    return draft.top
}

/**
 * Drops the dragged character on a row. On another character it makes a new folder from the
 * two (at the target's place); on a folder it appends the character to that folder. A
 * folder as the dragged item, a folder member row as the target, and a character dropped on
 * itself change nothing. A folder this empties is removed, as `checkCharOrder` would remove it.
 */
export function dropOnItem<E extends OrderEntry>(order: readonly E[], source: ItemRef, target: ItemRef, spec: NewFolderSpec): (E | folder)[] {
    const result = dropOnItemInternal(order, source, target, spec)
    return (result ?? order) as (E | folder)[]
}

function dropOnItemInternal(order: readonly OrderEntry[], sourceRef: ItemRef, targetRef: ItemRef, spec: NewFolderSpec): OrderEntry[] | null {
    if (targetRef.kind === 'member' || sourceRef.kind === 'folder') {
        return null
    }
    const src = resolveSource(order, sourceRef)
    if (!src) {
        return null
    }
    const targetIndex = findTop(order, targetRef)
    if (targetIndex === -1) {
        return null
    }
    if (src.where === 'top' && src.index === targetIndex) {
        return null
    }
    const draft = new Draft(order)

    if (targetRef.kind === 'char') {
        const targetId = order[targetIndex]
        if (typeof targetId !== 'string') {
            return null
        }
        let mainId: string
        let owner: folder | null = null
        if (src.where === 'member') {
            owner = draft.editable(src.folderIndex)
            owner.data.splice(src.index, 1)
            mainId = src.id
        }
        else {
            const main = order[src.index]
            if (typeof main !== 'string') {
                return null
            }
            mainId = main
        }
        const created: folder = { name: spec.name, data: [mainId, targetId], color: '', id: spec.id }
        draft.top[targetIndex] = created
        if (src.where === 'top') {
            draft.top.splice(src.index, 1)
        }
        if (owner) {
            draft.dropIfEmpty(owner)
        }
        return draft.top
    }

    const target = draft.editable(targetIndex)
    if (src.where === 'member') {
        const owner = src.folderIndex === targetIndex ? target : draft.editable(src.folderIndex)
        owner.data.splice(src.index, 1)
        target.data.push(src.id)
        draft.dropIfEmpty(owner)
        return draft.top
    }
    const main = order[src.index]
    if (typeof main !== 'string') {
        return null
    }
    draft.top.splice(src.index, 1)
    target.data.push(main)
    return draft.top
}

/** The member ids of the folder `ref` names, or `null` when no such folder is in the order. */
export function folderMemberIds(order: readonly OrderEntry[], ref: FolderRef): string[] | null {
    const at = findFolder(order, ref)
    const entry = at === -1 ? null : order[at]
    return isFolderEntry(entry) ? entry.data.filter((id): id is string => typeof id === 'string') : null
}

/**
 * Replaces the folder `ref` names with its member ids, in folder order, at the place the
 * folder held. Every id is kept; only the folder entry goes. Returns `null` when the folder
 * is gone. `ref` carries the occurrence the menu was opened on: if an edit shifted
 * same-id folders in between, it may name a different one of them, and nothing is lost.
 */
export function ungroupFolder<E extends OrderEntry>(order: readonly E[], ref: FolderRef): (E | string)[] | null {
    const at = findFolder(order, ref)
    const entry = at === -1 ? null : order[at]
    if (!isFolderEntry(entry)) {
        return null
    }
    const members = entry.data.filter((id): id is string => typeof id === 'string')
    const next: (E | string)[] = order.slice()
    next.splice(at, 1, ...members)
    return next
}

/**
 * Applies `edit` to a copy of the folder with `id` and returns the new order, or `null` when
 * no folder or more than one folder has that id (the edit then has no safe target).
 */
export function editFolder<E extends OrderEntry>(order: readonly E[], id: string, edit: (copy: folder) => void): (E | folder)[] | null {
    let found = -1
    for (let i = 0; i < order.length; i++) {
        const entry = order[i]
        if (isFolderEntry(entry) && entry.id === id) {
            if (found !== -1) {
                return null
            }
            found = i
        }
    }
    if (found === -1) {
        return null
    }
    const draft = new Draft(order)
    edit(draft.editable(found))
    return draft.top as (E | folder)[]
}
