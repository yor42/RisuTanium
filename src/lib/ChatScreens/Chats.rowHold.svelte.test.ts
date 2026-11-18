// @vitest-environment jsdom

/**
 * The real `Chats.svelte`, `Chat.svelte` and `ChatBody.svelte` under an installed chat surface, with the parser held
 * as deferreds the test answers and `requestAnimationFrame` driven by hand. The attribute `data-risu-cv-hold` on the
 * list node is the contract: rows of the legacy list stay laid out while it is set. Every test reads the literal
 * attribute, so a missing module cannot stand in for the defect.
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
import { resetTopLevelChangesForTests } from 'src/ts/storage/topLevelChanges'
import type { Database, character, Chat as ChatData } from 'src/ts/storage/database.svelte'

//#region module mocks

interface Held {
    args: unknown[]
    resolve: (value: string) => void
    done?: boolean
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
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

const HOLD = 'data-risu-cv-hold'

interface LiveMessage { role: 'user' | 'char', data: string, chatId: string, isComment?: boolean }

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

function messagesOf(count: number, commentIndexes: number[] = []): LiveMessage[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'char',
        data: `M${i}`,
        chatId: `id${i}`,
        ...(commentIndexes.includes(i) ? { isComment: true } : {}),
    }))
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []
let stopEffects: (() => void) | null = null
let stopGuiReset: () => void = () => {}

// Frames run only when the test says so.
let frameQueue = new Map<number, () => void>()
let nextFrameId = 1

function runFrame() {
    const batch = [...frameQueue.values()]
    frameQueue = new Map()
    batch.forEach((cb) => cb())
}

function runFrames(count: number) {
    for (let i = 0; i < count; i++) {
        runFrame()
    }
}

async function settleMicrotasks(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve()
        await tick()
        flushSync()
    }
}

async function wait(ms = 0) {
    await new Promise((r) => setTimeout(r, ms))
    flushSync()
}

/** Answers the unanswered parses, at most `limit` of them; returns how many it answered. */
async function answer(limit = Infinity) {
    let answered = 0
    for (let round = 0; round < 4; round++) {
        const pending = h.parses.filter((p) => !p.done)
        for (const parse of pending) {
            if (answered >= limit) {
                break
            }
            parse.done = true
            parse.resolve(`P:${parse.args[0] as string}`)
            answered += 1
        }
        await settleMicrotasks(3)
    }
    return answered
}

const listOf = (target: HTMLElement) => target.querySelector('[data-part="chat-messages"]') as HTMLElement
const held = (target: HTMLElement) => listOf(target).hasAttribute(HOLD)

