// @vitest-environment node
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
    detectEol,
    isExampleMarkerLine,
    joinExampleText,
    newExampleBlock,
    splitExampleText,
    type ExampleText,
} from './exampleBlocks'
import { HAND_MADE_EXAMPLES, V2_CRLF_EXAMPLE, byafExampleText } from './exampleFixtures.test-helpers'

const EOLS = ['\n', '\r\n'] as const

const ALPHABET = [
    '<START>', '<start>', ' ', '\t', ' ', '　', '﻿', '\r', '\n', ':', '{{user}}', '<bot>:', 'a',
]

const textArb = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 40 }).map((tokens) => tokens.join(''))
const eolArb = fc.constantFrom(...EOLS)
const RUN = { seed: 20261108, numRuns: 600 }

const hasMarkerLine = (text: string) => text.split('\n').some(isExampleMarkerLine)

/** The parts a split text is made of, in join order: the opening, then each block's marker and body. */
function partsOf(t: ExampleText): string[] {
    return [t.opening, ...t.blocks.flatMap((block) => [block.marker, block.body])]
}

/** Replaces the body of block `k` (or the opening when `k` is -1) and reports the raw text before and after it. */
function replaceBody(t: ExampleText, k: number, replacement: string): {
    edited: ExampleText
    before: string
    after: string
} {
    const parts = partsOf(t)
    const at = k === -1 ? 0 : 2 + 2 * k
    const edited: ExampleText = {
        opening: k === -1 ? replacement : t.opening,
        blocks: t.blocks.map((block, index) => (index === k ? { ...block, body: replacement } : block)),
    }
    return { edited, before: parts.slice(0, at).join(''), after: parts.slice(at + 1).join('') }
}

describe('A1-u1 marker rule', () => {
    test.each([
        ['  <Start>\r', true],
        ['<START>', true],
        ['<start>\t', true],
        [' <START> ', true],
        ['　<start>　', true],
        ['<START>{{user}}: hi', false],
        ['x <START>', false],
        ['<START>x', false],
        ['', false],
    ])('%j -> %s', (line, expected) => {
        expect(isExampleMarkerLine(line)).toBe(expected)
    })
})

describe('A1-p1 byte round trip', () => {
    test('INV1 holds for generated text and both eols', () => {
        fc.assert(
            fc.property(textArb, eolArb, (text, eol) => joinExampleText(splitExampleText(text), eol) === text),
            RUN,
        )
    })

    test('INV1 holds for producer shapes and hand-made variants', () => {
        const producers = [
            byafExampleText(['{{user}}: hi\n{{char}}: hello', '', '{{user}}: again']),
            V2_CRLF_EXAMPLE,
            ...HAND_MADE_EXAMPLES,
        ]
        for (const text of producers) {
            for (const eol of EOLS) {
                expect(joinExampleText(splitExampleText(text), eol)).toBe(text)
            }
        }
    })

    test('a text that is only a marker keeps no leading line feed', () => {
        for (const eol of EOLS) {
            expect(joinExampleText(splitExampleText('<START>'), eol)).toBe('<START>')
        }
    })
})

describe('A1-p2 locality of an edit (INV2)', () => {
    test('replacing one body changes only that body plus at most one repair eol beside it', () => {
        fc.assert(
            fc.property(textArb, textArb, fc.nat(), eolArb, (text, replacement, pick, eol) => {
                const t = splitExampleText(text)
                const k = (pick % (t.blocks.length + 1)) - 1
                const { edited, before, after } = replaceBody(t, k, replacement)
                const joined = joinExampleText(edited, eol)
                if (!joined.startsWith(before) || !joined.endsWith(after)) {
                    return false
                }
                if (joined.length < before.length + after.length) {
                    return false
                }
                const middle = joined.slice(before.length, joined.length - after.length)
                return [replacement, eol + replacement, replacement + eol].includes(middle)
            }),
            RUN,
        )
    })
})

