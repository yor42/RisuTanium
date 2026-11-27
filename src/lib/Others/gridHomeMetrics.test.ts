// @vitest-environment happy-dom

/**
 * The Home library's tile (`GRID_HOME`): a 4.5 rem square with the name beneath, so a row is taller than the
 * App host's 56 px tile. Expected values are written out by hand from the 72 px tile, the 8 px gap and a 16 px
 * rem, never derived from the code under test.
 *
 * Test labels: (R) fails on the base before the metrics parameter existed (the Home tile fits more columns
 * than it should, and the hit tests answer on 56 px tiles); (F) is a compatibility guard that passes before
 * and after, because the App host's default must not move.
 */
import { describe, expect, test } from 'vitest'
import {
    GRID_HOME,
    GRID_ROW_FALLBACK_PX,
    GRID_SMALL,
    anchorAt,
    buildRowLayout,
    gridColumns,
    gridRows,
    heightDeltaAbove,
    scrollTopFor,
} from './charListRows'
import { slotAt } from './gridDrop'
import { tileKeyAt, type GridGeometry } from './gridTarget'

const keys = (count: number) => Array.from({ length: count }, (_, i) => `c${i}`)

describe('GRID_HOME columns', () => {
    // n tiles need 80 n - 8 px at 16 px per rem, and one pixel is held back.
    test('(R) a 360 px phone (328 px of content) fits four tiles, not the five the small tile would', () => {
        expect(gridColumns(328, 16, GRID_HOME)).toBe(4)
        expect(gridColumns(328, 16)).toBe(5)
    })

    test('(R) the column count steps at 80 px per tile, one pixel short of the reported width', () => {
        expect(gridColumns(313, 16, GRID_HOME)).toBe(4)
        expect(gridColumns(312, 16, GRID_HOME)).toBe(3)
        expect(gridColumns(233, 16, GRID_HOME)).toBe(3)
        expect(gridColumns(232, 16, GRID_HOME)).toBe(2)
        expect(gridColumns(73, 16, GRID_HOME)).toBe(1)
    })

    test('(R) the tile scales with the root font size: at 20 px per rem a tile is 90 px, a gap 10 px', () => {
        // Four tiles need 4 * 90 + 3 * 10 = 390 px.
        expect(gridColumns(391, 20, GRID_HOME)).toBe(4)
        expect(gridColumns(390, 20, GRID_HOME)).toBe(3)
    })

    test('(F) a container narrower than one tile, or with no width, still has one column', () => {
        expect(gridColumns(40, 16, GRID_HOME)).toBe(1)
        expect(gridColumns(0, 16, GRID_HOME)).toBe(1)
        expect(gridColumns(Number.NaN, 16, GRID_HOME)).toBe(1)
    })

    test('(F) the default metrics are the App host tile, unchanged', () => {
        expect(GRID_SMALL).toEqual({ tileRem: 3.5, gapRem: 0.5, fallbackRowPx: 64 })
        expect(GRID_SMALL.fallbackRowPx).toBe(GRID_ROW_FALLBACK_PX)
        expect(gridColumns(624, 16)).toBe(gridColumns(624, 16, GRID_SMALL))
        expect(gridColumns(624, 16)).toBe(9)
    })

    test('(R) the fallback row is taller than the 72 px picture, between the one-line and two-line rows', () => {
        // 72 + 4 + 16 + 8 = 100 px with a one-line name, 116 px with two.
        expect(GRID_HOME.fallbackRowPx).toBeGreaterThanOrEqual(100)
        expect(GRID_HOME.fallbackRowPx).toBeLessThanOrEqual(116)
    })
})

