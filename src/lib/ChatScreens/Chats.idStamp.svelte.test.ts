// @vitest-environment happy-dom

/**
 * A row whose only change is a newly stamped message id keeps its mounted instance and receives the id in place. The
 * real `Chats.svelte` and the real boundary are mounted. The stub rows replace `Chat.svelte` with a recorder of the props
 * object each mount received (its getters stay live); the editor row mounts the real `Chat`.
 *
 * Invariants pinned here: the keep holds only for the same message object, so a switched chat, a switched character or a
 * row shifted into an id-less row's index replaces the row; a changed or data-changing stamp replaces it; a carried
 * 'off' stream tail is never kept, so a stream still ends with one remount; an editor open on an id-less row survives
 * the stamp and saves into the same message.
 *
 * Labels: R = regression reproducer (fails without the keep rule), G = guard (passes with and without it, or
 * without the same-message term for the switch rows it protects).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetActiveStreamsForTest } from 'src/ts/process/activeStreams'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID } from 'src/ts/stores.svelte'
import Chats from './Chats.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import type { character, Chat as ChatData } from 'src/ts/storage/database.svelte'

//#region module mocks

interface StubProps {
    idx: number
    message: string
    expectedId?: string
    messageGenerationInfo?: unknown
}

interface Held {
    args: unknown[]
    resolve: (value: string) => void
    reject: (error: Error) => void
}

const rec = vi.hoisted(() => ({
    mounts: [] as StubProps[],
    // The stub rows record; the editor row mounts the real Chat.
    real: false,
    parses: [] as Held[],
}))

vi.mock('./Chat.svelte', async () => {
    const actual = await vi.importActual<{ default: (anchor: unknown, props: unknown) => unknown }>('./Chat.svelte')
    return {
        default: (anchor: unknown, props: StubProps) => {
            if (rec.real) {
                return actual.default(anchor, props)
            }
            rec.mounts.push(props)
            return {
                updateStreamingDisplay: () => {},
                isTranslatedView: () => false,
                destroy: () => {},
            }
        },
    }
})

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve, reject) => { rec.parses.push({ args, resolve, reject }) })),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as any })
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
        createSimpleCharacter: vi.fn(() => ({ name: 'A' })),
        bookmarkListOpen: writable(false),
        ScrollToMessageStore: { value: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stores = await import('src/ts/stores.svelte')
    return {
        aiLawApplies: vi.fn(() => false),
        changeChatTo: vi.fn((v: number | string) => {
            const char = (stores.DBState as unknown as { db: any }).db.characters[
                (stores.selIdState as unknown as { selId: number }).selId
            ]
            if (typeof v === 'number' && char) {
                char.chatPage = v
            }
        }),
        foldChatToMessage: vi.fn(),
        chatFoldedStateMessageIndex: { index: -1 },
        getFileSrc: vi.fn(async () => ''),
        createChatCopyName: vi.fn((name: string) => `${name} Branch`),
        downloadFile: vi.fn(),
        fetchNative: vi.fn(),
        readImage: vi.fn(),
        forageStorage: {
            keys: vi.fn(async () => []),
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
        },
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

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

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertNormal: vi.fn(),
    alertWait: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertRequestData: vi.fn(),
    alertError: vi.fn(),
    alertSelect: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/translator/translator'), () => ({
    getLLMCache: vi.fn(async () => null),
    setLLMCache: vi.fn(async () => {}),
    waitForTranslatorModules: vi.fn(async () => {}),
    translateHTML: vi.fn(() => new Promise<string>(() => {})),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    ColorSchemeTypeStore: writable('dark'),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/gui/longtouch'), () => ({
    longpress: vi.fn(() => ({ destroy: () => {} })),
}) as unknown as typeof import('src/ts/gui/longtouch'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ shortName: 'test-model' })),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/util'), () => ({
    capitalize: vi.fn((s: string) => s),
    getUserIcon: vi.fn(() => ''),
    getUserName: vi.fn(() => 'User'),
    sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
    findCharacterbyId: vi.fn(() => null),
    asBuffer: vi.fn(),
    getPersonaPrompt: vi.fn(() => ''),
    checkPersonaBinded: vi.fn(() => false),
    parseKeyValue: (template: string) => {
        if (!template) return []
        const kv: [string, string][] = []
        for (const line of template.split('\n')) {
            const [key, value] = line.split('=')
            if (key && value) kv.push([key, value])
        }
        return kv
    },
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleAssets: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/command'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
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

vi.mock('./PartialEditController.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

// wasmoon cannot load under happy-dom; the button and form scripts are not part of these rows.
vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

//#region fixtures

function makeChat(id: string, overrides: Record<string, unknown> = {}): ChatData {
    return {
        id,
        message: [] as unknown[],
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
        ...overrides,
    } as unknown as ChatData
}

function makeCharacter(chaId: string, chats: ChatData[], overrides: Record<string, unknown> = {}): character {
    return {
        chaId,
        name: chaId,
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats,
        triggerscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: `${chaId}-original-desc`,
        modules: [] as string[],
        ...overrides,
    } as unknown as character
}

function baseDb(overrides: Record<string, unknown> = {}) {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '', personas: [], selectedPersona: 0,
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
        ...overrides,
    }
}

interface LiveMessage { role: 'user' | 'char', data: string, chatId?: string, generationInfo?: { model: string } }
interface LiveChat { id: string, message: LiveMessage[], isStreaming?: boolean }
interface LiveCharacter { chaId: string, chatPage: number, chats: LiveChat[] }

// The character the list shows; a rune so that the getter props below track a switch.
const view = $state({ charIndex: 0 })

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

const liveCharacters = () => DBState.db.characters as unknown as LiveCharacter[]

/**
 * Mounts the list over `grid[character][chat]` (message lists). The list gets getter props like the screen's, so a
 * chat or character switch reaches it through the same reads. The messages are `{role, data}` without ids unless given.
 */
