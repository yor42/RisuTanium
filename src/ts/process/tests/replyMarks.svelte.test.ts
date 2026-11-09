/**
 * The persisted new-reply mark (CHORE-685 S1d) through the REAL `sendChat`: a reply that finishes, fails or is stopped
 * while its chat is not on screen marks that chat, and a reply that finishes on screen marks nothing. What "on screen"
 * means (R9) is driven through the real `chatOnScreen` leaf and the real `chatSurface`; the chat is saved by the real
 * `writeLiveChat`, observed through the save-tracker and `requestSaveNow` mocks. Alerts, modals and popups drawn over a
 * mounted, uncovered chat are not an input of the leaf, so they leave a chat on screen by construction.
 * The module mocks follow `saveOnHide.replyEnd.svelte.test.ts` (copied, not shared: each suite mocks its own graph).
 * Mocked success does not prove native WebView behavior.
 *
 * Labels: "reproducer" fails on the code before S1d, "guard" passes before and after, "new API" pins an API that S1d adds.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
import 'src/ts/polyfill'

//#region module mocks

const requestChatDataMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const requestSaveNowMock = vi.hoisted(() => vi.fn())
const markSpy = vi.hoisted(() => vi.fn())
/** The writeLiveChat in force; null means the real one. */
const writeHook = vi.hoisted(() => ({ current: null as null | ((chaId: string, chat: Chat, write: (live: Chat) => boolean | void) => boolean) }))
/** The save loop's counters as the guard reads them: each save request is a mark, and a commit covers the marks so far. */
const persistence = vi.hoisted(() => ({ marks: 0, committed: 0, callbacks: new Set<() => void>() }))

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

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    changeToPreset: vi.fn(),
    setCurrentChat: vi.fn(),
    getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        settingsOpen: writable(false),
        DynamicGUI: writable(false),
        sideBarStore: writable(false),
        ShowRealmFrameStore: writable(''),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The write the reply mark goes through; a test replaces it to make the mark fail.
vi.mock('src/ts/liveCharacterWrite', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/liveCharacterWrite')>()
    return {
        ...actual,
        writeLiveChat: (...args: Parameters<typeof actual.writeLiveChat>) => (writeHook.current ?? actual.writeLiveChat)(...args),
    }
})

