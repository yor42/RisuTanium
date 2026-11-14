// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import type { Message } from '../../ts/storage/database.svelte'

const scheme = vi.hoisted(() => ({ store: null as null | import('svelte/store').Writable<'dark' | 'light'> }))
vi.mock('../../ts/gui/colorscheme', async () => {
    const { writable } = await import('svelte/store')
    scheme.store = writable<'dark' | 'light'>('dark')
    return { ColorSchemeTypeStore: scheme.store }
})
vi.mock('../../ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { zoomsize: 120, lineHeight: 1.5, roundIcons: false } as Record<string, unknown> })
    const selIdState = $state({ selId: 0 })
    return { DBState, selIdState, HideIconStore: writable(false) }
})
vi.mock('../ChatScreens/ChatBody.svelte', () => ({ default: (anchor: Comment) => {
    const node = document.createElement('p')
    node.className = 'card-paragraph'
    node.textContent = 'body'
    anchor.before(node)
    return {}
} }))
vi.mock('./StreamingView.svelte', () => ({ default: () => ({}) }))
vi.mock('../ChatScreens/chatSurface.svelte', () => {
    const chatSurface = $state({ rebuildEpoch: 0, closeEpoch: 0 })
    return { chatSurface, isChatSurfaceInstalled: () => false }
})
vi.mock('../../ts/globalApi.svelte', () => ({ aiLawApplies: () => false }))
vi.mock('../../ts/storage/database.svelte', () => ({ getCurrentCharacter: () => null }))
vi.mock('../../ts/parser/parser.svelte', () => ({ ParseMarkdown: async (text: string) => text }))
vi.mock('../../ts/parser/chatML', () => ({}))
vi.mock('../../ts/process/moduleRefList', () => ({ hasModuleStubs: () => false }))
vi.mock('../../ts/process/moduleEnsure', () => ({ ensureCurrentModulesOrAlert: async () => true }))
vi.mock('../../ts/translator/translator', () => ({ getLLMCache: async () => null }))
vi.mock('../../ts/process/ttsModes', () => ({ isTTSVoiceMode: () => false }))
vi.mock('../../ts/process/scripts', () => ({ risuChatParser: (text: string) => text }))
vi.mock('../../ts/process/displayParseOptions', () => ({ buildDisplayParseOptions: () => ({}) }))
vi.mock('../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertRequestData: vi.fn() }))
vi.mock('../../ts/process/messageActions.svelte', () => ({ handleButtonTriggerWithin: vi.fn(), handleFormTriggerWithin: vi.fn(), playMessageTTS: vi.fn() }))
vi.mock('../../ts/process/messageEditorController.svelte', () => ({ createMessageEditorController: () => ({
    editMode: false, editTranslationMode: false, translationViewControlsDisabled: false,
    translationEditControlDisabled: false, originalEditControlDisabled: false, dispose: () => {},
}) }))
vi.mock('../ChatScreens/PartialEditController.svelte', () => ({ default: () => ({}) }))
vi.mock('./MessageEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('./TranslationEditor.svelte', () => ({ default: () => ({}) }))
vi.mock('../../ts/characters', () => ({ getCharImage: async () => null }))
vi.mock('../../ts/model/modellist', () => ({ getModelInfo: () => ({ shortName: 'model' }) }))
vi.mock('../../lang', () => ({ language: {} }))

import ShellMessage from './ShellMessage.svelte'
import { DBState } from '../../ts/stores.svelte'

let app: ReturnType<typeof ShellMessage> | undefined
let target: HTMLElement
let style: HTMLStyleElement | undefined
async function show() {
    target = document.createElement('div')
    document.body.appendChild(target)
    const message: Message = { role: 'char', data: 'Hello', chatId: 'm' }
    app = mount(ShellMessage, { target, props: { idx: 0, chatId: 'm', name: 'Ari', message } })
    flushSync()
    await tick()
    return target.querySelector<HTMLElement>('[data-part="chat-message-body"]') as HTMLElement
}
afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    target?.remove()
    style?.remove()
    style = undefined
    scheme.store?.set('dark')
    DBState.db.roundIcons = false
})

