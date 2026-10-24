/**
 * `selectedCharacterMismatch` decides whether a single-character write targets
 * the character the page has selected: two ids that are both present must be
 * the same id (text and numbers compared by their text form), and a missing id
 * on either side leaves nothing to compare.
 *
 * Title labels: (R) marks a case that fails against a check that never refuses;
 * (G) marks a case that passes with or without the check.
 */
import { describe, test, expect } from 'vitest'
import { selectedCharacterMismatch } from '../characterWriteCheck'

describe('selectedCharacterMismatch', () => {
    test('(R) two present ids that differ are a mismatch with a message', () => {
        const problem = selectedCharacterMismatch({ chaId: 'a' }, { chaId: 'b' })
        expect(typeof problem).toBe('string')
        expect(problem).toMatch(/not the selected character/i)
        expect(problem).toMatch(/nothing was written/i)
    })

    test('(R) a number and a different text id are a mismatch', () => {
        expect(selectedCharacterMismatch({ chaId: 8 }, { chaId: '7' })).not.toBeNull()
    })

    test('(G) the same id is accepted', () => {
        expect(selectedCharacterMismatch({ chaId: 'a' }, { chaId: 'a' })).toBeNull()
    })

    test('(G) a number and the same id as text are the same id', () => {
        expect(selectedCharacterMismatch({ chaId: 7 }, { chaId: '7' })).toBeNull()
        expect(selectedCharacterMismatch({ chaId: '7' }, { chaId: 7 })).toBeNull()
    })

    test.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty string', ''],
        ['zero', 0],
    ])('(G) an incoming id that is %s has nothing to compare', (_label, missing) => {
        expect(selectedCharacterMismatch({ chaId: missing }, { chaId: 'b' })).toBeNull()
    })

    test.each([
        ['undefined', undefined],
        ['null', null],
        ['an empty string', ''],
    ])('(G) a replaced id that is %s has nothing to compare', (_label, missing) => {
        expect(selectedCharacterMismatch({ chaId: 'a' }, { chaId: missing })).toBeNull()
    })

    test('(G) a replaced value that is not a character has nothing to compare', () => {
        expect(selectedCharacterMismatch({ chaId: 'a' }, undefined)).toBeNull()
        expect(selectedCharacterMismatch({ chaId: 'a' }, 5)).toBeNull()
    })

    test('(G) an incoming value that is not a character has nothing to compare', () => {
        expect(selectedCharacterMismatch(5, { chaId: 'b' })).toBeNull()
    })

    test('(R) the same unusable id held by the slot is accepted, another unusable id is a mismatch', () => {
        expect(selectedCharacterMismatch({ chaId: 'config' }, { chaId: 'config' })).toBeNull()
        expect(selectedCharacterMismatch({ chaId: 'preset' }, { chaId: 'config' })).not.toBeNull()
    })
})
