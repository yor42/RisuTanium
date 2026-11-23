/**
 * The flag `doingChat` belongs to the outermost `sendChat` call that took it,
 * and that call alone releases it.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`) against a real
 * `$state` database, with the same module mocks as
 * `sendChatOrigin.svelte.test.ts` (copied, not shared: each suite mocks its
 * own graph). Nothing in this file clears the flag on a caller's behalf: what
 * a test observes is what the send itself leaves behind. `beginWork` and
 * `registerWork` are wrapped in spies around the real implementations, so a
 * test can tell a call that registered work from one that did not.
 *
 * Tests whose title starts with `guard:` pass before and after the ownership
 * change: they pin behaviour that must be preserved.
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

describe('a send releases the flag itself when it settles', () => {
    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('a send that ends normally leaves the flag cleared, without any caller clearing it (%s reply)', async (site) => {
        installSingleChat()
        if (site === 'streaming') {
            mockStreamingReply('Hello there.')
        } else {
            mockReply('Hello there.')
        }

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(datas(chatById('char-0', 'chat-0'))).toEqual(['Hi', 'Hello there.'])
        expect(get(doingChat)).toBe(false)
    })

    test('a send whose request throws leaves the flag cleared', async () => {
        installSingleChat()
        requestChatDataMock.mockRejectedValueOnce(new Error('provider down'))

        const result = await settled(() => sendChat())

        expect(result).toBeInstanceOf(Error)
        expect(get(doingChat)).toBe(false)
    })

    test('a send whose request fails with an error result leaves the flag cleared', async () => {
        installSingleChat()
        requestChatDataMock.mockResolvedValueOnce({ type: 'fail', result: 'the provider refused' })

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(get(doingChat)).toBe(false)
    })
})

describe('the flag stays true from the take until the unit settles', () => {
    test('an auto-continue does not release the flag between the first request and the continuation', async () => {
        installSingleChat({ autoContinueChat: true })
        isLastCharPunctuationMock.mockReturnValueOnce(false)
        mockReply('Hello')
        mockReply(' there.')

        const { values, result } = await observeFlag(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(datas(chatById('char-0', 'chat-0'))).toEqual(['Hi', 'Hello there.'])
        expect(releasesBeforeTheEnd(values)).toBe(0)
    })

    test('a resend requested by the output trigger does not release the flag between the two generations', async () => {
        installSingleChat()
        let resent = false
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'output' && !resent) {
                resent = true
                return { sendAIprompt: true }
            }
            return undefined
        })
        mockReply('First reply.')
        mockReply('Second reply.')

        const { values, result } = await observeFlag(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(releasesBeforeTheEnd(values)).toBe(0)
    })

    test('guard: a group\'s two turns do not release the flag between the turns', async () => {
        installGroupWorld(['member-1', 'member-2'])
        mockReply('one speaks')
        mockReply('two speaks')

        const { values, result } = await observeFlag(() => sendChat())

        expect(result).toBe(true)
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(releasesBeforeTheEnd(values)).toBe(0)
    })
})

describe('a call refused because a unit holds the flag', () => {
    test('guard: a refused outermost call leaves the flag set and registers nothing', async () => {
        installSingleChat()
        simulateRunningSend(CHAT_A)

        const result = await settled(() => sendChat())

        expect(result).toBe(false)
        expect(get(doingChat)).toBe(true)
        expect(workSpies.beginWork).not.toHaveBeenCalled()
        expect(workSpies.registerWork).not.toHaveBeenCalled()
        expect(isWriting({ chaId: 'char-0' })).toBe(false)
        expect(chatById('char-0', 'chat-0').message[0].chatId).toBeUndefined()
        expect(requestChatDataMock).not.toHaveBeenCalled()
    })

    test('a direct outermost call at an index of zero or more is refused while a unit streams, and registers nothing', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        const registeredByTheFirst = workSpies.beginWork.mock.calls.length + workSpies.registerWork.mock.calls.length

        const second = await settled(() => sendChat(0))

        const requestsBySecond = requestChatDataMock.mock.calls.length - 1
        const registeredBySecond = workSpies.beginWork.mock.calls.length + workSpies.registerWork.mock.calls.length - registeredByTheFirst
        source.close()
        await outcome
        expect.soft(second).toBe(false)
        expect.soft(requestsBySecond).toBe(0)
        expect.soft(registeredBySecond).toBe(0)
    })
})

describe('a call whose signal is already aborted', () => {
    async function callWithAbortedSignal(): Promise<boolean | Error> {
        installSingleChat()
        const controller = new AbortController()
        controller.abort()
        return settled(() => sendChat(-1, { signal: controller.signal }))
    }

    test('guard: returns false', async () => {
        expect(await callWithAbortedSignal()).toBe(false)
    })

    test('makes no request and runs no start trigger', async () => {
        await callWithAbortedSignal()

        expect.soft(requestChatDataMock).not.toHaveBeenCalled()
        expect.soft(runTriggerMock.mock.calls.filter((call) => call[1] === 'start')).toHaveLength(0)
    })

    test('takes no flag, registers nothing and fills no ids', async () => {
        await callWithAbortedSignal()

        expect.soft(get(doingChat)).toBe(false)
        expect.soft(workSpies.beginWork).not.toHaveBeenCalled()
        expect.soft(workSpies.registerWork).not.toHaveBeenCalled()
        expect.soft(isWriting({ chaId: 'char-0' })).toBe(false)
        expect.soft(chatById('char-0', 'chat-0').message[0].chatId).toBeUndefined()
    })
})

describe('the outcome of an aborted unit', () => {
    test('a unit aborted in its output trigger, after the stream, reports not completed', async () => {
        installSingleChat()
        const controller = new AbortController()
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'output') {
                controller.abort()
            }
            return undefined
        })
        mockStreamingReply('Hello there.')

        const result = await settled(() => sendChat(-1, { signal: controller.signal }))

        expect(runTriggerMock.mock.calls.filter((call) => call[1] === 'output')).toHaveLength(1)
        expect(result).toBe(false)
        expect(get(doingChat)).toBe(false)
    })

    test('guard: a unit aborted during the stream reports not completed', async () => {
        installSingleChat()
        const controller = new AbortController()
        const { source, outcome } = await startHeldSend(() => sendChat(-1, { signal: controller.signal }))

        controller.abort()
        source.close()

        expect(await outcome).toBe(false)
    })
})

describe('stop-all reaching the running unit', () => {
    /**
     * The signal the n-th provider request was made with: the running unit's
     * own. `stopAllReplyWork` reaches it through the unit's work registration,
     * for as long as that registration lives. What the published tag store holds
     * is pinned separately (the publish counts below, and the release order
     * test).
     */
    function requestSignal(n = 0): AbortSignal {
        return requestChatDataMock.mock.calls[n][2] as AbortSignal
    }

    test('while a unit runs the flag is set and aborting the unit in progress reaches that unit', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        const flagDuring = get(doingChat)

        stopAllReplyWork()
        const abortedDuring = requestSignal().aborted
        source.close()
        const result = await outcome

        expect.soft(flagDuring).toBe(true)
        expect.soft(abortedDuring).toBe(true)
        expect.soft(result).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })

    test('after a unit ends normally the flag is clear and no controller is left to abort', async () => {
        installSingleChat()
        mockReply('Hello there.')

        const result = await settled(() => sendChat())
        stopAllReplyWork()

        expect.soft(result).toBe(true)
        expect.soft(get(doingChat)).toBe(false)
        expect.soft(requestSignal().aborted).toBe(false)
    })

    test('after a unit whose request throws the flag is clear and no controller is left to abort', async () => {
        installSingleChat()
        let signalSeen: AbortSignal | undefined
        requestChatDataMock.mockImplementationOnce(async (_arg: unknown, _mode: string, signal: AbortSignal) => {
            signalSeen = signal
            throw new Error('provider down')
        })

        const result = await settled(() => sendChat())
        stopAllReplyWork()

        expect.soft(result).toBeInstanceOf(Error)
        expect.soft(get(doingChat)).toBe(false)
        expect.soft(signalSeen?.aborted).toBe(false)
    })

    test('a call refused while a unit runs publishes nothing, and stop-all still reaches the running unit', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        const publishedBefore = publishedUnits.controllers.length

        const refused = await settled(() => sendChat())
        const refusedAtAnIndex = await settled(() => sendChat(0))
        const publishedAfter = publishedUnits.controllers.length
        stopAllReplyWork()
        const abortedDuring = requestSignal().aborted
        source.close()
        await outcome

        expect.soft(refused).toBe(false)
        expect.soft(refusedAtAnIndex).toBe(false)
        expect.soft(publishedAfter).toBe(publishedBefore)
        expect.soft(abortedDuring).toBe(true)
    })

    test("an auto-continue keeps the unit's registration alive: stop-all during the continuation reaches it", async () => {
        installSingleChat({ autoContinueChat: true })
        isLastCharPunctuationMock.mockReturnValueOnce(false)
        mockReply('Hello')
        const continuation = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: continuation.stream })
        const outcome = settled(() => sendChat())
        await until(() => requestChatDataMock.mock.calls.length === 2, 'the continuation request')
        continuation.push(' there')
        await settle()
        const flagDuring = get(doingChat)

        stopAllReplyWork()
        const abortedDuring = requestSignal(1).aborted
        continuation.close()
        const result = await outcome

        expect.soft(flagDuring).toBe(true)
        expect.soft(abortedDuring).toBe(true)
        expect.soft(result).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })
})

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

