import { describe, expect, test } from 'vitest'
import { describeOpenTail, openFence, openThoughtsWordCount, renderOpenParagraphSource, splitStreamingText } from './streamingSafe'
import { buildProbes, openSpanStart, type SpanRules } from './streamSpans'
import type { customscript } from '../storage/database.svelte'

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
        ['tilde fence after a paragraph', 'one\n~~~\ntwo', ['one\n'], '~~~\ntwo'],
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

describe('splitStreamingText from a finished prefix', () => {
    const pieces = ['word ', 'more words ', '\n', '\n\n', '- item', '# Title', '1. one', '> quote', '```js\n', '```\n', '~~~\n', '~~~ts\n', '~~~~\n', '<Thoughts>', '</Thoughts>', '<style>', '.a{color:red}', '</style>', '{{user', '}}', '<div cla', '>', 'p{color:red']

    function generated(count: number): string[] {
        let seed = 91
        const next = (limit: number) => { seed = (seed * 48271) % 2147483647; return seed % limit }
        return Array.from({ length: count }, () => Array.from({ length: 3 + next(40) }, () => pieces[next(pieces.length)]).join(''))
    }

    test('starting at the end of any finished block equals the tail of the full split', () => {
        for (const text of generated(300)) {
            const full = splitStreamingText(text)
            let offset = 0
            for (let k = 0; k <= full.finished.length; k++) {
                const tail = splitStreamingText(text, offset)
                expect(tail.finished).toEqual(full.finished.slice(k))
                expect(tail.open).toBe(full.open)
                offset += full.finished[k]?.length ?? 0
            }
        }
    })

    test('a stream split only from its growing finished prefix equals the full split at every step', () => {
        for (const text of generated(60)) {
            let finished: string[] = []
            for (let end = 1; end <= text.length; end += 3) {
                const source = text.slice(0, end)
                const prefix = finished.join('')
                const tail = splitStreamingText(source, prefix.length)
                finished = [...finished, ...tail.finished]
                const full = splitStreamingText(source)
                expect({ finished, open: tail.open }).toEqual(full)
            }
        }
    })

    test('an index outside the text is a full split', () => {
        const text = 'one\n\ntwo\n\nthree'
        expect(splitStreamingText(text, 999)).toEqual(splitStreamingText(text))
        expect(splitStreamingText(text, -4)).toEqual(splitStreamingText(text))
    })
})

