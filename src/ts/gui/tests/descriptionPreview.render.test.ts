// @vitest-environment jsdom
// Sanitized-markup assertions need a DOM in which DOMPurify removes every
// offending node; see sanitizerMultiRemoval.test.ts for why happy-dom is not one.

/**
 * `previewCut` against the real renderer. The cut is only allowed when the
 * preview is a leading part of the full render (I1):
 * `stripMedia(ParseMarkdown(text))` starts with
 * `stripMedia(ParseMarkdown(text.slice(0, cut))).trimEnd()`.
 *
 * Fixtures are built like real notes: LF from the editor and CRLF from
 * Windows-authored imports, Korean text, U+3000 indentation, NBSP lines.
 * The property runs under the default quote rendering and, for the LF corpus,
 * under `blockquoteStyling`, which inserts `<br><br>` around quotes after the
 * markdown pass. The corpus also relies on the renderer escaping a bare `<` and
 * leaving `&amp;` / `&lt;` alone, which a note with HTML never reaches because
 * `previewCut` rejects it.
 */
import { describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks

vi.mock(
    import('../../storage/database.svelte'),
    () =>
        ({
            appVer: '1234.5.67',
            getCurrentCharacter: () => ({}),
            getDatabase: () => ({}),
        }) as typeof import('../../storage/database.svelte'),
)

vi.mock(import('../../globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}))

vi.mock(import('../../stores.svelte'), () => {
    return {
        DBState: {
            db: {
                characters: [{ chatPage: 0, chats: [{}], defaultVariables: '' }],
                globalChatVariables: {},
                templateDefaultVariables: '',
            },
        },
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
    } as typeof import('../../stores.svelte')
})

//#endregion

import { ParseMarkdown } from '../../parser/parser.svelte'
import { DBState } from '../../stores.svelte'
import { stripMedia } from '../descriptionMarkdown'
import { previewCut } from '../descriptionPreview'

const render = async (text: string): Promise<string> => stripMedia(await ParseMarkdown(text))

//#region corpus

type Rng = () => number
type Block = (r: Rng) => string

function rng(seed: number): Rng {
    return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff
        return seed / 0x7fffffff
    }
}

const sentence = (k: number): string[] => [
    `Sentence ${k} with **bold**, *italic*, _under_, ~~struck~~, "straight" and “curly” quotes, 'single' marks, [a link](https://example.com/${k}) and \`code\`.`,
    `그녀는 ${k}번째 문장을 말했다. "안녕," 그녀가 말했다. a < b and I <3 you.`,
    `Line ${k} ending with two spaces  `,
    `Escaped \\*not emphasis\\* and a backslash\\`,
]

const paragraph: Block = (r) => Array.from({ length: 1 + Math.floor(r() * 6) }, (_, k) => sentence(k)[Math.floor(r() * 4)]).join(r() < 0.3 ? '\n' : ' ')

/** Fence-free, markup-free blocks, including every construct that may span or touch a blank line. */
const FENCE_FREE_BLOCKS: Block[] = [
    paragraph,
    paragraph,
    () => '# Heading\n## Sub heading',
    () => 'Setext title\n============',
    () => 'Setext two\n---',
    () => '- item one\n- item two\n  continued\n- item three',
    () => '* star item\n\n* loose star item\n\n  indented paragraph in item',
    () => '1. first\n\n2. second loose\n3. third',
    () => '7) seventh\n8) eighth',
    () => '- outer\n    - nested\n    - nested two\n- outer two',
    () => '> quoted line\n> second quoted\n>\n> after quoted blank',
    () => '> outer\n>> nested quote',
    () => '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |',
    () => '---',
    () => '***',
    () => '* * *',
    () => '![image](https://example.com/x.png) and ![second](https://example.com/y.png)',
    () => 'Lazy start\ncontinued lazily\nand again',
    () => '그는 말했다.\n　\n이어지는 문단 줄.',
    () => 'Before nbsp line\n \nafter nbsp line',
    () => '　들여쓴 문단의 첫 줄.\n　두 번째 줄.',
    () => '>\n> empty quote start',
    () => '- list a\n- list b',
    () => '10. ten\n11. eleven',
    () => 'Term line\n: colon-led line',
    () => '    four-space indented text (indented code is disabled)',
    () => '\tTab-led line',
    () => 'Ends with a hard break backslash\\',
    () => '"open quote paragraph without close',
    () => 'It\'s an apostrophe; she said \'hi\' and "bye".',
]

/** Blocks with a fence run: fenced code (also nested in a quote or a list item), tilde fences, a fence-like info string. */
const FENCED_BLOCKS: Block[] = [
    () => '```js\nconst x = "a"\n\nlet y = 2\n```',
    () => '~~~\ntilde fence\n\n~~~~',
    () => '````\n```\ninner\n\n```\n````',
    () => '```a`b not a fence\n\nafter',
    () => '- item with fence\n\n  ```\n  code\n\n  ```',
    () => '> ```js\n> ```',
    () => '- ```js\n  ```',
    () => '- item\n\n  ```py\n  x = 1\n\n  y = 2\n  ```',
    () => '> ```\n> quoted code\n>\n> more\n> ```',
    () => '```js\n```',
    () => '```\n\n```',
]

/** Blocks with markup or a whole-text construct. */
const MARKUP_BLOCKS: Block[] = [
    () => '<p class="absolute">fixed</p>',
    () => '<div>\nblock\n\nafter blank\n</div>',
    () => '<!-- comment\n\nspanning a blank -->',
    () => '<Thoughts>inner</Thoughts>',
    () => '<style>.a { color: red; }</style>',
    () => 'see <https://example.com>',
    () => '$$x^2$$',
    () => '{{inlay::asset-id}}',
    () => '[ref]: https://example.com\n\nlater [ref]',
    () => 'an open \uE9B0 placeholder',
    () => 'line one\rline two',
    () => '&#xE9B0;quoted&#xE9B1;',
    () => '&#60;b&#62;',
]

function noteFrom(blocks: Block[], seed: number): string {
    const r = rng(seed)
    const parts: string[] = []
    while (parts.join('\n\n').length < 2500 + r() * 4000) {
        parts.push(blocks[Math.floor(r() * blocks.length)](r))
    }
    return parts.join('\n\n')
}

const FENCED_MIX = [...FENCE_FREE_BLOCKS, ...FENCED_BLOCKS]
const MARKUP_MIX = [...FENCE_FREE_BLOCKS, ...MARKUP_BLOCKS]
const SEEDS = 120
const MINIMUMS = [200, 600, 1000]

interface PropertyResult {
    cuts: number
    below: number
    failures: string[]
}

async function runProperty(blocks: Block[], crlfs: boolean[]): Promise<PropertyResult> {
    const result: PropertyResult = { cuts: 0, below: 0, failures: [] }
    for (const crlf of crlfs) {
        for (const min of MINIMUMS) {
            for (let seed = 1; seed <= SEEDS; seed++) {
                let text = noteFrom(blocks, seed * 13 + min)
                if (crlf) {
                    text = text.replace(/\n/g, '\r\n')
                }
                const cut = previewCut(text, min)
                if (cut === null) {
                    continue
                }
                result.cuts++
                if (cut < min) {
                    result.below++
                }
                const full = await render(text)
                const preview = (await render(text.slice(0, cut))).trimEnd()
                if (!full.startsWith(preview)) {
                    result.failures.push(`seed ${seed} min ${min} crlf ${crlf} cut ${cut}`)
                }
            }
        }
    }
    return result
}

//#endregion

describe('previewCut against the real renderer', { timeout: 600_000 }, () => {
    // Guard for the invariant: a cut note's prefix render is a leading part of its full render.
    test('the prefix render leads the full render (LF and CRLF, three minimums)', async () => {
        const result = await runProperty(FENCE_FREE_BLOCKS, [false, true])
        expect(result.cuts).toBeGreaterThanOrEqual(300)
        expect(result.below).toBe(0)
        expect(result.failures).toEqual([])
    })

    // Guard: the same property when quotes are restyled after the markdown pass (`<br><br>` around each quote).
    test('the prefix render leads the full render under blockquoteStyling', async () => {
        const db = DBState.db as { blockquoteStyling?: boolean }
        db.blockquoteStyling = true
        try {
            const styled = await render('A "quoted" line.\n\nNext.')
            expect(styled).toContain('<br><br><mark>')
            const result = await runProperty(FENCE_FREE_BLOCKS, [false])
            expect(result.cuts).toBeGreaterThanOrEqual(150)
            expect(result.below).toBe(0)
            expect(result.failures).toEqual([])
        } finally {
            db.blockquoteStyling = undefined
        }
        expect(await render('A "quoted" line.\n\nNext.')).not.toContain('<br><br><mark>')
    })

    // Guard: notes with fences or markup never get a cut, whatever else they hold.
    test('notes with fence runs or markup have no cut', () => {
        let notes = 0
        for (const blocks of [FENCED_MIX, MARKUP_MIX]) {
            for (const crlf of [false, true]) {
                for (const min of MINIMUMS) {
                    for (let seed = 1; seed <= SEEDS; seed++) {
                        let text = noteFrom(blocks, seed * 13 + min)
                        if (crlf) {
                            text = text.replace(/\n/g, '\r\n')
                        }
                        const hasUnsafe = /<[A-Za-z!?/]|\$\$|\{\{inlay|\]:|[\uE9B0-\uE9C1]|\r(?!\n)|`{3}|~{3}|&#/.test(text)
                        if (hasUnsafe) {
                            notes++
                            expect(previewCut(text, min), `seed ${seed} min ${min} crlf ${crlf}`).toBeNull()
                        }
                    }
                }
            }
        }
        expect(notes).toBeGreaterThanOrEqual(600)
    })

    // Guard with identity falsification (scratch only): with an identity `stripMedia` the `img` assertion fails.
    test('the prefix of a note with an image and non-web links renders without media or a non-web href', async () => {
        const filler = Array.from({ length: 12 }, (_, k) => `Plain filler sentence ${k} here.`).join(' ')
        const text = `![i](https://e.x/a.png) and [x](javascript:alert(1)) and [m](mailto:a@e.x) and [w](https://e.x/page)\n\n${filler}\n\nTail paragraph.`
        const cut = previewCut(text, 200)
        expect(cut).not.toBeNull()
        const html = await render(text.slice(0, cut!))
        const dom = document.createElement('div')
        dom.innerHTML = html
        expect(dom.textContent).toContain('and')
        expect(dom.querySelector('img, picture, video, source')).toBeNull()
        const hrefs = Array.from(dom.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'))
        expect(hrefs).toEqual(['https://e.x/page'])
    })
})