describe('a second send started while a unit is being taken', () => {
    test('R1: a send that another send\'s in-flight notice starts is still counted when the first send ends', async () => {
        installTwoChats()
        const streams = { 'char-0': controlledStream(), 'char-1': controlledStream() }
        routeStreamsByCharacter(streams)
        const second: Array<Promise<boolean | Error>> = []
        // One shot: the second send's own in-flight notice would call it again.
        const stop = subscribeInFlight(() => {
            stop()
            second.push(settled(() => sendChat(-1, { origin: CHAT_B })))
        })
        const first = settled(() => sendChat(-1, { origin: CHAT_A }))
        try {
            await until(() => requestChatDataMock.mock.calls.length >= 2, 'both requests')
            streams['char-0'].push('A')
            streams['char-1'].push('B')
            await settle()
            expect(get(doingChat)).toBe(true)
            expect(activeUnits.has(CHAT_A)).toBe(true)
            expect(activeUnits.has(CHAT_B)).toBe(true)

            streams['char-0'].close()
            await first

            // The first send's end releases its own unit only: the other is still running.
            expect(get(doingChat)).toBe(true)
            expect(activeUnits.has(CHAT_B)).toBe(true)
        } finally {
            stop()
            await finishAll([streams['char-0'], streams['char-1']], [first, ...second])
        }
        expect(get(doingChat)).toBe(false)
    })

    test('R2: a send whose own unit was released by a failure does not clear the unit of a send its caller\'s signal started (second send into another chat)', async () => {
        const secondChat = CHAT_B
        installTwoChats()
        const second: Array<Promise<boolean | Error>> = []
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const callerSignal = new AbortController().signal
        // The first send reaches its signal after it took its unit; the second is started from there and the first fails.
        vi.spyOn(callerSignal, 'addEventListener').mockImplementation(() => {
            second.push(settled(() => sendChat(-1, { origin: secondChat })))
            throw new Error('the signal listener failed')
        })
        let first: boolean | Error | undefined
        try {
            first = await settled(() => sendChat(-1, { signal: callerSignal }))
            await until(() => requestChatDataMock.mock.calls.length > 0, 'the second send request')
            source.push('Hello')
            await settle()

            // Soft, so a run that wrongly cleared the second's unit still reaches the third send below.
            expect.soft(first).toBeInstanceOf(Error)
            expect.soft(get(doingChat)).toBe(true)
            expect.soft(activeUnits.has(secondChat)).toBe(true)
            // A third send is still refused: the first send's end did not clear the second's unit. If it is wrongly
            // accepted, its request gets a stream that ends by itself, so the test cannot hang.
            mockStreamingReply('third')
            const third = await settled(() => sendChat(-1, { origin: CHAT_B }))
            expect(third).toBe(false)
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        } finally {
            await finishAll([source], second)
        }
        expect(get(doingChat)).toBe(false)
    })

    test('A5: a send its caller\'s signal started into the first send\'s own chat is refused, and after the first fails nothing holds the chat', async () => {
        installTwoChats()
        const second: Array<Promise<boolean | Error>> = []
        const callerSignal = new AbortController().signal
        // The first send has taken its chat before it reaches its signal; the second is started from there and the first fails.
        vi.spyOn(callerSignal, 'addEventListener').mockImplementation(() => {
            second.push(settled(() => sendChat(-1, { origin: CHAT_A })))
            throw new Error('the signal listener failed')
        })
        try {
            const first = await settled(() => sendChat(-1, { signal: callerSignal }))
            expect(first).toBeInstanceOf(Error)
            expect(second).toHaveLength(1)
            expect(await second[0]).toBe(false)
            expect(requestChatDataMock).not.toHaveBeenCalled()
            expect(activeUnits.has(CHAT_A)).toBe(false)
            expect(get(doingChat)).toBe(false)

            // A later send into the chat is admitted.
            mockReply('Later.')
            expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(true)
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
        } finally {
            await finishAll([], second)
        }
        expect(get(doingChat)).toBe(false)
    })
})