vi.mock(import('src/ts/tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('src/ts/tokenizer'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('src/ts/parser/chatML'))

vi.mock(import('src/ts/process/lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('src/ts/process/lorebook.svelte'))

vi.mock(import('src/ts/util'), async () => {
    const stores = await import('src/ts/stores.svelte')
    const state = stores.DBState as unknown as { db: { characters: Array<{ chaId?: string, type?: string }> } }
    return {
        findCharacterbyId: (id: string) => {
            for (const candidate of state.db.characters) {
                if (candidate.type !== 'group' && candidate.chaId === id) {
                    return candidate
                }
            }
            return {
                name: 'Unknown Character',
                chaId: globalThis.crypto.randomUUID(),
                type: 'character',
                bias: [],
                desc: '',
                chats: [],
                utilityBot: false,
                inlayViewScreen: false,
                additionalAssets: [],
                emotionImages: [],
                reloadKeys: 0,
            }
        },
        getAuthorNoteDefaultText: vi.fn(() => ''),
        getPersonaPrompt: vi.fn(() => ''),
        getUserName: vi.fn(() => 'User'),
        isLastCharPunctuation: vi.fn(() => true),
        trimUntilPunctuation: vi.fn((s: string) => s),
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
    } as unknown as typeof import('src/ts/util')
})

vi.mock(import('src/ts/process/request/request'), () => ({
    requestChatData: requestChatDataMock,
}) as unknown as typeof import('src/ts/process/request/request'))

vi.mock(import('src/ts/process/stableDiff'), () => ({
    stableDiff: vi.fn(),
}) as unknown as typeof import('src/ts/process/stableDiff'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScript: vi.fn(async (_char: unknown, text: string) => text),
    processScriptFull: processScriptFullMock,
    risuChatParser: vi.fn((text: string) => text ?? ''),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('src/ts/process/exampleMessages'))

vi.mock(import('src/ts/process/tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/supaMemory'))

vi.mock(import('src/ts/process/group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('src/ts/process/group'))

vi.mock(import('src/ts/process/triggers'), () => ({
    runTrigger: runTriggerMock,
}) as unknown as typeof import('src/ts/process/triggers'))

vi.mock(import('src/ts/process/memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('src/ts/process/memory/hypamemory'))

vi.mock(import('src/ts/process/embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('src/ts/process/embedding/addinfo'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    getInlayAsset: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/process/models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('src/ts/process/models/modelString'))

vi.mock(import('src/ts/process/inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('src/ts/process/prereroll'))

vi.mock(import('src/ts/process/transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('src/ts/process/transformers'))

vi.mock(import('src/ts/process/memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hanuraiMemory'))

vi.mock(import('src/ts/process/memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav2'))

vi.mock(import('src/ts/process/scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('src/ts/process/scriptings'))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))

// The persistence entry points under observation: the save request and the marks the helper adds.
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    requestSaveNow: requestSaveNowMock,
    requestNetSweep: vi.fn(),
    hasUnsavedSaveMarks: vi.fn(() => false),
    getSaveMarkCount: () => persistence.marks,
    getCommittedSaveMarkCount: () => persistence.committed,
    afterNextSaveCommit: (callback: () => void) => { persistence.callbacks.add(callback) },
    isSavingStopped: () => false,
    onSavingStopped: () => () => {},
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isAndroidTransport: () => true,
}))

vi.mock('src/ts/storage/characterSaveMarks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/storage/characterSaveMarks')>()
    return { ...actual, markCharacterForSave: markSpy }
})

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: new Set() },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { abortUnitInProgress } from 'src/ts/process/generationOwnership.svelte'
import { resetActiveStreamsForTest } from 'src/ts/process/activeStreams'
import { inFlightKinds, resetInFlightForTest } from 'src/ts/process/inFlightWork'
import { resetHiddenReplySaveGuardForTest } from 'src/ts/process/hiddenReplySaveGuard'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string): Message {
    return { role, data, time: 1 } as unknown as Message
}

function makeChat(id: string, message: Message[]): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message } as unknown as Chat
}

function makeCharacter(chaId: string, chats: Chat[]): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        firstMessage: 'Hello!',
        alternateGreetings: [],
        desc: `${chaId} description`,
        bias: [],
        replaceGlobalNote: undefined,
        systemPrompt: undefined,
        utilityBot: false,
        inlayViewScreen: false,
        viewScreen: undefined,
        depth_prompt: undefined,
        reloadKeys: 0,
        supaMemory: false,
        chats,
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, memberIds: string[], chats: Chat[]): CharacterFixture {
    return {
        chaId,
        name: chaId,
        type: 'group',
        chatPage: 0,
        image: '',
        characters: [...memberIds],
        characterActive: memberIds.map(() => true),
        characterTalks: memberIds.map(() => 1),
        orderByOrder: true,
        reloadKeys: 0,
        supaMemory: false,
        chats,
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[], overrides: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        statics: { messages: 0 },
        aiModel: 'gpt-3.5-turbo',
        maxContext: 999999,
        maxResponse: 500,
        bias: [],
        mainPrompt: '',
        globalNote: '',
        jailbreakToggle: false,
        chainOfThought: false,
        personaPrompt: false,
        promptPreprocess: false,
        additionalPrompt: '',
        descriptionPrefix: '',
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        promptTemplate: undefined,
        promptInfoInsideChat: false,
        autoContinueMinTokens: 0,
        autoContinueChat: false,
        igpPrompt: '',
        notification: false,
        removeIncompleteResponse: false,
        streamingDisplayOptimizationMode: 'off',
        ttsAutoSpeech: false,
        presetChain: '',
        outputImageModal: false,
        rememberToolUsage: false,
        supaModelType: 'none',
        hypav2: false,
        hypaV3: false,
        hanuraiEnable: false,
        inlayErrorResponse: false,
        ...overrides,
    } as unknown as Database
}

function chatById(chaId: string, chatId: string): Chat {
    return DBState.db.characters.find((c) => c.chaId === chaId)!.chats.find((c) => c.id === chatId)!
}

function installSingleChat(): void {
    installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])])
    selectedCharID.set(0)
}

/** Two characters; the first generates, the test moves the selection to the second. */
function installTwoCharacters(): void {
    installDb([
        makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])]),
        makeCharacter('char-1', [makeChat('chat-1', [msg('user', 'Other')])]),
    ])
    selectedCharID.set(0)
}

