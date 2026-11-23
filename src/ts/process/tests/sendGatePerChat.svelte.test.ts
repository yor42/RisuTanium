/**
 * The send gate is per chat: a chat is refused while a unit holds it or a native reply targets it, and only then.
 *
 * Drives the REAL, unmocked `sendChat` and the applies (`../index.svelte`) against a real `$state` database, with the same
 * module mocks as `sendChatOwnership.svelte.test.ts` (copied, not shared: each suite mocks its own graph). The rows
 * cover the take refusal, the release on every path, the keyed wake-up of a deferred recovered reply, the native-reply
 * refusal and the untracked reads of the gate.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database, Chat, Message } from 'src/ts/storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import 'src/ts/polyfill'

//#region module mocks

interface ChatOutputArg {
    char: { chaId?: string }
    chat: { id?: string }
    characterIndex: number
    chatIndex: number
    messageIndex: number
}

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const runInlayScreenMock = vi.hoisted(() => vi.fn())
const processScriptFullMock = vi.hoisted(() => vi.fn())
const hypaMemoryV3Mock = vi.hoisted(() => vi.fn())
const supaMemoryMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())
const workSpies = vi.hoisted(() => ({ beginWork: vi.fn(), registerWork: vi.fn() }))
const publishedUnits = vi.hoisted(() => ({ controllers: [] as AbortController[] }))

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
    } as unknown as typeof import('src/ts/stores.svelte')
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
    alertError: alertErrorMock,
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
        // Faithful to production: the live non-group character holding the
        // id, or a blank one with a fresh id.
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
        isLastCharPunctuation: isLastCharPunctuationMock,
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
    sayTTS: sayTTSMock,
}) as unknown as typeof import('src/ts/process/tts'))

vi.mock(import('src/ts/process/memory/supaMemory'), () => ({
    supaMemory: supaMemoryMock,
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
    runInlayScreen: runInlayScreenMock,
}) as unknown as typeof import('src/ts/process/inlayScreen'))

vi.mock(import('src/ts/process/prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage,
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
    hypaMemoryV3: hypaMemoryV3Mock,
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/process/modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    readImage: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    pluginV2: { chatOutput: chatOutputListeners },
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

// The real work registry, with its two entry points wrapped so a test can
// count how many calls registered work.
vi.mock('src/ts/process/chatOrigin', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/chatOrigin')>()
    workSpies.beginWork.mockImplementation(actual.beginWork)
    workSpies.registerWork.mockImplementation(actual.registerWork)
    return { ...actual, beginWork: workSpies.beginWork, registerWork: workSpies.registerWork }
})

// The real published-unit state, with publishUnit wrapped so a test can ask the real isUnitInProgressSignal about the
// controller a send published.
vi.mock('src/ts/process/generationOwnership.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/generationOwnership.svelte')>()
    return {
        ...actual,
        publishUnit: (controller: AbortController, origin?: { chaId: string, chatId: string }) => {
            publishedUnits.controllers.push(controller)
            actual.publishUnit(controller, origin)
        },
    }
})

//#endregion

import { sendChat, doingChat, sendTargetOf, applyRecoveredReply } from 'src/ts/process/index.svelte'
import type { SendChatArg } from 'src/ts/process/index.svelte'
import { activeUnits, type ActiveUnitKey } from 'src/ts/process/activeUnits'
import { subscribeInFlight, inFlightKinds } from 'src/ts/process/inFlightWork'
import { setReconcileTrigger } from 'src/ts/nativeReply/pageState'
import { resetRunningRepliesForTests } from 'src/ts/nativeReply/runningReplies.svelte'
import type { ReplyBlob } from 'src/ts/nativeReply/blob'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { isWriting } from 'src/ts/process/chatOrigin'
import { isUnitInProgressSignal, processStageIn, setProcessStage } from 'src/ts/process/generationOwnership.svelte'
import { stopAllReplyWork } from 'src/ts/process/chatOrigin'
import { simulateRunningSend, clearRunningSends } from './activeUnits.test-helpers'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { toSaveType } from 'src/ts/storage/risuSave'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message, ...extra } as unknown as Chat
}

function makeCharacter(chaId: string, chats: Chat[], extra: Record<string, unknown> = {}): CharacterFixture {
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
        ...extra,
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

function charById(chaId: string): CharacterFixture {
    return DBState.db.characters.find((c) => c.chaId === chaId)!
}

function chatById(chaId: string, chatId: string): Chat {
    return charById(chaId).chats.find((c) => c.id === chatId)!
}

function datas(chat: Chat): string[] {
    return chat.message.map((m) => m.data)
}

/** One character, one chat, selected. */
function installSingleChat(overrides: Record<string, unknown> = {}): void {
    installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])])], overrides)
    selectedCharID.set(0)
}

