// @vitest-environment jsdom

/**
 * The real `DefaultChatScreen.svelte` on the mock set of `DefaultChatScreen.surfaceHold.svelte.test.ts`. The message
 * list is a stand-in that exposes the real `holdRows` contract on a list node, so the attribute `data-risu-cv-hold` on
 * that node shows when the screen holds the rows. A bookmark jump and a screenshot run under the hold, and it ends two
 * frames after they end. `requestAnimationFrame` is driven by hand.
 *
 * Labels: R = regression reproducer (must fail on the base without the hold).
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    list: null as null | HTMLElement,
    toCanvasSamples: [] as boolean[],
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

vi.mock('html-to-image', () => ({
    toCanvas: vi.fn(async () => {
        h.toCanvasSamples.push(h.list?.hasAttribute('data-risu-cv-hold') ?? false)
        return { height: 1, width: 1, remove: () => {} }
    }),
}))

// The stand-in exposes the real hold on a list node, as Chats.svelte does.
vi.mock('./Chats.svelte', async () => {
    const { holdRowLayout } = await import('src/ts/gui/legacyRowVisibility')
    return {
        default: (_target: unknown, _props: unknown) => ({
            destroy: () => {},
            holdRows: () => h.list ? holdRowLayout(h.list) : () => {},
        }),
    }
})
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
import { language } from 'src/lang'

const HOLD = 'data-risu-cv-hold'

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

async function settleMicrotasks(rounds = 30) {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve()
        await tick()
        flushSync()
    }
}

let frameQueue = new Map<number, () => void>()
let nextFrameId = 1

function runFrame() {
    const batch = [...frameQueue.values()]
    frameQueue = new Map()
    batch.forEach((cb) => cb())
}

const held = () => h.list!.hasAttribute(HOLD)

beforeEach(() => {
    h.list = document.createElement('div')
    h.list.setAttribute('data-part', 'chat-messages')
    document.body.appendChild(h.list)
    h.toCanvasSamples = []
    frameQueue = new Map()
    nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
        const id = nextFrameId++
        frameQueue.set(id, cb)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frameQueue.delete(id) })
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
    document.body.replaceChildren()
    h.list = null
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    vi.unstubAllGlobals()
})

describe('a bookmark jump', () => {
    test('R T4d every scroll of the jump runs under the hold, and it ends two frames after the jump', async () => {
        await showScreen()
        const samples: boolean[] = []
        for (const index of [2, 5]) {
            const element = document.createElement('div')
            element.setAttribute('data-chat-index', String(index))
            ;(element as unknown as { scrollIntoView: () => void }).scrollIntoView = () => { samples.push(held()) }
            document.body.appendChild(element)
        }

        ScrollToMessageStore.value = 5
        flushSync()
        await settleMicrotasks()

        expect(samples.length).toBeGreaterThanOrEqual(3)
        expect(samples.every((value) => value)).toBe(true)
        expect(held()).toBe(true)
        runFrame()
        expect(held()).toBe(true)
        runFrame()
        expect(held()).toBe(false)
    })
})

describe('a screenshot', () => {
    test('R T4e the capture runs under the hold, and it ends two frames after the run', async () => {
        const target = await showScreen()
        const rows = document.createElement('div')
        rows.className = 'default-chat-screen'
        const chat = document.createElement('div')
        chat.className = 'risu-chat'
        rows.append(chat)
        document.body.append(rows)

        const menuButton = [...target.querySelectorAll('button')].find((button) => button.querySelector('svg.lucide-menu'))
        expect(menuButton).toBeDefined()
        menuButton!.click()
        flushSync()
        await tick()
        const item = [...target.querySelectorAll('div.cursor-pointer')].find((node) => node.textContent?.trim() === language.screenshot)
        expect(item).toBeDefined()
        ;(item as HTMLElement).click()
        await settleMicrotasks()

        expect(h.toCanvasSamples.length).toBeGreaterThan(0)
        expect(h.toCanvasSamples.every((value) => value)).toBe(true)
        expect(held()).toBe(true)
        runFrame()
        expect(held()).toBe(true)
        runFrame()
        expect(held()).toBe(false)
    })
})
