import type { Layout } from '../SideBars/railLayout'
import { locate } from '../SideBars/railLayout'
import { GRID_GAP_REM, GRID_TILE_REM, type CharRow } from './charListRows'

/**
 * The Grid's two-dimensional hit test, pure: it reads the rows, their layout and the container's
 * reported width, never the DOM, so a press resolves the same whichever rows are mounted.
 *
 * A row's tiles are centred as a group (`safe center`): a partial last row sits in the middle, and a
 * row wider than the container starts at its left edge. A row is a tile plus the gap below it; the
 * first row of an open folder's section also carries a gap above it, which stays inside the row's
 * band, so a press there still resolves to the tile below it.
 */

export interface GridGeometry {
    rows: readonly CharRow[]
    /** One item per row, in row order (`buildRowLayout`). */
    layout: Layout
    /** The width the tiles can use. */
    contentWidth: number
    /** The pixel size of 1 rem. */
    remPx: number
}

/** The card key of the tile at content coordinates (`x` from the container's left edge, `y` including the scroll), or null between tiles, in the gap below a row, or outside the content. */
export function tileKeyAt(geometry: GridGeometry, x: number, y: number): string | null {
    const { rows, layout, contentWidth, remPx } = geometry
    if (!(y >= 0) || y >= layout.total || rows.length === 0) {
        return null
    }
    const index = locate(layout, y)
    const row = rows[index]
    if (!row || row.cards.length === 0) {
        return null
    }
    const tile = GRID_TILE_REM * remPx
    const gap = GRID_GAP_REM * remPx
    if (y >= layout.offsets[index] + layout.heights[index] - gap) {
        return null
    }
    const count = row.cards.length
    const inset = Math.max(0, (contentWidth - (count * tile + (count - 1) * gap)) / 2)
    const across = x - inset
    if (!(across >= 0)) {
        return null
    }
    const column = Math.floor(across / (tile + gap))
    if (column >= count || across - column * (tile + gap) >= tile) {
        return null
    }
    return row.cards[column]
}
