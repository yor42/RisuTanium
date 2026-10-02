// @vitest-environment happy-dom

/**
 * "Copy as card" module: the body rebuild, the image classifier, the card frame,
 * and the builder and concurrency rules. The image encoder, the clipboard and the
 * clock are stubs; nothing here touches a real clipboard, network, canvas or the
 * Tauri file system, and a pass says nothing about a real browser's gesture or
 * clipboard-commit rules.
 *
 * The supersession and ordering tests are model tests of the controller's
 * decisions against stub clipboard writes. They are not evidence of how a real
 * clipboard commits.
 *
 * happy-dom cannot evidence the two CSS-escape hidden forms (an escaped
 * `display: n\6fne` and an upper-case, spaced `DISPLAY : NONE` followed by a CSS
 * comment): they are detected through the element's CSSOM, which only a real
 * browser resolves.
 * Every test in this file is new with the module, so none has a pre-change
 * behaviour to fail against.
 */

import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import {
    CardSupersededError,
    buildCardElement,
    buildMinimalCardElement,
    buildMinimalCardHtml,
    captureCardTheme,
    classifyImageSrc,
    createCardCopyController,
    createInertDocument,
    rebuildBody,
    sanitizeColor,
    utf8Bytes,
    type CardEnv,
    type CardInput,
    type CardReport,
    type EncodeAvatar,
} from './chatCard'

//#region fixtures

const ORIGIN = 'http://localhost:3000'
const AVATAR = 'data:image/jpeg;base64,ENCODEDAVATAR'

const COLORS: Record<string, string> = {
    '--risu-theme-textcolor': '#010101',
    '--risu-theme-bgcolor': '#020202',
    '--risu-theme-darkborderc': '#030303',
    '--risu-theme-darkbg': '#040404',
    '--risu-theme-textcolor2': '#050505',
    '--FontColorStandard': '#060606',
    '--FontColorItalic': '#070707',
    '--FontColorBold': '#080808',
    '--FontColorItalicBold': '#090909',
    '--FontColorQuote1': '#0a0a0a',
    '--FontColorQuote2': '#0b0b0b',
}
const theme = captureCardTheme((property) => COLORS[property] ?? '')
const bodyEnv = { origin: ORIGIN, isTauri: false }

function makeEnv(over: Partial<CardEnv> = {}): CardEnv {
    return {
        encodeAvatar: vi.fn<EncodeAvatar>(async () => AVATAR),
        origin: ORIGIN,
        isTauri: false,
        deadlineMs: 3000,
        avatarBudgetMs: 2000,
        marginMs: 2000,
        limitBytes: 900 * 1024,
        ...over,
    }
}

function makeInput(over: Partial<CardInput> = {}): CardInput {
    return {
        copyText: 'hello',
        displayName: 'Ann',
        badge: 'AI',
        avatarPath: '',
        theme,
        parseBody: async () => '<p>hello</p>',
        resolveAvatarSrc: async (path: string) => `/sw/img/${path}`,
        ...over,
    }
}

function body(html: string): HTMLElement {
    return rebuildBody(html, theme, createInertDocument(), bodyEnv)
}

function descendants(root: Element): Element[] {
    return Array.from(root.querySelectorAll('*'))
}

const ALLOWED_TAGS = new Set([
    'div', 'p', 'br', 'span', 'em', 'i', 'strong', 'b', 'u', 's', 'del', 'mark', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img', 'details', 'summary',
])
const ALLOWED_ATTRIBUTES = new Set(['style', 'href', 'src', 'alt', 'colspan', 'rowspan', 'start', 'risu-mark', 'open'])

//#endregion

describe('sanitizeColor and captureCardTheme', () => {
    test('a value that could end a declaration or load a resource is replaced by the fallback', () => {
        expect(sanitizeColor('#abcdef', 'fb')).toBe('#abcdef')
        expect(sanitizeColor('red; background: url(x)', 'fb')).toBe('fb')
        expect(sanitizeColor('url(https://x.example/a.png)', 'fb')).toBe('fb')
        expect(sanitizeColor('red\\3b', 'fb')).toBe('fb')
        expect(sanitizeColor('', 'fb')).toBe('fb')
        expect(sanitizeColor(undefined, 'fb')).toBe('fb')
    })

    test('an unset theme property reads as a fixed fallback colour', () => {
        const unset = captureCardTheme(() => '')
        expect(unset.standard).not.toBe('')
        expect(unset.background).not.toBe('')
    })
})

