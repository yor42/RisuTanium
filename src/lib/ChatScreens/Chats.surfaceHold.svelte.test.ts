// @vitest-environment happy-dom

/**
 * The real `Chats.svelte`, `Chat.svelte` and `ChatBody.svelte` under an installed chat surface, with the real
 * `registerDbChangeEffects` counting settings-level changes. The parser and the translator are held doubles: every
 * `ParseMarkdown` call pushes a deferred that the test answers. Settings is opened and closed through the real
 * `settingsOpen` writable that `chatSurface` follows; a visit is "settled" once the release has flushed and every
 * parse the rows asked for is answered.
 *
 * Labels: R = regression reproducer (must fail on the base without the hold), G = guard (passes before and after).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { writable, get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Chats from './Chats.svelte'
import { DBState, ReloadChatPointer, ReloadGUIPointer, selIdState, selectedCharID, settingsOpen } from 'src/ts/stores.svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'
import { installChatSurface, resetChatSurfaceForTests } from './chatSurface.svelte'
import { registerDbChangeEffects } from 'src/ts/storage/dbChangeEffects.svelte'
import { resetTopLevelChangesForTests, topLevelChangeCount } from 'src/ts/storage/topLevelChanges'
import { risuChatParser } from 'src/ts/process/scripts'
import type { Database, character, Chat as ChatData } from 'src/ts/storage/database.svelte'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
    // Reads a database value the way a CBS macro such as {{user}} does, so a row's display effect depends on it.
    readDatabaseValue: (() => {}) as () => void,
}))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    risuChatParser: vi.fn((text: string) => text ?? ''),
    assetRegex: /{{asset:[^}]+}}/g,
    ParseMarkdown: vi.fn((...args: unknown[]) => new Promise<string>((resolve) => { h.parses.push({ args, resolve }) })),
    addMetadataToElement: vi.fn((html: string) => html),
    postTranslationParse: vi.fn((html: string) => html),
    trimMarkdown: vi.fn((html: string) => html),
    getDistance: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Database })
    const selId = $state({ selId: 0 })
    return {
        DBState: state,
        selIdState: selId,
        selectedCharID: writable(-1),
        settingsOpen: writable(false),
        MobileGUI: writable(false),
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
            const char = (stores.DBState as unknown as { db: Database }).db.characters[
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
    const DBState = stores.DBState as unknown as { db: Database }
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
        setDatabase: vi.fn((d: Database) => { DBState.db = d }),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
        setCurrentCharacter: vi.fn(),
        setCurrentChat: vi.fn(),
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
    translateHTML: vi.fn(async (html: string) => html),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    risuChatParser: vi.fn((text: string) => { h.readDatabaseValue(); return text ?? '' }),
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
    parseKeyValue: () => [],
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

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaButtonTrigger: vi.fn(async () => undefined),
    runLuaInteractionTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('src/ts/process/scriptings'))

//#endregion

//#region fixtures

interface LiveMessage { role: 'user' | 'char', data: string, chatId: string }

function makeChat(messages: LiveMessage[]): ChatData {
    return {
        id: 'chat0',
        message: messages,
        bookmarks: [] as string[],
        bookmarkNames: {} as Record<string, string>,
        scriptstate: {} as Record<string, unknown>,
        note: '',
        localLore: [] as unknown[],
    } as unknown as ChatData
}

function makeCharacter(chats: ChatData[]): character {
    return {
        chaId: 'a',
        name: 'a',
        type: 'character',
        ttsMode: 'none',
        chatPage: 0,
        chats,
        triggerscript: [] as unknown[],
        globalLore: [] as unknown[],
        desc: 'desc',
        modules: [] as string[],
        image: '',
    } as unknown as character
}

function baseDb() {
    return {
        askRemoval: false, instantRemove: false, translatorType: 'none',
        translateBeforeHTMLFormatting: false, legacyTranslation: false,
        requestInfoInsideChat: false, clickToEdit: false, zoomsize: 100,
        lineHeight: 1.25, enableBlockPartialEdit: false, enableDragPartialEdit: false,
        useChatCopy: false, translator: '', swipe: false, showFirstMessagePages: false,
        enableBookmark: true, createFolderOnBranch: false, iconsize: 100,
        memoryLimitThickness: 2, theme: 'default', guiHTML: '', roundIcons: false,
        modules: [], enabledModules: [], moduleIntergration: '', templateDefaultVariables: '',
        personas: [{ name: 'P', note: '' }], selectedPersona: 0, username: 'User',
        presetRegex: [], streamingDisplayOptimizationMode: 'off',
        botPresets: [], loadouts: [], plugins: [], pluginCustomStorage: {},
    }
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
let stopEffects: (() => void) | null = null

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

function messagesOf(count: number): LiveMessage[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'char',
        data: `M${i}`,
        chatId: `id${i}`,
    }))
}

/** Answers every unanswered parse; returns how many it answered. */
async function answerAll() {
    let answered = 0
    for (let round = 0; round < 4; round++) {
        const pending = h.parses.filter((p) => !(p as Held & { done?: boolean }).done)
        for (const parse of pending) {
            ;(parse as Held & { done?: boolean }).done = true
            parse.resolve(`P:${parse.args[0] as string}`)
            answered += 1
        }
        await wait(20)
        await tick()
    }
    return answered
}