describe('a send called from a store subscriber', () => {
    test('Q1: two sends into one chat started inside another store\'s subscriber: the second is refused and makes no request', async () => {
        installSingleChat()
        const source = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: source.stream })
        const outer = writable(0)
        // Both stores are subscribed before the trigger, so the store queue is already in use when the callback runs.
        const stopBusy = doingChat.subscribe(() => {})
        const calls: Array<Promise<boolean | Error>> = []
        const stopOuter = outer.subscribe((value) => {
            if (value === 1) {
                calls.push(settled(() => sendChat()), settled(() => sendChat()))
            }
        })
        try {
            outer.set(1)
            expect(calls).toHaveLength(2)
            expect(await calls[1]).toBe(false)
            await until(() => requestChatDataMock.mock.calls.length > 0, 'the request')
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
            expect(get(doingChat)).toBe(true)
        } finally {
            stopOuter()
            stopBusy()
            await finishAll([source], calls)
        }
        expect(get(doingChat)).toBe(false)
    })

    test('Q2: a subscriber that sends the moment the flag turns true is refused and starts nothing', async () => {
        installSingleChat()
        const refused: Array<Promise<boolean | Error>> = []
        const stop = doingChat.subscribe((busy) => {
            if (busy && refused.length === 0) {
                refused.push(settled(() => sendChat()))
            }
        })
        let held: Awaited<ReturnType<typeof startHeldSend>> | undefined
        try {
            held = await startHeldSend(() => sendChat())
            expect(refused).toHaveLength(1)
            expect(await refused[0]).toBe(false)
            expect(requestChatDataMock).toHaveBeenCalledTimes(1)
            expect(get(doingChat)).toBe(true)
        } finally {
            stop()
            await finishAll(held ? [held.source] : [], held ? [held.outcome] : [])
        }
        expect(get(doingChat)).toBe(false)
    })

    test('Q2: a subscriber that sends the moment the flag turns false is accepted, and its unit stays held and abortable', async () => {
        installSingleChat()
        const successors: Array<Promise<boolean | Error>> = []
        const successorStream = controlledStream()
        let sawBusy = false
        const stop = doingChat.subscribe((busy) => {
            if (busy) {
                sawBusy = true
            } else if (sawBusy && successors.length === 0) {
                successors.push(settled(() => sendChat()))
            }
        })
        let held: Awaited<ReturnType<typeof startHeldSend>> | undefined
        try {
            held = await startHeldSend(() => sendChat())
            requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: successorStream.stream })
            held.source.close()
            await held.outcome
            await until(() => requestChatDataMock.mock.calls.length === 2, 'the successor request')
            successorStream.push('Again')
            await settle()

            expect(successors).toHaveLength(1)
            expect(get(doingChat)).toBe(true)
            expect(activeUnits.has(CHAT_A)).toBe(true)
            stopAllReplyWork()
            expect((requestChatDataMock.mock.calls[1][2] as AbortSignal).aborted).toBe(true)
        } finally {
            stop()
            await finishAll([successorStream, ...(held ? [held.source] : [])], [...successors, ...(held ? [held.outcome] : [])])
        }
        expect(get(doingChat)).toBe(false)
    })
})