/** A group of `memberIds`, in turn order, with the group selected. */
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

function mockStreamingReply(...chunks: string[]): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf(...chunks) })
}

function mockReply(text: string): void {
    requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
}

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

/**
 * Starts `call` against a stream the test feeds by hand, waits until the
 * request is made and one chunk has been read, and hands back the stream and
 * the eventual outcome.
 */
async function startHeldSend(call: () => Promise<boolean>): Promise<{ source: ControlledStream, outcome: Promise<boolean | Error> }> {
    const source = controlledStream()
    requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
    const outcome = settled(call)
    await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
    source.push('Hello')
    await settle()
    return { source, outcome }
}

/**
 * Every value `doingChat` takes while `call` runs, in order, starting with the
 * value it had before the call.
 */
async function observeFlag(call: () => Promise<boolean>): Promise<{ values: boolean[], result: boolean | Error }> {
    const values: boolean[] = []
    const unsubscribe = doingChat.subscribe((v) => { values.push(v) })
    const result = await settled(call)
    unsubscribe()
    return { values, result }
}

/** The number of times the flag went false between its first true and its last value. */
function releasesBeforeTheEnd(values: boolean[]): number {
    const fromTake = values.slice(values.indexOf(true))
    return fromTake.slice(0, -1).filter((v) => v === false).length
}

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    sayTTSMock.mockReset()
    runInlayScreenMock.mockReset()
    runInlayScreenMock.mockImplementation((_char: unknown, text: string) => ({ text, promise: undefined }))
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    hypaMemoryV3Mock.mockReset()
    supaMemoryMock.mockReset()
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    chatOutputListeners.clear()
    workSpies.beginWork.mockClear()
    workSpies.registerWork.mockClear()
    clearRunningSends()
})

afterEach(() => {
    selectedCharID.set(-1)
})

//#endregion
//#region the keyed registry of taken units

type UnitKey = ActiveUnitKey

/** char-0/chat-0 (selected) and char-1/chat-1: two chats under two owners. */
function installTwoChats(): void {
    installDb([
        makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])]),
        makeCharacter('char-1', [makeChat('chat-1', [msg('user', 'Hey')])]),
    ])
    selectedCharID.set(0)
}

const CHAT_A: UnitKey = { chaId: 'char-0', chatId: 'chat-0' }
const CHAT_B: UnitKey = { chaId: 'char-1', chatId: 'chat-1' }

/** Answers each request with the stream of the character it asks for, so two sends can be held at once. */
function routeStreamsByCharacter(streams: Record<string, ControlledStream>): void {
    requestChatDataMock.mockImplementation(async (arg: { currentChar: { chaId: string } }) => (
        { type: 'streaming', result: streams[arg.currentChar.chaId].stream }
    ))
}

/** Closes every held stream and waits for every outcome, so a failed assertion leaves no unit held. */
async function finishAll(sources: ControlledStream[], outcomes: Array<Promise<boolean | Error>>): Promise<void> {
    for (const source of sources) {
        source.close()
    }
    for (const outcome of outcomes) {
        await outcome
    }
}

/**
 * Holds one send (or prompt preview) of `arg` inside its request until `finish` is called. A preview is held on a gate,
 * a send on a stream.
 */
