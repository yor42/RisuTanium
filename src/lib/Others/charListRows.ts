import { computeLayout, locate, type Layout, type LayoutItem } from '../SideBars/railLayout'

/**
 * The geometry of a windowed character list as rows of cards, computed from keys and
 * heights only. Nothing here reads the DOM, so the offsets, the scroll anchor and the height
 * corrections are the same whichever rows are mounted. The windower reuses the rail's layout
 * and window maths: a list row is a rail item of kind `char` whose height is the measured
 * one, else the list's fallback.
 */

/** One visual row of a list. A one-column list holds one card per row. */
export interface CharRow {
    /** The layout key of the row. Never equals a spacer key of the window. */
    key: string
    /** Card keys in display order; the first one names the row for focus and aria. */
    cards: readonly string[]
}

/**
 * Fallback heights of a row that is not mounted and has never been measured. Each is the
 * midpoint of the row's range for the markup in use, and only decides how far the scrollbar
 * is off until the row has been mounted once.
 *
 * List and trash row: 16 px padding, 2 px border and 8 px gap below, plus a 32 px name line,
 * a description of 24 to 72 px (one line to the three-line clamp) and a 24 px action row:
 * 106 px to 154 px.
 * Simple row: 16 px padding around the 56 px avatar and 1 px divider.
 */
export const LIST_ROW_FALLBACK_PX = 130
export const SIMPLE_ROW_FALLBACK_PX = 73

/** A saved scroll position that survives the list being rebuilt: the row at the top and how far into it. */
export interface ScrollAnchor {
    key: string
    offset: number
}

export const listRowKey = (cardKey: string): string => JSON.stringify(['r', cardKey])

/** One row per card key. */
export function listRows(cardKeys: readonly string[]): CharRow[] {
    return cardKeys.map((cardKey) => ({ key: listRowKey(cardKey), cards: [cardKey] }))
}

/**
 * The layout of `rows` with each row at its measured height, else at `fallbackHeight`. A
 * measured height counts only when it is a positive finite number.
 */
export function buildRowLayout(rows: readonly CharRow[], measured: ReadonlyMap<string, number>, fallbackHeight: number): Layout {
    const items: LayoutItem[] = []
    const heights = new Map<string, number>()
    for (const row of rows) {
        items.push({ key: row.key, kind: 'char' })
        const height = measured.get(row.key)
        heights.set(row.key, height !== undefined && Number.isFinite(height) && height > 0 ? height : fallbackHeight)
    }
    return computeLayout(items, heights)
}

/** The row holding content coordinate `y` and how far into it `y` lies; null for an empty list. */
export function anchorAt(layout: Layout, y: number): ScrollAnchor | null {
    const index = locate(layout, y)
    if (index < 0) {
        return null
    }
    return { key: layout.items[index].key, offset: Math.max(0, y - layout.offsets[index]) }
}

/** The content coordinate an anchor stands for; the top when its row is no longer in the layout. */
export function scrollTopFor(layout: Layout, anchor: ScrollAnchor): number {
    const index = layout.indexByKey.get(anchor.key)
    if (index === undefined) {
        return 0
    }
    return Math.min(layout.offsets[index] + Math.min(anchor.offset, layout.heights[index]), layout.total)
}

/**
 * How far the content under the viewport top moves when the given rows change height: the sum
 * of `new - modelled` over the rows that lie wholly above the row holding `scrollTop`. The row
 * at the top and everything below it grow downward and move nothing that is on screen.
 */
export function heightDeltaAbove(layout: Layout, scrollTop: number, changes: Iterable<readonly [key: string, height: number]>): number {
    const top = locate(layout, scrollTop)
    let delta = 0
    for (const [key, height] of changes) {
        const index = layout.indexByKey.get(key)
        if (index !== undefined && index < top) {
            delta += height - layout.heights[index]
        }
    }
    return delta
}