describe('ShellMessage body presentation wrapper', () => {
    test('the body carries the old row classes and the zoom and line-height styles', async () => {
        const body = await show()
        for (const name of ['text', 'chat-width', 'chattext', 'prose', 'minw-0', 'prose-invert']) expect(body.classList.contains(name)).toBe(true)
        expect(body.style.fontSize).toBe(`${0.875 * 1.2}rem`)
        expect(body.style.lineHeight).toBe(`${1.5 * 1.2}rem`)
    })

    test('prose-invert follows the old row rule: any non-empty colour scheme value turns it on', async () => {
        const body = await show()
        scheme.store?.set('light')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(true)
        scheme.store?.set('' as 'dark')
        flushSync()
        expect(body.classList.contains('prose-invert')).toBe(false)
    })

    test('card CSS rewritten to .chattext reaches the body content', async () => {
        style = document.createElement('style')
        style.textContent = '.chattext .card-paragraph { color: rgb(1, 2, 3); }'
        document.head.appendChild(style)
        const body = await show()
        const paragraph = body.querySelector<HTMLElement>('.card-paragraph')
        expect(paragraph).not.toBeNull()
        expect(getComputedStyle(paragraph as HTMLElement).color).toBe('rgb(1, 2, 3)')
    })

    test('roundIcons marks the avatar round', async () => {
        DBState.db.roundIcons = true
        await show()
        await tick()
        await tick()
        const avatar = target.querySelector('[data-part="chat-message-avatar"]')
        expect(avatar).not.toBeNull()
        expect(avatar?.hasAttribute('data-round')).toBe(true)
        DBState.db.roundIcons = false
        flushSync()
        expect(avatar?.hasAttribute('data-round')).toBe(false)
    })
})

// UI-S6 I4a (MC-1708, MC-1828): the message font cascade. jsdom proves selector matching, source order and specificity of the
// app's font-family rules, never a resolved font: var() stays unresolved, and after the app's prose rule only the first element
// read in a document computes ties correctly. So each computed read opens its own document, and code is judged by the declared
// value of the last of the `*` rule and the message-body rules of the app sheet that matches it.
interface DomHandle { window: Window & typeof globalThis }
const openDocument: (html: string) => DomHandle = (html) => new JSDOM(html)
const APP_STYLES = readFileSync(path.join(process.cwd(), 'src/styles.css'), 'utf8')
const CONSUMER = 'var(--chat-message-font, var(--risu-font-family))'
const RESTORE = 'var(--risu-font-family)'

/** The top-level style rules of the app stylesheet that declare font-family, in file order. */
function appFontRules(css: string): string[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules: string[] = []
    let depth = 0
    let open = 0
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '{') {
            if (depth === 0) open = i
            depth++
        } else if (text[i] === '}') {
            depth--
            if (depth === 0) {
                let from = open - 1
                while (from >= 0 && text[from] !== '}' && text[from] !== ';') from--
                const head = text.slice(from + 1, open).trim()
                const block = text.slice(open + 1, i)
                if (!head.startsWith('@') && /font-family\s*:/.test(block)) rules.push(`${head} {${block}}`)
            }
        }
    }
    return rules
}
const APP_FONT_RULES = appFontRules(APP_STYLES)

const CARD_RULES = '.chattext .x-risu-foo{font-family:Courier}.chattext *{font-family:CardStar}.chattext em{font-family:Elem}'
const CUSTOM_CSS = '*{font-family:UserStar}code{font-family:UserCode}kbd{font-family:UserKbd}pre{font-family:UserPre}'
const BODY_HTML = '<div data-part="chat-message-body" class="text chat-width chattext prose minw-0" id="body">text'
    + '<p id="p">para <em id="cardelem">em</em></p>'
    + '<b id="cardclass" class="x-risu-foo">c</b><span id="inline" style="font-family:Inline">i</span>'
    + '<div class="x-risu-wrap"><span id="wrapchild">w</span></div>'
    + '<pre id="pre"><code id="code"><span id="hl">x</span></code></pre>'
    + '<p><code id="icode"><span id="icodes">y</span></code> <kbd id="kbd">k</kbd> <samp id="samp"><span id="samps">s</span></samp></p></div>'
    + '<div class="chattext prose" id="legacy"><p id="legacyp">legacy</p></div>'

