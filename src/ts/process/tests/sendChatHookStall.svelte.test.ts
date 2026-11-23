/**
 * A hook that never settles cannot hold a send after a Stop. Drives the REAL `sendChat` over a real `$state` database with
 * the module graph mocked as in `sendChatAutoContinue.svelte.test.ts` (copied: each suite mocks its own graph), plus
 * controllable memory dispatchers, `HypaProcesser`, `stableDiff`, `runInlayScreen`, `tokenize` and the lorebook loader.
 * Each hang is entered, the page Stop (`stopAllReplyWork`) lands, and the send must settle with `false` and start no
 * further request or prompt build.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import '../../polyfill'

//#region module mocks

interface ChatOutputArg {
    messageIndex: number
}

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const parserSpy = vi.hoisted(() => vi.fn())
const parserBox = vi.hoisted(() => ({ actual: null as null | ((...args: unknown[]) => string) }))
const ttsBox = vi.hoisted(() => ({ useReal: false, real: null as null | ((...args: unknown[]) => Promise<void>) }))
const processScriptFullMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())
const tokenizeMock = vi.hoisted(() => vi.fn())
const loreMock = vi.hoisted(() => vi.fn())
const stableDiffMock = vi.hoisted(() => vi.fn())
const runInlayMock = vi.hoisted(() => vi.fn())
const supaMock = vi.hoisted(() => vi.fn())
const hanuraiMock = vi.hoisted(() => vi.fn())
const hypa2Mock = vi.hoisted(() => vi.fn())
const hypa3Mock = vi.hoisted(() => vi.fn())
const hypaBox = vi.hoisted(() => ({ addText: vi.fn(), similaritySearch: vi.fn(), similaritySearchScored: vi.fn() }))

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

vi.mock('dompurify', () => ({
    default: { addHook: vi.fn(), sanitize: (value: string) => value },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        CharEmotion: writable({}),
        selectedCharID: writable(-1),
        selIdState: { selId: 0 },
        ReloadChatPointer: writable({} as Record<number, number>),
        ReloadGUIPointer: writable(0),
        CurrentTriggerIdStore: writable(null),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const live = stores.DBState as unknown as { db: unknown }
    return {
        appVer: '0.0.0',
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        getDatabase: vi.fn(() => live.db),
        presetTemplate: { name: 'test-preset' },
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: tokenizeMock,
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../alert'), () => ({
    alertError: alertErrorMock,
    alertToast: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../lorebook.svelte'), () => ({
    loadLoreBookV3Prompt: loreMock,
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), async () => {
    const realPunctuation = await vi.importActual<typeof import('../../util')>('../../util')
    const stores = await import('../../stores.svelte')
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
        getUserIcon: vi.fn(() => ''),
        checkPersonaBinded: vi.fn(() => false),
        pickHashRand: vi.fn(() => 0.5),
        replaceAsync: vi.fn(),
        asBuffer: vi.fn(),
        selectSingleFile: vi.fn(),
        BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
        isLastCharPunctuation: realPunctuation.isLastCharPunctuation,
        trimUntilPunctuation: realPunctuation.trimUntilPunctuation,
        parseToggleSyntax: vi.fn(() => []),
        prebuiltAssetCommand: vi.fn(() => ''),
        sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    } as unknown as typeof import('../../util')
})

vi.mock(import('../request/request'), () => ({
    requestChatData: requestChatDataMock,
    requestChatDataMain: vi.fn(),
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: stableDiffMock,
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

// The parser is the real one, observed through a spy.
vi.mock(import('../scripts'), async () => {
    const parser = await vi.importActual<typeof import('../../parser/parser.svelte')>('../../parser/parser.svelte')
    parserBox.actual = parser.risuChatParser as (...args: unknown[]) => string
    parserSpy.mockImplementation(parserBox.actual)
    return {
        processScript: vi.fn(async (_char: unknown, text: string) => text),
        processScriptFull: processScriptFullMock,
        risuChatParser: parserSpy,
    } as unknown as typeof import('../scripts')
})

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

// The real text filter and Stop behaviour of `tts.ts`, with `sayTTS` a spy unless a test asks for the real one.
vi.mock(import('../tts'), async (importOriginal) => {
    const actual = await importOriginal()
    ttsBox.real = actual.sayTTS as unknown as (...args: unknown[]) => Promise<void>
    return {
        ...actual,
        sayTTS: (...args: unknown[]) => (ttsBox.useReal ? ttsBox.real!(...args) : sayTTSMock(...args)),
    } as unknown as typeof import('../tts')
})

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: supaMock,
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: runTriggerMock,
}) as unknown as typeof import('../triggers'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        addText = hypaBox.addText
        similaritySearch = hypaBox.similaritySearch
        similaritySearchScored = hypaBox.similaritySearchScored
    },
}) as unknown as typeof import('../memory/hypamemory'))

// The real search, over the mocked HypaProcesser.
vi.mock(import('../embedding/addinfo'), async (importOriginal) => await importOriginal())

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: runInlayMock,
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage,
    addRerolls: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
    runVITS: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: hanuraiMock,
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: hypa2Mock,
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('../scriptings'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: hypa3Mock,
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../modules'), () => ({
    getModuleAssets: vi.fn(() => []),
    getModuleToggles: vi.fn(() => ''),
    getModuleLorebooks: vi.fn(() => []),
    getModuleTriggers: vi.fn(() => []),
    getModuleRegexScripts: vi.fn(() => []),
    getModules: vi.fn(() => []),
}) as unknown as typeof import('../modules'))

vi.mock(import('../../globalApi.svelte'), () => ({
    readImage: vi.fn(),
    fetchNative: vi.fn(),
    getFileSrc: vi.fn(async () => ''),
    aiWatermarkingLawApplies: vi.fn(() => false),
    globalFetch: vi.fn(),
    loadAsset: vi.fn(),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../translator/translator'), () => ({
    isExpTranslator: vi.fn(() => false),
    translate: vi.fn(async () => ''),
    runTranslator: vi.fn(async (text: string) => text),
    translateVox: vi.fn(async (text: string) => text),
    getLLMCache: vi.fn(),
    searchLLMCache: vi.fn(),
}) as unknown as typeof import('../../translator/translator'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    allowedDbKeys: [],
    customProviderStore: { providers: new Map() },
    getV2PluginAPIs: () => ({}),
    pluginV2: { providers: new Map(), chatOutput: chatOutputListeners },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../gui/colorscheme'), () => ({
    changeColorScheme: vi.fn(),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../gui/colorscheme'))

vi.mock(import('../mcp/pluginmcp'), () => ({
    registerMCPModule: vi.fn(),
    unregisterMCPModule: vi.fn(),
}) as unknown as typeof import('../mcp/pluginmcp'))

vi.mock(import('../coldstorage.svelte'), () => ({
    setColdStorageItem: vi.fn(),
    readColdStorageItem: vi.fn(),
}) as unknown as typeof import('../coldstorage.svelte'))

vi.mock('../coldMemberRestore', () => ({
    restoreColdCharacterByChaId: vi.fn(async () => false),
}))

//#endregion

import { sendChat } from '../index.svelte'
import { stopAllReplyWork } from '../chatOrigin'
import { STOPPED_PASS_GRACE_MS, STOPPED_UNIT_WATCHDOG_MS } from '../abortRace'
import { sendRefusalIn } from '../sendAdmission'
import { DBState, selectedCharID } from '../../stores.svelte'
import { clearRunningSends } from './activeUnits.test-helpers'

//#region fixtures

type CharacterFixture = Database['characters'][number]

function msg(role: 'user' | 'char', data: string, extra: Record<string, unknown> = {}): Message {
    return { role, data, time: 1, ...extra } as unknown as Message
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message, scriptstate: {}, ...extra } as unknown as Chat
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

function makeGroup(chaId: string, name: string, memberIds: string[], chats: Chat[]): CharacterFixture {
    return {
        chaId,
        name,
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
        username: 'User',
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

async function settle(): Promise<void> {
    await new Promise<void>((res) => setTimeout(res, 0))
}

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 400; i++) {
        if (condition()) {
            return
        }
        await settle()
    }
    throw new Error(`timed out waiting for: ${what}`)
}

/** A stream whose chunks are all available at once; each chunk is the whole text so far. */
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