async function holdUnit(arg: SendChatArg): Promise<{ finish(): Promise<boolean | Error> }> {
    if (arg.previewPrompt) {
        let open!: () => void
        const gate = new Promise<void>((resolve) => { open = resolve })
        requestChatDataMock.mockImplementationOnce(async () => {
            await gate
            return { type: 'success', result: '{}' }
        })
        const outcome = settled(() => sendChat(-1, arg))
        try {
            await until(() => requestChatDataMock.mock.calls.length > 0, 'the preview request')
        } catch (error) {
            open()
            await outcome
            throw error
        }
        return { finish: async () => { open(); return outcome } }
    }
    const { source, outcome } = await startHeldSend(() => sendChat(-1, arg))
    return { finish: async () => { source.close(); return outcome } }
}

//#endregion

import { subscribeStreamChanges, resetActiveStreamsForTest, replySpeakerOf } from 'src/ts/process/activeStreams'
import { addRunningReplies, setRunningReplies } from 'src/ts/nativeReply/runningReplies.svelte'
import { resetPageStateForTests } from 'src/ts/nativeReply/pageState'
import { hasAnyWork, registerWork } from 'src/ts/process/chatOrigin'
import { flushSync } from 'svelte'

//#region fixtures of the per-chat gate

const GROUP = { chaId: 'group-1', chatId: 'group-chat' }

function applyBlobFor(key: string, target: UnitKey): ReplyBlob {
    return {
        target: { ...target }, targetName: target.chaId, saying: target.chaId,
        generationInfo: { generationId: key, model: 'm' }, promptInfo: { promptName: 'Main' }, escape: false, requestedMs: 1,
        parse: { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false },
    }
}

function nativeEntry(key: string, target: UnitKey): { key: string, target: { chaId: string, chatId: string, name: string } } {
    return { key, target: { ...target, name: target.chaId } }
}

const reconcileCalls = vi.hoisted(() => ({ count: 0 }))

beforeEach(() => {
    resetRunningRepliesForTests()
    resetPageStateForTests()
    resetActiveStreamsForTest()
    reconcileCalls.count = 0
    setReconcileTrigger(() => { reconcileCalls.count++ })
})

afterEach(() => {
    setReconcileTrigger(null)
    resetRunningRepliesForTests()
    vi.restoreAllMocks()
})

//#endregion

describe('a send started from another send\'s notice into the same chat', () => {
    test('A3: a send that the first send\'s in-flight notice starts into the first send\'s chat is refused and requests nothing', async () => {
        installTwoChats()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const inner: Array<Promise<boolean | Error>> = []
        const stop = subscribeInFlight(() => {
            stop()
            inner.push(settled(() => sendChat(-1, { origin: CHAT_A })))
        })
        const first = settled(() => sendChat(-1, { origin: CHAT_A }))
        try {
            await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
            source.push('A')
            await settle()

            expect(inner).toHaveLength(1)
            expect(await inner[0]).toBe(false)
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
            expect(activeUnits.has(CHAT_A)).toBe(true)
        } finally {
            stop()
            await finishAll([source], [first, ...inner])
        }
        expect(await first).toBe(true)
        expect(activeUnits.has(CHAT_A)).toBe(false)
    })

    test('A3b: a send into a group chat that a speaker notice started while another send entered is refused at its take; the registration and the speaker it made are gone', async () => {
        installGroupWorld(['m1'])
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const inner: Array<Promise<boolean | Error>> = []
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        const stop = subscribeStreamChanges((change) => {
            if (change === 'speaker') {
                stop()
                inner.push(settled(() => sendChat(-1, { origin: { ...GROUP } })))
            }
        })
        const outer = settled(() => sendChat(-1, { origin: { ...GROUP, memberChaId: 'm1' } }))
        try {
            expect(await outer).toBe(false)
            expect(inner).toHaveLength(1)
            await until(() => requestChatDataMock.mock.calls.length > 0, 'the inner request')
            source.push('Hello')
            await settle()

            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
            expect(activeUnits.has(GROUP)).toBe(true)
            expect(errors).toHaveBeenCalledWith(expect.stringContaining('group-chat'))
        } finally {
            stop()
            await finishAll([source], inner)
        }
        expect(activeUnits.has(GROUP)).toBe(false)
        expect(isWriting({ chaId: 'group-1' })).toBe(false)
        expect(hasAnyWork()).toBe(false)
        expect(replySpeakerOf('group-1', 'group-chat')).toBeUndefined()
    })
})