interface PageOptions { head?: string, bodyEnd?: string }
const pageHtml = (options: PageOptions): string => `<!doctype html><html><head>${options.head ?? ''}<style id="app">${APP_FONT_RULES.join('\n')}</style></head><body>${BODY_HTML}${options.bodyEnd ?? ''}</body></html>`
/** The computed font-family of one element, read once in its own fresh document. */
function freshFamily(id: string, options: PageOptions = {}): string {
    const { window } = openDocument(pageHtml(options))
    const element = window.document.getElementById(id)
    if (!element) throw new Error(`no element ${id}`)
    return window.getComputedStyle(element).fontFamily
}
/** The font-family the last app rule matching the element declares (of `*` and the rules naming the message body), no computed read. */
function declaredFamily(id: string): string {
    const { window } = openDocument(pageHtml({}))
    const element = window.document.getElementById(id)
    const sheet = (window.document.getElementById('app') as HTMLStyleElement).sheet
    if (!element || !sheet) throw new Error(`no element or sheet for ${id}`)
    let value = ''
    for (const rule of Array.from(sheet.cssRules)) {
        if (!('selectorText' in rule)) continue
        const styleRule = rule as CSSStyleRule
        if (!(styleRule.selectorText === '*' || styleRule.selectorText.includes('chat-message-body'))) continue
        if (element.matches(styleRule.selectorText)) value = styleRule.style.getPropertyValue('font-family')
    }
    return value
}

describe('MC-1708: the message font cascade (selector order and specificity)', () => {
    test('the app stylesheet yields the font rules the cascade tests read', () => {
        expect(APP_FONT_RULES.some((rule) => rule.startsWith('* '))).toBe(true)
        expect(APP_FONT_RULES.some((rule) => rule.includes('chat-message-body'))).toBe(true)
    })

    test.each(['body', 'p', 'wrapchild'])('J1a: %s declares the consumer rule', (id) => {
        expect(freshFamily(id)).toBe(CONSUMER)
    })

    test('J1b: a pack :root value sets the token and the consumer still declares the fallback form', () => {
        const head = '<style id="pack">:root{--chat-message-font:"pack-x"}</style>'
        const { window } = openDocument(pageHtml({ head }))
        expect(window.getComputedStyle(window.document.documentElement).getPropertyValue('--chat-message-font')).toBe('"pack-x"')
        expect(freshFamily('p', { head })).toBe(CONSUMER)
    })

    test.each([
        ['a card class rule', 'cardclass', 'Courier'],
        ['a card universal rule', 'wrapchild', 'CardStar'],
        ['a card element rule', 'cardelem', 'Elem'],
        ['an inline style', 'inline', 'Inline'],
    ])('J1c: %s keeps its font', (_name, id, value) => {
        expect(freshFamily(id, { head: `<style id="card">${CARD_RULES}</style>` })).toBe(value)
    })

    test.each([
        ['the body under a Custom CSS universal rule', 'body', 'UserStar'],
        ['a paragraph under a Custom CSS universal rule', 'p', 'UserStar'],
        ['code under a Custom CSS element rule', 'code', 'UserCode'],
        ['kbd under a Custom CSS element rule', 'kbd', 'UserKbd'],
        ['pre under a Custom CSS element rule', 'pre', 'UserPre'],
    ])('J1c: %s wins', (_name, id, value) => {
        expect(freshFamily(id, { bodyEnd: `<style id="customcss">${CUSTOM_CSS}</style>` })).toBe(value)
    })

    test.each(['body', 'p'])('J1d: the oracle (`*` and message-body rules) gives %s the consumer value', (id) => {
        expect(declaredFamily(id)).toBe(CONSUMER)
    })

    test.each(['pre', 'code', 'kbd', 'samp', 'samps', 'hl', 'icodes', 'icode'])('J1d: the oracle (`*` and message-body rules) restores the user font on %s', (id) => {
        expect(declaredFamily(id)).toBe(RESTORE)
    })

    test('J1e: a legacy message surface without the body part keeps the plain rule', () => {
        expect(freshFamily('legacyp')).toBe(RESTORE)
        expect(freshFamily('legacy')).toBe(RESTORE)
    })
})
