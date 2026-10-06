// @vitest-environment node

/**
 * The cost and the script-cache sharing of the send's script pass.
 *
 * - An undisturbed streamed send makes no full resolution per flush for a
 *   card without a Lua `editOutput` trigger; with one, each Lua trigger run
 *   costs a bounded number of full resolutions and a flush adds nothing else.
 * - The script cache key is unchanged while no message is hidden: a second
 *   send of the same chat hits it for every unchanged message, and a direct
 *   call with no subject shares the send's entry. When a disabled message
 *   shifts a message's position, the send's entry does not serve a direct
 *   call at the same `chatID`.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real
 * `processScriptFull` (`../scripts`), `../scriptings` (wasmoon), `../modules`,
 * `../lorebook.svelte`, `../../parser/parser.svelte` and `../chatOrigin`. Only
 * the provider request, the memory systems, the trigger engine and the
 * platform/IO packages are mocked; `requestChatData` is a mock, so nothing
 * here says anything about a native backend. `@vitest-environment node` and
 * the inert `dompurify` are for wasmoon's sake, as in
 * `triggerOriginReads.svelte.test.ts`.
 *
 * Tests whose title starts with `guard:` pass with or without the binding:
 * they pin behaviour that must be preserved. The one test of the cache-key
 * block that concerns a disabled message is a reproducer: it fails when the
 * key is the chat position alone. The script cache is reset before every test.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, groupChat, Chat, Message, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import type { WorkHandle } from '../chatOrigin'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): the setup file's stand-in
// throws on `undefined`, which the script pass clones.
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    request: vi.fn(),
    onAddInfo: null as null | (() => void),
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

vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
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
    getModelInfo: vi.fn(() => ({
        id: 'placeholder', name: 'Placeholder Model', shortName: 'Placeholder',
        internalID: 'placeholder', format: 0, provider: 0, tokenizer: 0, flags: [],
    })),
    LLMFlags: {},
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

vi.mock(import('../prereroll'), () => ({
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
let setStreamFlushObserverForTests: typeof import('../index.svelte').setStreamFlushObserverForTests
let beginWork: typeof import('../chatOrigin').beginWork
let resetScriptCache: typeof import('../scripts').resetScriptCache
let refreshModules: typeof import('../modules').refreshModules
let pluginV2: Record<'editoutput' | 'editprocess', Set<(data: string) => Promise<string | null | undefined>>>
let DBState: { db: Database }
let selectedCharID: Selection

beforeAll(async () => {
    const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))

    const index = await import('../index.svelte')
    sendChat = index.sendChat
    doingChat = index.doingChat
    setStreamFlushObserverForTests = index.setStreamFlushObserverForTests
    beginWork = (await import('../chatOrigin')).beginWork
    resetScriptCache = (await import('../scripts')).resetScriptCache
    refreshModules = (await import('../modules')).refreshModules
    pluginV2 = (await import('../../plugins/plugins.svelte')).pluginV2 as unknown as typeof pluginV2
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as Selection
})

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
        characterActive: memberIds.map(() => true), characterTalks: memberIds.map(() => 1),
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

const settle = () => new Promise<void>((r) => setTimeout(r, 0))

/** A send started the way a hinted caller starts one: an origin on `owner`'s `chat`. */
interface Send {
    handle: WorkHandle
    outcome: Promise<boolean | Error>
    failure: Error | null
}

function startSend(owner: Owner, chat: Chat, arg: SendChatArg = {}): Send {
    const handle = beginWork(owner, chat)!
    const send: Send = { handle, outcome: undefined as unknown as Promise<boolean | Error>, failure: null }
    send.outcome = sendChat(-1, { ...arg, origin: handle.origin, originHint: { owner, chat } }).then(
        (value) => value,
        (error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error))
            send.failure = failure
            return failure
        },
    )
    return send
}

async function until(cond: () => boolean, what: string, send?: Send): Promise<void> {
    for (let i = 0; i < 2000; i++) {
        if (cond()) {
            return
        }
        if (send?.failure) {
            throw new Error(`the send threw while waiting for ${what}: ${send.failure.message}`)
        }
        await settle()
    }
    throw new Error(`timed out waiting for ${what}`)
}

/** Ends the send's work handle, then requires that `sendChat` returned true. */
async function complete(send: Send): Promise<void> {
    const result = await send.outcome
    send.handle.end()
    expect(result instanceof Error ? `threw: ${result.message}` : result).toBe(true)
}

/** A non-streamed reply. */
async function sendReply(owner: Owner, chat: Chat, reply: string, arg: SendChatArg = {}): Promise<void> {
    h.request.mockResolvedValueOnce({ type: 'success', result: reply })
    await complete(startSend(owner, chat, arg))
}

interface StreamedSend extends Send {
    push(text: string): void
    close(): void
}

