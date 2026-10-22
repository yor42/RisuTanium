import { describePosition, keyboardMove, type MoveDirection, type PositionInfo } from '../SideBars/railKeyboard'
import { buildItems, type RailEntry } from '../SideBars/railLayout'
import { refKey, type ItemRef, type MemberRef, type OrderEntry } from '../SideBars/sidebarOrder'
import type { GridEntry } from './charListOrder'

/**
 * Alt+Left and Alt+Right on a focused Grid tile in edit mode, decided from the tiles and the saved
 * order alone (no DOM). The Grid's tiles become the rail's layout items, so the one-place move is
 * exactly the sidebar's `keyboardMove` and writes what `moveToGap` writes for the same gap. Rail items
 * are keyed by `refKey` of the order entry, never by the tile key: `keyboardMove` finds its source by
 * `refKey`, so a tile-keyed item would never be found. A tile without an order entry is not an item and
 * cannot move.
 */

/** Alt+ArrowRight moves a tile toward the end of the order, Alt+ArrowLeft toward the start. */
export function directionOfKey(key: string): MoveDirection | null {
    if (key === 'ArrowRight') {
        return 'down'
    }
    if (key === 'ArrowLeft') {
        return 'up'
    }
    return null
}

/**
 * The rail entries of the tiles shown: every tile with an order entry, a folder tile carrying the
 * member tiles that follow it. A closed folder shows no member tiles, and the layout adds gaps for the
 * members of an open folder only.
 */
export function gridRailEntries(entries: readonly GridEntry[]): RailEntry[] {
    const result: RailEntry[] = []
    let members: { ref: MemberRef, key: string }[] | null = null
    let ownerKey: string | null = null
    for (const entry of entries) {
        const ref = entry.ref
        if (ref === null) {
            continue
        }
        if (ref.kind === 'member') {
            if (members !== null && ownerKey === refKey(ref.folder)) {
                members.push({ ref, key: refKey(ref) })
            }
            continue
        }
        const mine: { ref: MemberRef, key: string }[] = []
        members = ref.kind === 'folder' ? mine : null
        ownerKey = ref.kind === 'folder' ? refKey(ref) : null
        result.push({ ref, key: refKey(ref), open: entry.kind === 'folder' && entry.open, members: mine })
    }
    return result
}

/** The tile that stands for `ref` now, or null. */
export function tileKeyOfRef(entries: readonly GridEntry[], ref: ItemRef): string | null {
    const wanted = refKey(ref)
    return entries.find((entry) => entry.ref !== null && refKey(entry.ref) === wanted)?.key ?? null
}

export type GridKeyMove =
    /** The tile is unknown or has no order entry: handled, nothing happens. */
    | { kind: 'ignore' }
    /** No gap is left in that direction. */
    | { kind: 'edge', dir: MoveDirection }
    /** The move would remove the folder of a sole visible member; `folderName` is the folder tile's name. */
    | { kind: 'refuse-sole', folderName: string }
    /** The source passed an identical duplicate: nothing is written, focus goes to `ref`. */
    | { kind: 'focus', ref: ItemRef, info: PositionInfo | null }
    /** The new order and the moved entry's ref in it. */
    | { kind: 'move', order: OrderEntry[], ref: ItemRef, info: PositionInfo | null }

/**
 * What one place in `dir` does to the tile `tileKey`. `isVisible` says which chaIds have a tile (the
 * live characters); a folder whose last visible member would leave is refused, as in the rail.
 */
export function gridKeyMove(entries: readonly GridEntry[], order: readonly OrderEntry[], tileKey: string, dir: MoveDirection, isVisible: (id: string) => boolean): GridKeyMove {
    const source = entries.find((entry) => entry.key === tileKey)?.ref ?? null
    if (source === null) {
        return { kind: 'ignore' }
    }
    const items = buildItems(gridRailEntries(entries))
    const result = keyboardMove(order, items, source, dir, isVisible)
    if (result === null) {
        return { kind: 'edge', dir }
    }
    if (result.kind === 'refuse-sole') {
        const wanted = refKey(result.folder)
        const owner = entries.find((entry): entry is Extract<GridEntry, { kind: 'folder' }> => entry.kind === 'folder' && entry.key === wanted)
        return { kind: 'refuse-sole', folderName: owner?.name ?? '' }
    }
    if (result.kind === 'focus') {
        return { kind: 'focus', ref: result.ref, info: describePosition(order, items, result.ref, isVisible) }
    }
    return { kind: 'move', order: result.order, ref: result.ref, info: describePosition(result.order, items, result.ref, isVisible) }
}
