// @vitest-environment node

/**
 * What the context trim of `sendChat` must keep producing while the number of
 * `ChatTokenizer.tokenizeChat` calls it makes changes.
 *
 * - The send of a very long chat counts tokens for about as many chats as the
 *   trim keeps, not for every message of the chat (the reproducers here).
 * - `guard:` tests freeze what the base produced for the same inputs: the
 *   provider request, the text of the too-much-token error, and the
 *   `currentTokens` and chats the memory systems receive. Call counts and call
 *   order are deliberately not frozen outside the reproducer, because only the
 *   work done may change, never these outputs.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real
 * `processScriptFull` (`../scripts`), `../scriptings` (wasmoon), `../modules`,
 * `../lorebook.svelte`, `../../parser/parser.svelte` and `../chatOrigin`. Only
 * the provider request, the memory systems, the trigger engine and the
 * platform/IO packages are mocked, and the tokenizer is a deterministic
 * counting stand-in (a quarter of the content length, rounded up, plus the
 * per-chat extra), so nothing here says anything about real encoding cost or a
 * native backend. `@vitest-environment node` and the inert `dompurify` are for
 * wasmoon's sake, as in `sendChatScriptsCost.svelte.test.ts`.
 *
 * The frozen values were produced by the unchanged base. The memory-system
 * stand-ins return the chats they receive unchanged.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { COLD_TRANSFORM_HOOK_MS } from '../../tests/coldTransform.test-helpers'
import { writable, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, groupChat, Chat, Message, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import type { WorkHandle } from '../chatOrigin'
import { fillLang } from '../../../lang/fill'
import { languageEnglish } from '../../../lang/en'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): the setup file's stand-in
// throws on `undefined`, which the script pass clones.
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    request: vi.fn(),
    onAddInfo: null as null | (() => void),
    /** The content of every chat the tokenizer stand-in counted, in call order. */
    tokenCalls: [] as string[],
    /** A chat whose content holds this text is counted as NaN by the tokenizer stand-in. */
    nanMarker: null as null | string,
    /** Answers a chat's count for a test that needs a count to change between two calls; undefined falls through. */
    countOverride: null as null | ((content: string) => number | undefined),
    /** Fields the model-info stand-in returns on top of its placeholder model. */
    modelInfo: {} as Record<string, unknown>,
    /** Runs inside every model-info lookup (the send looks the model up once before the prompt loop, and once per message that holds an inlay). */
    onModelInfo: null as null | (() => void),
    /** What the Android-transport stand-in answers. */
    android: false,
}))

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

vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/path', () => ({
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })),
}))

vi.mock('src/lib/UI/PopupList.svelte', () => ({
    default: class {},
}))

// Inert passthrough: real DOMPurify needs `document`, real wasmoon needs it
// absent, and sanitization is not what this suite tests.
vi.mock('dompurify', () => ({
    default: { addHook: vi.fn(), sanitize: (html: string) => html },
}))

vi.mock(import('../../storage/tauriByteTransport'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, isAndroidTransport: () => h.android }
})

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
        CurrentTriggerIdStore: writable(null),
        ReloadChatPointer: writable({}),
        ReloadGUIPointer: writable(0),
        HideIconStore: writable(false),
        moduleBackgroundEmbedding: writable(''),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertError: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(async () => ''),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertClear: vi.fn(),
    alertModuleSelect: vi.fn(async () => -1),
    alertStore: writable({ type: '', msg: '' }),
    alertWait: vi.fn(),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    readImage: vi.fn(async () => undefined),
    aiWatermarkingLawApplies: vi.fn(() => false),
    getFileSrc: vi.fn(async () => ''),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
    AppendableBuffer: class {},
    LocalWriter: class {},
    VirtualWriter: class {},
    downloadFile: vi.fn(),
    saveAsset: vi.fn(async () => ''),
}) as unknown as typeof import('../../globalApi.svelte'))

// Deterministic counting stand-in: a chat costs a quarter of its content
// length, rounded up, plus the per-chat extra the send passes in.
vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        extra: number
        constructor(extra: number, _mode: string) { this.extra = extra }
        async tokenizeChat(chat: { content: string, multimodals?: unknown[] }) {
            h.tokenCalls.push(chat.content)
            const overridden = h.countOverride?.(chat.content)
            if (overridden !== undefined) {
                return overridden
            }
            if (h.nanMarker !== null && chat.content.includes(h.nanMarker)) {
                return NaN
            }
            // Each multimodal part costs a flat 50 on top of the text.
            return Math.ceil(chat.content.length / 4) + this.extra + (chat.multimodals?.length ?? 0) * 50
        }
    },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)),
    tokenizeNum: vi.fn(async () => [] as number[]),
}) as unknown as typeof import('../../tokenizer'))

vi.mock(import('../../characters'), () => ({
    createBlankChar: vi.fn(() => ({ name: '', chaId: '' })),
    getCharImage: vi.fn(),
}) as unknown as typeof import('../../characters'))

vi.mock(import('../command'), () => ({
    processMultiCommand: vi.fn(async () => {}),
}) as unknown as typeof import('../command'))

vi.mock(import('../files/inlays'), () => ({
    getInlayAsset: vi.fn(),
    getInlaySummary: vi.fn(),
    getInlayAssetBlob: vi.fn(async () => undefined),
    writeInlayImage: vi.fn(async () => 'inlay-id'),
}) as unknown as typeof import('../files/inlays'))

vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('../memory/hypamemory'))

vi.mock(import('../request/request'), () => ({
    requestChatData: h.request,
}) as unknown as typeof import('../request/request'))

vi.mock(import('../stableDiff'), () => ({
    stableDiff: vi.fn(),
    generateAIImage: vi.fn(async () => null),
}) as unknown as typeof import('../stableDiff'))

vi.mock(import('../../model/modellist'), () => ({
    getModelInfo: vi.fn(() => {
        h.onModelInfo?.()
        return {
            id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder',
            internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0, flags: [],
            ...h.modelInfo,
        }
    }),
    LLMFlags: { hasImageInput: 0 },
}) as unknown as typeof import('../../model/modellist'))

// The real plugin module reads `document` at load time. The script pass reads
// `pluginV2[mode]` per call, so a test adds and removes hooks on these sets.
vi.mock(import('../../plugins/plugins.svelte'), () => ({
    pluginV2: {
        editdisplay: new Set(),
        editoutput: new Set(),
        editprocess: new Set(),
        editinput: new Set(),
        chatOutput: new Set(),
        providerOptions: new Map(),
    },
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../media'), () => ({
    compressImage: vi.fn(async (v: unknown) => v),
}) as unknown as typeof import('../../media'))

vi.mock(import('../../rpack/rpack_js'), () => ({
    decodeRPack: vi.fn(async () => new Uint8Array()),
    encodeRPack: vi.fn(async () => new Uint8Array()),
}) as unknown as typeof import('../../rpack/rpack_js'))

vi.mock(import('../../interchangeability'), () => ({
    convertCharacterToModule: vi.fn(),
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('../../interchangeability'))

vi.mock(import('../../characterCards'), () => ({
    exportCharacterCard: vi.fn(),
    importCharacterProcess: vi.fn(),
}) as unknown as typeof import('../../characterCards'))

// Real-shaped selection accessors over the same mocked `DBState` and
// `selectedCharID` the send reads.
vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => {
        const current = getCurrentCharacter()
        return current?.chats?.[current.chatPage]
    }
    return {
        appVer: '0.0.0',
        presetTemplate: {},
        changeToPreset: vi.fn(),
        setCurrentChat: vi.fn(),
        setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db),
        getCurrentCharacter: vi.fn(getCurrentCharacter),
        getCurrentChat: vi.fn(getCurrentChat),
    } as unknown as typeof import('../../storage/database.svelte')
})

// Collaborators of `sendChat` that touch the network, memory systems, media or
// the trigger engine.
vi.mock(import('../../parser/chatML'), () => ({
    parseChatML: vi.fn(() => []),
}) as unknown as typeof import('../../parser/chatML'))

vi.mock(import('../exampleMessages'), () => ({
    exampleMessage: vi.fn(() => []),
}) as unknown as typeof import('../exampleMessages'))

vi.mock(import('../tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/supaMemory'), () => ({
    supaMemory: vi.fn(),
}) as unknown as typeof import('../memory/supaMemory'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('../triggers'))

vi.mock(import('../embedding/addinfo'), () => ({
    additionalInformations: vi.fn(async () => { h.onAddInfo?.(); return '' }),
}) as unknown as typeof import('../embedding/addinfo'))

vi.mock(import('../models/modelString'), () => ({
    getGenerationModelString: vi.fn(() => undefined),
}) as unknown as typeof import('../models/modelString'))

vi.mock(import('../inlayScreen'), () => ({
    runInlayScreen: vi.fn((_char: unknown, text: string) => ({ text, promise: undefined })),
}) as unknown as typeof import('../inlayScreen'))

vi.mock(import('../prereroll'), async (importOriginal) => ({
    renameContinuedMessage: (await importOriginal()).renameContinuedMessage,
    addRerolls: vi.fn(),
}) as unknown as typeof import('../prereroll'))

vi.mock(import('../transformers'), () => ({
    runImageEmbedding: vi.fn(),
}) as unknown as typeof import('../transformers'))

// Real: `../../util`, `../scripts`, `../scriptings` (wasmoon), `../modules`,
// `../lorebook.svelte`, `../../parser/parser.svelte`, `../../cbs`,
// `../../parser/chatVar.svelte`, `../chatOrigin`, `../index.svelte`.

//#endregion
//#region fixtures and helpers

type Owner = character | groupChat
type Selection = Writable<number>

interface PromptEntry {
    role: string
    content: string
}

let sendChat: typeof import('../index.svelte').sendChat
let doingChat: typeof import('../index.svelte').doingChat
let beginWork: typeof import('../chatOrigin').beginWork
let resetScriptCache: typeof import('../scripts').resetScriptCache
let refreshModules: typeof import('../modules').refreshModules
let DBState: { db: Database }
let selectedCharID: Selection
let alertErrorMock: ReturnType<typeof vi.fn>
let supaMemoryMock: ReturnType<typeof vi.fn>
let hanuraiMemoryMock: ReturnType<typeof vi.fn>
let hypaV2Mock: ReturnType<typeof vi.fn>
let hypaV3Mock: ReturnType<typeof vi.fn>
let runTriggerMock: ReturnType<typeof vi.fn>
let exampleMessageMock: ReturnType<typeof vi.fn>
let getInlayAssetMock: ReturnType<typeof vi.fn>
let getInlaySummaryMock: ReturnType<typeof vi.fn>
let alertToastMock: ReturnType<typeof vi.fn>
let providerOptions: Map<string, { tokenizer?: string }>
let editprocessHooks: Set<(data: string) => Promise<string | null>>

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const index = await import('../index.svelte')
    sendChat = index.sendChat
    doingChat = index.doingChat
    beginWork = (await import('../chatOrigin')).beginWork
    resetScriptCache = (await import('../scripts')).resetScriptCache
    refreshModules = (await import('../modules')).refreshModules
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as Selection
    alertErrorMock = (await import('../../alert')).alertError as unknown as ReturnType<typeof vi.fn>
    supaMemoryMock = (await import('../memory/supaMemory')).supaMemory as unknown as ReturnType<typeof vi.fn>
    hanuraiMemoryMock = (await import('../memory/hanuraiMemory')).hanuraiMemory as unknown as ReturnType<typeof vi.fn>
    hypaV2Mock = (await import('../memory/hypav2')).hypaMemoryV2 as unknown as ReturnType<typeof vi.fn>
    hypaV3Mock = (await import('../memory/hypav3')).hypaMemoryV3 as unknown as ReturnType<typeof vi.fn>
    runTriggerMock = (await import('../triggers')).runTrigger as unknown as ReturnType<typeof vi.fn>
    exampleMessageMock = (await import('../exampleMessages')).exampleMessage as unknown as ReturnType<typeof vi.fn>
    getInlayAssetMock = (await import('../files/inlays')).getInlayAsset as unknown as ReturnType<typeof vi.fn>
    getInlaySummaryMock = (await import('../files/inlays')).getInlaySummary as unknown as ReturnType<typeof vi.fn>
    alertToastMock = (await import('../../alert')).alertToast as unknown as ReturnType<typeof vi.fn>
    providerOptions = (await import('../../plugins/plugins.svelte')).pluginV2.providerOptions as unknown as Map<string, { tokenizer?: string }>
    editprocessHooks = (await import('../../plugins/plugins.svelte')).pluginV2.editprocess as unknown as Set<(data: string) => Promise<string | null>>
}, COLD_TRANSFORM_HOOK_MS)

