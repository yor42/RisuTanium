// @vitest-environment jsdom

/**
 * The real `DefaultChatScreen.svelte` under an installed chat surface, on the mock set of
 * `DefaultChatScreen.closeOnSettings.svelte.test.ts` (the message list is a stand-in that exposes its props). While
 * Settings covers the chat, a bookmark jump waits for the return, and a scroll event of the hidden list (zero
 * metrics) does not load more pages.
 *
 * Labels: R = regression reproducer (the base without the hold acts while hidden), G = guard (passes before and after).
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    chatsProps: null as null | { loadPages: number, windowResetToken: number },
    textareaScrollHeight: 0,
}))

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([])
    const additionalFloatingActionButtons = $state([])
    const chatPanelStore = $state([])
    const easyPanelStore = $state({ open: false })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        ReloadChatPointer: writable({} as Record<number, number>),
        settingsOpen: writable(false),
        MobileGUI: writable(false),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
        CharEmotion: writable({}),
        PlaygroundStore: writable(0),
        createSimpleCharacter: vi.fn(() => null),
        hypaV3ModalOpen: writable(false),
        ScrollToMessageStore: scrollToMessage,
        additionalChatMenu,
        additionalFloatingActionButtons,
        easyPanelStore,
        chatPanelStore,
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const chatFoldedState = $state<{ data: null }>({ data: null })
    const chatFoldedStateMessageIndex = $state({ index: -1 })
    return {
        aiLawApplies: vi.fn(() => false),
        chatFoldedState,
        chatFoldedStateMessageIndex,
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
        getFileSrc: vi.fn(async () => ''),
        saveAsset: vi.fn(async () => ''),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertWait: vi.fn(),
    alertClear: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/tokenizer'), () => ({
    tokenize: vi.fn(async () => 1),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('src/ts/util'), () => ({
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    checkPersonaBinded: vi.fn(() => false),
    selectSingleFile: vi.fn(),
    selectMultipleFile: vi.fn(),
    replacePlaceholders: vi.fn((s: string) => s),
    parseKeyValue: () => [],
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => false),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => ({ type: 'image', data: '' })),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/files/multisend'), () => ({
    postChatFile: vi.fn(async () => []),
}) as unknown as typeof import('src/ts/process/files/multisend'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
    stopTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
    snapshotSubject: vi.fn(),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'fail', result: 'not used' })),
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: {
        editinput: new Set(),
        editoutput: new Set(),
        editdisplay: new Set(),
        editprocess: new Set(),
    },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const liveState = stores.DBState as unknown as { db: { characters?: Array<{ chats: unknown[], chatPage: number }> } }
    const getCurrentCharacter = () => {
        liveState.db.characters ??= []
        return liveState.db.characters[get(stores.selectedCharID)]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => liveState.db),
        setDatabase: vi.fn(),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(() => {
            const char = getCurrentCharacter()
            return char?.chats?.[char.chatPage]
        }),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const cold = await import('src/ts/process/coldstorageData')
    return {
        coldStorageHeader: cold.coldStorageHeader,
        preLoadChat: vi.fn(async () => 'ok'),
        retryLegacyColdChatLoad: vi.fn(async () => 'ok'),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
    chatProcessStage: writable(0),
    sendChat: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('./Chats.svelte', () => ({
    default: (_target: unknown, props: { loadPages: number, windowResetToken: number }) => {
        h.chatsProps = props
        return { destroy: () => {} }
    },
}))
vi.mock('./Chat.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('./Suggestion.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../UI/MainMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))
vi.mock('../Playground/PlaygroundMenu.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

//#endregion

import { DBState, ScrollToMessageStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'

function installDb(messageCount: number) {
    DBState.db = {
        characters: [{
            chaId: 'cha-1',
            name: 'cha-1',
            type: 'character',
            chatPage: 0,
            chats: [{
                id: 'chat-1',
                message: Array.from({ length: messageCount }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}`, chatId: `id${i}` })),
                scriptstate: {}, note: '', localLore: [],
            }],
            triggerscript: [],
            customscript: [],
            globalLore: [],
            desc: '',
            firstMessage: 'first message',
            alternateGreetings: [],
            largePortrait: false,
            removedQuotes: true,
            creatorNotes: '',
            image: '',
            ttsMode: 'none',
            additionalAssets: [],
        }],
        modules: [],
        templateDefaultVariables: '',
        personas: [{ name: 'User', largePortrait: false, icon: '' }],
        selectedPersona: 0,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        translator: '',
        username: 'User',
        newMessageButtonStyle: 'bottom-center',
        fixedChatTextarea: false,
        useChatSticker: false,
        hypaV3: false,
        hypav2: false,
        sideMenuRerollButton: false,
        showMenuChatList: false,
        showMenuHypaMemoryModal: false,
        enableRisuaiProTools: false,
        sendWithEnter: true,
        useAutoSuggestions: false,
        subModel: '',
        supaModelType: 'none',
        autoSuggestClean: false,
        personaPrompt: '',
    } as never
    selectedCharID.set(0)
}

const mounted: Array<{ instance: unknown, target: HTMLElement }> = []

async function showScreen(messageCount = 200): Promise<HTMLElement> {
    installDb(messageCount)
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    await tick()
    flushSync()
    return target
}

async function openSettings() {
    settingsOpen.set(true)
    await tick()
    await tick()
}

async function closeSettings() {
    settingsOpen.set(false)
    await tick()
    await tick()
    flushSync()
}

beforeEach(() => {
    h.chatsProps = null
    h.textareaScrollHeight = 0
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => h.textareaScrollHeight })
    ScrollToMessageStore.value = -1
    settingsOpen.set(false)
    resetChatSurfaceForTests()
    installChatSurface()
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
})

describe('a bookmark jump chosen while Settings is open', () => {
    test('R T12 waits for the return', async () => {
        await showScreen()
        await openSettings()

        ScrollToMessageStore.value = 5
        flushSync()
        await tick()
        expect(ScrollToMessageStore.value).toBe(5)

        await closeSettings()
        expect(ScrollToMessageStore.value).toBe(-1)
    })

    test('G a jump chosen with Settings closed is taken at once', async () => {
        await showScreen()

        ScrollToMessageStore.value = 5
        flushSync()
        await tick()

        expect(ScrollToMessageStore.value).toBe(-1)
    })
})

describe('a scroll event of the list', () => {
    function scrollList(root: HTMLElement) {
        const list = root.querySelector('.default-chat-screen')
        if (!list) {
            throw new Error('the chat list element was not rendered')
        }
        list.dispatchEvent(new Event('scroll'))
        flushSync()
    }

    test('G T26 with Settings closed (zero metrics) loads more pages', async () => {
        const root = await showScreen()
        const before = h.chatsProps!.loadPages

        scrollList(root)

        expect(h.chatsProps!.loadPages).toBeGreaterThan(before)
    })

    test('R T26 while Settings is open loads nothing', async () => {
        const root = await showScreen()
        await openSettings()
        const before = h.chatsProps!.loadPages

        scrollList(root)

        expect(h.chatsProps!.loadPages).toBe(before)
    })
})

describe('the loaded pages across a Settings visit', () => {
    async function scrollMore(root: HTMLElement) {
        const list = root.querySelector('.default-chat-screen')
        if (!list) {
            throw new Error('the chat list element was not rendered')
        }
        list.dispatchEvent(new Event('scroll'))
        flushSync()
    }

    test('G T17 an unchanged page size keeps the pages scrolled to', async () => {
        const root = await showScreen()
        await scrollMore(root)
        const scrolledTo = h.chatsProps!.loadPages
        expect(scrolledTo).toBeGreaterThan(30)
        const token = h.chatsProps!.windowResetToken

        await openSettings()
        await closeSettings()

        expect(h.chatsProps!.loadPages).toBe(scrolledTo)
        expect(h.chatsProps!.windowResetToken).toBe(token)
    })

    test('R T17 a lowered page size resets the pages and signals the scroll back', async () => {
        const root = await showScreen()
        await scrollMore(root)
        const token = h.chatsProps!.windowResetToken

        await openSettings()
        DBState.db.chatLoadInitialPages = 20
        await closeSettings()

        expect(h.chatsProps!.loadPages).toBe(20)
        expect(h.chatsProps!.windowResetToken).toBe(token + 1)
    })

    test('R T17 a raised page size resets the pages without the scroll signal', async () => {
        const root = await showScreen()
        await scrollMore(root)
        const token = h.chatsProps!.windowResetToken

        await openSettings()
        DBState.db.chatLoadInitialPages = 80
        await closeSettings()

        expect(h.chatsProps!.loadPages).toBe(80)
        expect(h.chatsProps!.windowResetToken).toBe(token)
    })
})

describe('the composer textarea across a Settings visit', () => {
    test('R T18 takes its height from the measured scroll height once on release', async () => {
        const root = await showScreen()
        const textarea = root.querySelector('textarea')
        if (!textarea) {
            throw new Error('the composer textarea was not rendered')
        }
        await openSettings()
        h.textareaScrollHeight = 120
        expect(textarea.style.height).not.toBe('120px')

        await closeSettings()

        expect(textarea.style.height).toBe('120px')
    })
})
