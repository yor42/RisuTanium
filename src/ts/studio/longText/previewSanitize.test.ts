// @vitest-environment jsdom
import { writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'

// The identity flag stands in for a sanitiser that returns its input; the falsification row turns it on.
const mutant = vi.hoisted(() => ({ identity: false }))

//#region module mocks (the parser harness of cbsEngine.pin.test.ts)

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: { characters: [], globalChatVariables: {}, templateDefaultVariables: '', hideAllImages: false } },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
    CurrentTriggerIdStore: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

// The suite-wide setup stubs KaTeX out; the formula rows need the real renderer.
vi.mock('katex', async () => await vi.importActual<typeof import('katex')>('katex'))

//#endregion

// The parser is imported first so that its four global DOMPurify hooks are registered before any strict call.
import { parseMarkdownSafe } from 'src/ts/parser/parser.svelte'
import * as real from './previewSanitize'

const strict = (raw: string): real.PreviewHtml => mutant.identity ? { html: raw, mediaRemoved: 0 } : real.strictPreviewHtml(raw)
const pipeline = (markdown: string): real.PreviewHtml => mutant.identity ? { html: parseMarkdownSafe(markdown), mediaRemoved: 0 } : real.previewHtml(markdown)

const documentOf = (html: string): Document => new DOMParser().parseFromString(html, 'text/html')

const MEDIA_ITEMS: [string, string, number][] = [
    ['img src', '<img src="https://e.invalid/a">', 1],
    ['img srcset', '<img srcset="https://e.invalid/a.png 1x">', 1],
    ['picture with source and img', '<picture><source srcset="https://e.invalid/a.webp"><img src="https://e.invalid/a.png"></picture>', 1],
    ['audio', '<audio src="https://e.invalid/a.mp3"></audio>', 1],
    ['video with poster and source', '<video poster="https://e.invalid/p.png"><source src="https://e.invalid/v.mp4"></video>', 1],
    ['svg with image', '<svg><image href="https://e.invalid/i.png"></image></svg>', 1],
    ['object', '<object data="https://e.invalid/o"></object>', 1],
    ['embed', '<embed src="https://e.invalid/e">', 1],
    ['youtube iframe', '<iframe src="https://www.youtube.com/embed/x"></iframe>', 1],
    ['input type=image', '<input type="image" src="https://e.invalid/i.png">', 0],
    ['link', '<link href="https://e.invalid/s.css">', 0],
]

const CORPUS = [
    '<img src="https://e.invalid/a">', '<img srcset="https://e.invalid/a.png 1x">',
    '<picture><source srcset="https://e.invalid/a.webp"><img src="https://e.invalid/a.png"></picture>',
    '<audio src="https://e.invalid/a.mp3"></audio>', '<video poster="https://e.invalid/p.png"><source src="https://e.invalid/v.mp4"></video>',
    '<link href="https://e.invalid/s.css">', '<style>@import url(https://e.invalid/x.css)</style>',
    '<div style="background:url(https://e.invalid/d.png)">D</div>', '<table background="https://e.invalid/t.png"><tr><td>T</td></tr></table>',
    '<svg><image href="https://e.invalid/i.png"></image></svg>', '<input type="image" src="https://e.invalid/i.png">',
    '<object data="https://e.invalid/o"></object>', '<embed src="https://e.invalid/e">',
    '<iframe src="https://www.youtube.com/embed/x"></iframe>', '<meta http-equiv="refresh" content="0;url=https://e.invalid">',
    '<base href="https://e.invalid/">', '<a href="https://e.invalid/l">L</a>',
    '<b id="i" class="c" name="n" onclick="x()" data-x="1" aria-hidden="true">B</b>',
    '<form action="https://e.invalid/f"><button formaction="https://e.invalid/g">G</button></form>',
].join('')

const ALLOWED_SURVIVORS = ['div', 'table', 'tbody', 'tr', 'td', 'b']

// What the strict pass must guarantee for the whole corpus: only inert elements, no attribute, no media, text kept.
function assertCorpusIsStrict(sanitise: (raw: string) => real.PreviewHtml): void {
    const doc = documentOf(sanitise(CORPUS).html)
    const elements = Array.from(doc.body.querySelectorAll('*'))
    expect(elements.filter((e) => !ALLOWED_SURVIVORS.includes(e.localName)).map((e) => e.localName)).toEqual([])
    expect(elements.flatMap((e) => Array.from(e.attributes).map((a) => a.name))).toEqual([])
    expect(doc.body.textContent).toBe('DTLBG')
}

describe('E2-S1 strictPreviewHtml, called directly', () => {
    test('the whole corpus leaves no banned element or attribute and keeps the text', () => {
        assertCorpusIsStrict(strict)
    })

    test.each(MEDIA_ITEMS)('mediaRemoved counts %s (%s) as %i', (_label, raw, count) => {
        expect(strict(raw).mediaRemoved).toBe(count)
    })

    test('the whole corpus counts each outermost media element once', () => {
        // img, img srcset, picture, audio, video, svg, object, embed, iframe.
        expect(strict(CORPUS).mediaRemoved).toBe(9)
    })
})