function msg(role: 'user' | 'char', data: string, extra: Partial<Message> = {}): Message {
    return { role, data, time: 1, ...extra } as Message
}

function makeChat(id: string, message: Message[], extra: Record<string, unknown> = {}): Chat {
    return {
        id, note: '', name: '', localLore: [], fmIndex: -1, message,
        scriptstate: {}, GLGlobalVariables: {}, modules: [], ...extra,
    } as unknown as Chat
}

function lore(comment: string, content: string): Record<string, unknown> {
    return { comment, content, mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }
}

function regexScript(inp: string, out: string, type: 'editprocess'): Record<string, unknown> {
    return { comment: `${inp}->${out}`, in: inp, out, type, ableFlag: false }
}

function makeChar(chaId: string, name: string, chats: Chat[], extra: Record<string, unknown> = {}): character {
    return {
        chaId, name, type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: `${name} desc`, personality: '', scenario: '', bias: [], utilityBot: false,
        inlayViewScreen: false, reloadKeys: 0, supaMemory: false, customscript: [], triggerscript: [],
        globalLore: [], emotionImages: [], additionalAssets: [], modules: [], chats, ...extra,
    } as unknown as character
}

function makeGroup(chaId: string, memberIds: string[], chats: Chat[], extra: Record<string, unknown> = {}): groupChat {
    return {
        chaId, name: chaId, type: 'group', chatPage: 0, image: '', characters: [...memberIds],
        characterActive: memberIds.map((_, i) => i === 0), characterTalks: memberIds.map(() => 1),
        orderByOrder: true, reloadKeys: 0, supaMemory: false, customscript: [], globalLore: [],
        firstMessage: '', alternateGreetings: [], modules: [], emotionImages: [], defaultVariables: '',
        chats, ...extra,
    } as unknown as groupChat
}

function installDb(characters: Owner[], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        personas: [], selectedPersona: 0, characterOrder: characters.map((c) => c.chaId), characters,
        statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500,
        bias: [], mainPrompt: '', globalNote: '', jailbreakToggle: false, chainOfThought: false,
        personaPrompt: false, promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
        promptTemplate: undefined, promptInfoInsideChat: false,
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        autoContinueMinTokens: 0, autoContinueChat: false, igpPrompt: '', notification: false,
        removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off', ttsAutoSpeech: false,
        presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
        hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false,
        loreBookDepth: 20, loreBookToken: 999999, templateDefaultVariables: '', globalChatVariables: {},
        enabledModules: [], ...extra,
    } as unknown as Database
    ;(globalThis as unknown as { __risuTestDb: Database }).__risuTestDb = DBState.db
}

/** One non-streamed send; resolves to what `sendChat` returned. */
async function sendOnce(owner: Owner, chat: Chat, extraArg: Partial<SendChatArg> = {}): Promise<boolean | Error> {
    const handle = beginWork(owner, chat)!
    h.request.mockResolvedValueOnce({ type: 'success', result: 'reply' })
    try {
        return await sendChat(-1, { origin: handle.origin, originHint: { owner, chat }, ...extraArg })
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error))
    } finally {
        handle.end()
    }
}

interface RequestBody {
    formated?: PromptEntry[]
}

/** The body of the last provider request, as the provider layer receives it. */
function lastBody(): RequestBody | undefined {
    return h.request.mock.calls.at(-1)?.[0] as RequestBody | undefined
}

function hashOf(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
}

/** The request fields the prompt depends on; `currentChar`, `subject` and `chatId` are per-run objects or random ids, `mainSend` only marks the main send for the exit net, and `usageInputEstimate` only feeds the usage statistics. */
function stableBody(): unknown {
    const body = (lastBody() ?? {}) as Record<string, unknown>
    const { currentChar: _currentChar, subject: _subject, chatId: _chatId, mainSend: _mainSend, usageInputEstimate: _usageInputEstimate, ...rest } = body
    return withoutMemos(rest)
}

/** Copy of `value` without the per-run random `memo` ids the send gives its chats. */
function withoutMemos(value: unknown): unknown {
    return JSON.parse(JSON.stringify(value), (key, v) => (key === 'memo' ? undefined : v))
}

/** Hash of the stable request fields, the number of prompt entries, and their text. */
function requestFacts() {
    const body = lastBody()
    const formated = body?.formated ?? []
    return {
        bodyHash: hashOf(stableBody()),
        entries: formated.length,
        formatedHash: hashOf(withoutMemos(formated)),
    }
}

/** The text of the first message sent to the alert layer, if any. */
function alertedErrors(): string[] {
    return alertErrorMock.mock.calls.map((call) => String(call[0]))
}

interface MemoryRecord {
    currentTokens: number
    contents: string[]
}

const memoryRecords: MemoryRecord[] = []

function record(chats: Array<{ content: string }>, currentTokens: number): void {
    memoryRecords.push({ currentTokens, contents: chats.map((c) => c.content) })
}

beforeEach(() => {
    h.request.mockReset()
    h.request.mockResolvedValue({ type: 'success', result: 'unexpected' })
    h.onAddInfo = null
    h.tokenCalls.length = 0
    h.nanMarker = null
    h.countOverride = null
    h.modelInfo = {}
    h.onModelInfo = null
    h.android = false
    providerOptions.clear()
    editprocessHooks.clear()
    runTriggerMock.mockReset()
    runTriggerMock.mockImplementation(async () => undefined)
    exampleMessageMock.mockReset()
    exampleMessageMock.mockImplementation(() => [])
    getInlayAssetMock.mockReset()
    getInlaySummaryMock.mockReset()
    getInlaySummaryMock.mockImplementation(async () => ({ type: 'image', name: 'pic.png', ext: 'png', size: 1024 }))
    memoryRecords.length = 0
    alertErrorMock.mockClear()
    alertToastMock.mockClear()
    for (const fn of [supaMemoryMock, hanuraiMemoryMock, hypaV2Mock, hypaV3Mock]) {
        fn.mockReset()
    }
    supaMemoryMock.mockImplementation(async (chats: Array<{ content: string }>, currentTokens: number) => {
        record(chats, currentTokens)
        return { currentTokens, chats }
    })
    hypaV2Mock.mockImplementation(async (chats: Array<{ content: string }>, currentTokens: number) => {
        record(chats, currentTokens)
        return { currentTokens, chats }
    })
    hypaV3Mock.mockImplementation(async (chats: Array<{ content: string }>, currentTokens: number) => {
        record(chats, currentTokens)
        return { currentTokens, chats }
    })
    hanuraiMemoryMock.mockImplementation(async (chats: Array<{ content: string }>, arg: { currentTokens: number }) => {
        record(chats, arg.currentTokens)
        return { chats, tokens: arg.currentTokens }
    })
    doingChat.set(false)
    resetScriptCache()
    // `getModules` remembers its last result by module ids alone.
    refreshModules()
})

afterEach(() => {
    selectedCharID.set(-1)
    h.onAddInfo = null
    h.nanMarker = null
    h.countOverride = null
    h.modelInfo = {}
    h.onModelInfo = null
})

/** About 100 bytes of deterministic text, tagged with the message number. */
function body100(i: number): string {
    return `[M${String(i).padStart(4, '0')}] ` + 'lorem ipsum dolor sit amet '.repeat(4)
}

/** About 500 bytes of deterministic text, tagged with the message number. */
function body500(i: number): string {
    return `[M${String(i).padStart(4, '0')}] ` + 'lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(9)
}

