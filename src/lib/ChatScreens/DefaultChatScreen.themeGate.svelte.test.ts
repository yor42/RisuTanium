// @vitest-environment jsdom

/**
 * `DefaultChatScreen.svelte` never declares the chat surface to the theme-pack gate (T3G-5), all GUARD: the gate is new
 * code, so no base fails for a reason other than a missing module. Home, Utility, the playground menu and the classic chat
 * are all screens a chat sheet was not judged against, so the gate shows nothing while any of them is mounted.
 *
 * REAL: `DefaultChatScreen.svelte`, `surfaceGate.svelte.ts`, the page-mode store. MOCKED: everything `DefaultChatScreen`
 * imports, as in `DefaultChatScreen.utility.svelte.test.ts`; the Home shell, Utility and playground screens are marker stubs.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({ desktop: true }))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isDesktopTransport: () => h.desktop,
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([])
    const additionalFloatingActionButtons = $state([])
    const easyPanelStore = $state({ open: false })
    const chatPanelStore = $state([])
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
    const DBState = stores.DBState as unknown as { db: { characters?: Array<{ chats?: unknown[], chatPage: number }> } }
    const current = () => DBState.db.characters?.[get(stores.selectedCharID)]
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn(),
        getCurrentCharacter: vi.fn(current),
        getCurrentChat: vi.fn(() => current()?.chats?.[current()!.chatPage]),
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
    default: (_anchor: unknown) => {},
}))
vi.mock('./Chat.svelte', () => ({
    default: (_anchor: unknown) => {},
}))
vi.mock('./Suggestion.svelte', () => ({
    default: (_anchor: unknown) => {},
}))
vi.mock('../Playground/PlaygroundMenu.svelte', async () => {
    const { createRawSnippet } = await import('svelte')
    return { default: createRawSnippet(() => ({ render: () => '<span>playground-stub</span>' })) }
})
vi.mock('../UI/Home/HomeShell.svelte', async () => {
    const { createRawSnippet } = await import('svelte')
    return { default: createRawSnippet(() => ({ render: () => '<span>main-menu-stub</span>' })) }
})
vi.mock('../Utility/UtilityScreen.svelte', async () => {
    const { createRawSnippet } = await import('svelte')
    return { default: createRawSnippet(() => ({ render: () => '<span>utility-screen-stub</span>' })) }
})

//#endregion

import { resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { DBState, PlaygroundStore, selectedCharID } from 'src/ts/stores.svelte'
import { installThemePackGate, resetThemePackGateForTests, shownSurface } from 'src/ts/themePack/surfaceGate.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { utilityOpen } from '../Utility/utilityGate'

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function marker(root: HTMLElement): string[] {
    const found: string[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeValue?.endsWith('-stub')) found.push(node.nodeValue)
    }
    return found
}

beforeEach(() => {
    h.desktop = true
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
            firstMessage: 'greeting',
            alternateGreetings: [],
            largePortrait: false,
            removedQuotes: true,
            creatorNotes: '',
            image: '',
            ttsMode: 'none',
            additionalAssets: [],
        }],
        modules: [],
        newMessageButtonStyle: 'bottom-center',
        fixedChatTextarea: false,
        hypaV3: false,
        hypav2: false,
        personas: [{ name: 'User', largePortrait: false, icon: '' }],
        selectedPersona: 0,
        presetRegex: [],
    } as never
    selectedCharID.set(-1)
    PlaygroundStore.set(0)
    resetPageStorageModeForTests()
    utilityOpen.set(false)
    installThemePackGate(() => false)
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    resetThemePackGateForTests()
    utilityOpen.set(false)
    PlaygroundStore.set(0)
    selectedCharID.set(-1)
    resetPageStorageModeForTests()
})

describe('DefaultChatScreen leaves the gate with nothing shown', () => {
    test('Home (no character selected)', async () => {
        const root = open()
        await tick()
        expect(marker(root)).toEqual(['main-menu-stub'])
        expect(shownSurface()).toBeNull()
    })

    test('Utility', async () => {
        setPageStorageMode({ kind: 'store2' })
        utilityOpen.set(true)
        const root = open()
        await tick()
        expect(marker(root)).toEqual(['utility-screen-stub'])
        expect(shownSurface()).toBeNull()
    })

    test('the playground menu', async () => {
        PlaygroundStore.set(1)
        const root = open()
        await tick()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        flushSync()
        expect(marker(root)).toEqual(['playground-stub'])
        expect(shownSurface()).toBeNull()
    })

    test('the classic chat of a selected character', async () => {
        selectedCharID.set(0)
        const root = open()
        await tick()
        expect(root.querySelector('.default-chat-screen')).not.toBeNull()
        expect(shownSurface()).toBeNull()
    })
})