describe('fence grammar and scene break in the splitter', () => {
    test.each([
        ['T-SP-1 a tilde fence holds across a blank line', '~~~\ncode\n\nmore', [], '~~~\ncode\n\nmore'],
        ['T-SP-2 a trailing lone tilde line is held until the next line is known', 'one\n\n~~~\n', ['one\n\n'], '~~~\n'],
        ['T-SP-2b a lone tilde line with no newline is held', 'one\n\n~~~', ['one\n\n'], '~~~'],
        ['T-SP-3 a lone tilde line before a blank line is a finished scene break', 'one\n\n~~~\n\ntwo', ['one\n\n', '~~~\n\n'], 'two'],
        ['T-SP-3b a whitespace-only next line also makes it a scene break', 'one\n\n~~~\n  \n\ntwo', ['one\n\n', '~~~\n  \n\n'], 'two'],
        ['T-SP-5 a shorter tilde line does not close a longer fence', '~~~~\nx\n~~~\n\nafter', [], '~~~~\nx\n~~~\n\nafter'],
        ['T-SP-5b a longer tilde line closes a shorter fence', '~~~\nx\n~~~~\n\nafter', ['~~~\nx\n~~~~\n\n'], 'after'],
        ['T-SP-6 a tilde fence with an info string closes at its closer', '~~~ts\nx\n~~~\n\nafter', ['~~~ts\nx\n~~~\n\n'], 'after'],
        ['T-SP-6b a tilde fence with an info string holds before its closer', '~~~ts\nx\n\ny', [], '~~~ts\nx\n\ny'],
        ['T-SP-7 a tab-indented line is not a fence opener', '\t```\nx\n\ny', ['\t```\nx\n\n'], 'y'],
        ['T-SP-7b four spaces are not a fence opener either', '    ~~~ts\nx\n\ny', ['    ~~~ts\nx\n\n'], 'y'],
        ['a closer with trailing text does not close', '```\nx\n``` y\n\nz', [], '```\nx\n``` y\n\nz'],
        ['a backtick opener whose info has a backtick is not a fence', '``` a`b\nx\n\ny', ['``` a`b\nx\n\n'], 'y'],
        ['a lone tilde line that closes a fence is never a scene break', '```\nx\n~~~\n```\n\nafter', ['```\nx\n~~~\n```\n\n'], 'after'],
        ['the exception shape finishes divider and text', '~~~\n\ntext\n\n~~~', ['~~~\n\n', 'text\n\n'], '~~~'],
        ['two scene breaks', 'a\n\n~~~\n\nb\n\n~~~\n\nc', ['a\n\n', '~~~\n\n', 'b\n\n', '~~~\n\n'], 'c'],
        ['a scene break directly after a paragraph line', 'Para\n~~~\n\nNext', ['Para\n', '~~~\n\n'], 'Next'],
    ] as const)('%s', (_name, source, finished, open) => {
        expect(splitStreamingText(source)).toEqual({ finished, open })
    })

    test('the open tail drops a tilde fence from its opener line', () => {
        expect(renderOpenParagraphSource('before\n~~~\nconst x')).toBe('before')
        expect(renderOpenParagraphSource('before\n~~~ts\nconst x')).toBe('before')
        expect(renderOpenParagraphSource('before\n```js\nconst x')).toBe('before')
    })

    test('the open tail cuts a trailing lone tilde line that is still pending', () => {
        expect(renderOpenParagraphSource('before\n\n~~~')).toBe('before\n')
        expect(renderOpenParagraphSource('before\n\n~~~\n')).toBe('before\n')
        expect(renderOpenParagraphSource('~~~')).toBe('')
    })

    test('the open tail keeps a scene break and a closed fence', () => {
        expect(renderOpenParagraphSource('~~~\n\ntwo')).toBe('~~~\n\ntwo')
        expect(renderOpenParagraphSource('~~~\nx\n~~~\ntail')).toBe('~~~\nx\n~~~\ntail')
    })

    test('openFence reports the opener, the line count and the raw code', () => {
        expect(openFence('a\n```js\nx\ny')).toEqual({ start: 2, marker: '```', contentLines: 2, raw: 'x\ny', pending: false })
        expect(openFence('a\n~~~\nx\ny\n')).toEqual({ start: 2, marker: '~~~', contentLines: 2, raw: 'x\ny\n', pending: false })
        expect(openFence('~~~ts\n')).toEqual({ start: 0, marker: '~~~', contentLines: 0, raw: '', pending: false })
        expect(openFence('```\nx\n```\nafter')).toBeNull()
        expect(openFence('~~~\n\nx')).toBeNull()
        expect(openFence('plain text')).toBeNull()
    })

    test('openFence reports a pending lone tilde line without calling it a fence', () => {
        expect(openFence('a\n~~~')).toEqual({ start: 2, marker: '', contentLines: 0, raw: '', pending: true })
        expect(openFence('a\n~~~\n')).toEqual({ start: 2, marker: '', contentLines: 0, raw: '', pending: true })
        expect(openFence('a\n~~~\n  ')).toEqual({ start: 2, marker: '', contentLines: 0, raw: '', pending: true })
    })

    test('T-SP-9 a long open tilde fence does not rescan itself at every boundary', () => {
        const original = RegExp.prototype.exec
        function execs(lines: number): number {
            let count = 0
            RegExp.prototype.exec = function (this: RegExp, value: string) {
                count++
                return original.call(this, value)
            }
            try {
                splitStreamingText('~~~\n' + 'code line\n\n'.repeat(lines) + 'tail')
            } finally {
                RegExp.prototype.exec = original
            }
            return count
        }
        const small = execs(200)
        const large = execs(400)
        expect(large).toBeLessThan(3 * small)
    })
})

