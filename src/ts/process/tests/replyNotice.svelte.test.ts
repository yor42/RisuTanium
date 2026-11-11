/**
 * The notice of an off-screen outcome (CHORE-685 S1b) through the REAL `sendChat`: the chip, the one sound and the system
 * notification of a reply that finishes while its chat is not on screen, the error and warning chips of a failed or stopped
 * one, and the web Notification that moved out of `sendChatBody`. The on-screen conditions are driven through the real
 * `chatOnScreen` leaf and `chatSurface`; the Android host is a fake channel; the toast host is the real one.
 * The module mocks follow `replyMarks.svelte.test.ts` (copied, not shared: each suite mocks its own graph).
 * MOCKED: Audio, Notification and the Android channel. Mocked success does not prove native behavior.
 *
 * Labels: "reproducer" fails on the code before S1b, "guard" passes before and after, "new API" pins behaviour that has no
 * counterpart before S1b.
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
/** Whether the page runs in the Android app; a test sets it. */
const platform = vi.hoisted(() => ({ android: false }))
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
    isAndroidTransport: () => platform.android,
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
import { isGeneratingIn, isWriting, stopWorkIn } from 'src/ts/process/chatOrigin'

// The on-screen leaf is S1d's; it exists in this tree.
import { holdChatView, installChatOnScreen, resetChatOnScreenForTests } from 'src/ts/process/chatOnScreen.svelte'
import { installChatSurface, resetChatSurfaceForTests } from 'src/lib/ChatScreens/chatSurface.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
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

async function sendThenLeaveWith(arg: Parameters<typeof sendChat>[1]): Promise<boolean | Error> {
    const outcome = settled(() => sendChat(-1, arg))
    toB()
    return await outcome
}

//#region the notice's surroundings

import { toastHost, resetToastHostForTests, type ToastView } from 'src/ts/toast/toastHost.svelte'
import { state as replyNotificationState } from 'src/ts/android/replyNotifications.svelte'
import { announceReply, hasChimedFor, hasSilencedFor, prepareReplyNoticeAvatar } from 'src/ts/process/replyNotice'
import { __avatarThumbTestHooks, getAvatarThumbSrc, peekAvatarThumb, THUMB_VERSION } from 'src/ts/media/avatarThumb'
import { createHostChannelFake, type HostChannelFake } from 'src/ts/android/hostChannelFake'

const audioPlays = { count: 0 }

class FakeAudio {
    constructor(readonly src: string) {}
    play(): Promise<void> {
        audioPlays.count += 1
        return Promise.resolve()
    }
}

interface RecordedNotification {
    title: string
    options: NotificationOptions | undefined
    instance: { onclick: (() => void) | null }
}

const notifications: RecordedNotification[] = []
const requestPermission = vi.fn(async () => 'granted')
const notificationState = { permission: 'granted' }

class FakeNotification {
    static get permission(): string { return notificationState.permission }
    static requestPermission = requestPermission
    onclick: (() => void) | null = null
    constructor(title: string, options?: NotificationOptions) {
        notifications.push({ title, options, instance: this })
    }
}

let fake: HostChannelFake

const toasts = (): readonly ToastView[] => toastHost.visible
/** Every post to the reply-notification bridge, v1 or v2: the guards must hold for both. */
const notifyCalls = () => [...fake.postedTo('replyNotifications', 'notify'), ...fake.postedTo('replyNotifications', 'notifyState')]

/** The v2 payloads the page sent, parsed from the JSON string each call carries. */
interface StatePayload {
    v: number
    key: string
    name: string
    text: string
    publicTitle: string
    chaId: string
    chatId: string
    avatar: string | null
    silent: boolean
}
const statePayloads = (): StatePayload[] =>
    fake.postedTo('replyNotifications', 'notifyState').map((call) => JSON.parse((call.args as string[])[0]) as StatePayload)

