/**
 * `previewCut`: where a long character note may be cut for a cheap preview.
 * The module is pure, so these tests need no DOM. Each `null` row holds a
 * note that would otherwise be cuttable (it is longer than the minimum and has
 * a blank line followed by a column-0 paragraph), so deleting the one rule it
 * covers makes `previewCut` return a cut and the row fails.
 */
import { describe, expect, test } from 'vitest'
import { PREVIEW_MIN_CHARS, previewCut } from '../descriptionPreview'

const MIN = 200
const FILL = Array.from({ length: 12 }, (_, k) => `Filler sentence ${k} is plain words only.`).join(' ')

/** A note whose only non-plain part is `head`; without it the note cuts at the blank line after the filler. */
function noteWith(head: string): string {
    return `${head}\n\n${FILL}\n\nTail paragraph.`
}

describe('previewCut: notes that keep their full parse', () => {
    test('the plain control note is cuttable', () => {
        expect(previewCut(noteWith('Plain head.'), MIN)).not.toBeNull()
    })

    test('a note not longer than the minimum', () => {
        const short = 'short paragraph\n\nsecond paragraph'
        expect(previewCut(short, MIN)).toBeNull()
        const exact = 'a'.repeat(MIN - 3) + '\n\nb'
        expect(exact.length).toBe(MIN)
        expect(previewCut(exact, MIN)).toBeNull()
    })

    test.each([
        ['raw HTML with a class', '<p class="absolute">fixed</p>'],
        ['a div block', '<div>\nblock\n</div>'],
        ['an HTML comment', '<!-- hidden -->'],
        ['a Thoughts tag', '<Thoughts>inner</Thoughts>'],
        ['an autolink', '<https://e.x>'],
        ['a closing tag', 'text</b>'],
        ['math', '$$x^2$$'],
        ['an inlay token', '{{inlay::asset-id}}'],
        ['a reference definition', '[a]: https://e.x'],
        ['a reference label over two lines', '[a\nb]: https://e.x'],
        ['a parser placeholder character', 'quote \uE9B0 open'],
        ['the last placeholder character', 'quote \uE9C1 close'],
        ['a lone carriage return', 'line one\rline two'],
        ['a column-0 fence with a body', '```js\nconst x = 1\n```'],
        ['an empty-body fence', '```js\n```'],
        ['an empty fence in a blockquote', '> ```js\n> ```'],
        ['an empty fence in a list item', '- ```js\n  ```'],
        ['a fence in a list item with a blank line', '- item\n\n  ```py\n  x = 1\n\n  y = 2\n  ```'],
        ['inline triple backticks', 'use ``` here'],
        ['a four-backtick fence', '````\ntext\n````'],
        ['a tilde fence', '~~~\ncode\n~~~'],
        ['a longer tilde fence', '~~~~\ncode\n~~~~'],
        ['a numeric character reference to a placeholder', '&#xE9B0;'],
        ['a decimal numeric character reference', '&#60;'],
    ])('%s', (_label, head) => {
        expect(previewCut(noteWith(head), MIN)).toBeNull()
    })
})

describe('previewCut: notes that are cut', () => {
    test.each([
        ['a bare less-than', 'a < b and x <3 y'],
        ['strikethrough', '~~strike~~ text'],
        ['inline code', '`code` and ``a`b``'],
        ['named entities', 'fish &amp; chips and &lt;tag&gt;'],
    ])('%s does not block the cut', (_label, head) => {
        const text = noteWith(head)
        expect(previewCut(text, MIN)).toBe(text.indexOf('\n\nTail paragraph.') + 1)
    })

    test('the default minimum is 1000 characters', () => {
        expect(PREVIEW_MIN_CHARS).toBe(1000)
        const body = 'word '.repeat(220)
        const text = `${body}\n\n${body}\n\nTail paragraph.`
        const cut = previewCut(text)
        expect(cut).not.toBeNull()
        expect(cut!).toBeGreaterThanOrEqual(PREVIEW_MIN_CHARS)
        expect(previewCut('x'.repeat(PREVIEW_MIN_CHARS - 2) + '\n\ny')).toBeNull()
    })

    test('the cut is the start of the blank line, never before the minimum', () => {
        const text = noteWith('Plain head.')
        const cut = previewCut(text, MIN)!
        expect(cut).toBeGreaterThanOrEqual(MIN)
        expect(text.slice(cut - 1, cut + 1)).toBe('\n\n')
        expect(text.slice(0, cut)).toBe(`Plain head.\n\n${FILL}\n`)
    })

    test('a blank line before the minimum is skipped', () => {
        const text = `${'early '.repeat(10)}\n\n${FILL}\n\nTail paragraph.`
        const cut = previewCut(text, MIN)!
        expect(cut).toBeGreaterThanOrEqual(MIN)
        expect(cut).toBe(text.indexOf('\n\nTail paragraph.') + 1)
    })

    test('CRLF notes cut at the start of the blank line', () => {
        const text = noteWith('Plain head.').replace(/\n/g, '\r\n')
        const cut = previewCut(text, MIN)!
        expect(cut).toBeGreaterThanOrEqual(MIN)
        expect(text.slice(cut)).toBe('\r\nTail paragraph.')
        expect(text.slice(0, cut).endsWith('\r\n')).toBe(true)
    })

    test('a blank line holding spaces or tabs is blank', () => {
        const text = `${FILL}\n \t \nTail paragraph.`
        expect(previewCut(text, MIN)).toBe(FILL.length + 1)
    })
})

describe('previewCut: blank lines that are not cut points', () => {
    const tail = '\n\nLast paragraph.'

    test('a following list marker keeps the list open', () => {
        const text = `${FILL}\n\n- item${tail}`
        expect(previewCut(text, MIN)).toBe(text.indexOf(tail) + 1)
        const numbered = `${FILL}\n\n12. item${tail}`
        expect(previewCut(numbered, MIN)).toBe(numbered.indexOf(tail) + 1)
        const star = `${FILL}\n\n* item\n\n+ item${tail}`
        expect(previewCut(star, MIN)).toBe(star.indexOf(tail) + 1)
    })

    test('a hyphen without a following space is not a list marker', () => {
        const text = `${FILL}\n\n-word follows`
        expect(previewCut(text, MIN)).toBe(FILL.length + 1)
    })

    test('an indented continuation keeps the item open', () => {
        const text = `${FILL}\n\n  continued paragraph${tail}`
        expect(previewCut(text, MIN)).toBe(text.indexOf(tail) + 1)
        const tabbed = `${FILL}\n\n\ttabbed paragraph${tail}`
        expect(previewCut(tabbed, MIN)).toBe(tabbed.indexOf(tail) + 1)
    })

    test('an ideographic space or a no-break space is text, not a blank line', () => {
        const ideographic = `${FILL}\n　\nmore text${tail}`
        expect(previewCut(ideographic, MIN)).toBe(ideographic.indexOf(tail) + 1)
        const noBreak = `${FILL}\n \nmore text${tail}`
        expect(previewCut(noBreak, MIN)).toBe(noBreak.indexOf(tail) + 1)
    })

    test('a note that ends in blank lines has no cut', () => {
        expect(previewCut(`${FILL}\n\n\n`, MIN)).toBeNull()
        expect(previewCut(`${FILL}\n\n- last item\n\n`, MIN)).toBeNull()
    })

    test('several blank lines are one gap', () => {
        const text = `${FILL}\n\n\n\nNext paragraph.`
        expect(previewCut(text, MIN)).toBe(FILL.length + 1)
    })
})
