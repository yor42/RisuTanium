import { folderMemberIds, type FolderRef, type Gap, type ItemRef, type OrderEntry, type TopRef } from '../SideBars/sidebarOrder'
import { CENTRE_ZONE_FRACTION } from '../SideBars/railConstants'
import { locate } from '../SideBars/railLayout'
import { NO_TARGET, type Target, type ZoneCandidate } from '../SideBars/railTarget'
import type { GridEntry } from './charListOrder'
import { GRID_GAP_REM, GRID_TILE_REM } from './charListRows'
import type { GridGeometry } from './gridTarget'

/**
 * The Grid's drop resolver, pure: a pointer position in the content box becomes an insertion slot
 * (a gap between two tiles, the end of the list) or a centre-zone slot on a tile (merge, append),
 * and a slot becomes the `Gap` or target the order operations take. It reads the geometry, the
 * entries and the moved set, never the DOM or the gesture machine's own `source` argument.
 *
 * `gridTarget.tileKeyAt` stays the press hit test. It answers only on a tile; a drop also needs an
 * answer in the gaps, beyond the end of a row and below the content, so the slot lookup here
 * measures rows the same way (a row is a tile plus the gap below it, its tiles centred as a group).
 */

/** The tiles a drag moves: their tile keys and the order refs the operations take. */
export interface GridMoved {
    keys: ReadonlySet<string>
    sources: readonly ItemRef[]
}

export type GridSlot =
    /** Beside the tile `anchorKey`: before its left half, after its right half. */
    | { kind: 'gap'; anchorKey: string; side: 'before' | 'after' }
    /** Below the last row: the end of the top level. */
    | { kind: 'end' }
    /** The centre zone of a top-level character tile. */
    | { kind: 'merge'; tileKey: string }
    /** The centre zone of a folder tile. */
    | { kind: 'append'; tileKey: string }

/**
 * A key that differs for every painted slot. Two slots can name the same `Gap` (right of the last
 * tile of a row and left of the first tile of the next one), and the gesture machine only reports a
 * target again when its key changes, so the key follows the slot and not the resulting `Gap`.
 */
export function slotKey(slot: GridSlot): string {
    switch (slot.kind) {
        case 'gap':
            return JSON.stringify(['d', slot.anchorKey, slot.side])
        case 'end':
            return JSON.stringify(['d', 'end'])
        default:
            return JSON.stringify([slot.kind === 'merge' ? 'm' : 'a', slot.tileKey])
    }
}

/** The entries with the lookups the slot mapping needs, built once per entries array. */
export interface GridDropModel {
    entries: readonly GridEntry[]
    indexByKey: ReadonlyMap<string, number>
    /** The last top-level ref strictly before each entry (a folder's members belong to the folder), or null. */
    prevTop: readonly (TopRef | null)[]
    /** The last top-level ref of the list, or null when there is none. */
    lastTop: TopRef | null
}

export function buildDropModel(entries: readonly GridEntry[]): GridDropModel {
    const indexByKey = new Map<string, number>()
    const prevTop: (TopRef | null)[] = []
    let last: TopRef | null = null
    entries.forEach((entry, index) => {
        indexByKey.set(entry.key, index)
        prevTop.push(last)
        if (entry.ref && entry.ref.kind !== 'member') {
            last = entry.ref
        }
    })
    return { entries, indexByKey, prevTop, lastTop: last }
}

interface RowFrame {
    count: number
    /** Left edge of the row's first tile. */
    inset: number
    tile: number
    /** The pitch from one tile's left edge to the next. */
    pitch: number
    /** Top of the row and bottom of its tiles (the gap below the tiles is not part of a tile). */
    top: number
    bottom: number
}

function frameOf(geometry: GridGeometry, rowIndex: number): RowFrame | null {
    const { rows, layout, contentWidth, remPx } = geometry
    const row = rows[rowIndex]
    if (!row || row.cards.length === 0) {
        return null
    }
    const tile = GRID_TILE_REM * remPx
    const gap = GRID_GAP_REM * remPx
    const count = row.cards.length
    const inset = Math.max(0, (contentWidth - (count * tile + (count - 1) * gap)) / 2)
    return {
        count,
        inset,
        tile,
        pitch: tile + gap,
        top: layout.offsets[rowIndex],
        bottom: layout.offsets[rowIndex] + layout.heights[rowIndex] - gap,
    }
}

