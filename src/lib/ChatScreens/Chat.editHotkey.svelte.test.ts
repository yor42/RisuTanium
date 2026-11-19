// @vitest-environment happy-dom

/**
 * The edit shortcut (Ctrl+Alt+E) focuses the editor that the real `Chat.svelte` mounts, through the real document
 * keydown listener `initHotkey()` registers. No flushSync after the key: the editor must be mounted by Svelte's own
 * scheduler, so focus has to wait for the flush that follows the click.
 */

import { mount, tick, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

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
        alertStore: writable({ type: 'none', msg: '' }),
        loadoutModalStore: { open: false },
        MobileGUIStack: writable(0),
        MobileSideBar: writable(0),
        openPersonaList: writable(false),
        openPresetList: writable(false),
        OpenRealmStore: writable(false),
        PlaygroundStore: writable(0),
        QuickSettings: { open: false, index: 0 },
        SafeModeStore: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    aiLawApplies: vi.fn(() => false),
    changeChatTo: vi.fn(),
    foldChatToMessage: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    createChatCopyName: vi.fn((name: string) => `${name} Branch`),
    downloadFile: vi.fn(),
    fetchNative: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getCurrentCharacter: vi.fn(() => null),
        getCurrentChat: vi.fn(() => null),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn(),
        changeToPreset: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertError: vi.fn(),
    alertMd: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertToast: vi.fn(),
    alertRequestLogs: vi.fn(),
    doingAlert: vi.fn(() => false),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    ParseMarkdown: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: vi.fn(async () => {}),
    findCharacterbyId: vi.fn(() => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
    changeChar: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    sendChat: vi.fn(),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('./ChatBody.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

import { DBState, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import { initHotkey } from 'src/ts/hotkey'
import Chat from './Chat.svelte'

function baseDb(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none', translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100, lineHeight: 1.25, enableBlockPartialEdit: false,
        enableDragPartialEdit: false, useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100, memoryLimitThickness: 2, theme: 'default',
        guiHTML: '', roundIcons: false, botPresets: [],
        ...overrides,
    }
}

const mounted: unknown[] = []
function mountChat(theme: string) {
    DBState.db = baseDb({ theme }) as never
    DBState.db.characters = [{ chaId: 'char-1', type: 'character', ttsMode: 'none', chatPage: 0, chats: [{ id: 'chat-1', message: [{ role: 'char', data: 'original text', chatId: 'chat-id-1' }], bookmarks: [], bookmarkNames: {} }] }] as never
    selIdState.selId = 0
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(Chat, { target, props: { idx: 0, message: 'original text', isLastMemory: false } }))
    return target
}

function pressEdit(): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, altKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ev)
    return ev
}

beforeAll(() => { initHotkey() })
beforeEach(() => {
    window.innerWidth = 1024
    selectedCharID.set(0)
    // clickQuery logs the clicked element, which dumps the mounted markup on every press.
    vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(async () => {
    vi.restoreAllMocks()
    for (const instance of mounted.splice(0)) await unmount(instance as never).catch(() => {})
    document.body.replaceChildren()
})

describe('the edit shortcut focuses the editor the chat mounts', () => {
    test.each(['default', 'cardboard'])('%s theme: the editor holds focus one tick after the key', async (theme) => {
        const target = mountChat(theme)
        await tick()
        expect(target.querySelector('.message-edit-area')).toBeNull()
        const ev = pressEdit()
        expect(ev.defaultPrevented).toBe(true)
        // No flushSync here: the editor has to be mounted by the scheduler, so the focus call must wait for it.
        await tick()
        const area = target.querySelector<HTMLTextAreaElement>('.message-edit-area')
        expect(area).not.toBeNull()
        expect(area!.value).toBe('original text')
        expect(document.activeElement).toBe(area)
    })
})
