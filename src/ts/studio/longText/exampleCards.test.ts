// @vitest-environment node
import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { detectEol, isExampleMarkerLine, splitExampleText } from './exampleBlocks'
import {
    HAND_MADE_EXAMPLES,
    V2_CRLF_EXAMPLE,
    byafExampleText,
} from './exampleFixtures.test-helpers'
import { lf } from './fieldWrite'
import {
    addBlock,
    cardSpans,
    cardText,
    deleteCard,
    locateCaret,
    markOpening,
    moveBlock,
    rawIndexOf,
    rebaseHold,
    splitChanged,
    spliceLf,
    writeCardText,
    type Hold,
} from './exampleCards'

const SEED = 20261114

/** The engine-diff alphabet: marker spellings, blank kinds, every line-ending form. */
const ENGINE_ALPHABET = [
    '<START>', '<start>', ' ', '\t', ' ', '　', '﻿', '\r', '\n', ':', '{{user}}', '<bot>:', 'a',
]
const engineTextArb = fc.array(fc.constantFrom(...ENGINE_ALPHABET), { maxLength: 40 }).map((tokens) => tokens.join(''))

/** Line-ending mixes and indented, mixed-case marker spellings. */
const MIXED_ALPHABET = ['a', 'b', ' ', '\n', '\r', '\r\n', '<START>', '  <Start>  ', '{{char}}: x', ':']
const mixedTextArb = fc.array(fc.constantFrom(...MIXED_ALPHABET), { maxLength: 16 }).map((tokens) => tokens.join(''))

const FIXTURES: readonly string[] = [
    V2_CRLF_EXAMPLE,
    byafExampleText(['one', 'two\nthree', 'four']),
    'a\r\nb\nc',
    'a\rb',
    ...HAND_MADE_EXAMPLES,
]

const cardsOf = (text: string, hold: Hold | null = null): string[] => {
    const spans = cardSpans(text, hold)
    return spans.map((_, i) => cardText(text, spans, i))
}

/** The parts `splitExampleText` yields: a non-empty opening, then every block body. */
const partsOf = (text: string): string[] => {
    const t = splitExampleText(text)
    return [...(t.opening === '' ? [] : [t.opening]), ...t.blocks.map((block) => block.body)]
}

describe('C-U1 cardSpans with no hold equals the splitExampleText parts', () => {
    test('property: seed 20261114, 600 runs', () => {
        fc.assert(
            fc.property(engineTextArb, (text) => {
                const spans = cardSpans(text, null)
                expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(partsOf(text))
            }),
            { seed: SEED, numRuns: 600 },
        )
    })

    test.each(FIXTURES)('fixture %j', (text) => {
        const spans = cardSpans(text, null)
        expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(partsOf(text))
    })

    test('the marker rule is the engine rule: case, indent and CR do not matter', () => {
        for (const marker of ['<START>', '<start>', '  <Start>  ', '<START>\r']) {
            expect(cardSpans(`${marker}\nx`, null).map((s) => s.kind)).toEqual(['block'])
            expect(isExampleMarkerLine(marker)).toBe(true)
        }
        expect(cardSpans('x\n<start>\ny', null).map((s) => s.kind)).toEqual(['opening', 'block'])
        expect(cardSpans('x\n  <Start>  \ny', null).map((s) => s.kind)).toEqual(['opening', 'block'])
    })

    test('an empty opening is not a card', () => {
        expect(cardSpans('', null)).toEqual([])
        expect(cardSpans('<START>\nA', null).map((s) => s.kind)).toEqual(['block'])
        expect(cardSpans('o\n<START>\nA', null).map((s) => s.kind)).toEqual(['opening', 'block'])
    })
})

describe('C-U2 writing a card its own text returns the stored text', () => {
    test('property: random texts, every card', () => {
        fc.assert(
            fc.property(mixedTextArb, (text) => {
                const spans = cardSpans(text, null)
                for (let i = 0; i < spans.length; i++) {
                    expect(writeCardText(text, spans, i, lf(cardText(text, spans, i)))).toBe(text)
                }
            }),
            { seed: SEED, numRuns: 1000 },
        )
    })

    test.each(FIXTURES)('fixture %j', (text) => {
        const spans = cardSpans(text, null)
        for (let i = 0; i < spans.length; i++) {
            expect(writeCardText(text, spans, i, lf(cardText(text, spans, i)))).toBe(text)
        }
    })
})