function installGroupWorld(memberIds: string[]): void {
    const members = memberIds.map((id) => makeCharacter(id, [makeChat(`${id}-chat`, [msg('user', `${id} own`)])]))
    const group = makeGroup('group-1', memberIds, [makeChat('group-chat', [msg('user', 'Hi')])])
    installDb([group, ...members])
    selectedCharID.set(0)
}

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

function streamOf(...chunks: string[]): ReadableStream<{ data: string }> {
    let i = 0
    return new ReadableStream<{ data: string }>({
        pull(controller) {
            if (i < chunks.length) {
                controller.enqueue({ data: chunks[i] })
                i++
            } else {
                controller.close()
            }
        },
    })
}

interface ControlledStream {
    stream: ReadableStream<{ data: string }>
    push(text: string): void
    close(): void
}

function controlledStream(): ControlledStream {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({
        start(c) { controller = c },
    })
    return {
        stream,
        push(text) {
            try { controller?.enqueue({ data: text }) } catch { /* the reader cancelled it */ }
        },
        close() {
            try { controller?.close() } catch { /* the reader cancelled it */ }
        },
    }
}

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

/** The page's visibility, as the production helper reads it. */
function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

/** An output trigger that stays pending until released, like a trigger waiting on a stopped timer. */
function holdOutputTrigger(): { release: () => void } {
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    runTriggerMock.mockImplementation(async (_char: unknown, type: string) => {
        if (type === 'output') {
            await held
        }
        return undefined
    })
    return { release }
}
import { isWriting, stopWorkIn } from 'src/ts/process/chatOrigin'

// The modules S1d adds are loaded with a caught import, so a run on the code before S1d reaches the assertions about the
// defect instead of failing on the import. The stand-ins do nothing, or throw for an API only the new code answers.
// The paths are held in variables so that the bundler does not resolve them when the files are absent.
const LEAF_PATH = '../chatOnScreen.svelte'
const MARKS_PATH = '../replyMarks'
type OnScreenLeaf = typeof import('src/ts/process/chatOnScreen.svelte')
type ReplyMarkModule = typeof import('src/ts/process/replyMarks')
const missing = (name: string) => (): never => { throw new Error(`${name} does not exist before S1d`) }
const leaf: OnScreenLeaf = (await import(/* @vite-ignore */ LEAF_PATH).catch(() => null) as OnScreenLeaf | null) ?? {
    holdChatView: () => () => {},
    installChatOnScreen: () => () => {},
    resetChatOnScreenForTests: () => {},
    isChatOnScreen: missing('isChatOnScreen'),
    isPageVisible: missing('isPageVisible'),
}
const { holdChatView, installChatOnScreen, resetChatOnScreenForTests } = leaf
const marks: ReplyMarkModule = (await import(/* @vite-ignore */ MARKS_PATH).catch(() => null) as ReplyMarkModule | null) ?? {
    classifyReplyOutcome: missing('classifyReplyOutcome'),
    clearReplyMark: missing('clearReplyMark'),
    replyMarkOf: missing('replyMarkOf'),
    setReplyMark: missing('setReplyMark'),
    noteUnitFailure: missing('noteUnitFailure'),
    recordReplyOutcome: missing('recordReplyOutcome'),
}
const { classifyReplyOutcome, clearReplyMark, replyMarkOf, setReplyMark } = marks
import { assembleChat, splitChat } from 'src/ts/storage/store2/codec'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import { installChatSurface, resetChatSurfaceForTests } from 'src/lib/ChatScreens/chatSurface.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { toastHost, resetToastHostForTests } from 'src/ts/toast/toastHost.svelte'
import { DynamicGUI, settingsOpen, ShowRealmFrameStore, sideBarStore } from 'src/ts/stores.svelte'

