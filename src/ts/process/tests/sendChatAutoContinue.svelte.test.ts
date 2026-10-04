/**
 * Which text the auto-continue decision reads: the text THIS request produced, as the
 * model returned it, in streaming and non-streaming sends alike.
 *
 * Drives the REAL, unmocked `sendChat` over a real `$state` database with a length-based
 * `tokenize`, the real `isLastCharPunctuation` and `trimUntilPunctuation`, and a
 * `processScriptFull` that maps its input like a real `editoutput` script (it receives the
 * cumulative text of a continue, as the real one does). Every other module `index.svelte.ts`
 * imports is mocked as in `sendChatTts.svelte.test.ts`.
 *
 * Invariants pinned here:
 *  - the decision does not depend on how the reply was delivered or on `editoutput` scripts;
 *  - the minimum-token total is the tokens of each request's own text, counted once;
 *  - a request that produced no text never auto-continues, so an empty reply cannot loop;
 *  - a multiline answer is judged by its last message.
 *
 * Tests whose title starts with `guard:` pin behaviour that must be preserved.
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
    tokenize: vi.fn(async (text: string) => text.length),
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
    isPlainHttpFileSrc: vi.fn(() => false),
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
    doingChat.set(false)
})

afterEach(() => {
    selectedCharID.set(-1)
})

/** Queues `texts` as this send's replies in `mode`; any request after them returns an empty reply, and a request past `MAX_REQUESTS` fails so a runaway chain ends. */
const MAX_REQUESTS = 8

function scriptReplies(mode: Mode, texts: string[]): void {
    let served = 0
    requestChatDataMock.mockImplementation(async () => {
        served++
        if (served > MAX_REQUESTS) {
            return { type: 'fail', result: 'runaway auto-continue chain' }
        }
        const text = served <= texts.length ? texts[served - 1] : ''
        if (mode === 'streaming') {
            return { type: 'streaming', result: streamOf(text.slice(0, 2), text) }
        }
        return { type: 'success', result: text }
    })
}

function requests(): number {
    return requestChatDataMock.mock.calls.length
}

const MODES = [['streaming'], ['non-streaming']] as const

describe('the minimum-token total', () => {
    test.each([
        ['guard: streaming', 'streaming'],
        ['regression reproducer: non-streaming', 'non-streaming'],
    ] as const)('%s: a chain counts each request\'s own tokens once, so both modes stop after the same request', async (_title, mode) => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueMinTokens: 10 })
        scriptReplies(mode, ['abcd', 'efgh', 'ijkl'])

        await settled(() => sendChat())

        expect(requests()).toBe(3)
        expect(datas(chatById('char-0', 'chat-origin')).at(-1)).toBe('abcdefghijkl')
    })
})

describe('editoutput scripts and the decision', () => {
    test.each([
        ['guard: streaming', 'streaming'],
        ['regression reproducer: non-streaming', 'non-streaming'],
    ] as const)('%s: a script that adds a final period to an unfinished reply does not stop auto-continue', async (_title, mode) => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueChat: true })
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text.endsWith('.') ? text : `${text}.`, emoChanged: false }))
        scriptReplies(mode, ['Unfinished', ' second.'])

        await settled(() => sendChat())

        expect(requests()).toBe(2)
    })

    test.each([
        ['guard: streaming', 'streaming'],
        ['regression reproducer: non-streaming', 'non-streaming'],
    ] as const)('%s: a script that strips the final period from a finished reply does not start auto-continue', async (_title, mode) => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueChat: true })
        processScriptFullMock.mockImplementation(async (_char: unknown, text: string) => ({ data: text.replace(/\.$/, ''), emoChanged: false }))
        scriptReplies(mode, ['Done.'])

        await settled(() => sendChat())

        expect(requests()).toBe(1)
    })
})

describe('a request that produced no text', () => {
    const LONG_PART_ONE = 'Part one is already long enough.'

    test.each([
        ['regression reproducer: streaming', 'streaming'],
        ['guard: non-streaming', 'non-streaming'],
    ] as const)('%s: an empty continuation under the minimum token count ends the chain', async (_title, mode) => {
        installSingle({}, [msg('user', 'Hi'), msg('char', LONG_PART_ONE, { chatId: 'reply-id', saying: 'char-0' })], { autoContinueMinTokens: 10 })
        scriptReplies(mode, [''])

        await settled(() => sendChat(-1, { continue: true }))

        expect(requests()).toBe(1)
    })

    test.each(MODES)('regression reproducer: a %s reply that the incomplete-response trimming reduces to nothing ends the chain', async (mode) => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueMinTokens: 100, removeIncompleteResponse: true })
        scriptReplies(mode, ['no punctuation here'])

        await settled(() => sendChat())

        expect(requests()).toBe(1)
    })

    test.each(MODES)('regression reproducer: a %s reply of only whitespace ends the chain', async (mode) => {
        installSingle({}, [msg('user', 'Hi')], { autoContinueMinTokens: 100 })
        scriptReplies(mode, ['   '])

        await settled(() => sendChat())

        expect(requests()).toBe(1)
    })
})

describe('a multiline answer', () => {
    test('guard: a multiline continue is judged by its last message, not its first', async () => {
        installSingle({}, [msg('user', 'Hi'), msg('char', 'Part one.', { chatId: 'reply-id', saying: 'char-0' })], { autoContinueChat: true })
        let served = 0
        requestChatDataMock.mockImplementation(async () => {
            served++
            if (served === 1) {
                return { type: 'multiline', result: [['char', ' First done.'], ['char', ' last unfinished']] }
            }
            return served > MAX_REQUESTS ? { type: 'fail', result: 'runaway auto-continue chain' } : { type: 'success', result: '' }
        })

        await settled(() => sendChat(-1, { continue: true }))

        expect(requests()).toBe(2)
    })
})