/**
 * The insertion slot nearest a content-box point (`x` from the content's left edge, `y` including
 * the scroll). Above the content it is the first row, in a row's band (its tiles and the gap below
 * them) that row, below the content the end slot. Within a row the tile whose column holds `x` (the
 * first or last tile when `x` is beyond the row) decides, and its left half is before it, its right
 * half after it. Null when there are no rows.
 */
export function slotAt(geometry: GridGeometry, x: number, y: number): GridSlot | null {
    const { rows, layout } = geometry
    if (rows.length === 0 || layout.items.length === 0) {
        return null
    }
    if (y >= layout.total) {
        return { kind: 'end' }
    }
    const rowIndex = locate(layout, y)
    const frame = frameOf(geometry, rowIndex)
    if (!frame) {
        return null
    }
    const column = Math.min(frame.count - 1, Math.max(0, Math.floor((x - frame.inset) / frame.pitch)))
    const centre = frame.inset + column * frame.pitch + frame.tile / 2
    return { kind: 'gap', anchorKey: rows[rowIndex].cards[column], side: x < centre ? 'before' : 'after' }
}

/**
 * The order `Gap` a gap slot stands for, against the entries as they are now; null for a merge or
 * an append slot and for an anchor tile that is gone. Beside a top-level tile it is a top-level gap
 * after the previous top-level entry (an open folder's members belong to the folder), except that
 * the right side of an open folder's tile is the gap before its first member. Beside a member it is
 * a gap of that member's folder. A tile with no order entry, like the end slot, is the end of the
 * top level.
 */
export function gapOf(slot: GridSlot, model: GridDropModel): Gap | null {
    if (slot.kind === 'merge' || slot.kind === 'append') {
        return null
    }
    if (slot.kind === 'end') {
        return { in: 'top', after: model.lastTop }
    }
    const index = model.indexByKey.get(slot.anchorKey)
    if (index === undefined) {
        return null
    }
    const entry = model.entries[index]
    const ref = entry.ref
    if (!ref) {
        return { in: 'top', after: model.lastTop }
    }
    if (ref.kind === 'member') {
        if (slot.side === 'after') {
            return { in: 'folder', folder: ref.folder, after: ref }
        }
        const previous = index > 0 ? model.entries[index - 1].ref : null
        const after = previous?.kind === 'member' && previous.folder.id === ref.folder.id && previous.folder.occurrence === ref.folder.occurrence ? previous : null
        return { in: 'folder', folder: ref.folder, after }
    }
    if (slot.side === 'before') {
        return { in: 'top', after: model.prevTop[index] }
    }
    if (entry.kind === 'folder' && entry.open && ref.kind === 'folder') {
        return { in: 'folder', folder: ref, after: null }
    }
    return { in: 'top', after: ref }
}

/**
 * The gap that appends to the end of the folder `folder` names in `order`: after its last string
 * member, hidden members included, as the rail's drop on a folder row does. Null when the folder is
 * gone.
 */
export function appendGap(order: readonly OrderEntry[], folder: FolderRef): Gap | null {
    const ids = folderMemberIds(order, folder)
    if (!ids) {
        return null
    }
    if (ids.length === 0) {
        return { in: 'folder', folder, after: null }
    }
    const id = ids[ids.length - 1]
    let occurrence = 0
    for (let i = 0; i < ids.length - 1; i++) {
        if (ids[i] === id) {
            occurrence++
        }
    }
    return { in: 'folder', folder, after: { kind: 'member', folder, id, occurrence } }
}

function isMemberOf(source: ItemRef, folder: FolderRef): boolean {
    return source.kind === 'member' && source.folder.id === folder.id && source.folder.occurrence === folder.occurrence
}

/**
 * The top-level tile whose centre zone (the middle `CENTRE_ZONE_FRACTION` of the tile on both axes)
 * holds the point, when it can take a merge or an append. Never a dragged tile (a dragged folder's
 * included), a member tile or a tile with no order entry; a folder tile is excluded only when every
 * moved item is already one of its members, so a mixed drag can still be appended to it. Folder
 * candidates report `closedFolder: false`, as the Grid has no spring-open.
 */
