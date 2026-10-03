// @vitest-environment happy-dom

/**
 * The Stop TTS entry of the composer menu of the REAL `DefaultChatScreen.svelte`.
 *
 * Invariants pinned here:
 *  - the entry shows when the selected chat can produce speech: a character
 *    whose `ttsMode` is set and is neither `'none'` nor `'normal'`
 *    (plugin-defined modes included), or a group with at least one member
 *    that has such a mode;
 *  - it is hidden for `''`, `'none'`, `'normal'`, for a group whose members
 *    have no voice mode and for a group with no members;
 *  - a click calls `stopTTS` once.
 *
 * The mount harness, its mocks and its fixtures follow
 * `DefaultChatScreen.composer.svelte.test.ts`; `stopTTS` is a recording fake
 * and the group's members are looked up in the live database.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
        isPlainHttpFileSrc: vi.fn(() => false),
        // Only the real (unstubbed) `AssetInput.svelte` needs these: it
        // calls `getFileSrc` for every additionalAsset's own preview and
        // `saveAsset` from its own "+" button, which this harness's sticker
        // scenario does not click.
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
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
    // The group rule looks members up by id in the live database.
    findCharacterbyId: (id: string) => (DBState.db.characters as Array<{ chaId?: string, type?: string }>).find((c) => c.chaId === id && c.type !== 'group') ?? null,
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

const processMultiCommandMock = vi.hoisted(() => vi.fn(async (_cmd: string): Promise<string | false> => false))
vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: processMultiCommandMock,
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(async () => ({ type: 'image', data: '' })),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

const postChatFileMock = vi.hoisted(() => vi.fn(async (_query: unknown): Promise<Array<{ type: string, data: string, name?: string }> | null> => []))
vi.mock(import('src/ts/process/files/multisend'), () => ({
    postChatFile: postChatFileMock,
}) as unknown as typeof import('src/ts/process/files/multisend'))

const stopTTSMock = vi.hoisted(() => vi.fn())
vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
    stopTTS: stopTTSMock,
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

// Real (mutable) Sets so a test can register its OWN plugin hook -- the "slow
// input step" fixtures need a genuine `pluginV2.editinput` await they control
// by hand, the same way a real plugin would (same technique as composerActions.svelte.test.ts).
const pluginV2Mock = vi.hoisted(() => ({
    editinput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editoutput: new Set<(data: string) => Promise<string | null | undefined>>(),
    editdisplay: new Set<(data: string) => Promise<string | null | undefined>>(),
    editprocess: new Set<(data: string) => Promise<string | null | undefined>>(),
}))
vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: pluginV2Mock,
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
        setCurrentCharacter: vi.fn((char: unknown) => {
            DBState.db.characters ??= []
            DBState.db.characters[get(selectedCharID)] = char
        }),
        setCurrentChat: vi.fn((chat: unknown) => {
            const char = getCurrentCharacter()
            char.chats[char.chatPage] = chat
        }),
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

const isExpTranslatorMock = vi.hoisted(() => vi.fn(() => false))
const translateMock = vi.hoisted(() => vi.fn(async (_text: string, _reverse: boolean): Promise<string> => ''))
vi.mock(import('src/ts/translator/translator'), () => ({
    isExpTranslator: isExpTranslatorMock,
    translate: translateMock,
}) as unknown as typeof import('src/ts/translator/translator'))

// Generation is out of scope: this spy mirrors the real module's own
// `doingChat` handling (refuse at once when already set, otherwise set it
// synchronously, await a controllable gate and clear it when it settles), the
// same as composerActions.svelte.test.ts. A per-call queue
// (`sendChatGateQueue`) additionally lets a test gate a specific call --
// needed for auto mode's loop, where every tick calls `sendChat` again once
// the previous one resolves.
const doingChatMock = vi.hoisted(() => {
    let value = false
    const subscribers = new Set<(v: boolean) => void>()
    return {
        subscribe(run: (v: boolean) => void) {
            subscribers.add(run)
            run(value)
            return () => subscribers.delete(run)
        },
        set(v: boolean) {
            value = v
            subscribers.forEach((run) => run(value))
        },
    }
})
const generationGateBox = vi.hoisted(() => ({ current: Promise.resolve() as Promise<void> }))
const sendChatGateQueue = vi.hoisted(() => [] as Array<{ gate: Promise<void> }>)
const sendChatMock = vi.hoisted(() => vi.fn(async (_index: number, arg: { signal?: AbortSignal, continue?: boolean }) => {
    if (get(doingChatMock as never)) {
        return false
    }
    doingChatMock.set(true)
    try {
        const queued = sendChatGateQueue.shift()
        await (queued ? queued.gate : generationGateBox.current)
        return true
    } finally {
        doingChatMock.set(false)
    }
}))
vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: doingChatMock,
    chatProcessStage: writable(0),
    sendChat: sendChatMock,
}) as unknown as typeof import('src/ts/process/index.svelte'))

// Stubs for everything DefaultChatScreen mounts that is not the composer
// itself: the message tree and the home/playground menus. None of this
// harness's scenarios exercise message rendering or the home menu, and each
// of these pulls in a large tree of its own (Realm, character cards,
// avatars) that has nothing to do with the composer. `AssetInput.svelte`
// (the sticker picker) is left real: it is light once `getFileSrc` and
// `saveAsset` are mocked above, and the sticker scenario below drives its
// own `onSelect` callback through it.
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
//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { language } from 'src/lang'
import DefaultChatScreen from './DefaultChatScreen.svelte'
import { resetComposerActionsForTests } from 'src/ts/process/composerActions.svelte'
import { resetLocalDraftsForTest } from 'src/ts/localDrafts'

//#region fixtures and helpers

function baseDb(): Record<string, unknown> {
    return {
        characters: [] as unknown[],
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
    }
}

function makeChat(id: string) {
    return { id, message: [], scriptstate: {}, note: '', localLore: [] }
}

function makeCharacter(chaId: string, ttsMode: string) {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat`)],
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
        ttsMode,
        additionalAssets: [],
    }
}

function makeGroup(chaId: string, members: string[]) {
    return {
        chaId,
        name: chaId,
        type: 'group',
        chatPage: 0,
        chats: [makeChat(`${chaId}-chat`)],
        characters: members,
        ttsMode: 'none',
    }
}

function install(characters: unknown[]): void {
    DBState.db = { ...baseDb(), characters } as never
    selectedCharID.set(0)
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountScreen(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(DefaultChatScreen, { target, props: {} }))
    flushSync()
    return target
}

async function openMenu(target: HTMLElement): Promise<void> {
    const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>('button'))
    const menuButton = buttons.find((b) => !b.classList.contains('button-icon-send') && b.getAttribute('aria-labelledby') !== 'cancel')
    if (!menuButton) throw new Error('composer menu (hamburger) button not found')
    menuButton.click()
    flushSync()
    await tick()
    flushSync()
}

function stopEntry(target: HTMLElement): HTMLElement | null {
    return Array.from(target.querySelectorAll<HTMLElement>('div')).find((d) => d.querySelector(':scope > span')?.textContent?.trim() === language.ttsStop) ?? null
}

async function mountWithMenu(characters: unknown[]): Promise<HTMLElement> {
    install(characters)
    const target = mountScreen()
    await openMenu(target)
    return target
}

//#endregion

beforeEach(() => {
    stopTTSMock.mockClear()
})

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetLocalDraftsForTest()
    resetComposerActionsForTests()
})

describe('the Stop TTS entry for a character', () => {
    test.each(['webspeech', 'elevenlab'])('guard: the voice mode %s shows the entry', async (ttsMode) => {
        const target = await mountWithMenu([makeCharacter('char-a', ttsMode)])

        expect(stopEntry(target)).not.toBeNull()
    })

    test.each([
        'VOICEVOX', 'openai', 'novelai', 'huggingface', 'vits', 'gptsovits', 'fishspeech', 'my-plugin-voice',
    ])('regression reproducer: the voice mode %s shows the entry', async (ttsMode) => {
        const target = await mountWithMenu([makeCharacter('char-a', ttsMode)])

        expect(stopEntry(target)).not.toBeNull()
    })

    test.each([
        ['an empty mode', ''],
        ['none', 'none'],
        ['normal', 'normal'],
    ])('guard: %s hides the entry', async (_label, ttsMode) => {
        const target = await mountWithMenu([makeCharacter('char-a', ttsMode)])

        expect(stopEntry(target)).toBeNull()
    })

    test('guard: a click calls stopTTS once', async () => {
        const target = await mountWithMenu([makeCharacter('char-a', 'webspeech')])

        stopEntry(target)!.click()

        expect(stopTTSMock).toHaveBeenCalledTimes(1)
    })
})

describe('the Stop TTS entry for a group', () => {
    test('regression reproducer: a group with one member that has a voice mode shows the entry', async () => {
        const target = await mountWithMenu([
            makeGroup('group-a', ['m-none', 'm-voice']),
            makeCharacter('m-none', 'none'),
            makeCharacter('m-voice', 'openai'),
        ])

        expect(stopEntry(target)).not.toBeNull()
    })

    test('guard: a group whose members have no voice mode hides the entry', async () => {
        const target = await mountWithMenu([
            makeGroup('group-a', ['m-none', 'm-normal', 'm-empty']),
            makeCharacter('m-none', 'none'),
            makeCharacter('m-normal', 'normal'),
            makeCharacter('m-empty', ''),
        ])

        expect(stopEntry(target)).toBeNull()
    })

    test('guard: a group with no members hides the entry', async () => {
        const target = await mountWithMenu([makeGroup('group-a', [])])

        expect(stopEntry(target)).toBeNull()
    })
})