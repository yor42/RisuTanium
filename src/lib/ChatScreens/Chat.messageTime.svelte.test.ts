// @vitest-environment jsdom

/**
 * The mobilechat message time follows the app language, live. REAL: `Chat.svelte`, the language module. MOCKED: the module set of
 * `Chat.lightSurface.svelte.test.ts`.
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
import { changeLanguage } from 'src/lang'
import Chat from './Chat.svelte'

const TIME = 1700000000000
const OPTIONS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit', month: '2-digit', day: '2-digit', hour12: false }
const textFor = (tag: string | undefined): string => new Intl.DateTimeFormat(tag, OPTIONS).format(TIME)

/** Two app languages whose text differs from the host's and from each other. */
function pickLanguages(): [string, string] {
    const host = textFor(undefined)
    const fit = ['en', 'ko', 'de', 'ja'].filter((tag) => textFor(tag) !== host)
    const first = fit[0]
    const second = fit.find((tag) => textFor(tag) !== textFor(first))
    if (!first || !second) throw new Error('no distinguishable locales on this host')
    return [first, second]
}

const targets: HTMLElement[] = []
const instances: unknown[] = []

function mountMobilechat(): HTMLElement {
    DBState.db = {
        askRemoval: false, instantRemove: false, translatorType: 'none', translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: true, zoomsize: 100, lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false, enableBookmark: true, createFolderOnBranch: false,
        iconsize: 100, memoryLimitThickness: 2, theme: 'mobilechat', guiHTML: '', roundIcons: false,
    } as never
    DBState.db.characters = [{
        chaId: 'char-1', type: 'character', ttsMode: 'none', chatPage: 0,
        chats: [{ id: 'chat-1', message: [{ role: 'char', data: 'hello', chatId: 'chat-id-1', time: TIME }], bookmarks: [], bookmarkNames: {} }],
    }] as never
    selIdState.selId = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(Chat, { target, props: { idx: 0, message: 'hello', isLastMemory: false, role: 'char' } }))
    flushSync()
    return target
}

const stampOf = (target: HTMLElement): string => target.querySelector<HTMLElement>('.bg-gray-100 span.text-xs')!.textContent!.trim()

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
    changeLanguage('en')
    document.documentElement.removeAttribute('lang')
    vi.clearAllMocks()
})

describe('the mobilechat message time', () => {
    test('shows the app language, and follows a switch without a remount', () => {
        const [first, second] = pickLanguages()
        changeLanguage(first)
        const target = mountMobilechat()
        expect(stampOf(target)).toBe(textFor(first))
        changeLanguage(second)
        flushSync()
        expect(stampOf(target)).toBe(textFor(second))
    })
})
