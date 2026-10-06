/**
 * Auto-TTS of a send: what the run speaks after the reply is final.
 *
 * Drives the REAL, unmocked `sendChat` (`../index.svelte`), the REAL CBS
 * parser (`risuChatParser`, wrapped in a recording spy), the REAL `ttsAddition`
 * and the REAL `filterTTSText` over a real `$state` database. The stream is a
 * `ReadableStream` of cumulative chunks. Every other module `index.svelte.ts`
 * imports is mocked as in `sendChatOrigin.svelte.test.ts`; `sayTTS` is a spy
 * except in the scenario that needs the real Stop behaviour.
 *
 * Invariants pinned here:
 *  - a run calls `sayTTS` at most once, after the output trigger, the inlay
 *    step and the chatOutput listeners, with the parse of the STORED reply
 *    (never the raw chunk) and `skipTextFilter` set;
 *  - what is spoken is what the run added: a fresh reply whole, a continuation
 *    only its addition, earlier text that changed from the first difference;
 *  - nothing is spoken for a reply that cannot be located, for an aborted
 *    run, for an empty parse, or for the alternates of a multiline answer;
 *  - the parse carries the run's own `subject`, so context tags read the chat
 *    the run belongs to, and it writes no chat variables;
 *  - a Stop releases a send that is waiting on speech.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat, Message } from '../../storage/database.svelte'
import type { Origin } from '../chatOrigin'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`).
import '../../polyfill'

//#region module mocks

interface ChatOutputArg {
    messageIndex: number
}

interface ParseOptions {
    chara?: unknown
    chatID?: number
    rmVar?: boolean
    visualize?: boolean
    cbsConditions?: { firstmsg?: boolean, chatRole?: string | null }
    subject?: unknown
}

const requestChatDataMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const runTriggerMock = vi.hoisted(() => vi.fn())
const sayTTSMock = vi.hoisted(() => vi.fn())
const parserSpy = vi.hoisted(() => vi.fn())
const parserBox = vi.hoisted(() => ({ actual: null as null | ((...args: unknown[]) => string) }))
const ttsBox = vi.hoisted(() => ({ useReal: false, real: null as null | ((...args: unknown[]) => Promise<void>) }))
const processScriptFullMock = vi.hoisted(() => vi.fn())
const isLastCharPunctuationMock = vi.hoisted(() => vi.fn())
const chatOutputListeners = vi.hoisted(() => new Set<(arg: ChatOutputArg) => unknown>())

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
    tokenize: vi.fn(async () => 1),
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
    loadLoreBookV3Prompt: vi.fn(async () => ({ actives: [] })),
}) as unknown as typeof import('../lorebook.svelte'))

vi.mock(import('../../util'), async () => {
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
        isLastCharPunctuation: isLastCharPunctuationMock,
        trimUntilPunctuation: vi.fn((s: string) => s),
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
    stableDiff: vi.fn(),
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
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: runTriggerMock,
}) as unknown as typeof import('../triggers'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {},
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => ''),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), () => ({
    addRerolls: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
    runVITS: vi.fn(),
}) as unknown as typeof import('../transformers'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, formated: unknown) => formated),
}) as unknown as typeof import('../scriptings'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => ({ id: 'test-model', flags: [] })),
    LLMFlags: {},
}) as unknown as typeof import('../../model/modellist'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
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

import { sendChat, doingChat } from '../index.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { writeAt } from '../chatOrigin'
import { stopTTS } from '../tts'
import { getUserName } from '../../util'

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
        // A voiced character: auto speech only runs for a speaker whose mode produces speech.
        ttsMode: 'webspeech',
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
        ttsAutoSpeech: true,
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

/** Replaces the output trigger with one that edits the stored reply through the run's origin. */
function outputTriggerEdits(edit: (chat: Chat) => void): void {
    runTriggerMock.mockImplementation(async (_char: unknown, mode: string, arg: { origin: Origin }) => {
        if (mode === 'output') {
            writeAt(arg.origin, (ctx) => { edit(ctx.chat) })
        }
        return undefined
    })
}