describe('GRID_HOME row layout', () => {
    // 10 cards in rows of four: three rows, 108 px each when unmeasured.
    const rows = gridRows(keys(10), 4)

    test('(R) unmeasured rows stack at the home fallback and the total is their sum', () => {
        const layout = buildRowLayout(rows, new Map(), GRID_HOME.fallbackRowPx)
        expect(rows.length).toBe(3)
        expect(Array.from(layout.offsets.slice(0, 3))).toEqual([0, 108, 216])
        expect(layout.total).toBe(324)
    })

    test('(R) a measured row replaces its fallback and moves only the rows below it', () => {
        const measured = new Map([[rows[0].key, 100], [rows[1].key, 116]])
        const layout = buildRowLayout(rows, measured, GRID_HOME.fallbackRowPx)
        expect(Array.from(layout.offsets.slice(0, 3))).toEqual([0, 100, 216])
        expect(layout.total).toBe(324)
    })

    test('(R) no jump: measuring rows above the viewport shifts the content by exactly their height change', () => {
        const layout = buildRowLayout(rows, new Map(), GRID_HOME.fallbackRowPx)
        // The reader is 20 px into the third row (offset 216). Rows 0 and 1 measure 100 and 116 px.
        const scrollTop = 236
        const delta = heightDeltaAbove(layout, scrollTop, [[rows[0].key, 100], [rows[1].key, 116]])
        expect(delta).toBe(0)
        const anchor = anchorAt(layout, scrollTop)!
        const measured = buildRowLayout(rows, new Map([[rows[0].key, 100], [rows[1].key, 116]]), GRID_HOME.fallbackRowPx)
        // The anchored row and the offset into it stay under the same pixel once the delta is applied.
        expect(scrollTopFor(measured, anchor)).toBe(scrollTop + delta)
    })

    test('(R) rows above the viewport that measure shorter pull the content up by their summed change', () => {
        const layout = buildRowLayout(rows, new Map(), GRID_HOME.fallbackRowPx)
        const delta = heightDeltaAbove(layout, 236, [[rows[0].key, 100], [rows[1].key, 100]])
        expect(delta).toBe(-16)
        const anchor = anchorAt(layout, 236)!
        const measured = buildRowLayout(rows, new Map([[rows[0].key, 100], [rows[1].key, 100]]), GRID_HOME.fallbackRowPx)
        expect(scrollTopFor(measured, anchor)).toBe(236 + delta)
    })
})

describe('GRID_HOME hit tests', () => {
    // 72 px tiles, 8 px gap, 4 columns in 312 px: no inset. Rows are 108 px unmeasured; a tile cell (picture and
    // name) is 100 px and the 8 px below it answers nothing.
    const rows = gridRows(keys(8), 4)
    const geometry: GridGeometry = {
        rows,
        layout: buildRowLayout(rows, new Map(), GRID_HOME.fallbackRowPx),
        contentWidth: 312,
        remPx: 16,
        metrics: GRID_HOME,
    }

    test('(R) each tile answers across its 72 px, the next starts at the 80 px pitch', () => {
        expect(tileKeyAt(geometry, 71, 10)).toBe('c0')
        expect(tileKeyAt(geometry, 75, 10)).toBeNull()
        expect(tileKeyAt(geometry, 80, 10)).toBe('c1')
        expect(tileKeyAt(geometry, 311, 10)).toBe('c3')
    })

    test('(R) the name beneath the picture belongs to the tile; the padding below it does not', () => {
        expect(tileKeyAt(geometry, 10, 99)).toBe('c0')
        expect(tileKeyAt(geometry, 10, 100)).toBeNull()
        expect(tileKeyAt(geometry, 10, 108)).toBe('c4')
    })

    test('(R) the drop slot reads the same 72 px tiles: the left half of the second tile is before it', () => {
        expect(slotAt(geometry, 85, 10)).toEqual({ kind: 'gap', anchorKey: 'c1', side: 'before' })
        expect(slotAt(geometry, 140, 10)).toEqual({ kind: 'gap', anchorKey: 'c1', side: 'after' })
    })

    test('(F) without metrics the geometry is the 56 px tile', () => {
        const small: GridGeometry = { ...geometry, metrics: undefined, contentWidth: 248 }
        expect(tileKeyAt(small, 55, 10)).toBe('c0')
        expect(tileKeyAt(small, 60, 10)).toBeNull()
        expect(tileKeyAt(small, 64, 10)).toBe('c1')
    })
})