/** A streamed reply. Each chunk carries the whole reply so far. */
async function beginStreamedSend(owner: Owner, chat: Chat, arg: SendChatArg = {}): Promise<StreamedSend> {
    let controller!: ReadableStreamDefaultController<{ data: string }>
    const stream = new ReadableStream<{ data: string }>({ start(c) { controller = c } })
    h.request.mockResolvedValueOnce({ type: 'streaming', result: stream })
    const send = startSend(owner, chat, arg) as StreamedSend
    send.push = (text) => controller.enqueue({ data: text })
    send.close = () => controller.close()
    await until(() => h.request.mock.calls.length > 0, 'the request', send)
    return send
}

async function finishStream(send: StreamedSend): Promise<void> {
    send.close()
    await complete(send)
}

function datas(chat: Chat): string[] {
    return chat.message.map((m) => m.data)
}

/** The prompt of the last request, as the provider layer receives it. */
function promptOf(): PromptEntry[] {
    const body = h.request.mock.calls.at(-1)?.[0] as { formated?: PromptEntry[] } | undefined
    return body?.formated ?? []
}

function luaTrigger(code: string): Record<string, unknown> {
    return { comment: 'lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code }] }
}

function regexScript(inp: string, out: string, type: 'editoutput' | 'editprocess' | 'editinput' | 'editdisplay'): Record<string, unknown> {
    return { comment: `${inp}->${out}`, in: inp, out, type, ableFlag: false }
}

beforeEach(() => {
    h.request.mockReset()
    h.request.mockResolvedValue({ type: 'success', result: 'unexpected' })
    h.onAddInfo = null
    doingChat.set(false)
    resetScriptCache()
    // `getModules` remembers its last result by module ids alone.
    refreshModules()
})

afterEach(() => {
    selectedCharID.set(-1)
    h.onAddInfo = null
    setStreamFlushObserverForTests(null)
    pluginV2.editoutput.clear()
    pluginV2.editprocess.clear()
})

//#endregion

//#region scenario fixtures

let processScriptFull: typeof import('../scripts').processScriptFull
let scriptPassCountersForTests: typeof import('../scripts').scriptPassCountersForTests
let resetScriptPassCountersForTests: typeof import('../scripts').resetScriptPassCountersForTests
let resolutionCountForTests: typeof import('../chatOrigin').resolutionCountForTests
let resetResolutionCountForTests: typeof import('../chatOrigin').resetResolutionCountForTests

beforeAll(async () => {
    const scripts = await import('../scripts')
    processScriptFull = scripts.processScriptFull
    scriptPassCountersForTests = scripts.scriptPassCountersForTests
    resetScriptPassCountersForTests = scripts.resetScriptPassCountersForTests
    const origin = await import('../chatOrigin')
    resolutionCountForTests = origin.resolutionCountForTests
    resetResolutionCountForTests = origin.resetResolutionCountForTests
})

function repeatBack(inp: string, type: 'editoutput' | 'editprocess'): Record<string, unknown> {
    return regexScript(inp, '@@repeat_back end', type)
}

/** A streamed reply delivered as `count` chunks, each one the whole reply so far. */
function cumulative(count: number, prefix: string): string[] {
    const words = Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`)
    return words.map((_, i) => words.slice(0, i + 1).join(' '))
}

interface StreamCost {
    /** The full-resolution count seen at each flush. */
    atFlush: number[]
    /** The full-resolution count when the send has ended. */
    total: number
    /** How many times the `editoutput` script pass ran. */
    outputRuns: number
}

/**
 * Sends one streamed reply of `chunkCount` chunks from a fresh chat of
 * character `A` (whose Lua, if any, is `lua`), letting the send finish each
 * flush before the next chunk arrives.
 */
async function streamCost(chunkCount: number, prefix: string, lua?: string): Promise<StreamCost> {
    const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])], {
        triggerscript: lua === undefined ? [] : [luaTrigger(lua)],
    })
    installDb([A])
    selectedCharID.set(0)
    doingChat.set(false)
    resetScriptCache()

    const atFlush: number[] = []
    setStreamFlushObserverForTests(() => {
        atFlush.push(resolutionCountForTests())
    })
    let outputRuns = 0
    const countRun = async (data: string) => {
        outputRuns++
        return data
    }
    resetResolutionCountForTests()
    pluginV2.editoutput.add(countRun)
    try {
        const send = await beginStreamedSend(A, A.chats[0])
        const chunks = cumulative(chunkCount, prefix)
        for (let i = 0; i < chunks.length; i++) {
            send.push(chunks[i])
            await until(() => atFlush.length >= i + 1, `flush ${i + 1}`, send)
        }
        await finishStream(send)
    } finally {
        pluginV2.editoutput.delete(countRun)
    }
    return { atFlush, total: resolutionCountForTests(), outputRuns }
}

/** The growth of a count from one flush to the next. */
function stepsBetween(counts: number[]): number[] {
    return counts.slice(1).map((count, i) => count - counts[i])
}

/** Lua that returns the reply as it got it and touches no chat variable. */
const luaPassThrough = 'listenEdit("editOutput", function(triggerId, data) return data end)'

/** Lua that counts its own `editOutput` runs in a chat variable. */
const luaCounting = [
    'listenEdit("editOutput", function(triggerId, data)',
    '  local n = tonumber(getChatVar(triggerId, "outruns")) or 0',
    '  setChatVar(triggerId, "outruns", tostring(n + 1))',
    '  return data',
    'end)',
].join('\n')

//#endregion

describe('guard: the resolution cost of a streamed send', () => {
    test('guard: without a Lua editOutput trigger no flush after the first makes a full resolution, and the total does not depend on the number of flushes', async () => {
        const short = await streamCost(2, 'sa')
        const long = await streamCost(30, 'sb')

        expect(long.atFlush).toHaveLength(30)
        expect(long.atFlush.map((count) => count - long.atFlush[0])).toEqual(Array(30).fill(0))
        expect(long.total).toBe(short.total)
    })

    test('guard: with a Lua editOutput trigger that touches no chat variable, each trigger run costs at most one full resolution and a flush costs nothing else', async () => {
        const short = await streamCost(2, 'la', luaPassThrough)
        const long = await streamCost(12, 'lb', luaPassThrough)

        const extraRuns = long.outputRuns - short.outputRuns
        expect(extraRuns).toBe(10)
        expect(long.total - short.total).toBeLessThanOrEqual(extraRuns)
        expect(stepsBetween(long.atFlush).every((step) => step <= 1)).toBe(true)
    })

    test('guard: with a Lua editOutput trigger that reads and writes a chat variable, each trigger run costs at most one full resolution plus one per chat binding it calls', async () => {
        const short = await streamCost(2, 'ca', luaCounting)
        const long = await streamCost(12, 'cb', luaCounting)

        // `luaCounting` calls two chat bindings per run, `getChatVar` and `setChatVar`.
        const perRun = 1 + 2
        const extraRuns = long.outputRuns - short.outputRuns
        expect(extraRuns).toBe(10)
        expect(long.total - short.total).toBeLessThanOrEqual(extraRuns * perRun)
        expect(stepsBetween(long.atFlush).every((step) => step <= perRun)).toBe(true)
    })
})

describe('the script cache key of the send\'s entries', () => {
    const pure = [regexScript('zzz', 'yyy', 'editprocess')]

    test('guard: a second send of the same chat hits the cache for every unchanged message of the prompt pass', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('user', 'u0-plain'),
            msg('char', 'c1-plain'),
            msg('user', 'u2-plain'),
        ])], { customscript: pure })
        installDb([A])
        selectedCharID.set(0)

        resetScriptPassCountersForTests()
        await sendReply(A, A.chats[0], 'reply-one-plain')
        const first = scriptPassCountersForTests()
        resetScriptPassCountersForTests()
        await sendReply(A, A.chats[0], 'reply-two-plain')
        const second = scriptPassCountersForTests()

        expect(datas(A.chats[0]).slice(0, 3)).toEqual(['u0-plain', 'c1-plain', 'u2-plain'])
        // The greeting and the three unchanged messages; the first send's
        // reply is new to the `editprocess` mode.
        expect(first.cacheHits).toBe(0)
        expect(second.cacheHits).toBe(1 + 3)
    })

    test('guard: a direct call with no subject, at the send\'s data and index, hits the send\'s entry', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('user', 'u0-share'),
            msg('char', 'c1-share'),
            msg('user', 'u2-share'),
        ])], { customscript: pure })
        installDb([A])
        selectedCharID.set(0)
        await sendReply(A, A.chats[0], 'reply-share')

        resetScriptPassCountersForTests()
        const direct = await processScriptFull(A, 'u2-share', 'editprocess', 2, { chatRole: 'user' })

        expect(direct.data).toBe('u2-share')
        expect(scriptPassCountersForTests().cacheHits).toBe(1)
    })

    test('with a disabled message earlier, a later message\'s entry does not serve a direct call at the same chatID', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('char', 'c0 TAGc0'),
            msg('user', 'D TAGD', { disabled: true }),
            msg('user', 'u2 TAGu2'),
            msg('char', 'c3'),
        ])], { customscript: [repeatBack('TAG\\w+', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)
        await sendReply(A, A.chats[0], 'reply-hidden-share')
        expect(promptOf().find((entry) => entry.content.startsWith('c3'))?.content).toBe('c3TAGc0')

        resetScriptPassCountersForTests()
        const direct = await processScriptFull(A, 'c3', 'editprocess', 2, { chatRole: 'char' })
        const missed = scriptPassCountersForTests().cacheHits
        const again = await processScriptFull(A, 'c3', 'editprocess', 2, { chatRole: 'char' })

        expect(missed).toBe(0)
        expect(direct.data).toBe('c3TAGD')
        expect(again.data).toBe('c3TAGD')
        expect(scriptPassCountersForTests().cacheHits).toBe(1)
    })
})