describe('C-U3 a card edit keeps every byte outside its range', () => {
    const editArb = fc.tuple(mixedTextArb, fc.nat(), fc.nat(), fc.constantFrom('x', '\n', 'y\nz', ''))

    test('property: bytes outside [start,end), the new card text, the card count', () => {
        fc.assert(
            fc.property(editArb, ([text, rawA, rawB, insert]) => {
                const spans = cardSpans(text, null)
                for (let i = 0; i < spans.length; i++) {
                    const cur = lf(cardText(text, spans, i))
                    const a = rawA % (cur.length + 1)
                    const b = a + (rawB % (cur.length - a + 1))
                    const nextLf = cur.slice(0, a) + insert + cur.slice(b)
                    const written = writeCardText(text, spans, i, nextLf)
                    const s = spans[i]
                    expect(written.startsWith(text.slice(0, s.start))).toBe(true)
                    expect(written.endsWith(text.slice(s.end))).toBe(true)
                    if (nextLf.split('\n').some(isExampleMarkerLine)) {
                        continue
                    }
                    const emptiedLoneOpening = s.kind === 'opening' && i === spans.length - 1 && nextLf === ''
                    if (emptiedLoneOpening) {
                        continue
                    }
                    const after = cardSpans(written, null)
                    expect(after.length).toBe(spans.length)
                    expect(lf(cardText(written, after, i))).toBe(nextLf)
                }
            }),
            { seed: SEED, numRuns: 3000 },
        )
    })

    test('a lone CR left at the end of a followed card does not fuse with its terminator', () => {
        const text = '\ra\n <start> '
        const spans = cardSpans(text, null)
        const written = writeCardText(text, spans, 0, '\n')
        const after = cardSpans(written, null)
        expect(after.length).toBe(spans.length)
        expect(lf(cardText(written, after, 0))).toBe('\n')
    })

    const reread = (text: string, i: number, nextLf: string) => {
        const written = writeCardText(text, cardSpans(text, null), i, nextLf)
        const after = cardSpans(written, null)
        return { count: after.length, card: lf(cardText(written, after, Math.min(i, after.length - 1))) }
    }

    test('deleting the empty last line after a lone CR keeps the next marker a marker', () => {
        expect(reread('A\r\r\n<START>\nB', 0, 'A')).toMatchObject({ count: 2, card: 'A' })
    })

    test('deleting the empty last line of two keeps one line break', () => {
        expect(reread('\n\r\r\n<START>\nB', 0, '\n')).toMatchObject({ count: 2, card: '\n' })
    })

    test('two lone CRs before an LF terminator do not fuse with the eol that replaces them', () => {
        expect(reread('\r\rA\n<START>\nB', 0, '\n\n')).toMatchObject({ count: 2, card: '\n\n' })
    })

    test('enumerated: every text of up to four tokens, every card, a replacement set', () => {
        const tokens = ['<START>', 'A', '\n', '\r\n', ' ', '<start> ', '\r']
        const replacements = ['', 'A', '\n', 'A\n', '\n\n', '<START>']
        const texts: string[] = ['']
        let layer: string[] = ['']
        for (let n = 0; n < 4; n++) {
            layer = layer.flatMap((t) => tokens.map((tok) => t + tok))
            texts.push(...layer)
        }
        let checked = 0
        for (const text of texts) {
            const spans = cardSpans(text, null)
            for (let i = 0; i < spans.length; i++) {
                const s = spans[i]
                for (const nextLf of replacements) {
                    const written = writeCardText(text, spans, i, nextLf)
                    expect(written.startsWith(text.slice(0, s.start)), JSON.stringify({ text, i, nextLf })).toBe(true)
                    expect(written.endsWith(text.slice(s.end)), JSON.stringify({ text, i, nextLf })).toBe(true)
                    if (nextLf.split('\n').some(isExampleMarkerLine) || (s.kind === 'opening' && nextLf === '')) {
                        continue
                    }
                    checked++
                    const after = cardSpans(written, null)
                    expect(after.length, JSON.stringify({ text, i, nextLf, written })).toBe(spans.length)
                    expect(lf(cardText(written, after, i)), JSON.stringify({ text, i, nextLf, written })).toBe(nextLf)
                }
            }
        }
        expect(checked).toBeGreaterThan(10000)
    })

    test('property: seed 20261118, lone CR and CRLF pieces, the edited card re-reads as the edit and the others are untouched', () => {
        let state = 20261118 >>> 0
        const next = (): number => {
            state = (state * 1664525 + 1013904223) >>> 0
            return state / 2 ** 32
        }
        const pieces = ['a', 'b', '\n', '\r\n', '\r', '<START>', ' <start> ', 'x:y', '{{char}}: hi']
        const inserts = ['', 'q', 'zz', '\n', 'w\nv', '<START', '>', ' ']
        let runs = 0
        for (let n = 0; n < 20000; n++) {
            let text = ''
            for (let k = 1 + Math.floor(next() * 9); k > 0; k--) {
                text += pieces[Math.floor(next() * pieces.length)]
            }
            const spans = cardSpans(text, null)
            if (spans.length === 0) {
                continue
            }
            const i = Math.floor(next() * spans.length)
            const shown = lf(cardText(text, spans, i))
            const a = Math.floor(next() * (shown.length + 1))
            const b = a + Math.floor(next() * (shown.length - a + 1))
            const nextLf = shown.slice(0, a) + inserts[Math.floor(next() * inserts.length)] + shown.slice(b)
            if (nextLf.split('\n').some(isExampleMarkerLine) || (spans[i].kind === 'opening' && nextLf === '')) {
                continue
            }
            runs++
            const written = writeCardText(text, spans, i, nextLf)
            const after = cardSpans(written, null)
            expect(after.length, JSON.stringify({ text, i, nextLf, written })).toBe(spans.length)
            expect(lf(cardText(written, after, i)), JSON.stringify({ text, i, nextLf, written })).toBe(nextLf)
            for (let j = 0; j < spans.length; j++) {
                if (j !== i) {
                    expect(cardText(written, after, j)).toBe(cardText(text, spans, j))
                }
            }
        }
        expect(runs).toBeGreaterThan(5000)
    })

    test('marker lines keep their spelling and terminator, however indented', () => {
        const text = '  <Start>  \r\nA\r\n<START>\r\nB'
        const spans = cardSpans(text, null)
        expect(writeCardText(text, spans, 0, 'AA')).toBe('  <Start>  \r\nAA\r\n<START>\r\nB')
        expect(writeCardText(text, spans, 1, 'BB')).toBe('  <Start>  \r\nA\r\n<START>\r\nBB')
    })
})