type Mode = 'streaming' | 'non-streaming'

/** One reply of `text` delivered in the given mode (a streamed reply arrives in two cumulative chunks). */
function mockReplyIn(mode: Mode, text: string): void {
    if (mode === 'streaming') {
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: streamOf(text.slice(0, 2), text) })
    } else {
        requestChatDataMock.mockResolvedValueOnce({ type: 'success', result: text })
    }
}

function settled(call: () => Promise<boolean>): Promise<boolean | Error> {
    return call().then(
        (value) => value,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

function installSingle(extra: Record<string, unknown> = {}, messages: Message[] = [msg('user', 'Hi')], overrides: Record<string, unknown> = {}): void {
    installDb([makeCharacter('char-0', [makeChat('chat-origin', messages)], extra)], overrides)
    selectedCharID.set(0)
}

//#endregion

beforeEach(() => {
    requestChatDataMock.mockReset()
    requestChatDataMock.mockResolvedValue({ type: 'success', result: 'unexpected request.' })
    alertErrorMock.mockReset()
    runTriggerMock.mockReset()
    runTriggerMock.mockResolvedValue(undefined)
    sayTTSMock.mockReset()
    parserSpy.mockReset()
    parserSpy.mockImplementation(parserBox.actual!)
    ttsBox.useReal = false
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    chatOutputListeners.clear()
    clearRunningSends()
})

afterEach(() => {
    selectedCharID.set(-1)
})

function requests(): number {
    return requestChatDataMock.mock.calls.length
}

const MODES = [['streaming'], ['non-streaming']] as const

//#region hook stalls

const hang = () => new Promise<never>(() => {})

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

interface Run {
    state: { done: boolean, value: boolean | Error | undefined }
}

function startSend(arg?: Parameters<typeof sendChat>[1]): Run {
    const state: Run['state'] = { done: false, value: undefined }
    void settled(() => sendChat(-1, arg)).then((value) => {
        state.done = true
        state.value = value
    })
    return { state }
}

async function stopAndSettle(run: Run): Promise<void> {
    stopAllReplyWork()
    await until(() => run.state.done, 'the send to settle after the Stop')
}

async function flushTimers(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

const ORIGIN = { chaId: 'char-0', chatId: 'chat-origin' }

function requestsOf(model: string): number {
    return requestChatDataMock.mock.calls.filter((call) => call[1] === model).length
}

beforeEach(() => {
    tokenizeMock.mockReset()
    tokenizeMock.mockImplementation(async (text: string) => text.length)
    loreMock.mockReset()
    loreMock.mockImplementation(async () => ({ actives: [] }))
    stableDiffMock.mockReset()
    runInlayMock.mockReset()
    runInlayMock.mockImplementation((_char: unknown, text: string) => ({ text, promise: undefined }))
    supaMock.mockReset()
    hanuraiMock.mockReset()
    hypa2Mock.mockReset()
    hypa3Mock.mockReset()
    hypaBox.addText.mockReset()
    hypaBox.addText.mockResolvedValue(undefined)
    hypaBox.similaritySearch.mockReset()
    hypaBox.similaritySearch.mockResolvedValue([])
    hypaBox.similaritySearchScored.mockReset()
    hypaBox.similaritySearchScored.mockResolvedValue([])
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
})

describe('a chat output listener or output trigger that never settles', () => {
    test.each(MODES)('S-A1/S-A2: a %s send whose listener never settles ends with false at the Stop, frees the chat and starts no emotion request', async (mode) => {
        installSingle({}, [msg('user', 'Hi')], { igpPrompt: 'igp' })
        mockReplyIn(mode, 'Hello.')
        const listener = vi.fn(hang)
        chatOutputListeners.add(listener)

        const run = startSend()
        await until(() => listener.mock.calls.length > 0, 'the listener to be called')
        await settle()
        expect(run.state.done).toBe(false)
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(sendRefusalIn(ORIGIN)).toBeNull()
        expect(requestsOf('emotion')).toBe(0)
        // The unit ends at the listener: the auto-continue token count of the reply never starts.
        expect(tokenizeMock).not.toHaveBeenCalledWith('Hello.')
    })

    test.each(MODES)('S-A3: a %s send whose output trigger never settles ends with false at the Stop and calls no listener', async (mode) => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn(mode, 'Hello.')
        const listener = vi.fn()
        chatOutputListeners.add(listener)
        runTriggerMock.mockImplementation(async (_char: unknown, type: string) => (type === 'output' ? hang() : undefined))

        const run = startSend()
        await until(() => runTriggerMock.mock.calls.some((call) => call[1] === 'output'), 'the output trigger to be called')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(listener).not.toHaveBeenCalled()
    })

    test('S-A5: a start trigger that never settles ends the send with false at the Stop, before any request', async () => {
        installSingle({}, [msg('user', 'Hi')])
        runTriggerMock.mockImplementation(async (_char: unknown, type: string) => (type === 'start' ? hang() : undefined))

        const run = startSend()
        await until(() => runTriggerMock.mock.calls.some((call) => call[1] === 'start'), 'the start trigger to be called')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(requests()).toBe(0)
    })

    test('S-A6: when the first of two listeners never settles, the second is never called', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        const first = vi.fn(hang)
        const second = vi.fn()
        chatOutputListeners.add(first)
        chatOutputListeners.add(second)

        const run = startSend()
        await until(() => first.mock.calls.length > 0, 'the first listener to be called')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(second).not.toHaveBeenCalled()
    })

    test.each(MODES)('S-A7: guard, with no Stop a %s send calls each listener once in order and settles true', async (mode) => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn(mode, 'Hello.')
        const order: string[] = []
        chatOutputListeners.add(() => { order.push('first') })
        chatOutputListeners.add(async () => { order.push('second') })

        expect(await settled(() => sendChat())).toBe(true)

        expect(order).toEqual(['first', 'second'])
    })

    test('S-A8: a listener abandoned by the Stop that rejects later is one console warning and no unhandled rejection', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        let rejectLate: (error: Error) => void = () => {}
        const listener = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectLate = reject }))
        chatOutputListeners.add(listener)

        const run = startSend()
        await until(() => listener.mock.calls.length > 0, 'the listener to be called')
        await stopAndSettle(run)
        const late = new Error('late listener')
        rejectLate(late)
        await flushTimers()

        expect(unhandled).toEqual([])
        expect(console.warn).toHaveBeenCalledWith('A chat output listener', late)
    })
})

