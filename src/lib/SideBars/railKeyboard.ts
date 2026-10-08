import isEqual from 'lodash/isEqual'
import type { folder } from 'src/ts/storage/database.svelte'
import { computeLayout, type LayoutItem } from './railLayout'
import { isNoopGap } from './railTarget'
import {
    folderEntryAt,
    isShownFolder,
    listRows,
    moveToGap,
    refKey,
    type CharRef,
    type FolderRef,
    type Gap,
    type ItemRef,
    type MemberRef,
    type OrderEntry,
    type TopRef,
} from './sidebarOrder'

/**
 * Keyboard operations on the sidebar rail, decided from the order and the rail's layout items
 * alone (no DOM): which key means what, where focus goes, and what a one-place move does.
 * The only way this module changes an order is `moveToGap`, so a keyboard move writes exactly
 * what the same drop would write.
 */

export type MoveDirection = 'up' | 'down'

export type FocusKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'

export type RailKey =
    | { kind: 'focus'; key: FocusKey }
    | { kind: 'move'; dir: MoveDirection }
    | { kind: 'activate' }

export interface KeyLike {
    key: string
    altKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    metaKey: boolean
}

/**
 * What a key does on an entry focus target, or `null` when the rail leaves it alone.
 * Arrows, Home and End count only without modifiers; the move needs Alt and no other
 * modifier, so Ctrl+Alt, Shift+Alt and Meta+Alt combinations stay with the user's hotkeys.
 */
export function classifyKey(e: KeyLike): RailKey | null {
    const plain = !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey
    if (plain && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End')) {
        return { kind: 'focus', key: e.key }
    }
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        if (e.key === 'ArrowDown') {
            return { kind: 'move', dir: 'down' }
        }
        if (e.key === 'ArrowUp') {
            return { kind: 'move', dir: 'up' }
        }
    }
    if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        return { kind: 'activate' }
    }
    return null
}

/** The key of the entry a focus key leads to from `current`, or `null` when focus stays. */
export function focusStep(keys: readonly string[], current: string | null, key: FocusKey): string | null {
    if (keys.length === 0) {
        return null
    }
    const index = current === null ? -1 : keys.indexOf(current)
    let target = -1
    if (key === 'Home') {
        target = 0
    }
    else if (key === 'End') {
        target = keys.length - 1
    }
    else if (key === 'ArrowDown') {
        target = index + 1
    }
    else if (index > 0) {
        target = index - 1
    }
    if (target < 0 || target >= keys.length || keys[target] === current) {
        return null
    }
    return keys[target]
}

/** A focusable row in visual order. `owner` is the key of the folder row a member belongs to. */
export interface RailRow {
    key: string
    owner?: string
}

export function railRows(items: readonly LayoutItem[]): RailRow[] {
    const rows: RailRow[] = []
    for (const item of items) {
        if (item.ref && (item.kind === 'char' || item.kind === 'folder' || item.kind === 'member')) {
            rows.push({ key: item.key, owner: item.owner })
        }
    }
    return rows
}

export interface CurrentEntry {
    key: string
    index: number
    owner: string | null
}

/**
 * The current entry for the rows now shown. With no remembered entry: the selected character's
 * row, else the first. A remembered entry that is still shown stays; one that is gone gives way
 * to its folder's row (a member whose folder closed), else the row now at its visual index,
 * else the last row.
 */
export function resolveCurrent(rows: readonly RailRow[], remembered: CurrentEntry | null, selectedKey: string | null): CurrentEntry | null {
    if (rows.length === 0) {
        return null
    }
    const at = (index: number): CurrentEntry => ({ key: rows[index].key, index, owner: rows[index].owner ?? null })
    if (!remembered) {
        const selected = selectedKey === null ? -1 : rows.findIndex((row) => row.key === selectedKey)
        return at(selected >= 0 ? selected : 0)
    }
    const same = rows.findIndex((row) => row.key === remembered.key)
    if (same >= 0) {
        return at(same)
    }
    if (remembered.owner !== null) {
        const owner = rows.findIndex((row) => row.key === remembered.owner)
        if (owner >= 0) {
            return at(owner)
        }
    }
    return at(Math.min(remembered.index, rows.length - 1))
}

export type KeyboardMove<E extends OrderEntry = OrderEntry> =
    | { kind: 'move'; gap: Gap; order: (E | folder)[]; ref: ItemRef }
    | { kind: 'focus'; ref: ItemRef }
    | { kind: 'refuse-sole'; folder: FolderRef }

function isFolderEntry(entry: OrderEntry | undefined): entry is Exclude<OrderEntry, string | null> {
    return typeof entry === 'object' && entry !== null && Array.isArray(entry.data)
}

function countFolders(order: readonly OrderEntry[], id: string): number {
    let count = 0
    for (const entry of order) {
        if (isFolderEntry(entry) && entry.id === id) {
            count++
        }
    }
    return count
}