/** The mounted row containers by message index: the document lists the newest row first. */
function rowNodes(target: HTMLElement) {
    return [...target.querySelectorAll('.chat-message-container')].reverse()
}

function fontSizes(target: HTMLElement) {
    return [...target.querySelectorAll('.chattext')].map((e) => (e as HTMLElement).style.fontSize)
}

async function mountSettledChats(count: number, reactiveProps: { currentUsername: string } = { currentUsername: 'User' }) {
    DBState.db = baseDb() as never
    DBState.db.characters = [makeCharacter([makeChat(messagesOf(count))])] as never
    const live = (DBState.db.characters as unknown as Array<{ chats: Array<{ message: LiveMessage[] }> }>)[0]
    selectedCharID.set(0)
    selIdState.selId = 0
    const props = $state({
        messages: live.chats[0].message as never,
        currentCharacter: live as never,
        onReroll: () => {},
        unReroll: () => {},
        currentUsername: reactiveProps.currentUsername,
        userIcon: '',
        loadPages: 20,
    })
    stopEffects = $effect.root(() => {
        registerDbChangeEffects({
            tracker: { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false },
            markChanged: () => {},
        })
    })
    flushSync()
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(Chats, { target, props }))
    flushSync()
    await wait(20)
    await answerAll()
    expect(rowNodes(target)).toHaveLength(count)
    return { target, chat: live.chats[0], props }
}

async function openSettings() {
    settingsOpen.set(true)
    await tick()
    await tick()
}

/** Closes Settings and lets the release, the rebuild and every row's parse settle. */
async function closeSettingsAndSettle() {
    settingsOpen.set(false)
    await tick()
    await tick()
    await wait(20)
    await answerAll()
}

let stopGuiReset: () => void = () => {}