describe('describeOpenTail chooses one chip by the earliest cut', () => {
    const ST: SpanRules = { probes: [{ lead: '<st>', regex: /<st>[\s\S]*?<\/st>/y, ignoreCase: false }] }

    test('an open CBS block or probe span shows the formatting chip and cuts the source', () => {
        expect(describeOpenTail('Before {{#if 1}}\n\nsecret')).toEqual({ source: 'Before ', chip: { kind: 'formatting' } })
        expect(describeOpenTail('x <st>\n\nsecret', ST)).toEqual({ source: 'x ', chip: { kind: 'formatting' } })
    })

    test('an open Thoughts block shows the thinking chip with its word count', () => {
        expect(describeOpenTail('Before <Thoughts>one two')).toEqual({ source: 'Before ', chip: { kind: 'thinking', words: 2 } })
    })

    test('the earlier cut wins and only one chip exists', () => {
        expect(describeOpenTail('{{#if 1}} a <Thoughts>one two')).toEqual({ source: '', chip: { kind: 'formatting' } })
        expect(describeOpenTail('a <Thoughts>one {{#if 1}} two')).toEqual({ source: 'a ', chip: { kind: 'thinking', words: 4 } })
    })

    test('no open construct gives no chip, and a closed span gives none', () => {
        expect(describeOpenTail('plain text')).toEqual({ source: 'plain text', chip: null })
        expect(describeOpenTail('{{#if 1}}a{{/if}} b')).toEqual({ source: '{{#if 1}}a{{/if}} b', chip: null })
    })

    test('renderOpenParagraphSource and openThoughtsWordCount keep their results for the old inputs', () => {
        expect(renderOpenParagraphSource('before <Thoughts>thinking')).toBe('before ')
        expect(openThoughtsWordCount('<Thoughts>one two\n\nthree')).toBe(3)
    })

    test('an open fence shows the code chip with its content lines and raw text, for backticks and tildes', () => {
        expect(describeOpenTail('before\n```js\nl1\nl2')).toEqual({ source: 'before', chip: { kind: 'code', lines: 2, raw: 'l1\nl2' } })
        expect(describeOpenTail('before\n~~~\nl1')).toEqual({ source: 'before', chip: { kind: 'code', lines: 1, raw: 'l1' } })
        expect(describeOpenTail('before\n~~~ts\n')).toEqual({ source: 'before', chip: { kind: 'code', lines: 0, raw: '' } })
        expect(describeOpenTail('before\n```js\nl1\nl2\n').chip).toEqual({ kind: 'code', lines: 2, raw: 'l1\nl2\n' })
    })

    test('a pending lone tilde line is cut but shows no chip', () => {
        expect(describeOpenTail('before\n\n~~~')).toEqual({ source: 'before\n', chip: null })
    })

    test('an open style tag and open tag-less CSS show the styles chip', () => {
        expect(describeOpenTail('a <style>p{color:red}')).toEqual({ source: 'a ', chip: { kind: 'styles' } })
        expect(describeOpenTail('p{color:red').chip).toEqual({ kind: 'styles' })
        expect(describeOpenTail('p{color:red}\n').chip).toBeNull()
    })

    test('an open image form shows the image chip however long it grows; other macros keep the 64-character release', () => {
        expect(describeOpenTail('Look {{img::cat')).toEqual({ source: 'Look ', chip: { kind: 'image' } })
        expect(describeOpenTail('Look {{inlay::cat').chip).toEqual({ kind: 'image' })
        expect(describeOpenTail('Look {{inlay').chip).toEqual({ kind: 'image' })
        expect(describeOpenTail('Look <img src="data:' + 'a'.repeat(300))).toEqual({ source: 'Look ', chip: { kind: 'image' } })
        expect(describeOpenTail('{{img::' + 'a'.repeat(200))).toEqual({ source: '', chip: { kind: 'image' } })
        expect(describeOpenTail('x {{user').chip).toBeNull()
        expect(describeOpenTail('x {{im').chip).toBeNull()
        expect(describeOpenTail('x <imgx').chip).toBeNull()
        expect(describeOpenTail('{{img::cat}} done').chip).toBeNull()
    })

    test('the earliest cut wins across the new kinds', () => {
        expect(describeOpenTail('a {{img::x\n```js\nl1').chip).toEqual({ kind: 'image' })
        expect(describeOpenTail('a\n```js\nl1 {{img::x').chip).toEqual({ kind: 'code', lines: 1, raw: 'l1 {{img::x' })
        expect(describeOpenTail('a <style>x\n```js\nl1').chip).toEqual({ kind: 'styles' })
    })
})