describe('classifyImageSrc', () => {
    const plain = { origin: ORIGIN, isTauri: false }
    const tauri = { origin: ORIGIN, isTauri: true }

    test.each([
        ['data:image/png;base64,AAAA', plain],
        ['blob:http://localhost:3000/3f2a', plain],
        ['/sw/img/ab', plain],
        [`${ORIGIN}/sw/img/ab`, plain],
        ['asset://localhost/x', tauri],
        ['http://asset.localhost/x', tauri],
        ['https://asset.localhost/x', tauri],
    ])('%s is local', (src, env) => {
        expect(classifyImageSrc(src, env).kind).toBe('local')
    })

    test('an outside http(s) address is kept as written, and a protocol-relative one is written out', () => {
        expect(classifyImageSrc('https://x.example/a.png', plain)).toEqual({ kind: 'outside', src: 'https://x.example/a.png' })
        expect(classifyImageSrc('//x.example/a.png', plain)).toEqual({ kind: 'outside', src: 'https://x.example/a.png' })
        expect(classifyImageSrc('http://localhost:9999/a', plain)).toEqual({ kind: 'outside', src: 'http://localhost:9999/a' })
    })

    test.each([
        ['/proxy2?url=https://x.example/a', plain],
        ['/api/read?x', plain],
        ['/hub-proxy/x', plain],
        ['/none.webp', plain],
        ['http://localhost:3000.evil.com/', plain],
        ['javascript:alert(1)', plain],
        ['ftp://x.example/a', plain],
        ['', plain],
        ['asset://localhost/x', plain],
        ['http://asset.localhost/x', plain],
        ['https://asset.localhost/x', plain],
        ['http://asset.localhost:8080/x', plain],
        ['http://asset.localhost:8080/x', tauri],
    ])('%s is dropped', (src, env) => {
        expect(classifyImageSrc(src, env).kind).toBe('drop')
    })
})

