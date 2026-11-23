// @vitest-environment node

/**
 * ChroMemory lore recall on the send path (`../index.svelte`).
 *
 * With ChroMemory on, `ltmSettings.searchLore` set and the lore index built, a lore entry whose key missed but whose
 * text matches the newest sent message is placed like normal-position lore and counted with lore. Step 1 of the
 * context trim gives recalled lore up first, one entry at a time, lowest-ranked first.
 *
 * - `guard:` tests pin that a send which recalls nothing is the engine-off request (passes before and after).
 * - `regression reproducer:` tests fail on a send that never recalls (the tap is not wired) or never shrinks.
 *
 * Drives the REAL `sendChat` with the real lorebook scan, the real lore index and the real recall step; the provider
 * request, the memory systems, the trigger engine and the platform/IO packages are mocked as in
 * `sendChatContextTrim.svelte.test.ts`, and the tokenizer is a deterministic counting stand-in (a quarter of the
 * content length, rounded up, plus the per-chat extra). The fixtures use no random CBS, so request equality holds.
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
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): the setup file's stand-in
// throws on `undefined`, which the script pass clones.
import '../../polyfill'
import { clearRunningSends } from './activeUnits.test-helpers'

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


vi.mock(import('../memory/chroMemory/loreRecall'), async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, createLoreRecallStep: vi.fn(actual.createLoreRecallStep) } as typeof actual
})

//#endregion
//#region fixtures and helpers

type Owner = character | groupChat
type Selection = Writable<number>

interface PromptEntry {
    role: string
    content: string
}

let sendChat: typeof import('../index.svelte').sendChat
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
    clearRunningSends()
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

const SCRIPTED_MAX_CONTEXT = 1500
const COUNT = 61

/** About 100 bytes of deterministic text, tagged with the message number. */
function body100(i: number): string {
    return `[M${String(i).padStart(4, '0')}] ` + 'lorem ipsum dolor sit amet '.repeat(4)
}