/** The one v2 payload the page sent; the assertion fails when there is none or more than one. */
function onlyStatePayload(): StatePayload {
    const payloads = statePayloads()
    expect(payloads).toHaveLength(1)
    return payloads[0]
}

/** Android with the switch on and the system allowing notifications, as the host reports it. */
function androidWithSwitchOn(): void {
    platform.android = true
    replyNotificationState.known = true
    replyNotificationState.optedIn = true
    replyNotificationState.enabled = true
}

function webWithNotificationOptIn(): void {
    platform.android = false
    DBState.db.notification = true
}

beforeEach(() => {
    audioPlays.count = 0
    notifications.length = 0
    requestPermission.mockClear()
    notificationState.permission = 'granted'
    platform.android = false
    replyNotificationState.known = false
    replyNotificationState.optedIn = false
    replyNotificationState.enabled = false
    fake = createHostChannelFake()
    window.__risuTaniumHost = fake.channel
    Object.defineProperty(globalThis, 'Audio', { configurable: true, writable: true, value: FakeAudio })
    Object.defineProperty(globalThis, 'Notification', { configurable: true, writable: true, value: FakeNotification })
    resetToastHostForTests()
})

afterEach(() => {
    delete window.__risuTaniumHost
    Reflect.deleteProperty(globalThis, 'Audio')
    Reflect.deleteProperty(globalThis, 'Notification')
    vi.restoreAllMocks()
    resetToastHostForTests()
})

/** A world whose first chat has a name and a reply to deliver; the page is built. */
function readyWorld(overrides: Record<string, unknown> = {}): void {
    installWorld(overrides)
    firstChat().name = 'Evening chat'
    installPage()
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Hello there.' })
}

//#endregion

describe('a reply that finishes while its chat is not on screen (T18)', () => {
    test('reproducer (T18): one chip names the character and the chat, one chime sounds, and the chat no longer reads as writing when it appears', async () => {
        readyWorld()
        const writingAtPost: boolean[] = []
        const post = toastHost.post.bind(toastHost)
        vi.spyOn(toastHost, 'post').mockImplementation((init) => {
            writingAtPost.push(isGeneratingIn({ chaId: 'char-0', chatId: 'chat-0' }))
            return post(init)
        })

        expect(await sendThenLeave(toB)).toBe(true)

        expect(toasts().map((toast) => [toast.kind, toast.text, toast.sub])).toEqual([['info', 'char-0 replied', 'Evening chat']])
        expect(audioPlays.count).toBe(1)
        expect(writingAtPost).toEqual([false])
    })

    test('reproducer (T18): the caller\'s signal is recorded as chimed, so the composer\'s own chime adds none', async () => {
        readyWorld()
        const caller = new AbortController()

        const outcome = settled(() => sendChat(-1, { signal: caller.signal }))
        toB()
        await outcome

        expect(hasChimedFor(caller.signal)).toBe(true)
        expect(hasChimedFor(new AbortController().signal)).toBe(false)
        expect(hasChimedFor(undefined)).toBe(false)
        // A finished reply is never marked as silenced: only a failed or stopped one is.
        expect(hasSilencedFor(caller.signal)).toBe(false)
        expect(hasSilencedFor(undefined)).toBe(false)
    })

    test('guard (T19 chip half): no chip, chime or notification while the chat stays on screen', async () => {
        readyWorld()
        androidWithSwitchOn()

        expect(await sendThenLeave(() => {})).toBe(true)

        expect(toasts()).toEqual([])
        expect(audioPlays.count).toBe(0)
        expect(notifyCalls()).toEqual([])
    })

    test('guard (T19 chip half, kills PM11): a prompt preview posts no chip', async () => {
        readyWorld()

        await sendThenLeaveWith({ previewPrompt: true, previewResult: {} })

        expect(toasts()).toEqual([])
        expect(audioPlays.count).toBe(0)
    })

    test('guard (T19 chip half): a trigger that stops the send posts no chip', async () => {
        readyWorld()
        runTriggerMock.mockResolvedValue({ tokens: 0, stopSending: true })

        expect(await sendThenLeave(toB)).toBe(false)

        expect(toasts()).toEqual([])
        expect(audioPlays.count).toBe(0)
    })

    test('guard (T19 chip half, kills PM11): a delete-stop, the chat gone from under the unit, posts no chip', async () => {
        readyWorld()
        const source = controlledStream()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        DBState.db.characters.splice(0, 1)
        selectedCharID.set(0)
        stopWorkIn({ chaId: 'char-0' })
        source.close()
        await outcome

        expect(toasts()).toEqual([])
        expect(audioPlays.count).toBe(0)
        expect(get(doingChat)).toBe(false)
    })

    test('guard: a notice that throws does not fail the send or leave it registered', async () => {
        readyWorld()
        vi.spyOn(toastHost, 'post').mockImplementation(() => { throw new Error('the host broke') })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await sendThenLeave(toB)).toBe(true)

        expect(get(doingChat)).toBe(false)
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
    })
})

