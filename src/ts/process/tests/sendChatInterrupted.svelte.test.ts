/**
 * A streamed reply carries `interrupted` from its first moment until this page
 * sees the stream end, on every way a stream can end, and the active-stream
 * registry follows the same span. Drives the REAL `sendChat` with the module
 * mocks of `inFlightWork.sendChat.svelte.test.ts` (copied, not shared: each
 * suite mocks its own graph).
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

//#endregion

import { sendChat, doingChat } from 'src/ts/process/index.svelte'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { isWriting } from 'src/ts/process/chatOrigin'
import { abortUnitInProgress } from 'src/ts/process/generationOwnership.svelte'

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
    doingChat.set(false)
})

afterEach(() => {
    selectedCharID.set(-1)
})


//#endregion

import { activeStreams, isActiveStreamReply, resetActiveStreamsForTest } from 'src/ts/process/activeStreams'
import { resetChatStreamingState } from 'src/ts/storage/characterDefaults'

type StreamingMode = 'off' | 'balanced' | 'strong'

function lastMessage(chaId: string, chatId: string): Message {
    return chatById(chaId, chatId).message.at(-1)!
}

/** A stream the test can end with an error as well as push to and close. */
function failableStream(): ControlledStream & { fail(error: Error): void } {
    let controller: ReadableStreamDefaultController<{ data: string }> | undefined
    const stream = new ReadableStream<{ data: string }>({
        start(c) { controller = c },
    })
    return {
        stream,
        push(text) { controller?.enqueue({ data: text }) },
        close() { controller?.close() },
        fail(error) { controller?.error(error) },
    }
}

async function waitForReply(chaId: string, chatId: string, count: number): Promise<void> {
    await until(() => chatById(chaId, chatId).message.length >= count, 'the reply to be pushed')
}

beforeEach(() => {
    resetActiveStreamsForTest()
})

