// @vitest-environment node
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { splitPastedMessages } from './pasteSplit'

const blank = (text: string) => splitPastedMessages(text, { splitOn: 'blank-lines' })
const dash = (text: string) => splitPastedMessages(text, { splitOn: 'dash-lines' })

describe('A1-u3 blank-line mode', () => {
    test('two blank lines split and one does not', () => {
        expect(blank('a\n\n\nb')).toEqual(['a', 'b'])
        expect(blank('a\n\nb')).toEqual(['a\n\nb'])
        expect(blank('a\n\n\n\n\nb')).toEqual(['a', 'b'])
    })

    test('whitespace-only lines are blank, including a carriage return', () => {
        expect(blank('a\n \t\r\n\t\nb')).toEqual(['a', 'b'])
        expect(blank('a\n \n　\nb')).toEqual(['a', 'b'])
    })

    test('leading and trailing blank lines are dropped, empty groups too', () => {
        expect(blank('\n\n\na\n\n\n')).toEqual(['a'])
        expect(blank('\n  \n\n')).toEqual([])
        expect(blank('')).toEqual([])
        expect(blank('\n\nA\n\nB\n\n')).toEqual(['A\n\nB'])
    })

    test('CRLF text splits without a trailing carriage return', () => {
        expect(blank('A\r\n\r\n\r\nB\r\n')).toEqual(['A', 'B'])
        expect(blank('a\r\nb\r\n\r\n\r\nc')).toEqual(['a\r\nb', 'c'])
        expect(blank('a\r')).toEqual(['a'])
        expect(blank('a\r\r\n\n\nb')).toEqual(['a', 'b'])
    })
})

describe('A1-u3 dash-line mode', () => {
    test('three or more dashes split and two do not', () => {
        expect(dash('a\n---\nb')).toEqual(['a', 'b'])
        expect(dash('a\n-----\nb')).toEqual(['a', 'b'])
        expect(dash('a\n--\nb')).toEqual(['a\n--\nb'])
        expect(dash(' a\n - - \nb')).toEqual([' a\n - - \nb'])
    })

    test('a dash line may carry surrounding whitespace and a carriage return', () => {
        expect(dash('a\r\n  ---  \r\nb\r\n')).toEqual(['a', 'b'])
    })

    test('blank lines never separate, and empty groups are dropped', () => {
        expect(dash('a\n\n\n\nb')).toEqual(['a\n\n\n\nb'])
        expect(dash('---\na\n---\n---\nb\n---')).toEqual(['a', 'b'])
        expect(dash('\n\n')).toEqual([])
    })
})

describe('A1-u3 strict fences', () => {
    test('F1 a fence with an info string keeps the blank run inside', () => {
        expect(blank('```js\na\n\n\nb\n```\n\n\nc')).toEqual(['```js\na\n\n\nb\n```', 'c'])
    })

    test('F2 an opening line with another backtick is not a fence', () => {
        expect(blank('```x```\n\n\nB')).toEqual(['```x```', 'B'])
    })

    test('F3 a closing line with trailing text does not close', () => {
        const text = '```\na\n```js\n\n\nb'
        expect(blank(text)).toEqual([text])
    })

    test('F4 indentation and trailing spaces are allowed on the fence lines', () => {
        expect(blank('  ```\na\n\n\n  ```  \n\n\nb')).toEqual(['  ```\na\n\n\n  ```  ', 'b'])
    })

    test('F5 a carriage return does not prevent closing', () => {
        expect(blank('```\r\na\r\n\r\n\r\n```\r\n\r\n\r\nb')).toEqual(['```\r\na\r\n\r\n\r\n```', 'b'])
    })

    test('F6 dash lines inside a fence do not separate', () => {
        expect(dash('```\n---\n```\n---\nb')).toEqual(['```\n---\n```', 'b'])
    })

    test('F7 an unclosed fence runs to the end of the text', () => {
        const text = '```\na\n\n\nb'
        expect(blank(text)).toEqual([text])
    })

    test('an unclosed fence drops only trailing blank lines', () => {
        expect(blank('x\n\n\n```\na\n\n\n')).toEqual(['x', '```\na'])
    })
})

/** Lines that are neither blank, a dash line, nor a fence candidate. */
const plainLineArb = fc.array(fc.constantFrom('a', 'b', 'x y', '{{user}}: hi', ' z', '--', '`one`'), { minLength: 1, maxLength: 3 })
    .map((tokens) => tokens.join(' '))
const blankLineArb = fc.constantFrom('', ' ', '\t', '\r')

const messageArb: fc.Arbitrary<string> = fc
    .array(fc.tuple(plainLineArb, fc.option(blankLineArb, { nil: undefined })), { minLength: 1, maxLength: 4 })
    .map((rows) => rows.map(([line, gap], index) => (index < rows.length - 1 && gap !== undefined ? [line, gap] : [line])).flat().join('\n'))
    .filter((message) => !message.endsWith('\r'))

describe('A1-p4 paste properties', () => {
    const textArb = fc.array(fc.constantFrom('a', ' ', '\t', '\r', '\n', '\n\n', '---', '```', '```js', 'x:'), { maxLength: 40 })
        .map((tokens) => tokens.join(''))

    test('INV-P: every message is a non-empty substring with non-blank ends and no trailing carriage return', () => {
        for (const mode of ['blank-lines', 'dash-lines'] as const) {
            fc.assert(
                fc.property(textArb, (text) => {
                    for (const message of splitPastedMessages(text, { splitOn: mode })) {
                        expect(message).not.toBe('')
                        expect(text.includes(message)).toBe(true)
                        expect(message.endsWith('\r')).toBe(false)
                        const lines = message.split('\n')
                        expect(lines[0].trim()).not.toBe('')
                        expect(lines[lines.length - 1].trim()).not.toBe('')
                    }
                }),
                { seed: 20261108, numRuns: 600 },
            )
        }
    })

    test('joining messages with the separator and splitting again gives them back (blank mode)', () => {
        fc.assert(
            fc.property(fc.array(messageArb, { minLength: 1, maxLength: 4 }), (messages) => {
                expect(blank(messages.join('\n\n\n'))).toEqual(messages)
            }),
            { seed: 20261108, numRuns: 400 },
        )
    })

    test('joining messages with a dash line and splitting again gives them back (dash mode)', () => {
        fc.assert(
            fc.property(fc.array(messageArb, { minLength: 1, maxLength: 4 }), (messages) => {
                expect(dash(messages.join('\n---\n'))).toEqual(messages)
            }),
            { seed: 20261108, numRuns: 400 },
        )
    })
})
