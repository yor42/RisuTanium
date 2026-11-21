// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { COLD_TRANSFORM_HOOK_MS } from '../tests/coldTransform.test-helpers'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], hideAllImages: false } })
    return {
        DBState: state,
        selIdState: { selId: -1 },
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({}),
    }
})

vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async () => '',
    readImage: vi.fn(),
    saveAsset: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    getModules: () => [],
    moduleUpdate: () => {},
}))

vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

let parser: typeof import('./parser.svelte')

// The parser's graph is slow to transform cold; this hook pays that before any test starts.
beforeAll(async () => {
    parser = await import('./parser.svelte')
}, COLD_TRANSFORM_HOOK_MS)

const BREAK = 'hr[data-risu-scene-break]'

function dom(html: string): HTMLElement {
    const host = document.createElement('div')
    host.innerHTML = html
    return host
}

// The chat-body path: the real ParseMarkdown, then the real sanitizer.
async function finished(source: string): Promise<HTMLElement> {
    return dom(parser.trimMarkdown(await parser.ParseMarkdown(source, null, 'notrim')))
}

describe('a lone tilde line renders a scene divider through the chat-body path', () => {
    test('T-SB-1 between paragraphs it is an hr and no code block', async () => {
        const host = await finished('one\n\n~~~\n\ntwo')
        expect(host.querySelectorAll(BREAK)).toHaveLength(1)
        expect(host.querySelector('pre')).toBeNull()
        expect(Array.from(host.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['one', 'two'])
    })

    test('T-SB-2 a closed tilde fence stays code', async () => {
        const host = await finished('~~~\ncode\n~~~\n\nafter')
        expect(host.querySelector(BREAK)).toBeNull()
        expect(host.querySelector('pre')?.textContent).toContain('code')
        expect(host.querySelector('p')?.textContent).toBe('after')
    })

    test('T-SB-3 an info string stays code', async () => {
        const host = await finished('~~~ts\n\nx')
        expect(host.querySelector(BREAK)).toBeNull()
        expect(host.querySelector('pre')).not.toBeNull()
    })

    test('T-SB-4 the previous line does not matter', async () => {
        const host = await finished('Para\n~~~\n\nNext')
        expect(host.querySelectorAll(BREAK)).toHaveLength(1)
        expect(host.querySelector('pre')).toBeNull()
        expect(Array.from(host.querySelectorAll('p')).map((p) => p.textContent)).toEqual(['Para', 'Next'])
    })

    test('T-SB-5 four spaces of indent is not a break', async () => {
        const host = await finished('    ~~~\n\nx')
        expect(host.querySelector(BREAK)).toBeNull()
    })

    test('T-SB-6 two breaks give two dividers and three paragraphs', async () => {
        const host = await finished('one\n\n~~~\n\ntwo\n\n~~~\n\nthree')
        expect(host.querySelectorAll(BREAK)).toHaveLength(2)
        expect(host.querySelectorAll('p')).toHaveLength(3)
        expect(host.querySelector('pre')).toBeNull()
    })

    test('T-SB-6b the accepted exception draws divider, text, divider', async () => {
        const host = await finished('~~~\n\ntext\n\n~~~')
        expect(host.querySelectorAll(BREAK)).toHaveLength(2)
        expect(host.querySelector('p')?.textContent).toBe('text')
        expect(host.querySelector('pre')).toBeNull()
    })

    test('T-SB-7 a trailing lone line and a padded four-tilde line are breaks', async () => {
        const trailing = await finished('one\n\n~~~')
        expect(trailing.querySelectorAll(BREAK)).toHaveLength(1)
        expect(trailing.querySelector('pre')).toBeNull()
        const padded = await finished('one\n\n~~~~  \n\ntwo')
        expect(padded.querySelectorAll(BREAK)).toHaveLength(1)
        expect(padded.querySelector('pre')).toBeNull()
    })
})

describe('T-SB-8 / MC-239 the sanitizer keeps the marker and strips handlers', () => {
    const source = '<hr data-risu-scene-break onclick="alert(1)">'

    test('the real trimMarkdown keeps data-risu-scene-break and strips onclick', () => {
        const hr = dom(parser.trimMarkdown(source)).querySelector('hr')
        expect(hr).not.toBeNull()
        expect(hr?.hasAttribute('data-risu-scene-break')).toBe(true)
        expect(hr?.hasAttribute('onclick')).toBe(false)
    })

    test('the raw markup carries the onclick handler before sanitizing', () => {
        const hr = dom(source).querySelector('hr')
        expect(hr?.hasAttribute('onclick')).toBe(true)
    })

    test('the divider the rule renders survives the real trimMarkdown with its marker', async () => {
        const html = await parser.ParseMarkdown('one\n\n~~~\n\ntwo', null, 'notrim')
        expect(html).toContain('data-risu-scene-break')
        expect(parser.trimMarkdown(html)).toContain('data-risu-scene-break')
    })
})

describe('T-SB-9 every markdown instance renders the divider', () => {
    test('parseMarkdownSafe (md) renders it', () => {
        const host = dom(parser.parseMarkdownSafe('one\n\n~~~\n\ntwo'))
        expect(host.querySelectorAll(BREAK)).toHaveLength(1)
        expect(host.querySelector('pre')).toBeNull()
    })

    test('applyMarkdownToNode (mdLiteral) renders it', () => {
        const host = document.createElement('div')
        host.appendChild(document.createTextNode('one\n\n~~~\n\ntwo'))
        parser.applyMarkdownToNode(host)
        expect(host.querySelectorAll(BREAK)).toHaveLength(1)
        expect(host.querySelector('pre')).toBeNull()
    })

    test('the highlight instance (ParseMarkdown) renders it', async () => {
        const host = dom(await parser.ParseMarkdown('one\n\n~~~\n\ntwo', null, 'notrim'))
        expect(host.querySelectorAll(BREAK)).toHaveLength(1)
    })
})

describe('T-CSS-SB the divider stylesheet', () => {
    let css = ''
    let style: HTMLStyleElement | undefined
    let host: HTMLElement | undefined

    beforeAll(() => {
        css = readFileSync(path.join(process.cwd(), 'src/styles/scene-break.css'), 'utf8')
    })

    afterEach(() => {
        style?.remove()
        host?.remove()
        style = undefined
        host = undefined
    })

    function mountWith(extraCss: string): HTMLElement {
        style = document.createElement('style')
        style.textContent = css + '\n' + extraCss
        document.head.appendChild(style)
        host = document.createElement('div')
        host.className = 'chattext'
        host.innerHTML = '<hr data-risu-scene-break=""><hr>'
        document.body.appendChild(host)
        return host
    }

    test('only the scene divider is centred and narrowed; a plain rule is untouched', () => {
        const [divider, plain] = Array.from(mountWith('').querySelectorAll('hr'))
        expect(getComputedStyle(divider).marginInline).toBe('auto')
        expect(getComputedStyle(divider).inlineSize).toBe('30%')
        expect(getComputedStyle(plain).inlineSize).toBe('')
    })

    test('a later card .chattext hr rule overrides the divider', () => {
        const divider = mountWith('.chattext hr { margin-inline: 0; }').querySelector('hr') as HTMLElement
        expect(getComputedStyle(divider).marginInline).toBe('0px')
    })

    test('the divider declares no colour', () => {
        expect(css).not.toMatch(/\b(?:color|background(?:-color)?|border(?:-[a-z]+)?)\s*:/)
    })
})