describe('the interrupted flag on a streaming reply', () => {
    test('is on the pushed reply before the first chunk and the stream is registered', async () => {
        installSingleChat()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat())

        await waitForReply('char-0', 'chat-0', 2)
        const reply = lastMessage('char-0', 'chat-0')

        expect(reply.data).toBe('')
        expect(reply.interrupted).toBe(true)
        expect(activeStreams()).toEqual([{ chaId: 'char-0', memberChaId: undefined, replyChatId: reply.chatId }])

        source.push('Hello')
        source.close()
        await outcome
    })

    test('the stream is registered in the same synchronous step that pushes the reply', async () => {
        installSingleChat()
        // Scheduled like the chat view's effect: it runs when the reply first
        // appears, before any step that awaits after the push.
        const seen: Array<{ registered: boolean, flagged: boolean | undefined }> = []
        const stop = $effect.root(() => {
            $effect(() => {
                const messages = chatById('char-0', 'chat-0').message
                if (messages.length >= 2) {
                    const reply = messages[messages.length - 1]
                    seen.push({ registered: isActiveStreamReply(reply.chatId), flagged: reply.interrupted })
                }
            })
        })
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat())
        await waitForReply('char-0', 'chat-0', 2)

        expect(seen[0]).toEqual({ registered: true, flagged: true })

        source.push('Hello')
        source.close()
        await outcome
        stop()
    })

    test.each(['off', 'balanced', 'strong'] as const)('is removed with the registry entry when the stream ends normally (%s mode)', async (mode: StreamingMode) => {
        installSingleChat({ streamingDisplayOptimizationMode: mode })
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat())
        await waitForReply('char-0', 'chat-0', 2)
        source.push('Hello there.')
        await settle()

        expect(lastMessage('char-0', 'chat-0').interrupted).toBe(true)

        source.close()
        expect(await outcome).toBe(true)

        const reply = lastMessage('char-0', 'chat-0')
        expect(reply.data).toBe('Hello there.')
        expect('interrupted' in reply).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('stays until the deferred post-processing of strong mode has written the final text', async () => {
        installSingleChat({ streamingDisplayOptimizationMode: 'strong' })
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let flagDuringPass: boolean | undefined
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string, mode: string) => {
            if (mode !== 'editoutput') {
                return { data: text, emoChanged: false }
            }
            flagDuringPass = lastMessage('char-0', 'chat-0').interrupted
            await held
            return { data: text, emoChanged: false }
        })
        mockStreamingReply('Final text.')

        const outcome = settled(() => sendChat())
        await until(() => flagDuringPass !== undefined, 'the deferred pass to start')

        expect(flagDuringPass).toBe(true)
        expect(lastMessage('char-0', 'chat-0').interrupted).toBe(true)

        release()
        expect(await outcome).toBe(true)
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
    })

    test('is removed when the user stops the stream', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        expect(lastMessage('char-0', 'chat-0').interrupted).toBe(true)

        abortUnitInProgress()
        source.close()
        await outcome

        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('is removed when reading the stream fails', async () => {
        installSingleChat()
        const source = failableStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat())
        await waitForReply('char-0', 'chat-0', 2)
        source.push('Partial')
        await settle()
        expect(lastMessage('char-0', 'chat-0').interrupted).toBe(true)

        source.fail(new Error('connection lost'))
        const result = await outcome

        expect(result).toBeInstanceOf(Error)
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('is removed when the display flush fails', async () => {
        installSingleChat({ streamingDisplayOptimizationMode: 'balanced' })
        let flagWhenTheFlushFailed: boolean | undefined
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string, mode: string) => {
            if (mode !== 'editoutput') {
                return { data: text, emoChanged: false }
            }
            flagWhenTheFlushFailed = lastMessage('char-0', 'chat-0').interrupted
            throw new Error('script failed')
        })
        mockStreamingReply('Some text.')

        const result = await settled(() => sendChat())

        expect(flagWhenTheFlushFailed).toBe(true)
        expect(result).toBeInstanceOf(Error)
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('is removed when the deferred post-processing throws', async () => {
        installSingleChat({ streamingDisplayOptimizationMode: 'strong' })
        let flagWhenItFailed: boolean | undefined
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string, mode: string) => {
            if (mode !== 'editoutput') {
                return { data: text, emoChanged: false }
            }
            flagWhenItFailed = lastMessage('char-0', 'chat-0').interrupted
            throw new Error('script failed')
        })
        mockStreamingReply('Some text.')

        const result = await settled(() => sendChat())

        expect(flagWhenItFailed).toBe(true)
        expect(result).toBeInstanceOf(Error)
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('a reply deleted while it streams leaves nothing to clear and no entry behind', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        expect(activeStreams()).toHaveLength(1)
        chatById('char-0', 'chat-0').message.pop()

        source.push('More')
        source.close()
        const result = await outcome

        expect(result).not.toBeInstanceOf(Error)
        expect(datas(chatById('char-0', 'chat-0'))).toEqual(['Hi'])
        expect(activeStreams()).toEqual([])
    })

    test('an origin deleted while it streams leaves no entry behind', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        expect(activeStreams()).toHaveLength(1)
        DBState.db.characters.splice(0, 1)

        source.push('More')
        source.close()
        const result = await outcome

        expect(result).not.toBeInstanceOf(Error)
        expect(activeStreams()).toEqual([])
    })

    test('a group reply is flagged in the group chat and the entry names the group and the speaker', async () => {
        installGroupWorld(['member-a'])
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat())
        await waitForReply('group-1', 'group-chat', 2)

        expect(lastMessage('group-1', 'group-chat').interrupted).toBe(true)
        expect(activeStreams()).toEqual([{
            chaId: 'group-1',
            memberChaId: 'member-a',
            replyChatId: lastMessage('group-1', 'group-chat').chatId,
        }])

        source.push('A speaks.')
        source.close()
        await outcome
        expect('interrupted' in lastMessage('group-1', 'group-chat')).toBe(false)
    })

    test('sequential streams of one character are separate entries', async () => {
        installSingleChat()
        const first = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: first.stream })
        const firstOutcome = settled(() => sendChat())
        await waitForReply('char-0', 'chat-0', 2)
        const firstId = lastMessage('char-0', 'chat-0').chatId
        first.push('One.')
        first.close()
        await firstOutcome
        expect(activeStreams()).toEqual([])

        const second = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: second.stream })
        const secondOutcome = settled(() => sendChat())
        await waitForReply('char-0', 'chat-0', 3)

        expect(activeStreams().map((entry) => entry.replyChatId)).toEqual([lastMessage('char-0', 'chat-0').chatId])
        expect(lastMessage('char-0', 'chat-0').chatId).not.toBe(firstId)
        second.push('Two.')
        second.close()
        await secondOutcome
    })
})