export function zoneCandidateAt(geometry: GridGeometry, model: GridDropModel, x: number, y: number, moved: GridMoved): ZoneCandidate | null {
    const { rows, layout } = geometry
    if (!(y >= 0) || y >= layout.total || rows.length === 0) {
        return null
    }
    const rowIndex = locate(layout, y)
    const frame = frameOf(geometry, rowIndex)
    if (!frame || y >= frame.bottom) {
        return null
    }
    const across = x - frame.inset
    if (!(across >= 0)) {
        return null
    }
    const column = Math.floor(across / frame.pitch)
    if (column >= frame.count || across - column * frame.pitch >= frame.tile) {
        return null
    }
    const margin = (1 - CENTRE_ZONE_FRACTION) / 2
    const inColumn = across - column * frame.pitch
    const height = frame.bottom - frame.top
    if (inColumn < frame.tile * margin || inColumn >= frame.tile * (1 - margin)) {
        return null
    }
    if (y < frame.top + height * margin || y >= frame.bottom - height * margin) {
        return null
    }
    const key = rows[rowIndex].cards[column]
    const index = model.indexByKey.get(key)
    const ref = index === undefined ? null : model.entries[index].ref
    if (index === undefined || !ref || ref.kind === 'member' || moved.keys.has(key)) {
        return null
    }
    if (ref.kind === 'folder' && moved.sources.length > 0 && moved.sources.every((source) => isMemberOf(source, ref))) {
        return null
    }
    return { key, index, ref, closedFolder: false }
}

export interface GridDropInput {
    geometry: GridGeometry
    model: GridDropModel
    /** The pointer in the content box: x from its left edge, y including the scroll. */
    x: number
    y: number
    /** The pointer's y within the scroller (`y - scrollTop`) and the scroller's height. */
    viewportY: number
    viewportHeight: number
    /** The gesture machine's verdict that the pointer is too far outside the column. */
    outside: boolean
    moved: GridMoved
    /** The tile key of the active centre zone, and whether its merge dwell has elapsed. */
    zoneKey: string | null
    mergeArmed: boolean
    /** Whether releasing at `gap` would change nothing; the caller memoises it by `key`. */
    isNoop: (gap: Gap, key: string) => boolean
}

export interface GridResolved {
    target: Target
    /** The slot the target stands for, for painting and for the drop; null when there is no target. */
    slot: GridSlot | null
}

/**
 * What a release at the pointer would do. No target when the pointer is outside the column or
 * outside the scroller's height (over the header above it, or below it, where the user cannot see
 * what a content position names), or when the slot is a gap inside a moved folder's own open
 * section. Otherwise an armed merge or an append when the active zone still holds the pointer, else
 * the gap slot. A moved folder's own tile is not part of its section: the gap before it is an
 * ordinary gap.
 */
export function resolveGridTarget(input: GridDropInput): GridResolved {
    const none: GridResolved = { target: NO_TARGET, slot: null }
    if (input.outside) {
        return none
    }
    if (!(input.viewportY >= 0 && input.viewportY < input.viewportHeight)) {
        return none
    }
    const { geometry, model, moved } = input
    if (input.zoneKey !== null) {
        const candidate = zoneCandidateAt(geometry, model, input.x, input.y, moved)
        if (candidate && candidate.key === input.zoneKey) {
            if (candidate.ref.kind === 'folder') {
                return { target: { kind: 'append', ref: candidate.ref, key: candidate.key }, slot: { kind: 'append', tileKey: candidate.key } }
            }
            if (input.mergeArmed) {
                return { target: { kind: 'merge', ref: candidate.ref, key: candidate.key }, slot: { kind: 'merge', tileKey: candidate.key } }
            }
        }
    }
    const slot = slotAt(geometry, input.x, input.y)
    const gap = slot ? gapOf(slot, model) : null
    if (!slot || !gap) {
        return none
    }
    if (gap.in === 'folder' && moved.sources.some((source) => source.kind === 'folder' && source.id === gap.folder.id && source.occurrence === gap.folder.occurrence)) {
        return none
    }
    const key = slotKey(slot)
    return { target: { kind: 'gap', gap, key, index: -1, noop: input.isNoop(gap, key) }, slot }
}
