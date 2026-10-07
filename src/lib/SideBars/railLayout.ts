import { refKey, type Gap, type ItemRef, type MemberRef, type TopRef } from './sidebarOrder'
import { CENTRE_ZONE_FRACTION, DEFAULT_HEIGHTS, FOLDER_BLOCK_MARGIN_PX } from './railConstants'

/**
 * The geometry of the sidebar rail as one flat list of items, computed from data and
 * per-item heights only. Nothing here reads the DOM, so a hit test never depends on which
 * rows are mounted and the same offsets serve rendering, drag targets and any windowing.
 *
 * Top to bottom the list holds: the gap before the first entry, then for every top-level
 * entry its row, (for an open folder: a head spacer, the gap before its first member, each
 * member row followed by the gap after it, a tail spacer), the gap after the entry, and
 * last the "+" block.
 */

export type ItemKind = 'gap' | 'char' | 'folder' | 'member' | 'folderHead' | 'folderTail' | 'plus'

export interface LayoutItem {
    key: string
    kind: ItemKind
    /** Rows only. */
    ref?: ItemRef
    /** Gaps only. */
    gap?: Gap
    /** Key of the folder row that owns a member row, a member gap, a head or a tail. */
    owner?: string
}

export interface RailEntry {
    ref: TopRef
    key: string
    /** Only meaningful for a folder. */
    open: boolean
    members: ReadonlyArray<{ ref: MemberRef; key: string }>
}

export interface Layout {
    items: readonly LayoutItem[]
    /** `offsets[i]` is the top of item `i`; `offsets[items.length]` is the total height. */
    offsets: Float64Array
    heights: Float64Array
    total: number
    indexByKey: ReadonlyMap<string, number>
}

export function gapKey(gap: Gap): string {
    if (gap.in === 'top') {
        return JSON.stringify(['g', 't', gap.after ? refKey(gap.after) : null])
    }
    return JSON.stringify(['g', 'f', refKey(gap.folder), gap.after ? refKey(gap.after) : null])
}

export const folderHeadKey = (ownerKey: string): string => JSON.stringify(['h', ownerKey])
export const folderTailKey = (ownerKey: string): string => JSON.stringify(['e', ownerKey])
export const PLUS_KEY = JSON.stringify(['plus'])

export function buildItems(entries: readonly RailEntry[]): LayoutItem[] {
    const items: LayoutItem[] = []
    const pushGap = (gap: Gap, owner?: string) => {
        items.push({ key: gapKey(gap), kind: 'gap', gap, owner })
    }
    pushGap({ in: 'top', after: null })
    for (const entry of entries) {
        items.push({ key: entry.key, kind: entry.ref.kind, ref: entry.ref })
        if (entry.ref.kind === 'folder' && entry.open) {
            const folder = entry.ref
            items.push({ key: folderHeadKey(entry.key), kind: 'folderHead', owner: entry.key })
            pushGap({ in: 'folder', folder, after: null }, entry.key)
            for (const member of entry.members) {
                items.push({ key: member.key, kind: 'member', ref: member.ref, owner: entry.key })
                pushGap({ in: 'folder', folder, after: member.ref }, entry.key)
            }
            items.push({ key: folderTailKey(entry.key), kind: 'folderTail', owner: entry.key })
        }
        pushGap({ in: 'top', after: entry.ref })
    }
    items.push({ key: PLUS_KEY, kind: 'plus' })
    return items
}

/** A measured height counts only when it is a positive finite number. */
export function computeLayout(items: readonly LayoutItem[], measured: ReadonlyMap<string, number>): Layout {
    const n = items.length
    const offsets = new Float64Array(n + 1)
    const heights = new Float64Array(n)
    const indexByKey = new Map<string, number>()
    let y = 0
    for (let i = 0; i < n; i++) {
        const item = items[i]
        const m = measured.get(item.key)
        const h = m !== undefined && Number.isFinite(m) && m > 0 ? m : DEFAULT_HEIGHTS[item.kind]
        offsets[i] = y
        heights[i] = h
        y += h
        indexByKey.set(item.key, i)
    }
    offsets[n] = y
    return { items, offsets, heights, total: y, indexByKey }
}

/**
 * The index of the item that holds content coordinate `y`. Above the list it is the first
 * item and at or below the end the last one; an empty list has none (-1).
 */
export function locate(layout: Layout, y: number): number {
    const n = layout.items.length
    if (n === 0) {
        return -1
    }
    if (!(y > 0)) {
        return 0
    }
    if (y >= layout.total) {
        return n - 1
    }
    let lo = 0
    let hi = n - 1
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (layout.offsets[mid] <= y) {
            lo = mid
        }
        else {
            hi = mid - 1
        }
    }
    return lo
}

/** The vertical span of item `index` whose pointer position counts as "on" the row. */
export function centreZone(layout: Layout, index: number): { top: number; bottom: number } {
    const top = layout.offsets[index]
    const h = layout.heights[index]
    const margin = (h * (1 - CENTRE_ZONE_FRACTION)) / 2
    return { top: top + margin, bottom: top + h - margin }
}

/**
 * The span of an open folder's background: it starts below the folder block's margin and
 * runs to the end of the tail spacer. `null` when the folder is closed.
 */
export function folderBackground(layout: Layout, ownerKey: string): { top: number; height: number } | null {
    const head = layout.indexByKey.get(folderHeadKey(ownerKey))
    const tail = layout.indexByKey.get(folderTailKey(ownerKey))
    if (head === undefined || tail === undefined) {
        return null
    }
    const top = layout.offsets[head] + FOLDER_BLOCK_MARGIN_PX
    return { top, height: layout.offsets[tail] + layout.heights[tail] - top }
}
