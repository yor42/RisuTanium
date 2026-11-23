// The pure rules of the token bias list (diagnostics): the clamp and its notes, the exact-string duplicate rule, the row
// builders and the focus after a delete. No expectation is computed by the module under test.
import { describe, expect, test } from 'vitest'
import type { BiasRow } from '../history/fieldRegistry'
import { addRow, clampBias, deleteRow, duplicateIndexes, editToken, editValue, focusAfterDelete } from './biasRows'

describe('clampBias', () => {
    test.each([
        ['250', 100, 'clamp'],
        ['-250', -100, 'clamp'],
        ['100', 100, null],
        ['-100', -100, null],
        ['100.5', 100, 'clamp'],
        ['7', 7, null],
        ['-3.25', -3.25, null],
        ['0', 0, null],
        ['', 0, 'zeroed'],
        ['   ', 0, 'zeroed'],
        ['abc', 0, 'zeroed'],
        ['1e999', 100, 'clamp'],
    ] as const)('%j is stored as %j with note %j', (raw, value, note) => {
        expect(clampBias(raw)).toEqual({ value, note })
    })

    test('a negative zero is stored as 0 and a decimal is not rounded', () => {
        expect(Object.is(clampBias('-0').value, 0)).toBe(true)
        expect(clampBias('2.5').value).toBe(2.5)
    })
})

describe('duplicateIndexes: the exact string match', () => {
    test('equal tokens are duplicates, in every row that holds them', () => {
        expect([...duplicateIndexes([['a', 1], ['b', 2], ['a', 3]])]).toEqual([0, 2])
    })

    test('a token with a leading space or another case is not a duplicate', () => {
        expect([...duplicateIndexes([['a', 1], [' a', 2], ['A', 3]])]).toEqual([])
    })

    test('two tokens that both start with a space are duplicates of each other, not of the trimmed token', () => {
        expect([...duplicateIndexes([[' a', 1], [' a', 2], ['a', 3]])]).toEqual([0, 1])
    })

    test('empty tokens repeat like any other string', () => {
        expect([...duplicateIndexes([['', 0], ['', 0]])]).toEqual([0, 1])
    })
})

describe('the row builders return fresh rows and leave their input alone', () => {
    const rows: BiasRow[] = [['a', 1], ['b', 2]]

    test('add appends [empty, 0]', () => {
        expect(addRow(rows)).toEqual([['a', 1], ['b', 2], ['', 0]])
    })

    test('edit token and edit value change one cell', () => {
        expect(editToken(rows, 1, 'z')).toEqual([['a', 1], ['z', 2]])
        expect(editValue(rows, 0, 9)).toEqual([['a', 9], ['b', 2]])
    })

    test('delete removes one row', () => {
        expect(deleteRow(rows, 0)).toEqual([['b', 2]])
    })

    test('the input and the output share no row array', () => {
        for (const out of [addRow(rows), editToken(rows, 0, 'x'), editValue(rows, 0, 5), deleteRow(rows, 1)]) {
            for (const row of out) {
                expect(rows.includes(row)).toBe(false)
            }
        }
        expect(rows).toEqual([['a', 1], ['b', 2]])
    })
})

describe('focusAfterDelete: the next row, else the previous, else Add', () => {
    test.each([
        [0, 2, 0],
        [1, 2, 1],
        [2, 2, 1],
        [0, 0, null],
        [1, 1, 0],
    ] as const)('deleting row %i leaving %i rows focuses %j', (index, remaining, target) => {
        expect(focusAfterDelete(index, remaining)).toBe(target)
    })
})