describe('C-U4 spliceLf', () => {
    test.each([
        // raw, nextLf, eol, expected
        ['a\r\nb\r\nc', 'a\nB\nc', '\r\n', 'a\r\nB\r\nc'],
        ['a\r\nb\nc', 'a\nb\nX', '\r\n', 'a\r\nb\nX'],
        ['a\nb', 'a\nb\nc', '\r\n', 'a\nb\r\nc'],
        ['a\nb', 'a\nb\nc', '\n', 'a\nb\nc'],
        ['a\rb', 'a\n\nb', '\n', 'a\n\nb'],
        ['a\rb\nc', 'a\n\nc', '\n', 'a\n\nc'],
        ['a\r\rb', 'a\n\n\nb', '\n', 'a\n\n\nb'],
        ['a\rb', 'a\n\nb', '\r\n', 'a\r\r\nb'],
        ['a\rb', 'a\nx\nb', '\n', 'a\rx\nb'],
        ['a\r\nb', 'a\n\nb', '\n', 'a\r\n\nb'],
        ['', 'x\ny', '\r\n', 'x\r\ny'],
        ['a\r\nb', 'a\nb', '\n', 'a\r\nb'],
    ] as const)('%j -> %j (%j)', (raw, nextLf, eol, expected) => {
        const out = spliceLf(raw, nextLf, eol)
        expect(out).toBe(expected)
        expect(lf(out)).toBe(nextLf)
    })

    test('the inserted LF becomes the eol, and rawIndexOf counts CRLF and a lone CR as one', () => {
        expect(spliceLf('ab', 'a\nb', '\r\n')).toBe('a\r\nb')
        expect(rawIndexOf('a\r\nb', 2)).toBe(3)
        expect(rawIndexOf('a\rb', 2)).toBe(2)
        expect(rawIndexOf('a\r\r\nb', 2)).toBe(2)
        expect(rawIndexOf('a\r\r\nb', 3)).toBe(4)
        expect(rawIndexOf('ab', 5)).toBe(2)
    })

    test('property: the whole text reads back as the requested LF text', () => {
        fc.assert(
            fc.property(mixedTextArb, fc.nat(), fc.nat(), fc.constantFrom('x', '\n', 'y\nz', '', '\n\n'), (raw, rawA, rawB, insert) => {
                const cur = lf(raw)
                const a = rawA % (cur.length + 1)
                const b = a + (rawB % (cur.length - a + 1))
                const nextLf = cur.slice(0, a) + insert + cur.slice(b)
                expect(lf(spliceLf(raw, nextLf, detectEol(raw)))).toBe(nextLf)
            }),
            { seed: SEED, numRuns: 3000 },
        )
    })
})

