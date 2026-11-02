/**
 * `fullWordIncludes`: the key must be bounded at both ends by a text edge or a
 * non-word character, tried at every occurrence, with whole code points read
 * on both sides. The word class is injected, so these tests pin the default
 * `UNICODE_WORD` class and a narrower one.
 *
 * All tests are guards on a new module: a missing export fails them for the
 * wrong reason and does not count as a reproducer. The reproducers for the
 * defect are in lorebookKeyMatching.svelte.test.ts.
 */
import { describe, expect, test } from 'vitest'
import { ASCII_WORD, fullWordIncludes, UNICODE_WORD } from '../lorebookWordMatch'

const includes = (text: string, key: string) => fullWordIncludes(text, key, UNICODE_WORD)

describe('fullWordIncludes', () => {
    test('guard: the text edges are boundaries', () => {
        expect(includes('alice', 'alice')).toBe(true)
        expect(includes('alice waves', 'alice')).toBe(true)
        expect(includes('hi alice', 'alice')).toBe(true)
    })

    test('guard: punctuation, whitespace and quotes are boundaries', () => {
        expect(includes('alice, bob', 'alice')).toBe(true)
        expect(includes('a\talice\n', 'alice')).toBe(true)
        expect(includes('"alice"', 'alice')).toBe(true)
        expect(includes('e-mail', 'mail')).toBe(true)
        expect(includes('alice\'s', 'alice')).toBe(true)
        expect(includes('爱丽丝，你好', '爱丽丝')).toBe(true)
    })

    test('guard: a letter, digit, mark or underscore on either side rejects', () => {
        expect(includes('cats', 'cat')).toBe(false)
        expect(includes('concat', 'cat')).toBe(false)
        expect(includes('v20', 'v2')).toBe(false)
        expect(includes('alice_bob', 'alice')).toBe(false)
        expect(includes('앨리스는', '앨리스')).toBe(false)
        expect(includes('écat', 'cat')).toBe(false)
    })

    test('guard: a later occurrence is accepted after an earlier one is rejected', () => {
        expect(includes('scattered cat', 'cat')).toBe(true)
        expect(includes('cats concat cat.', 'cat')).toBe(true)
    })

    test('guard: an overlapping occurrence is found after a rejected hit', () => {
        expect(includes('xa-a-a', 'a-a')).toBe(true)
        expect(includes('xa-a-ax', 'a-a')).toBe(false)
    })

    test('guard: an astral letter beside the key is read as one code point', () => {
        expect(includes('\u{1D400}a', 'a')).toBe(false)
        expect(includes('a\u{1D400}', 'a')).toBe(false)
        expect(includes('\u{1F600}a', 'a')).toBe(true)
    })

    test('guard: a phrase key matches literally with boundaries at its two ends', () => {
        expect(includes('a red dragon.', 'red dragon')).toBe(true)
        expect(includes('a red dragonfly', 'red dragon')).toBe(false)
        expect(includes('a scared dragon', 'red dragon')).toBe(false)
        expect(includes('red  dragon', 'red dragon')).toBe(false)
        expect(includes('red\ndragon', 'red dragon')).toBe(false)
    })

    test('guard: regex metacharacters in the key are literal', () => {
        expect(includes('a (b) c', '(b)')).toBe(true)
        expect(includes('a b', 'a.b')).toBe(false)
    })

    test('guard: an empty key never matches', () => {
        expect(includes('a b', '')).toBe(false)
    })

    test('guard: the injected class decides what a boundary is', () => {
        expect(fullWordIncludes('앨리스는', '앨리스', ASCII_WORD)).toBe(true)
        expect(fullWordIncludes('cats', 'cat', ASCII_WORD)).toBe(false)
    })

    test('guard: ASCII_WORD is exactly English letters, digits and underscore', () => {
        for (const word of ['a', 'Z', '0', '9', '_']) {
            expect(ASCII_WORD.test(word)).toBe(true)
        }
        for (const boundary of ['앨', 'é', '爱', '٣', '-', ' ', '́']) {
            expect(ASCII_WORD.test(boundary)).toBe(false)
        }
        expect(fullWordIncludes('v20', 'v2', ASCII_WORD)).toBe(false)
        expect(fullWordIncludes('alice_bob', 'alice', ASCII_WORD)).toBe(false)
        expect(fullWordIncludes('a café', 'caf', ASCII_WORD)).toBe(true)
    })
})