function mountGrid(grid: LiveMessage[][][], dbOverrides: Record<string, unknown> = {}) {
    view.charIndex = 0
    selectedCharID.set(0)
    DBState.db = baseDb(dbOverrides) as never
    DBState.db.characters = grid.map((chats, c) => makeCharacter(
        `ch${c}`,
        chats.map((messages, k) => makeChat(`c${c}-${k}`, { message: messages })),
        { image: '' },
    )) as never
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    const instance = mount(Chats, {
        target,
        props: {
            get messages() { const ch = liveCharacters()[view.charIndex]; return ch.chats[ch.chatPage].message as never },
            get currentCharacter() { return liveCharacters()[view.charIndex] as never },
            onReroll: () => {},
            unReroll: () => {},
            currentUsername: 'User',
            userIcon: '',
            loadPages: 100,
        },
    })
    mountedInstances.push(instance)
    flushSync()
    return { target, chat: liveCharacters()[0].chats[0] }
}

const mountOne = (messages: LiveMessage[], dbOverrides: Record<string, unknown> = {}) => mountGrid([[messages]], dbOverrides)

/**
 * The producer's stamp: each message of the array the chat holds is given an id when it has none, in place. With
 * `replace`, the array is also replaced by a new one of the same message objects, as other writers do.
 */
function stampIds(chat: LiveChat, prefix = 'id', replace = false) {
    let n = 0
    const stamp = (v: LiveMessage) => {
        v.chatId = v.chatId ?? `${prefix}${n}`
        n += 1
    }
    if (replace) {
        chat.message = chat.message.map((v) => {
            stamp(v)
            return v
        })
    } else {
        chat.message.forEach(stamp)
    }
    flushSync()
}

const mountsAt = (idx: number) => rec.mounts.filter((entry) => entry.idx === idx)
const rowNodes = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>('.chat-message-container')]

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

let stopGuiReset: () => void = () => {}

beforeEach(() => {
    rec.mounts.length = 0
    rec.parses.length = 0
    rec.real = false
    window.innerWidth = 1024
    selectedCharID.set(0)
    selIdState.selId = 0
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    clearChatBodyRenderCache()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    // The real store resets the chat pointer in the first subscriber of the GUI pointer.
    stopGuiReset = ReloadGUIPointer.subscribe(() => { ReloadChatPointer.set({}) })
})