function alternating(count: number, make: (i: number) => string): Message[] {
    return Array.from({ length: count }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', make(i)))
}

//#endregion

//#region frozen base values

/** Compares `actual` with the value the unchanged base produced for `key`. */
function expectFrozen(key: string, actual: unknown): void {
    expect(actual).toEqual(FROZEN[key])
}

const FROZEN: Record<string, unknown> = {
    'long': {
        bodyHash: '1e80300d9abe631b',
        entries: 22,
        formatedHash: '4a091883b8e6fd34',
    },
    'a': {
        bodyHash: '61911236c6f211a5',
        entries: 29,
        formatedHash: 'a78cc7515f7dd5cb',
        keptCount: 27,
        keptFirst: 34,
        keptLast: 60,
        readerEntry: '[M0057] ~~~~ got=null plain=p1',
        depthEntryIndex: 3,
    },
    'b': {
        bodyHash: '61911236c6f211a5',
        entries: 29,
        formatedHash: 'a78cc7515f7dd5cb',
        keptCount: 27,
        keptFirst: 34,
        keptLast: 60,
        readerEntry: '[M0057] ~~~~ got=null plain=p1',
        depthEntryIndex: 3,
    },
    'sweep-false': {
        '1000': {
            count: 12,
            first: 49,
            hash: '6dba78d9c498bca3',
        },
        '1010': {
            count: 12,
            first: 49,
            hash: '6dba78d9c498bca3',
        },
        '1020': {
            count: 13,
            first: 48,
            hash: '1d152129b21cdccf',
        },
        '1030': {
            count: 13,
            first: 48,
            hash: '1d152129b21cdccf',
        },
        '1040': {
            count: 13,
            first: 48,
            hash: '1d152129b21cdccf',
        },
        '1050': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1060': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1070': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1080': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1090': {
            count: 15,
            first: 46,
            hash: '791089be44b07c01',
        },
        '1100': {
            count: 15,
            first: 46,
            hash: '791089be44b07c01',
        },
        '1110': {
            count: 15,
            first: 46,
            hash: '791089be44b07c01',
        },
        '1120': {
            count: 16,
            first: 45,
            hash: '908de172927e9e68',
        },
        '1130': {
            count: 16,
            first: 45,
            hash: '908de172927e9e68',
        },
        '1140': {
            count: 16,
            first: 45,
            hash: '908de172927e9e68',
        },
        '1150': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1160': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1170': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1180': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1190': {
            count: 18,
            first: 43,
            hash: 'cf0ad688f3681f39',
        },
        '1200': {
            count: 18,
            first: 43,
            hash: 'cf0ad688f3681f39',
        },
        '1210': {
            count: 18,
            first: 43,
            hash: 'cf0ad688f3681f39',
        },
        '1220': {
            count: 19,
            first: 42,
            hash: '4af625d6a49cc6bb',
        },
        '1230': {
            count: 19,
            first: 42,
            hash: '4af625d6a49cc6bb',
        },
    },
    'sweep-true': {
        '1000': {
            count: 12,
            first: 49,
            hash: '6dba78d9c498bca3',
        },
        '1010': {
            count: 12,
            first: 49,
            hash: '6dba78d9c498bca3',
        },
        '1020': {
            count: 12,
            first: 49,
            hash: '6dba78d9c498bca3',
        },
        '1030': {
            count: 13,
            first: 48,
            hash: '1d152129b21cdccf',
        },
        '1040': {
            count: 13,
            first: 48,
            hash: '1d152129b21cdccf',
        },
        '1050': {
            count: 13,
            first: 48,
            hash: '1d152129b21cdccf',
        },
        '1060': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1070': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1080': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1090': {
            count: 14,
            first: 47,
            hash: '2d9169d411b795d0',
        },
        '1100': {
            count: 15,
            first: 46,
            hash: '791089be44b07c01',
        },
        '1110': {
            count: 15,
            first: 46,
            hash: '791089be44b07c01',
        },
        '1120': {
            count: 15,
            first: 46,
            hash: '791089be44b07c01',
        },
        '1130': {
            count: 16,
            first: 45,
            hash: '908de172927e9e68',
        },
        '1140': {
            count: 16,
            first: 45,
            hash: '908de172927e9e68',
        },
        '1150': {
            count: 16,
            first: 45,
            hash: '908de172927e9e68',
        },
        '1160': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1170': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1180': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1190': {
            count: 17,
            first: 44,
            hash: 'd7e0946814102cd2',
        },
        '1200': {
            count: 18,
            first: 43,
            hash: 'cf0ad688f3681f39',
        },
        '1210': {
            count: 18,
            first: 43,
            hash: 'cf0ad688f3681f39',
        },
        '1220': {
            count: 18,
            first: 43,
            hash: 'cf0ad688f3681f39',
        },
        '1230': {
            count: 19,
            first: 42,
            hash: '4af625d6a49cc6bb',
        },
    },
    'f': {
        bodyHash: '61911236c6f211a5',
        entries: 29,
        formatedHash: 'a78cc7515f7dd5cb',
        keptCount: 27,
        keptFirst: 34,
        keptLast: 60,
        readerEntry: '[M0057] ~~~~ got=null plain=p1',
        depthEntryIndex: 3,
    },
    'flagsOnly': {
        bodyHash: '61911236c6f211a5',
        entries: 29,
        formatedHash: 'a78cc7515f7dd5cb',
        keptCount: 27,
        keptFirst: 34,
        keptLast: 60,
        readerEntry: '[M0057] ~~~~ got=null plain=p1',
        depthEntryIndex: 3,
    },
    'c': {
        result: false,
        alerts: ["Error: The minimum required token is greater than the Max Context Size.\n\nRequired Tokens: 592"],
    },
    'd': {
        bodyHash: 'f824218ccb9a62fd',
        entries: 22,
        formatedHash: 'dcf5afe75512f8d8',
        keptCount: 20,
        keptFirst: 41,
        keptLast: 60,
        readerEntry: '[M0057] ~~~lorem ipsum dolor sit amet',
        depthEntryIndex: -1,
    },
    'e-hypaV3': {
        currentTokens: 2669,
        chatCount: 63,
        chatsHash: '76420c8c410b0ebd',
        firstChat: '[Start a new chat]',
        lastChat: '[M0060] lore',
        request: {
            bodyHash: '5777735bd377accb',
            entries: 45,
            formatedHash: '3144705619a53957',
            keptCount: 43,
            keptFirst: 18,
            keptLast: 60,
            readerEntry: '[M0057] ~~~~ got=null plain=p1',
            depthEntryIndex: 1,
        },
    },
    'e-hypav2': {
        currentTokens: 2669,
        chatCount: 63,
        chatsHash: '76420c8c410b0ebd',
        firstChat: '[Start a new chat]',
        lastChat: '[M0060] lore',
        request: {
            bodyHash: '5777735bd377accb',
            entries: 45,
            formatedHash: '3144705619a53957',
            keptCount: 43,
            keptFirst: 18,
            keptLast: 60,
            readerEntry: '[M0057] ~~~~ got=null plain=p1',
            depthEntryIndex: 1,
        },
    },
    'e-hanurai': {
        currentTokens: 2669,
        chatCount: 63,
        chatsHash: '76420c8c410b0ebd',
        firstChat: '[Start a new chat]',
        lastChat: '[M0060] lore',
        request: {
            bodyHash: '5777735bd377accb',
            entries: 45,
            formatedHash: '3144705619a53957',
            keptCount: 43,
            keptFirst: 18,
            keptLast: 60,
            readerEntry: '[M0057] ~~~~ got=null plain=p1',
            depthEntryIndex: 1,
        },
    },
    'e-supaMemory': {
        currentTokens: 2669,
        chatCount: 63,
        chatsHash: '76420c8c410b0ebd',
        firstChat: '[Start a new chat]',
        lastChat: '[M0060] lore',
        request: {
            bodyHash: '5777735bd377accb',
            entries: 45,
            formatedHash: '3144705619a53957',
            keptCount: 43,
            keptFirst: 18,
            keptLast: 60,
            readerEntry: '[M0057] ~~~~ got=null plain=p1',
            depthEntryIndex: 1,
        },
    },
    'step-false': [
        {
            from: 1000,
            count: 13,
            first: 48,
            hash: '560de24ec47c2342',
        },
        {
            from: 1034,
            count: 14,
            first: 47,
            hash: 'c138bbb8caa30151',
        },
        {
            from: 1068,
            count: 15,
            first: 46,
            hash: 'e21d0b7d8ac4423e',
        },
        {
            from: 1102,
            count: 16,
            first: 45,
            hash: '54d7b14feb6db8c3',
        },
        {
            from: 1136,
            count: 17,
            first: 44,
            hash: 'b72bd5b59a578e35',
        }
    ],
    'step-true': [
        {
            from: 1000,
            count: 12,
            first: 49,
            hash: '88ad1e3eb1bf83dd',
        },
        {
            from: 1010,
            count: 13,
            first: 48,
            hash: '560de24ec47c2342',
        },
        {
            from: 1044,
            count: 14,
            first: 47,
            hash: 'c138bbb8caa30151',
        },
        {
            from: 1078,
            count: 15,
            first: 46,
            hash: 'e21d0b7d8ac4423e',
        },
        {
            from: 1112,
            count: 16,
            first: 45,
            hash: '54d7b14feb6db8c3',
        },
        {
            from: 1146,
            count: 17,
            first: 44,
            hash: 'b72bd5b59a578e35',
        }
    ],
    'template': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '72a4f312bee61a71',
        entries: 35,
        formatedHash: '893c8e74495830cc',
        keptCount: 31,
        keptFirst: 35,
        keptLast: 37,
        memory: []
    },
    'legacy': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'f4c7ca5d6cc7e809',
        entries: 29,
        formatedHash: '0c41d2449597a58a',
        keptCount: 26,
        keptFirst: 35,
        keptLast: 60,
        memory: []
    },
    'examples-kept whole': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '9006871c193c635e',
        entries: 66,
        formatedHash: 'fd5c091bf471a8a8',
        keptCount: 61,
        keptFirst: 0,
        keptLast: 60,
        memory: []
    },
    'examples-popped with the oldest chats, [Start a new chat] counted': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '3c793fa1fd9c848f',
        entries: 28,
        formatedHash: 'ee7976ad331f8b69',
        keptCount: 27,
        keptFirst: 34,
        keptLast: 60,
        memory: []
    },
    'examples-popped with the oldest chats, no [Start a new chat]': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '3c793fa1fd9c848f',
        entries: 28,
        formatedHash: 'ee7976ad331f8b69',
        keptCount: 27,
        keptFirst: 34,
        keptLast: 60,
        memory: []
    },
    'inlay': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '23845e450d4494cf',
        entries: 27,
        formatedHash: 'c3cac22bfae01587',
        keptCount: 26,
        keptFirst: 35,
        keptLast: 60,
        memory: []
    },
    'novelai': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'c08e660b9cafe779',
        entries: 30,
        formatedHash: 'ad5f27d7c14cb6a6',
        keptCount: 29,
        keptFirst: 32,
        keptLast: 60,
        memory: []
    },
    'trigger-37': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '45bd53ea1d4530b4',
        entries: 29,
        formatedHash: 'd24b73874e575f39',
        keptCount: 26,
        keptFirst: 35,
        keptLast: 60,
        memory: []
    },
    'trigger-300': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '7e6de8105c4b345e',
        entries: 21,
        formatedHash: '57efd2253e843fe8',
        keptCount: 18,
        keptFirst: 43,
        keptLast: 60,
        memory: []
    },
    'continue': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '4b7818814a9367bd',
        entries: 29,
        formatedHash: '72117d3895841116',
        keptCount: 27,
        keptFirst: 35,
        keptLast: 61,
        memory: []
    },
    'tokenizer-plugin provider with its own tokenizer': {
        trimmed: {
            result: true,
            alerts: [],
            requested: true,
            bodyHash: 'c08e660b9cafe779',
            entries: 30,
            formatedHash: 'ad5f27d7c14cb6a6',
            keptCount: 29,
            keptFirst: 32,
            keptLast: 60,
            memory: []
        },
        remembered: {
            result: true,
            alerts: [],
            requested: true,
            bodyHash: '63b18432bf3f1d09',
            entries: 47,
            formatedHash: '3a1db83e7c805a37',
            keptCount: 46,
            keptFirst: 15,
            keptLast: 60,
            memory: [
                {
                    currentTokens: 2519,
                    chatCount: 63,
                    chatsHash: 'fc37ce892f1a97f9',
                    firstChat: '[Start a new chat]',
                    lastChat: '[M0060] lore'
                }
            ]
        }
    },
    'tokenizer-Google Cloud tokenizing with googleClaudeTokenizing': {
        trimmed: {
            result: true,
            alerts: [],
            requested: true,
            bodyHash: '3c793fa1fd9c848f',
            entries: 28,
            formatedHash: 'ee7976ad331f8b69',
            keptCount: 27,
            keptFirst: 34,
            keptLast: 60,
            memory: []
        },
        remembered: {
            result: true,
            alerts: [],
            requested: true,
            bodyHash: '751d4059f6d7d26d',
            entries: 44,
            formatedHash: 'ceebbe0b6166360c',
            keptCount: 43,
            keptFirst: 18,
            keptLast: 60,
            memory: [
                {
                    currentTokens: 2649,
                    chatCount: 63,
                    chatsHash: 'fc37ce892f1a97f9',
                    firstChat: '[Start a new chat]',
                    lastChat: '[M0060] lore'
                }
            ]
        }
    },
    'tokenizer-local tokenizer': {
        trimmed: {
            result: true,
            alerts: [],
            requested: true,
            bodyHash: '3c793fa1fd9c848f',
            entries: 28,
            formatedHash: 'ee7976ad331f8b69',
            keptCount: 27,
            keptFirst: 34,
            keptLast: 60,
            memory: []
        },
        remembered: {
            result: true,
            alerts: [],
            requested: true,
            bodyHash: '751d4059f6d7d26d',
            entries: 44,
            formatedHash: 'ceebbe0b6166360c',
            keptCount: 43,
            keptFirst: 18,
            keptLast: 60,
            memory: [
                {
                    currentTokens: 2649,
                    chatCount: 63,
                    chatsHash: 'fc37ce892f1a97f9',
                    firstChat: '[Start a new chat]',
                    lastChat: '[M0060] lore'
                }
            ]
        }
    },
    'nan-local': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'b9fcd63e68adb07f',
        entries: 64,
        formatedHash: 'c0bbd3ec3e78b34b',
        keptCount: 61,
        keptFirst: 0,
        keptLast: 60,
        memory: []
    },
    'nan-default': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'b9fcd63e68adb07f',
        entries: 64,
        formatedHash: 'c0bbd3ec3e78b34b',
        keptCount: 61,
        keptFirst: 0,
        keptLast: 60,
        memory: []
    },
    'fraction-error': {
        result: false,
        alerts: [
            "Error: The minimum required token is greater than the Max Context Size.\n\nRequired Tokens: 105.10000000000002"
        ],
        requested: false,
        memory: []
    },
    'fraction-trim': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'fecebbdf00e3dbca',
        entries: 43,
        formatedHash: 'e733897ec42a4862',
        keptCount: 42,
        keptFirst: 19,
        keptLast: 60,
        memory: []
    },
    'gate-flip': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '751d4059f6d7d26d',
        entries: 44,
        formatedHash: 'ceebbe0b6166360c',
        keptCount: 43,
        keptFirst: 18,
        keptLast: 60,
        memory: [
            {
                currentTokens: 2649,
                chatCount: 63,
                chatsHash: 'fc37ce892f1a97f9',
                firstChat: '[Start a new chat]',
                lastChat: '[M0060] lore'
            }
        ]
    },
    'empty-true': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'eca6f705832a9a6b',
        entries: 1,
        formatedHash: '829cc0b147e02c10',
        keptCount: 0,
        memory: []
    },
    'empty-group-true': {
        result: "Cannot read properties of undefined (reading 'memo')",
        alerts: [],
        requested: false,
        memory: []
    },
    'empty-false': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: '4ef983d06f1791b8',
        entries: 2,
        formatedHash: '46afa5e60d31d96c',
        keptCount: 0,
        memory: []
    },
    'empty-group-false': {
        result: true,
        alerts: [],
        requested: true,
        bodyHash: 'bcf7f51a1cd9341b',
        entries: 3,
        formatedHash: '69f1d5bbd71b03ac',
        keptCount: 0,
        memory: []
    },
}

//#endregion

/** Message numbers (the `[Mnnnn]` tag) present in the last request's prompt, in order. */
function keptNumbers(): number[] {
    const formated = lastBody()?.formated ?? []
    const out: number[] = []
    for (const entry of formated) {
        for (const match of entry.content.matchAll(/\[M(\d{4})\]/g)) {
            out.push(Number(match[1]))
        }
    }
    return out
}

const LONG_MAX_CONTEXT = 3500
const LONG_KEPT = 21

describe('the send of a very long chat', () => {
    const TOTAL = 3000
    const KEEP_WINDOW = 20

    /** A chat of `count` ~500 B messages, numbered from `first`, sent with a context that holds about `KEEP_WINDOW` of them. */
    async function sendLong(first: number, count: number, maxContext: number): Promise<void> {
        const messages = Array.from({ length: count }, (_, k) => {
            const i = first + k
            return msg(i % 2 === 0 ? 'user' : 'char', body500(i))
        })
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)])
        installDb([A], { maxContext })
        selectedCharID.set(0)
        h.tokenCalls.length = 0
        const result = await sendOnce(A, A.chats[0])
        expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
    }

    test('regression reproducer: a 3,000-message chat keeps the newest messages and counts tokens for about as many chats as it keeps', async () => {
        const maxContext = LONG_MAX_CONTEXT
        // The cost of the same send when nothing has to be dropped: the
        // newest window only, no trim.
        await sendLong(TOTAL - KEEP_WINDOW, KEEP_WINDOW, 999999)
        const windowOnlyCalls = h.tokenCalls.length

        await sendLong(0, TOTAL, maxContext)
        const calls = h.tokenCalls.length
        const kept = keptNumbers()

        expect(kept.length).toBe(LONG_KEPT)
        expect(kept[0]).toBe(TOTAL - LONG_KEPT)
        expect(kept.at(-1)).toBe(TOTAL - 1)
        expect(kept).toEqual(Array.from({ length: LONG_KEPT }, (_, k) => TOTAL - LONG_KEPT + k))
        expectFrozen('long', requestFacts())
        // Last on purpose: the equivalence checks above run even when this fails.
        expect(calls, `tokenizeChat was called ${calls} times for a ${TOTAL}-message chat; the window-only send makes ${windowOnlyCalls}`)
            .toBeLessThanOrEqual(windowOnlyCalls + 5)
    })
})

