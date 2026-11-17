import { describe, expect, test } from 'vitest'
import { splitEditedRow } from './keyRowSplit'

describe('splitEditedRow', () => {
    test('R1 splits two keys and keeps the focus on the run holding the caret', () => {
        const r = splitEditedRow(['sk-test-A sk-test-B'], 0, 19)
        expect(r).toEqual({ rows: ['sk-test-A', 'sk-test-B'], focusRow: 1, caret: 9 })
    })

    test('R2 splits three keys into three rows', () => {
        const r = splitEditedRow(['sk-test-A sk-test-B sk-test-C'], 0, 29)
        expect(r?.rows).toEqual(['sk-test-A', 'sk-test-B', 'sk-test-C'])
        expect(r?.focusRow).toBe(2)
    })

    test('R3 translates the caret into the run it is inside', () => {
        const r = splitEditedRow(['sk-A sk-Btest-Z'], 0, 9)
        expect(r).toEqual({ rows: ['sk-A', 'sk-Btest-Z'], focusRow: 1, caret: 4 })
    })

    test('R4 typing a, space, b keeps the focus on the second run', () => {
        const r = splitEditedRow(['a b'], 0, 3)
        expect(r).toEqual({ rows: ['a', 'b'], focusRow: 1, caret: 1 })
    })

    test('R5 a caret before the first run keeps the first run', () => {
        const r = splitEditedRow(['sk-test-A sk-test-B'], 0, 0)
        expect(r).toEqual({ rows: ['sk-test-A', 'sk-test-B'], focusRow: 0, caret: 0 })
    })

    test('R6 only the edited row is replaced, its neighbours stay in order', () => {
        const r = splitEditedRow(['X', 'A B', 'Y', ''], 1, 3)
        expect(r?.rows).toEqual(['X', 'A', 'B', 'Y', ''])
        expect(r?.focusRow).toBe(2)
    })

    test('R7 any run of whitespace separates keys and never makes an empty row', () => {
        for (const sep of ['  ', '\t', '　', '   ']) {
            const r = splitEditedRow([`a${sep}b`], 0, null)
            expect(r?.rows).toEqual(['a', 'b'])
        }
    })

    test('R8 a row with fewer than two runs is left byte-identical', () => {
        for (const text of [' sk-test-A ', '', 'sk ', '\tsk', '   ']) {
            const rows = [text]
            expect(splitEditedRow(rows, 0, text.length)).toBeNull()
            expect(rows).toEqual([text])
        }
    })

    test('R9 is idempotent on the focused row of its own result', () => {
        const first = splitEditedRow(['sk-A sk-Btest-Z'], 0, 9)
        expect(first).not.toBeNull()
        expect(splitEditedRow(first!.rows, first!.focusRow, first!.caret)).toBeNull()
    })

    test('R10 a null caret means the end of the text', () => {
        const r = splitEditedRow(['one two three'], 0, null)
        expect(r).toEqual({ rows: ['one', 'two', 'three'], focusRow: 2, caret: 5 })
    })

    test('does not mutate its input', () => {
        const rows = ['a b', 'c']
        const copy = [...rows]
        splitEditedRow(rows, 0, 3)
        expect(rows).toEqual(copy)
    })
})