//#region the page and its observations

/** What each save-tracker mark saw: the id marked, whether a send was registered as writing to it, and the watched chat's mark. */
interface Landing {
    id: string | undefined
    writing: boolean
    mark: unknown
}

const landings: Landing[] = []
const events: string[] = []
const saves: Array<{ mark: unknown }> = []

/** The chat the observations read: the first chat of the first character. */
const watchedChat = (): Chat | undefined => DBState.db.characters?.[0]?.chats?.[0]

let releaseView: (() => void) | null = null
let stopLeaf: (() => void) | null = null

/** The page App builds: the surface and the on-screen leaf installed, and the chat view mounted. */
function installPage(): void {
    installChatSurface()
    stopLeaf = installChatOnScreen()
    releaseView = holdChatView()
}

/** Two characters; the first has two chats, the second one. The first is selected. */
function installWorld(overrides: Record<string, unknown> = {}, firstExtra: Record<string, unknown> = {}): void {
    const first = { ...makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')]), makeChat('chat-0b', [msg('user', 'Other')])]), ...firstExtra }
    installDb([first as CharacterFixture, makeCharacter('char-1', [makeChat('chat-1', [msg('user', 'Elsewhere')])])], overrides)
    selectedCharID.set(0)
}

const firstChat = (): Chat => chatById('char-0', 'chat-0')

function failingStream(partial: string): ReadableStream<{ data: string }> {
    let sent = false
    return new ReadableStream<{ data: string }>({
        pull(controller) {
            if (!sent) {
                sent = true
                controller.enqueue({ data: partial })
            } else {
                controller.error(new Error('the stream broke'))
            }
        },
    })
}

/** Starts the send on the chat on screen, leaves that chat at once (the origin is fixed at entry), and lets the queued reply arrive. */
async function sendThenLeave(leave: () => void | Promise<void>): Promise<boolean | Error> {
    const outcome = settled(() => sendChat())
    await leave()
    return await outcome
}

const toB = (): void => { selectedCharID.set(1) }

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    markSpy.mockReset()
    requestSaveNowMock.mockReset()
    landings.length = 0
    events.length = 0
    saves.length = 0
    persistence.marks = 0
    persistence.committed = 0
    persistence.callbacks.clear()
    writeHook.current = null
    resetHiddenReplySaveGuardForTest()
    resetInFlightForTest()
    resetActiveStreamsForTest()
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    settingsOpen.set(false)
    studioOpen.set(false)
    DynamicGUI.set(false)
    sideBarStore.set(false)
    ShowRealmFrameStore.set('')
    markSpy.mockImplementation((id: string | undefined) => {
        const mark = watchedChat()?.unseenReply
        landings.push({ id, writing: id === undefined ? false : isWriting({ chaId: id }), mark })
        events.push(`mark:${String(id)}:${String(mark)}`)
    })
    requestSaveNowMock.mockImplementation(() => {
        persistence.marks += 1
        const mark = watchedChat()?.unseenReply
        saves.push({ mark })
        events.push(`save:${String(mark)}`)
    })
    doingChat.set(false)
    setVisibility('visible')
})

afterEach(() => {
    releaseView?.()
    releaseView = null
    stopLeaf?.()
    stopLeaf = null
    resetChatOnScreenForTests()
    resetChatSurfaceForTests()
    resetHiddenReplySaveGuardForTest()
    resetInFlightForTest()
    selectedCharID.set(-1)
    settingsOpen.set(false)
    studioOpen.set(false)
    DynamicGUI.set(false)
    sideBarStore.set(false)
    ShowRealmFrameStore.set('')
    Reflect.deleteProperty(document, 'visibilityState')
})

//#endregion