describe('rebuildBody', () => {
    test('writes only allowed elements and attributes, from a source full of everything else', () => {
        const out = body(`
            <section class="x" id="y" onclick="alert(1)" style="color:red;background:url(https://x.example/t)">
                <p style="color:blue" class="c" onmouseover="alert(2)">para <a href="https://x.example/p" target="_blank" onclick="z()">link</a></p>
                <img src="https://x.example/a.png" alt="pic" onerror="alert(3)" srcset="https://x.example/b.png 2x">
                <font color="red">font text</font><center>center text</center>
                <table><thead><tr><th colspan="2" style="x:y">H</th></tr></thead><tbody><tr><td rowspan="3">c</td></tr></tbody></table>
                <ol start="3"><li>one</li></ol>
                <input value="secret"><form action="https://x.example/post"><label for="q">label text</label></form>
            </section>`)

        for(const element of descendants(out)){
            expect(ALLOWED_TAGS.has(element.localName), `tag ${element.localName}`).toBe(true)
            for(const attribute of Array.from(element.attributes)){
                expect(ALLOWED_ATTRIBUTES.has(attribute.name), `attribute ${attribute.name} on ${element.localName}`).toBe(true)
            }
        }
        const html = out.outerHTML
        expect(html).not.toContain('onclick')
        expect(html).not.toContain('onerror')
        expect(html).not.toContain('srcset')
        expect(html).not.toContain('url(')
        expect(html).not.toContain('color:red')
        expect(out.textContent).toContain('font text')
        expect(out.textContent).toContain('center text')
        expect(out.textContent).toContain('label text')
        expect(out.textContent).not.toContain('secret')
    })

    test('the text of script, style, svg, template, noscript, iframe, video, audio, title and risu-style never appears', () => {
        const out = body(`
            keep-me
            <script>SCRIPTTEXT</script><style>STYLETEXT</style><risu-style>RISUSTYLETEXT</risu-style>
            <svg><text>SVGTEXT</text></svg><template>TEMPLATETEXT</template><noscript>NOSCRIPTTEXT</noscript>
            <iframe>IFRAMETEXT</iframe><video>VIDEOTEXT</video><audio>AUDIOTEXT</audio><title>TITLETEXT</title>
            <select><option>OPTIONTEXT</option></select><datalist><option>DATALISTTEXT</option></datalist>`)

        expect(out.textContent).toContain('keep-me')
        for(const dropped of ['SCRIPTTEXT', 'STYLETEXT', 'RISUSTYLETEXT', 'SVGTEXT', 'TEMPLATETEXT', 'NOSCRIPTTEXT', 'IFRAMETEXT', 'VIDEOTEXT', 'AUDIOTEXT', 'TITLETEXT', 'OPTIONTEXT', 'DATALISTTEXT']){
            expect(out.textContent, dropped).not.toContain(dropped)
        }
    })

    test('section, font, center, button and textarea are unwrapped with their text kept', () => {
        const out = body('<section>S</section><font>F</font><center>C</center><button>B</button><textarea>T</textarea>')

        expect(out.textContent).toBe('SFCBT')
        expect(descendants(out)).toEqual([])
    })

    test('a table header cell keeps its text', () => {
        const out = body('<table><thead><tr><th>H</th></tr></thead></table>')

        expect(out.querySelector('th')?.textContent).toBe('H')
    })

    test('a closed details and everything in it are gone; an open one is kept with its summary', () => {
        const closed = body('<p>before</p><details><summary>SUM</summary>HIDDENBODY</details>')
        expect(closed.textContent).toContain('before')
        expect(closed.textContent).not.toContain('SUM')
        expect(closed.textContent).not.toContain('HIDDENBODY')

        const open = body('<details open><summary>SUM</summary>SHOWNBODY</details>')
        expect(open.querySelector('details')?.hasAttribute('open')).toBe(true)
        expect(open.querySelector('summary')?.textContent).toBe('SUM')
        expect(open.textContent).toContain('SHOWNBODY')
    })

    test('a dialog without open is gone and an open one keeps its text', () => {
        expect(body('<dialog>CLOSEDTEXT</dialog>').textContent).not.toContain('CLOSEDTEXT')
        expect(body('<dialog open>OPENTEXT</dialog>').textContent).toContain('OPENTEXT')
    })

    test.each([
        ['<div hidden>GONE</div>'],
        ['<div style="display:none">GONE</div>'],
        ['<div style="display:none !important">GONE</div>'],
        ['<div style="display:block;display:none">GONE</div>'],
        ['<div style="visibility:hidden">GONE</div>'],
        ['<div hidden><p>GONE</p></div>'],
        ['<p style="display:none">GONE</p>'],
    ])('hidden content is left out: %s', (html) => {
        expect(body(`shown ${html}`).textContent).not.toContain('GONE')
        expect(body(`shown ${html}`).textContent).toContain('shown')
    })

    test.each([
        ['<div style="display:none;display:block">KEPT</div>'],
        ['<div style="visibility:collapse">KEPT</div>'],
    ])('content that is still visible is kept: %s', (html) => {
        expect(body(html).textContent).toContain('KEPT')
    })

    test('colspan, rowspan and start are kept when plain positive integers and dropped otherwise', () => {
        const out = body('<table><tr><td colspan="2" rowspan="3">a</td><td colspan="x" rowspan="-1">b</td></tr></table><ol start="3"><li>i</li></ol><ol start="1e3"><li>j</li></ol>')

        const cells = Array.from(out.querySelectorAll('td'))
        expect(cells[0].getAttribute('colspan')).toBe('2')
        expect(cells[0].getAttribute('rowspan')).toBe('3')
        expect(cells[1].hasAttribute('colspan')).toBe(false)
        expect(cells[1].hasAttribute('rowspan')).toBe(false)
        const lists = Array.from(out.querySelectorAll('ol'))
        expect(lists[0].getAttribute('start')).toBe('3')
        expect(lists[1].hasAttribute('start')).toBe(false)
    })

    test('onclick, style, class and id are never copied from the source', () => {
        const out = body('<p onclick="x()" style="color:red" class="c" id="i">t</p>')

        const paragraph = out.querySelector('p')!
        expect(paragraph.hasAttribute('onclick')).toBe(false)
        expect(paragraph.hasAttribute('class')).toBe(false)
        expect(paragraph.hasAttribute('id')).toBe(false)
        expect(paragraph.style.getPropertyValue('color')).toBe(theme.standard)
    })

    test('a link keeps an absolute http(s) address only; the text of any other link stays', () => {
        const out = body('<a href="https://x.example/p">one</a><a href="javascript:alert(1)">two</a><a href="/relative">three</a><a href="mailto:a@b.c">four</a>')

        const links = Array.from(out.querySelectorAll('a'))
        expect(links[0].getAttribute('href')).toBe('https://x.example/p')
        for(const link of links.slice(1)){
            expect(link.hasAttribute('href')).toBe(false)
        }
        expect(out.textContent).toBe('onetwothreefour')
    })

    test('em, strong, nested em and strong, and quote marks take theme colours; every mark has a transparent background', () => {
        const out = body(`
            <p>x</p><em>i</em><strong>b</strong><em><strong>ib1</strong></em><strong><em>ib2</em></strong>
            <mark risu-mark="quote1">q1</mark><mark risu-mark="quote2">q2</mark>
            <mark risu-mark="blockquote1">b1</mark><mark risu-mark="blockquote2">b2</mark><mark>plain</mark>`)

        const colorOf = (selector: string) => (out.querySelector(selector) as HTMLElement).style.getPropertyValue('color')
        expect(colorOf('p')).toBe(theme.standard)
        expect(colorOf('em:not(strong em)')).toBe(theme.italic)
        expect(colorOf('strong:not(em strong)')).toBe(theme.bold)
        expect(colorOf('em strong')).toBe(theme.italicBold)
        expect(colorOf('strong em')).toBe(theme.italicBold)
        expect(colorOf('mark[risu-mark="quote1"]')).toBe(theme.quote1)
        expect(colorOf('mark[risu-mark="quote2"]')).toBe(theme.quote2)
        expect(colorOf('mark[risu-mark="blockquote1"]')).toBe(theme.quote1)
        expect(colorOf('mark[risu-mark="blockquote2"]')).toBe(theme.quote2)
        for(const mark of Array.from(out.querySelectorAll('mark'))){
            expect((mark as HTMLElement).style.getPropertyValue('background')).toBe('transparent')
        }
    })

    test('a theme colour with a semicolon or url( never reaches a style', () => {
        const hostile = captureCardTheme((property) => property === '--FontColorStandard' ? 'red; background: url(https://x.example/t)' : '')

        const out = rebuildBody('<p>t</p>', hostile, createInertDocument(), bodyEnv)

        const style = out.querySelector('p')!.getAttribute('style') ?? ''
        expect(style).not.toContain('url(')
        expect(style).not.toContain('red')
        expect(style).toContain(hostile.standard)
    })

    test('math is replaced by its TeX source text', () => {
        const out = body('<span class="katex"><math><semantics><mrow><mfrac><mi>a</mi><mi>b</mi></mfrac></mrow><annotation encoding="application/x-tex">\\frac{a}{b}</annotation></semantics></math></span>')

        expect(out.textContent).toBe('\\frac{a}{b}')
    })

    test('math without a TeX annotation falls back to its text', () => {
        expect(body('<math><mi>x</mi><mo>+</mo><mn>1</mn></math>').textContent).toBe('x+1')
    })

    test('a body image from an outside host keeps its address; a local or other image is left out', () => {
        const out = body(`
            <img src="https://x.example/a.png" alt="A">
            <img src="data:image/png;base64,AAAA"><img src="/sw/img/ab"><img src="blob:http://localhost:3000/3f2a">
            <img src="/proxy2?url=https://x.example/b.png"><img src="relative.png"><img>`)

        const images = Array.from(out.querySelectorAll('img'))
        expect(images).toHaveLength(1)
        expect(images[0].getAttribute('src')).toBe('https://x.example/a.png')
        expect(images[0].getAttribute('alt')).toBe('A')
    })

    test('comments and processing nodes are dropped', () => {
        const out = body('a<!-- COMMENTTEXT -->b')

        expect(out.textContent).toBe('ab')
    })
})

