// @vitest-environment happy-dom

/**
 * `charListRows.ts`: the row model of the windowed character lists. Pure functions over keys and
 * heights, so nothing here is mounted.
 *
 * Test labels: every test here is a feature test. The module does not exist before the windowed
 * lists, so on the earlier base each one fails at the import and proves nothing about a defect.
 */
import { describe, expect, test } from 'vitest'
import { anchorAt, buildRowLayout, heightDeltaAbove, listRowKey, listRows, scrollTopFor } from './charListRows'

const keys = (count: number): string[] => Array.from({ length: count }, (_, i) => String(i))

describe('listRows', () => {
    test('one row per card, keyed so that no key equals a spacer key of the window', () => {
        const rows = listRows(keys(3))
        expect(rows.map((row) => row.cards)).toEqual([['0'], ['1'], ['2']])
        expect(new Set(rows.map((row) => row.key)).size).toBe(3)
        for (const row of rows) {
            expect(row.key).toBe(listRowKey(row.cards[0]))
            expect(Array.isArray(JSON.parse(row.key))).toBe(true)
            expect(row.key === 'top' || row.key === 'bottom' || row.key.startsWith('gap-after:')).toBe(false)
        }
    })
})

describe('buildRowLayout', () => {
    test('a row without a measurement takes the fallback height, a measured one its own', () => {
        const rows = listRows(keys(3))
        const layout = buildRowLayout(rows, new Map([[rows[1].key, 200]]), 100)
        expect(Array.from(layout.heights)).toEqual([100, 200, 100])
        expect(Array.from(layout.offsets)).toEqual([0, 100, 300, 400])
        expect(layout.total).toBe(400)
    })

    test('a measurement that is not a positive finite number counts as unmeasured', () => {
        const rows = listRows(keys(3))
        const layout = buildRowLayout(rows, new Map([[rows[0].key, 0], [rows[1].key, Number.NaN], [rows[2].key, -5]]), 100)
        expect(Array.from(layout.heights)).toEqual([100, 100, 100])
    })

    test('an empty list has no height', () => {
        expect(buildRowLayout([], new Map(), 100).total).toBe(0)
    })
})

describe('scroll anchors', () => {
    const rows = listRows(keys(5))
    const measured = new Map([[rows[0].key, 50], [rows[1].key, 300]])
    const layout = buildRowLayout(rows, measured, 100)

    test('the anchor names the row at the viewport top and how far into it', () => {
        expect(anchorAt(layout, 0)).toEqual({ key: rows[0].key, offset: 0 })
        expect(anchorAt(layout, 120)).toEqual({ key: rows[1].key, offset: 70 })
        expect(anchorAt(layout, 350)).toEqual({ key: rows[2].key, offset: 0 })
    })

    test('an empty list has no anchor', () => {
        expect(anchorAt(buildRowLayout([], new Map(), 100), 10)).toBeNull()
    })

    test('an anchor is restored against changed heights to the same row and offset', () => {
        const anchor = anchorAt(layout, 120)!
        const taller = buildRowLayout(rows, new Map([[rows[0].key, 80], [rows[1].key, 300]]), 100)
        expect(scrollTopFor(taller, anchor)).toBe(80 + 70)
    })

    test('an anchor whose row is gone, or whose offset is past the row, lands at the top or the row end', () => {
        expect(scrollTopFor(layout, { key: listRowKey('99'), offset: 10 })).toBe(0)
        expect(scrollTopFor(layout, { key: rows[0].key, offset: 500 })).toBe(50)
    })
})

describe('heightDeltaAbove', () => {
    const rows = listRows(keys(6))
    const layout = buildRowLayout(rows, new Map(), 100)

    test('sums new minus modelled height over the rows wholly above the viewport top', () => {
        // The viewport top is inside row 3 (300..400).
        const delta = heightDeltaAbove(layout, 350, [[rows[0].key, 140], [rows[2].key, 90]])
        expect(delta).toBe(40 - 10)
    })

    test('the row at the viewport top and the rows below it move nothing on screen', () => {
        expect(heightDeltaAbove(layout, 350, [[rows[3].key, 400], [rows[5].key, 400]])).toBe(0)
    })

    test('a key the layout does not hold is ignored', () => {
        expect(heightDeltaAbove(layout, 350, [[listRowKey('99'), 400]])).toBe(0)
    })

    test('at the top of the list there is nothing above', () => {
        expect(heightDeltaAbove(layout, 0, [[rows[0].key, 400]])).toBe(0)
    })
})