describe('a reply that finishes while its chat is not on screen (T25)', () => {
    const AWAY: Array<[string, () => void | Promise<void>]> = [
        ['another chat is shown', toB],
        ['Home is shown (nothing selected)', () => { selectedCharID.set(-1) }],
        ['the grid is open (ChatScreen unmounted)', () => { releaseView?.() }],
        ['Settings covers the kept-mounted chat', () => { settingsOpen.set(true) }],
        ['Studio covers the kept-mounted chat', () => { studioOpen.set(true) }],
        ['the page is hidden', () => { setVisibility('hidden') }],
        ['the phone layout has its sidebar open over the chat (C4)', () => { DynamicGUI.set(true); sideBarStore.set(true) }],
        ['the Realm browser is open over the chat (C4)', () => { ShowRealmFrameStore.set('https://realm.example/') }],
        ['another chat of the same character is shown', () => { DBState.db.characters[0].chatPage = 1 }],
    ]

    test.each(AWAY)('reproducer (T25, P9): %s: A has the blue mark as stored and read back by the codec, and no other chat has one', async (_name, leave) => {
        installWorld()
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Hello there.' })

        expect(await sendThenLeave(leave)).toBe(true)

        expect(firstChat().unseenReply).toBe('reply')
        // The chat is split into its stored units and assembled again, as the codec stores and reads it.
        const split = splitChat(JSON.parse(JSON.stringify($state.snapshot(firstChat()))) as JsonObject, 'chat')
        expect(assembleChat(split.core, split.chunks, 'chat', split.alt).unseenReply).toBe('reply')
        expect(chatById('char-0', 'chat-0b').unseenReply).toBeUndefined()
        expect(chatById('char-1', 'chat-1').unseenReply).toBeUndefined()
        expect(get(doingChat)).toBe(false)
    })

    test.each([
        ['A stays shown', () => {}],
        ['the sidebar is docked beside the chat (the desktop layout)', () => { sideBarStore.set(true) }],
    ] as Array<[string, () => void]>)('guard (T19): %s: the reply sets no mark', async (_name, leave) => {
        installWorld()
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Hello there.' })

        expect(await sendThenLeave(leave)).toBe(true)

        expect(firstChat().unseenReply).toBeUndefined()
        // Nothing was written and cleared again: no save-tracker mark ever saw the mark on the chat.
        expect(landings.filter((landing) => landing.mark === 'reply')).toEqual([])
    })

    test('guard (T25 uninstalled row, kills PM10): a leaf nobody installed counts every chat as on screen, so the reply sets no mark', async () => {
        installWorld()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Hello there.' })

        expect(await sendThenLeave(toB)).toBe(true)

        expect(firstChat().unseenReply).toBeUndefined()
    })

    test('reproducer (P7): the mark lands while the send is registered, and the owner is in the save tracker with it', async () => {
        installWorld()
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Done.' })

        expect(await sendThenLeave(toB)).toBe(true)

        const withMark = landings.filter((landing) => landing.id === 'char-0' && landing.mark === 'reply')
        expect(withMark.length).toBeGreaterThan(0)
        // The write marks the owner itself, while the registration is live (the settle marks it again after the end).
        expect(withMark.some((landing) => landing.writing)).toBe(true)
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
    })

    test('reproducer (P7 hidden order): with the page hidden the mark is written before the last save request, which carries it', async () => {
        installWorld()
        installPage()
        setVisibility('hidden')
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Done.' })

        expect(await settled(() => sendChat())).toBe(true)

        expect(firstChat().unseenReply).toBe('reply')
        // A save after the write, at the unit end, carries the mark.
        expect(saves.at(-1)?.mark).toBe('reply')
        const written = events.findIndex((event) => event === 'mark:char-0:reply')
        expect(written).toBeGreaterThanOrEqual(0)
        expect(events.lastIndexOf('save:reply')).toBeGreaterThan(written)
    })

    test('reproducer (P7 group): in a group the mark lands on the group chat and not on the member\'s chats', async () => {
        installGroupWorld(['member-a'])
        installPage()
        setVisibility('hidden')
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'A speaks.' })

        expect(await settled(() => sendChat())).toBe(true)

        expect(chatById('group-1', 'group-chat').unseenReply).toBe('reply')
        expect(chatById('member-a', 'member-a-chat').unseenReply).toBeUndefined()
    })

    test('reproducer (P9b): with two chats of one id, the reply marks the chat it was written into and not the other', async () => {
        installWorld()
        const owner = DBState.db.characters[0]
        owner.chats[1].id = 'chat-0'
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Hello there.' })

        expect(await sendThenLeave(toB)).toBe(true)

        expect(owner.chats[0].unseenReply).toBe('reply')
        expect(owner.chats[1].unseenReply).toBeUndefined()
    })

    test('guard (P11): a mark write that throws still releases the send, runs the hidden flush and settles the origin', async () => {
        installWorld()
        installPage()
        setVisibility('hidden')
        writeHook.current = () => { throw new Error('the mark write failed') }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Done.' })

        expect(await settled(() => sendChat())).toBe(true)

        expect(get(doingChat)).toBe(false)
        expect(inFlightKinds()).not.toContain('chat')
        // The hidden flush ran at the unit end as well as after the reply was written.
        expect(requestSaveNowMock).toHaveBeenCalledTimes(2)
        // The settle marked the origin after the registration ended.
        expect(landings.some((landing) => landing.id === 'char-0' && !landing.writing)).toBe(true)
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
        expect(firstChat().unseenReply).toBeUndefined()
    })
})

