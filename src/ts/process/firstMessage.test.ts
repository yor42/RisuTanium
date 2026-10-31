import { describe, expect, test } from 'vitest'
import { firstMessageIndexOf, firstMessageOf, nextFirstMessageIndex } from './firstMessage'

const owner = { firstMessage: 'Default', alternateGreetings: ['A0', 'A1', 'A2'] }
const ownerWithout = { firstMessage: 'Default', alternateGreetings: undefined as unknown as string[] }

describe('firstMessageIndexOf and firstMessageOf', () => {
    test.each([
        ['in range', 1, 1],
        ['default', -1, -1],
        ['first greeting', 0, 0],
        ['last greeting', 2, 2],
        ['one past the end', 3, -1],
        ['far out of range', 99, -1],
        ['negative other than -1', -2, -1],
        ['non-integer', 1.5, -1],
        ['undefined', undefined, -1],
        ['NaN', NaN, -1],
    ])('diagnostic: %s reads as the effective index %i', (_label, fmIndex, expected) => {
        const chat = { fmIndex: fmIndex as number | undefined }
        expect(firstMessageIndexOf(owner, chat)).toBe(expected)
        expect(firstMessageOf(owner, chat)).toBe(expected === -1 ? 'Default' : owner.alternateGreetings[expected])
    })

    test('diagnostic: an owner without alternate greetings reads its default first message', () => {
        expect(firstMessageIndexOf(ownerWithout, { fmIndex: 0 })).toBe(-1)
        expect(firstMessageOf(ownerWithout, { fmIndex: 0 })).toBe('Default')
    })

    test('diagnostic: an undefined owner reads the effective index -1', () => {
        expect(firstMessageIndexOf(undefined, { fmIndex: 0 })).toBe(-1)
    })
})

describe('nextFirstMessageIndex', () => {
    test.each([
        ['+1 from an in-range middle index', 1, 1, 2],
        ['+1 from the last index wraps to the default', 2, 1, -1],
        ['+1 from the default goes to the first greeting', -1, 1, 0],
        ['+1 from a stale index starts at the first greeting', 7, 1, 0],
        ['-1 from the default goes to the last greeting', -1, -1, 2],
        ['-1 from a stale index goes to the last greeting', 7, -1, 2],
        ['-1 from the first greeting goes to the default', 0, -1, -1],
        ['-1 from an in-range middle index', 2, -1, 1],
    ])('diagnostic: %s', (_label, fmIndex, step, expected) => {
        expect(nextFirstMessageIndex(owner, { fmIndex }, step as 1 | -1)).toBe(expected)
    })

    test('diagnostic: a list without greetings stays on the default', () => {
        const empty = { firstMessage: 'Default', alternateGreetings: [] as string[] }
        expect(nextFirstMessageIndex(empty, { fmIndex: -1 }, 1)).toBe(-1)
        expect(nextFirstMessageIndex(empty, { fmIndex: -1 }, -1)).toBe(-1)
    })
})