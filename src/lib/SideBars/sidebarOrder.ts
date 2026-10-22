import isEqual from 'lodash/isEqual'
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
 * Whether the rail shows `entry`: at least one of its member ids is visible (`isVisible`).
 * A folder with no visible member, whether its members are hidden characters, ids without a
 * character or nothing at all, has no row. It stays in the saved order untouched.
 */
export function isShownFolder(entry: folder, isVisible: (id: string) => boolean): boolean {
    return entry.data.some((id) => typeof id === 'string' && isVisible(id))
}

/**
 * Rows for the entries of `order` whose character is known (`isKnown`), one per occurrence.
 * A folder has a row when `isShownFolder(entry, isVisible)` holds; `isVisible` defaults to
 * `isKnown`. A caller whose `isKnown` is narrower than visibility, such as one that lists only
 * the members of open folders, passes the visibility rule separately so a closed folder keeps
 * its row. A `null` entry and a folder without a `data` array have none.
 * An occurrence number counts the entries with the same id over the whole order, the way
 * moveToGap and dropOnItem resolve a ref, so a row's ref names the entry those operations
 * will find. The count is per id and is taken before a folder is dropped, so an entry with
 * another id, or a dropped folder with the same id, never changes a ref.
 */
export function listRows(order: readonly OrderEntry[], isKnown: (id: string) => boolean, isVisible: (id: string) => boolean = isKnown): TopRow[] {
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
            if (isShownFolder(entry, isVisible)) {
                rows.push({ kind: 'folder', key: refKey(ref), ref, id: entry.id, entry, members })
            }
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

/** A dragged folder an operation removes: the ref it was addressed by and the order's own folder object. */
export interface DissolvedFolder {
    ref: FolderRef
    entry: folder
}

/** What `foldersDissolvedBy` asks about: a gap (an append is a folder gap) or a merge into the character `target`. */
export type DissolveDestination = Gap | { in: 'merge'; target: CharRef }

/**
 * Moves every source to a gap as one block, in document order, whatever the order of `sources`.
 * Sources and the gap's anchor are resolved on the input, so two refs at one position count once
 * and a member whose own folder is also a source adds nothing (matched by resolved position, never
 * by id). A top-level gap moves a dragged folder whole. A folder gap (an append is one) dissolves a
 * dragged folder instead: every string member, hidden ones included, joins the block, and the
 * folder is removed exactly when a string member left it and its `data` is empty afterwards (a
 * folder with non-string residue stays; one with no string member is untouched). An anchor that is
 * itself a source is replaced by the nearest preceding sibling that is not. Folders emptied by the
 * move are removed only after the block is inserted, never the destination folder. Returns the same
 * array when nothing changes: an unresolved source, anchor or destination folder, a folder gap
 * inside or onto a dragged folder, or a result equal in content to the input.
 */
export function moveManyToGap<E extends OrderEntry>(order: readonly E[], sources: readonly ItemRef[], gap: Gap): (E | folder)[] {
    const result = moveManyToGapInternal(order, sources, gap)
    return (result ? result.order : order) as (E | folder)[]
}

/**
 * The dragged folders (resolved top-level folder sources) that `moveManyToGap` (a folder gap) or
 * `groupIntoFolder` with a placement (a merge) would remove, in document order, each with the
 * order's own folder object. None for a top-level gap, which moves a folder whole, and none when
 * the operation changes nothing.
 */
export function foldersDissolvedBy(order: readonly OrderEntry[], sources: readonly ItemRef[], destination: DissolveDestination): DissolvedFolder[] {
    if (destination.in === 'top') {
        return []
    }
    const result = destination.in === 'merge'
        ? groupIntoFolderInternal(order, sources, { id: '', name: '' }, destination.target)
        : moveManyToGapInternal(order, sources, destination)
    return result ? result.dissolved : []
}

function moveManyToGapInternal(order: readonly OrderEntry[], sourceRefs: readonly ItemRef[], gap: Gap): Changed | null {
    const tops = new Set<number>()
    const members = new Map<number, Set<number>>()
    for (const ref of sourceRefs) {
        const src = resolveSource(order, ref)
        if (!src) {
            return null
        }
        if (src.where === 'top') {
            tops.add(src.index)
            continue
        }
        const set = members.get(src.folderIndex)
        if (set) {
            set.add(src.index)
        }
        else {
            members.set(src.folderIndex, new Set([src.index]))
        }
    }
    for (const owner of [...members.keys()]) {
        if (tops.has(owner)) {
            members.delete(owner)
        }
    }

    let targetIndex = -1
    let anchor = -1
    let removedAtLevel: ReadonlySet<number> = tops
    const dissolvedTops: number[] = []
    if (gap.in === 'folder') {
        targetIndex = findFolder(order, gap.folder)
        const targetEntry = targetIndex === -1 ? null : order[targetIndex]
        if (!isFolderEntry(targetEntry) || tops.has(targetIndex)) {
            return null
        }
        for (const index of [...tops]) {
            const entry = order[index]
            if (!isFolderEntry(entry)) {
                continue
            }
            tops.delete(index)
            const strings = new Set<number>()
            entry.data.forEach((id, member) => {
                if (typeof id === 'string') {
                    strings.add(member)
                }
            })
            if (strings.size > 0) {
                members.set(index, strings)
                dissolvedTops.push(index)
            }
        }
        if (gap.after) {
            anchor = findMember(targetEntry.data, gap.after)
            if (anchor === -1) {
                return null
            }
        }
        removedAtLevel = members.get(targetIndex) ?? new Set<number>()
    }
    else if (gap.after) {
        anchor = findTop(order, gap.after)
        if (anchor === -1) {
            return null
        }
    }
    while (anchor >= 0 && removedAtLevel.has(anchor)) {
        anchor--
    }

    const spots: Spot[] = []
    for (const top of tops) {
        spots.push({ top, member: -1 })
    }
    for (const [top, set] of members) {
        for (const member of set) {
            spots.push({ top, member })
        }
    }
    if (spots.length === 0) {
        return null
    }
    spots.sort((a, b) => a.top - b.top || a.member - b.member)
    const block: OrderEntry[] = []
    for (const spot of spots) {
        const entry = order[spot.top]
        if (spot.member === -1) {
            if (gap.in === 'folder' && typeof entry !== 'string') {
                return null
            }
            block.push(entry)
            continue
        }
        const id = isFolderEntry(entry) ? entry.data[spot.member] : undefined
        if (typeof id !== 'string') {
            return null
        }
        block.push(id)
    }

    // Nothing is dropped before the insert: the insert index comes from input indices.
    const draft = new Draft(order)
    const target = gap.in === 'folder' ? draft.editable(targetIndex) : null
    const owners = new Map<number, folder>()
    for (const [top, set] of members) {
        const owner = draft.editable(top)
        for (const member of [...set].sort((a, b) => b - a)) {
            owner.data.splice(member, 1)
        }
        if (top !== targetIndex) {
            owners.set(top, owner)
        }
    }
    for (const index of [...tops].sort((a, b) => b - a)) {
        draft.top.splice(index, 1)
    }
    let insertAt = anchor + 1
    for (const index of removedAtLevel) {
        if (index < anchor + 1) {
            insertAt--
        }
    }
    if (target) {
        target.data.splice(insertAt, 0, ...block.filter((item): item is string => typeof item === 'string'))
    }
    else {
        draft.top.splice(insertAt, 0, ...block)
    }
    for (const owner of owners.values()) {
        draft.dropIfEmpty(owner)
    }
    if (isEqual(draft.top, order)) {
        return null
    }
    const dissolved: DissolvedFolder[] = []
    for (const top of dissolvedTops.sort((a, b) => a - b)) {
        const copy = owners.get(top)
        const entry = order[top]
        if (copy && isFolderEntry(entry) && !draft.top.includes(copy)) {
            dissolved.push({ ref: folderRefAt(order, top), entry })
        }
    }
    return { order: draft.top, dissolved }
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

/** A position in the order: a top-level character (`member` -1) or a member of the folder at `top`. */
interface Spot {
    top: number
    member: number
}

/**
 * Groups the sources into one new folder, placed at the first source's place in document order
 * (for a folder member, immediately before its folder). A character source contributes itself, a
 * member contributes itself and a folder contributes every string member of its `data`, so the
 * emptied folder disappears. The new folder's `data` follows document order whatever the order of
 * `sources`. Sources are resolved to positions once, on the input, and two refs that reach the
 * same position count once. Returns the same array when nothing changes: no source, a source that
 * does not resolve (nothing is then moved), or a source set that holds no character.
 *
 * With `placement` (a merge) the new folder instead takes the place of that top-level character,
 * which is not in `sources`: it joins `data` itself, in document order, and every other source is
 * removed. An unresolved placement, a member or a folder as placement, and a source that is the
 * placement character itself return the input, as does a source set that adds no character. A
 * dragged folder follows the same rule with or without a placement: it is removed exactly when a
 * string member left it and its `data` is empty afterwards.
 */
export function groupIntoFolder<E extends OrderEntry>(order: readonly E[], sources: readonly ItemRef[], spec: NewFolderSpec, placement?: ItemRef): (E | folder)[] {
    const result = groupIntoFolderInternal(order, sources, spec, placement)
    return (result ? result.order : order) as (E | folder)[]
}

/** A changed order plus the dragged folders the change removed. */
interface Changed {
    order: OrderEntry[]
    dissolved: DissolvedFolder[]
}

/** The ref the folder at `index` is addressed by: its id and how many same-id folders precede it. */
function folderRefAt(order: readonly OrderEntry[], index: number): FolderRef {
    const entry = order[index]
    let occurrence = 0
    for (let i = 0; i < index; i++) {
        const before = order[i]
        if (isFolderEntry(before) && isFolderEntry(entry) && before.id === entry.id) {
            occurrence++
        }
    }
    return { kind: 'folder', id: isFolderEntry(entry) ? entry.id : '', occurrence }
}

function groupIntoFolderInternal(order: readonly OrderEntry[], sourceRefs: readonly ItemRef[], spec: NewFolderSpec, placement?: ItemRef): Changed | null {
    let placeAt = -1
    if (placement) {
        placeAt = placement.kind === 'char' ? findChar(order, placement) : -1
        if (placeAt === -1) {
            return null
        }
    }
    const spots = new Map<string, Spot>()
    const add = (top: number, member: number) => {
        spots.set(`${top}:${member}`, { top, member })
    }
    // Top positions of dragged folders that contribute at least one string member.
    const draggedFolders = new Set<number>()
    for (const ref of sourceRefs) {
        const src = resolveSource(order, ref)
        if (!src) {
            return null
        }
        if (src.where === 'member') {
            add(src.folderIndex, src.index)
            continue
        }
        if (src.index === placeAt) {
            return null
        }
        const entry = order[src.index]
        if (!src.isFolder) {
            add(src.index, -1)
        }
        else if (isFolderEntry(entry)) {
            entry.data.forEach((id, member) => {
                if (typeof id === 'string') {
                    add(src.index, member)
                    draggedFolders.add(src.index)
                }
            })
        }
    }
    if (spots.size === 0) {
        return null
    }
    if (placeAt !== -1) {
        add(placeAt, -1)
    }
    const sorted = [...spots.values()].sort((a, b) => a.top - b.top || a.member - b.member)
    const slot = placeAt !== -1 ? placeAt : sorted[0].top
    const data: string[] = []
    const topSpots: number[] = []
    const ownerSpots = new Map<number, number[]>()
    for (const spot of sorted) {
        const entry = order[spot.top]
        if (spot.member === -1) {
            if (typeof entry !== 'string') {
                return null
            }
            data.push(entry)
            if (spot.top !== placeAt) {
                topSpots.push(spot.top)
            }
            continue
        }
        const id = isFolderEntry(entry) ? entry.data[spot.member] : undefined
        if (typeof id !== 'string') {
            return null
        }
        data.push(id)
        const members = ownerSpots.get(spot.top)
        if (members) {
            members.push(spot.member)
        }
        else {
            ownerSpots.set(spot.top, [spot.member])
        }
    }

    const draft = new Draft(order)
    const owners = new Map<number, folder>()
    for (const [top, members] of ownerSpots) {
        const owner = draft.editable(top)
        for (let i = members.length - 1; i >= 0; i--) {
            owner.data.splice(members[i], 1)
        }
        owners.set(top, owner)
    }
    const created: folder = { name: spec.name, data, color: '', id: spec.id }
    if (placeAt !== -1) {
        // The new folder replaces the placement character in place, so removals before it need no offset.
        draft.top[placeAt] = created
        for (let i = topSpots.length - 1; i >= 0; i--) {
            draft.top.splice(topSpots[i], 1)
        }
    }
    else {
        draft.top.splice(slot, 0, created)
        // Every removed entry sits at or after `slot`, so each top-level source is now one place later.
        for (let i = topSpots.length - 1; i >= 0; i--) {
            draft.top.splice(topSpots[i] + 1, 1)
        }
    }
    for (const owner of owners.values()) {
        draft.dropIfEmpty(owner)
    }
    const dissolved: DissolvedFolder[] = []
    for (const top of [...draggedFolders].sort((a, b) => a - b)) {
        const copy = owners.get(top)
        const entry = order[top]
        if (copy && isFolderEntry(entry) && !draft.top.includes(copy)) {
            dissolved.push({ ref: folderRefAt(order, top), entry })
        }
    }
    return { order: draft.top, dissolved }
}

/** The folder entry `ref` names in `order` (the object itself, not a copy), or `null` when there is none. */
export function folderEntryAt(order: readonly OrderEntry[], ref: FolderRef): folder | null {
    const at = findFolder(order, ref)
    const entry = at === -1 ? null : order[at]
    return isFolderEntry(entry) ? entry : null
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