describe('a send that fails or is stopped while its chat is not on screen (T19b, T19c)', () => {
    test('reproducer (T19b): an early failure gives the red mark', async () => {
        installWorld()
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'boom' })

        expect(await sendThenLeave(toB)).toBe(false)

        expect(firstChat().unseenReply).toBe('error')
    })

    test('reproducer (T19b): a reader error after partial text gives the red mark', async () => {
        installWorld()
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: failingStream('partial text') })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const result = await sendThenLeave(toB)

        expect(result).toBeInstanceOf(Error)
        expect(firstChat().unseenReply).toBe('error')
        expect(get(doingChat)).toBe(false)
    })

    test('reproducer (T19b): an error raised before the request, a context that cannot hold the prompt, gives the red mark', async () => {
        installWorld({ maxContext: 0 })
        installPage()

        expect(await sendThenLeave(toB)).toBe(false)

        expect(requestChatDataMock).not.toHaveBeenCalled()
        expect(firstChat().unseenReply).toBe('error')
    })

    test('reproducer (T19c): a stop by the caller\'s signal gives the red mark, not the blue one', async () => {
        installWorld()
        installPage()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const caller = new AbortController()

        const outcome = settled(() => sendChat(-1, { signal: caller.signal }))
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        toB()
        caller.abort()
        source.close()
        await outcome

        expect(firstChat().unseenReply).toBe('error')
    })

    test('reproducer (T19c): the keep-alive Stop gives the red mark', async () => {
        installWorld()
        installPage()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        toB()
        abortUnitInProgress()
        source.close()
        await outcome

        expect(firstChat().unseenReply).toBe('error')
    })

    test('reproducer: an error alerted after a finished reply (the emotion step) leaves the blue mark', async () => {
        installWorld({}, { viewScreen: 'emotion', emotionImages: [['happy', 'happy-image']] })
        installPage()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Whole reply.' })
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'emotion failed' })

        expect(await sendThenLeave(toB)).toBe(true)

        expect(firstChat().unseenReply).toBe('reply')
    })

    test('guard (T19): a trigger that stops the send leaves no mark', async () => {
        installWorld()
        installPage()
        runTriggerMock.mockResolvedValue({ tokens: 0, stopSending: true })

        expect(await sendThenLeave(toB)).toBe(false)

        expect(firstChat().unseenReply).toBeUndefined()
    })

    test('guard (T19): a prompt preview leaves no mark', async () => {
        installWorld()
        installPage()

        await sendThenLeaveWith({ previewPrompt: true, previewResult: {} })

        expect(firstChat().unseenReply).toBeUndefined()
    })

    test('guard (T19): a delete-stop, the chat gone from under the unit, leaves no mark on any chat', async () => {
        installWorld()
        installPage()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        // The character is deleted: the unit is stopped and its origin no longer resolves.
        DBState.db.characters.splice(0, 1)
        selectedCharID.set(0)
        stopWorkIn({ chaId: 'char-0' })
        source.close()
        await outcome

        for (const character of DBState.db.characters) {
            for (const chat of character.chats) {
                expect(chat.unseenReply).toBeUndefined()
            }
        }
        expect(get(doingChat)).toBe(false)
    })

    test('reproducer (T19): a character moved to Trash while it writes off screen gets no mark and no chip', async () => {
        installWorld()
        installPage()
        resetToastHostForTests()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        // The Trash move keeps the character but stops its unit, and the selection leaves it.
        DBState.db.characters[0].trashTime = Date.now()
        selectedCharID.set(-1)
        stopWorkIn({ chaId: 'char-0' })
        source.close()
        await outcome

        for (const character of DBState.db.characters) {
            for (const chat of character.chats) {
                expect(chat.unseenReply).toBeUndefined()
            }
        }
        expect(toastHost.visible).toEqual([])
        expect(get(doingChat)).toBe(false)
    })
})