describe('a send that fails or is stopped while its chat is not on screen (T19b, T19c, C1)', () => {
    /** Every sound and system notification the policy could produce, in a world that allows all of them. */
    function expectOnlyTheChip(kind: string, text: string): void {
        expect(toasts().map((toast) => [toast.kind, toast.text, toast.sub])).toEqual([[kind, text, 'Evening chat']])
        expect(audioPlays.count).toBe(0)
        expect(notifications).toEqual([])
        expect(notifyCalls()).toEqual([])
    }

    test('reproducer (T19b, M45): an early failure posts an error chip and no chime and no notification, web or Android', async () => {
        readyWorld()
        androidWithSwitchOn()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'boom' })

        expect(await sendThenLeave(toB)).toBe(false)

        expectOnlyTheChip('error', 'char-0\'s reply failed')
    })

    test('reproducer (T19b, M45): the same on the web with the opt-in on', async () => {
        readyWorld()
        webWithNotificationOptIn()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'boom' })

        expect(await sendThenLeave(toB)).toBe(false)

        expectOnlyTheChip('error', 'char-0\'s reply failed')
    })

    test('reproducer (MC-1204): a failed reply on screen, with no chip, still silences the composer chime', async () => {
        readyWorld()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'boom' })
        const caller = new AbortController()

        expect(await settled(() => sendChat(-1, { signal: caller.signal }))).toBe(false)

        expect(toasts()).toEqual([])
        expect(hasSilencedFor(caller.signal)).toBe(true)
    })

    test('guard (MC-1204): a reply finished on screen, and a trigger stop, do not silence the composer chime', async () => {
        readyWorld()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Whole reply.' })
        const finished = new AbortController()
        expect(await settled(() => sendChat(-1, { signal: finished.signal }))).toBe(true)
        expect(hasSilencedFor(finished.signal)).toBe(false)

        runTriggerMock.mockResolvedValue({ tokens: 0, stopSending: true })
        const triggered = new AbortController()
        expect(await settled(() => sendChat(-1, { signal: triggered.signal }))).toBe(false)
        expect(hasSilencedFor(triggered.signal)).toBe(false)
    })

    test('reproducer (T19b): a reader error after partial text posts an error chip', async () => {
        readyWorld()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: failingStream('partial text') })
        vi.spyOn(console, 'error').mockImplementation(() => {})

        expect(await sendThenLeave(toB)).toBeInstanceOf(Error)

        expectOnlyTheChip('error', 'char-0\'s reply failed')
    })

    test('reproducer (T19c, M45): a stop by the caller posts a warning chip and no chime and no notification', async () => {
        readyWorld()
        androidWithSwitchOn()
        webWithNotificationOptIn()
        const source = controlledStream()
        requestChatDataMock.mockReset()
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

        expectOnlyTheChip('warning', 'char-0\'s reply was stopped')
        expect(hasChimedFor(caller.signal)).toBe(false)
        expect(hasSilencedFor(caller.signal)).toBe(true)
    })

    test('reproducer (T19c): the keep-alive Stop posts a warning chip', async () => {
        readyWorld()
        const source = controlledStream()
        requestChatDataMock.mockReset()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.push('Partial')
        await settle()
        toB()
        abortUnitInProgress()
        source.close()
        await outcome

        expectOnlyTheChip('warning', 'char-0\'s reply was stopped')
    })
})

