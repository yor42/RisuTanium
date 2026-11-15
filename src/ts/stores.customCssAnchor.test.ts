// @vitest-environment jsdom
/**
 * The CustomCSSStore subscriber must address the app's own `<style id="customcss">`, a direct child of body. The sanitizer
 * keeps `id="customcss"` on rendered card, regex and lorebook HTML, so a bare `#customcss` lookup can land on card markup
 * inside `#app` and overwrite it. REAL: stores.svelte.ts and the real trimMarkdown sanitizer. FAKED: only the file and
 * asset layer and the module list that the parser reaches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// The parser is imported first, as in the app, so its module-level effect runs after stores.svelte.ts has evaluated.
import { trimMarkdown } from './parser/parser.svelte'
import { CustomCSSStore } from './stores.svelte'

vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async () => '',
    setUsingSw: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
}))

vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    getModules: () => [],
    moduleUpdate: () => {},
}))

const CARD_MARKUP = '<div id="customcss">card content</div>'

function appWith(markup: string): HTMLElement {
    document.body.innerHTML = ''
    const app = document.createElement('div')
    app.id = 'app'
    app.innerHTML = markup
    document.body.appendChild(app)
    return app
}

function appStyle(): HTMLStyleElement {
    const style = document.createElement('style')
    style.id = 'customcss'
    document.body.appendChild(style)
    return style
}

beforeEach(() => {
    document.body.innerHTML = ''
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('CustomCSSStore anchor', () => {
    it('writes the css into the app style element and leaves a card element with the same id alone', () => {
        const app = appWith(CARD_MARKUP)
        const style = appStyle()
        const card = app.querySelector('div#customcss') as HTMLElement
        CustomCSSStore.set('.x{color:red}')
        expect(style.innerHTML).toBe('.x{color:red}')
        expect(card.innerHTML).toBe('card content')
        expect(document.querySelectorAll('body > #customcss')).toHaveLength(1)
    })

    it('creates the app style element as a direct body child when only a card element carries the id', () => {
        const app = appWith(CARD_MARKUP)
        const card = app.querySelector('div#customcss') as HTMLElement
        CustomCSSStore.set('.y{color:blue}')
        const created = document.querySelector('body > #customcss')
        expect(created).not.toBeNull()
        expect(created?.tagName).toBe('STYLE')
        expect(created?.parentElement).toBe(document.body)
        expect(created?.innerHTML).toBe('.y{color:blue}')
        expect(card.innerHTML).toBe('card content')
    })

    it('holds with the card element produced by the real sanitizer', () => {
        const sanitized = trimMarkdown(CARD_MARKUP)
        // Control: the sanitizer keeps the id, so this row depends on the anchor and not on a stripped attribute.
        expect(sanitized).toContain('id="customcss"')
        const app = appWith(sanitized)
        const style = appStyle()
        const card = app.querySelector('div#customcss') as HTMLElement
        CustomCSSStore.set('.z{color:green}')
        expect(style.innerHTML).toBe('.z{color:green}')
        expect(card.innerHTML).toBe('card content')
    })
})
