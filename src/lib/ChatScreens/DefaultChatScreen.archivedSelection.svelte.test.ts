// @vitest-environment jsdom

/**
 * `DefaultChatScreen.svelte` shows no chat for a selected slot that holds an archived (cold-storage) placeholder. A
 * placeholder carries no `alternateGreetings`, so the first-message row's `altGreeting` read threw "Cannot read
 * properties of undefined (reading 'length')" as an error alert (#356). Only `changeChar` selects in the app, and it
 * restores an archived character first; a selection written without it (a script, a test harness) reached this.
 *
 * REGRESSION: the placeholder cases fail on the pre-fix base (the mount throws). GUARD: the loaded character case.
 * REAL: `DefaultChatScreen.svelte`. MOCKED: everything it imports, as in `DefaultChatScreen.themeGate.svelte.test.ts`;
 * `Chat` is a stub that reads `altGreeting` as the real component does on mount.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

const h = vi.hoisted(() => ({ desktop: true, firstMessageAltGreeting: [] as boolean[] }))

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
// The real `Chat` reads `altGreeting` while it mounts; the stub does the same, so a getter that throws throws here too.
vi.mock('./Chat.svelte', () => ({
    default: (_anchor: unknown, props: { altGreeting: boolean, firstMessage?: boolean }) => {
        if (props.firstMessage) {
            h.firstMessageAltGreeting.push(props.altGreeting)
        }
    },
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

import { DBState, PlaygroundStore, selectedCharID } from 'src/ts/stores.svelte'
import { stubFromEntry } from 'src/ts/storage/store2/codec/stub'
import type { ShardEntry } from 'src/ts/storage/store2/format'
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

function loadedCharacter(): Record<string, unknown> {
    return {
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
        alternateGreetings: ['another first message'],
        largePortrait: false,
        removedQuotes: true,
        creatorNotes: '',
        image: '',
        ttsMode: 'none',
        additionalAssets: [],
    }
}

/** The placeholder the store gives an archived character: the real stub builder, so its shape is the shipped one. */
function archivedPlaceholder(): Record<string, unknown> {
    const entry = {
        type: 'character',
        name: 'archived',
        chaId: 'cha-archived',
        creatorNotes: '',
        u: 'unit-archived',
        chats: [{}],
        tags: [],
        creator: '',
    } as unknown as ShardEntry
    return stubFromEntry(entry) as Record<string, unknown>
}

beforeEach(() => {
    h.desktop = true
    h.firstMessageAltGreeting.length = 0
    DBState.db = {
        characters: [loadedCharacter(), archivedPlaceholder()],
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
    utilityOpen.set(false)
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    utilityOpen.set(false)
    PlaygroundStore.set(0)
    selectedCharID.set(-1)
})

describe('DefaultChatScreen with an archived placeholder selected', () => {
    test('the placeholder has no alternateGreetings, as the store builds it', () => {
        const placeholder = archivedPlaceholder()
        expect(placeholder.coldstorage).toBe('unit-archived')
        expect(placeholder.alternateGreetings).toBeUndefined()
    })

    test('mounting on the placeholder shows no chat and throws nothing', async () => {
        selectedCharID.set(1)
        let root: HTMLElement | null = null
        expect(() => { root = open() }).not.toThrow()
        await tick()
        expect(root!.querySelector('.default-chat-screen')).toBeNull()
        expect(h.firstMessageAltGreeting).toEqual([])
    })

    test('moving the selection from a loaded character to the placeholder throws nothing', async () => {
        selectedCharID.set(0)
        const root = open()
        await tick()
        expect(root.querySelector('.default-chat-screen')).not.toBeNull()
        expect(() => { selectedCharID.set(1); flushSync() }).not.toThrow()
        await tick()
        expect(root.querySelector('.default-chat-screen')).toBeNull()
    })

    test('a loaded character still shows its chat and first-message row', async () => {
        selectedCharID.set(0)
        const root = open()
        await tick()
        expect(root.querySelector('.default-chat-screen')).not.toBeNull()
        expect(h.firstMessageAltGreeting).toEqual([true])
    })
})