function spoken(): string[] {
    return sayTTSMock.mock.calls.map((call) => call[1] as string)
}

/** The parse options of the calls that built spoken text: display parses (visualize) only. */
function ttsParseCalls(): Array<{ text: string, options: ParseOptions }> {
    return parserSpy.mock.calls
        .filter((call) => (call[1] as ParseOptions | undefined)?.visualize === true)
        .map((call) => ({ text: call[0] as string, options: call[1] as ParseOptions }))
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
    vi.mocked(getUserName).mockReset()
    vi.mocked(getUserName).mockImplementation(() => 'User')
    processScriptFullMock.mockReset()
    processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text, emoChanged: false }))
    isLastCharPunctuationMock.mockReset()
    isLastCharPunctuationMock.mockReturnValue(true)
    chatOutputListeners.clear()
    doingChat.set(false)
})

afterEach(() => {
    selectedCharID.set(-1)
})

describe('what a fresh reply speaks', () => {
    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('regression reproducer: %s reply is spoken once, as the parse of the stored reply and not as the raw text', async (mode) => {
        installSingle()
        mockReplyIn(mode, 'Hello {{user}}.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(spoken()).toEqual(['Hello User.'])
        expect(sayTTSMock.mock.calls[0][0]).toBe(charById('char-0'))
        expect(sayTTSMock.mock.calls[0][2]).toEqual({ skipTextFilter: true })
    })

    test('regression reproducer: a streamed reply with deferred post-processing is spoken once, as the parse of the stored reply', async () => {
        installSingle({}, [msg('user', 'Hi')], { streamingDisplayOptimizationMode: 'strong' })
        mockReplyIn('streaming', 'Hello {{user}}.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(spoken()).toEqual(['Hello User.'])
    })

    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('regression reproducer: an output trigger that rewrites the %s reply is what is spoken, after the trigger and the listeners ran', async (mode) => {
        installSingle()
        outputTriggerEdits((chat) => { chat.message.at(-1)!.data = 'Rewritten by the trigger.' })
        const order: string[] = []
        chatOutputListeners.add(() => { order.push('listener') })
        sayTTSMock.mockImplementation(async () => { order.push('speak') })
        mockReplyIn(mode, 'Original reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(spoken()).toEqual(['Rewritten by the trigger.'])
        expect(order).toEqual(['listener', 'speak'])
    })

    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('regression reproducer: a %s reply that an output trigger removes is not spoken, and the send still ends', async (mode) => {
        installSingle()
        outputTriggerEdits((chat) => { chat.message.pop() })
        mockReplyIn(mode, 'Doomed reply.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayTTSMock).not.toHaveBeenCalled()
    })

    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('regression reproducer: a %s reply whose parse is empty is not spoken', async (mode) => {
        installSingle()
        mockReplyIn(mode, '{{none}}')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayTTSMock).not.toHaveBeenCalled()
    })

    test('guard: nothing is spoken when auto speech is off', async () => {
        installSingle({}, [msg('user', 'Hi')], { ttsAutoSpeech: false })
        mockReplyIn('non-streaming', 'Hello.')

        await settled(() => sendChat())

        expect(sayTTSMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a thinking section in the reply is not spoken', async () => {
        installSingle()
        mockReplyIn('non-streaming', 'Plan.\n\n<Thoughts>private</Thoughts>\n\nAnswer.')

        await settled(() => sendChat())

        expect(spoken()).toEqual(['Plan.\n\nAnswer.'])
    })

    test('regression reproducer: only the stored answer of a multiline reply is spoken, not its alternates', async () => {
        installSingle()
        requestChatDataMock.mockResolvedValueOnce({ type: 'multiline', result: [['char', 'First answer.'], ['char', 'Second answer.'], ['char', 'Third answer.']] })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(spoken()).toEqual(['First answer.'])
    })

    test('regression reproducer: a read-only-quoted character is sent the quoted spans of the reply, already filtered', async () => {
        installSingle({ ttsReadOnlyQuoted: true })
        mockReplyIn('non-streaming', 'She said "Hello there." Then she left.')

        await settled(() => sendChat())

        expect(spoken()).toEqual(['Hello there.'])
        expect(sayTTSMock.mock.calls[0][2]).toEqual({ skipTextFilter: true })
    })

    test('regression reproducer: a read-only-quoted character with no quote in the reply is not spoken', async () => {
        installSingle({ ttsReadOnlyQuoted: true })
        mockReplyIn('non-streaming', 'Nobody says anything.')

        await settled(() => sendChat())

        expect(sayTTSMock).not.toHaveBeenCalled()
    })
})

describe('an aborted run', () => {
    test('regression reproducer: a non-streaming run aborted by its output trigger is not spoken', async () => {
        installSingle()
        const controller = new AbortController()
        runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
            if (mode === 'output') {
                controller.abort()
            }
            return undefined
        })
        mockReplyIn('non-streaming', 'Hello.')

        await settled(() => sendChat(-1, { signal: controller.signal }))

        expect(sayTTSMock).not.toHaveBeenCalled()
    })

    test('guard: a non-streaming run aborted while its reply is processed is not spoken', async () => {
        installSingle()
        const controller = new AbortController()
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => {
            controller.abort()
            return { data: text, emoChanged: false }
        })
        mockReplyIn('non-streaming', 'Hello.')

        await settled(() => sendChat(-1, { signal: controller.signal }))

        expect(sayTTSMock).not.toHaveBeenCalled()
    })
})

describe('a continuation', () => {
    test.each([
        ['guard: a streaming continue speaks only what it added', 'streaming'],
        ['regression reproducer: a non-streaming continue speaks only what it added', 'non-streaming'],
    ] as const)('%s', async (_title, mode) => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })])
        mockReplyIn(mode, ' Part two.')

        const result = await settled(() => sendChat(-1, { continue: true }))

        expect(result).toBe(true)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Part one. Part two.'])
        expect(spoken()).toEqual([' Part two.'])
    })

    test('regression reproducer: an auto-continue chain speaks part one, part two and part three once each, never an earlier part again', async () => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueChat: true })
        isLastCharPunctuationMock.mockImplementation((text: string) => /[.!?]$/.test(text))
        mockReplyIn('non-streaming', 'Part one')
        mockReplyIn('non-streaming', ' part two')
        mockReplyIn('non-streaming', ' part three.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Part one part two part three.'])
        expect(spoken()).toEqual(['Part one', ' part two', ' part three.'])
    })

    test('guard: a reply after a continue is spoken whole', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })])
        mockReplyIn('non-streaming', ' Part two.')
        await settled(() => sendChat(-1, { continue: true }))
        sayTTSMock.mockClear()
        chatById('char-0', 'chat-origin').message.push(msg('user', 'And then?'))
        mockReplyIn('non-streaming', 'A brand new reply.')

        await settled(() => sendChat())

        expect(spoken()).toEqual(['A brand new reply.'])
    })

    test('regression reproducer: a thinking section opened in part one and closed in part two is not spoken', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', '<Thoughts>planning', { chatId: 'reply-id', saying: 'char-0' })])
        mockReplyIn('non-streaming', ' more</Thoughts>The answer.')

        await settled(() => sendChat(-1, { continue: true }))

        expect(spoken()).toEqual(['The answer.'])
    })

    test('regression reproducer: when a script rewrote earlier text during a continue, speech starts at the first difference', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Hello brave world.', { chatId: 'reply-id', saying: 'char-0' })])
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text.replace('brave', 'kind'), emoChanged: false }))
        mockReplyIn('non-streaming', ' More.')

        await settled(() => sendChat(-1, { continue: true }))

        expect(datas(chatById('char-0', 'chat-origin')).at(-1)).toBe('Hello kind world. More.')
        expect(spoken()).toEqual(['kind world. More.'])
    })

    test('regression reproducer: a continue whose target message is gone stores nothing and speaks nothing', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })])
        mockReplyIn('non-streaming', ' Part two.')

        const result = await settled(() => sendChat(-1, { continue: true, continueMessageId: 'gone-id' }))

        expect(result).toBe(true)
        expect(datas(chatById('char-0', 'chat-origin'))).toEqual(['Hi', 'Part one.'])
        expect(sayTTSMock).not.toHaveBeenCalled()
    })
})