describe('image forms are exempt from the 64-character macro release', () => {
    test('T-SP-10 an open image form keeps the block held at any length; another macro is released after 64 characters', () => {
        for (const opener of ['{{img::', '{{inlay::', '{{inlay', '{{IMG::']) {
            expect(splitStreamingText('x ' + opener + 'a'.repeat(80) + '\n\nmore').finished).toEqual([])
        }
        expect(splitStreamingText('x {{user' + 'a'.repeat(80) + '\n\nmore').finished).toEqual(['x {{user' + 'a'.repeat(80) + '\n\n'])
        expect(splitStreamingText('x {{img::a}}\n\nmore').finished).toEqual(['x {{img::a}}\n\n'])
    })

    test('T-OT-5 the open tail hides an image form of any length and a long <img tag', () => {
        expect(renderOpenParagraphSource('Look {{img::' + 'a'.repeat(200))).toBe('Look ')
        expect(renderOpenParagraphSource('Look <img src="data:' + 'a'.repeat(300))).toBe('Look ')
    })
})

describe('probe holds stay explained by the open tail', () => {
    const scriptFor = (input: string): customscript => ({ comment: '', in: input, out: 'x', type: 'editdisplay' })

    test('an anchored display script is not probed, so its blocks finish normally', () => {
        const rules: SpanRules = { probes: buildProbes([scriptFor('^<st>[\\s\\S]*?</st>')]) }
        const reply = 'intro\n\n<st>\n\nBody</st>\n\nmore prose here\n\nand more\n\n'
        expect(rules.probes).toEqual([])
        expect(splitStreamingText(reply, 0, rules)).toEqual(splitStreamingText(reply))
        expect(splitStreamingText(reply, 0, rules).finished.join('')).toContain('more prose here')
    })

    test('whenever a probe span is open, the open tail reports the formatting chip', () => {
        const rules: SpanRules = { probes: buildProbes([scriptFor('<st>[\\s\\S]*?</st>')]) }
        expect(rules.probes).toHaveLength(1)
        const pieces = ['word ', 'more words ', '\n\n', '\n', '<st>', '</st>', '<st', 'x', '- item ', '# Title']
        let seed = 7
        const next = (limit: number) => { seed = (seed * 48271) % 2147483647; return seed % limit }
        let holds = 0
        for (let n = 0; n < 400; n++) {
            const text = Array.from({ length: 3 + next(30) }, () => pieces[next(pieces.length)]).join('')
            const split = splitStreamingText(text, 0, rules)
            if (openSpanStart(text, rules) < 0) continue
            holds++
            expect(describeOpenTail(split.open, rules).chip).toEqual({ kind: 'formatting' })
        }
        expect(holds).toBeGreaterThan(20)
    })
})