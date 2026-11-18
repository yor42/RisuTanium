/**
 * `createWordStartIncludes` and `defaultWordBoundaries` are tested with an injected segmenter, so the
 * dictionary-dependent rules do not rest on one runtime's ICU data.
 *
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
import { ASCII_WORD, createWordStartIncludes, defaultWordBoundaries, fullWordIncludes, UNICODE_WORD, type WordBoundaries } from '../lorebookWordMatch'

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

/** A segmenter whose word starts are exactly `starts`; `containing` returns the start of the segment holding the index. */
function fakeBoundaries(starts: number[], onSegment: () => void = () => {}): WordBoundaries {
    return {
        segment: () => {
            onSegment()
            return {
                containing: (index: number) => {
                    const before = starts.filter((start) => start <= index)
                    return before.length === 0 ? undefined : { index: Math.max(...before) }
                },
            }
        },
    }
}

const stripSpaces = (text: string) => text.replace(/ /g, '')

describe('createWordStartIncludes', () => {
    const withStarts = (...starts: number[]) => createWordStartIncludes(() => fakeBoundaries(starts))
    const everyIndex = createWordStartIncludes(() => ({
        segment: () => ({ containing: (index: number) => ({ index }) }),
    }))

    test('guard (new seam): a Hangul key never consults the segmenter', () => {
        expect(everyIndex('앨리스', '리스')).toBe(false)
        const throwing = createWordStartIncludes(() => { throw new Error('segmenter consulted') })
        expect(throwing('앨리스는', '리스')).toBe(false)
        expect(throwing('앨리스는', '앨리스')).toBe(true)
    })

    test('guard (new seam): a Han or Kana key follows the reported boundaries exactly', () => {
        const text = '我喜欢爱丽丝'
        expect(withStarts(0, 1, 3)(text, '爱丽丝')).toBe(true)
        expect(withStarts(0)(text, '爱丽丝')).toBe(false)
        expect(withStarts(0, 1, 3)(text, '丽丝')).toBe(false)
    })

    test('guard (new seam): without a segmenter a Han or Kana key needs a text edge or a non-word character before it', () => {
        const none = createWordStartIncludes(() => null)
        expect(none('我喜欢爱丽丝', '爱丽丝')).toBe(false)
        expect(none('我喜欢，爱丽丝', '爱丽丝')).toBe(true)
        expect(none('爱丽丝来了', '爱丽丝')).toBe(true)
    })

    test('guard (new seam): a preceding astral code point is read whole', () => {
        const text = '𠮷野家'
        expect(withStarts(0)(text, '野家')).toBe(false)
        expect(withStarts(0, 2)(text, '野家')).toBe(true)
        const throwing = createWordStartIncludes(() => { throw new Error('segmenter consulted') })
        expect(throwing('😀野家', '野家')).toBe(true)
    })

    test('guard (new seam): the key class is its first code point, and jamo count as Hangul', () => {
        expect(everyIndex('ㅎㅋㅋ', 'ㅋㅋ')).toBe(false)
        expect(everyIndex('x「앨리스', '「앨리스')).toBe(true)
        expect(everyIndex('アー', 'ー')).toBe(true)
        expect(everyIndex('av리스', 'v리스')).toBe(true)
        expect(everyIndex('concatenate', 'cat')).toBe(true)
    })

    test('guard (new seam): the segmenter is created and used lazily, once per text', () => {
        let created = 0
        let segmented = 0
        const matcher = createWordStartIncludes(() => {
            created++
            return fakeBoundaries([0, 3], () => { segmented++ })
        })
        matcher('我喜欢爱丽丝', '없는키')
        matcher('我喜欢，爱丽丝', '爱丽丝')
        matcher('앨리스는', '리스')
        expect([created, segmented]).toEqual([0, 0])
        for (let i = 0; i < 10; i++) {
            matcher('我喜欢爱丽丝', '丽丝')
        }
        expect(segmented).toBe(1)
        expect(created).toBe(1)
    })

    test('guard (new seam): spaces in the text count as a boundary and are ignored inside the match', () => {
        const matcher = withStarts(0)
        expect(matcher('앨 리스', '리스')).toBe(true)
        expect(matcher('앨리스', '리 스')).toBe(false)
        expect(matcher('앨리스 리델', '리델')).toBe(true)
        expect(matcher('앨리스리델은', '앨리스 리델')).toBe(true)
    })

    test('guard (new seam): every occurrence is tried', () => {
        expect(withStarts(0)('앨리스와 리스', '리스')).toBe(true)
    })

    test('guard (new seam): a match is always a substring match, and non-CJK keys are exactly the substring test', () => {
        const rows: Array<[string, string]> = [
            ['앨리스는 웃었다', '앨리스'], ['앨리스는', '리스'], ['크리스마스', '리스'], ['앨리스 리델', '리델'],
            ['앨리스리델', '리델'], ['앨리스리델은', '앨리스 리델'], ['Alice앨리스', '앨리스'], ['3앨리스', '앨리스'],
            ['私はアリスが好き', 'アリス'], ['私はアリスが好き', 'リス'], ['東京都に', '京'], ['東京都に', '都'],
            ['我喜欢爱丽丝', '爱丽丝'], ['我喜欢爱丽丝', '丽丝'], ['我爱北京', '京'], ['林黛玉来了', '黛玉'],
            ['Aliceアリス', 'アリス'], ['av리스', 'v리스'], ['앨리스a는', '앨리스a'], ['concatenate', 'cat'],
            ['a dragon here', 'dra gon'], ['我喜欢，爱丽丝', '爱丽丝'],
        ]
        for (const matcher of [withStarts(0), withStarts(0, 1, 3, 6), everyIndex, createWordStartIncludes(() => null)]) {
            for (const [text, key] of rows) {
                const hit = matcher(text, key)
                if (hit) {
                    expect(stripSpaces(text).includes(stripSpaces(key))).toBe(true)
                }
                if (!/^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(stripSpaces(key))) {
                    expect(hit).toBe(stripSpaces(text).includes(stripSpaces(key)))
                }
            }
        }
    })
})

describe('defaultWordBoundaries', () => {
    test('guard (new seam): returns a segmenter where one exists and null where it does not or cannot be built', () => {
        expect(defaultWordBoundaries()).not.toBeNull()
        const original = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
        try {
            Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true })
            expect(defaultWordBoundaries()).toBeNull()
            Object.defineProperty(Intl, 'Segmenter', {
                value: function () { throw new RangeError('unsupported') }, configurable: true, writable: true,
            })
            expect(defaultWordBoundaries()).toBeNull()
        }
        finally {
            if (original) {
                Object.defineProperty(Intl, 'Segmenter', original)
            }
        }
    })
})