describe('a Stop that lands during a step with no hook of its own', () => {
    function inlayDeferred() {
        let resolve: (text: string) => void = () => {}
        let reject: (error: Error) => void = () => {}
        const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej })
        runInlayMock.mockImplementation((_char: unknown, text: string) => ({ text: `${text}[Generating...]`, promise }))
        return { resolve, reject }
    }

    test('S-A4: an inlay image that is still pending at the Stop ends the send, and the late image starts no second prompt', async () => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueChat: true })
        mockReplyIn('non-streaming', 'Hello')
        const inlay = inlayDeferred()

        const run = startSend()
        await until(() => runInlayMock.mock.calls.length > 0, 'the inlay step to run')
        stopAllReplyWork()
        inlay.resolve('Hello[image]')
        await until(() => run.state.done, 'the send to settle')
        await flushTimers()

        expect(run.state.value).toBe(false)
        expect(loreMock).toHaveBeenCalledTimes(1)
    })

    test('S-A4b: an output trigger that asks for a resend is not followed by a second prompt once the Stop landed during the igp request', async () => {
        installSingle({}, [msg('user', 'Hi')], { igpPrompt: 'igp' })
        runTriggerMock.mockImplementation(async (_char: unknown, type: string) => (type === 'output' ? { sendAIprompt: true } : undefined))
        let parsesAtStop = -1
        requestChatDataMock.mockImplementation(async (_arg: unknown, model: string) => {
            if (model === 'emotion') {
                parsesAtStop = parserSpy.mock.calls.length
                stopAllReplyWork()
                return { type: 'fail', result: 'Aborted' }
            }
            return { type: 'success', result: 'Hello.' }
        })

        expect(await settled(() => sendChat())).toBe(false)

        expect(loreMock).toHaveBeenCalledTimes(1)
        // The resend never began: it would have expanded the chat's variables again.
        expect(parsesAtStop).toBeGreaterThanOrEqual(0)
        expect(parserSpy).toHaveBeenCalledTimes(parsesAtStop)
    })

    test('S-A4c: a Stop that lands while the reply is being counted does not start the auto-continue', async () => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueChat: true })
        mockReplyIn('non-streaming', 'Hello')
        let release: () => void = () => {}
        const held = new Promise<void>((resolve) => { release = resolve })
        let entered = false
        tokenizeMock.mockImplementation(async (text: string) => {
            if (text === 'Hello') {
                entered = true
                await held
            }
            return text.length
        })

        const run = startSend()
        await until(() => entered, 'the reply count to start')
        const parsesBefore = parserSpy.mock.calls.length
        stopAllReplyWork()
        release()
        await until(() => run.state.done, 'the send to settle')

        expect(run.state.value).toBe(false)
        expect(loreMock).toHaveBeenCalledTimes(1)
        // The continuation never began: it would have expanded the chat's variables again.
        expect(parserSpy).toHaveBeenCalledTimes(parsesBefore)
    })
})