describe('C-U5 terminators', () => {
    test('an empty followed body typed x gets one eol', () => {
        const lfText = '<START>\n<START>\nB'
        expect(writeCardText(lfText, cardSpans(lfText, null), 0, 'x')).toBe('<START>\nx\n<START>\nB')
        const crlfText = '<START>\r\n<START>\r\nB'
        expect(writeCardText(crlfText, cardSpans(crlfText, null), 0, 'x')).toBe('<START>\r\nx\r\n<START>\r\nB')
    })

    test('an emptied followed body keeps its terminator', () => {
        const text = '<START>\nA\n<START>\nB'
        expect(writeCardText(text, cardSpans(text, null), 0, '')).toBe('<START>\n\n<START>\nB')
        const crlf = '<START>\r\nA\r\n<START>\r\nB'
        expect(writeCardText(crlf, cardSpans(crlf, null), 0, '')).toBe('<START>\r\n\r\n<START>\r\nB')
    })

    test('the last card stays raw: no terminator is added or removed', () => {
        const text = '<START>\nA\n'
        const spans = cardSpans(text, null)
        expect(cardText(text, spans, 0)).toBe('A\n')
        expect(writeCardText(text, spans, 0, 'A\nB')).toBe('<START>\nA\nB')
        expect(writeCardText('<START>\nA', cardSpans('<START>\nA', null), 0, 'AB')).toBe('<START>\nAB')
    })

    test('a followed card text drops exactly one terminator', () => {
        expect(cardsOf('<START>\nA\n\n<START>\nB')).toEqual(['A\n', 'B'])
        expect(cardsOf('<START>\r\nA\r\n\r\n<START>\r\nB')).toEqual(['A\r\n', 'B'])
    })
})

describe('C-U6 a held marker line is body text', () => {
    const text = 'A\n<START>\nB'
    const hold: Hold = { start: 2, end: 9 }

    test('held at the marker is one card, no hold is two', () => {
        expect(cardsOf(text, hold)).toEqual(['A\n<START>\nB'])
        expect(cardsOf(text, null)).toEqual(['A', 'B'])
    })

    test('a hold away from a marker line changes nothing', () => {
        expect(cardsOf(text, { start: 0, end: 1 })).toEqual(['A', 'B'])
    })

    test('a write splices the merged range', () => {
        const spans = cardSpans(text, hold)
        expect(writeCardText(text, spans, 0, 'A\n<START>\nBC')).toBe('A\n<START>\nBC')
        expect(writeCardText(text, spans, 0, 'X\n<START>\nB')).toBe('X\n<START>\nB')
    })

    test('a hold covers one marker line only; a later marker still splits', () => {
        const two = '<START>\nA\n<START>\nB\n<START>\nC'
        const held = two.lastIndexOf('<START>')
        expect(cardsOf(two, { start: held, end: held + 7 })).toEqual(['A', 'B\n<START>\nC'])
    })
})