async function sendThenLeaveWith(arg: Parameters<typeof sendChat>[1]): Promise<boolean | Error> {
    const outcome = settled(() => sendChat(-1, arg))
    toB()
    return await outcome
}

describe('the outcome of a send', () => {
    const facts = (extra: Partial<Parameters<typeof classifyReplyOutcome>[1]> = {}) => ({
        completed: false, signal: new AbortController().signal, threw: false, modulesFailed: false, ...extra,
    })

    test('new API: the first match wins: no origin, then a finished reply, then a stop, then a failure, then none', () => {
        const aborted = new AbortController()
        aborted.abort()
        expect(classifyReplyOutcome(false, facts({ completed: true }))).toBe('none')
        expect(classifyReplyOutcome(false, facts({ signal: aborted.signal }))).toBe('none')
        expect(classifyReplyOutcome(true, facts({ completed: true }))).toBe('reply')
        expect(classifyReplyOutcome(true, facts({ completed: true, signal: aborted.signal }))).toBe('stopped')
        expect(classifyReplyOutcome(true, facts({ signal: aborted.signal, threw: true }))).toBe('stopped')
        expect(classifyReplyOutcome(true, facts({ threw: true }))).toBe('failed')
        expect(classifyReplyOutcome(true, facts({ modulesFailed: true }))).toBe('failed')
        expect(classifyReplyOutcome(true, facts())).toBe('none')
    })
})

describe('reading and writing the mark', () => {
    test('new API (P10): a value this build does not know shows as no mark, and the clear leaves it', () => {
        installWorld()
        const chat = firstChat()
        const loose = chat as unknown as Record<string, unknown>
        loose.unseenReply = 'a value of a later build'

        expect(replyMarkOf(chat)).toBeNull()
        expect(clearReplyMark('char-0', chat)).toBe(false)
        expect(loose.unseenReply).toBe('a value of a later build')
        expect(markSpy).not.toHaveBeenCalled()
        expect(replyMarkOf({ unseenReply: 'reply' })).toBe('reply')
        expect(replyMarkOf({ unseenReply: 'error' })).toBe('error')
        expect(replyMarkOf({})).toBeNull()
    })

    test('new API: the latest outcome wins, even over a value this build does not know, and the clear removes a known one and marks the owner', () => {
        installWorld()
        const chat = firstChat()
        ;(chat as unknown as Record<string, unknown>).unseenReply = 'a value of a later build'

        expect(setReplyMark({ chaId: 'char-0', chatId: 'chat-0' }, chat, 'error')).toBe(true)
        expect(chat.unseenReply).toBe('error')
        expect(setReplyMark({ chaId: 'char-0', chatId: 'chat-0' }, chat, 'reply')).toBe(true)
        expect(chat.unseenReply).toBe('reply')
        markSpy.mockClear()
        expect(clearReplyMark('char-0', chat)).toBe(true)
        expect(chat.unseenReply).toBeUndefined()
        expect(markSpy).toHaveBeenCalledWith('char-0')
    })

    test('new API: a gone owner lands nothing and marks nothing', () => {
        installWorld()
        const chat = firstChat()
        vi.spyOn(console, 'warn').mockImplementation(() => {})

        expect(setReplyMark({ chaId: 'nobody', chatId: 'chat-0' }, chat, 'reply')).toBe(false)
        expect(chat.unseenReply).toBeUndefined()
        expect(markSpy).not.toHaveBeenCalled()
    })
})