describe('a memory, search or image step that never settles', () => {
    test.each([
        ['S-M1', 'hanuraiMemory', { hanuraiEnable: true }, hanuraiMock],
        ['S-M2', 'hypaMemoryV2', { hypav2: true }, hypa2Mock],
        ['S-M3', 'hypaMemoryV3', { hypaV3: true }, hypa3Mock],
        ['S-M4', 'supaMemory', { supaModelType: 'subModel' }, supaMock],
    ] as const)('%s: a never-settling %s ends the send with false at the Stop, before the main request', async (_id, _name, overrides, dispatcher) => {
        installSingle({ supaMemory: true }, [msg('user', 'Hi')], overrides)
        dispatcher.mockImplementation(hang)

        const run = startSend()
        await until(() => dispatcher.mock.calls.length > 0, 'the memory dispatcher to be called')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(requests()).toBe(0)
    })

    test('S-M5 and SD-2: a never-settling image generation ends the send at the Stop, and it was handed the unit signal', async () => {
        installSingle({ viewScreen: 'imggen' }, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        stableDiffMock.mockImplementation(hang)

        const run = startSend()
        await until(() => stableDiffMock.mock.calls.length > 0, 'the image generation to be called')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(stableDiffMock.mock.calls[0][3]).toBeInstanceOf(AbortSignal)
    })

    test('S-M6: a never-settling emotion embedding search ends the send with false at the Stop', async () => {
        installSingle({ viewScreen: 'emotion', emotionImages: [['happy', 'happy.png']] }, [msg('user', 'Hi')], { emotionProcesser: 'embedding' })
        mockReplyIn('non-streaming', 'Hello.')
        hypaBox.addText.mockImplementation(hang)

        const run = startSend()
        await until(() => hypaBox.addText.mock.calls.length > 0, 'the embedding search to start')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
    })

    test('S-M7: a never-settling additional-information search ends the send with false at the Stop, before the main request', async () => {
        installSingle({ additionalText: 'first\n\nsecond' }, [msg('user', 'Hi')])
        hypaBox.addText.mockImplementation(hang)

        const run = startSend()
        await until(() => hypaBox.addText.mock.calls.length > 0, 'the additional-information search to start')
        await stopAndSettle(run)

        expect(run.state.value).toBe(false)
        expect(requests()).toBe(0)
    })

    // The three inlay races of the reply: the streamed reply, the pushed reply and the continued (replaced) reply.
    const INLAY_SITES = [
        ['stream site', 'streaming', false],
        ['push site', 'non-streaming', false],
        ['continue site', 'non-streaming', true],
    ] as const

    test.each(INLAY_SITES)('S-I1: an inlay image that never settles ends the send with false at the Stop, and the stored text keeps its placeholder (%s)', async (_site, mode, continuing) => {
        installSingle({}, continuing ? [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })] : [msg('user', 'Hi')])
        mockReplyIn(mode, 'Hello.')
        runInlayMock.mockImplementation((_char: unknown, text: string) => ({ text: `${text}[Generating...]`, promise: hang() }))

        const run = startSend(continuing ? { continue: true } : undefined)
        await until(() => runInlayMock.mock.calls.length > 0, 'the inlay step to run')
        await flushTimers()
        expect(run.state.done).toBe(false)
        stopAllReplyWork()
        await flushTimers()

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(datas(chatById('char-0', 'chat-origin')).at(-1)).toContain('[Generating...]')
    })

    test.each(INLAY_SITES)('S-I1b: an inlay image promise that rejects after the Stop is one console warning and no unhandled rejection (%s)', async (_site, mode, continuing) => {
        installSingle({}, continuing ? [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })] : [msg('user', 'Hi')])
        mockReplyIn(mode, 'Hello.')
        let rejectImage: (error: Error) => void = () => {}
        const image = new Promise<string>((_resolve, reject) => { rejectImage = reject })
        runInlayMock.mockImplementation((_char: unknown, text: string) => ({ text: `${text}[Generating...]`, promise: image }))

        const run = startSend(continuing ? { continue: true } : undefined)
        await until(() => runInlayMock.mock.calls.length > 0, 'the inlay step to run')
        await stopAndSettle(run)
        const failure = new Error('imggen failed')
        rejectImage(failure)
        await flushTimers()

        expect(run.state.value).toBe(false)
        expect(unhandled).toEqual([])
        expect(console.warn).toHaveBeenCalledWith('The inlay image', failure)
    })

    test('S-I2: an inlay image promise that already exists when the Stop has landed is handled once: the send settles and its later rejection is one warning', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        let rejectImage: (error: Error) => void = () => {}
        const image = new Promise<string>((_resolve, reject) => { rejectImage = reject })
        runInlayMock.mockImplementation((_char: unknown, text: string) => ({ text: `${text}[Generating...]`, promise: image }))
        let release: () => void = () => {}
        const pass = new Promise<void>((resolve) => { release = resolve })
        let entered = false
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string, mode: string) => {
            if (mode === 'editoutput') {
                entered = true
                await pass
            }
            return { data: text, emoChanged: false }
        })

        const run = startSend()
        await until(() => entered, 'the output script pass to start')
        stopAllReplyWork()
        release()
        await until(() => run.state.done, 'the send to settle')
        const failure = new Error('imggen failed')
        rejectImage(failure)
        await flushTimers()

        expect(run.state.value).toBe(false)
        expect(unhandled).toEqual([])
        expect(console.warn).toHaveBeenCalledWith('The inlay image', failure)
    })
})