describe('C-U7 locateCaret', () => {
    const text = 'o\n<START>\nAB\n<START>\nC'
    const spans = cardSpans(text, null)

    test('a caret on a marker line goes to that block at 0', () => {
        expect(locateCaret(text, spans, 2)).toEqual({ card: 1, offsetLf: 0 })
        expect(locateCaret(text, spans, 6)).toEqual({ card: 1, offsetLf: 0 })
        expect(locateCaret(text, spans, 14)).toEqual({ card: 2, offsetLf: 0 })
    })

    test('a caret in a body is that card at its LF offset', () => {
        expect(locateCaret(text, spans, 0)).toEqual({ card: 0, offsetLf: 0 })
        expect(locateCaret(text, spans, 1)).toEqual({ card: 0, offsetLf: 1 })
        expect(locateCaret(text, spans, 10)).toEqual({ card: 1, offsetLf: 0 })
        expect(locateCaret(text, spans, 12)).toEqual({ card: 1, offsetLf: 2 })
        expect(locateCaret(text, spans, text.length)).toEqual({ card: 2, offsetLf: 1 })
    })

    test('CRLF bodies count one per line ending', () => {
        const crlf = '<START>\r\nA\r\nB\r\n<START>\r\nC'
        expect(locateCaret(crlf, cardSpans(crlf, null), 12)).toEqual({ card: 0, offsetLf: 2 })
    })
})

describe('C-U8 structural ops', () => {
    const v2Blocks = V2_CRLF_EXAMPLE.split('<START>\r\n').filter((part) => part !== '').map((part) => '<START>\r\n' + part)

    test('V2 CRLF text: two cards; add, delete and move keep untouched parts', () => {
        expect(cardsOf(V2_CRLF_EXAMPLE)).toHaveLength(2)
        expect(addBlock(V2_CRLF_EXAMPLE)).toBe(V2_CRLF_EXAMPLE + '<START>\r\n')
        expect(deleteCard(V2_CRLF_EXAMPLE, 0)).toBe(v2Blocks[1])
        expect(deleteCard(V2_CRLF_EXAMPLE, 1)).toBe(v2Blocks[0])
        expect(moveBlock(V2_CRLF_EXAMPLE, 0, 1)).toBe(v2Blocks[1] + v2Blocks[0])
        expect(moveBlock(V2_CRLF_EXAMPLE, 1, 0)).toBe(v2Blocks[1] + v2Blocks[0])
        expect(moveBlock(V2_CRLF_EXAMPLE, 0, 0)).toBe(V2_CRLF_EXAMPLE)
    })

    test('byaf text: moving the unterminated last block adds one eol', () => {
        const text = byafExampleText(['a', 'b'])
        expect(text).toBe('<START>\na\n<START>\nb')
        expect(moveBlock(text, 1, 0)).toBe('<START>\nb\n<START>\na\n')
        expect(moveBlock(text, 0, 1)).toBe('<START>\nb\n<START>\na\n')
        expect(addBlock(text)).toBe('<START>\na\n<START>\nb\n<START>\n')
        expect(deleteCard(text, 1)).toBe('<START>\na\n')
        expect(deleteCard(text, 0)).toBe('<START>\nb')
    })

    test('the opening: delete removes it, mark prepends a marker, move never touches it', () => {
        const text = 'op\n<START>\nx\n<START>\ny'
        expect(cardsOf(text)).toEqual(['op', 'x', 'y'])
        expect(deleteCard(text, 0)).toBe('<START>\nx\n<START>\ny')
        expect(markOpening(text)).toBe('<START>\nop\n<START>\nx\n<START>\ny')
        expect(moveBlock(text, 0, 1)).toBe(text)
        expect(moveBlock(text, 1, 0)).toBe(text)
        expect(moveBlock(text, 1, 2)).toBe('op\n<START>\ny\n<START>\nx\n')
        expect(markOpening('a\r\nb\r\n')).toBe('<START>\r\na\r\nb\r\n')
    })

    test('add on empty and on terminated texts', () => {
        expect(addBlock('')).toBe('<START>\n')
        expect(addBlock('x')).toBe('x\n<START>\n')
        expect(addBlock('x\r\n')).toBe('x\r\n<START>\r\n')
    })

    test('out-of-range indexes change nothing', () => {
        const text = '<START>\nA\n<START>\nB'
        expect(deleteCard(text, 5)).toBe(text)
        expect(moveBlock(text, 0, 7)).toBe(text)
        expect(moveBlock(text, -1, 0)).toBe(text)
    })
})