/**
 * True when the folder `ref` names is shown in `before` and not in `after`: the move took its
 * last visible member out while hidden or unknown ids keep the folder in the saved order. The
 * same-id folders before it keep their number in `after`, so the occurrence still names it.
 */
function leavesFolderUnshown(before: readonly OrderEntry[], after: readonly OrderEntry[], ref: FolderRef, isVisible: (id: string) => boolean): boolean {
    const was = folderEntryAt(before, ref)
    const now = folderEntryAt(after, ref)
    return was !== null && now !== null && isShownFolder(was, isVisible) && !isShownFolder(now, isVisible)
}

const EMPTY_HEIGHTS: ReadonlyMap<string, number> = new Map()

/**
 * The result of moving `source` one visible place in `dir`.
 *
 * Gaps are scanned from the source in that direction. A folder source considers top-level
 * gaps only; a character considers top-level gaps and the gaps of open folders (a closed
 * folder has none, so it is passed as one unit). Gaps next to the source are skipped. The
 * first remaining gap decides:
 *  - the move leaves the order unchanged in content (the source passed an identical
 *    duplicate): `focus` on that neighbour at the source's own level (a folder row for a
 *    folder, a sibling member for a member), nothing to write;
 *  - the move would remove the source's folder, or leave it without a visible member (hidden
 *    or unknown ids alone keep it in the saved order, off the rail): `refuse-sole`;
 *  - otherwise `move` with the new order and the moved entry's ref in it.
 * `null` when no gap is left in that direction.
 */
export function keyboardMove<E extends OrderEntry>(order: readonly E[], items: readonly LayoutItem[], source: ItemRef, dir: MoveDirection, isVisible: (id: string) => boolean): KeyboardMove<E> | null {
    const layout = computeLayout(items, EMPTY_HEIGHTS)
    const start = layout.indexByKey.get(refKey(source))
    if (start === undefined) {
        return null
    }
    const step = dir === 'down' ? 1 : -1
    const topOnly = source.kind === 'folder'
    const sourceFolderKey = source.kind === 'member' ? refKey(source.folder) : null
    const sameLevel = (ref: ItemRef) => (source.kind === 'member' ? ref.kind === 'member' && refKey(ref.folder) === sourceFolderKey : ref.kind !== 'member')
    let passed: ItemRef | null = null
    for (let i = start + step; i >= 0 && i < items.length; i += step) {
        const item = items[i]
        if (item.ref) {
            if (sameLevel(item.ref)) {
                passed = item.ref
            }
            continue
        }
        const gap = item.gap
        if (!gap || (topOnly && gap.in !== 'top') || isNoopGap(layout, i, source)) {
            continue
        }
        const next = moveToGap(order, source, gap)
        if (next === order) {
            continue
        }
        if (isEqual(next, order)) {
            return passed ? { kind: 'focus', ref: passed } : null
        }
        if (source.kind === 'member' && (countFolders(next, source.folder.id) < countFolders(order, source.folder.id) || leavesFolderUnshown(order, next, source.folder, isVisible))) {
            return { kind: 'refuse-sole', folder: source.folder }
        }
        const ref = movedRef(order, source, gap)
        return ref ? { kind: 'move', gap, order: next, ref } : null
    }
    return null
}

//#region moved ref

const TAG = '\u0000'

interface Tagged {
    order: OrderEntry[]
    char: Map<string, string>
    folder: Map<string, string>
    member: Map<string, string>
}

/**
 * The order with every id made unique (a counter prefix), so that a move on it can be
 * followed entry by entry even when the real order holds identical duplicates. `char`,
 * `folder` and `member` map a ref's key to the unique id its entry carries.
 */
function tagOrder(order: readonly OrderEntry[]): Tagged {
    const tagged: Tagged = { order: [], char: new Map(), folder: new Map(), member: new Map() }
    let counter = 0
    const fresh = (id: string) => `${counter++}${TAG}${id}`
    const charSeen = new Map<string, number>()
    const folderSeen = new Map<string, number>()
    for (const entry of order) {
        if (typeof entry === 'string') {
            const occurrence = charSeen.get(entry) ?? 0
            charSeen.set(entry, occurrence + 1)
            const id = fresh(entry)
            tagged.char.set(refKey({ kind: 'char', id: entry, occurrence }), id)
            tagged.order.push(id)
        }
        else if (isFolderEntry(entry)) {
            const occurrence = folderSeen.get(entry.id) ?? 0
            folderSeen.set(entry.id, occurrence + 1)
            const folderId = fresh(entry.id)
            tagged.folder.set(refKey({ kind: 'folder', id: entry.id, occurrence }), folderId)
            const memberSeen = new Map<string, number>()
            const data = entry.data.map((memberId) => {
                if (typeof memberId !== 'string') {
                    return memberId
                }
                const memberOccurrence = memberSeen.get(memberId) ?? 0
                memberSeen.set(memberId, memberOccurrence + 1)
                const id = fresh(memberId)
                tagged.member.set(refKey({ kind: 'member', folder: { kind: 'folder', id: entry.id, occurrence }, id: memberId, occurrence: memberOccurrence }), id)
                return id
            })
            tagged.order.push({ ...entry, id: folderId, data })
        }
        else {
            tagged.order.push(entry)
        }
    }
    return tagged
}

