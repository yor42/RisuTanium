// @vitest-environment jsdom

/**
 * Opening Settings closes the composer menu and the sticker row of `DefaultChatScreen.svelte`.
 *
 * Mounts the REAL `DefaultChatScreen.svelte` on the mock set of
 * `DefaultChatScreen.chatPanel.svelte.test.ts`, with a selected character and the sticker
 * feature on. The surface's close signal is driven by bumping `chatSurface.closeEpoch`, which is
 * what the surface does when Settings opens.
 *
 * Invariants pinned here:
 *  - the composer's side menu and the sticker row are closed after Settings opens;
 *  - they stay open when the signal does not fire.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
    default: (_target: unknown) => ({ destroy: () => {} }),
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

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { chatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'

function installDb() {
    DBState.db = {
        characters: [{
            chaId: 'cha-1',
            name: 'cha-1',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'chat-1', message: [], scriptstate: {}, note: '', localLore: [] }],
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
        useChatSticker: true,
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

async function showComposer(): Promise<HTMLElement> {
    installDb()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    await tick()
    flushSync()
    return target
}

function menuButton(root: HTMLElement): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>('button.rounded-r-md')!
}

function stickerToggle(root: HTMLElement): HTMLElement {
    return root.querySelector<HTMLElement>('div.bg-textcolor2')!
}

/** The sticker toggle first: a click anywhere else in the composer closes the side menu, the menu button's own click does not bubble. */
function openBoth(root: HTMLElement) {
    stickerToggle(root).click()
    flushSync()
    menuButton(root).click()
    flushSync()
}

function menuIsOpen(root: HTMLElement): boolean {
    return root.querySelector('div.right-2.bottom-16') !== null
}

function stickersAreOpen(root: HTMLElement): boolean {
    return stickerToggle(root).classList.contains('text-green-500')
}

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetChatSurfaceForTests()
})

describe('DefaultChatScreen: opening Settings closes the composer menus', () => {
    test('the side menu and the sticker row close', async () => {
        const root = await showComposer()
        openBoth(root)
        expect(menuIsOpen(root)).toBe(true)
        expect(stickersAreOpen(root)).toBe(true)

        chatSurface.closeEpoch += 1
        flushSync()

        expect(menuIsOpen(root)).toBe(false)
        expect(stickersAreOpen(root)).toBe(false)
    })

    test('guard: without the close signal both stay open', async () => {
        const root = await showComposer()
        openBoth(root)

        expect(menuIsOpen(root)).toBe(true)
        expect(stickersAreOpen(root)).toBe(true)
    })
})
