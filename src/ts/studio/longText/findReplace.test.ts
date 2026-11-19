import { describe, expect, test } from 'vitest'
import { editBetween } from './highlightSpans'
import { findMatches, mapCaret, MATCH_LIMIT, nearestMatch, replaceAllIn } from './findReplace'

const sensitive = { caseSensitive: true }
const insensitive = { caseSensitive: false }

describe('D-U1 findMatches', () => {
    test('the query is literal: a dot does not match any character, specials and a hyphen do not throw', () => {
        expect(findMatches('abc a.c', 'a.c', sensitive).matches).toEqual([{ start: 4, end: 7 }])
        for (const query of ['.*+?^${}()|[]\\/', 'a-b', '\\', '[', '(', '$$', '/']) {
            expect(() => findMatches(`x ${query} y`, query, sensitive)).not.toThrow()
            expect(findMatches(`x ${query} y`, query, sensitive).matches).toEqual([{ start: 2, end: 2 + query.length }])
        }
        expect(findMatches('a-b a-b', 'a-b', sensitive).matches).toHaveLength(2)
    })

    test('the case option decides whether `A` finds `a`', () => {
        expect(findMatches('aAa', 'a', sensitive).matches.map((m) => m.start)).toEqual([0, 2])
        expect(findMatches('aAa', 'a', insensitive).matches.map((m) => m.start)).toEqual([0, 1, 2])
    })

    test('matches never overlap, and an empty query matches nothing', () => {
        expect(findMatches('aaa', 'aa', sensitive).matches).toEqual([{ start: 0, end: 2 }])
        expect(findMatches('abc', '', sensitive)).toEqual({ matches: [], capped: false })
    })

    test('offsets are UTF-16 offsets into the text: a surrogate pair and Hangul are found where they sit', () => {
        const text = '\u{1F600}x한글x'
        expect(findMatches(text, 'x', sensitive).matches).toEqual([{ start: 2, end: 3 }, { start: 5, end: 6 }])
        expect(findMatches(text, '한글', sensitive).matches).toEqual([{ start: 3, end: 5 }])
        expect(findMatches(text, '\u{1F600}', sensitive).matches).toEqual([{ start: 0, end: 2 }])
    })

    test('more than the limit stops at the limit and says so; exactly the limit does not', () => {
        const exact = findMatches('x'.repeat(MATCH_LIMIT), 'x', sensitive)
        expect(exact.matches).toHaveLength(MATCH_LIMIT)
        expect(exact.capped).toBe(false)
        const over = findMatches('x'.repeat(MATCH_LIMIT + 1), 'x', sensitive)
        expect(over.matches).toHaveLength(MATCH_LIMIT)
        expect(over.capped).toBe(true)
    })
})

describe('D-U2 replaceAllIn', () => {
    test('the replacement is literal: `$&`, `$1` and `$$` stay as typed', () => {
        expect(replaceAllIn('a X b X', 'X', '$&$1$$', sensitive)).toEqual({ text: 'a $&$1$$ b $&$1$$', count: 2 })
    })

    test('no match leaves the text as it was and counts 0; case-insensitive variants all count', () => {
        expect(replaceAllIn('abc', 'z', 'y', sensitive)).toEqual({ text: 'abc', count: 0 })
        expect(replaceAllIn('abc', '', 'y', sensitive)).toEqual({ text: 'abc', count: 0 })
        expect(replaceAllIn('Xx X', 'x', 'y', insensitive)).toEqual({ text: 'yy y', count: 3 })
        expect(replaceAllIn('Xx X', 'x', 'y', sensitive)).toEqual({ text: 'Xy X', count: 1 })
    })

    test('the count is not capped by the match limit', () => {
        const result = replaceAllIn('x'.repeat(MATCH_LIMIT + 5), 'x', 'y', sensitive)
        expect(result.count).toBe(MATCH_LIMIT + 5)
        expect(result.text).toBe('y'.repeat(MATCH_LIMIT + 5))
    })
})

describe('D-U3 mapCaret and nearestMatch', () => {
    test('a caret before the edit stays, after it shifts by the length change, inside it goes to the end of the new text', () => {
        const edit = { start: 4, removed: 3, inserted: 1 }
        expect(mapCaret(0, edit)).toBe(0)
        expect(mapCaret(4, edit)).toBe(4)
        expect(mapCaret(5, edit)).toBe(5)
        expect(mapCaret(7, edit)).toBe(5)
        expect(mapCaret(10, edit)).toBe(8)
    })

    test('mapCaret follows editBetween of a real replacement', () => {
        const before = 'a X b X'
        const after = 'a Y b Y'
        expect(mapCaret(7, editBetween(before, after))).toBe(7)
        expect(mapCaret(0, editBetween(before, after))).toBe(0)
    })

    test('nearestMatch takes the first match from the caret forward or the last one before it, and wraps', () => {
        const matches = [{ start: 2, end: 3 }, { start: 6, end: 7 }, { start: 9, end: 10 }]
        expect(nearestMatch(matches, 0, 1)).toBe(0)
        expect(nearestMatch(matches, 3, 1)).toBe(1)
        expect(nearestMatch(matches, 6, 1)).toBe(1)
        expect(nearestMatch(matches, 10, 1)).toBe(0)
        expect(nearestMatch(matches, 10, -1)).toBe(2)
        expect(nearestMatch(matches, 6, -1)).toBe(0)
        expect(nearestMatch(matches, 2, -1)).toBe(2)
        expect(nearestMatch([], 0, 1)).toBeNull()
        expect(nearestMatch([], 0, -1)).toBeNull()
    })
})
