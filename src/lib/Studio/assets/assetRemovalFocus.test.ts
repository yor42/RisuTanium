/**
 * The removal focus rule as data (U5): the cases of the focus, focusRemoval and delete suites, stated over key lists.
 * Compatibility guard: the rule is the one the list applied to its mounted triggers before it was windowed.
 */
import { describe, expect, test } from 'vitest'
import { FOCUS_ADD, focusTargetAfterRemoval } from './assetRemovalFocus'

describe('focusTargetAfterRemoval', () => {
    test('a removed middle row hands focus to the next row', () => {
        expect(focusTargetAfterRemoval(['a', 'b', 'c', 'd'], ['a', 'c', 'd'], 'b')).toBe('c')
    })

    test('a removed last row hands focus to the previous row', () => {
        expect(focusTargetAfterRemoval(['a', 'b', 'c'], ['a', 'b'], 'c')).toBe('b')
    })

    test('a removed first row hands focus to the next row', () => {
        expect(focusTargetAfterRemoval(['a', 'b', 'c'], ['b', 'c'], 'a')).toBe('b')
    })

    test('the next row is the next survivor when the following rows went too', () => {
        expect(focusTargetAfterRemoval(['a', 'b', 'c', 'd', 'e'], ['a', 'e'], 'b')).toBe('e')
        expect(focusTargetAfterRemoval(['a', 'b', 'c', 'd', 'e'], ['a'], 'c')).toBe('a')
    })

    test('the last row of the list going leaves Add', () => {
        expect(focusTargetAfterRemoval(['a'], [], 'a')).toBe(FOCUS_ADD)
    })

    test('a row that left the display with every row after it takes the previous row', () => {
        expect(focusTargetAfterRemoval(['a', 'b', 'c', 'd'], ['a', 'b'], 'c')).toBe('b')
    })

    test('a focused key the list never knew takes the first survivor, never nothing', () => {
        expect(focusTargetAfterRemoval(['a', 'b'], ['b'], 'zz')).toBe('b')
    })

    test('rows over one file: the key of the removed first twin survives, so the row at its place is the target', () => {
        // twin-a and twin-b share a file: after twin-a goes, the second row takes key 0:file and the third takes 1:file.
        expect(focusTargetAfterRemoval(['0:x', '0:file', '1:file', '0:y'], ['0:x', '0:file', '0:y'], '0:file')).toBe('0:file')
        expect(focusTargetAfterRemoval(['0:x', '0:file', '1:file', '0:y'], ['0:x', '0:file', '0:y'], '1:file')).toBe('0:y')
    })

    test('a surviving key whose old place is past the end of the new keys clamps to the last row', () => {
        expect(focusTargetAfterRemoval(['0:a', '0:b', '0:f', '1:f'], ['0:a', '0:f'], '1:f')).toBe('0:f')
        expect(focusTargetAfterRemoval(['0:a', '0:b', '0:c', '0:f'], ['0:a', '0:f'], '0:f')).toBe('0:f')
    })
})