describe('E2-S2 an identity sanitiser makes the corpus assertions fail (MC-239)', () => {
    test('the same helper rejects an identity sanitiser and the counts disagree', () => {
        mutant.identity = true
        try {
            expect(() => assertCorpusIsStrict(strict)).toThrow()
            expect(strict(MEDIA_ITEMS[0][1]).mediaRemoved).not.toBe(MEDIA_ITEMS[0][2])
        } finally {
            mutant.identity = false
        }
        expect(() => assertCorpusIsStrict(strict)).not.toThrow()
    })

    test('the pipeline-level assertions fail with an identity sanitiser too', () => {
        mutant.identity = true
        try {
            expect(() => assertImageDropped(pipeline)).toThrow()
        } finally {
            mutant.identity = false
        }
        expect(() => assertImageDropped(pipeline)).not.toThrow()
    })
})

describe('E2-S3 the strict instance carries none of the parser hooks', () => {
    test('blob and asset sources, a target and an href do not survive', () => {
        const raw = '<img src=blob:x><img src=asset:x><a href=https://x>link</a><span href="https://x">t</span><b href="http://y">u</b>'
        const doc = documentOf(strict(raw).html)
        expect(doc.querySelectorAll('img')).toHaveLength(0)
        expect(doc.querySelectorAll('[target]')).toHaveLength(0)
        expect(doc.querySelectorAll('[href]')).toHaveLength(0)
        expect(doc.body.textContent).toBe('linktu')
    })

    test('the parser hooks really are registered in this run: the shared instance adds loading=lazy to an img', () => {
        const shared = parseMarkdownSafe('<img src="https://e.invalid/a.png">')
        const imgs = documentOf(shared).querySelectorAll('img')
        expect(imgs).toHaveLength(1)
        // Only the parser's element hook produces this attribute; a hook-free instance leaves it off.
        expect(imgs[0].getAttribute('loading')).toBe('lazy')
    })
})

describe('E2-S1 uri-bearing attributes never survive on allowed tags', () => {
    test('href, src, cite and poster are removed from allowed elements and no url text remains', () => {
        const result = strict('<span src="https://e.invalid/a" href="https://e.invalid/b" cite="https://e.invalid/c">t</span><div poster="https://e.invalid/p" background="https://e.invalid/q" action="https://e.invalid/r">u</div>')
        expect(result.html).not.toContain('e.invalid')
        const doc = documentOf(result.html)
        expect(Array.from(doc.body.querySelectorAll('*')).flatMap((e) => Array.from(e.attributes).map((a) => a.name))).toEqual([])
        expect(doc.body.textContent).toBe('tu')
    })

    test('an empty href or src is removed too: the allowlist, not only the URI pattern, keeps them out', () => {
        const result = strict('<span href="" src="">t</span><b href="">u</b>')
        expect(Array.from(documentOf(result.html).body.querySelectorAll('*')).flatMap((e) => Array.from(e.attributes).map((a) => a.name))).toEqual([])
        expect(result.html).toBe('<span>t</span><b>u</b>')
    })

    test('the identity sanitiser fails the same assertions', () => {
        mutant.identity = true
        try {
            expect(strict('<span href="https://e.invalid/b">t</span>').html).toContain('e.invalid')
        } finally {
            mutant.identity = false
        }
    })
})

function assertImageDropped(run: (markdown: string) => real.PreviewHtml): void {
    const result = run('**b** ![i](https://e.invalid/i.png)')
    const doc = documentOf(result.html)
    expect(doc.querySelectorAll('strong')).toHaveLength(1)
    expect(doc.querySelectorAll('img')).toHaveLength(0)
    expect(result.mediaRemoved).toBe(1)
}

describe('E2-S4 previewHtml, the pipeline the surfaces use', () => {
    test('a markdown image is dropped and counted once, bold text stays', () => {
        assertImageDropped(pipeline)
    })

    test.each(['<iframe src="https://www.youtube.com/embed/x"></iframe>', '<iframe src="https://e.invalid/x"></iframe>'])(
        'an iframe is removed by the first pass and counts 0: %s',
        (raw) => {
            const result = pipeline(raw)
            expect(documentOf(result.html).querySelectorAll('iframe')).toHaveLength(0)
            expect(result.mediaRemoved).toBe(0)
        },
    )

    test('id, class and style never reach the output', () => {
        const result = pipeline('**hi** <span id="i" class="c" style="color:red" data-x="1">t</span>')
        const doc = documentOf(result.html)
        expect(doc.querySelectorAll('[id],[class],[style],[data-x]')).toHaveLength(0)
        expect(doc.querySelectorAll('strong')).toHaveLength(1)
    })
})

describe('E2-S5 formulas show their TeX text once, through previewHtml', () => {
    const textOf = (markdown: string): string => documentOf(pipeline(markdown).html).body.textContent?.trim() ?? ''
    const mathIn = (markdown: string): number => documentOf(pipeline(markdown).html).querySelectorAll('math').length

    test('(i) a one-line formula', () => {
        expect(textOf('a $$x^2$$ b')).toBe('a x^2 b')
        expect(mathIn('a $$x^2$$ b')).toBe(0)
    })

    test('(ii) a multi-line formula shows its TeX text once, without the rendered letters', () => {
        expect(textOf('$$\n\\frac{1}{2}\n$$')).toBe('\\frac{1}{2}')
        expect(mathIn('$$\n\\frac{1}{2}\n$$')).toBe(0)
    })

    test('(iii) hand-written math without an annotation shows nothing (declared limit)', () => {
        expect(textOf('<math><mi>x</mi><mo>+</mo><mn>1</mn></math>')).toBe('')
        expect(mathIn('<math><mi>x</mi><mo>+</mo><mn>1</mn></math>')).toBe(0)
    })
})