afterEach(async () => {
    stopGuiReset()
    resetActiveStreamsForTest()
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

//#endregion

describe('S8 a stamped id keeps the row for the same message', () => {
    test('R T15: stamping twenty id-less rows mounts nothing and every row gets its id in place', () => {
        const messages: LiveMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `m${i}` }))
        const { target, chat } = mountOne(messages)
        const before = rowNodes(target)
        expect(rec.mounts).toHaveLength(20)

        stampIds(chat)

        expect(rec.mounts).toHaveLength(20)
        expect(rowNodes(target)).toEqual(before)
        for (let i = 0; i < 20; i++) {
            expect(mountsAt(i)).toHaveLength(1)
            expect(mountsAt(i)[0].expectedId).toBe(`id${i}`)
        }
    })

    test('G T24s: a stamp that replaces the array gives the list effect no dependency on the row, so it runs once', () => {
        const { chat } = mountOne([
            { role: 'user', data: 'a' },
            { role: 'char', data: 'b' },
        ])
        const runs = () => vi.mocked(console.log).mock.calls.filter((call) => call[0] === 'Updating Chats').length
        const before = runs()

        stampIds(chat, 'id', true)

        expect(runs() - before).toBe(1)
    })

    test('G T16: a stamp with a data change in the same flush, or a changed id, remounts that row only', () => {
        const { chat } = mountOne([
            { role: 'user', data: 'a' },
            { role: 'char', data: 'b', chatId: 'old' },
            { role: 'user', data: 'c' },
        ])
        expect(rec.mounts).toHaveLength(3)

        chat.message[0].chatId = 'u0'
        chat.message[0].data = 'a2'
        chat.message[1].chatId = 'new'
        flushSync()

        expect(mountsAt(0)).toHaveLength(2)
        expect(mountsAt(0)[1].message).toBe('a2')
        expect(mountsAt(0)[1].expectedId).toBe('u0')
        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].expectedId).toBe('new')
        expect(mountsAt(2)).toHaveLength(1)
    })

    test('G T17: a stream on an id-less tail that is stamped as it ends still remounts once with the final state', () => {
        const { chat } = mountOne([
            { role: 'user', data: 'U', chatId: 'u1' },
            { role: 'char', data: 'C' },
        ])
        chat.isStreaming = true
        flushSync()
        chat.message[1].data = 'C a'
        flushSync()
        expect(mountsAt(1)).toHaveLength(1)

        chat.isStreaming = false
        chat.message[1].chatId = 'c1'
        chat.message[1].generationInfo = { model: 'm' }
        flushSync()

        expect(mountsAt(1)).toHaveLength(2)
        expect(mountsAt(1)[1].message).toBe('C a')
        expect(mountsAt(1)[1].expectedId).toBe('c1')
        expect(mountsAt(1)[1].messageGenerationInfo).toEqual({ model: 'm' })
    })

    test('R T25: a switched chat whose first message looks the same replaces the row', () => {
        const { chat } = mountGrid([[
            [{ role: 'char', data: 'Hello' }],
            [{ role: 'char', data: 'Hello', chatId: 'b0' }],
        ]])
        expect(mountsAt(0)).toHaveLength(1)

        liveCharacters()[0].chatPage = 1
        flushSync()

        expect(chat.message[0].chatId).toBeUndefined()
        expect(mountsAt(0)).toHaveLength(2)
        expect(mountsAt(0)[1].expectedId).toBe('b0')
    })

    test('R T25b: a switched character whose first message looks the same replaces the row', () => {
        mountGrid([
            [[{ role: 'char', data: 'Hello' }]],
            [[{ role: 'char', data: 'Hello', chatId: 'b0' }]],
        ])
        expect(mountsAt(0)).toHaveLength(1)

        selectedCharID.set(1)
        view.charIndex = 1
        flushSync()

        expect(mountsAt(0)).toHaveLength(2)
        expect(mountsAt(0)[1].expectedId).toBe('b0')
    })

    test('R T26: a row shifted into an id-less row\'s index replaces it', () => {
        const { chat } = mountOne([
            { role: 'char', data: 'x' },
            { role: 'char', data: 'x', chatId: 'k' },
        ])
        expect(mountsAt(0)).toHaveLength(1)

        chat.message.splice(0, 1)
        flushSync()

        expect(mountsAt(0)).toHaveLength(2)
        expect(mountsAt(0)[1].expectedId).toBe('k')
    })
})

describe('S8 an editor open on an id-less row', () => {
    const EDIT_AREA = '.message-edit-area'
    const pencilOf = (target: HTMLElement) => target.querySelector<HTMLButtonElement>('.button-icon-edit')!

    test('G T18: survives the stamp and its save writes the same message', async () => {
        rec.real = true
        const { target, chat } = mountOne([{ role: 'char', data: 'FIRST' }])
        await wait(20)
        rec.parses.forEach((parse) => parse.resolve(`P:${parse.args[0] as string}`))
        await wait(20)
        const original = chat.message[0]
        const row = rowNodes(target)[0]

        pencilOf(target).click()
        flushSync()
        const area = target.querySelector<HTMLTextAreaElement>(EDIT_AREA)
        expect(area).not.toBeNull()
        area!.value = 'typed text'
        area!.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()

        stampIds(chat)
        await tick()
        expect(chat.message[0].chatId).toBe('id0')
        expect(rowNodes(target)[0]).toBe(row)
        expect(target.querySelector<HTMLTextAreaElement>(EDIT_AREA)).toBe(area)
        expect(area!.value).toBe('typed text')

        pencilOf(target).click()
        await wait(20)
        expect(chat.message).toHaveLength(1)
        expect(chat.message[0]).toBe(original)
        expect(chat.message[0].data).toBe('typed text')
    })
})
