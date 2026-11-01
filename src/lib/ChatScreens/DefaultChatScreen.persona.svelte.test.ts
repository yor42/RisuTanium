// @vitest-environment jsdom

/**
 * The chat screen derives the user name, icon and portrait flag that it hands
 * to `Chats.svelte` from the persona list. A profile whose list is empty, not
 * a list, holds `null` entries, or whose selected index is out of range must
 * still render: the derivation falls back to the plain user fields instead of
 * throwing at mount. The `Chats` stub reads its props, because a stub that
 * ignores them never evaluates the derivation. The mock set comes from
 * `DefaultChatScreen.chatPanel.svelte.test.ts`; `livePersona` is a pass-through
 * that is the identity on an entry and null for a missing one, as the real one is.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

//#region module mocks

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
    const scrollToMessage = $state({ value: -1 })
    const additionalChatMenu = $state([] as any[])
    const additionalFloatingActionButtons = $state([] as any[])
    const chatPanelStore = $state([] as any[])
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
    const chatFoldedState = $state<{ data: null | { targetCharacterId: string, targetChatId: string, targetMessageId: string } }>({ data: null })
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
    livePersona: (entry: unknown) => entry ?? null,
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
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
    const DBState = stores.DBState as unknown as { db: any }
    const selectedCharID = stores.selectedCharID
    const getCurrentCharacter = () => {
        DBState.db.characters ??= []
        return DBState.db.characters[get(selectedCharID)]
    }
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage]
    }
    return {
        presetTemplate: {},
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn((d: unknown) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
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

type SeenChatsProps = { currentUsername: unknown, userIcon: unknown, userIconPortrait: unknown }
const seen = vi.hoisted(() => [] as Array<{ currentUsername: unknown, userIcon: unknown, userIconPortrait: unknown }>)

// Reading the props evaluates the screen's derivation at mount.
vi.mock('./Chats.svelte', () => ({
    default: (_target: unknown, props: SeenChatsProps) => {
        seen.push({
            currentUsername: props.currentUsername,
            userIcon: props.userIcon,
            userIconPortrait: props.userIconPortrait,
        })
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

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import DefaultChatScreen from './DefaultChatScreen.svelte'

function installDb(personas: unknown, selectedPersona: number, bindedPersona?: string) {
    DBState.db = {
        characters: [{
            chaId: 'cha-1',
            name: 'cha-1',
            type: 'character',
            chatPage: 0,
            chats: [{ id: 'chat-1', message: [], scriptstate: {}, note: '', localLore: [], bindedPersona }],
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
        templateDefaultVariables: '',
        personas,
        selectedPersona,
        presetRegex: [],
        useSayNothing: false,
        playMessage: false,
        useAutoTranslateInput: false,
        translatorType: '',
        translator: '',
        username: 'User',
        userIcon: 'u.png',
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

async function mountScreen() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(DefaultChatScreen, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    await tick()
    flushSync()
}

afterEach(async () => {
    seen.length = 0
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('chat screen persona fallback (C-suite)', () => {
    test('C1: an empty persona list renders with the plain user fields', async () => {
        installDb([], 0)
        await expect(mountScreen()).resolves.toBeUndefined()
        expect(seen.length).toBe(1)
        expect(seen[0]).toEqual({ currentUsername: 'User', userIcon: 'u.png', userIconPortrait: false })
    })

    test('C2: a selected index past the end of the list renders with the plain user fields', async () => {
        installDb([{ name: 'User', largePortrait: true, icon: 'p.png' }], 3)
        await expect(mountScreen()).resolves.toBeUndefined()
        expect(seen.length).toBe(1)
        expect(seen[0]).toEqual({ currentUsername: 'User', userIcon: 'u.png', userIconPortrait: false })
    })

    test('C3: a non-list persona list on a bound chat renders with the plain user fields', async () => {
        installDb({}, 0, 'p1')
        await expect(mountScreen()).resolves.toBeUndefined()
        expect(seen.length).toBe(1)
        expect(seen[0]).toEqual({ currentUsername: 'User', userIcon: 'u.png', userIconPortrait: false })
    })

    test('C4: a valid list keeps the selected and the bound persona (guard before and after)', async () => {
        installDb([{ id: 'p0', name: 'User', largePortrait: true, icon: 'p.png' }], 0)
        await mountScreen()
        expect(seen.length).toBe(1)
        expect(seen[0]).toEqual({ currentUsername: 'User', userIcon: 'p.png', userIconPortrait: true })

        seen.length = 0
        for (const { instance, target } of mounted.splice(0)) {
            await unmount(instance as never).catch(() => {})
            target.remove()
        }
        installDb([{ id: 'p0', name: 'User', largePortrait: false, icon: '' }, { id: 'p1', name: 'B', largePortrait: true, icon: 'b.png' }], 0, 'p1')
        await mountScreen()
        expect(seen.length).toBe(1)
        expect(seen[0]).toEqual({ currentUsername: 'B', userIcon: 'b.png', userIconPortrait: true })
    })

    test('C5: a null entry in the list does not break a bound chat', async () => {
        installDb([null, { id: 'p1', name: 'B', largePortrait: true, icon: 'b.png' }], 1, 'p1')
        await expect(mountScreen()).resolves.toBeUndefined()
        expect(seen.length).toBe(1)
        expect(seen[0]).toEqual({ currentUsername: 'B', userIcon: 'b.png', userIconPortrait: true })
    })
})