describe('guard: the request the trim produces is the one the base produced', () => {
    const SCRIPTED_MAX_CONTEXT = 1500
    const COUNT = 61

    /** 61 messages; an old one writes a chat variable through a regex script, a newer one reads it. */
    function scriptedMessages(): Message[] {
        return Array.from({ length: COUNT }, (_, i) => {
            let data = body100(i)
            if (i === 2) {
                data += ' SETME'
            }
            if (i === 4) {
                data += ' {{setvar::plain::p1}}'
            }
            if (i === 57) {
                data += ' got={{getvar::flag}} plain={{getvar::plain}}'
            }
            return msg(i % 2 === 0 ? 'user' : 'char', data)
        })
    }

    function scriptedChar(extra: Record<string, unknown> = {}): character {
        return makeChar('char-A', 'Alice', [makeChat('chat-A', scriptedMessages())], {
            customscript: [regexScript('SETME', '{{setvar::flag::on}}', 'editprocess')],
            globalLore: [lore('depth-entry', '@@depth 2\nLOREDEPTH')],
            ...extra,
        })
    }

    function facts() {
        const kept = keptNumbers()
        const formated = lastBody()?.formated ?? []
        return {
            ...requestFacts(),
            keptCount: kept.length,
            keptFirst: kept[0],
            keptLast: kept.at(-1),
            readerEntry: String(withoutMemos(formated.find((e) => e.content.includes('[M0057]'))?.content ?? '')).replace(/lorem ipsum dolor sit amet /g, '~'),
            depthEntryIndex: formated.findIndex((e) => e.content.includes('LOREDEPTH')),
        }
    }

    async function runScripted(extraDb: Record<string, unknown>, charExtra: Record<string, unknown> = {}): Promise<character> {
        const A = scriptedChar(charExtra)
        installDb([A], { maxContext: SCRIPTED_MAX_CONTEXT, ...extraDb })
        selectedCharID.set(0)
        const result = await sendOnce(A, A.chats[0])
        expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
        return A
    }

    test('guard: no memory, a chat variable written in a dropped message is read by a kept one, and a depth lorebook entry', async () => {
        await runScripted({})
        // The writer (message 4) is dropped by the trim, the reader (message 57) is kept.
        expect(keptNumbers()[0]).toBeGreaterThan(4)
        expect(facts().readerEntry).toContain('plain=p1')
        expectFrozen('a', facts())
    })

    test('guard: the same with promptSettings.trimStartNewChat set', async () => {
        await runScripted({ promptSettings: { trimStartNewChat: true } })
        expectFrozen('b', facts())
    })


    // Each maxContext decides how many of the oldest chats the trim pops, so a
    // sweep across a range pins every pop-count decision, including the one
    // the uncounted [Start a new chat] chat takes part in.
    for (const trimStartNewChat of [false, true]) {
        test(`guard: sweeping maxContext keeps the same messages (trimStartNewChat ${trimStartNewChat})`, async () => {
            const kept: Record<number, { count: number, first: number, hash: string }> = {}
            for (let maxContext = 1000; maxContext <= 1230; maxContext += 10) {
                h.request.mockReset()
                h.tokenCalls.length = 0
                await runScripted({ maxContext, promptSettings: { trimStartNewChat } })
                const numbers = keptNumbers()
                kept[maxContext] = { count: numbers.length, first: numbers[0], hash: requestFacts().formatedHash }
            }
            expectFrozen(`sweep-${trimStartNewChat}`, kept)
        })
    }

    test('guard: the same with useTokenizerCaching on', async () => {
        await runScripted({ useTokenizerCaching: true })
        expectFrozen('f', facts())
    })

    test('guard: memory flags set while the character has no memory still take the trim path', async () => {
        await runScripted({ hypaV3: true, hypav2: true, hanuraiEnable: true, supaModelType: 'distilbart' })
        expect(memoryRecords).toEqual([])
        expectFrozen('flagsOnly', facts())
    })

    test('guard: a context that holds not even one message reports the too-much-token error with the required tokens', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', alternating(5, body100))])
        installDb([A], { maxContext: 100 })
        selectedCharID.set(0)
        const result = await sendOnce(A, A.chats[0])
        expect(h.request).not.toHaveBeenCalled()
        expectFrozen('c', { result: result instanceof Error ? result.message : result, alerts: alertedErrors() })
    })

    test('guard: a group chat sends the same request', async () => {
        const group = makeGroup('group-1', ['member-a', 'member-b'], [makeChat('chat-G', Array.from({ length: COUNT }, (_, i) => {
            return msg(i % 2 === 0 ? 'user' : 'char', body100(i), { saying: i % 2 === 0 ? undefined : (i % 4 === 1 ? 'member-a' : 'member-b') })
        }))])
        const memberA = makeChar('member-a', 'Ann', [makeChat('chat-a', [])])
        const memberB = makeChar('member-b', 'Bob', [makeChat('chat-b', [])])
        installDb([group, memberA, memberB], { maxContext: SCRIPTED_MAX_CONTEXT })
        selectedCharID.set(0)
        const result = await sendOnce(group, group.chats[0])
        expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
        expect(h.request).toHaveBeenCalledTimes(1)
        expectFrozen('d', facts())
    })

    const modes: Array<[string, Record<string, unknown>, () => ReturnType<typeof vi.fn>]> = [
        ['hypaV3', { hypaV3: true }, () => hypaV3Mock],
        ['hypav2', { hypav2: true }, () => hypaV2Mock],
        ['hanurai', { hanuraiEnable: true }, () => hanuraiMemoryMock],
        ['supaMemory', { supaModelType: 'distilbart' }, () => supaMemoryMock],
    ]

    for (const [name, flags, mock] of modes) {
        test(`guard: memory mode ${name} receives the same currentTokens and chats and the request is the same`, async () => {
            await runScripted(flags, { supaMemory: true })
            expect(mock()).toHaveBeenCalledTimes(1)
            expect(memoryRecords).toHaveLength(1)
            const [rec] = memoryRecords
            expectFrozen(`e-${name}`, {
                currentTokens: rec.currentTokens,
                chatCount: rec.contents.length,
                chatsHash: hashOf(rec.contents),
                firstChat: rec.contents[0],
                lastChat: rec.contents.at(-1)?.slice(0, 12),
                request: facts(),
            })
        })
    }

    // ChroMemory's shadow runs on the send, after the engine-off trim, and only
    // counts and records: the sent prompt, the chats and lastMemory are those of
    // the same send with no engine.
    describe('the ChroMemory shadow on the send path', () => {
        let tokenizeMock: ReturnType<typeof vi.fn>
        let shadow: typeof import('../memory/chroMemory/shadow')
        let header: string
        const countByLength = async (s: string) => (s?.length ?? 0)

        beforeAll(async () => {
            tokenizeMock = (await import('../../tokenizer')).tokenize as unknown as ReturnType<typeof vi.fn>
            shadow = await import('../memory/chroMemory/shadow')
            header = (await import('../memory/chroMemory/pack')).HEADER
        })

        beforeEach(() => {
            shadow.resetChroMemoryShadowForTests()
            tokenizeMock.mockClear()
            tokenizeMock.mockImplementation(countByLength)
        })

        const isShadowText = (call: unknown[]): boolean => {
            const text = String(call[0])
            return text.startsWith(header) || text.startsWith('[#') || text.startsWith('<Previous Conversation>')
        }

        const forms: Array<[string, Record<string, unknown>, () => void]> = [
            ['the default counter', {}, () => {}],
            ['a plugin tokenizer with varying counts', { aiModel: 'custom', currentPluginProvider: 'plug' }, () => {
                providerOptions.set('plug', { tokenizer: 'custom' })
            }],
        ]

        /** The sent chat as the send mutates it, read through DBState. */
        function sentChat(): Chat {
            return (DBState.db.characters[0] as character).chats[0]
        }

        function lastMemoryPosition(chat: Chat): number {
            return chat.message.findIndex((m) => m.chatId === chat.lastMemory)
        }

        async function sendScripted(db: Record<string, unknown>, charExtra: Record<string, unknown>) {
            await runScripted(db, charExtra)
            const chat = sentChat()
            return {
                facts: facts(),
                kept: keptNumbers(),
                helloSent: (lastBody()?.formated ?? []).some((e) => e.content.includes('Hello!')),
                lastMemoryAt: lastMemoryPosition(chat),
                chat,
                trace: shadow.getLastChroMemoryTrace(),
            }
        }

        for (const [name, flags, mock] of modes) {
            test(`reproducer: ltmEngine takes the chats from memory mode ${name}, which is not called, and the request is the no-engine one`, async () => {
                await runScripted({}, { supaMemory: true })
                const noEngine = facts()
                h.request.mockReset()
                await runScripted({ ...flags, ltmEngine: true, ltmSettings: { shadow: true } }, { supaMemory: true })
                expect(mock()).not.toHaveBeenCalled()
                expect(memoryRecords).toEqual([])
                expect(facts()).toEqual(noEngine)
            })
        }

        for (const [label, formDb, setup] of forms) {
            test(`ltmEngine shadow with ${label}: the send is the no-engine send and the trace holds the dropped chats`, async () => {
                setup()
                const off = await sendScripted({ ...formDb }, { supaMemory: true })
                expect(shadow.getLastChroMemoryTrace()).toBeNull()
                h.request.mockReset()
                const on = await sendScripted({ ...formDb, ltmEngine: true, ltmSettings: { shadow: true } }, { supaMemory: true })

                expect(on.facts).toEqual(off.facts)
                expect(on.lastMemoryAt).toBe(off.lastMemoryAt)
                expect(on.lastMemoryAt).toBeGreaterThan(-1)

                const first = on.kept[0]
                expect(first).toBeGreaterThan(4)
                expect(on.helloSent).toBe(false)
                const trace = on.trace!
                expect(trace).not.toBeNull()
                expect(['packed', 'nothing-packed']).toContain(trace.outcome)
                expect(trace.d0.records).toBe(first + 1)
                expect(trace.d0.firstChatId).toBe('#first')
                expect(trace.d0.lastChatId).toBe(on.chat.message[first - 1].chatId)
                expect(trace.query?.chatId).toBe(on.chat.message[COUNT - 1].chatId)
                if (formDb.aiModel) {
                    expect(trace.counted).toBeLessThanOrEqual(12)
                    expect(trace.countCap).toBe(12)
                }
            })

            test(`ltmEngine shadow with ${label}: a throwing count is traced as error and the send is the no-engine send`, async () => {
                setup()
                const off = await sendScripted({ ...formDb }, { supaMemory: true })
                h.request.mockReset()
                tokenizeMock.mockImplementation(async (s: string) => {
                    if (String(s).startsWith(header) || String(s).startsWith('<Previous Conversation>')) {
                        throw new Error('count failed')
                    }
                    return countByLength(s)
                })
                try {
                    const on = await sendScripted({ ...formDb, ltmEngine: true, ltmSettings: { shadow: true } }, { supaMemory: true })
                    expect(on.facts).toEqual(off.facts)
                    expect(on.lastMemoryAt).toBe(off.lastMemoryAt)
                    expect(on.trace?.outcome).toBe('error')
                } finally {
                    tokenizeMock.mockImplementation(countByLength)
                }
            })
        }

        test('SL5C guard (passes on the shadow base): a continue send queries the newest captured message and D0 ends at the last dropped one', async () => {
            const messages = Array.from({ length: COUNT + 1 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', body100(i)))
            const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)], { supaMemory: true })
            installDb([A], { maxContext: SCRIPTED_MAX_CONTEXT, ltmEngine: true, ltmSettings: { shadow: true } })
            selectedCharID.set(0)
            const result = await sendOnce(A, A.chats[0], { continue: true })
            expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
            const chat = sentChat()
            const first = keptNumbers()[0]
            expect(first).toBeGreaterThan(4)
            const trace = shadow.getLastChroMemoryTrace()!
            // The continued message itself is not in the message loop's capture: the query is the newest message before it.
            const queried = (lastBody()?.formated ?? []).find((e) => (e as { memo?: string }).memo === trace.query?.chatId)
            expect(queried?.content).toContain(`[M${String(COUNT).padStart(4, '0')}]`)
            expect(trace.d0.records).toBe(first + 1)
            expect(trace.d0.lastChatId).toBe(chat.message[first - 1].chatId)
        })

        test('BT1 guard: ltmSettings.budgetTokens bounds the block and is the traced budget', async () => {
            const on = await sendScripted({ ltmEngine: true, ltmSettings: { shadow: true, budgetTokens: 300 } }, { supaMemory: true })
            const trace = on.trace!
            expect(trace.budgetTokens).toBe(300)
            expect(trace.T).toBeLessThanOrEqual(300)
        })

        test('guard: ltmEngine with the character memory off runs no shadow and the send is the no-engine send', async () => {
            const off = await sendScripted({}, { supaMemory: false })
            h.request.mockReset()
            tokenizeMock.mockClear()
            const on = await sendScripted({ ltmEngine: true }, { supaMemory: false })
            expect(on.facts).toEqual(off.facts)
            expect(shadow.getLastChroMemoryTrace()).toBeNull()
            expect(tokenizeMock.mock.calls.filter(isShadowText)).toEqual([])
        })

        test('ltmEngine shadow on a group chat: the query is the newest message and D0 ends at the last dropped one', async () => {
            const build = () => makeGroup('group-1', ['member-a', 'member-b'], [makeChat('chat-G', Array.from({ length: COUNT }, (_, i) => {
                return msg(i % 2 === 0 ? 'user' : 'char', body100(i), { saying: i % 2 === 0 ? undefined : (i % 4 === 1 ? 'member-a' : 'member-b') })
            }))], { supaMemory: true })
            const run = async (extra: Record<string, unknown>) => {
                const group = build()
                installDb([group, makeChar('member-a', 'Ann', [makeChat('chat-a', [])]), makeChar('member-b', 'Bob', [makeChat('chat-b', [])])], { maxContext: SCRIPTED_MAX_CONTEXT, ...extra })
                selectedCharID.set(0)
                const result = await sendOnce(group, group.chats[0])
                expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
                return { facts: facts(), chat: (DBState.db.characters[0] as unknown as groupChat).chats[0] }
            }
            const off = await run({})
            h.request.mockReset()
            const on = await run({ ltmEngine: true, ltmSettings: { shadow: true } })
            expect(on.facts).toEqual(off.facts)
            const first = keptNumbers()[0]
            expect(first).toBeGreaterThan(4)
            const trace = shadow.getLastChroMemoryTrace()!
            expect(['packed', 'nothing-packed']).toContain(trace.outcome)
            expect(trace.d0.lastChatId).toBe(on.chat.message[first - 1].chatId)
            expect(trace.query?.chatId).toBe(on.chat.message[COUNT - 1].chatId)
        })

        test('a 3,000-message chat: the shadow counts at most 64 texts, adds no chat count, and the send is unchanged', async () => {
            const send = async (extraDb: Record<string, unknown>, charExtra: Record<string, unknown>) => {
                const messages = Array.from({ length: 3000 }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', body500(i)))
                const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)], charExtra)
                installDb([A], { maxContext: LONG_MAX_CONTEXT, ...extraDb })
                selectedCharID.set(0)
                h.tokenCalls.length = 0
                tokenizeMock.mockClear()
                h.request.mockReset()
                const result = await sendOnce(A, A.chats[0])
                expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
                return {
                    chatCalls: h.tokenCalls.length,
                    tokenizeCalls: tokenizeMock.mock.calls.length,
                    shadowCalls: tokenizeMock.mock.calls.filter(isShadowText).length,
                    kept: keptNumbers(),
                    facts: requestFacts(),
                }
            }
            const off = await send({}, { supaMemory: true })
            expect(shadow.getLastChroMemoryTrace()).toBeNull()
            const on = await send({ ltmEngine: true, ltmSettings: { shadow: true } }, { supaMemory: true })
            const trace = shadow.getLastChroMemoryTrace()!
            expect(trace.d0.units).toBeGreaterThanOrEqual(2000)
            expect(trace.countCapped).toBe(true)
            expect(trace.counted).toBeLessThanOrEqual(64)
            expect(on.shadowCalls).toBeLessThanOrEqual(64)
            expect(on.tokenizeCalls - on.shadowCalls).toBe(off.tokenizeCalls)
            expect(on.chatCalls).toBe(off.chatCalls)
            expect(on.kept).toEqual(off.kept)
            expect(on.facts).toEqual(off.facts)
        })

        // The injection: with ChroMemory on and `shadow` not set, a send that recalls
        // something carries one memory message and evicts only what it needs.
        describe('the injection', () => {
            const EXTRA = 5
            const ceil4 = async (s: string) => Math.ceil((s?.length ?? 0) / 4)
            const isMemory = (e: PromptEntry) => (e as { memo?: string }).memo === 'supaMemory'

            beforeEach(() => tokenizeMock.mockImplementation(ceil4))
            afterEach(() => tokenizeMock.mockImplementation(countByLength))

            const entries = () => lastBody()?.formated ?? []
            const memoryEntries = () => entries().filter(isMemory)
            const keptMessages = () => entries().filter((e) => !isMemory(e)).flatMap((e) => [...e.content.matchAll(/\[M(\d{4})\]/g)].map((m) => Number(m[1])))
            const requestTokens = () => entries().reduce((sum, e) => sum + Math.ceil(e.content.length / 4) + EXTRA, 0)

            /** Messages whose oldest and newest share a planted rare term, so the newest query recalls the oldest. */
            function zebraMessages(count: number = COUNT): Message[] {
                return Array.from({ length: count }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', body100(i) + (i === 2 || i === count - 1 ? ' zebrafish' : '')))
            }

            async function sendWith(db: Record<string, unknown>, charExtra: Record<string, unknown> = {}, messages: Message[] = zebraMessages()) {
                const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)], { supaMemory: true, ...charExtra })
                installDb([A], { maxContext: SCRIPTED_MAX_CONTEXT, ...db })
                selectedCharID.set(0)
                h.request.mockReset()
                shadow.resetChroMemoryShadowForTests()
                const result = await sendOnce(A, A.chats[0])
                const chat = sentChat()
                return {
                    ok: result === true,
                    result,
                    chat,
                    trace: shadow.getLastChroMemoryTrace(),
                    kept: keptMessages(),
                    facts: requestFacts(),
                    lastMemoryAt: lastMemoryPosition(chat),
                    memory: memoryEntries(),
                }
            }
            const on = { ltmEngine: true }

            test('INJ1 regression reproducer: one system memory message with the wrapped block, before the first kept message, and only evicted chats differ from the no-engine request', async () => {
                const off = await sendWith({})
                expect(off.ok).toBe(true)
                expect(off.memory).toEqual([])
                const inj = await sendWith(on)
                expect(inj.ok).toBe(true)
                expect(inj.trace!.outcome).toBe('injected')
                expect(inj.memory).toHaveLength(1)
                const [entry] = inj.memory
                expect(entry.role).toBe('system')
                expect(entry.content.startsWith('<Previous Conversation>Earlier in this chat\n[#')).toBe(true)
                expect(entry.content.endsWith('</Previous Conversation>')).toBe(true)
                expect(entry.content).toContain('zebrafish')
                expect((entry as { removable?: boolean }).removable).not.toBe(true)
                const firstKept = entries().findIndex((e) => !isMemory(e) && /\[M\d{4}\]/.test(e.content))
                expect(entries().indexOf(entry)).toBeLessThan(firstKept)
                const evicted = inj.trace!.makeRoom!.evictedChats
                expect(evicted).toBeGreaterThan(0)
                expect(inj.kept).toEqual(off.kept.slice(evicted))
            })

            test('T1 regression reproducer: the traced T is the recount of the memory entry, with the wrap and with a template memory card', async () => {
                const plain = await sendWith(on)
                const [entry] = plain.memory
                expect(plain.trace!.T).toBe(Math.ceil(entry.content.length / 4) + EXTRA)

                const cards = [
                    { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN', role: 'system' },
                    { type: 'memory', innerFormat: 'MEMORY-CARD[ {{slot}} ]', role2: 'user' },
                    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                ]
                const templated = await sendWith({ ...on, promptTemplate: cards, promptSettings: {} })
                expect(templated.ok).toBe(true)
                expect(templated.trace!.outcome).toBe('injected')
                const [card] = templated.memory
                expect(card.role).toBe('user')
                expect(card.content.startsWith('MEMORY-CARD[ Earlier in this chat')).toBe(true)
                expect(templated.trace!.T).toBe(Math.ceil(card.content.length / 4) + EXTRA)
            })

            test('T1 new rule: two identical memory cards count both entries and tokenize their shape once', async () => {
                const cards = [
                    { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN', role: 'system' },
                    { type: 'memory', innerFormat: '', role2: 'user' },
                    { type: 'memory', innerFormat: '', role2: 'user' },
                    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                ]
                const two = await sendWith({ ...on, promptTemplate: cards, promptSettings: {} })
                expect(two.ok).toBe(true)
                expect(two.trace!.outcome).toBe('injected')
                expect(two.memory).toHaveLength(2)
                const recount = two.memory.reduce((sum, e) => sum + Math.ceil(e.content.length / 4) + EXTRA, 0)
                expect(two.trace!.T).toBe(recount)
                // The head count tokenizes the shape of two identical cards once.
                expect(tokenizeMock.mock.calls.filter((c) => c[0] === header)).toHaveLength(1)
            })

            test('MR1 regression reproducer: a budget above the room is bounded by the room and the request fits the context', async () => {
                const inj = await sendWith({ ...on, ltmSettings: { budgetTokens: 2000 } })
                const trace = inj.trace!
                expect(trace.outcome).toBe('injected')
                const m = trace.makeRoom!
                expect(m.room).toBeLessThan(2000)
                expect(trace.T).toBeLessThanOrEqual(m.room)
                expect(m.limit + trace.T).toBeGreaterThan(0)
                expect(requestTokens()).toBeLessThanOrEqual(SCRIPTED_MAX_CONTEXT)
                expect(inj.kept.length).toBeGreaterThanOrEqual(4)
            })

            test('LM1 regression reproducer: lastMemory is the first kept message, later than the no-engine one, never the memory message', async () => {
                const off = await sendWith({})
                const inj = await sendWith(on)
                expect(inj.trace!.outcome).toBe('injected')
                expect(inj.chat.lastMemory).not.toBe('supaMemory')
                expect(inj.lastMemoryAt).toBe(inj.kept[0])
                expect(inj.lastMemoryAt).toBeGreaterThan(off.lastMemoryAt)
            })

            describe('I1: nothing injected sends the no-engine request', () => {
                const cases: Array<[string, Record<string, unknown>, number]> = [
                    ['budget below one line', { ltmSettings: { budgetTokens: 1 } }, 61],
                    ['everything fits (empty D0)', { maxContext: 999999 }, 61],
                ]
                for (const [label, db, count] of cases) {
                    test(`I1 guard (passes on the shadow base): ${label}`, async () => {
                        const off = await sendWith({ ...db }, {}, zebraMessages(count))
                        const inj = await sendWith({ ...db, ...on }, {}, zebraMessages(count))
                        expect(inj.facts).toEqual(off.facts)
                        expect(inj.kept).toEqual(off.kept)
                        expect(inj.memory).toEqual([])
                        expect(inj.lastMemoryAt).toBe(off.lastMemoryAt)
                    })
                }

                test('I1 guard: a throwing block count is an error trace and the no-engine request', async () => {
                    const off = await sendWith({})
                    tokenizeMock.mockImplementation(async (s: string) => {
                        if (String(s).startsWith('<Previous Conversation>')) throw new Error('count failed')
                        return ceil4(s)
                    })
                    const inj = await sendWith(on)
                    expect(inj.trace!.outcome).toBe('error')
                    expect(inj.facts).toEqual(off.facts)
                    expect(inj.memory).toEqual([])
                    expect(inj.lastMemoryAt).toBe(off.lastMemoryAt)
                })

                test('I1 guard: shadow mode injects nothing and equals the no-engine request', async () => {
                    const off = await sendWith({})
                    const inj = await sendWith({ ...on, ltmSettings: { shadow: true } })
                    expect(inj.trace!.mode).toBe('shadow')
                    expect(inj.facts).toEqual(off.facts)
                    expect(inj.memory).toEqual([])
                })
            })

            test('VC1 regression reproducer and VC2 guard: a varying counter injects within 12 counts, and injects nothing as the no-engine request', async () => {
                providerOptions.set('plug', { tokenizer: 'custom' })
                const varying = { aiModel: 'custom', currentPluginProvider: 'plug' }
                const off = await sendWith({ ...varying })
                tokenizeMock.mockClear()
                const inj = await sendWith({ ...varying, ...on })
                expect(inj.trace!.outcome).toBe('injected')
                expect(inj.memory).toHaveLength(1)
                expect(inj.trace!.counted).toBeLessThanOrEqual(12)
                expect(tokenizeMock.mock.calls.length).toBeLessThanOrEqual(12)
                expect(inj.kept).toEqual(off.kept.slice(inj.trace!.makeRoom!.evictedChats))

                const none = await sendWith({ ...varying, ...on, ltmSettings: { budgetTokens: 1 } })
                expect(none.kept).toEqual(off.kept)
                expect(none.facts).toEqual(off.facts)
            })

            test('INJ2 regression reproducer: a group record line has the member name without the wrapper, and a sendName first message is not named twice', async () => {
                const group = makeGroup('group-1', ['member-a', 'member-b'], [makeChat('chat-G', Array.from({ length: COUNT }, (_, i) => {
                    return msg(i % 2 === 0 ? 'user' : 'char', body100(i) + (i === 2 || i === COUNT - 1 ? ' zebrafish' : ''), { saying: i % 2 === 0 ? undefined : (i % 4 === 1 ? 'member-a' : 'member-b') })
                }))], { supaMemory: true })
                installDb([group, makeChar('member-a', 'Ann', [makeChat('chat-a', [])]), makeChar('member-b', 'Bob', [makeChat('chat-b', [])])], { maxContext: SCRIPTED_MAX_CONTEXT, ltmEngine: true, ltmSettings: { budgetTokens: 600 } })
                selectedCharID.set(0)
                h.request.mockReset()
                expect(await sendOnce(group, group.chats[0])).toBe(true)
                const [entry] = memoryEntries()
                expect(entry.content).toMatch(/\[#\d+\] (Ann|Bob): \[M\d{4}\]/)
                expect(entry.content).not.toContain("'s Message>")
                expect(entry.content).not.toMatch(/(Ann|Bob): (Ann|Bob):/)

                const cards = [
                    { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN', role: 'system' },
                    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                ]
                const FIRST = 'Greetings traveler zebrafish'
                const named = await sendWith({ ...on, promptTemplate: cards, promptSettings: { sendName: true } }, { firstMessage: FIRST })
                expect(named.ok).toBe(true)
                expect(named.trace!.outcome).toBe('injected')
                expect(named.memory).toHaveLength(1)
                const [firstLine] = named.memory
                expect(firstLine.content).toContain(`[#first] Alice: ${FIRST}`)
                expect(firstLine.content).not.toMatch(/Alice: Alice:/)
                expect(firstLine.content).not.toContain('<Alice\'s Message>')
            })

            test('I2a guard on the shadow base: sweeping the context, every size the no-engine send fits also fits with the engine, plain and with a depth prompt and a memory card', async () => {
                const variants: Array<[Record<string, unknown>, Record<string, unknown>]> = [
                    [{}, {}],
                    [{ promptTemplate: [
                        { type: 'plain', type2: 'main', text: 'M'.repeat(1200), role: 'system' },
                        { type: 'memory', innerFormat: 'CARD[ {{slot}} ]', role2: 'user' },
                        { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                    ], promptSettings: {} }, { depth_prompt: { prompt: 'D'.repeat(400), depth: 1 } }],
                ]
                let fitted = 0
                for (const [db, charExtra] of variants) {
                    for (let step = 0; step < 60; step++) {
                        const maxContext = 400 + step * 40
                        const off = await sendWith({ ...db, maxContext, maxResponse: 100 }, charExtra)
                        if (!off.ok) continue
                        fitted++
                        const inj = await sendWith({ ...db, ...on, maxContext, maxResponse: 100 }, charExtra)
                        expect({ maxContext, ok: inj.ok }).toEqual({ maxContext, ok: true })
                    }
                }
                expect(fitted).toBeGreaterThan(30)
            })

            test('RK4 diagnostic (wiring): overlapping chat cards double the memory entry, so a tight send drops it at the recheck instead of failing', async () => {
                const cards = (size: number) => [
                    { type: 'plain', type2: 'main', text: 'P'.repeat(size), role: 'system' },
                    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                ]
                const outcomes: Record<string, number> = {}
                for (let size = 2800; size <= 5600; size += 100) {
                    const db = { promptTemplate: cards(size), promptSettings: {}, maxResponse: 100, ltmSettings: { budgetTokens: 400 } }
                    const off = await sendWith({ ...db })
                    const inj = await sendWith({ ...db, ...on })
                    if (off.ok) {
                        expect({ size, ok: inj.ok }).toEqual({ size, ok: true })
                    }
                    const key = inj.ok ? inj.trace!.outcome : 'failed'
                    outcomes[key] = (outcomes[key] ?? 0) + 1
                    if (inj.ok && inj.trace!.outcome === 'dropped-at-recheck') {
                        expect(entries().some((e) => e.content.includes('<Previous Conversation>'))).toBe(false)
                        expect(shadow.getLastChroMemoryTrace()!.outcome).toBe('dropped-at-recheck')
                    }
                }
                expect(outcomes['dropped-at-recheck']).toBeGreaterThan(0)
            })

            test('F7 mutant-evidenced: a last resort that still does not fit throws too-much-token and the trace is not marked dropped-at-recheck', async () => {
                // The depth prompt counts 10 when make-room reserves it and far more at the recheck,
                // as a prompt that changes between its two parses would.
                let seen = 0
                h.countOverride = (content) => (content.startsWith('DEPTH-MARK') ? (seen++ === 0 ? 10 : 100000) : undefined)
                alertErrorMock.mockClear()
                const failed = await sendWith({ ...on, maxContext: 2000, maxResponse: 50 }, { depth_prompt: { prompt: 'DEPTH-MARK text', depth: 1 } }, zebraMessages(130))
                expect(failed.ok).toBe(false)
                expect(h.request).not.toHaveBeenCalled()
                expect(alertedErrors().some((e) => e.includes(languageEnglish.errors.toomuchtoken))).toBe(true)
                expect(failed.trace!.outcome).toBe('injected')
                expect(seen).toBeGreaterThan(1)
            })
            describe('guard: a send whose recheck is exhausted still throws too-much-token', () => {
                const DEPTH = { prompt: 'd'.repeat(40000), depth: 1 }
                const cases: Array<[string, Record<string, unknown>]> = [
                    ['no engine', {}],
                    ['legacy engine', { supaModelType: 'distilbart' }],
                ]
                for (const [label, db] of cases) {
                    test(`guard (passes on the base): ${label}`, async () => {
                        alertErrorMock.mockClear()
                        const result = await sendWith({ ...db }, { depth_prompt: DEPTH })
                        expect(result.ok).toBe(false)
                        expect(h.request).not.toHaveBeenCalled()
                        expect(alertedErrors().some((e) => e.includes(languageEnglish.errors.toomuchtoken))).toBe(true)
                    })
                }

                // A legacy summary is a non-removable supaMemory entry; it must never be dropped
                // quietly to save a send the way a placed ChroMemory block may be.
                test('guard (passes on the base): a legacy summary entry is not dropped to save the send', async () => {
                    supaMemoryMock.mockImplementation(async (chats: Array<{ content: string }>, currentTokens: number) => ({
                        currentTokens,
                        chats: [{ role: 'system', content: 'S'.repeat(8000), memo: 'supaMemory' }, ...chats],
                    }))
                    alertErrorMock.mockClear()
                    const result = await sendWith({ supaModelType: 'distilbart' }, {})
                    expect(supaMemoryMock).toHaveBeenCalledTimes(1)
                    expect(result.ok).toBe(false)
                    expect(h.request).not.toHaveBeenCalled()
                    expect(alertedErrors().some((e) => e.includes(languageEnglish.errors.toomuchtoken))).toBe(true)
                })
            })
            test('I2D (I2 property is a guard on the shadow base; the injected and reserved assertions are the mutant-evidenced reproducer): a character depth prompt bigger than the floor is reserved and the send succeeds with the memory entry', async () => {
                const DEPTH = 'd'.repeat(2400)
                const depthTokens = Math.ceil(DEPTH.length / 4) + EXTRA
                const messages = zebraMessages(130)
                const db = { maxContext: 2000, maxResponse: 50, ltmSettings: { budgetTokens: 1700 } }
                const charExtra = { depth_prompt: { prompt: DEPTH, depth: 1 } }
                const off = await sendWith({ ...db }, charExtra, messages)
                expect(off.ok).toBe(true)
                alertErrorMock.mockClear()
                const inj = await sendWith({ ...db, ...on }, charExtra, messages)
                expect({ ok: inj.ok, alerts: alertedErrors().map((a) => a.slice(0, 40)) }).toEqual({ ok: true, alerts: [] })
                expect(inj.trace!.outcome).toBe('injected')
                expect(inj.trace!.makeRoom!.reserved).toBe(depthTokens)
                expect(inj.memory).toHaveLength(1)
                expect(requestTokens()).toBeLessThanOrEqual(2000)
            })
        })
    })
})

