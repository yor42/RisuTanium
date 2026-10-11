// @vitest-environment happy-dom

/**
 * `gridTarget.ts`: the Grid's pure hit test. Expected tile positions are written out by hand from the
 * tile size (3.5 rem), the gap (0.5 rem) and a 16 px rem, never derived from the code under test.
 *
 * Test labels: every test here is a feature test (the module is new, so on the earlier base each one
 * fails at the import and proves nothing about a defect).
 */
import { describe, expect, test } from 'vitest'
import { buildRowLayout, gridRows } from './charListRows'
import { tileKeyAt, type GridGeometry } from './gridTarget'

// Tile 56 px, gap 8 px, row 64 px unmeasured.
const geometry = (cardCount: number, columns: number, contentWidth: number, measured: Map<string, number> = new Map()): GridGeometry => {
    const rows = gridRows(Array.from({ length: cardCount }, (_, i) => `c${i}`), columns)
    return { rows, layout: buildRowLayout(rows, measured, 64), contentWidth, remPx: 16 }
}

describe('tileKeyAt', () => {
    test('a full row of four: each tile answers across its 56 px and the gap answers nothing', () => {
        // 4 * 56 + 3 * 8 = 248 px of tiles in a 248 px container: no inset.
        const g = geometry(8, 4, 248)
        expect(tileKeyAt(g, 0, 10)).toBe('c0')
        expect(tileKeyAt(g, 55, 10)).toBe('c0')
        expect(tileKeyAt(g, 60, 10)).toBeNull()
        expect(tileKeyAt(g, 64, 10)).toBe('c1')
        expect(tileKeyAt(g, 247, 10)).toBe('c3')
        expect(tileKeyAt(g, 248, 10)).toBeNull()
    })

    test('the second row starts at 64 px and the 8 px below a tile answers nothing', () => {
        const g = geometry(8, 4, 248)
        expect(tileKeyAt(g, 10, 55)).toBe('c0')
        expect(tileKeyAt(g, 10, 56)).toBeNull()
        expect(tileKeyAt(g, 10, 63)).toBeNull()
        expect(tileKeyAt(g, 10, 64)).toBe('c4')
        expect(tileKeyAt(g, 200, 64 + 30)).toBe('c7')
    })

    test('a partial last row is centred: its tiles sit at the inset of the group', () => {
        // Two tiles: 56 + 8 + 56 = 120 px, inset (248 - 120) / 2 = 64 px.
        const g = geometry(6, 4, 248)
        expect(tileKeyAt(g, 10, 64 + 10)).toBeNull()
        expect(tileKeyAt(g, 63, 64 + 10)).toBeNull()
        expect(tileKeyAt(g, 64, 64 + 10)).toBe('c4')
        expect(tileKeyAt(g, 119, 64 + 10)).toBe('c4')
        expect(tileKeyAt(g, 128, 64 + 10)).toBe('c5')
        expect(tileKeyAt(g, 184, 64 + 10)).toBeNull()
    })

    test('a row wider than the container starts at its left edge (no negative inset)', () => {
        const g = geometry(4, 4, 100)
        expect(tileKeyAt(g, 0, 10)).toBe('c0')
        expect(tileKeyAt(g, 70, 10)).toBe('c1')
    })

    test('measured row heights move the rows below', () => {
        const g = geometry(8, 4, 248, new Map([[JSON.stringify(['g', 'c0']), 80]]))
        expect(tileKeyAt(g, 10, 70)).toBe('c0')
        expect(tileKeyAt(g, 10, 72)).toBeNull()
        expect(tileKeyAt(g, 10, 80 + 10)).toBe('c4')
    })

    test('outside the content, or with no rows, answers nothing', () => {
        const g = geometry(4, 4, 248)
        expect(tileKeyAt(g, 10, -1)).toBeNull()
        expect(tileKeyAt(g, 10, 64)).toBeNull()
        expect(tileKeyAt(g, -5, 10)).toBeNull()
        expect(tileKeyAt(g, Number.NaN, 10)).toBeNull()
        expect(tileKeyAt(geometry(0, 4, 248), 10, 10)).toBeNull()
    })

    test('a larger root font size scales the tiles and the gap', () => {
        const rows = gridRows(['a', 'b'], 2)
        const g: GridGeometry = { rows, layout: buildRowLayout(rows, new Map(), 80), contentWidth: 200, remPx: 20 }
        // Tile 70 px, gap 10 px, two tiles 150 px, inset 25 px.
        expect(tileKeyAt(g, 24, 10)).toBeNull()
        expect(tileKeyAt(g, 25, 10)).toBe('a')
        expect(tileKeyAt(g, 94, 10)).toBe('a')
        expect(tileKeyAt(g, 95, 10)).toBeNull()
        expect(tileKeyAt(g, 105, 10)).toBe('b')
        expect(tileKeyAt(g, 105, 69)).toBe('b')
        expect(tileKeyAt(g, 105, 70)).toBeNull()
    })
})