describe('a unit held in one chat and a send into another', () => {
    test.each([
        ['send', { previewResult: {} }],
        ['prompt preview', { previewPrompt: true, previewResult: {} }],
    ] as const)('A1: a %s in chat A does not refuse a send into chat B: it is admitted, requests, and holds chat B while it runs', async (_name, arg) => {
        installTwoChats()
        const held = await holdUnit({ ...arg })
        const sourceB = controlledStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: sourceB.stream })
        const requests = requestChatDataMock.mock.calls.length
        const sendB = settled(() => sendChat(-1, { origin: CHAT_B }))
        try {
            await until(() => requestChatDataMock.mock.calls.length === requests + 1, 'the request into chat B')
            sourceB.push('B')
            await settle()

            expect(activeUnits.has(CHAT_A)).toBe(true)
            expect(activeUnits.has(CHAT_B)).toBe(true)
            expect(isWriting({ chaId: 'char-1' })).toBe(true)
        } finally {
            await finishAll([sourceB], [sendB])
            await held.finish()
        }
        expect(await sendB).toBe(true)
        expect(datas(chatById('char-1', 'chat-1'))).toEqual(['Hey', 'B'])
        expect(get(doingChat)).toBe(false)
    })

    test.each([
        ['send', { previewResult: {} }],
        ['prompt preview', { previewPrompt: true, previewResult: {} }],
    ] as const)('A2: a %s in chat A refuses a send into chat A, with no registration, published unit or request', async (_name, arg) => {
        installTwoChats()
        const held = await holdUnit({ ...arg })
        try {
            const registered = workSpies.beginWork.mock.calls.length + workSpies.registerWork.mock.calls.length
            const requests = requestChatDataMock.mock.calls.length
            const publishedBefore = publishedUnits.controllers.length

            const refused = await settled(() => sendChat(-1, { origin: CHAT_A }))

            expect(refused).toBe(false)
            expect(workSpies.beginWork.mock.calls.length + workSpies.registerWork.mock.calls.length).toBe(registered)
            expect(requestChatDataMock.mock.calls.length).toBe(requests)
            expect(publishedUnits.controllers.length).toBe(publishedBefore)
            expect(activeUnits.has(CHAT_A)).toBe(true)
            expect(activeUnits.has(CHAT_B)).toBe(false)
        } finally {
            await held.finish()
        }
        expect(get(doingChat)).toBe(false)
    })
})