describe('the interrupted flag on a continued reply', () => {
    function installContinuable(extra: Record<string, unknown> = {}): void {
        installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi'), msg('char', 'Start', { chatId: 'reply-1', ...extra })])])])
        selectedCharID.set(0)
    }

    test('is set on the continued message when its stream starts and removed when it ends', async () => {
        installContinuable()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat(-1, { continue: true }))
        await until(() => lastMessage('char-0', 'chat-0').interrupted === true, 'the flag on the continued message')

        expect(activeStreams().map((entry) => entry.replyChatId)).toEqual(['reply-1'])

        source.push(' more')
        source.close()
        await outcome

        expect(lastMessage('char-0', 'chat-0').data).toBe('Start more')
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('guard: a continue whose target is gone sets nothing and registers nothing', async () => {
        installContinuable()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat(-1, { continue: true, continueMessageId: 'no-such-reply' }))
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        await settle()

        expect(chatById('char-0', 'chat-0').message.some((m) => m.interrupted === true)).toBe(false)
        expect(activeStreams()).toEqual([])

        source.close()
        await outcome
    })

    test('guard: a continue whose request fails before streaming leaves a flag the message already had', async () => {
        // Neither the failed request nor an abort before streaming reaches the
        // point that sets or clears the flag.
        installContinuable({ interrupted: true })
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'provider refused' })

        await settled(() => sendChat(-1, { continue: true }))

        expect(lastMessage('char-0', 'chat-0').data).toBe('Start')
        expect(lastMessage('char-0', 'chat-0').interrupted).toBe(true)
        expect(activeStreams()).toEqual([])
    })

    test('a continue stopped before its first chunk clears the flag with the text unchanged', async () => {
        installContinuable({ interrupted: true })
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outcome = settled(() => sendChat(-1, { continue: true }))
        await until(() => activeStreams().length === 1, 'the continue to start streaming')

        abortUnitInProgress()
        source.close()
        await outcome

        expect(lastMessage('char-0', 'chat-0').data).toBe('Start')
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
        expect(activeStreams()).toEqual([])
    })

    test('a stream that started with its reply gone does not clear a flag on a message that became unambiguous meanwhile', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-0', [
            msg('user', 'Hi'),
            msg('char', 'First', { chatId: 'dup', interrupted: true }),
            msg('char', 'Second', { chatId: 'dup' }),
        ])])], { streamingDisplayOptimizationMode: 'balanced' })
        selectedCharID.set(0)
        const source = controlledStream()
        const realGetReader = source.stream.getReader.bind(source.stream) as () => ReadableStreamDefaultReader<{ data: string }>
        // Runs once the stream's setup has yielded: the duplicate is gone, so
        // the id now names the first message.
        source.stream.getReader = (() => {
            queueMicrotask(() => { chatById('char-0', 'chat-0').message.pop() })
            return realGetReader()
        }) as typeof source.stream.getReader
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })

        const outcome = settled(() => sendChat(-1, { continue: true, continueMessageId: 'dup' }))
        await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
        source.close()
        await outcome

        expect(datas(chatById('char-0', 'chat-0'))).toEqual(['Hi', 'First'])
        expect(lastMessage('char-0', 'chat-0').interrupted).toBe(true)
    })

    test('guard: a non-streaming continue replaces the message and drops the flag', async () => {
        installContinuable({ interrupted: true })
        mockReply(' more')

        const result = await settled(() => sendChat(-1, { continue: true }))

        expect(result).toBe(true)
        expect(lastMessage('char-0', 'chat-0').data).toBe('Start more')
        expect('interrupted' in lastMessage('char-0', 'chat-0')).toBe(false)
    })
})

describe('the flag after a load', () => {
    test('guard: the streaming reset keeps the flag and clears isStreaming', () => {
        const chat = makeChat('chat-0', [msg('user', 'Hi'), msg('char', 'Partial', { interrupted: true })], { isStreaming: true })
        const cha = makeCharacter('char-0', [chat])

        resetChatStreamingState(cha as unknown as Parameters<typeof resetChatStreamingState>[0])

        expect(chat.isStreaming).toBe(false)
        expect(chat.message[1].interrupted).toBe(true)
    })
})