describe('guard: the trim over the other inputs the context takes', () => {
    const MAX = 1500
    const COUNT = 61

    function plain(count: number = COUNT, edit: (i: number, data: string) => string = (_i, data) => data): Message[] {
        return Array.from({ length: count }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', edit(i, body100(i))))
    }

    async function runChat(
        extraDb: Record<string, unknown>,
        charExtra: Record<string, unknown> = {},
        messages: Message[] = plain(),
        extraArg: Partial<SendChatArg> = {},
    ): Promise<boolean | Error> {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)], charExtra)
        installDb([A], { maxContext: MAX, ...extraDb })
        selectedCharID.set(0)
        return await sendOnce(A, A.chats[0], extraArg)
    }

    /** What one send produced: the result, the alerts, the request and what the memory systems received. */
    function outcome(result: boolean | Error) {
        const requested = h.request.mock.calls.length > 0
        const kept = keptNumbers()
        return {
            result: result instanceof Error ? result.message : result,
            alerts: alertedErrors(),
            requested,
            ...(requested ? { ...requestFacts(), keptCount: kept.length, keptFirst: kept[0], keptLast: kept.at(-1) } : {}),
            memory: memoryRecords.map((rec) => ({
                currentTokens: rec.currentTokens,
                chatCount: rec.contents.length,
                chatsHash: hashOf(rec.contents),
                firstChat: rec.contents[0],
                lastChat: rec.contents.at(-1)?.slice(0, 12),
            })),
        }
    }

    // The sweep moves maxContext by one so that a change of the boundary
    // itself (a pop at equality, or one token less) moves a recorded change
    // point. The table lists only the maxContext at which the kept messages
    // change.
    for (const trimStartNewChat of [false, true]) {
        test(`guard: stepping maxContext by one keeps the same messages at every step (trimStartNewChat ${trimStartNewChat})`, async () => {
            const changes: Array<{ from: number, count: number, first: number, hash: string }> = []
            for (let maxContext = 1000; maxContext <= 1150; maxContext++) {
                h.request.mockReset()
                const result = await runChat({ maxContext, promptSettings: { trimStartNewChat } })
                expect(result).toBe(true)
                const numbers = keptNumbers()
                const step = { from: maxContext, count: numbers.length, first: numbers[0], hash: requestFacts().formatedHash }
                if (changes.at(-1)?.hash !== step.hash) {
                    changes.push(step)
                }
            }
            expect(changes.length).toBeGreaterThanOrEqual(4)
            expectFrozen(`step-${trimStartNewChat}`, changes)
        })
    }

    const templateCards = [
        { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN for {{char}}', role: 'system' },
        { type: 'persona' },
        { type: 'description' },
        { type: 'lorebook' },
        { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
        { type: 'chat', rangeStart: -3, rangeEnd: 'end' },
        { type: 'chat', rangeStart: 1, rangeEnd: 4 },
        { type: 'authornote' },
        { type: 'plain', type2: 'globalNote', text: 'TEMPLATE-NOTE', role: 'system' },
    ]
    const promptCharExtra = { globalLore: [lore('wi', 'WORLD-INFO-ENTRY'), lore('depth-entry', '@@depth 2\nLOREDEPTH')] }

    test('guard: a prompt template with persona, description, lorebook and chat cards sends the same request', async () => {
        const result = await runChat({ promptTemplate: templateCards, promptSettings: {}, personaPrompt: 'PERSONA-TEXT' }, promptCharExtra)
        expectFrozen('template', outcome(result))
    })

    test('guard: the legacy formating order with the same persona, description and lorebook sends the same request', async () => {
        const result = await runChat({ personaPrompt: 'PERSONA-TEXT' }, promptCharExtra)
        expectFrozen('legacy', outcome(result))
    })

    const examplePair = () => [
        { role: 'user', content: 'EXAMPLE-USER ' + 'one two three four '.repeat(20) },
        { role: 'assistant', content: 'EXAMPLE-REPLY ' + 'five six seven eight '.repeat(20) },
    ]

    for (const [label, maxContext, trimStartNewChat] of [
        ['kept whole', 999999, false],
        ['popped with the oldest chats, [Start a new chat] counted', MAX, false],
        ['popped with the oldest chats, no [Start a new chat]', MAX, true],
    ] as const) {
        test(`guard: example messages ahead of the chat (${label})`, async () => {
            exampleMessageMock.mockImplementation(() => examplePair())
            const result = await runChat({ maxContext, promptSettings: { trimStartNewChat } })
            expectFrozen(`examples-${label}`, outcome(result))
        })
    }

    test('guard: an inlay image in an old and in a kept message is sent as multimodal input', async () => {
        h.modelInfo = { flags: [0] }
        getInlayAssetMock.mockImplementation(async () => ({ type: 'image', data: 'data:image/png;base64,QUJD', width: 4, height: 4 }))
        const result = await runChat({}, {}, plain(COUNT, (i, data) => (i === 2 || i === 58) ? `${data} {{inlay::img${i}}}` : data))
        expect(getInlayAssetMock).toHaveBeenCalled()
        expectFrozen('inlay', outcome(result))
    })

    test('guard: a NovelAI model gets no [Start a new chat] chat', async () => {
        const result = await runChat({ aiModel: 'novelai_kayra' })
        expectFrozen('novelai', outcome(result))
    })

    for (const tokens of [37, 300]) {
        test(`guard: a start trigger result counts ${tokens} tokens and adds its system prompts`, async () => {
            runTriggerMock.mockImplementation(async (_char: unknown, mode: string) => {
                if (mode !== 'start') {
                    return undefined
                }
                return {
                    additonalSysPrompt: { start: 'TRIGGER-START', historyend: 'TRIGGER-HISTORY', promptend: 'TRIGGER-END' },
                    tokens, stopSending: false, sendAIprompt: false, displayData: undefined, tempVars: {},
                }
            })
            const result = await runChat({})
            expectFrozen(`trigger-${tokens}`, outcome(result))
        })
    }

    test('guard: a continue send trims and sends the same request', async () => {
        const result = await runChat({}, {}, plain(COUNT + 1), { continue: true })
        expectFrozen('continue', outcome(result))
    })

    // The Local tokenizer of hf::: models counts with cl100k_base, so the trim
    // counts it like any deterministic tokenizer.
    test('guard: the Local tokenizer of hf::: models, counted by the trim, trims and sends the same request, and hands the memory systems the same inputs', async () => {
        h.modelInfo = { tokenizer: 12 }
        const db = {}
        const trimmed = outcome(await runChat(db))
        memoryRecords.length = 0
        h.request.mockReset()
        const remembered = outcome(await runChat({ ...db, hypaV3: true }, { supaMemory: true }))
        expectFrozen('tokenizer-local tokenizer', { trimmed, remembered })
    })

    // Tokenizers whose count may leave the process or the page: the counts
    // themselves are the stand-in's, only the model selection differs.
    const tokenizers: Array<[string, Record<string, unknown>, () => void]> = [
        ['plugin provider with its own tokenizer', { aiModel: 'custom', currentPluginProvider: 'plug' }, () => {
            providerOptions.set('plug', { tokenizer: 'custom' })
        }],
        ['Google Cloud tokenizing with googleClaudeTokenizing', { googleClaudeTokenizing: true }, () => {
            h.modelInfo = { tokenizer: 10 }
        }],
    ]

    for (const [label, db, setup] of tokenizers) {
        test(`guard: ${label} trims and sends the same request, and hands the memory systems the same inputs`, async () => {
            setup()
            const trimmed = outcome(await runChat(db))
            memoryRecords.length = 0
            h.request.mockReset()
            const remembered = outcome(await runChat({ ...db, hypaV3: true }, { supaMemory: true }))
            expectFrozen(`tokenizer-${label}`, { trimmed, remembered })
        })
    }

    // A count that can be NaN is taken as each message is prepared, so a NaN
    // on a dropped message still turns the trim off, as on the base. Each case
    // tells its route apart: counted only by the trim, the NaN would be skipped
    // and the newest window kept.
    for (const [label, db, setup] of tokenizers) {
        test(`guard: a NaN count for an old message with the ${label} sends every message`, async () => {
            setup()
            h.nanMarker = 'NANMARK'
            const result = outcome(await runChat(db, {}, plain(COUNT, (i, data) => i === 3 ? `${data} NANMARK` : data))) as { result: unknown, keptCount: number, keptFirst: number }
            expect(result.result).toBe(true)
            expect(result.keptCount).toBe(COUNT)
            expect(result.keptFirst).toBe(0)
        })
    }

    test('guard: a NaN count for an old message with an inlay image sends every message', async () => {
        h.modelInfo = { flags: [0] }
        h.nanMarker = 'NANMARK'
        getInlayAssetMock.mockImplementation(async () => ({ type: 'image', data: 'data:image/png;base64,QUJD', width: 4, height: 4 }))
        const result = outcome(await runChat({}, {}, plain(COUNT, (i, data) => i === 2 ? `${data} NANMARK {{inlay::img${i}}}` : data))) as { result: unknown, keptCount: number, keptFirst: number }
        expect(getInlayAssetMock).toHaveBeenCalled()
        expect(result.result).toBe(true)
        expect(result.keptCount).toBe(COUNT)
        expect(result.keptFirst).toBe(0)
    })

    // A limit that is not a number is never exceeded, so nothing is trimmed.
    for (const maxContext of [NaN, undefined, 'abc']) {
        test(`guard: a maxContext of ${String(maxContext)} sends every message`, async () => {
            const result = outcome(await runChat({ maxContext })) as { result: unknown, keptCount: number, keptFirst: number }
            expect(result.result).toBe(true)
            expect(result.keptCount).toBe(COUNT)
            expect(result.keptFirst).toBe(0)
        })
    }

    test('regression reproducer: with the Local tokenizer of hf::: models, a NaN count on a dropped message no longer turns the trim off', async () => {
        h.modelInfo = { tokenizer: 12 }
        h.nanMarker = 'NANMARK'
        const result = await runChat({}, {}, plain(COUNT, (i, data) => i === 3 ? `${data} NANMARK` : data))
        const base = FROZEN['nan-local'] as { keptCount: number }
        const now = outcome(result) as { result: unknown, keptCount: number, keptLast: number }
        expect(base.keptCount).toBe(61)
        expect(now.result).toBe(true)
        expect(now.keptCount).toBeLessThan(base.keptCount)
        expect(now.keptLast).toBe(60)
    })

    // The default tokenizers count a text chat as an array length plus a whole
    // number, so they never give NaN; a plugin's
    // tokenizer can, and their counts are taken as each message is prepared
    // (the tests above). With
    // the stand-in's NaN on a dropped message, the base sent every message (a
    // NaN total is never over the limit); the trim now never counts that
    // message and keeps the newest window instead.
    test('precondition: a NaN count the default tokenizers cannot give, on a dropped message, no longer turns the trim off', async () => {
        h.nanMarker = 'NANMARK'
        const result = await runChat({}, {}, plain(COUNT, (i, data) => i === 3 ? `${data} NANMARK` : data))
        const base = FROZEN['nan-default'] as { keptCount: number }
        const now = outcome(result) as { result: unknown, keptCount: number, keptLast: number }
        expect(base.keptCount).toBe(61)
        expect(now.result).toBe(true)
        expect(now.keptCount).toBeLessThan(base.keptCount)
        expect(now.keptLast).toBe(60)
    })

    test('guard: a fractional maxResponse reports the required tokens exactly as the base printed them', async () => {
        const result = await runChat({ maxContext: 100, maxResponse: 13.1 }, {}, alternating(5, body100))
        expect(h.request).not.toHaveBeenCalled()
        expectFrozen('fraction-error', outcome(result))
    })

    test('guard: a fractional maxResponse trims to the same request', async () => {
        const result = await runChat({ maxResponse: 13.1 })
        expectFrozen('fraction-trim', outcome(result))
    })

    // The per-message seam is the process-script hook: it runs once for every
    // message's script pass, whether or not the message holds an inlay.
    test('guard: the memory gate turning true while the messages are prepared hands the memory system every chat', async () => {
        let passes = 0
        editprocessHooks.add(async () => {
            passes++
            if (passes === 30) {
                DBState.db.characters[0].supaMemory = true
                DBState.db.hypaV3 = true
            }
            return null
        })
        const result = await runChat({})
        expect(passes).toBeGreaterThanOrEqual(30)
        expect(hypaV3Mock).toHaveBeenCalledTimes(1)
        expectFrozen('gate-flip', outcome(result))
    })

    describe('guard: the model is looked up only for a message that holds an inlay', () => {
        async function lookupsOf(messages: Message[]): Promise<number> {
            let lookups = 0
            h.onModelInfo = () => { lookups++ }
            await runChat({}, {}, messages)
            h.onModelInfo = null
            return lookups
        }

        const withInlays = (i: number, data: string) => {
            if (i === 2) {
                return `${data} {{inlay::imgA}} {{inlay::imgB}}`
            }
            return i === 58 ? `${data} {{inlay::img58}}` : data
        }

        test('guard: the number of lookups does not grow with the number of messages', async () => {
            const few = await lookupsOf(plain(5))
            const many = await lookupsOf(plain(61))
            expect(many - few).toBe(0)
        })

        test('guard: each message with inlays adds exactly one lookup', async () => {
            h.modelInfo = { flags: [0] }
            getInlayAssetMock.mockImplementation(async () => ({ type: 'image', data: 'data:image/png;base64,QUJD', width: 4, height: 4 }))
            const without = await lookupsOf(plain(61))
            const inlayed = await lookupsOf(plain(61, withInlays))
            expect(inlayed - without).toBe(2)
        })

        test('guard: a message keeps the model flags it read before its inlay awaits, and the next message reads again', async () => {
            h.modelInfo = { flags: [0] }
            getInlayAssetMock.mockImplementation(async (name: string) => {
                if (name === 'imgA') {
                    h.modelInfo = { flags: [] }
                }
                return { type: 'image', data: 'data:image/png;base64,QUJD', width: 4, height: 4 }
            })
            const transformers = await import('../transformers')
            ;(transformers.runImageEmbedding as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ generated_text: 'CAP' }])
            try {
                await runChat({ maxContext: 100000 }, {}, plain(61, withInlays))
            } finally {
                (transformers.runImageEmbedding as unknown as ReturnType<typeof vi.fn>).mockReset()
            }
            const formated = lastBody()?.formated ?? []
            const entryOf = (i: number) => formated.find((entry) => entry.content.includes(`[M${String(i).padStart(4, '0')}]`))
            const first = entryOf(2) as unknown as { content: string, multimodals?: unknown[] }
            const second = entryOf(58) as unknown as { content: string, multimodals?: unknown[] }
            expect(first.multimodals?.length).toBe(2)
            expect(first.content).not.toContain('[CAP]')
            expect(second.multimodals?.length ?? 0).toBe(0)
            expect(second.content).toContain('[CAP]')
        })
    })

    describe('the send of video and audio inlays', () => {
        const MIB = 1024 * 1024
        const VIDEO_FLAG = 12
        const AUDIO_FLAG = 2
        const IMAGE_FLAG = 0
        const LIMIT = 20 * MIB

        interface Staged {
            type: 'image' | 'video' | 'audio'
            name: string
            size: number
        }

        /** Answers the summary and the body of each staged id; an id that is not staged is missing. */
        function stage(files: Record<string, Staged>): void {
            getInlaySummaryMock.mockImplementation(async (id: string) => {
                const file = files[id]
                return file ? { type: file.type, name: file.name, ext: 'bin', size: file.size } : null
            })
            getInlayAssetMock.mockImplementation(async (id: string) => {
                const file = files[id]
                if (!file) {
                    return null
                }
                return { type: file.type, name: file.name, ext: 'bin', data: `data:${file.type}/x;base64,${id}`, width: 4, height: 4 }
            })
        }

        /** One earlier char message, then one user message that holds the given inlays. */
        function holding(...ids: string[]): Message[] {
            return [msg('char', 'earlier'), msg('user', `ask ${ids.map((id) => `{{inlay::${id}}}`).join(' ')}`)]
        }

        /** Every multimodal part of the request the send made. */
        function sentModals(): Array<{ type: string, base64: string }> {
            const formated = (lastBody()?.formated ?? []) as unknown as Array<{ multimodals?: Array<{ type: string, base64: string }> }>
            return formated.flatMap((entry) => entry.multimodals ?? [])
        }

        const tooLargeToast = (names: string) => fillLang(languageEnglish.inlaySendTooLarge, { names, size: 20 })

        test('a model without the video flag does not read a video and does not toast', async () => {
            h.modelInfo = { flags: [] }
            stage({ vid: { type: 'video', name: 'clip.mp4', size: 194 * MIB } })
            await runChat({}, {}, holding('vid'))
            expect(getInlayAssetMock).not.toHaveBeenCalledWith('vid')
            expect(sentModals()).toEqual([])
            expect(alertToastMock).not.toHaveBeenCalled()
        })

        test('a model with only the video flag does not read an audio', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({ aud: { type: 'audio', name: 'a.mp3', size: MIB } })
            await runChat({}, {}, holding('aud'))
            expect(getInlayAssetMock).not.toHaveBeenCalledWith('aud')
            expect(sentModals()).toEqual([])
        })

        test('a video over the limit is not read and one toast names it', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({ vid: { type: 'video', name: 'clip.mp4', size: LIMIT + 1 } })
            await runChat({}, {}, holding('vid'))
            expect(getInlayAssetMock).not.toHaveBeenCalledWith('vid')
            expect(sentModals()).toEqual([])
            expect(alertToastMock).toHaveBeenCalledTimes(1)
            expect(alertToastMock).toHaveBeenCalledWith(tooLargeToast('clip.mp4'))
        })

        test('guard: a video of exactly the limit is read and sent without a toast', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({ vid: { type: 'video', name: 'clip.mp4', size: LIMIT } })
            await runChat({}, {}, holding('vid'))
            expect(sentModals()).toEqual([{ type: 'video', base64: 'data:video/x;base64,vid', name: 'clip.mp4' }])
            expect(alertToastMock).not.toHaveBeenCalled()
        })

        test('one toast per send lists each over-limit file once, and only the small one is read', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({
                big1: { type: 'video', name: 'one.mp4', size: 30 * MIB },
                big2: { type: 'video', name: 'two.mp4', size: 40 * MIB },
                small: { type: 'video', name: 'small.mp4', size: MIB },
            })
            const messages = [
                msg('user', 'first {{inlay::big1}} {{inlay::big2}}'),
                msg('char', 'reply'),
                msg('user', 'again {{inlay::big2}} {{inlay::small}}'),
            ]
            await runChat({}, {}, messages)
            expect(getInlayAssetMock.mock.calls.map((call) => call[0])).toEqual(['small'])
            expect(alertToastMock).toHaveBeenCalledTimes(1)
            expect(alertToastMock).toHaveBeenCalledWith(tooLargeToast('one.mp4, two.mp4'))
        })

        test('the same file attached in two messages under two ids is named once', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({
                first: { type: 'video', name: 'clip.mp4', size: 30 * MIB },
                again: { type: 'video', name: 'clip.mp4', size: 30 * MIB },
            })
            const messages = [
                msg('user', 'first {{inlay::first}}'),
                msg('char', 'reply'),
                msg('user', 'again {{inlay::again}}'),
            ]
            await runChat({}, {}, messages)
            expect(getInlayAssetMock).not.toHaveBeenCalled()
            expect(alertToastMock).toHaveBeenCalledTimes(1)
            expect(alertToastMock).toHaveBeenCalledWith(tooLargeToast('clip.mp4'))
        })

        test('an image then a video in one message: the image is sent, the video finds the slot taken and is not read, with no toast', async () => {
            h.modelInfo = { flags: [IMAGE_FLAG, VIDEO_FLAG] }
            stage({
                img: { type: 'image', name: 'p.png', size: 30 * MIB },
                vid: { type: 'video', name: 'clip.mp4', size: 30 * MIB },
            })
            await runChat({}, {}, holding('img', 'vid'))
            expect(getInlayAssetMock.mock.calls.map((call) => call[0])).toEqual(['img'])
            expect(sentModals().map((part) => part.type)).toEqual(['image'])
            expect(alertToastMock).not.toHaveBeenCalled()
        })

        test('guard: off Android an image of any size is read and sent whatever the flags allow', async () => {
            h.android = false
            h.modelInfo = { flags: [IMAGE_FLAG] }
            stage({ img: { type: 'image', name: 'p.png', size: 30 * MIB } })
            await runChat({}, {}, holding('img'))
            expect(sentModals().map((part) => part.type)).toEqual(['image'])
            expect(alertToastMock).not.toHaveBeenCalled()
        })

        test('guard: a missing inlay is not read and its tag is stripped', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({})
            await runChat({}, {}, holding('gone'))
            expect(getInlayAssetMock).not.toHaveBeenCalled()
            const sent = (lastBody()?.formated ?? []).map((entry) => entry.content).join('\n')
            expect(sent).not.toContain('{{inlay::gone}}')
            expect(alertToastMock).not.toHaveBeenCalled()
        })

        test('a skipped over-limit video does not take the slot of the message: the next video is sent', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({
                big: { type: 'video', name: 'big.mp4', size: 30 * MIB },
                small: { type: 'video', name: 'small.mp4', size: 5 * MIB },
            })
            await runChat({}, {}, holding('big', 'small'))
            expect(sentModals()).toEqual([{ type: 'video', base64: 'data:video/x;base64,small', name: 'small.mp4' }])
            expect(alertToastMock).toHaveBeenCalledWith(tooLargeToast('big.mp4'))
        })

        test('a video a model cannot take does not take the slot of the message: the audio is sent', async () => {
            h.modelInfo = { flags: [AUDIO_FLAG] }
            stage({
                vid: { type: 'video', name: 'v.mp4', size: MIB },
                aud: { type: 'audio', name: 'a.mp3', size: MIB },
            })
            await runChat({}, {}, holding('vid', 'aud'))
            expect(sentModals()).toEqual([{ type: 'audio', base64: 'data:audio/x;base64,aud', name: 'a.mp3' }])
        })

        test('guard: the second eligible video of a message is still dropped once one is sent', async () => {
            h.modelInfo = { flags: [VIDEO_FLAG] }
            stage({
                one: { type: 'video', name: 'one.mp4', size: MIB },
                two: { type: 'video', name: 'two.mp4', size: MIB },
            })
            await runChat({}, {}, holding('one', 'two'))
            expect(sentModals()).toEqual([{ type: 'video', base64: 'data:video/x;base64,one', name: 'one.mp4' }])
            expect(getInlayAssetMock.mock.calls.map((call) => call[0])).toEqual(['one'])
        })

        describe('an image over the 64 MB limit on Android', () => {
            const ANDROID_LIMIT = 64 * MIB
            const tooLarge64 = (names: string) => fillLang(languageEnglish.inlaySendTooLarge, { names, size: 64 })

            test('a model with image input does not read it, sends nothing and one notice names it with 64', async () => {
                h.android = true
                h.modelInfo = { flags: [IMAGE_FLAG] }
                stage({ img: { type: 'image', name: 'big.png', size: ANDROID_LIMIT + 1 } })
                await runChat({}, {}, holding('img'))
                expect(getInlayAssetMock).not.toHaveBeenCalledWith('img')
                expect(sentModals()).toEqual([])
                expect(alertToastMock).toHaveBeenCalledTimes(1)
                expect(alertToastMock).toHaveBeenCalledWith(tooLarge64('big.png'))
            })

            test('a model without image input neither reads nor captions it', async () => {
                h.android = true
                h.modelInfo = { flags: [] }
                stage({ img: { type: 'image', name: 'big.png', size: ANDROID_LIMIT + 1 } })
                const transformers = await import('../transformers')
                const caption = transformers.runImageEmbedding as unknown as ReturnType<typeof vi.fn>
                caption.mockResolvedValue([{ generated_text: 'CAP' }])
                try {
                    await runChat({}, {}, holding('img'))
                    expect(caption).not.toHaveBeenCalled()
                } finally {
                    caption.mockReset()
                }
                expect(getInlayAssetMock).not.toHaveBeenCalledWith('img')
                expect(alertToastMock).toHaveBeenCalledTimes(1)
                expect(alertToastMock).toHaveBeenCalledWith(tooLarge64('big.png'))
            })

            test('an earlier message is refused on every send while a small image of the last message is sent', async () => {
                h.android = true
                h.modelInfo = { flags: [IMAGE_FLAG] }
                stage({
                    big: { type: 'image', name: 'big.png', size: ANDROID_LIMIT + 1 },
                    small: { type: 'image', name: 'small.png', size: MIB },
                })
                const messages = [msg('user', 'first {{inlay::big}}'), msg('char', 'reply'), msg('user', 'again {{inlay::small}}')]
                await runChat({}, {}, messages)
                expect(getInlayAssetMock.mock.calls.map((call) => call[0])).toEqual(['small'])
                expect(sentModals().map((part) => part.type)).toEqual(['image'])
                expect(alertToastMock).toHaveBeenCalledTimes(1)
                expect(alertToastMock).toHaveBeenCalledWith(tooLarge64('big.png'))
            })

            test('a refused image does not take the slot: the video of the same message is sent', async () => {
                h.android = true
                h.modelInfo = { flags: [IMAGE_FLAG, VIDEO_FLAG] }
                stage({
                    big: { type: 'image', name: 'big.png', size: ANDROID_LIMIT + 1 },
                    vid: { type: 'video', name: 'clip.mp4', size: 5 * MIB },
                })
                await runChat({}, {}, holding('big', 'vid'))
                expect(sentModals().map((part) => part.type)).toEqual(['video'])
                expect(alertToastMock).toHaveBeenCalledWith(tooLarge64('big.png'))
            })

            test('a mixed refusal is one notice: the 20 MB sentence first, a line break, the 64 MB sentence', async () => {
                h.android = true
                h.modelInfo = { flags: [IMAGE_FLAG, VIDEO_FLAG] }
                stage({
                    big: { type: 'image', name: 'big.png', size: ANDROID_LIMIT + 1 },
                    vid: { type: 'video', name: 'clip.mp4', size: 30 * MIB },
                })
                await runChat({}, {}, holding('big', 'vid'))
                expect(alertToastMock).toHaveBeenCalledTimes(1)
                expect(alertToastMock).toHaveBeenCalledWith(`${tooLargeToast('clip.mp4')}\n${tooLarge64('big.png')}`)
                expect(getInlayAssetMock).not.toHaveBeenCalled()
            })

            test('guard: off Android the same image is read and sent without a notice', async () => {
                h.android = false
                h.modelInfo = { flags: [IMAGE_FLAG] }
                stage({ img: { type: 'image', name: 'big.png', size: ANDROID_LIMIT + 1 } })
                await runChat({}, {}, holding('img'))
                expect(sentModals().map((part) => part.type)).toEqual(['image'])
                expect(alertToastMock).not.toHaveBeenCalled()
            })

            test('guard: an image of exactly 64 MiB is read and sent without a notice', async () => {
                h.android = true
                h.modelInfo = { flags: [IMAGE_FLAG] }
                stage({ img: { type: 'image', name: 'big.png', size: ANDROID_LIMIT } })
                await runChat({}, {}, holding('img'))
                expect(sentModals().map((part) => part.type)).toEqual(['image'])
                expect(alertToastMock).not.toHaveBeenCalled()
            })

            test('guard: a video of 64 MiB + 1 on Android keeps the 20 MB limit text', async () => {
                h.android = true
                h.modelInfo = { flags: [VIDEO_FLAG] }
                stage({ vid: { type: 'video', name: 'clip.mp4', size: ANDROID_LIMIT + 1 } })
                await runChat({}, {}, holding('vid'))
                expect(getInlayAssetMock).not.toHaveBeenCalledWith('vid')
                expect(alertToastMock).toHaveBeenCalledTimes(1)
                expect(alertToastMock).toHaveBeenCalledWith(tooLargeToast('clip.mp4'))
            })
        })
    })

    for (const trimStartNewChat of [true, false]) {
        test(`guard: a character chat without messages and with an empty first message under the limit (trimStartNewChat ${trimStartNewChat})`, async () => {
            const result = await runChat({ promptSettings: { trimStartNewChat } }, { firstMessage: '' }, [])
            expectFrozen(`empty-${trimStartNewChat}`, outcome(result))
        })

        // A group chat sends no first message, so with nothing counted the
        // list of chats is empty when the trim looks at it.
        test(`guard: a group chat without messages under the limit (trimStartNewChat ${trimStartNewChat})`, async () => {
            const group = makeGroup('group-1', ['member-a', 'member-b'], [makeChat('chat-G', [])])
            const memberA = makeChar('member-a', 'Ann', [makeChat('chat-a', [])])
            const memberB = makeChar('member-b', 'Bob', [makeChat('chat-b', [])])
            installDb([group, memberA, memberB], { maxContext: MAX, promptSettings: { trimStartNewChat } })
            selectedCharID.set(0)
            const result = await sendOnce(group, group.chats[0])
            expectFrozen(`empty-group-${trimStartNewChat}`, outcome(result))
        })
    }
})
