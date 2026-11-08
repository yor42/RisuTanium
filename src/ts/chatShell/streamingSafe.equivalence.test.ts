import { describe, expect, test } from 'vitest'
import { splitStreamingText, type StreamingSplit } from './streamingSafe'

// Frozen copy of the splitter before the incremental fold: the oracle the fold must equal for every input.
const blockStart = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~)/
const cssProperty = /\{\s*(?:--[\w-]+|color|background(?:-color|-image)?|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|font(?:-[\w-]+)?|border(?:-[\w-]+)?|display|width|height|opacity)\s*:/i

function oracleOpenConstruct(text: string): boolean {
    const lines = text.split('\n')
    let fence = ''
    for (const line of lines) {
        const marker = /^\s{0,3}(`{3,})/.exec(line)?.[1]
        if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length))) {
            fence = fence ? '' : marker
        }
    }
    if (fence) return true
    const styleOpen = text.search(/<style\b[^>]*>(?![\s\S]*<\/style\s*>)/i)
    if (styleOpen >= 0) return true
    const thoughtsOpen = text.search(/<Thoughts>(?![\s\S]*<\/Thoughts>)/)
    if (thoughtsOpen >= 0) return true
    if (/(?:^|[\s>])<(?:[A-Za-z!/][^>]*|)$/.test(text.trimEnd())) return true
    const macro = text.lastIndexOf('{{')
    if (macro >= 0 && text.indexOf('}}', macro) < 0 && text.length - macro <= 64) return true
    if (cssProperty.test(text) && text.lastIndexOf('{') > text.lastIndexOf('}')) return true
    return false
}

function oracleSplit(text: string, fromIndex = 0): StreamingSplit {
    const finished: string[] = []
    let start = Number.isInteger(fromIndex) && fromIndex > 0 && fromIndex <= text.length ? fromIndex : 0
    for (let i = start; i < text.length; i++) {
        if (text[i] !== '\n') continue
        const blank = text[i + 1] === '\n'
        const nextLine = text.slice(i + (blank ? 2 : 1))
        const currentLine = text.slice(text.lastIndexOf('\n', i - 1) + 1, i)
        const boundary = blank || blockStart.test(nextLine) || /^\s{0,3}~~~\s*$/.test(currentLine)
        if (!boundary) continue
        const end = i + (blank ? 2 : 1)
        const block = text.slice(start, end)
        if (oracleOpenConstruct(block)) continue
        finished.push(block)
        start = end
        if (blank) i++
    }
    return { finished, open: text.slice(start) }
}

const PIECES = [
    '\n', '\n', '\n\n', 'word ', 'text', '- item', '1. one', '> quote', '# head ',
    '```', '```js', '````', '``', '~~~', '   ```', '    ```', '\t```', ' ~~~ ',
    '<Thoughts>', '</Thoughts>', '</Thoughts><Thoughts>', '<Thoughts></Thoughts>', '<Thoughts', '</Thoughts',
    '<style>', '</style>', '</style\n>', '<style type="x">',
    '{{', '}}', '{{user}}', 'p{color:red', '{', '}', 'a{margin:0;}',
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

describe('splitStreamingText equals the frozen pre-fold splitter', () => {
    test('G T8 generated texts at every from index, including mid-line and out of range', () => {
        const rng = makeRng(20261108)
        for (let n = 0; n < 1000; n++) {
            const text = makeText(rng)
            for (let from = -1; from <= text.length + 1; from++) {
                expect(splitStreamingText(text, from), JSON.stringify({ text, from })).toEqual(oracleSplit(text, from))
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