describe('the parse that produces spoken text', () => {
    test('regression reproducer: both parses of a run use the same reply index, role, name and subject', async () => {
        installSingle()
        mockReplyIn('non-streaming', 'Hello there.')

        await settled(() => sendChat())

        const calls = ttsParseCalls()
        expect(calls.map((call) => call.text)).toEqual(['Hello there.', ''])
        expect(calls[0].options).toMatchObject({
            chara: 'char-0',
            chatID: 1,
            rmVar: true,
            visualize: true,
            cbsConditions: { firstmsg: false, chatRole: 'char' },
            subject: expect.anything(),
        })
        expect(calls[1].options).toEqual(calls[0].options)
        expect(calls[1].options.subject).toBe(calls[0].options.subject)
    })

    test('guard: a variable set by text that only the spoken-text parse sees is not written to the chat', async () => {
        installSingle()
        outputTriggerEdits((chat) => { chat.message.at(-1)!.data = 'Hi {{setvar::y::2}}there.' })
        mockReplyIn('non-streaming', 'Hello.')

        await settled(() => sendChat())

        const scriptstate = chatById('char-0', 'chat-origin').scriptstate ?? {}
        expect(Object.keys(scriptstate).filter((key) => key.startsWith('$y'))).toEqual([])
    })

    test('regression reproducer: text that only the spoken-text parse sees is spoken with its tags parsed and its variable write left out', async () => {
        installSingle()
        outputTriggerEdits((chat) => { chat.message.at(-1)!.data = 'Hi {{setvar::y::2}}there, {{user}}.' })
        mockReplyIn('non-streaming', 'Hello.')

        await settled(() => sendChat())

        expect(spoken()).toEqual(['Hi there, User.'])
    })

    test.each([
        ['streaming'],
        ['non-streaming'],
    ] as const)('regression reproducer: a context tag in a %s reply reads the chat the run belongs to, not the chat on screen', async (mode) => {
        installDb([
            makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')], { scriptstate: { $mood: 'calm' } })]),
            makeCharacter('char-1', [makeChat('chat-other', [msg('user', 'Yo')], { scriptstate: { $mood: 'angry' } })]),
        ])
        selectedCharID.set(0)
        runTriggerMock.mockImplementation(async (_char: unknown, triggerMode: string, arg: { origin: Origin }) => {
            if (triggerMode === 'output') {
                writeAt(arg.origin, (ctx) => { ctx.chat.message.at(-1)!.data = 'Mood is {{getvar::mood}}.' })
                selectedCharID.set(1)
            }
            return undefined
        })
        mockReplyIn(mode, 'Placeholder.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(spoken()).toEqual(['Mood is calm.'])
    })

    test('regression reproducer: a reply in a group chat is parsed with the group name as the character and spoken by the member', async () => {
        const group = makeGroup('group-1', 'The Party', ['member-1', 'member-2'], [makeChat('group-chat', [msg('user', 'Hi')])])
        installDb([group, makeCharacter('member-1', [makeChat('m1-chat', [])]), makeCharacter('member-2', [makeChat('m2-chat', [])])])
        selectedCharID.set(0)
        runTriggerMock.mockImplementation(async (_char: unknown, triggerMode: string, arg: { origin: Origin }) => {
            if (triggerMode === 'output') {
                writeAt(arg.origin, (ctx) => { ctx.chat.message.at(-1)!.data = 'I am {{char}} for {{user}}.' })
            }
            return undefined
        })
        mockReplyIn('non-streaming', 'Placeholder.')

        const result = await settled(() => sendChat(1))

        expect(result).toBe(true)
        expect(spoken()).toEqual(['I am The Party for User.'])
        expect(sayTTSMock.mock.calls[0][0]).toBe(charById('member-2'))
        expect(ttsParseCalls()[0].options.chara).toBe('The Party')
        expect(ttsParseCalls()[0].options.chatID).toBe(1)
    })
})

describe('the spoken text of a message and its displayed text', () => {
    // The same message and the same expected text as the displayed-text scenario in
    // `src/lib/ChatScreens/Chat.tts.svelte.test.ts`: the spoken parse and the
    // displayed parse of one stored message are one string.
    const MESSAGE = '{{char}} says hi to {{user}}. Mood: {{getvar::mood}}'

    function injectMessageAfterVariables(): void {
        runTriggerMock.mockImplementation(async (_char: unknown, triggerMode: string, arg: { origin: Origin }) => {
            if (triggerMode === 'output') {
                writeAt(arg.origin, (ctx) => { ctx.chat.message.at(-1)!.data = MESSAGE })
            }
            return undefined
        })
    }

    test('regression reproducer: for the character on screen the spoken text is the displayed text', async () => {
        installDb([makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')], { scriptstate: { $mood: 'calm' } })], { name: 'Alpha' })])
        selectedCharID.set(0)
        injectMessageAfterVariables()
        mockReplyIn('non-streaming', 'Placeholder.')

        await settled(() => sendChat())

        expect(spoken()).toEqual(['Alpha says hi to User. Mood: calm'])
    })

    test('regression reproducer: for a group chat on screen the spoken text is the displayed text, with the group name as the character', async () => {
        const group = makeGroup('group-1', 'The Party', ['member-1'], [makeChat('group-chat', [msg('user', 'Hi')], { scriptstate: { $mood: 'calm' } })])
        installDb([group, makeCharacter('member-1', [makeChat('m1-chat', [])], { name: 'Member One' })])
        selectedCharID.set(0)
        injectMessageAfterVariables()
        mockReplyIn('non-streaming', 'Placeholder.')

        await settled(() => sendChat(0))

        expect(spoken()).toEqual(['The Party says hi to User. Mood: calm'])
        expect(sayTTSMock.mock.calls[0][0]).toBe(charById('member-1'))
    })
})

describe('which speaker is voiced', () => {
    test.each([
        ['an empty mode', ''],
        ['an unset mode', undefined],
        ['the none mode', 'none'],
        ['the normal mode', 'normal'],
    ] as const)('regression reproducer: a character with %s is neither parsed for speech nor spoken', async (_title, ttsMode) => {
        installSingle({ ttsMode })
        mockReplyIn('non-streaming', 'Hello {{user}}.')

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(sayTTSMock).not.toHaveBeenCalled()
        expect(ttsParseCalls()).toEqual([])
    })

    test('regression reproducer: a group turn is not parsed or spoken when the speaking member has no voice, even if another member has one', async () => {
        const group = makeGroup('group-1', 'The Party', ['member-1', 'member-2'], [makeChat('group-chat', [msg('user', 'Hi')])])
        installDb([
            group,
            makeCharacter('member-1', [makeChat('m1-chat', [])]),
            makeCharacter('member-2', [makeChat('m2-chat', [])], { ttsMode: 'none' }),
        ])
        selectedCharID.set(0)
        mockReplyIn('non-streaming', 'I am {{char}}.')

        const result = await settled(() => sendChat(1))

        expect(result).toBe(true)
        expect(sayTTSMock).not.toHaveBeenCalled()
        expect(ttsParseCalls()).toEqual([])
    })

    test('guard: a group turn of a voiced member is parsed with the group name and spoken with the member voice', async () => {
        const group = makeGroup('group-1', 'The Party', ['member-1', 'member-2'], [makeChat('group-chat', [msg('user', 'Hi')])])
        installDb([
            group,
            makeCharacter('member-1', [makeChat('m1-chat', [])], { ttsMode: 'none' }),
            makeCharacter('member-2', [makeChat('m2-chat', [])]),
        ])
        selectedCharID.set(0)
        outputTriggerEdits((chat) => { chat.message.at(-1)!.data = 'I am {{char}}.' })
        mockReplyIn('non-streaming', 'Placeholder.')

        const result = await settled(() => sendChat(1))

        expect(result).toBe(true)
        expect(spoken()).toEqual(['I am The Party.'])
        expect(sayTTSMock.mock.calls[0][0]).toBe(charById('member-2'))
        expect(ttsParseCalls()[0].options.chara).toBe('The Party')
    })

    test('regression reproducer: a user-role reply is parsed with the user name of the chat the send belongs to, after the screen switched chats', async () => {
        installDb([
            makeCharacter('char-0', [makeChat('chat-origin', [msg('user', 'Hi')])]),
            makeCharacter('char-1', [makeChat('chat-other', [msg('user', 'Yo')])]),
        ])
        selectedCharID.set(0)
        vi.mocked(getUserName).mockImplementation((chat) => (chat && chat.id === 'chat-origin' ? 'Origin User' : 'Screen User'))
        runTriggerMock.mockImplementation(async (_char: unknown, triggerMode: string) => {
            if (triggerMode === 'output') {
                selectedCharID.set(1)
            }
            return undefined
        })
        requestChatDataMock.mockResolvedValueOnce({ type: 'multiline', result: [['user', 'I am {{user}}.']] })

        const result = await settled(() => sendChat())

        expect(result).toBe(true)
        expect(spoken()).toEqual(['I am Origin User.'])
        expect(ttsParseCalls()[0].options.chara).toBe('Origin User')
    })
})

describe('a Stop while a send waits on speech', () => {
    const touched = ['speechSynthesis', 'SpeechSynthesisUtterance', 'fetch'] as const
    const saved = new Map<string, PropertyDescriptor | undefined>()

    function setGlobal(name: string, value: unknown): void {
        if (!saved.has(name)) {
            saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
        }
        Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    }

    afterEach(() => {
        for (const name of touched) {
            if (!saved.has(name)) continue
            const original = saved.get(name)
            if (original) {
                Object.defineProperty(globalThis, name, original)
            } else {
                Reflect.deleteProperty(globalThis, name)
            }
        }
        saved.clear()
    })

    test('regression reproducer: the send finishes promptly and releases the chat', async () => {
        installSingle({ ttsMode: 'huggingface', hfTTS: { model: 'm/x', language: 'en' } })
        setGlobal('speechSynthesis', { cancel: vi.fn(), getVoices: vi.fn(() => []), speak: vi.fn() })
        setGlobal('SpeechSynthesisUtterance', class {})
        const fetchMock = vi.fn(async () => ({
            status: 503,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({ estimated_time: 20 }),
            json: async () => ({ estimated_time: 20 }),
        }))
        setGlobal('fetch', fetchMock)
        ttsBox.useReal = true
        mockReplyIn('non-streaming', 'Hello.')

        const outcome = settled(() => sendChat())
        await until(() => fetchMock.mock.calls.length > 0, 'the speech request')
        stopTTS()
        const finished = await Promise.race([
            outcome,
            new Promise<'still waiting'>((resolve) => setTimeout(() => resolve('still waiting'), 1500)),
        ])

        expect(finished).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        let released = false
        doingChat.subscribe((value) => { released = !value })()
        expect(released).toBe(true)
    })
})