beforeEach(() => {
    window.innerWidth = 1024
    h.parses.length = 0
    h.readDatabaseValue = () => { void DBState.db?.username }
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    settingsOpen.set(false)
    clearChatBodyRenderCache()
    resetTopLevelChangesForTests()
    resetChatSurfaceForTests()
    installChatSurface()
    // The real store resets the chat pointer in the first subscriber of the GUI pointer, only for a non-empty map.
    stopGuiReset = ReloadGUIPointer.subscribe(() => {
        if (Object.keys(get(ReloadChatPointer)).length > 0) {
            ReloadChatPointer.set({})
        }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    stopGuiReset()
    stopEffects?.()
    stopEffects = null
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    vi.clearAllMocks()
})

//#endregion

describe('a reload signal while Settings is open', () => {
    test('R T9 a GUI bump while hidden parses nothing hidden, then rebuilds every row once', async () => {
        const { target } = await mountSettledChats(3)
        const before = rowNodes(target)
        const mark = h.parses.length

        await openSettings()
        ReloadGUIPointer.update((v) => v + 1)
        await wait(30)
        expect(h.parses.length - mark).toBe(0)

        await closeSettingsAndSettle()
        expect(h.parses.length - mark).toBe(3)
        const after = rowNodes(target)
        expect(after).toHaveLength(3)
        for (const node of after) {
            expect(before).not.toContain(node)
        }
        // The rows are still live after the return.
        DBState.db.zoomsize = 150
        await wait(20)
        expect(new Set(fontSizes(target)).size).toBe(1)
        expect(fontSizes(target)[0]).toBe(`${0.875 * 1.5}rem`)
    })

    test.each([false, true])('R T28 only the row bumped after the return re-parses; the held catch-up carries no stale row pointer (with a GUI bump: %s)', async (withGuiBump) => {
        const { target } = await mountSettledChats(6)
        await openSettings()
        ReloadChatPointer.update((v) => { v[3] = 1; return v })
        if (withGuiBump) {
            ReloadGUIPointer.update((v) => v + 1)
        }
        await closeSettingsAndSettle()
        const mark = h.parses.length

        ReloadChatPointer.update((v) => { v[5] = 1; return v })
        await wait(30)
        await answerAll()
        // The bumped row asks twice (its doomed body and its replacement); no other row asks at all.
        const asked = h.parses.slice(mark).map((p) => p.args[0])
        expect(asked.length).toBeGreaterThan(0)
        expect(new Set(asked)).toEqual(new Set(['M5']))
        expect(rowNodes(target)).toHaveLength(6)
    })
})

describe('a settings-level change while Settings is open', () => {
    test('R T24a a primitive top-level write rebuilds every row once, with no hidden parse', async () => {
        const { target } = await mountSettledChats(3)
        const before = rowNodes(target)
        const mark = h.parses.length
        const parserMark = vi.mocked(risuChatParser).mock.calls.length

        await openSettings()
        DBState.db.zoomsize = 120
        await wait(30)
        expect(h.parses.length - mark).toBe(0)
        expect(vi.mocked(risuChatParser).mock.calls.length - parserMark).toBe(0)

        await closeSettingsAndSettle()
        expect(h.parses.length - mark).toBe(3)
        for (const node of rowNodes(target)) {
            expect(before).not.toContain(node)
        }
        DBState.db.zoomsize = 150
        await wait(20)
        expect(fontSizes(target)[0]).toBe(`${0.875 * 1.5}rem`)
    })

    test('R T24b an in-place nested write rebuilds every row once', async () => {
        const { target } = await mountSettledChats(3)
        const before = rowNodes(target)
        const mark = h.parses.length

        await openSettings()
        DBState.db.personas[0].name = 'B'
        await wait(30)
        expect(h.parses.length - mark).toBe(0)

        await closeSettingsAndSettle()
        expect(h.parses.length - mark).toBe(3)
        for (const node of rowNodes(target)) {
            expect(before).not.toContain(node)
        }
    })

    test('R T13 a changed user name reaches the rows on return', async () => {
        const { target, props } = await mountSettledChats(3)
        expect(rowNodes(target)[0].textContent).toContain('User')

        await openSettings()
        props.currentUsername = 'Renamed'
        DBState.db.username = 'Renamed'
        await closeSettingsAndSettle()

        expect(rowNodes(target)[0].textContent).toContain('Renamed')
    })
})

describe('the scroll position of the list', () => {
    /** Records every write of `scrollTop` on the element that scrolls the rows (the parent of the row container). */
    function recordScrollWrites(target: HTMLElement, initial: number) {
        let stored = initial
        const writes: number[] = []
        Object.defineProperty(target, 'scrollTop', {
            configurable: true,
            get: () => stored,
            set: (value: number) => { stored = value; writes.push(value) },
        })
        return writes
    }

    test('R a rebuild return writes the scroll position back', async () => {
        const { target } = await mountSettledChats(3)
        const writes = recordScrollWrites(target, 40)

        await openSettings()
        DBState.db.zoomsize = 120
        await closeSettingsAndSettle()

        expect(writes.at(-1)).toBe(40)
    })

    test('G an idle return writes nothing', async () => {
        const { target } = await mountSettledChats(3)
        const writes = recordScrollWrites(target, 40)

        await openSettings()
        await closeSettingsAndSettle()

        expect(writes).toEqual([])
    })
})

describe('an idle visit', () => {
    test('G T11 changes no node, parses nothing and leaves the counter alone', async () => {
        const { target } = await mountSettledChats(3)
        const before = rowNodes(target)
        const mark = h.parses.length
        const parserMark = vi.mocked(risuChatParser).mock.calls.length
        const countBefore = topLevelChangeCount()

        await openSettings()
        await wait(30)
        await closeSettingsAndSettle()
        await wait(30)

        expect(topLevelChangeCount()).toBe(countBefore)
        expect(h.parses.length - mark).toBe(0)
        expect(vi.mocked(risuChatParser).mock.calls.length - parserMark).toBe(0)
        const after = rowNodes(target)
        expect(after).toHaveLength(3)
        after.forEach((node, i) => expect(node).toBe(before[i]))
        DBState.db.zoomsize = 150
        await wait(20)
        expect(fontSizes(target)[0]).toBe(`${0.875 * 1.5}rem`)
    })
})

describe('streaming into the hidden chat', () => {
    test('R T19 chunks while hidden mount and parse nothing; the return catches up once', async () => {
        const { target, chat } = await mountSettledChats(3)
        const before = rowNodes(target)
        const mark = h.parses.length
        const parserMark = vi.mocked(risuChatParser).mock.calls.length

        await openSettings()
        for (const chunk of ['M2 a', 'M2 ab', 'M2 abc']) {
            chat.message[2].data = chunk
            await wait(30)
        }
        expect(h.parses.length - mark).toBe(0)
        expect(vi.mocked(risuChatParser).mock.calls.length - parserMark).toBe(0)
        rowNodes(target).forEach((node, i) => expect(node).toBe(before[i]))

        await closeSettingsAndSettle()
        expect(h.parses.length - mark).toBe(1)
        expect(rowNodes(target)).toHaveLength(3)
        expect(rowNodes(target)[2].textContent).toContain('P:M2 abc')
    })
})

describe('every order of signal, setting change and close', () => {
    const actions = {
        bump: () => { ReloadGUIPointer.update((v) => v + 1) },
        write: () => { DBState.db.zoomsize = 120 },
        close: () => { settingsOpen.set(false) },
    }
    const names = Object.keys(actions) as Array<keyof typeof actions>
    const orders = names.flatMap((a) => names.filter((b) => b !== a).map((b) => [a, b, names.find((c) => c !== a && c !== b)!] as const))

    test.each(orders)('R T21 order %s, %s, %s parses each row exactly once and leaves no duplicate node', async (first, second, third) => {
        const { target } = await mountSettledChats(3)
        const before = rowNodes(target)
        const mark = h.parses.length

        await openSettings()
        actions[first]()
        actions[second]()
        actions[third]()
        await tick()
        await tick()
        await wait(30)
        await answerAll()

        expect(h.parses.length - mark).toBe(3)
        const after = rowNodes(target)
        expect(after).toHaveLength(3)
        expect(new Set(after).size).toBe(3)
        for (const node of after) {
            expect(before).not.toContain(node)
        }
        expect(target.querySelectorAll('[x-hashed]')).toHaveLength(3)
    })
})
