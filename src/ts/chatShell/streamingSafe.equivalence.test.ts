import { describe, expect, test } from 'vitest'
import { splitStreamingText, type StreamingSplit } from './streamingSafe'
import type { SpanRules } from './streamSpans'

// Independent whole-block oracle: every block is re-scanned from its first line with no incremental state.
const blockStart = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)/
const cssProperty = /\{\s*(?:--[\w-]+|color|background(?:-color|-image)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|font(?:-[\w-]+)?|border(?:-[\w-]+)?|display|width|height|opacity)\s*:/i

function spaceOnly(line: string): boolean {
    return Array.from(line).every((ch) => ch === ' ' || ch === '\t' || ch === '\r')
}

// The leading marker run of a fence line: at most 3 spaces, then three or more of one fence character.
function fenceLine(line: string): { char: string, run: number, info: string } | null {
    let indent = 0
    while (line[indent] === ' ') indent++
    if (indent > 3) return null
    const char = line[indent]
    if (char !== '`' && char !== '~') return null
    let run = 0
    while (line[indent + run] === char) run++
    if (run < 3) return null
    return { char, run, info: line.slice(indent + run) }
}

// `lines` are the block's lines split on newline; a block always ends with one or two newlines, so the last entry is empty and the
// line before a trailing empty line is followed by a blank line. A block that ends after a single newline ended because the next
// line starts a block construct, so the line before it is followed by text.
function oracleFenceOpen(lines: string[]): boolean {
    let open: { char: string, run: number } | null = null
    for (let k = 0; k < lines.length; k++) {
        const found = fenceLine(lines[k])
        if (open) {
            if (found && found.char === open.char && found.run >= open.run && spaceOnly(found.info)) open = null
            continue
        }
        if (!found) continue
        if (found.char === '`') {
            if (!found.info.includes('`')) open = found
        } else if (!spaceOnly(found.info)) {
            open = found
        } else {
            const following = lines[k + 1]
            const followedByText = following !== undefined && (k + 1 === lines.length - 1 || !spaceOnly(following))
            if (followedByText) open = found
        }
    }
    return open !== null
}

function oracleOpenConstruct(text: string): boolean {
    if (oracleFenceOpen(text.split('\n'))) return true
    const styleOpen = text.search(/<style\b[^>]*>(?![\s\S]*<\/style\s*>)/i)
    if (styleOpen >= 0) return true
    const thoughtsOpen = text.search(/<Thoughts>(?![\s\S]*<\/Thoughts>)/)
    if (thoughtsOpen >= 0) return true
    if (/(?:^|[\s>])<(?:[A-Za-z!/][^>]*|)$/.test(text.trimEnd())) return true
    const macro = text.lastIndexOf('{{')
    const fragment = macro >= 0 ? text.slice(macro).toLowerCase() : ''
    const imageForm = fragment.startsWith('{{img::') || fragment.startsWith('{{inlay')
    if (macro >= 0 && text.indexOf('}}', macro) < 0 && (imageForm || text.length - macro <= 64)) return true
    if (cssProperty.test(text) && text.lastIndexOf('{') > text.lastIndexOf('}')) return true
    return false
}

// Spans as whole-text token matches: CBS openers and complete closers by depth, and (with `probe`) `<st>...</st>` where a
// bare `<st>` with no closer is open to the end of the text.
const CBS_TOKEN = /\{\{#(?:if|if_pure|when|pure|puredisplay|pure_display|code|escape|each|func)(?=[ :}]|$)|\{\{\/(?!\/)[\s\S]*?\}\}/g

function oracleSpans(text: string, probe: boolean): Array<[number, number]> {
    const spans: Array<[number, number]> = []
    let depth = 0
    let opened = 0
    for (const token of text.matchAll(CBS_TOKEN)) {
        if (token[0].startsWith('{{#')) {
            if (depth === 0) opened = token.index
            depth++
        } else if (depth > 0) {
            depth--
            if (depth === 0) spans.push([opened, token.index + token[0].length])
        }
    }
    if (depth > 0) spans.push([opened, Infinity])
    if (probe) {
        for (const token of text.matchAll(/<st>[\s\S]*?<\/st>|<st>/g)) {
            if (token[0].endsWith('</st>')) spans.push([token.index, token.index + token[0].length])
            else {
                spans.push([token.index, Infinity])
                break
            }
        }
    }
    return spans
}

const ST_RULES: SpanRules = { probes: [{ lead: '<st>', regex: /<st>[\s\S]*?<\/st>/y, ignoreCase: false }] }

function oracleSplit(text: string, fromIndex = 0, probe = false): StreamingSplit {
    const finished: string[] = []
    let start = Number.isInteger(fromIndex) && fromIndex > 0 && fromIndex <= text.length ? fromIndex : 0
    const base = start
    const spans = oracleSpans(text.slice(base), probe).map(([q, e]): [number, number] => [q + base, e + base])
    for (let i = start; i < text.length; i++) {
        if (text[i] !== '\n') continue
        const blank = text[i + 1] === '\n'
        const nextLine = text.slice(i + (blank ? 2 : 1))
        const boundary = blank || blockStart.test(nextLine)
        if (!boundary) continue
        const end = i + (blank ? 2 : 1)
        const block = text.slice(start, end)
        if (oracleOpenConstruct(block) || spans.some(([q, e]) => q < end && end < e)) continue
        finished.push(block)
        start = end
        if (blank) i++
    }
    return { finished, open: text.slice(start) }
}

const PIECES = [
    '\n', '\n', '\n\n', 'word ', 'text', '- item', '1. one', '> quote', '# head ',
    '```', '```js', '````', '``', '~~~', '~~~ts', '~~~~', '\n\n~~~\n\n', '   ```', '    ```', '\t```', ' ~~~ ',
    '<Thoughts>', '</Thoughts>', '</Thoughts><Thoughts>', '<Thoughts></Thoughts>', '<Thoughts', '</Thoughts',
    '<style>', '</style>', '</style\n>', '<style type="x">',
    '{{', '}}', '{{user}}', 'p{color:red', '{', '}', 'a{margin:0;}',
    '{{#if 1}}', '{{/if}}', '{{#each a as b}}', '{{/}}', '{{#when::x}}', '{{#iff}}', '{{/', '<st>', '</st>',
    '{{img::', 'a'.repeat(70), '{{inlay::', '{{INLAY',
    '\r\n', '<', '<div', '>', '*', '**',
]

function makeRng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 4294967296
    }
}

function makeText(rng: () => number): string {
    const count = 1 + Math.floor(rng() * 40)
    let out = ''
    for (let n = 0; n < count; n++) out += PIECES[Math.floor(rng() * PIECES.length)]
    return out
}

describe('splitStreamingText equals the whole-block oracle', () => {
    test('G T8 generated texts at every from index, including mid-line and out of range', () => {
        const rng = makeRng(20261108)
        for (let n = 0; n < 1000; n++) {
            const text = makeText(rng)
            for (let from = -1; from <= text.length + 1; from++) {
                expect(splitStreamingText(text, from), JSON.stringify({ text, from })).toEqual(oracleSplit(text, from))
            }
        }
    })

    test('G T8 with a probe rule the split equals the oracle at every from index', () => {
        const rng = makeRng(20261121)
        for (let n = 0; n < 600; n++) {
            const text = makeText(rng)
            for (let from = -1; from <= text.length + 1; from++) {
                expect(splitStreamingText(text, from, ST_RULES), JSON.stringify({ text, from })).toEqual(oracleSplit(text, from, true))
            }
        }
    })

    test('G T8 non-integer from indexes behave like the oracle', () => {
        const text = '```js\ncode\n\nmore\n```\n\n<Thoughts>x\n\ny</Thoughts>\n\nend'
        for (const from of [NaN, 1.5, Infinity, -Infinity]) {
            expect(splitStreamingText(text, from)).toEqual(oracleSplit(text, from))
        }
    })
})

describe('an open construct is not re-scanned at every boundary', () => {
    const FRAMES = [200, 400]

    function countExecs(text: string): number {
        const original = RegExp.prototype.exec
        let count = 0
        RegExp.prototype.exec = function (this: RegExp, value: string) {
            count++
            return original.call(this, value)
        }
        try {
            splitStreamingText(text)
        } finally {
            RegExp.prototype.exec = original
        }
        return count
    }

    function searchedLength(text: string): number {
        const original = String.prototype.search
        let total = 0
        String.prototype.search = function (this: string, searcher: string | RegExp | { [Symbol.search](value: string): number }): number {
            total += this.length
            return original.call(this, searcher as RegExp)
        }
        try {
            splitStreamingText(text)
        } finally {
            String.prototype.search = original
        }
        return total
    }

    test('R T9 inside an open fence, regex executions grow linearly with the line count', () => {
        const [small, large] = FRAMES.map((lines) => countExecs('```js\n' + 'code line\n\n'.repeat(lines) + 'tail'))
        expect(large).toBeLessThan(3 * small)
    })

    test('R T10 inside an open Thoughts block, the block is never searched again at a boundary', () => {
        const [small, large] = FRAMES.map((lines) => searchedLength('<Thoughts>\n' + 'thinking line\n\n'.repeat(lines) + 'tail'))
        expect(large).toBeLessThanOrEqual(3 * small)
    })
})