describe('A1-p3 structure survives an edit (INV3)', () => {
    test('an unedited result splits back to itself', () => {
        fc.assert(
            fc.property(textArb, eolArb, (text, eol) => {
                const t = splitExampleText(text)
                expect(splitExampleText(joinExampleText(t, eol))).toEqual(t)
            }),
            RUN,
        )
    })

    test('a marker-free body keeps the block count, every marker and every body up to its repair eol', () => {
        fc.assert(
            fc.property(
                textArb,
                textArb.filter((replacement) => !hasMarkerLine(replacement)),
                fc.nat(),
                eolArb,
                (text, replacement, pick, eol) => {
                    const t = splitExampleText(text)
                    const k = (pick % (t.blocks.length + 1)) - 1
                    const { edited } = replaceBody(t, k, replacement)
                    const back = splitExampleText(joinExampleText(edited, eol))
                    if (back.blocks.length !== t.blocks.length) {
                        return false
                    }
                    const upToRepair = (got: string, want: string) => got === want || got === want + eol
                    if (!upToRepair(back.opening, edited.opening)) {
                        return false
                    }
                    return edited.blocks.every((block, index) => {
                        return upToRepair(back.blocks[index].marker, block.marker)
                            && upToRepair(back.blocks[index].body, block.body)
                    })
                },
            ),
            RUN,
        )
    })

    test('a body replacing the empty body after a final marker with no terminator', () => {
        for (const eol of EOLS) {
            const t = splitExampleText('<START>')
            t.blocks[0].body = '{{user}}: x\n'
            const back = splitExampleText(joinExampleText(t, eol))
            expect(back.blocks).toHaveLength(1)
            expect(back.blocks[0]).toEqual({ marker: '<START>' + eol, body: '{{user}}: x\n' })
        }
    })

    test('an edited body without a final newline before a marker gains one repair eol', () => {
        const t = splitExampleText('<START>\na\n<START>\nb')
        t.blocks[0].body = 'a'
        expect(joinExampleText(t, '\n')).toBe('<START>\na\n<START>\nb')
        expect(joinExampleText(t, '\r\n')).toBe('<START>\na\r\n<START>\nb')
        const back = splitExampleText(joinExampleText(t, '\n'))
        expect(back.blocks).toHaveLength(2)
        expect(back.blocks[0].body).toBe('a\n')
    })
})

describe('A1-u2 eol and new blocks', () => {
    test('detectEol follows the majority and falls back to LF', () => {
        expect(detectEol('a\r\nb\r\n')).toBe('\r\n')
        expect(detectEol('a\nb\n')).toBe('\n')
        expect(detectEol('a\r\nb\nc\n')).toBe('\n')
        expect(detectEol('a\r\nb\n')).toBe('\n')
        expect(detectEol('a\r\nb\r\nc\n')).toBe('\r\n')
        expect(detectEol('no newline')).toBe('\n')
        expect(detectEol('')).toBe('\n')
    })

    test('newExampleBlock on CRLF text gives a CRLF marker', () => {
        const text = V2_CRLF_EXAMPLE
        expect(newExampleBlock('', detectEol(text))).toEqual({ marker: '<START>\r\n', body: '' })
        expect(newExampleBlock('{{user}}: x', '\n').marker).toBe('<START>\n')
    })

    test('appending to a text with no final newline adds exactly one eol', () => {
        for (const eol of EOLS) {
            const t = splitExampleText('x')
            t.blocks.push(newExampleBlock('', eol))
            expect(joinExampleText(t, eol)).toBe('x' + eol + '<START>' + eol)
        }
    })

    test('appending to a text that already ends in a newline adds none', () => {
        const t = splitExampleText('x\n')
        t.blocks.push(newExampleBlock('', '\n'))
        expect(joinExampleText(t, '\n')).toBe('x\n<START>\n')
    })

    test('<START> round-trips to itself with both eols', () => {
        for (const eol of EOLS) {
            expect(joinExampleText(splitExampleText('<START>'), eol)).toBe('<START>')
        }
    })

    test('a replaced body after an unterminated final marker never fuses with it', () => {
        const t = splitExampleText('a\n<START>')
        expect(t).toEqual({ opening: 'a\n', blocks: [{ marker: '<START>', body: '' }] })
        t.blocks[0].body = '{{user}}: x\n'
        expect(joinExampleText(t, '\n')).toBe('a\n<START>\n{{user}}: x\n')
        expect(joinExampleText(t, '\r\n')).toBe('a\n<START>\r\n{{user}}: x\n')
        const back = splitExampleText(joinExampleText(t, '\n'))
        expect(back.blocks).toEqual([{ marker: '<START>\n', body: '{{user}}: x\n' }])
    })

    test('the split puts each byte into exactly one part', () => {
        const t = splitExampleText('pre\n  <Start>\r\nx\r\n<START>\ny')
        expect(t).toEqual({
            opening: 'pre\n',
            blocks: [
                { marker: '  <Start>\r\n', body: 'x\r\n' },
                { marker: '<START>\n', body: 'y' },
            ],
        })
    })
})