const untag = (id: string): string => id.slice(id.indexOf(TAG) + 1)

/** The ref, in the order after the move, of the entry `moveToGap(order, source, gap)` moved. */
function movedRef(order: readonly OrderEntry[], source: ItemRef, gap: Gap): ItemRef | null {
    const tagged = tagOrder(order)
    const topRef = (ref: TopRef): TopRef | null => {
        const id = (ref.kind === 'char' ? tagged.char : tagged.folder).get(refKey(ref))
        return id === undefined ? null : { kind: ref.kind, id, occurrence: 0 }
    }
    const folderRef = (ref: FolderRef): FolderRef | null => {
        const id = tagged.folder.get(refKey(ref))
        return id === undefined ? null : { kind: 'folder', id, occurrence: 0 }
    }
    const memberRef = (ref: MemberRef): MemberRef | null => {
        const id = tagged.member.get(refKey(ref))
        const folder = folderRef(ref.folder)
        return id === undefined || !folder ? null : { kind: 'member', folder, id, occurrence: 0 }
    }
    let taggedGap: Gap
    if (gap.in === 'top') {
        const after = gap.after ? topRef(gap.after) : null
        if (gap.after && !after) {
            return null
        }
        taggedGap = { in: 'top', after }
    }
    else {
        const folder = folderRef(gap.folder)
        const after = gap.after ? memberRef(gap.after) : null
        if (!folder || (gap.after && !after)) {
            return null
        }
        taggedGap = { in: 'folder', folder, after }
    }
    const taggedSource = source.kind === 'member' ? memberRef(source) : topRef(source)
    if (!taggedSource) {
        return null
    }
    const moved = moveToGap(tagged.order, taggedSource, taggedGap)
    const wanted = taggedSource.id
    const baseId = untag(wanted)
    const charSeen = new Map<string, number>()
    const folderSeen = new Map<string, number>()
    for (const entry of moved) {
        if (typeof entry === 'string') {
            const id = untag(entry)
            const occurrence = charSeen.get(id) ?? 0
            charSeen.set(id, occurrence + 1)
            if (entry === wanted) {
                const ref: CharRef = { kind: 'char', id, occurrence }
                return ref
            }
        }
        else if (isFolderEntry(entry)) {
            const id = untag(entry.id)
            const occurrence = folderSeen.get(id) ?? 0
            folderSeen.set(id, occurrence + 1)
            if (entry.id === wanted) {
                const ref: FolderRef = { kind: 'folder', id, occurrence }
                return ref
            }
            const memberSeen = new Map<string, number>()
            for (const memberId of entry.data) {
                if (typeof memberId !== 'string') {
                    continue
                }
                const base = untag(memberId)
                const memberOccurrence = memberSeen.get(base) ?? 0
                memberSeen.set(base, memberOccurrence + 1)
                if (memberId === wanted) {
                    const ref: MemberRef = { kind: 'member', folder: { kind: 'folder', id, occurrence }, id: baseId, occurrence: memberOccurrence }
                    return ref
                }
            }
        }
    }
    return null
}

//#endregion

/** Ids of the characters the rail shows, for `listRows`. */
export function shownIds(items: readonly LayoutItem[]): Set<string> {
    const ids = new Set<string>()
    for (const item of items) {
        if (item.ref && item.ref.kind !== 'folder') {
            ids.add(item.ref.id)
        }
    }
    return ids
}

export interface PositionInfo {
    position: number
    total: number
    /** Set for a folder member: the name of its folder. */
    folderName?: string
}

/** The 1-based place of `ref` among the shown rows of its level (top level, or its folder). */
export function describePosition(order: readonly OrderEntry[], items: readonly LayoutItem[], ref: ItemRef, isVisible: (id: string) => boolean): PositionInfo | null {
    const shown = shownIds(items)
    // Members come from the layout (a closed folder has none), but a folder counts exactly when
    // the rail shows it, which the layout cannot tell.
    const rows = listRows(order, (id) => shown.has(id), isVisible)
    if (ref.kind === 'member') {
        const owner = rows.find((row) => row.key === refKey(ref.folder))
        if (!owner || owner.kind !== 'folder') {
            return null
        }
        const index = owner.members.findIndex((member) => member.key === refKey(ref))
        return index < 0 ? null : { position: index + 1, total: owner.members.length, folderName: owner.entry.name }
    }
    const index = rows.findIndex((row) => row.key === refKey(ref))
    return index < 0 ? null : { position: index + 1, total: rows.length }
}