describe('the card frame', () => {
    test('shows the display name as text, never as markup (escaping)', () => {
        const html = buildMinimalCardHtml(makeInput({ displayName: '<img src=x onerror=alert(1)>' }))

        const parsed = new DOMParser().parseFromString(html, 'text/html')
        expect(parsed.querySelector('h3')?.textContent).toBe('<img src=x onerror=alert(1)>')
        expect(parsed.querySelector('h3 img')).toBeNull()
        expect(parsed.querySelector('[onerror]')).toBeNull()
    })

    test('shows the model badge only when there is one, and the RisuTanium footer', () => {
        const withBadge = buildMinimalCardHtml(makeInput({ badge: 'Test-model' }))
        const withoutBadge = buildMinimalCardHtml(makeInput({ badge: null }))

        expect(withBadge).toContain('Test-model')
        expect(withoutBadge).not.toContain('Test-model')
        expect(withBadge).toContain('From RisuTanium')
    })

    test('the minimal card holds the copy text with a line break per newline and no image', () => {
        const element = buildMinimalCardElement(makeInput({ copyText: 'one\r\ntwo\nthree' }))

        expect(element.querySelectorAll('br')).toHaveLength(2)
        expect(element.textContent).toContain('onetwothree')
        expect(element.querySelector('img')).toBeNull()
    })

    test('the avatar is an image in the header only when one is given', () => {
        const doc = createInertDocument()
        const input = makeInput()

        const without = buildCardElement(doc, input, doc.createElement('div'), null)
        const withAvatar = buildCardElement(doc, input, doc.createElement('div'), AVATAR)

        expect(without.querySelector('img')).toBeNull()
        expect(withAvatar.querySelector('img')?.getAttribute('src')).toBe(AVATAR)
    })
})

describe('the inert document', () => {
    test('the body, frame and minimal card are built without the live document, and nothing is attached to it', () => {
        const createElement = vi.spyOn(document, 'createElement')
        const createElementNS = vi.spyOn(document, 'createElementNS')
        try {
            const doc = createInertDocument()
            const rebuilt = rebuildBody('<p>a <img src="https://x.example/a.png"> b</p><table><tr><td>c</td></tr></table>', theme, doc, bodyEnv)
            const card = buildCardElement(doc, makeInput(), rebuilt, AVATAR)
            const minimal = buildMinimalCardElement(makeInput())

            expect(createElement).not.toHaveBeenCalled()
            expect(createElementNS).not.toHaveBeenCalled()
            for(const root of [card, minimal]){
                expect(root.ownerDocument).not.toBe(document)
                for(const element of descendants(root)){
                    expect(element.ownerDocument).not.toBe(document)
                }
                expect(root.parentNode).toBeNull()
                expect(document.contains(root)).toBe(false)
            }
            expect(card.querySelector('img[src="https://x.example/a.png"]')).not.toBeNull()
        } finally {
            createElement.mockRestore()
            createElementNS.mockRestore()
        }
    })
})

//#region the controller

interface ClipboardStub {
    write: Mock<(items: ClipboardItem[]) => Promise<void>>
    writeText: Mock<(text: string) => Promise<void>>
    /** While set, every write waits for it after its payloads were read. */
    gate: { promise: Promise<void>, release: () => void } | null
}

const realClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
let clipboard: ClipboardStub
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}

function makeGate(): NonNullable<ClipboardStub['gate']> {
    let release!: () => void
    const promise = new Promise<void>((resolve) => {
        release = resolve
    })
    return { promise, release }
}

async function flush(): Promise<void> {
    for(let i = 0; i < 60; i++){
        await Promise.resolve()
    }
}

let fetchStub: Mock<(input: string) => Promise<{ ok: boolean }>>

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    fetchStub = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetchStub)
    clipboard = {
        gate: null,
        write: vi.fn(async (items: ClipboardItem[]) => {
            for(const item of items){
                for(const type of item.types){
                    await item.getType(type)
                }
            }
            await clipboard.gate?.promise
        }),
        writeText: vi.fn(async () => {}),
    }
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
})