describe('the Android notification and the one sound (T21b, T31, R12)', () => {
    test('reproducer (T21b): each chat gets its own key, title and body, so two chats give two notifications', async () => {
        installWorld()
        firstChat().name = 'Evening chat'
        chatById('char-1', 'chat-1').name = 'Morning chat'
        installPage()
        androidWithSwitchOn()
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'First.' })
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: 'Second.' })

        await sendThenLeave(toB)
        // The second chat is shown, sends and is left for the first.
        const second = settled(() => sendChat())
        selectedCharID.set(0)
        await second

        expect(statePayloads().map((payload) => [payload.key, payload.name, payload.silent])).toEqual([
            ['char-0/chat-0', 'char-0', true],
            ['char-1/chat-1', 'char-1', true],
        ])
    })

    test('new API (T31): page visible and the switch on: the page chime sounds and the notification is silent', async () => {
        readyWorld()
        androidWithSwitchOn()

        await sendThenLeave(toB)

        expect(audioPlays.count).toBe(1)
        expect(statePayloads().map((payload) => payload.silent)).toEqual([true])
    })

    test('new API (T31, M35): page hidden and the switch on: no page chime and the notification sounds', async () => {
        readyWorld()
        androidWithSwitchOn()

        const caller = new AbortController()

        const outcome = settled(() => sendChat(-1, { signal: caller.signal }))
        setVisibility('hidden')
        await outcome

        expect(audioPlays.count).toBe(0)
        expect(statePayloads().map((payload) => payload.silent)).toEqual([false])
        // The sound went to the system, so the composer's playMessage chime must add none.
        expect(hasChimedFor(caller.signal)).toBe(true)
    })

    test('new API (T31): page hidden and the switch off: a best-effort page chime and no notification', async () => {
        readyWorld()
        platform.android = true

        await sendThenLeave(() => { setVisibility('hidden') })

        expect(audioPlays.count).toBe(1)
        expect(notifyCalls()).toEqual([])
    })

    test('new API (T31): opted in but blocked by the system counts as off: a page chime and no notification', async () => {
        readyWorld()
        androidWithSwitchOn()
        replyNotificationState.enabled = false

        await sendThenLeave(() => { setVisibility('hidden') })

        expect(audioPlays.count).toBe(1)
        expect(notifyCalls()).toEqual([])
    })

    test('guard: on screen, the host is told nothing', async () => {
        readyWorld()
        androidWithSwitchOn()

        await sendThenLeave(() => {})

        expect(notifyCalls()).toEqual([])
    })
})

