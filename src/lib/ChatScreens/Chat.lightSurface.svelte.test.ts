// @vitest-environment happy-dom

/**
 * Fixed dark text on the always-light surfaces of `Chat.svelte`: the
 * mobilechat bubble and the cardboard card's text area.
 *
 * Every assertion reads the rendered DOM (inline custom properties, classes);
 * no stylesheet is loaded under happy-dom, so the resolved colour of a class
 * such as `x-risu-button-default` is not computable here and is left to a
 * visual check. The real `Chat.svelte` is mounted with the heavy modules
 * mocked as in `Chat.messageEditor.svelte.test.ts`; the real parser is kept so
 * the card-HTML guard goes through the real `trimMarkdown` sanitizer.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
        CurrentTriggerIdStore: writable(null),
        popupStore: { children: null, mouseX: 0, mouseY: 0, openId: 0 },
        HideIconStore: writable(false),
        createSimpleCharacter: vi.fn(() => null),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    aiWatermarkingLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: vi.fn(() => ({})),
    getCurrentChat: vi.fn(() => null),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertSelect: vi.fn(async () => '1'),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { ColorSchemeTypeStore } from 'src/ts/gui/colorscheme'
import { LIGHT_SURFACE_FONT_COLORS } from 'src/ts/gui/lightSurface'
import { trimMarkdown } from 'src/ts/parser/parser.svelte'
import Chat from './Chat.svelte'

//#region fixtures

const targets: HTMLElement[] = []
const instances: unknown[] = []

function setup(theme: string, scheme: 'dark' | 'light', extra: Record<string, unknown> = {}): HTMLElement {
    ;(ColorSchemeTypeStore as unknown as { set(v: string): void }).set(scheme)
    DBState.db = {
        askRemoval: false,
        instantRemove: false,
        translatorType: 'none',
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        requestInfoInsideChat: false,
        clickToEdit: true,
        zoomsize: 100,
        lineHeight: 1.25,
        enableBlockPartialEdit: false,
        enableDragPartialEdit: false,
        useChatCopy: false,
        translator: '',
        swipe: false,
        showFirstMessagePages: false,
        enableBookmark: true,
        createFolderOnBranch: false,
        iconsize: 100,
        memoryLimitThickness: 2,
        theme,
        guiHTML: '',
        roundIcons: false,
        ...extra,
    } as never
    DBState.db.characters = [{
        chaId: 'char-1',
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats: [{
            id: 'chat-1',
            message: [{ role: 'char', data: 'hello', chatId: 'chat-id-1', time: 1700000000000 }],
            bookmarks: [],
            bookmarkNames: {},
        }],
    }] as never
    selIdState.selId = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(Chat, { target, props: { idx: 0, message: 'hello', isLastMemory: false, role: 'char' } }))
    flushSync()
    return target
}

function chattext(target: HTMLElement): HTMLElement {
    const el = target.querySelector<HTMLElement>('.chattext')
    expect(el, 'the message text span').not.toBeNull()
    return el!
}

/** The nearest ancestor of `el` that carries the fixed font colour variables, if any. */
function lightSurfaceOf(el: HTMLElement): HTMLElement | null {
    for (let p = el.parentElement; p; p = p.parentElement) {
        if (p.style.getPropertyValue('--FontColorStandard') !== '') {
            return p
        }
    }
    return null
}

beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
})

afterEach(async () => {
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.clearAllMocks()
})

//#endregion

const SCHEMES = ['dark', 'light'] as const

describe('light surfaces: mobilechat bubble and cardboard card', () => {
    for (const theme of ['mobilechat', 'cardboard']) {
        for (const scheme of SCHEMES) {
            test(`${theme} with the colour scheme store at ${scheme}: the text sits under a wrapper holding every fixed font colour`, () => {
                const target = setup(theme, scheme)
                const wrapper = lightSurfaceOf(chattext(target))
                expect(wrapper).not.toBeNull()
                for (const [name, value] of Object.entries(LIGHT_SURFACE_FONT_COLORS)) {
                    expect(wrapper!.style.getPropertyValue(name)).toBe(value)
                }
            })

            test(`${theme} with the colour scheme store at ${scheme}: the wrapper leaves the theme text colours alone`, () => {
                const target = setup(theme, scheme)
                const wrapper = lightSurfaceOf(chattext(target))!
                expect(wrapper.style.getPropertyValue('--color-textcolor')).toBe('')
                expect(wrapper.style.getPropertyValue('--color-textcolor2')).toBe('')
                expect(chattext(target).style.getPropertyValue('--color-textcolor')).toBe('')
            })

            test(`${theme} with the colour scheme store at ${scheme}: the message text is not inverted`, () => {
                const target = setup(theme, scheme)
                expect(chattext(target).classList.contains('prose-invert')).toBe(false)
            })
        }
    }

    for (const scheme of SCHEMES) {
        test(`the default theme with the store at ${scheme} has no fixed colour wrapper and keeps prose-invert`, () => {
            const target = setup('default', scheme)
            expect(lightSurfaceOf(chattext(target))).toBeNull()
            expect(chattext(target).classList.contains('prose-invert')).toBe(true)
        })
    }

    test('the mobilechat timestamp uses the fixed gray text, not the theme colour', () => {
        const target = setup('mobilechat', 'light')
        const stamp = target.querySelector<HTMLElement>('.bg-gray-100 span.text-xs')
        expect(stamp).not.toBeNull()
        expect(stamp!.classList.contains('text-gray-600')).toBe(true)
        expect(stamp!.classList.contains('text-textcolor2')).toBe(false)
    })
})

describe('light surfaces: editor text colour', () => {
    test('the mobilechat editor textarea has dark text and not the theme text colour', () => {
        const target = setup('mobilechat', 'light')
        chattext(target).click()
        flushSync()
        const area = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
        expect(area.classList.contains('text-gray-800')).toBe(true)
        expect(area.classList.contains('text-textcolor')).toBe(false)
    })

    // Guard: the default theme's editor keeps the theme text colour.
    test('the default theme editor textarea keeps the theme text colour', () => {
        const target = setup('default', 'light')
        target.querySelector<HTMLButtonElement>('.button-icon-edit')!.click()
        flushSync()
        const area = target.querySelector<HTMLTextAreaElement>('textarea.message-edit-area')!
        expect(area.classList.contains('text-textcolor')).toBe(true)
        expect(area.classList.contains('text-gray-800')).toBe(false)
    })
})

describe('light surfaces: card and user HTML', () => {
    // The sanitizer prefixes author classes; the wrapper neither strips nor renames them,
    // and defines no theme background variable that the prefixed classes read.
    for (const theme of ['mobilechat', 'cardboard']) {
        test(`${theme}: card HTML placed in the message text keeps its x-risu- classes inside the light surface`, () => {
            const target = setup(theme, 'light')
            const text = chattext(target)
            text.innerHTML = trimMarkdown('<button class="button-default">Go</button><div class="risu-comment">note</div>')

            const wrapper = lightSurfaceOf(text)
            const button = text.querySelector('button')!
            const comment = text.querySelector('div')!
            expect(wrapper!.contains(button)).toBe(true)
            expect(button.classList.contains('x-risu-button-default')).toBe(true)
            expect(comment.classList.contains('x-risu-risu-comment')).toBe(true)
            expect(wrapper!.style.getPropertyValue('--color-darkbutton')).toBe('')
            expect(wrapper!.style.getPropertyValue('--color-darkbg')).toBe('')
        })
    }
})
