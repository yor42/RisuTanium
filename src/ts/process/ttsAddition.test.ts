// @vitest-environment happy-dom

/**
 * `ttsAddition` (`./ttsAddition`) and `filterTTSText` (`./tts`) on strings alone.
 *
 * Invariants pinned here:
 *  - what is spoken is the part of the filtered, thought-free display text
 *    that a run added: a fresh reply is spoken whole, a continuation only
 *    speaks its addition, and when earlier text changed speech starts at the
 *    first difference;
 *  - the cut never splits a surrogate pair, a flag or a ZWJ sequence;
 *  - with read-only-quoted speech a quote opened before the boundary and
 *    closed in the addition is spoken whole, and a quote already heard is not
 *    spoken again;
 *  - text the run did not add (a shorter result, an unchanged result) is not
 *    spoken, and `<Thoughts>` blocks are never spoken unless the message is
 *    only thinking.
 *
 * The heavy modules `./tts` imports are fakes; only its pure text filter runs.
 */

import { describe, expect, test, vi } from 'vitest'

vi.mock(import('../alert'), () => ({ alertError: vi.fn() }) as unknown as typeof import('../alert'))
vi.mock(import('../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(() => null),
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('../storage/database.svelte'))
vi.mock(import('../translator/translator'), () => ({
    runTranslator: vi.fn(),
    translateVox: vi.fn(),
}) as unknown as typeof import('../translator/translator'))
vi.mock(import('../globalApi.svelte'), () => ({
    globalFetch: vi.fn(),
    loadAsset: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))
vi.mock(import('./transformers'), () => ({ runVITS: vi.fn() }) as unknown as typeof import('./transformers'))

import { ttsAddition } from './ttsAddition'
import { filterTTSText } from './tts'

const identity = (stored: string) => stored

function hasLoneSurrogate(text: string): boolean {
    return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)
}

describe('filterTTSText', () => {
    test('new behaviour: asterisks are removed', () => {
        expect(filterTTSText('a *b* c', false)).toBe('a b c')
    })

    test('new behaviour: read-only-quoted keeps only the quoted spans, joined, and ordinary and corner quotes both count', () => {
        expect(filterTTSText('He said "Hi" and 「Bye」 ok', true)).toBe('HiBye')
    })

    test('new behaviour: read-only-quoted text without a quote becomes empty, so the filter is not idempotent', () => {
        expect(filterTTSText('No quotes here', true)).toBe('')
        expect(filterTTSText(filterTTSText('He said "Hi"', true), true)).toBe('')
    })
})

describe('ttsAddition of a reply', () => {
    test('new behaviour: a fresh reply is spoken whole', () => {
        expect(ttsAddition('', 'Hello world.', identity, false)).toBe('Hello world.')
    })

    test('new behaviour: parse is applied to the earlier and the later text, once each, in that order', () => {
        const parse = vi.fn(identity)

        ttsAddition('before', 'after', parse, false)

        expect(parse.mock.calls.map((call) => call[0])).toEqual(['after', 'before'])
    })

    test('new behaviour: asterisks are left out of what is spoken', () => {
        expect(ttsAddition('', 'a *b* c', identity, false)).toBe('a b c')
    })

    test('new behaviour: parsed text that is empty speaks nothing', () => {
        expect(ttsAddition('', '{{none}}', () => '', false)).toBe('')
    })

    test('new behaviour: the stored text is parsed, so a parsed name is what is spoken', () => {
        expect(ttsAddition('', 'Hi {{user}}', (stored) => stored.replace('{{user}}', 'Ann'), false)).toBe('Hi Ann')
    })
})

describe('ttsAddition of a continuation', () => {
    test('new behaviour: each continuation speaks only what it added', () => {
        const part1 = 'Part one.'
        const part2 = `${part1} Part two.`
        const part3 = `${part2} Part three.`

        expect(ttsAddition('', part1, identity, false)).toBe('Part one.')
        expect(ttsAddition(part1, part2, identity, false)).toBe(' Part two.')
        expect(ttsAddition(part2, part3, identity, false)).toBe(' Part three.')
    })

    test('new behaviour: a normal reply after a continue is spoken whole', () => {
        expect(ttsAddition('', 'A fresh reply.', identity, false)).toBe('A fresh reply.')
    })

    test('new behaviour: a run that adds nothing speaks nothing', () => {
        expect(ttsAddition('Same.', 'Same.', identity, false)).toBe('')
    })

    test('new behaviour: a later text shorter than the earlier one speaks nothing', () => {
        expect(ttsAddition('Hello world', 'Hello', identity, false)).toBe('')
        expect(ttsAddition('Hello world  ', 'Hello world', identity, false)).toBe('')
    })

    test('new behaviour: earlier text that was rewritten is spoken from the first difference', () => {
        expect(ttsAddition('Hello brave world', 'Hello kind world and more', identity, false)).toBe('kind world and more')
    })
})

describe('ttsAddition with thinking sections', () => {
    test('new behaviour: a thinking section opened earlier and closed in the addition is not spoken', () => {
        expect(ttsAddition('<Thoughts>abc', '<Thoughts>abc more</Thoughts>Answer', identity, false)).toBe('Answer')
    })

    test('new behaviour: a closed thinking section is not spoken', () => {
        expect(ttsAddition('', 'Plan.\n\n<Thoughts>private</Thoughts>\n\nAnswer.', identity, false)).toBe('Plan.\n\nAnswer.')
    })

    test('new behaviour: a thinking-only message is spoken whole', () => {
        expect(ttsAddition('', '<Thoughts>only thinking</Thoughts>', identity, false)).toBe('<Thoughts>only thinking</Thoughts>')
    })

    test('new behaviour: thinking-only text followed by visible text speaks the visible text', () => {
        expect(ttsAddition('<Thoughts>x</Thoughts>', '<Thoughts>x</Thoughts>Visible.', identity, false)).toBe('Visible.')
    })
})

describe('ttsAddition at a grapheme boundary', () => {
    test('new behaviour: a surrogate pair split by the shared prefix is spoken whole', () => {
        const spoken = ttsAddition('Hi \u{1F600}', 'Hi \u{1F601} there', identity, false)

        expect(spoken).toBe('\u{1F601} there')
        expect(hasLoneSurrogate(spoken)).toBe(false)
    })

    test('new behaviour: a flag that shares its first regional indicator is spoken whole', () => {
        const spoken = ttsAddition('Go \u{1F1FA}\u{1F1F8}', 'Go \u{1F1FA}\u{1F1E6} now', identity, false)

        expect(spoken).toBe('\u{1F1FA}\u{1F1E6} now')
    })

    test('new behaviour: a ZWJ sequence that differs only at its end is spoken whole', () => {
        const family = (child: string) => `\u{1F468}‍\u{1F469}‍${child}`

        const spoken = ttsAddition(`Hi ${family('\u{1F467}')}`, `Hi ${family('\u{1F466}')}`, identity, false)

        expect(spoken).toBe(family('\u{1F466}'))
    })

    test('new behaviour: without Intl.Segmenter a surrogate pair is still not split', () => {
        const original = Intl.Segmenter
        Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true })
        try {
            const spoken = ttsAddition('Hi \u{1F600}', 'Hi \u{1F601} there', identity, false)

            expect(spoken).toBe('\u{1F601} there')
            expect(hasLoneSurrogate(spoken)).toBe(false)
        } finally {
            Object.defineProperty(Intl, 'Segmenter', { value: original, configurable: true, writable: true })
        }
    })
})

describe('ttsAddition with read-only-quoted speech', () => {
    test('new behaviour: a quote opened before the boundary and closed in the addition is spoken whole', () => {
        expect(ttsAddition('She said "Hello', 'She said "Hello there." He left.', identity, true)).toBe('Hello there.')
    })

    test('new behaviour: a quote that was already heard is not spoken again', () => {
        expect(ttsAddition('"Hi" he said', '"Hi" he said. "Bye" she said', identity, true)).toBe('Bye')
    })

    test('new behaviour: an addition with no quote speaks nothing', () => {
        expect(ttsAddition('"Hi" he said', '"Hi" he said. Then he left.', identity, true)).toBe('')
    })
})