describe('lore recall on the send path', () => {
    let tokenizeMock: ReturnType<typeof vi.fn>
    let shadow: typeof import('../memory/chroMemory/shadow')
    let loreTraceStore: typeof import('../memory/chroMemory/traceStore').chroLoreTrace
    let createStepMock: ReturnType<typeof vi.fn>
    const ceil4 = async (s: string) => Math.ceil((s?.length ?? 0) / 4)

    beforeAll(async () => {
        tokenizeMock = (await import('../../tokenizer')).tokenize as unknown as ReturnType<typeof vi.fn>
        shadow = await import('../memory/chroMemory/shadow')
        loreTraceStore = (await import('../memory/chroMemory/traceStore')).chroLoreTrace
        createStepMock = (await import('../memory/chroMemory/loreRecall')).createLoreRecallStep as unknown as ReturnType<typeof vi.fn>
    })

    beforeEach(() => {
        shadow.resetChroMemoryShadowForTests()
        tokenizeMock.mockReset()
        tokenizeMock.mockImplementation(ceil4)
        loreTraceStore.set(null)
    })

    afterEach(() => {
        tokenizeMock.mockReset()
        tokenizeMock.mockImplementation(async (s: string) => (s?.length ?? 0))
    })

    const TARGET_TEXT = 'roostline sky citadel ancient wyvern roost'

    function loreEntry(comment: string, content: string, over: Record<string, unknown> = {}): Record<string, unknown> {
        return { comment, content, mode: 'normal', insertorder: 100, alwaysActive: false, key: 'unmatchedkey ' + comment, secondkey: '', selective: false, ...over }
    }

    /** Fillers share no term with the query, so the target is the only candidate the index can rank. */
    function loreSet(fillers = 5, target: string = TARGET_TEXT): Array<Record<string, unknown>> {
        return [
            loreEntry('target', target),
            ...Array.from({ length: fillers }, (_, i) => loreEntry(`filler${i}`, `filler number ${i} market weather harvest road`)),
        ]
    }

    function messagesFor(count: number, query: boolean): Message[] {
        return Array.from({ length: count }, (_, i) => msg(i % 2 === 0 ? 'user' : 'char', body100(i) + (query && i === count - 1 ? ' roostline' : '')))
    }

    const entries = () => lastBody()?.formated ?? []
    const requestHas = (text: string) => entries().some((e) => e.content.includes(text))
    const settled = () => new Promise<void>((done) => setTimeout(done, 25))

    async function sendWith(db: Record<string, unknown>, charExtra: Record<string, unknown>, messages: Message[], lores: Array<Record<string, unknown>>) {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages.map((m) => ({ ...m })))], { supaMemory: true, globalLore: lores.map((l) => ({ ...l })), ...charExtra })
        installDb([A], { maxContext: 999999, ...db })
        selectedCharID.set(0)
        h.request.mockReset()
        shadow.resetChroMemoryShadowForTests()
        loreTraceStore.set(null)
        const result = await sendOnce(A, A.chats[0])
        const chat = (DBState.db.characters[0] as character).chats[0]
        return {
            ok: result === true,
            result,
            chat,
            trace: shadow.getLastChroMemoryTrace(),
            lore: get(loreTraceStore),
            facts: requestFacts(),
            body: withoutMemos(entries()),
            kept: keptNumbers(),
        }
    }

    /** One send to start the index build, a pause for its timers, then the send under test. */
    async function recallSend(db: Record<string, unknown>, charExtra: Record<string, unknown>, messages: Message[], lores: Array<Record<string, unknown>>) {
        await sendWith(db, charExtra, messages, lores)
        await settled()
        return await sendWith(db, charExtra, messages, lores)
    }

    const on = { ltmEngine: true, ltmSettings: { searchLore: true } }

    test('T22 regression reproducer: a recalled entry is in the request, counted with lore, and traced as placed', async () => {
        const off = await sendWith({}, {}, messagesFor(COUNT, true), loreSet())
        expect(off.ok).toBe(true)
        expect(requestHas('sky citadel')).toBe(false)
        const inj = await recallSend(on, {}, messagesFor(COUNT, true), loreSet())
        expect(inj.ok).toBe(true)
        expect(requestHas('sky citadel')).toBe(true)
        expect(inj.lore!.outcome).toBe('placed')
        expect(inj.lore!.items).toHaveLength(1)
        expect(inj.lore!.budget.used).toBe(Math.ceil(TARGET_TEXT.length / 4))
    })

    describe('T21 I1: recalling nothing sends the engine-off request', () => {
        test('guard: no candidate matches the query', async () => {
            const off = await sendWith({}, {}, messagesFor(COUNT, false), loreSet())
            const inj = await recallSend(on, {}, messagesFor(COUNT, false), loreSet())
            expect(inj.lore!.outcome).toBe('no-candidates')
            expect(inj.facts).toEqual(off.facts)
        })

        test('guard: shadow mode traces the pick and places nothing (no random CBS in the fixture)', async () => {
            const off = await sendWith({}, {}, messagesFor(COUNT, true), loreSet())
            const inj = await recallSend({ ltmEngine: true, ltmSettings: { searchLore: true, shadow: true } }, {}, messagesFor(COUNT, true), loreSet())
            expect(inj.lore!.outcome).toBe('would-place')
            expect(inj.lore!.items).toHaveLength(1)
            expect(inj.facts).toEqual(off.facts)
        })

        test('guard: the index is still building on the first send', async () => {
            const lores = loreSet(7)
            const off = await sendWith({}, {}, messagesFor(COUNT, true), lores)
            const first = await sendWith(on, {}, messagesFor(COUNT, true), lores)
            expect(first.lore!.outcome).toBe('index-building')
            expect(first.facts).toEqual(off.facts)
            await settled()
        })

        test('guard: effectiveMemory false runs no recall', async () => {
            const off = await sendWith({}, { supaMemory: false }, messagesFor(COUNT, true), loreSet())
            const inj = await recallSend(on, { supaMemory: false }, messagesFor(COUNT, true), loreSet())
            expect(inj.lore).toBeNull()
            expect(inj.facts).toEqual(off.facts)
        })

        test('row NLC guard: a template with no lorebook card places a recalled entry that is never sent, and the request is the engine-off one', async () => {
            const cards = [
                { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN', role: 'system' },
                { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
            ]
            const template = { promptTemplate: cards, promptSettings: {} }
            const off = await sendWith({ ...template }, {}, messagesFor(COUNT, true), loreSet())
            const inj = await recallSend({ ...template, ...on }, {}, messagesFor(COUNT, true), loreSet())
            expect(inj.lore!.outcome).toBe('placed')
            expect(requestHas('sky citadel')).toBe(false)
            expect(inj.facts).toEqual(off.facts)
        })
    })

    describe('T26 gating', () => {
        test('guard: searchLore absent, searchLore false and ltmEngine off each run no recall', async () => {
            const off = await sendWith({}, {}, messagesFor(COUNT, true), loreSet())
            for (const db of [
                { ltmEngine: true, ltmSettings: {} },
                { ltmEngine: true, ltmSettings: { searchLore: false } },
                { ltmEngine: false, ltmSettings: { searchLore: true } },
            ]) {
                const inj = await recallSend(db, {}, messagesFor(COUNT, true), loreSet())
                expect(inj.lore).toBeNull()
                expect(inj.facts).toEqual(off.facts)
            }
        })

        test('T26b guard: a step that throws while it is built leaves the engine-off request', async () => {
            const off = await sendWith({}, {}, messagesFor(COUNT, true), loreSet())
            await sendWith(on, {}, messagesFor(COUNT, true), loreSet())
            await settled()
            createStepMock.mockImplementationOnce(() => { throw new Error('construction failed') })
            const inj = await sendWith(on, {}, messagesFor(COUNT, true), loreSet())
            expect(inj.ok).toBe(true)
            expect(inj.lore).toBeNull()
            expect(inj.facts).toEqual(off.facts)
        })
    })

    test('T25 guard: a turn whose lore budget cut an entry recalls nothing', async () => {
        const lores = [...loreSet(), loreEntry('always', 'y'.repeat(60), { alwaysActive: true, key: '' })]
        const off = await sendWith({ loreBookToken: 10 }, {}, messagesFor(COUNT, true), lores)
        const inj = await recallSend({ ...on, loreBookToken: 10 }, {}, messagesFor(COUNT, true), lores)
        expect(inj.lore!.outcome).toBe('budget-cut')
        expect(requestHas('sky citadel')).toBe(false)
        expect(inj.facts).toEqual(off.facts)
    })

    // Step 1 of the context trim takes recalled lore back one entry at a time, lowest-ranked first.
    describe('step 1 of the trim', () => {
        // Many tokens, so BM25 length normalization ranks it below the short target.
        // Wide enough that the two entries sharing the rare term stay under the shipped admission threshold.
        const WIDE_BOOK = 150
        const HUGE = 'roostline ' + 'wwwwwwww '.repeat(445)
        const trimmedOf = (r: { lore: { trimmed: { removed: number } | null } | null }) => r.lore!.trimmed

        // The rows below need a second recalled entry, which the shipped N of 1 never places.
        let actualStep: typeof import('../memory/chroMemory/loreRecall').createLoreRecallStep
        let stepMock: ReturnType<typeof vi.fn>
        beforeAll(async () => {
            const mod = await import('../memory/chroMemory/loreRecall')
            stepMock = mod.createLoreRecallStep as unknown as ReturnType<typeof vi.fn>
            actualStep = (await vi.importActual<typeof import('../memory/chroMemory/loreRecall')>('../memory/chroMemory/loreRecall')).createLoreRecallStep
        })
        beforeEach(() => {
            stepMock.mockImplementation((opts: Parameters<typeof actualStep>[0]) => actualStep({ ...opts, deps: { ...opts.deps, maxPicks: 3, maxRenders: 8 } }))
        })
        afterEach(() => { stepMock.mockImplementation(actualStep) })

        /** The smallest context at which the engine-off send keeps every message. */
        async function smallestContext(messages: Message[], lores: Array<Record<string, unknown>>): Promise<number> {
            let lo = 40
            let hi = 3000
            while (lo < hi) {
                const mid = (lo + hi) >> 1
                const r = await sendWith({ maxContext: mid, maxResponse: 10 }, {}, messages, lores)
                if (r.ok && r.kept.length === messages.length) hi = mid
                else lo = mid + 1
            }
            return lo
        }

        test('T23 regression reproducer: lore that cannot fit is removed, the send succeeds, and the request is the engine-off one', async () => {
            const lores = loreSet(5, HUGE)
            const db = { maxContext: 400, maxResponse: 10 }
            const off = await sendWith(db, {}, messagesFor(6, true), lores)
            const inj = await recallSend({ ...db, ...on }, {}, messagesFor(6, true), lores)
            expect(inj.ok).toBe(true)
            expect(inj.lore!.outcome).toBe('placed')
            expect(trimmedOf(inj)).toEqual({ removed: 1 })
            expect(requestHas('wwwwwwww')).toBe(false)
            expect(inj.facts).toEqual(off.facts)
        })

        test('T23 regression reproducer: only the lowest-ranked entry is removed when the rest fits', async () => {
            const lores = [loreEntry('target', TARGET_TEXT), loreEntry('huge', HUGE), ...loreSet(WIDE_BOOK).slice(1)]
            const db = { maxContext: 400, maxResponse: 10 }
            const inj = await recallSend({ ...db, ...on }, {}, messagesFor(6, true), lores)
            expect(inj.ok).toBe(true)
            expect(inj.lore!.items).toHaveLength(2)
            expect(trimmedOf(inj)).toEqual({ removed: 1 })
            expect(requestHas('sky citadel')).toBe(true)
            expect(requestHas('wwwwwwww')).toBe(false)
        })

        test('T23 variant: a varying counter shrinks the same way', async () => {
            providerOptions.set('plug', { tokenizer: 'custom' })
            const varying = { aiModel: 'custom', currentPluginProvider: 'plug', maxContext: 400, maxResponse: 10 }
            const inj = await recallSend({ ...varying, ...on }, {}, messagesFor(6, true), loreSet(5, HUGE))
            expect(inj.ok).toBe(true)
            expect(trimmedOf(inj)).toEqual({ removed: 1 })
            expect(requestHas('wwwwwwww')).toBe(false)
        })

        test('T24 new rule: with recalled lore the trim keeps the history floor, or the lore goes', async () => {
            const messages = messagesFor(6, true)
            const lores = loreSet(5, 'roostline ' + 'q'.repeat(590))
            const fitting = await smallestContext(messages, lores)
            const inj = await recallSend({ ...on, maxContext: fitting + 3, maxResponse: 10 }, {}, messages, lores)
            expect(inj.ok).toBe(true)
            expect(inj.lore!.outcome).toBe('placed')
            expect(inj.kept.length).toBeGreaterThanOrEqual(4)
            expect(requestHas('qqqqqqqq')).toBe(false)
            expect(trimmedOf(inj)).toEqual({ removed: 1 })
        })

        const template = {
            promptTemplate: [
                { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN', role: 'system' },
                { type: 'memory', innerFormat: '', role2: 'user' },
                { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
            ],
            promptSettings: {},
        }

        test('T23 row NLC regression reproducer: a recalled chat no card counts is removed at a floor break without disturbing make-room', async () => {
            const db = { ltmEngine: true, ...template, maxContext: 150, maxResponse: 10 }
            const lores = loreSet()
            const without = await recallSend({ ...db, ltmSettings: { searchLore: false } }, {}, messagesFor(14, true), lores)
            const withLore = await recallSend({ ...db, ltmSettings: { searchLore: true } }, {}, messagesFor(14, true), lores)
            expect(without.ok).toBe(true)
            expect(withLore.ok).toBe(true)
            // The engine-off trim keeps fewer than the floor, so the floored trim fails and the lore goes.
            expect(without.kept.length).toBeLessThan(4)
            expect(withLore.lore!.outcome).toBe('placed')
            expect(trimmedOf(withLore)).toEqual({ removed: 1 })
            expect(without.trace!.outcome).toBe('injected')
            expect(withLore.trace!.outcome).toBe('injected')
            expect(Number.isFinite(withLore.trace!.makeRoom!.room)).toBe(true)
            expect(withLore.trace!.makeRoom).toEqual(without.trace!.makeRoom)
            expect(withLore.facts).toEqual(without.facts)
        })

        test('T30 regression reproducer: make-room sees the fixed part without the removed lore (no random CBS in the fixture)', async () => {
            const lores = [loreEntry('target', TARGET_TEXT), loreEntry('huge', HUGE), ...loreSet(WIDE_BOOK).slice(1)]
            const base = { ltmEngine: true, maxContext: 300, maxResponse: 10 }
            const a = await recallSend({ ...base, ltmSettings: { searchLore: true } }, {}, messagesFor(14, true), lores)
            const capOfFirst = Math.ceil(TARGET_TEXT.length / 4)
            const b = await recallSend({ ...base, ltmSettings: { searchLore: true, loreRecallCap: capOfFirst } }, {}, messagesFor(14, true), lores)
            expect(a.lore!.items).toHaveLength(2)
            expect(b.lore!.items).toHaveLength(1)
            expect(trimmedOf(a)).toEqual({ removed: 1 })
            expect(a.trace!.outcome).toBe('injected')
            expect(b.trace!.outcome).toBe('injected')
            expect(a.trace!.makeRoom).toEqual(b.trace!.makeRoom)
            expect(a.facts).toEqual(b.facts)
        })

        test('T23 row template with a lorebook card regression reproducer: lore that cannot fit is removed and the request is the engine-off one', async () => {
            const lorebookTemplate = {
                promptTemplate: [
                    { type: 'plain', type2: 'main', text: 'TEMPLATE-MAIN', role: 'system' },
                    { type: 'lorebook' },
                    { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
                ],
                promptSettings: {},
            }
            const db = { ...lorebookTemplate, maxContext: 400, maxResponse: 10 }
            const off = await sendWith(db, {}, messagesFor(6, true), loreSet(5, HUGE))
            expect(off.ok).toBe(true)
            const inj = await recallSend({ ...db, ...on }, {}, messagesFor(6, true), loreSet(5, HUGE))
            expect(inj.ok).toBe(true)
            expect(inj.lore!.outcome).toBe('placed')
            expect(trimmedOf(inj)).toEqual({ removed: 1 })
            expect(requestHas('wwwwwwww')).toBe(false)
            expect(inj.facts).toEqual(off.facts)
        })

        test('T23 used: a placed recall is in the reply lore-use list and a recall step 1 removed is not', async () => {
            const latest = (await import('../loreUse')).latestLoreUse
            const placed = await recallSend(on, {}, messagesFor(COUNT, true), loreSet())
            expect(placed.lore!.outcome).toBe('placed')
            expect(get(latest)!.entries.map((e) => e.name)).toContain('target')
            const removed = await recallSend({ maxContext: 400, maxResponse: 10, ...on }, {}, messagesFor(6, true), loreSet(5, HUGE))
            expect(removed.ok).toBe(true)
            expect(trimmedOf(removed)).toEqual({ removed: 1 })
            expect((get(latest)?.entries ?? []).map((e) => e.name)).not.toContain('target')
        })
    })

    describe('a send that runs no recall', () => {
        test('regression reproducer: the lore trace of an earlier send is cleared when searchLore is off', async () => {
            const first = await recallSend(on, {}, messagesFor(COUNT, true), loreSet())
            expect(first.lore!.outcome).toBe('placed')
            const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messagesFor(COUNT, true))], { supaMemory: true, globalLore: loreSet() })
            installDb([A], { maxContext: 999999, ltmEngine: true, ltmSettings: { searchLore: false } })
            selectedCharID.set(0)
            h.request.mockReset()
            shadow.resetChroMemoryShadowForTests()
            expect(await sendOnce(A, A.chats[0])).toBe(true)
            expect(requestHas('sky citadel')).toBe(false)
            expect(get(loreTraceStore)).toBeNull()
        })
    })
})
