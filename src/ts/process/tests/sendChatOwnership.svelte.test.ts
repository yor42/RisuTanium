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
        doingChat.set(true)

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

describe('the published unit controller', () => {
    /**
     * The signal the n-th provider request was made with: the running unit's
     * own. `abortUnitInProgress` reaches it only while that unit's controller
     * is the one published.
     */
    function requestSignal(n = 0): AbortSignal {
        return requestChatDataMock.mock.calls[n][2] as AbortSignal
    }

    test('while a unit runs the flag is set and aborting the unit in progress reaches that unit', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())
        const flagDuring = get(doingChat)

        abortUnitInProgress()
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
        abortUnitInProgress()

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
        abortUnitInProgress()

        expect.soft(result).toBeInstanceOf(Error)
        expect.soft(get(doingChat)).toBe(false)
        expect.soft(signalSeen?.aborted).toBe(false)
    })

    test('a call refused while a unit runs publishes nothing: aborting the unit in progress still reaches the running unit', async () => {
        installSingleChat()
        const { source, outcome } = await startHeldSend(() => sendChat())

        const refused = await settled(() => sendChat())
        const refusedAtAnIndex = await settled(() => sendChat(0))
        abortUnitInProgress()
        const abortedDuring = requestSignal().aborted
        source.close()
        await outcome

        expect.soft(refused).toBe(false)
        expect.soft(refusedAtAnIndex).toBe(false)
        expect.soft(abortedDuring).toBe(true)
    })

    test("an auto-continue keeps the unit's controller published: aborting during the continuation reaches it", async () => {
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

        abortUnitInProgress()
        const abortedDuring = requestSignal(1).aborted
        continuation.close()
        const result = await outcome

        expect.soft(flagDuring).toBe(true)
        expect.soft(abortedDuring).toBe(true)
        expect.soft(result).toBe(false)
        expect.soft(get(doingChat)).toBe(false)
    })
})
