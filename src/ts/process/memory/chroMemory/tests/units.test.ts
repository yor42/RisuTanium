import { describe, expect, test } from 'vitest'
import { UNIT_CHARS, splitRecord } from '../units'

const cp = (s: string): number => Array.from(s).length

describe('splitRecord', () => {
    test('new rule: a text within the limit is one piece at offset 0', () => {
        expect(splitRecord('Hello there. How are you?', 100)).toEqual([{ off: 0, text: 'Hello there. How are you?' }])
        expect(splitRecord('', 100)).toEqual([])
        expect(UNIT_CHARS).toBe(1200)
    })

    test('new rule: paragraphs split on blank lines and offsets index the original text', () => {
        const text = 'First paragraph here.\n\n\nSecond paragraph here.'
        const pieces = splitRecord(text, 1000)
        expect(pieces.map((p) => p.text)).toEqual(['First paragraph here.', 'Second paragraph here.'])
        for (const p of pieces) expect(text.slice(p.off, p.off + p.text.length)).toBe(p.text)
    })

    test('new rule: sentences join greedily up to the limit', () => {
        const text = 'Aaaa aaaa. Bbbb bbbb. Cccc cccc. Dddd dddd.'
        const pieces = splitRecord(text, 22)
        expect(pieces.map((p) => p.text)).toEqual(['Aaaa aaaa. Bbbb bbbb.', 'Cccc cccc. Dddd dddd.'])
        for (const p of pieces) {
            expect(cp(p.text)).toBeLessThanOrEqual(22)
            expect(text.slice(p.off, p.off + p.text.length)).toBe(p.text)
        }
    })

    test('new rule: a piece of exactly the limit is kept whole, one more code point is cut', () => {
        expect(splitRecord('x'.repeat(10), 10).map((p) => p.text.length)).toEqual([10])
        expect(splitRecord('x'.repeat(11), 10).map((p) => p.text.length)).toEqual([10, 1])
    })

    test('new rule: a long sentence of astral characters is hard-cut by code points without splitting a pair', () => {
        const text = '\u{1F600}'.repeat(2500)
        const pieces = splitRecord(text, UNIT_CHARS)
        expect(pieces.map((p) => cp(p.text))).toEqual([1200, 1200, 100])
        for (const p of pieces) {
            expect(text.slice(p.off, p.off + p.text.length)).toBe(p.text)
            expect(p.text).toBe(Array.from(p.text).join(''))
        }
        expect(pieces.map((p) => p.off)).toEqual([0, 2400, 4800])
    })
})