describe('the chat a held send is keyed by', () => {
    test('K1: a group send holds the group and its chat at both turns, never a member', async () => {
        installGroupWorld(['member-1', 'member-2'])
        const groupChat: UnitKey = { chaId: 'group-1', chatId: 'group-chat' }
        const turns = [controlledStream(), controlledStream()]
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: turns[0].stream })
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: turns[1].stream })
        const outcome = settled(() => sendChat())
        try {
            for (let turn = 0; turn < 2; turn++) {
                await until(() => requestChatDataMock.mock.calls.length === turn + 1, `the request of turn ${turn + 1}`)
                turns[turn].push(`turn ${turn + 1}`)
                await settle()
                expect(activeUnits.has(groupChat)).toBe(true)
                expect(activeUnits.has({ chaId: 'member-1', chatId: 'group-chat' })).toBe(false)
                expect(activeUnits.has({ chaId: 'member-2', chatId: 'group-chat' })).toBe(false)
                turns[turn].close()
            }
        } finally {
            await finishAll(turns, [outcome])
        }
        expect(requestChatDataMock).toHaveBeenCalledTimes(2)
        expect(activeUnits.any()).toBe(false)
    })

    interface KeyRow {
        name: string
        install: () => void
        index: number
        arg: SendChatArg
        /** What `sendTargetOf` answers before the call. */
        targetBefore: UnitKey | null
        /** The key the held send must be registered under, read after the call started. */
        expected: () => UnitKey
        wrong: UnitKey
    }
    const groupChatKey: UnitKey = { chaId: 'group-1', chatId: 'group-chat' }
    const memberKey: UnitKey = { chaId: 'member-1', chatId: 'group-chat' }
    const rows: KeyRow[] = [
        {
            name: 'a: the selected chat, ids present',
            install: installTwoChats, index: -1, arg: {},
            targetBefore: CHAT_A, expected: () => CHAT_A, wrong: CHAT_B,
        },
        {
            name: 'b: an explicit origin in a chat other than the selected one',
            install: installTwoChats, index: -1, arg: { origin: { ...CHAT_B } },
            targetBefore: CHAT_B, expected: () => CHAT_B, wrong: CHAT_A,
        },
        {
            name: 'c: a selected group, called for one member',
            install: () => installGroupWorld(['member-1', 'member-2']), index: 0, arg: {},
            targetBefore: groupChatKey, expected: () => groupChatKey, wrong: memberKey,
        },
        {
            name: 'd: an origin that carries a member of its group',
            install: () => installGroupWorld(['member-1', 'member-2']), index: 0,
            arg: { origin: { ...groupChatKey, memberChaId: 'member-1' } },
            targetBefore: groupChatKey, expected: () => groupChatKey, wrong: memberKey,
        },
        {
            name: 'e: a selected chat that has no id yet',
            install: () => {
                installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')], { id: undefined })])])
                selectedCharID.set(0)
            },
            index: -1, arg: {},
            targetBefore: null,
            expected: () => ({ chaId: 'char-0', chatId: charById('char-0').chats[0].id }),
            wrong: CHAT_A,
        },
    ]

    test.each(rows)('K2 $name: the held send is registered under its owner\'s chat', async (row) => {
        row.install()
        const target = sendTargetOf(row.arg)
        expect(target).toEqual(row.targetBefore)
        // Only row e starts without an id on the selected chat.
        expect(DBState.db.characters[0].chats[0].id === undefined).toBe(row.targetBefore === null)
        const { source, outcome } = await startHeldSend(() => sendChat(row.index, row.arg))
        const expected = row.expected()
        try {
            expect(expected.chatId).toBeTruthy()
            expect(activeUnits.has(expected)).toBe(true)
            expect(activeUnits.has(row.wrong)).toBe(false)
            expect(activeUnits.has(target)).toBe(row.targetBefore !== null)
            expect(sendTargetOf(row.arg)).toEqual(expected)
        } finally {
            await finishAll([source], [outcome])
        }
        expect(activeUnits.has(expected)).toBe(false)
    })
})

