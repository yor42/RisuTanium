/**
 * The pure parts of the windowed selectChar grid. These are compatibility guards: they hold the
 * filter the picker has always used, the cut into rows and the track count read back from CSS.
 */
import { describe, expect, test } from 'vitest'
import { gridTrackCount, pickableCharacterPositions, selectCharRows } from './selectCharGrid'

describe('pickableCharacterPositions', () => {
    test('guard: skips groups, trashed and hidden system characters in place, keeping array positions', () => {
        expect(pickableCharacterPositions([
            { chaId: '§playground' },
            { chaId: 'a' },
            { chaId: 'g', type: 'group' },
            { chaId: 't', trashTime: 5 },
            { chaId: '§temp' },
            null,
            { chaId: 'b' },
        ])).toEqual([1, 6])
    })
})

describe('selectCharRows', () => {
    test('guard: cuts positions into rows of the column count, the last row shorter', () => {
        expect(selectCharRows([1, 2, 5, 7, 9], 2).map((row) => row.positions)).toEqual([[1, 2], [5, 7], [9]])
    })

    test('guard: keys are unique and change with the column count', () => {
        const three = selectCharRows([0, 1, 2, 3, 4, 5, 6], 3).map((row) => row.key)
        const two = selectCharRows([0, 1, 2, 3, 4, 5, 6], 2).map((row) => row.key)
        expect(new Set(three).size).toBe(three.length)
        expect(three.filter((key) => two.includes(key))).toEqual([])
    })

    test('guard: a column count below one still gives one card per row', () => {
        expect(selectCharRows([3, 4], 0).map((row) => row.positions)).toEqual([[3], [4]])
    })
})

describe('gridTrackCount', () => {
    test.each([
        ['112px 112px 112px', 3],
        ['  90.5px   90.5px ', 2],
        ['none', 0],
        ['', 0],
    ])('guard: %j has %i tracks', (template, count) => {
        expect(gridTrackCount(template)).toBe(count)
    })
})