describe('the unit is held at every awaited point of a send', () => {
    test('A6: a send holds its chat while its request is pending and while its output trigger is pending', async () => {
        installTwoChats()
        let openTrigger!: () => void
        const triggerGate = new Promise<void>((resolve) => { openTrigger = resolve })
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'output') {
                expect(activeUnits.has(CHAT_A)).toBe(true)
                await triggerGate
            }
            return undefined
        })
        let openRequest!: () => void
        const requestGate = new Promise<void>((resolve) => { openRequest = resolve })
        requestChatDataMock.mockImplementationOnce(async () => {
            await requestGate
            return { type: 'success', result: 'Hello.' }
        })
        const outcome = settled(() => sendChat(-1, { origin: CHAT_A }))
        try {
            await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
            expect(activeUnits.has(CHAT_A)).toBe(true)
            openRequest()
            await until(() => runTriggerMock.mock.calls.some((call) => call[1] === 'output'), 'the output trigger')
            expect(activeUnits.has(CHAT_A)).toBe(true)
        } finally {
            openRequest()
            openTrigger()
            await outcome
        }
        expect(activeUnits.has(CHAT_A)).toBe(false)
    })
})

describe('a send whose cleanup throws', () => {
    test('A7: a throwing signal cleanup still releases the chat, and the next send into it is admitted', async () => {
        installTwoChats()
        const callerSignal = new AbortController().signal
        vi.spyOn(callerSignal, 'removeEventListener').mockImplementationOnce(() => { throw new Error('remove failed') })
        mockReply('First.')

        const first = await settled(() => sendChat(-1, { origin: CHAT_A, signal: callerSignal }))

        expect(first).toBeInstanceOf(Error)
        expect(activeUnits.has(CHAT_A)).toBe(false)
        mockReply('Second.')
        expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(true)
    })

    test('A7b: a reply deferred by that send is still requested after the send fails in its cleanup', async () => {
        installTwoChats()
        const callerSignal = new AbortController().signal
        const spy = vi.spyOn(callerSignal, 'removeEventListener').mockImplementationOnce(() => { throw new Error('remove failed') })
        const held = await startHeldSend(() => sendChat(-1, { origin: CHAT_A, signal: callerSignal }))
        try {
            expect(await applyRecoveredReply({ key: 'a7b-key', blob: applyBlobFor('a7b-key', CHAT_A), text: 'late reply' })).toBe('deferred')
            expect(reconcileCalls.count).toBe(0)
        } finally {
            held.source.close()
        }
        expect(await held.outcome).toBeInstanceOf(Error)
        expect(spy).toHaveBeenCalled()
        expect(activeUnits.has(CHAT_A)).toBe(false)
        expect(reconcileCalls.count).toBe(1)
    })
})

