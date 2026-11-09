// @vitest-environment jsdom

/**
 * The real `DefaultChatScreen.svelte` on the mock set of `DefaultChatScreen.surfaceHold.svelte.test.ts` (the message
 * list is a stand-in that exposes its props, except where a test mounts the real list). The mounted-row window of the
 * legacy list: a window grown past the cap shrinks back to the cap when the reader is back at the latest messages, and
 * stays put while an editor is open, away from the bottom, in the event that grew it, or under a fold.
 *
 * Labels: R = regression reproducer (the list never trimmed its window before), G = guard (a case the trim must not
 * act in).
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    chatsProps: null as null | { loadPages: number, windowResetToken: number },
    // The real Chats mounts its rows when set; otherwise the stand-in only exposes its props.
    realChats: false,
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

vi.mock('./Chats.svelte', async () => {
    const actual = await vi.importActual<{ default: (anchor: unknown, props: unknown) => unknown }>('./Chats.svelte')
    return {
        default: (anchor: unknown, props: { loadPages: number, windowResetToken: number }) => {
            h.chatsProps = props
            return h.realChats ? actual.default(anchor, props) : { destroy: () => {} }
        },
    }
})
vi.mock('./Chat.svelte', () => ({
    default: (anchor: unknown, props: { idx?: number }) => {
        // A marker per mounted row, removed with the row's container.
        if (h.realChats && typeof props?.idx === 'number') {
            const marker = document.createElement('span')
            marker.setAttribute('data-row-idx', String(props.idx))
            ;(anchor as ChildNode).before(marker)
        }
        return { destroy: () => {} }
    },
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

import { DBState, ScrollToMessageStore, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { chatFoldedStateMessageIndex } from 'src/ts/globalApi.svelte'
import { registerDraft, resetLocalDraftsForTest } from 'src/ts/localDrafts'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'

//#endregion

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

async function showScreen(messageCount: number, initialPages?: number): Promise<HTMLElement> {
    installDb(messageCount)
    if (initialPages !== undefined) {
        DBState.db.chatLoadInitialPages = initialPages
    }
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    await tick()
    flushSync()
    return target
}

beforeEach(() => {
    h.chatsProps = null
    h.realChats = false
    h.textareaScrollHeight = 0
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => h.textareaScrollHeight })
    ScrollToMessageStore.value = -1
    chatFoldedStateMessageIndex.index = -1
    settingsOpen.set(false)
    resetLocalDraftsForTest()
    resetChatSurfaceForTests()
    installChatSurface()
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetChatSurfaceForTests()
    resetLocalDraftsForTest()
    chatFoldedStateMessageIndex.index = -1
    settingsOpen.set(false)
    delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight
})

function listOf(root: HTMLElement): HTMLElement {
    const list = root.querySelector<HTMLElement>('.default-chat-screen')
    if (!list) {
        throw new Error('the chat list element was not rendered')
    }
    return list
}

// A scroll event with zero metrics reads as scrolled to the top: it grows the window.
function scrollToTop(root: HTMLElement) {
    listOf(root).dispatchEvent(new Event('scroll'))
    flushSync()
}

// Metrics of a long list scrolled to its bottom: the scroll origin of the reversed list is 0.
function scrollAtBottom(root: HTMLElement) {
    const list = listOf(root)
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 20000 })
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 700 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, writable: true, value: 0 })
    list.dispatchEvent(new Event('scroll'))
    flushSync()
}

async function growTo(root: HTMLElement, steps: number) {
    for (let i = 0; i < steps; i++) {
        scrollToTop(root)
    }
    await tick()
}

describe('the window of the legacy list when the reader is back at the latest messages', () => {
    test('R W1 a window grown past the cap shrinks to the cap', async () => {
        const root = await showScreen(300)
        await growTo(root, 6)
        expect(h.chatsProps!.loadPages).toBe(120)

        scrollAtBottom(root)

        expect(h.chatsProps!.loadPages).toBe(100)
    })

    test('R W1b a larger initial page setting is the cap', async () => {
        const root = await showScreen(300, 130)
        await growTo(root, 1)
        const grown = h.chatsProps!.loadPages
        expect(grown).toBeGreaterThan(130)

        scrollAtBottom(root)

        expect(h.chatsProps!.loadPages).toBe(130)
    })

    test('R W2 the trim unmounts exactly the oldest rows and keeps the newest nodes', async () => {
        h.realChats = true
        const root = await showScreen(300)
        await growTo(root, 6)
        const rowAt = () => new Map(Array.from(root.querySelectorAll('[data-row-idx]')).map((el) => [Number(el.getAttribute('data-row-idx')), el]))
        const before = rowAt()
        expect(before.size).toBe(120)

        scrollAtBottom(root)
        await tick()

        const after = rowAt()
        expect(after.size).toBe(100)
        expect(Math.min(...after.keys())).toBe(200)
        for (const [idx, el] of after) {
            expect(el).toBe(before.get(idx))
        }
    })

    test('G W3 an open message editor blocks the trim', async () => {
        const root = await showScreen(300)
        await growTo(root, 6)
        registerDraft('chat-edit-250')

        scrollAtBottom(root)

        expect(h.chatsProps!.loadPages).toBe(120)
    })

    test('G W4 a reader away from the bottom is not trimmed', async () => {
        const root = await showScreen(300)
        await growTo(root, 6)
        const lastEl = listOf(root).children[0].firstElementChild as HTMLElement
        lastEl.getBoundingClientRect = () => ({ top: 5000, bottom: 5100, left: 0, right: 0, width: 0, height: 100, x: 0, y: 5000, toJSON: () => ({}) })

        scrollAtBottom(root)

        expect(h.chatsProps!.loadPages).toBe(120)
    })

    test('G W5 a trim does not signal a scroll reset', async () => {
        const root = await showScreen(300)
        await growTo(root, 6)
        const token = h.chatsProps!.windowResetToken

        scrollAtBottom(root)

        expect(h.chatsProps!.loadPages).toBe(100)
        expect(h.chatsProps!.windowResetToken).toBe(token)
    })

    test('G W6 an event that grows the window does not also trim it', async () => {
        const root = await showScreen(300)

        await growTo(root, 7)

        expect(h.chatsProps!.loadPages).toBe(135)
    })

    test('G W7 an active fold blocks the trim', async () => {
        const root = await showScreen(300)
        await growTo(root, 6)
        chatFoldedStateMessageIndex.index = 50
        flushSync()

        scrollAtBottom(root)

        expect(h.chatsProps!.loadPages).toBe(120)
    })
})