async function mountChats(count: number, options: { loadPages?: number, commentIndexes?: number[], settle?: boolean } = {}) {
    DBState.db = baseDb() as never
    DBState.db.characters = [makeCharacter([makeChat(messagesOf(count, options.commentIndexes))])] as never
    const live = (DBState.db.characters as unknown as Array<{ chatPage: number, chats: Array<{ id: string, message: LiveMessage[] }> }>)[0]
    selectedCharID.set(0)
    selIdState.selId = 0
    const props = $state({
        messages: live.chats[0].message as never,
        currentCharacter: live as never,
        onReroll: () => {},
        unReroll: () => {},
        currentUsername: 'User',
        userIcon: '',
        loadPages: options.loadPages ?? 20,
        windowResetToken: 0,
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
    const instance = mount(Chats, { target, props })
    mountedInstances.push(instance)
    flushSync()
    await settleMicrotasks()
    if (options.settle !== false) {
        await answer()
        runFrames(4)
    }
    return { target, chat: live.chats[0], props, instance }
}

async function openSettings() {
    settingsOpen.set(true)
    await tick()
    await tick()
}

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    disconnected = false
    constructor(private readonly callback: (entries: Array<{ contentRect: { width: number, height: number } }>) => void) {
        FakeResizeObserver.instances.push(this)
    }
    observed = false
    observe() { this.observed = true }
    unobserve() {}
    disconnect() { this.disconnected = true }
    /** An observer reports only for a target it observes. */
    fire(width: number, height = 100) {
        if (!this.observed || this.disconnected) {
            return
        }
        this.callback([{ contentRect: { width, height } }])
    }
}

beforeEach(() => {
    window.innerWidth = 1024
    h.parses.length = 0
    frameQueue = new Map()
    nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
        const id = nextFrameId++
        frameQueue.set(id, cb)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frameQueue.delete(id) })
    FakeResizeObserver.instances = []
    ReloadGUIPointer.set(0)
    ReloadChatPointer.set({})
    settingsOpen.set(false)
    clearChatBodyRenderCache()
    resetTopLevelChangesForTests()
    resetChatSurfaceForTests()
    installChatSurface()
    stopGuiReset = ReloadGUIPointer.subscribe(() => {
        if (Object.keys(get(ReloadChatPointer)).length > 0) {
            ReloadChatPointer.set({})
        }
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    vi.useRealTimers()
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
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

//#endregion

describe('the Settings visit', () => {
    test('R T4a the list is held from the hide until two frames after a plain return', async () => {
        const { target } = await mountChats(6)
        expect(held(target)).toBe(false)

        await openSettings()
        expect(held(target)).toBe(true)

        settingsOpen.set(false)
        await settleMicrotasks()
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(false)
    })

    test('R T4a a room change inside the tail of a return does not cancel the return release', async () => {
        const { target, chat, props } = await mountChats(6)

        await openSettings()
        settingsOpen.set(false)
        await settleMicrotasks()
        expect(held(target)).toBe(true)

        // A room change takes the warm hold, which cancels its own pending frame; the row hold's frames are separate.
        const second = makeChat(messagesOf(6))
        second.id = 'chat1'
        const char = (DBState.db.characters as unknown as Array<{ chatPage: number, chats: ChatData[] }>)[0]
        char.chats.push(second)
        char.chatPage = 1
        props.messages = second.message as never
        void chat
        await settleMicrotasks()
        await answer()
        runFrames(6)
        expect(held(target)).toBe(false)
    })

    test('R T4c a rebuild return writes the restored position while the list is held, and the hold ends after the rebuilt rows answer', async () => {
        const { target } = await mountChats(8)
        const host = target
        let stored = 40
        const heldAtWrite: boolean[] = []
        Object.defineProperty(host, 'scrollTop', {
            configurable: true,
            get: () => stored,
            set: (value: number) => { stored = value; heldAtWrite.push(held(target)) },
        })

        await openSettings()
        DBState.db.zoomsize = 120
        settingsOpen.set(false)
        await settleMicrotasks()
        expect(heldAtWrite.at(-1)).toBe(true)

        // A row whose rendering is cached reports at once, so the hold may already be ending; it ends within the wait.
        await answer()
        runFrames(4)
        expect(held(target)).toBe(false)
    })
})

describe('rows mounted at older positions', () => {
    /** Records, for every row container the list receives, whether the list was held at that call. */
    function recordInsertions(list: HTMLElement) {
        const samples: boolean[] = []
        const note = (nodes: Array<Node | string>) => {
            for (const node of nodes) {
                if (node instanceof HTMLElement && node.classList.contains('chat-message-container')) {
                    samples.push(list.hasAttribute(HOLD))
                }
            }
        }
        const prepend = list.prepend.bind(list)
        list.prepend = (...nodes: Array<Node | string>) => { note(nodes); prepend(...nodes) }
        const insertBefore = list.insertBefore.bind(list)
        list.insertBefore = ((node: Node, ref: Node | null) => { note([node]); return insertBefore(node, ref) }) as typeof list.insertBefore
        return samples
    }

    test('R T4b a page growth holds the list before each older row is inserted; an append holds nothing', async () => {
        const { target, props, chat } = await mountChats(30, { loadPages: 8 })
        expect(held(target)).toBe(false)
        const samples = recordInsertions(listOf(target))

        props.loadPages = 12
        await settleMicrotasks()
        expect(samples).toHaveLength(4)
        expect(samples.every((value) => value)).toBe(true)
        await answer()
        runFrames(2)
        expect(held(target)).toBe(false)

        samples.length = 0
        chat.message.push({ role: 'char', data: 'new', chatId: 'idnew' })
        await settleMicrotasks()
        expect(samples.length).toBeGreaterThan(0)
        expect(samples.some((value) => value)).toBe(false)
        expect(held(target)).toBe(false)
    })

    test('R T4h the hold lasts until every older row has rendered, then two frames', async () => {
        const { target, props } = await mountChats(30, { loadPages: 8 })

        const before = h.parses.length
        props.loadPages = 12
        await settleMicrotasks()
        const asked = h.parses.slice(before)
        expect(asked.length).toBe(4)
        // Rows whose parse is pending show no rendered markup yet and do not report.
        runFrames(3)
        expect(held(target)).toBe(true)

        for (const parse of asked.slice(0, 3)) {
            parse.done = true
            parse.resolve(`P:${parse.args[0] as string}`)
        }
        await settleMicrotasks()
        runFrames(3)
        expect(held(target)).toBe(true)

        asked[3].done = true
        asked[3].resolve(`P:${asked[3].args[0] as string}`)
        await settleMicrotasks()
        runFrame()
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(false)
    })

    test('R T4h the wait ends at the cap when a row never renders', async () => {
        const { target, props } = await mountChats(30, { loadPages: 8 })

        props.loadPages = 12
        await settleMicrotasks()
        expect(held(target)).toBe(true)
        await wait(300)
        runFrames(3)
        expect(held(target)).toBe(true)
        await wait(1700)
        runFrame()
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(false)
    })

    test('R T4h rows removed before they render stop the wait without the cap', async () => {
        const { target, props } = await mountChats(30, { loadPages: 8 })

        props.loadPages = 12
        await settleMicrotasks()
        expect(held(target)).toBe(true)
        props.loadPages = 8
        await settleMicrotasks()
        runFrames(2)
        expect(held(target)).toBe(false)
    })

    test('R T4h comment rows do not hold the wait to the cap', async () => {
        const { target } = await mountChats(8, { commentIndexes: [0, 1], settle: false })
        expect(held(target)).toBe(true)
        await answer()
        runFrame()
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(false)
    })
})

describe('the hold the list hands to a bookmark jump or a screenshot', () => {
    interface RowHolding { holdRows: () => () => void }

    test('R the exported holdRows holds the list, stacks with a second hold and clears on the last release', async () => {
        const { target, instance } = await mountChats(6)
        const { holdRows } = instance as unknown as RowHolding
        expect(typeof holdRows).toBe('function')
        expect(held(target)).toBe(false)

        const first = holdRows()
        expect(held(target)).toBe(true)
        const second = holdRows()
        first()
        expect(held(target)).toBe(true)
        first()
        expect(held(target)).toBe(true)
        second()
        expect(held(target)).toBe(false)
    })
})

describe('a change of the list width', () => {
    test('R T4f a new width holds for two frames; the first report and a height-only change hold nothing', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        const { target } = await mountChats(6)
        const observer = FakeResizeObserver.instances.at(-1)!
        expect(observer).toBeDefined()

        observer.fire(400)
        expect(held(target)).toBe(false)
        observer.fire(400, 900)
        expect(held(target)).toBe(false)
        observer.fire(320)
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(true)
        runFrame()
        expect(held(target)).toBe(false)
    })
})

describe('which rows the sheet skips', () => {
    /** The skipping rule and the size rule of the adopted sheet, read through CSSOM. */
    function sheetSelectors() {
        const style = document.head.querySelector('style[data-risu-sheet="legacy-row-visibility"]') as HTMLStyleElement
        expect(style).not.toBeNull()
        const rules = [...(style.sheet as CSSStyleSheet).cssRules]
        const sizeRule = rules.find((rule) => rule.constructor.name === 'CSSStyleRule') as CSSStyleRule
        const supports = rules.find((rule) => rule.constructor.name === 'CSSSupportsRule') as CSSSupportsRule
        const skipRule = [...supports.cssRules][0] as CSSStyleRule
        return { size: sizeRule.selectorText, skip: skipRule.selectorText }
    }

    /** DOM order is newest first. */
    const domRows = (target: HTMLElement) => [...listOf(target).children] as HTMLElement[]

    test('R T1 rows from the fourth newest match, the newest three do not, and a held list matches none', async () => {
        const { target, chat } = await mountChats(8)
        const { size, skip } = sheetSelectors()
        expect(domRows(target).map((row) => row.matches(skip))).toEqual([false, false, false, true, true, true, true, true])
        expect(domRows(target).every((row) => row.matches(size))).toBe(true)

        chat.message.push({ role: 'char', data: 'new', chatId: 'idnew' })
        await settleMicrotasks()
        await answer()
        runFrames(4)
        const rows = domRows(target)
        expect(rows).toHaveLength(9)
        expect(rows.map((row) => row.matches(skip))).toEqual([false, false, false, true, true, true, true, true, true])

        listOf(target).setAttribute(HOLD, '')
        expect(rows.some((row) => row.matches(skip))).toBe(false)
    })

    test('R T2 a row with an editor or a partial-edit overlay inside it does not match', async () => {
        const { target } = await mountChats(8)
        const { skip } = sheetSelectors()
        const rows = domRows(target)
        const editor = document.createElement('textarea')
        editor.className = 'message-edit-area'
        rows[5].querySelector('.chattext')!.append(editor)
        const overlay = document.createElement('div')
        overlay.className = 'partial-edit-overlay'
        rows[6].append(overlay)
        expect(rows.map((row) => row.matches(skip))).toEqual([false, false, false, true, true, false, false, true])
        editor.remove()
        overlay.remove()
        expect(rows.map((row) => row.matches(skip))).toEqual([false, false, false, true, true, true, true, true])
    })
})

describe('destroying the list', () => {
    test('G T4g no hold or observer outlives the list', async () => {
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)
        const { target, instance } = await mountChats(6)
        const list = listOf(target)

        await openSettings()
        const observer = FakeResizeObserver.instances.at(-1)!
        observer.fire(400)
        observer.fire(320)
        expect(list.hasAttribute(HOLD)).toBe(true)

        mountedInstances.splice(mountedInstances.indexOf(instance), 1)
        await unmount(instance as never)
        expect(list.hasAttribute(HOLD)).toBe(false)
        expect(observer.disconnected).toBe(true)
    })

    test('G T4g a page growth wait is cancelled with its cap timer', async () => {
        const { target, props, instance } = await mountChats(30, { loadPages: 8 })
        const list = listOf(target)
        const set = vi.spyOn(globalThis, 'setTimeout')
        const cleared = vi.spyOn(globalThis, 'clearTimeout')

        props.loadPages = 12
        await settleMicrotasks()
        expect(list.hasAttribute(HOLD)).toBe(true)
        const capCall = set.mock.calls.findIndex((call) => call[1] === 1500)
        expect(capCall).toBeGreaterThanOrEqual(0)
        const capTimer = set.mock.results[capCall].value

        mountedInstances.splice(mountedInstances.indexOf(instance), 1)
        await unmount(instance as never)
        expect(list.hasAttribute(HOLD)).toBe(false)
        expect(cleared.mock.calls.some((call) => call[0] === capTimer)).toBe(true)
    })
})