describe('sendTargetOf', () => {
    test('ST: an explicit origin beats the selection and drops the member; the selection gives the owner\'s chat', () => {
        installTwoChats()

        expect(sendTargetOf({})).toEqual(CHAT_A)
        expect(sendTargetOf({ origin: { ...CHAT_B, memberChaId: 'member-9' } })).toEqual(CHAT_B)

        installGroupWorld(['member-1', 'member-2'])
        expect(sendTargetOf({})).toEqual({ chaId: 'group-1', chatId: 'group-chat' })
    })

    test.each([
        ['nothing selected', () => { installTwoChats(); selectedCharID.set(-1) }],
        ['a chat without an id', () => {
            installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')], { id: undefined })])])
            selectedCharID.set(0)
        }],
        ['a character without an id', () => {
            installDb([makeCharacter('char-0', [makeChat('chat-0', [msg('user', 'Hi')])], { chaId: undefined })])
            selectedCharID.set(0)
        }],
    ])('ST: %s gives null and fills, warns and marks nothing', (_name, install) => {
        install()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const before = JSON.stringify(DBState.db.characters)
        resetCharacterSaveMarksForTest()
        const tracker = { character: [] as string[] }
        const schedule = vi.fn()
        installCharacterSaveMarks({ tracker: tracker as unknown as toSaveType, schedule })
        try {
            expect(sendTargetOf({})).toBeNull()

            expect(JSON.stringify(DBState.db.characters)).toBe(before)
            expect(schedule).not.toHaveBeenCalled()
            expect(tracker.character).toEqual([])
            expect(warn).not.toHaveBeenCalled()
            expect(workSpies.beginWork).not.toHaveBeenCalled()
            expect(workSpies.registerWork).not.toHaveBeenCalled()
        } finally {
            warn.mockRestore()
            resetCharacterSaveMarksForTest()
        }
    })
})

