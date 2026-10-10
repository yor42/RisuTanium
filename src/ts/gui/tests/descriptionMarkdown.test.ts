// @vitest-environment jsdom

/**
 * `descriptionMarkdown`: the media stripper that keeps images out of the
 * catalog lists, the bounded render cache and the link-click test. The
 * stripper runs on jsdom's real HTML parser; the falsification test proves
 * the media assertions fail for an identity stripper.
 */
import DOMPurify from 'dompurify'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
    MAX_CACHED_DESCRIPTIONS,
    cachedDescriptionHtml,
    clearDescriptionCache,
    clickedButton,
    clickedLink,
    renderDescription,
    selectedInside,
    stripMedia,
} from '../descriptionMarkdown'

const MEDIA_HTML = [
    '<p>kept <strong>text</strong> and <a href="https://example.com">a link</a></p>',
    '<img src="https://example.com/a.png">',
    '<picture><source srcset="https://example.com/b.png"><img src="https://example.com/b.png"></picture>',
    '<video src="https://example.com/c.mp4" poster="https://example.com/p.png"></video>',
    '<audio src="https://example.com/d.mp3"></audio>',
    '<iframe src="https://www.youtube.com/embed/x"></iframe>',
    '<embed src="https://example.com/e.swf"><object data="https://example.com/f.swf"></object>',
    '<style>.x{background:url(https://example.com/g.png)}</style>',
    '<div style="background: url(https://example.com/h.png)">styled</div>',
    '<div style="color: red">plain style</div>',
    '<table background="https://example.com/i.png"><tr><td>cell</td></tr></table>',
    '<svg><image href="https://example.com/j.png"></image><use href="https://example.com/k.svg#a"></use></svg>',
    '<input type="image" src="https://example.com/l.png">',
].join('')