afterEach(async () => {
    vi.useRealTimers()
    await flush()
    process.off('unhandledRejection', onUnhandled)
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'execCommand')
    if(realClipboard){
        Object.defineProperty(navigator, 'clipboard', realClipboard)
    }
    else {
        Reflect.deleteProperty(navigator, 'clipboard')
    }
    expect(unhandled).toEqual([])
})

interface Harness {
    controller: ReturnType<typeof createCardCopyController>
    env: CardEnv
    reports: CardReport[]
    tap: (owner: object, over?: { text?: string, input?: Partial<CardInput> }) => void
}

function harness(envOver: Partial<CardEnv> = {}): Harness {
    const env = makeEnv(envOver)
    const controller = createCardCopyController(() => env)
    const reports: CardReport[] = []
    const tap = (owner: object, over: { text?: string, input?: Partial<CardInput> } = {}) => {
        const text = over.text ?? 'hello'
        controller.start({
            owner,
            captureText: () => text,
            captureCard: () => makeInput({ copyText: text, ...over.input }),
            report: (report) => reports.push(report),
        })
    }
    return { controller, env, reports, tap }
}

async function writtenHtml(callIndex = 0): Promise<string> {
    const [items] = clipboard.write.mock.calls[callIndex]
    return await (await items[0].getType('text/html')).text()
}

const kinds = (reports: CardReport[]) => reports.map((report) => report.kind)