describe('the order in which a unit is taken and released', () => {
    const blob: ReplyBlob = {
        target: { ...CHAT_A }, targetName: 'char-0', saying: 'char-0',
        generationInfo: { generationId: 'o1-key', model: 'm' }, promptInfo: { promptName: 'Main' }, escape: false, requestedMs: 1,
        parse: { kind: 'openai-chat', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false },
    }

    test('O1: at the take only the work is live, the notice and the published unit follow it; at the release only the work is, and the reconcile asked for after it sees the flag false', async () => {
        installSingleChat()
        publishedUnits.controllers.length = 0
        const seen: Array<{ busy: boolean, work: boolean, inFlight: boolean, published: boolean }> = []
        const stop = doingChat.subscribe((busy) => {
            const latest = publishedUnits.controllers.at(-1)
            seen.push({
                busy,
                work: isWriting({ chaId: 'char-0', chatId: 'chat-0' }),
                inFlight: inFlightKinds().includes('chat'),
                published: latest !== undefined && isUnitInProgressSignal(latest.signal),
            })
        })
        const reconcileSaw: boolean[] = []
        setReconcileTrigger(() => { reconcileSaw.push(get(doingChat)) })
        let held: Awaited<ReturnType<typeof startHeldSend>> | undefined
        try {
            held = await startHeldSend(() => sendChat())
            // An apply that waited for the unit asks for a new reconcile pass once the unit is released.
            expect(await applyRecoveredReply({ key: 'o1-key', blob, text: 'late reply' })).toBe('deferred')
            expect(reconcileSaw).toEqual([])
        } finally {
            await finishAll(held ? [held.source] : [], held ? [held.outcome] : [])
            stop()
            setReconcileTrigger(null)
            resetRunningRepliesForTests()
        }

        expect(seen).toEqual([
            { busy: false, work: false, inFlight: false, published: false },
            { busy: true, work: true, inFlight: false, published: false },
            { busy: false, work: true, inFlight: false, published: false },
        ])
        expect(reconcileSaw).toEqual([false])
    })
})

//#endregion

//#region the progress stage is kept per chat

describe('a refused send leaves every chat\'s progress stage alone', () => {
    // R6a-R6d (regression reproducers): a send reset the stage before it was admitted, so a refused call cleared the
    // running send's progress.
    test('R6a: a send admitted into another chat clears no stage of the held chat', async () => {
        installTwoChats()
        setProcessStage(CHAT_A, 3)
        setProcessStage(CHAT_B, 0)
        simulateRunningSend(CHAT_A)
        mockReply('Elsewhere.')
        try {
            expect(await settled(() => sendChat(-1, { origin: CHAT_B }))).toBe(true)
            expect(processStageIn(CHAT_A)).toBe(3)
        } finally {
            clearRunningSends()
        }
    })

    test('R6b: a send refused into the running chat, with an explicit origin, clears no stage', async () => {
        installTwoChats()
        setProcessStage(CHAT_A, 3)
        simulateRunningSend(CHAT_A)
        try {
            expect(await settled(() => sendChat(-1, { origin: CHAT_A }))).toBe(false)
            expect(processStageIn(CHAT_A)).toBe(3)
        } finally {
            clearRunningSends()
        }
    })

    test('R6c: a send refused into the selected chat clears no stage', async () => {
        installTwoChats()
        setProcessStage(CHAT_A, 3)
        simulateRunningSend(CHAT_A)
        try {
            expect(await settled(() => sendChat())).toBe(false)
            expect(processStageIn(CHAT_A)).toBe(3)
        } finally {
            clearRunningSends()
        }
    })

    test('R6d: a send whose caller signal is already aborted clears no stage and registers nothing', async () => {
        installTwoChats()
        setProcessStage(CHAT_A, 3)
        const caller = new AbortController()
        caller.abort()
        workSpies.beginWork.mockClear()
        workSpies.registerWork.mockClear()

        expect(await settled(() => sendChat(-1, { origin: CHAT_A, signal: caller.signal }))).toBe(false)

        expect(processStageIn(CHAT_A)).toBe(3)
        expect(workSpies.beginWork).not.toHaveBeenCalled()
        expect(workSpies.registerWork).not.toHaveBeenCalled()
    })

    // G13 (post-fix guard): the stage-4 write lands after the stream, when the selection has moved on, so it must use
    // the body's own chat.
    test('G13: the body writes its own chat\'s stage even after the selection moved', async () => {
        installTwoChats()
        setProcessStage(CHAT_A, 0)
        setProcessStage(CHAT_B, 0)
        const held = await startHeldSend(() => sendChat())
        selectedCharID.set(1)
        await finishAll([held.source], [held.outcome])

        expect(processStageIn(CHAT_A)).toBeGreaterThan(0)
        expect(processStageIn(CHAT_B)).toBe(0)
    })
})

//#endregion