describe('a deferred recovered reply wakes at its own chat\'s release', () => {
    async function twoSends(): Promise<{ streams: Record<string, ControlledStream>, first: Promise<boolean | Error>, second: Array<Promise<boolean | Error>>, stop: () => void }> {
        installTwoChats()
        const streams = { 'char-0': controlledStream(), 'char-1': controlledStream() }
        routeStreamsByCharacter(streams)
        const second: Array<Promise<boolean | Error>> = []
        const stop = subscribeInFlight(() => {
            stop()
            second.push(settled(() => sendChat(-1, { origin: CHAT_B })))
        })
        const first = settled(() => sendChat(-1, { origin: CHAT_A }))
        await until(() => requestChatDataMock.mock.calls.length >= 2, 'both requests')
        streams['char-0'].push('A')
        streams['char-1'].push('B')
        await settle()
        return { streams, first, second, stop }
    }

    test('A11: a reply deferred for chat A is not requested when chat B ends, and is when chat A ends', async () => {
        const { streams, first, second, stop } = await twoSends()
        try {
            expect(await applyRecoveredReply({ key: 'a11-key', blob: applyBlobFor('a11-key', CHAT_A), text: 'late reply' })).toBe('deferred')
            streams['char-1'].close()
            await Promise.all(second)
            expect(reconcileCalls.count).toBe(0)
            streams['char-0'].close()
            await first
            expect(reconcileCalls.count).toBe(1)
        } finally {
            stop()
            await finishAll([streams['char-0'], streams['char-1']], [first, ...second])
        }
    })

    test('A11b: replies deferred for two chats are each requested at their own chat\'s end', async () => {
        const { streams, first, second, stop } = await twoSends()
        try {
            expect(await applyRecoveredReply({ key: 'a11b-a', blob: applyBlobFor('a11b-a', CHAT_A), text: 'late A' })).toBe('deferred')
            expect(await applyRecoveredReply({ key: 'a11b-b', blob: applyBlobFor('a11b-b', CHAT_B), text: 'late B' })).toBe('deferred')
            streams['char-0'].close()
            await first
            expect(reconcileCalls.count).toBe(1)
            streams['char-1'].close()
            await Promise.all(second)
            expect(reconcileCalls.count).toBe(2)
        } finally {
            stop()
            await finishAll([streams['char-0'], streams['char-1']], [first, ...second])
        }
    })
})

describe('a native reply the page no longer holds', () => {
    test('A12: a send into the reply\'s chat is refused before any registration or request; a send into another chat is admitted', async () => {
        installTwoChats()
        addRunningReplies([nativeEntry('native-a', CHAT_A)])

        const refused = await settled(() => sendChat(-1, { origin: CHAT_A }))

        expect(refused).toBe(false)
        expect(workSpies.beginWork).not.toHaveBeenCalled()
        expect(workSpies.registerWork).not.toHaveBeenCalled()
        expect(requestChatDataMock).not.toHaveBeenCalled()
        mockReply('B reply.')
        expect(await settled(() => sendChat(-1, { origin: CHAT_B }))).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(1)
    })

    test('A12b: the chat is refused while a pass lists the reply and admitted once a pass lists nothing', async () => {
        installTwoChats()
        addRunningReplies([nativeEntry('native-a', CHAT_A)])
        expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(false)

        setRunningReplies([])

        mockReply('Now free.')
        expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(true)
    })

    test('A13: guard: an entry with no target, or one for another chat of the same character, refuses nothing', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')]), makeChat('chat-0b', [msg('user', 'Hi again')])])])
        selectedCharID.set(0)
        addRunningReplies([{ key: 'no-target', target: null }])
        mockReply('One.')
        expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(true)

        resetRunningRepliesForTests()
        addRunningReplies([nativeEntry('other-chat', { chaId: 'char-0', chatId: 'chat-0b' })])
        mockReply('Two.')
        expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(true)
    })
})

describe('a refused send inside an effect', () => {
    test('A14: the gate\'s reads are untracked: an unrelated native key, or work in another chat, does not re-run the effect', async () => {
        installTwoChats()
        addRunningReplies([nativeEntry('native-a', CHAT_A)])
        let runs = 0
        const cleanup = $effect.root(() => {
            $effect(() => {
                runs++
                void settled(() => sendChat(-1, { origin: CHAT_A }))
            })
        })
        try {
            flushSync()
            expect(runs).toBe(1)

            addRunningReplies([nativeEntry('unrelated', { chaId: 'other-cha', chatId: 'other-chat' })])
            const handle = registerWork({ ...CHAT_B }, undefined, 'reply')
            handle.end()
            flushSync()
            await settle()

            expect(runs).toBe(1)
        } finally {
            cleanup()
        }
    })
})
