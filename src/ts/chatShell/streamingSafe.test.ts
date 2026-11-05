import { describe, expect, test } from 'vitest'
import { openThoughtsWordCount, renderOpenParagraphSource, splitStreamingText } from './streamingSafe'

describe('openThoughtsWordCount', () => {
    test.each([
        ['no thoughts', 'plain text', null],
        ['open and empty', 'before <Thoughts>', 0],
        ['open with words', '<Thoughts>one two\n\nthree', 3],
        ['closed', '<Thoughts>one two</Thoughts>\n\nafter', null],
        ['a later block opens again', '<Thoughts>a</Thoughts> text <Thoughts>b c', 2],
    ])('%s', (_label, open, expected) => {
        expect(openThoughtsWordCount(open)).toBe(expected)
    })
})

describe('T13 streaming-safe blocks', () => {
    test.each([
        ['paragraph', 'one\n\ntwo', ['one\n\n'], 'two'],
        ['heading', 'one\n# Title', ['one\n'], '# Title'],
        ['list', 'one\n- item', ['one\n'], '- item'],
        ['numbered list', 'one\n1. item', ['one\n'], '1. item'],
        ['blockquote', 'one\n> quote', ['one\n'], '> quote'],
        ['scene break', 'one\n~~~\ntwo', ['one\n', '~~~\n'], 'two'],
        ['open code fence', '```js\nconst x = 1\n\nmore', [], '```js\nconst x = 1\n\nmore'],
        ['closed code fence', '```js\nx\n```\n\nafter', ['```js\nx\n```\n\n'], 'after'],
        ['open thoughts', '<Thoughts>thinking\n\nmore', [], '<Thoughts>thinking\n\nmore'],
        ['open macro', '{{user\n\nmore', [], '{{user\n\nmore'],
        ['open image macro', '{{img::123\n\nmore', [], '{{img::123\n\nmore'],
        ['partial HTML tag', 'before <div cla\n\nmore', [], 'before <div cla\n\nmore'],
        ['open tag-less CSS', 'p{color:red\n\nmore', [], 'p{color:red\n\nmore'],
        ['closed tag-less CSS', 'p{color:red}\n\nmore', ['p{color:red}\n\n'], 'more'],
        ['interface brace', 'interface X {\n\nmore', ['interface X {\n\n'], 'more'],
        ['lone brace', '{\n\nmore', ['{\n\n'], 'more'],
        ['comparison', 'if x<y\n\nmore', ['if x<y\n\n'], 'more'],
    ] as const)('%s', (_name, source, finished, open) => {
        expect(splitStreamingText(source)).toEqual({ finished, open })
    })

    test('M5: an unclosed style and its CSS never enter the open render source', () => {
        expect(renderOpenParagraphSource('before <style>p{color:red}')).toBe('before ')
        expect(renderOpenParagraphSource('before <style>p{color:red}</style> after')).toBe('before <style>p{color:red}</style> after')
        expect(splitStreamingText('<style>p{color:red}\n\nmore').finished).toEqual([])
    })

    test('incomplete HTML tags and macros stay out of the rendered tail', () => {
        expect(renderOpenParagraphSource('hello <img src=x onerror=')).toBe('hello ')
        expect(renderOpenParagraphSource('hello <')).toBe('hello ')
        expect(renderOpenParagraphSource('if x<y')).toBe('if x<y')
        expect(renderOpenParagraphSource('{{user')).toBe('')
        expect(renderOpenParagraphSource('{{user' + 'x'.repeat(65))).toContain('{{user')
        expect(renderOpenParagraphSource('interface X {')).toBe('interface X {')
        expect(renderOpenParagraphSource('hello *world')).toBe('hello world')
        expect(renderOpenParagraphSource('before <Thoughts>thinking')).toBe('before ')
        expect(renderOpenParagraphSource('before\n```js\nconst x = 1')).toBe('before')
        expect(renderOpenParagraphSource('p{color:red')).toBe('')
    })

    test('finished block rewrites: random growth keeps every finished prefix', () => {
        const corpus = 'First paragraph.\n\n# Heading\nA line\n- item\n> quote\n\n```js\nconst x = 1\n```\n\n<style>p{color:red}</style>\n\nLast.'
        let seed = 173
        let position = 0
        let previous: string[] = []
        while (position < corpus.length) {
            seed = (seed * 48271) % 2147483647
            position = Math.min(corpus.length, position + 1 + seed % 7)
            const current = splitStreamingText(corpus.slice(0, position)).finished
            expect(current.slice(0, previous.length)).toEqual(previous)
            previous = current
        }
    })
})
