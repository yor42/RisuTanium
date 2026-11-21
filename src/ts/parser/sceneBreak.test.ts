import markdownit from 'markdown-it'
import { describe, expect, test } from 'vitest'
import { sceneBreakPlugin } from './sceneBreak'

const options = { html: true, breaks: true, linkify: false, typographer: true }
const md = markdownit(options)
md.disable(['code'])
md.use(sceneBreakPlugin)

const HR = '<hr data-risu-scene-break="">'

describe('sceneBreakPlugin on the app markdown options', () => {
    test.each([
        ['a lone line', '~~~\n\nx', true],
        ['text ends right after it', '~~~', true],
        ['only a newline follows', '~~~\n', true],
        ['four tildes', '~~~~\n\nx', true],
        ['trailing spaces', '~~~   \n\nx', true],
        ['trailing tab', '~~~\t\n\nx', true],
        ['three spaces of indent', '   ~~~\n\nx', true],
        ['a whitespace-only line follows', '~~~\n   \nx', true],
        ['the previous line is a paragraph', 'Para\n~~~\n\nNext', true],
        ['four spaces of indent', '    ~~~\n\nx', false],
        ['a tab of indent', '\t~~~\n\nx', false],
        ['two tildes', '~~\n\nx', false],
        ['an info string', '~~~ts\n\nx', false],
        ['an info string after a space', '~~~ ts\n\nx', false],
        ['text on the next line', '~~~\ncode\n\nmore', false],
        ['a closed fence', '~~~\ncode\n~~~\n\nafter', false],
        ['text on the next line after a paragraph', 'one\n~~~\ntwo', false],
    ])('%s', (_label, source, isBreak) => {
        expect(md.render(source).includes('data-risu-scene-break')).toBe(isBreak)
    })

    test('a break between paragraphs renders one hr and no code block', () => {
        expect(md.render('one\n\n~~~\n\ntwo')).toBe(`<p>one</p>\n${HR}\n<p>two</p>\n`)
    })

    test('the token carries the tildes as markup and a one-line map', () => {
        const hr = md.parse('~~~~\n\nx', {}).find((token) => token.type === 'hr')
        expect(hr?.markup).toBe('~~~~')
        expect(hr?.map).toEqual([0, 1])
        expect(hr?.attrGet('data-risu-scene-break')).toBe('')
    })

    test('a next line that has text keeps the fence even when it is under-indented in a list item', () => {
        const html = md.render('- a\n  ~~~\n- b')
        expect(html).toContain('<pre>')
        expect(html).not.toContain('data-risu-scene-break')
    })

    test('a blank line after the tildes in a list item gives a break inside the item', () => {
        const html = md.render('- a\n  ~~~\n\n- b')
        expect(html).toContain(HR)
        expect(html).not.toContain('<pre>')
    })

    test('a blockquote line followed by an empty quote line gives a break inside the quote', () => {
        expect(md.render('> ~~~\n>\n> x')).toBe(`<blockquote>\n${HR}\n<p>x</p>\n</blockquote>\n`)
    })

    test('two breaks give two dividers, and the exception shape gives divider, text, divider', () => {
        expect(md.render('one\n\n~~~\n\ntwo\n\n~~~\n\nthree').split(HR).length - 1).toBe(2)
        const exception = md.render('~~~\n\ntext\n\n~~~')
        expect(exception).toBe(`${HR}\n<p>text</p>\n${HR}\n`)
    })
})