/** A thumbnail store that holds `records` by image location, as `persistRecord` writes them. */
function thumbStoreOf(records: Record<string, unknown>) {
    return {
        getItem: vi.fn(async (key: string) => records[key] ?? null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
        iterate: vi.fn(async () => {}),
    }
}

const OWNER_IMAGE = 'assets/c0.png'
const OWNER_THUMB = 'data:image/webp;base64,UklGRg=='

/** Announces a finished reply for the first chat of the first character, as the send does after its registration ended. */
function announceFirstChat(): void {
    announceReply({ origin: { chaId: 'char-0', chatId: 'chat-0' }, outcome: 'reply' }, undefined)
}

describe('the reply notice names who replied and never what was said (S11, S12, MC-1348, MC-1378)', () => {
    afterEach(() => {
        __avatarThumbTestHooks.setStore(null)
        __avatarThumbTestHooks.reset()
        delete window.__risuTaniumReplyNotificationsHost
    })

    test('reproducer (R1): a chat named "Secret chat" never reaches the host; the v2 notice names the character and carries the fixed text', async () => {
        readyWorld()
        firstChat().name = 'Secret chat'
        androidWithSwitchOn()

        await sendThenLeave(toB)

        const posts = fake.postedTo('replyNotifications', 'notifyState')
        expect(posts).toHaveLength(1)
        expect(JSON.stringify(posts)).not.toContain('Secret chat')
        expect(statePayloads()[0].name).toBe('char-0')
        expect(statePayloads()[0].text).toBe('Replied')
    })

    test('new API (R2): the payload carries the key that is the notification tag, the target, the fixed texts and no icon when none is known', () => {
        installWorld()
        androidWithSwitchOn()

        announceFirstChat()

        expect(statePayloads()).toEqual([{
            v: 2,
            key: 'char-0/chat-0',
            name: 'char-0',
            text: 'Replied',
            publicTitle: 'New reply',
            chaId: 'char-0',
            chatId: 'chat-0',
            avatar: null,
            silent: true,
        }])
        expect(statePayloads()[0].publicTitle).not.toContain(statePayloads()[0].name)
    })

    test('new API (R2): a group reply is titled with the group and targets the group', () => {
        installGroupWorld(['member-1', 'member-2'])
        androidWithSwitchOn()

        announceReply({ origin: { chaId: 'group-1', chatId: 'group-chat' }, outcome: 'reply' }, undefined)

        const payload = onlyStatePayload()
        expect([payload.key, payload.name, payload.chaId, payload.chatId]).toEqual(['group-1/group-chat', 'group-1', 'group-1', 'group-chat'])
    })

    test('new API (R2): the owner\'s thumbnail from the memo is the avatar, and the notice looks nothing up itself', async () => {
        __avatarThumbTestHooks.setStore(thumbStoreOf({ [OWNER_IMAGE]: { v: THUMB_VERSION, src: OWNER_THUMB } }) as never)
        installWorld({}, { image: OWNER_IMAGE })
        androidWithSwitchOn()
        await getAvatarThumbSrc(OWNER_IMAGE)
        await prepareReplyNoticeAvatar()

        announceFirstChat()

        expect(onlyStatePayload().avatar).toBe(OWNER_THUMB)
    })

    test('new API (R2): a thumbnail that is not known yet gives no icon and starts no lookup', async () => {
        const store = thumbStoreOf({ [OWNER_IMAGE]: { v: THUMB_VERSION, src: OWNER_THUMB } })
        __avatarThumbTestHooks.setStore(store as never)
        installWorld({}, { image: OWNER_IMAGE })
        androidWithSwitchOn()
        await prepareReplyNoticeAvatar()

        announceFirstChat()
        // A lookup the notice started would reach the store after the thumbnail queue's first turn.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))

        expect(onlyStatePayload().avatar).toBeNull()
        expect(store.getItem).not.toHaveBeenCalled()
        expect(peekAvatarThumb(OWNER_IMAGE)).toBeUndefined()
    })

    test('new API (MC-1377): an animated or ineligible avatar gives no icon', async () => {
        __avatarThumbTestHooks.setStore(thumbStoreOf({ [OWNER_IMAGE]: { v: THUMB_VERSION, skip: true } }) as never)
        installWorld({}, { image: OWNER_IMAGE })
        androidWithSwitchOn()
        await getAvatarThumbSrc(OWNER_IMAGE)
        await prepareReplyNoticeAvatar()

        announceFirstChat()

        expect(onlyStatePayload().avatar).toBeNull()
    })

    test('new API (MC-1377): hideAllImages gives no icon even for a known thumbnail', async () => {
        __avatarThumbTestHooks.setStore(thumbStoreOf({ [OWNER_IMAGE]: { v: THUMB_VERSION, src: OWNER_THUMB } }) as never)
        installWorld({ hideAllImages: true }, { image: OWNER_IMAGE })
        androidWithSwitchOn()
        await getAvatarThumbSrc(OWNER_IMAGE)
        await prepareReplyNoticeAvatar()

        announceFirstChat()

        expect(onlyStatePayload().avatar).toBeNull()
    })

    test('guard (R3): the host call, the toast and the chimed record are all in place when announceReply returns', () => {
        installWorld()
        androidWithSwitchOn()
        const caller = new AbortController()

        announceReply({ origin: { chaId: 'char-0', chatId: 'chat-0' }, outcome: 'reply' }, caller.signal)

        expect(statePayloads()).toHaveLength(1)
        expect(toasts().map((toast) => toast.text)).toEqual(['char-0 replied'])
        expect(hasChimedFor(caller.signal)).toBe(true)
    })

    test('guard: an old host without notifyState gets the v1 notify, unchanged, and never the v2 call', async () => {
        delete window.__risuTaniumHost
        const legacy = { notify: vi.fn(), cancel: vi.fn() }
        window.__risuTaniumReplyNotificationsHost = legacy
        readyWorld()
        androidWithSwitchOn()

        await sendThenLeave(toB)

        expect(legacy.notify).toHaveBeenCalledTimes(1)
        expect(legacy.notify).toHaveBeenCalledWith('char-0/chat-0', 'char-0 replied', 'Evening chat', true)
    })
})

describe('the web Notification (T26, C2)', () => {
    test('reproducer (T26): a reply on screen creates no Notification and never asks for the permission', async () => {
        readyWorld()
        webWithNotificationOptIn()

        expect(await sendThenLeave(() => {})).toBe(true)

        expect(notifications).toEqual([])
        expect(requestPermission).not.toHaveBeenCalled()
    })

    test('reproducer (T26, M43): an off-screen reply creates one silent Notification titled with the name and bodied with the chat name', async () => {
        readyWorld()
        webWithNotificationOptIn()
        const focus = vi.spyOn(window, 'focus').mockImplementation(() => {})

        expect(await sendThenLeave(toB)).toBe(true)

        expect(requestPermission).not.toHaveBeenCalled()
        expect(notifications.map((entry) => [entry.title, entry.options?.body, entry.options?.silent])).toEqual([['char-0 replied', 'Evening chat', true]])
        notifications[0].instance.onclick?.()
        expect(focus).toHaveBeenCalledTimes(1)
    })

    test('reproducer (T26): a group of two members that both answer gives one Notification for the unit', async () => {
        installGroupWorld(['member-1', 'member-2'])
        installPage()
        webWithNotificationOptIn()
        requestChatDataMock.mockResolvedValue({ type: 'success', result: 'Hello there.' })

        expect(await sendThenLeave(() => { selectedCharID.set(-1) })).toBe(true)

        expect(requestChatDataMock.mock.calls.length).toBe(2)
        expect(notifications.map((entry) => entry.title)).toEqual(['group-1 replied'])
    })

    test.each([
        ['the opt-in is off', () => { DBState.db.notification = false }],
        ['the permission was refused', () => { notificationState.permission = 'denied' }],
        ['the permission was never asked', () => { notificationState.permission = 'default' }],
    ] as Array<[string, () => void]>)('guard: %s: no Notification and no prompt', async (_name, change) => {
        readyWorld()
        webWithNotificationOptIn()
        change()

        await sendThenLeave(toB)

        expect(notifications).toEqual([])
        expect(requestPermission).not.toHaveBeenCalled()
    })

    test('guard: on Android the web Notification is not used', async () => {
        readyWorld()
        webWithNotificationOptIn()
        platform.android = true

        await sendThenLeave(toB)

        expect(notifications).toEqual([])
    })
})
