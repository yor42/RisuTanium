import { computeLayout, locate, type Layout, type LayoutItem } from '../SideBars/railLayout'
import { folderSectionClass, type GridEntry } from './charListOrder'

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
    /** Classes the owner adds to the row's wrapper; set on the rows of an open folder's section. */
    className?: string
    /** The folder whose section the row belongs to; unset on a row of the flow. */
    folderId?: string
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
 * The Grid tab. A tile is `h-14 w-14` and the gap between tiles and rows is `gap-2` / `pb-2`,
 * all in rem, so the column count follows the root font size (text zoom, a larger default
 * font) and never a pixel constant. A row is a tile plus the padding below it; the pixel value
 * is only the height of a row that has not been measured yet.
 */
export const GRID_TILE_REM = 3.5
export const GRID_GAP_REM = 0.5
export const GRID_ROW_FALLBACK_PX = 64
/** `clientWidth` is rounded, so the columns are counted against a width one pixel short of it. */
export const GRID_WIDTH_MARGIN_PX = 1

/**
 * How many tiles fit in a row of `contentWidthPx` when 1 rem is `remPx`. Never below 1: a
 * container narrower than one tile still shows its tiles, one per row.
 */
export function gridColumns(contentWidthPx: number, remPx: number): number {
    const tile = GRID_TILE_REM * remPx
    const gap = GRID_GAP_REM * remPx
    const columns = Math.floor((contentWidthPx - GRID_WIDTH_MARGIN_PX + gap) / (tile + gap))
    return Number.isFinite(columns) ? Math.max(1, columns) : 1
}

export const gridRowKey = (firstCardKey: string): string => JSON.stringify(['g', firstCardKey])

/** Rows of `columns` cards each; the last one holds the rest. A row is named by its first card. */
export function gridRows(cardKeys: readonly string[], columns: number): CharRow[] {
    const per = Math.max(1, Math.floor(columns))
    const rows: CharRow[] = []
    for (let from = 0; from < cardKeys.length; from += per) {
        const cards = cardKeys.slice(from, from + per)
        rows.push({ key: gridRowKey(cards[0]), cards })
    }
    return rows
}

/**
 * The Grid tab's rows for entries in display order. Tiles flow in rows of `columns`; an open
 * folder is a section instead: the flow before it ends its row (partial if need be), the folder
 * tile and the members that follow it fill rows of their own that carry the folder's id and
 * tint, and the flow resumes in a new row. A member is a character entry naming the folder.
 * Every row, partial or not, is a row of cards named by its first card, so card keys that are
 * unique make row keys unique.
 */
export function gridSectionRows(entries: readonly GridEntry[], columns: number): CharRow[] {
    const rows: CharRow[] = []
    let flow: string[] = []
    let at = 0
    while (at < entries.length) {
        const entry = entries[at]
        if (entry.kind !== 'folder' || !entry.open) {
            flow.push(entry.key)
            at++
            continue
        }
        rows.push(...gridRows(flow, columns))
        flow = []
        let end = at + 1
        while (end < entries.length) {
            const next = entries[end]
            if (next.kind !== 'char' || next.folderId !== entry.id) {
                break
            }
            end++
        }
        const section = gridRows(entries.slice(at, end).map((member) => member.key), columns)
        section.forEach((row, i) => {
            const position = section.length === 1 ? 'only' : i === 0 ? 'first' : i === section.length - 1 ? 'last' : 'middle'
            rows.push({ ...row, folderId: entry.id, className: folderSectionClass(entry.color, position) })
        })
        at = end
    }
    rows.push(...gridRows(flow, columns))
    return rows
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

/** A scroll position that survives a change of columns: the first card of the row at the top and how far into the row. */
export interface CardAnchor {
    card: string
    offset: number
}

/** The first card of the row holding content coordinate `y`; null for an empty list. */
export function cardAnchorAt(layout: Layout, rowByKey: ReadonlyMap<string, CharRow>, y: number): CardAnchor | null {
    const anchor = anchorAt(layout, y)
    const card = anchor ? rowByKey.get(anchor.key)?.cards[0] : undefined
    return anchor && card !== undefined ? { card, offset: anchor.offset } : null
}

/** The content coordinate of the row that now holds the anchor's card; the top when the card is gone. */
export function scrollTopForCard(layout: Layout, rowByCard: ReadonlyMap<string, CharRow>, anchor: CardAnchor): number {
    const row = rowByCard.get(anchor.card)
    return row ? scrollTopFor(layout, { key: row.key, offset: anchor.offset }) : 0
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