function expectNoMedia(strip: (html: string) => string): void {
    const out = document.createElement('div')
    // A template keeps the assertion DOM inert, so the check itself fetches nothing.
    const template = document.createElement('template')
    template.innerHTML = strip(MEDIA_HTML)
    out.append(template.content)
    expect(out.querySelectorAll('img, picture, source, video, audio, iframe, embed, object, style, input[type="image"]').length).toBe(0)
    expect(out.querySelectorAll('svg image, svg use').length).toBe(0)
    expect(out.querySelector('[background]')).toBeNull()
    expect(out.innerHTML).not.toMatch(/url\s*\(/i)
}

// What the markdown parser lets through its sanitizer that a list must still drop.
const PARSER_PURIFY_CONFIG = {
    ADD_TAGS: ['iframe', 'style', 'risu-style', 'x-em'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'risu-ctrl', 'risu-btn', 'risu-trigger', 'risu-mark', 'risu-id', 'x-hl-lang', 'x-hl-text'],
}

const CONTROL_HTML = [
    '<span risu-ctrl="bgm___auto___https://example.com/x.mp3">c</span>',
    '<button risu-btn="x">b</button><span risu-trigger="t" risu-mark="m" risu-id="i" x-hl-lang="js" x-hl-text="t">m</span>',
].join('')

const ESCAPED_STYLE_HTML = [
    '<div style="background:u\\72l(https://example.com/a.png)">one</div>',
    '<div style="background:\\75rl(https://example.com/b.png)">two</div>',
    '<div style="color: red">plain</div>',
].join('')

const SVG_HTML = [
    '<svg><feImage href="https://example.com/a.png"></feImage><rect fill="url(https://example.com/a.svg#f)" filter="url(https://example.com/a.svg#g)"></rect></svg>',
    '<svg><use href="https://example.com/a.svg#a"></use><image href="https://example.com/a.png"></image></svg>',
].join('')

const LINK_HTML = [
    '<a href="https://example.com">web</a>',
    '<a href="HTTP://example.com">upper</a>',
    '<a href="">empty</a>',
    '<a href="javascript:alert(1)">js</a>',
    '<a href="mailto:a@b.c">mail</a>',
    '<a href=" foo">relative</a>',
].join('')

const FORM_HTML = '<form action="https://example.com/x"><span>kept</span><button formaction="https://example.com/y">go</button><input type="submit"></form>'

function expectNoForm(out: HTMLElement): void {
    expect(out.querySelector('form')).toBeNull()
    expect(out.querySelector('[action], [formaction], [form]')).toBeNull()
    expect(out.textContent).toContain('kept')
}

function stripPurified(strip: (html: string) => string, vector: string): HTMLElement {
    const purified = DOMPurify.sanitize(vector, PARSER_PURIFY_CONFIG)
    const out = document.createElement('div')
    const template = document.createElement('template')
    template.innerHTML = strip(purified)
    out.append(template.content)
    return out
}

function expectNoAppControls(out: HTMLElement): void {
    expect(out.querySelector('[risu-ctrl], [risu-btn], [risu-trigger], [risu-mark], [risu-id], [x-hl-lang], [x-hl-text]')).toBeNull()
    expect(out.textContent).toContain('c')
}

function expectNoEscapedUrlStyle(out: HTMLElement): void {
    expect(out.innerHTML).not.toMatch(/\\/)
    expect(out.textContent).toContain('one')
    expect(out.querySelector<HTMLElement>('[style]')?.getAttribute('style')).toBe('color: red')
}

function expectNoSvg(out: HTMLElement): void {
    expect(out.querySelector('svg, feImage, feimage')).toBeNull()
}

function expectOnlyWebLinks(out: HTMLElement): void {
    const hrefs = Array.from(out.querySelectorAll('a')).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://example.com', 'HTTP://example.com', null, null, null, null])
}

describe('stripMedia on the parser sanitizer output', () => {
    const vectors: Array<[string, string, (out: HTMLElement) => void]> = [
        ['app control attributes (risu-ctrl would start audio)', CONTROL_HTML, expectNoAppControls],
        ['CSS escapes spelling url(', ESCAPED_STYLE_HTML, expectNoEscapedUrlStyle],
        ['svg images, feImage and url() references', SVG_HTML, expectNoSvg],
        ['links that are not http(s), including an empty href', LINK_HTML, expectOnlyWebLinks],
        ['forms and submit attributes', FORM_HTML, expectNoForm],
    ]

    test.each(vectors)('removes %s', (_name, vector, check) => {
        check(stripPurified(stripMedia, vector))
    })

    test.each(vectors)('falsification: an identity stripper fails the %s check', (_name, vector, check) => {
        expect(() => check(stripPurified((html) => html, vector))).toThrow()
    })

    test('keeps plain inline styles and web links', () => {
        const out = stripPurified(stripMedia, '<span style="color: red">x</span><a href="https://example.com">y</a>')
        expect(out.querySelector('span')?.getAttribute('style')).toBe('color: red')
        expect(out.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    })
})
describe('stripMedia', () => {
    test('removes every media element and every image-fetching style or attribute', () => {
        expectNoMedia(stripMedia)
    })

    test('falsification: an identity stripper fails the media assertions', () => {
        expect(() => expectNoMedia((html) => html)).toThrow()
    })

    test('keeps text, formatting, links and harmless styles', () => {
        const out = document.createElement('div')
        out.innerHTML = stripMedia(MEDIA_HTML)
        expect(out.querySelector('strong')?.textContent).toBe('text')
        expect(out.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
        expect(out.textContent).toContain('styled')
        expect(out.textContent).toContain('cell')
        expect(out.querySelector<HTMLElement>('[style]')?.getAttribute('style')).toBe('color: red')
    })

    test('does not fetch while parsing: an image is gone before it is ever attached', () => {
        const created: string[] = []
        const originalCreate = document.createElement.bind(document)
        const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
            created.push(tag)
            return originalCreate(tag, options)
        })
        try {
            stripMedia('<img src="https://example.com/a.png">')
        } finally {
            spy.mockRestore()
        }
        expect(created).toEqual(['template'])
    })
})

describe('clickedButton', () => {
    test('is true inside a button and false elsewhere', () => {
        const root = document.createElement('div')
        root.innerHTML = '<button><b>name</b></button><span>plain</span>'
        const seen: boolean[] = []
        root.addEventListener('click', (event) => seen.push(clickedButton(event)))
        root.querySelector('b')!.dispatchEvent(new Event('click', { bubbles: true }))
        root.querySelector('span')!.dispatchEvent(new Event('click', { bubbles: true }))
        expect(seen).toEqual([true, false])
    })
})

describe('clickedLink', () => {
    test('a link whose href was stripped is not a link', () => {
        const root = document.createElement('div')
        root.innerHTML = '<a>dead</a>'
        let seen: boolean | undefined
        root.addEventListener('click', (event) => { seen = clickedLink(event) })
        root.querySelector('a')!.dispatchEvent(new Event('click', { bubbles: true }))
        expect(seen).toBe(false)
    })

    test('is true for a click inside a link and false elsewhere', () => {
        const root = document.createElement('div')
        root.innerHTML = '<a href="https://example.com"><em>link</em></a><span>plain</span>'
        const seen: boolean[] = []
        root.addEventListener('click', (event) => seen.push(clickedLink(event)))
        root.querySelector('em')!.dispatchEvent(new Event('click', { bubbles: true }))
        root.querySelector('span')!.dispatchEvent(new Event('click', { bubbles: true }))
        expect(seen).toEqual([true, false])
    })
})

describe('selectedInside', () => {
    function select(node: Node, collapsed: boolean): Selection {
        const selection = window.getSelection()!
        selection.removeAllRanges()
        const range = document.createRange()
        range.selectNodeContents(node)
        if (collapsed) {
            range.collapse(true)
        }
        selection.addRange(range)
        return selection
    }

    test('is true only for a non-collapsed selection inside the row', () => {
        const row = document.createElement('div')
        row.innerHTML = '<span>some text</span>'
        const other = document.createElement('div')
        other.textContent = 'elsewhere'
        document.body.append(row, other)
        try {
            expect(selectedInside(row, select(row.firstChild!, false))).toBe(true)
            expect(selectedInside(row, select(row.firstChild!, true))).toBe(false)
            expect(selectedInside(row, select(other, false))).toBe(false)
            expect(selectedInside(row, null)).toBe(false)
        } finally {
            window.getSelection()!.removeAllRanges()
            row.remove()
            other.remove()
        }
    })
})

describe('renderDescription', () => {
    beforeEach(() => {
        clearDescriptionCache()
    })

    test('strips media from the parser output and caches the result per text', async () => {
        const parse = vi.fn(async (text: string) => `<p>${text}</p><img src="https://example.com/a.png">`)
        const first = await renderDescription('hello', parse)
        expect(first).toBe('<p>hello</p>')
        expect(await renderDescription('hello', parse)).toBe('<p>hello</p>')
        expect(parse).toHaveBeenCalledTimes(1)
        expect(cachedDescriptionHtml('hello')).toBe('<p>hello</p>')
        expect(cachedDescriptionHtml('other')).toBeUndefined()
    })

    test('concurrent requests for one text share a single parse', async () => {
        const parse = vi.fn(async (text: string) => `<p>${text}</p>`)
        await Promise.all([renderDescription('x', parse), renderDescription('x', parse)])
        expect(parse).toHaveBeenCalledTimes(1)
    })

    test('a failed parse is not cached and can be retried', async () => {
        const parse = vi.fn<(text: string) => Promise<string>>()
        parse.mockRejectedValueOnce(new Error('boom'))
        parse.mockResolvedValueOnce('<p>ok</p>')
        await expect(renderDescription('x', parse)).rejects.toThrow('boom')
        expect(await renderDescription('x', parse)).toBe('<p>ok</p>')
    })

    test('keeps at most MAX_CACHED_DESCRIPTIONS texts and drops the least recently used first', async () => {
        const parse = vi.fn(async (text: string) => `<p>${text}</p>`)
        for (let i = 0; i < MAX_CACHED_DESCRIPTIONS; i++) {
            await renderDescription(`t${i}`, parse)
        }
        // Touching t0 makes t1 the oldest.
        expect(cachedDescriptionHtml('t0')).toBe('<p>t0</p>')
        await renderDescription('extra', parse)
        expect(cachedDescriptionHtml('t1')).toBeUndefined()
        expect(cachedDescriptionHtml('t0')).toBe('<p>t0</p>')
        expect(cachedDescriptionHtml('extra')).toBe('<p>extra</p>')
    })
})