describe('C-U9 text typed after an unterminated marker lands in the new card', () => {
    test('literals', () => {
        const t1 = '<START>\nA\n<START>'
        expect(writeCardText(t1, cardSpans(t1, null), 1, 'x')).toBe('<START>\nA\n<START>\nx')
        const t2 = '  <Start>  '
        expect(writeCardText(t2, cardSpans(t2, null), 0, 'x')).toBe('  <Start>  \nx')
        const t3 = '<START>\r\nA\r\n<START>'
        expect(writeCardText(t3, cardSpans(t3, null), 1, 'x')).toBe('<START>\r\nA\r\n<START>\r\nx')
    })

    test('the typed-marker sequence ends with the cards A and x', () => {
        let text = '<START>\nA'
        text = writeCardText(text, cardSpans(text, null), 0, 'A\n<START>')
        expect(text).toBe('<START>\nA\n<START>')
        text = writeCardText(text, cardSpans(text, null), 1, 'x')
        expect(cardsOf(text)).toEqual(['A', 'x'])
    })

    test('nothing typed leaves the unterminated marker alone', () => {
        const t = '<START>\nA\n<START>'
        expect(writeCardText(t, cardSpans(t, null), 1, '')).toBe(t)
    })
})

describe('C-U10 splitChanged', () => {
    test.each([
        ['x after a marker', '<START>\nA', '<START>x\nA', true],
        ['Enter after a marker', '<START>\nA', '<START>\n\nA', false],
        ['completing <START>', 'A\n<START', 'A\n<START>', true],
        ['a newline before a marker', 'A\n<START>\nB', 'A\n\n<START>\nB', false],
        ['a paste that removes one marker and adds one', 'a\n<START>\nb\nc', 'a\nb\n<START>\nc', true],
        ['plain typing', '<START>\nA', '<START>\nAB', false],
        ['delete a whole marker line', 'A\n<START>\nB', 'A\nB', true],
        ['overtype a marker line', 'A\n<START>\nB', 'A\nx\nB', true],
        ['delete the first of two blocks', '<START>\nx\n<START>\nB', '<START>\nB', true],
        ['delete the second of two adjacent markers', '<START>\n<START>', '<START>', true],
        ['CRLF: delete a whole marker line', 'A\r\n<START>\r\nB', 'A\r\nB', true],
        ['no change', 'A\n<START>\nB', 'A\n<START>\nB', false],
    ] as const)('%s', (_name, prev, next, expected) => {
        expect(splitChanged(prev, next)).toBe(expected)
    })
})

describe('C-U11 rebaseHold', () => {
    const prev = '<START>\nA\n<START>\nB\n<START>'
    const hold: Hold = { start: prev.lastIndexOf('<START>'), end: prev.length }

    test('an edit before the hold shifts it', () => {
        const next = prev.slice(0, hold.start) + 'k\n' + prev.slice(hold.start)
        expect(rebaseHold(hold, prev, next)).toEqual({ start: hold.start + 2, end: hold.end + 2 })
        expect(rebaseHold(hold, prev, '<START>\nA peer line\n<START>\nB\n<START>')).toEqual({ start: hold.start + 10, end: hold.end + 10 })
    })

    test('an edit after the hold, or an append at its end, keeps it', () => {
        expect(rebaseHold(hold, prev, prev + 'q')).toEqual(hold)
        expect(rebaseHold(hold, prev, prev + '\nmore')).toEqual(hold)
    })

    test('an edit inside the held line clears it', () => {
        expect(rebaseHold(hold, prev, '<START>\nA\n<START>\nB\n<STARTx>')).toBeNull()
    })

    test('an insertion at the start of the held line shifts it', () => {
        const next = prev.slice(0, hold.start) + 'zz' + prev.slice(hold.start)
        expect(rebaseHold(hold, prev, next)).toEqual({ start: hold.start + 2, end: hold.end + 2 })
    })

    test('no hold, or no change, returns the input', () => {
        expect(rebaseHold(null, prev, prev + 'x')).toBeNull()
        expect(rebaseHold(hold, prev, prev)).toBe(hold)
    })
})