describe('the card build: images', () => {
    test('an outside body image is kept and a local or other one dropped, and nothing is fetched (fetch-only)', async () => {
        const h = harness()
        h.tap({}, { input: { parseBody: async () => '<p>a <img src="https://x.example/a.png"><img src="/sw/img/ab"><img src="/proxy2?url=https://x.example/b.png"><img src="data:image/png;base64,AAAA"></p>' } })
        await flush()

        const html = await writtenHtml()
        expect(html).toContain('https://x.example/a.png')
        expect(html).not.toContain('/sw/img/ab')
        expect(html).not.toContain('/proxy2')
        expect(html).not.toContain('data:image/png')
        expect(fetchStub).not.toHaveBeenCalled()
    })

    test('a local avatar is encoded once with the captured path; an outside or other avatar is never encoded', async () => {
        const local = harness()
        local.tap({}, { input: { avatarPath: 'origavatar' } })
        await flush()
        expect(local.env.encodeAvatar).toHaveBeenCalledTimes(1)
        const [src, options] = vi.mocked(local.env.encodeAvatar).mock.calls[0]
        expect(src).toBe('/sw/img/origavatar')
        expect(options.maxSide).toBe(160)
        expect(options.background).toBe(theme.background)
        expect(await writtenHtml()).toContain(AVATAR)

        for(const resolved of ['https://x.example/a.png', '/proxy2?url=https://x.example/a.png', '/none.webp', '']){
            const other = harness()
            other.tap({}, { input: { avatarPath: 'p', resolveAvatarSrc: async () => resolved } })
            await flush()
            expect(other.env.encodeAvatar, resolved).not.toHaveBeenCalled()
            expect(other.reports.map((r) => r.kind), resolved).toContain('simple')
        }
        expect(fetchStub).not.toHaveBeenCalled()
    })

    test('an empty avatar path reaches neither the path lookup nor the encoder, and the card is complete', async () => {
        const h = harness()
        const resolveAvatarSrc = vi.fn(async (path: string) => path)
        h.tap({}, { input: { avatarPath: '', resolveAvatarSrc } })
        await flush()

        expect(resolveAvatarSrc).not.toHaveBeenCalled()
        expect(h.env.encodeAvatar).not.toHaveBeenCalled()
        expect(kinds(h.reports)).toEqual(['loading', 'copied'])
    })

    test.each([
        ['an empty result', ''],
        ['a data: URL with no payload', 'data:,'],
        ['an image data URL with no payload', 'data:image/jpeg;base64,'],
        ['a result that is not an image', 'https://x.example/a.png'],
    ])('%s means no avatar', async (_title, encoded) => {
        const h = harness({ encodeAvatar: vi.fn<EncodeAvatar>(async () => encoded) })
        h.tap({}, { input: { avatarPath: 'p' } })
        await flush()

        expect(await writtenHtml()).not.toContain('<img')
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('an avatar encode that throws means no avatar and the card still resolves', async () => {
        const h = harness({ encodeAvatar: vi.fn<EncodeAvatar>(async () => { throw new Error('decode failed') }) })
        h.tap({}, { input: { avatarPath: 'p' } })
        await flush()

        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('an encoder that never settles gives a card without the avatar at the avatar budget', async () => {
        vi.useFakeTimers()
        const h = harness({ encodeAvatar: vi.fn<EncodeAvatar>(() => new Promise<string | null>(() => {})) })
        h.tap({}, { input: { avatarPath: 'p' } })
        await vi.advanceTimersByTimeAsync(1999)
        expect(clipboard.write).toHaveBeenCalledTimes(1)
        let htmlSettled = false
        void clipboard.write.mock.calls[0][0][0].getType('text/html').then(() => { htmlSettled = true })
        await flush()
        expect(htmlSettled).toBe(false)

        await vi.advanceTimersByTimeAsync(2)
        await flush()

        expect(htmlSettled).toBe(true)
        expect(await writtenHtml()).not.toContain('<img')
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('a path lookup that never settles gives a card without the avatar at the avatar budget', async () => {
        vi.useFakeTimers()
        const h = harness()
        h.tap({}, { input: { avatarPath: 'p', resolveAvatarSrc: () => new Promise<string>(() => {}) } })

        await vi.advanceTimersByTimeAsync(2001)
        await flush()

        expect(h.env.encodeAvatar).not.toHaveBeenCalled()
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('an avatar that settles after the budget does not change the written card', async () => {
        vi.useFakeTimers()
        let finish!: (value: string) => void
        const h = harness({ encodeAvatar: vi.fn<EncodeAvatar>(() => new Promise<string | null>((resolve) => { finish = resolve })) })
        h.tap({}, { input: { avatarPath: 'p' } })
        await vi.advanceTimersByTimeAsync(2001)
        await flush()

        finish(AVATAR)
        await flush()

        expect(await writtenHtml()).not.toContain(AVATAR)
    })
})

describe('the card build: bounds and status', () => {
    test('a full card says copied', async () => {
        const h = harness()
        h.tap({}, { input: { avatarPath: 'p' } })
        await flush()

        expect(await writtenHtml()).toContain(AVATAR)
        expect(kinds(h.reports)).toEqual(['loading', 'copied'])
    })

    test('a body that never settles gives the minimal card at the deadline, and a late body changes nothing', async () => {
        vi.useFakeTimers()
        let finishBody!: (html: string) => void
        const h = harness()
        h.tap({}, { text: 'plain words', input: { parseBody: () => new Promise<string>((resolve) => { finishBody = resolve }) } })
        await vi.advanceTimersByTimeAsync(2999)
        expect(kinds(h.reports)).toEqual(['loading'])

        await vi.advanceTimersByTimeAsync(2)
        await flush()
        finishBody('<p>LATEBODY</p>')
        await flush()

        const html = await writtenHtml()
        expect(html).toContain('plain words')
        expect(html).not.toContain('LATEBODY')
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('a body that fails gives the minimal card and says simple card', async () => {
        const h = harness()
        h.tap({}, { text: 'plain words', input: { parseBody: async () => { throw new Error('parse failed') } } })
        await flush()

        expect(await writtenHtml()).toContain('plain words')
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('a body that throws synchronously gives the minimal card', async () => {
        const h = harness()
        h.tap({}, { text: 'plain words', input: { parseBody: () => { throw new Error('parse failed') } } })
        await flush()

        expect(await writtenHtml()).toContain('plain words')
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('a message over the limit takes the plain path before any card write; CJK text is counted in bytes', async () => {
        const cjk = 'あ'.repeat(310 * 1024)
        expect(cjk.length).toBeLessThan(900 * 1024)
        expect(utf8Bytes(cjk)).toBeGreaterThan(900 * 1024)
        const h = harness()
        h.tap({}, { text: cjk })
        await flush()

        expect(clipboard.write).not.toHaveBeenCalled()
        expect(clipboard.writeText).toHaveBeenCalledWith(cjk)
        expect(kinds(h.reports)).toEqual(['text'])
    })

    test('markup-heavy text is measured as the card it becomes', async () => {
        const heavy = '<'.repeat(300 * 1024)
        expect(utf8Bytes(heavy)).toBeLessThan(900 * 1024)
        const h = harness()
        h.tap({}, { text: heavy })
        await flush()

        expect(clipboard.write).not.toHaveBeenCalled()
        expect(kinds(h.reports)).toEqual(['text'])
    })

    test('a full card over the limit whose minimal card fits resolves the minimal card and says simple card', async () => {
        const h = harness({ limitBytes: 20 * 1024 })
        h.tap({}, { text: 'short', input: { parseBody: async () => `<p>${'x'.repeat(30 * 1024)}</p>` } })
        await flush()

        const html = await writtenHtml()
        expect(html).toContain('short')
        expect(html).not.toContain('xxxxxxxxxx')
        expect(kinds(h.reports)).toEqual(['loading', 'simple'])
    })

    test('a failure of the plain copy after an over-limit message is reported as a failure', async () => {
        clipboard.writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
        const execCommand = vi.fn(() => false)
        Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
        const h = harness({ limitBytes: 10 })
        h.tap({}, { text: 'this text is longer than ten bytes' })
        await flush()

        expect(h.reports).toEqual([{ kind: 'failed', errorName: 'NotAllowedError' }])
    })

    test('a ClipboardItem that cannot be constructed falls back to the plain copy and leaves nothing pending', async () => {
        const h = harness()
        const owner = {}
        vi.stubGlobal('ClipboardItem', function ThrowingClipboardItem() {
            throw new Error('construction failed')
        })
        h.tap(owner)
        await flush()

        expect(clipboard.write).not.toHaveBeenCalled()
        expect(clipboard.writeText).toHaveBeenCalledWith('hello')
        expect(kinds(h.reports)).toEqual(['text'])

        vi.unstubAllGlobals()
        vi.stubGlobal('fetch', fetchStub)
        h.tap(owner)
        await flush()
        expect(clipboard.write).toHaveBeenCalledTimes(1)
    })

    test('a capture that throws falls back to the plain copy', async () => {
        const h = harness()
        const owner = {}
        h.controller.start({
            owner,
            captureText: () => 'hello',
            captureCard: () => { throw new Error('model lookup failed') },
            report: (report) => h.reports.push(report),
        })
        await flush()

        expect(clipboard.write).not.toHaveBeenCalled()
        expect(clipboard.writeText).toHaveBeenCalledWith('hello')
        expect(kinds(h.reports)).toEqual(['text'])
        h.tap(owner)
        await flush()
        expect(clipboard.write).toHaveBeenCalledTimes(1)
    })

    test('a write that is rejected reports a failure with the error name', async () => {
        clipboard.write.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
        const h = harness()
        h.tap({})
        await flush()

        expect(h.reports).toEqual([{ kind: 'loading' }, { kind: 'failed', errorName: 'NotAllowedError' }])
    })

    test('a text that cannot be read reports a failure and writes nothing', async () => {
        const h = harness()
        h.controller.start({
            owner: {},
            captureText: () => { throw new TypeError('parse failed') },
            captureCard: () => makeInput(),
            report: (report) => h.reports.push(report),
        })
        await flush()

        expect(clipboard.write).not.toHaveBeenCalled()
        expect(h.reports).toEqual([{ kind: 'failed', errorName: 'TypeError' }])
    })

})

describe('concurrency (model tests against stub writes)', () => {
    test('a second card tap on the same message while its card is pending writes nothing more', async () => {
        clipboard.gate = makeGate()
        const h = harness()
        const owner = {}
        h.tap(owner)
        await flush()
        h.tap(owner)
        await flush()

        expect(clipboard.write).toHaveBeenCalledTimes(1)
        expect(kinds(h.reports)).toEqual(['loading', 'loading'])
        clipboard.gate.release()
    })

    test('the pending state clears when the write settles', async () => {
        const h = harness()
        const owner = {}
        h.tap(owner)
        await flush()
        h.tap(owner)
        await flush()

        expect(clipboard.write).toHaveBeenCalledTimes(2)
    })

    test('the pending state clears after the deadline plus the margin when the write never settles', async () => {
        vi.useFakeTimers()
        clipboard.gate = makeGate()
        const h = harness()
        const owner = {}
        h.tap(owner)
        await vi.advanceTimersByTimeAsync(4999)
        h.tap(owner)
        expect(clipboard.write).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(2)
        h.tap(owner)

        expect(clipboard.write).toHaveBeenCalledTimes(2)
        clipboard.gate.release()
    })

    test('a plain copy while the card html is unresolved rejects the html at once, without any timer firing, and leaves the plain text', async () => {
        // The clock never advances: only an abort at the plain copy can settle the
        // html before the deadline, so a missing abort cannot pass through it.
        vi.useFakeTimers()
        let finishBody!: (html: string) => void
        const h = harness()
        h.tap({}, { input: { parseBody: () => new Promise<string>((resolve) => { finishBody = resolve }) } })
        await flush()
        const item = clipboard.write.mock.calls[0][0][0]
        let htmlOutcome: unknown = 'unsettled'
        void item.getType('text/html').then(() => { htmlOutcome = 'resolved' }, (error: unknown) => { htmlOutcome = error })

        await clipboard.writeText('plain')
        h.controller.noteNewerPlainCopy('plain', () => {})
        await flush()

        expect(htmlOutcome).toBeInstanceOf(CardSupersededError)
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(kinds(h.reports)).toEqual(['loading', 'superseded'])
        finishBody('<p>late</p>')
    })

    test('a plain copy after the card html resolved is written again when the card write settles', async () => {
        clipboard.gate = makeGate()
        const h = harness()
        h.tap({})
        await flush()

        await clipboard.writeText('plain')
        h.controller.noteNewerPlainCopy('plain', () => {})
        await flush()
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)

        clipboard.gate.release()
        await flush()

        expect(clipboard.writeText).toHaveBeenCalledTimes(2)
        expect(clipboard.writeText).toHaveBeenLastCalledWith('plain')
        expect(kinds(h.reports)).toEqual(['loading', 'superseded'])
    })

    test('several plain copies during one resolved card write again only the latest text', async () => {
        clipboard.gate = makeGate()
        const h = harness()
        h.tap({})
        await flush()

        h.controller.noteNewerPlainCopy('first', () => {})
        h.controller.noteNewerPlainCopy('second', () => {})
        h.controller.noteNewerPlainCopy('third', () => {})
        clipboard.gate.release()
        await flush()

        expect(clipboard.writeText).toHaveBeenCalledTimes(1)
        expect(clipboard.writeText).toHaveBeenCalledWith('third')
    })

    test('a failed write-again is reported to the plain copy that asked for it', async () => {
        clipboard.gate = makeGate()
        Object.defineProperty(document, 'execCommand', { value: vi.fn(() => false), configurable: true })
        clipboard.writeText.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
        const h = harness()
        const onFailure = vi.fn()
        h.tap({})
        await flush()

        h.controller.noteNewerPlainCopy('plain', onFailure)
        clipboard.gate.release()
        await flush()

        expect(onFailure).toHaveBeenCalledWith({ ok: false, errorName: 'NotAllowedError' })
    })

    test('a plain copy with no card in flight writes nothing', async () => {
        const h = harness()

        h.controller.noteNewerPlainCopy('plain', () => {})
        await flush()

        expect(clipboard.writeText).not.toHaveBeenCalled()
    })

    test('a card tap on a different message supersedes the pending card at once, without any timer firing: its html is rejected and its status is superseded', async () => {
        // The clock never advances: only an abort at the second tap can settle the
        // first html before the deadline, so a missing abort cannot pass through it.
        vi.useFakeTimers()
        let finishBody!: (html: string) => void
        const h = harness()
        const first = h.reports
        h.tap({}, { input: { parseBody: () => new Promise<string>((resolve) => { finishBody = resolve }) } })
        await flush()
        let firstHtml: unknown = 'unsettled'
        void clipboard.write.mock.calls[0][0][0].getType('text/html').then(() => { firstHtml = 'resolved' }, (error: unknown) => { firstHtml = error })

        h.tap({}, { text: 'second', input: { parseBody: async () => '<p>second</p>' } })
        await flush()

        expect(firstHtml).toBeInstanceOf(CardSupersededError)
        expect(clipboard.write).toHaveBeenCalledTimes(2)
        expect(await writtenHtml(1)).toContain('second')
        expect(kinds(first)).toEqual(['loading', 'loading', 'superseded', 'copied'])
        finishBody('<p>late</p>')
    })

    test('a newer card waits for the older card write to settle before it resolves', async () => {
        clipboard.gate = makeGate()
        const h = harness()
        h.tap({}, { text: 'older' })
        await flush()

        h.tap({}, { text: 'newer' })
        await flush()
        let newerResolved = false
        void clipboard.write.mock.calls[1][0][0].getType('text/html').then(() => { newerResolved = true })
        await flush()
        expect(newerResolved).toBe(false)

        clipboard.gate.release()
        await flush()

        expect(newerResolved).toBe(true)
    })

    test('a newer card resolves at its own deadline even while the older write has not settled', async () => {
        vi.useFakeTimers()
        clipboard.gate = makeGate()
        const h = harness()
        h.tap({}, { text: 'older' })
        await vi.advanceTimersByTimeAsync(10)
        h.tap({}, { text: 'newer' })
        await vi.advanceTimersByTimeAsync(10)
        let newerResolved = false
        void clipboard.write.mock.calls[1][0][0].getType('text/html').then(() => { newerResolved = true })
        await vi.advanceTimersByTimeAsync(2000)
        expect(newerResolved).toBe(false)

        await vi.advanceTimersByTimeAsync(1001)

        expect(newerResolved).toBe(true)
        clipboard.gate.release()
    })

    test('the fallback plain copy of a later tap is written again after an older resolved card write settles', async () => {
        clipboard.gate = makeGate()
        const h = harness({ limitBytes: 10_000 })
        h.tap({}, { text: 'older' })
        await flush()

        h.tap({}, { text: 'x'.repeat(20_000) })
        await flush()
        expect(clipboard.writeText).toHaveBeenCalledTimes(1)

        clipboard.gate.release()
        await flush()

        expect(clipboard.writeText).toHaveBeenCalledTimes(2)
    })

    test('a superseded card whose write settles does not report a copy', async () => {
        clipboard.gate = makeGate()
        const h = harness()
        h.tap({})
        await flush()
        h.controller.noteNewerPlainCopy('plain', () => {})

        clipboard.gate.release()
        await flush()

        expect(kinds(h.reports)).not.toContain('copied')
        expect(kinds(h.reports)).not.toContain('failed')
    })

    test('a write that is rejected after the card was superseded is not reported as a failure', async () => {
        const gate = makeGate()
        clipboard.write.mockImplementationOnce(async (items: ClipboardItem[]) => {
            await items[0].getType('text/html')
            await gate.promise
            throw new DOMException('replaced', 'AbortError')
        })
        const h = harness()
        h.tap({})
        await flush()
        h.controller.noteNewerPlainCopy('plain', () => {})

        gate.release()
        await flush()

        expect(kinds(h.reports)).toEqual(['loading', 'superseded'])
    })
})

describe('the live document guard for a whole card run', () => {
    test('a full card run never asks the live document to create an element', async () => {
        const createElement = vi.spyOn(document, 'createElement')
        const createElementNS = vi.spyOn(document, 'createElementNS')
        try {
            const h = harness()
            h.tap({}, { input: { avatarPath: 'p', parseBody: async () => '<p>x <img src="https://x.example/a.png"></p>' } })
            await flush()

            expect(createElement).not.toHaveBeenCalled()
            expect(createElementNS).not.toHaveBeenCalled()
            expect(await writtenHtml()).toContain('https://x.example/a.png')
        } finally {
            createElement.mockRestore()
            createElementNS.mockRestore()
        }
    })
})

//#endregion