//#endregion

//#region output passes after a Stop

describe('an output script pass that never settles after a Stop', () => {
    let frames: { request: typeof requestAnimationFrame, cancel: typeof cancelAnimationFrame }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        frames = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
        globalThis.requestAnimationFrame = ((callback: () => void) => setTimeout(callback, 0)) as unknown as typeof requestAnimationFrame
        globalThis.cancelAnimationFrame = ((id: ReturnType<typeof setTimeout>) => clearTimeout(id)) as unknown as typeof cancelAnimationFrame
    })

    afterEach(() => {
        globalThis.requestAnimationFrame = frames.request
        globalThis.cancelAnimationFrame = frames.cancel
        vi.useRealTimers()
    })

    // Fake timers only: the real-timer `until` and `settle` above would wait forever on a faked setTimeout.
    async function turn(): Promise<void> {
        await vi.advanceTimersByTimeAsync(0)
    }

    async function pump(turns = 30): Promise<void> {
        for (let i = 0; i < turns; i++) {
            await turn()
        }
    }

    async function waitFor(condition: () => boolean, what: string): Promise<void> {
        for (let i = 0; i < 400; i++) {
            if (condition()) {
                return
            }
            await turn()
        }
        throw new Error(`timed out waiting for: ${what}`)
    }

    async function advance(ms: number): Promise<void> {
        await vi.advanceTimersByTimeAsync(ms)
        await pump()
    }

    interface PassResult { data: string, emoChanged: boolean }
    type PassHandler = (call: number, text: string, abandoned: AbortSignal) => Promise<PassResult>

    /** Routes the `editoutput` passes of the send to `handler`; any other pass returns its text unchanged. */
    function outputPasses(handler: PassHandler): void {
        let call = 0
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string, mode: string, _index: number, _vars: unknown, _a: unknown, _subject: unknown, _ref: unknown, _b: unknown, _cache: unknown, _modules: unknown, abandoned: AbortSignal) => {
            if (mode !== 'editoutput') {
                return { data: text, emoChanged: false }
            }
            call += 1
            return handler(call, text, abandoned)
        })
    }

    function outputPassCalls() {
        return processScriptFullMock.mock.calls.filter((call) => call[2] === 'editoutput')
    }

    const same = (text: string): PassResult => ({ data: text, emoChanged: false })

    function liveStream() {
        let controller!: ReadableStreamDefaultController<{ data: string }>
        const stream = new ReadableStream<{ data: string }>({ start(c) { controller = c } })
        return {
            stream,
            push: (text: string) => controller.enqueue({ data: text }),
            close: () => controller.close(),
        }
    }

    function replyOf(): Message {
        return chatById('char-0', 'chat-origin').message.at(-1)!
    }

    function stopWarnings(): unknown[][] {
        return vi.mocked(console.warn).mock.calls.filter((call) => call[0] === 'A stopped reply is still running')
    }

    function abandonedPassWarnings(): number {
        return vi.mocked(console.warn).mock.calls.filter((call) => call[0] === 'The output script pass').length
    }

    test('D-1: a pass hanging on the second snapshot ends the send 10 s after the Stop with the first processed text stored', async () => {
        installSingle({}, [msg('user', 'Hi')])
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        outputPasses(async (call, text) => (call === 2 ? hang() : same(text)))

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('He')
        await waitFor(() => outputPassCalls().length === 1, 'the first pass')
        live.push('Hello')
        await waitFor(() => outputPassCalls().length === 2, 'the hung pass')
        await pump()
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS - 1)
        expect(run.state.done).toBe(false)
        await advance(1)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(replyOf().data).toBe('He')
        expect(replyOf().interrupted).toBeUndefined()
        expect(chatById('char-0', 'chat-origin').isStreaming).toBe(false)
        expect(sendRefusalIn(ORIGIN)).toBeNull()
    })

    test('D-2: a settle pass that hangs after the stream ended by itself ends the send 10 s after the Stop with the raw held span stored', async () => {
        installSingle({}, [msg('user', 'Hi')])
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        outputPasses(async (call, text) => (call === 2 ? hang() : same(text)))

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('Hi {{#if 1}}open')
        live.close()
        await waitFor(() => outputPassCalls().length === 2, 'the hung settle pass')
        await pump()
        expect(run.state.done).toBe(false)
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS - 1)
        expect(run.state.done).toBe(false)
        await advance(1)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(replyOf().data).toBe('Hi {{#if 1}}open')
        expect(replyOf().interrupted).toBeUndefined()
        expect(chatById('char-0', 'chat-origin').isStreaming).toBe(false)
    })

    test('D-9: the grace is shared by the passes of a unit: a pass finishing 9 s after the Stop leaves the settle pass only 1 s', async () => {
        installSingle({}, [msg('user', 'Hi')])
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        let finishFirst: (result: PassResult) => void = () => {}
        const first = new Promise<PassResult>((resolve) => { finishFirst = resolve })
        outputPasses(async (call, text) => (call === 1 ? first : call === 2 ? hang() : same(text)))

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('Hi {{#if 1}}open')
        await waitFor(() => outputPassCalls().length === 1, 'the first pass')
        stopAllReplyWork()
        await advance(9000)
        finishFirst(same('Hi '))
        await waitFor(() => outputPassCalls().length === 2, 'the settle pass')
        await pump()
        expect(run.state.done).toBe(false)
        await advance(STOPPED_PASS_GRACE_MS - 9000 - 1)
        expect(run.state.done).toBe(false)
        await advance(1)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(replyOf().data).toBe('Hi {{#if 1}}open')
    })

    test('D-8: after a flush pass was abandoned in balanced mode the settle pass is not started', async () => {
        installSingle({}, [msg('user', 'Hi')], { streamingDisplayOptimizationMode: 'balanced' })
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        outputPasses(async (call, text) => (call === 2 ? hang() : same(text)))

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('Hi {{#if 1}}open')
        await advance(300)
        await waitFor(() => outputPassCalls().length === 1, 'the first flush')
        live.push('Hi {{#if 1}}open{{/if}} there')
        await advance(300)
        await waitFor(() => outputPassCalls().length === 2, 'the hung flush')
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(outputPassCalls().length).toBe(2)
        expect(replyOf().interrupted).toBeUndefined()
    })

    test('D-8b: a flush abandoned at the grace ends the flush loop, so a snapshot queued behind it starts no further pass', async () => {
        installSingle({}, [msg('user', 'Hi')], { streamingDisplayOptimizationMode: 'balanced' })
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        outputPasses(async (call, text) => (call === 2 ? hang() : same(text)))

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('Hi {{#if 1}}open')
        await advance(300)
        await waitFor(() => outputPassCalls().length === 1, 'the first flush')
        live.push('Hi {{#if 1}}open{{/if}} there')
        await advance(300)
        await waitFor(() => outputPassCalls().length === 2, 'the hung flush')
        live.push('Hi {{#if 1}}open{{/if}} there again')
        await advance(300)
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS)

        expect(run.state.done).toBe(true)
        expect(outputPassCalls().length).toBe(2)
        // The flush and the settle pass that is not started: a loop that went on would add one more.
        expect(abandonedPassWarnings()).toBe(2)
    })
    test.each([['strong', 1], ['balanced', 1]] as const)('D-4/D-5: a normal Stop in %s mode stores the processed partial, and its post-Stop pass runs with an unaborted signal', async (mode, passes) => {
        installSingle({}, [msg('user', 'Hi')], { streamingDisplayOptimizationMode: mode })
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        outputPasses(async (_call, text) => same(`${text}#`))

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('Hello')
        await pump()
        expect(outputPassCalls().length).toBe(0)
        stopAllReplyWork()
        await pump()

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(replyOf().data).toBe('Hello#')
        expect(outputPassCalls().length).toBe(passes)
        for (const call of outputPassCalls()) {
            const abandoned = call[11] as AbortSignal
            expect(abandoned).toBeInstanceOf(AbortSignal)
            expect(abandoned.aborted).toBe(false)
        }
    })

    test('D-6: in off mode a pass in flight at the Stop that finishes inside the grace is written processed', async () => {
        installSingle({}, [msg('user', 'Hi')])
        const live = liveStream()
        requestChatDataMock.mockResolvedValueOnce({ type: 'streaming', result: live.stream })
        let finish: (result: PassResult) => void = () => {}
        const pending = new Promise<PassResult>((resolve) => { finish = resolve })
        outputPasses(async () => pending)

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        live.push('Hello')
        await waitFor(() => outputPassCalls().length === 1, 'the pass')
        stopAllReplyWork()
        await advance(2000)
        expect(run.state.done).toBe(false)
        finish(same('Hello#'))
        await pump()

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(replyOf().data).toBe('Hello#')
    })

    test('D-7: a non-stream pass that never settles stores the raw trimmed reply 10 s after the Stop, with no inlay generation, trigger, listener or variable expansion', async () => {
        installSingle({ viewScreen: 'imggen' }, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', '  Hello {{setvar::late::1}} <ImgGen="cat">  ')
        outputPasses(() => hang())
        const listener = vi.fn()
        chatOutputListeners.add(listener)

        const run = startSend()
        await waitFor(() => outputPassCalls().length === 1, 'the pass')
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS - 1)
        expect(run.state.done).toBe(false)
        await advance(1)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        const chat = chatById('char-0', 'chat-origin')
        expect(datas(chat)).toEqual(['Hi', 'Hello {{setvar::late::1}} <ImgGen="cat">'])
        expect(chat.message[1].role).toBe('char')
        expect(runInlayMock).not.toHaveBeenCalled()
        expect(stableDiffMock).not.toHaveBeenCalled()
        expect(listener).not.toHaveBeenCalled()
        expect(runTriggerMock.mock.calls.some((call) => call[1] === 'output')).toBe(false)
        expect(Object.keys(chat.scriptstate ?? {})).not.toContain('$late')
        expect(sendRefusalIn(ORIGIN)).toBeNull()
    })

    test('D-7b: a continue whose continued pass never settles stores the whole trimmed continued text', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })])
        mockReplyIn('non-streaming', '  Part two.  ')
        outputPasses(async (call, text) => (call === 1 ? same(text) : hang()))

        const run = startSend({ continue: true })
        await waitFor(() => outputPassCalls().length === 2, 'the continued pass')
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Part one.  Part two.'])
        expect(runInlayMock).not.toHaveBeenCalled()
    })

    test('D-7d: a multi-message reply whose first pass never settles stores every message raw and starts no later pass', async () => {
        installSingle({}, [msg('user', 'Hi')])
        requestChatDataMock.mockResolvedValueOnce({ type: 'multiline', result: [['char', '  One.  '], ['char', 'Two.']] })
        outputPasses(() => hang())

        const run = startSend()
        await waitFor(() => outputPassCalls().length === 1, 'the pass')
        stopAllReplyWork()
        await advance(STOPPED_PASS_GRACE_MS)

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'One.'])
        expect(outputPassCalls().length).toBe(1)
        expect(runInlayMock).not.toHaveBeenCalled()
    })

    test('D-11: guard, a reply the request returns after the Stop is neither passed nor stored', async () => {
        installSingle({}, [msg('user', 'Hi')])
        let answer: (value: unknown) => void = () => {}
        requestChatDataMock.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
        outputPasses(() => hang())

        const run = startSend()
        await waitFor(() => requests() > 0, 'the request')
        stopAllReplyWork()
        await advance(9000)
        answer({ type: 'success', result: 'Hello.' })
        await pump()

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(outputPassCalls().length).toBe(0)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi'])
    })

    test('D-10: guard, a send that is never stopped leaves no timer behind', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        const baseline = vi.getTimerCount()

        const run = startSend()
        await waitFor(() => run.state.done, 'the send')

        expect(run.state.value).toBe(true)
        expect(vi.getTimerCount()).toBe(baseline)
        expect(stopWarnings()).toEqual([])
    })

    test('W-1: a stopped unit still running 20 s after the Stop logs one line naming the chat', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        let entered = false
        tokenizeMock.mockImplementation(async (text: string) => {
            if (text === 'Hello.') {
                entered = true
                return hang()
            }
            return text.length
        })

        const run = startSend()
        await waitFor(() => entered, 'the reply count to start')
        stopAllReplyWork()
        await advance(STOPPED_UNIT_WATCHDOG_MS - 1)
        expect(stopWarnings()).toEqual([])
        await advance(1)
        expect(stopWarnings()).toEqual([['A stopped reply is still running', 'chat-origin']])
        await advance(60_000)

        expect(stopWarnings().length).toBe(1)
        expect(run.state.done).toBe(false)
    })

    test('W-1b: a unit that returns inside the grace logs no watchdog line and leaves no timer', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        let finish: (result: PassResult) => void = () => {}
        const pending = new Promise<PassResult>((resolve) => { finish = resolve })
        outputPasses(async () => pending)
        const baseline = vi.getTimerCount()

        const run = startSend()
        await waitFor(() => outputPassCalls().length === 1, 'the pass')
        stopAllReplyWork()
        await advance(9000)
        finish(same('Hello.'))
        await pump()
        expect(run.state.done).toBe(true)
        // The unit's own end clears both timers; neither waits for its deadline to pass.
        expect(vi.getTimerCount()).toBe(baseline)
        await advance(30_000)

        expect(run.state.value).toBe(false)
        expect(stopWarnings()).toEqual([])
        expect(vi.getTimerCount()).toBe(baseline)
    })

    test('S-I2b: an inlay image started after a Stop by a pass that finished inside the grace is handled once', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello.')
        let rejectImage: (error: Error) => void = () => {}
        const image = new Promise<string>((_resolve, reject) => { rejectImage = reject })
        runInlayMock.mockImplementation((_char: unknown, text: string) => ({ text: `${text}[Generating...]`, promise: image }))
        let finish: (result: PassResult) => void = () => {}
        const pending = new Promise<PassResult>((resolve) => { finish = resolve })
        outputPasses(async () => pending)

        const run = startSend()
        await waitFor(() => outputPassCalls().length === 1, 'the pass')
        stopAllReplyWork()
        await advance(2000)
        finish(same('Hello.'))
        await pump()
        expect(run.state.done).toBe(true)
        const failure = new Error('imggen failed')
        rejectImage(failure)
        await pump()

        expect(run.state.value).toBe(false)
        expect(unhandled).toEqual([])
        expect(console.warn).toHaveBeenCalledWith('The inlay image', failure)
    })

    test('D-12: a non-stream Stop during a pass that finishes inside the grace keeps the pass signal unaborted and expands no variable', async () => {
        installSingle({}, [msg('user', 'Hi')])
        mockReplyIn('non-streaming', 'Hello {{setvar::late::1}}')
        let finish: () => void = () => {}
        const pending = new Promise<void>((resolve) => { finish = resolve })
        outputPasses(async (_call, text) => { await pending; return same(text) })

        const run = startSend()
        await waitFor(() => outputPassCalls().length === 1, 'the pass')
        stopAllReplyWork()
        await pump()
        const signal = outputPassCalls()[0][11] as AbortSignal
        expect(signal).toBeInstanceOf(AbortSignal)
        expect(signal.aborted).toBe(false)
        await advance(2000)
        finish()
        await pump()

        expect(run.state.done).toBe(true)
        expect(run.state.value).toBe(false)
        expect(Object.keys(chatById('char-0', 'chat-origin').scriptstate ?? {})).not.toContain('$late')
    })

    test('D-12b: a continue Stopped during its continued pass keeps that pass signal unaborted until the grace', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })])
        mockReplyIn('non-streaming', '  Part two.  ')
        outputPasses(async (call, text) => (call === 1 ? same(text) : hang()))

        const run = startSend({ continue: true })
        await waitFor(() => outputPassCalls().length === 2, 'the continued pass')
        stopAllReplyWork()
        await pump()
        const signal = outputPassCalls()[1][11] as AbortSignal
        expect(signal).toBeInstanceOf(AbortSignal)
        expect(signal.aborted).toBe(false)
        await advance(STOPPED_PASS_GRACE_MS)
        expect(run.state.done).toBe(true)
    })
})

//#endregion
