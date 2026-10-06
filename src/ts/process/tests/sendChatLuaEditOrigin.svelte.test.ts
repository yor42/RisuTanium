// @vitest-environment node

/**
 * The send's Lua edit triggers -- `editRequest` before the request and
 * `editOutput` on each reply flush -- are chosen from the chat the send
 * started in, and their chat-variable reads and writes go to that chat under
 * the Lua's own rule: a chat whose id has two holders reads as empty and takes
 * no writes. The selection decides neither.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with real Lua (wasmoon, via
 * `../scriptings`), the real `processScriptFull` (`../scripts`), `../modules`
 * and `../chatOrigin`. Only the provider request, the memory systems, the
 * trigger engine and the platform/IO packages are mocked; `requestChatData`
 * is a mock, so nothing here says anything about a native backend.
 * `@vitest-environment node` and the inert `dompurify` are for wasmoon's sake,
 * as in `triggerOriginReads.svelte.test.ts`.
 *
 * The Lua reproducers observe through `setChatVar`, whose target chat is the
 * property under test. `runCurrentChatFunction` rewrites every message's text
 * at each send's entry, so a fixture does not rely on a message's own tags
 * surviving a send.
 *
 * Tests whose title starts with `guard:` pass with or without the binding:
 * they pin behaviour that must be preserved.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, groupChat, Chat, Message, Database } from '../../storage/database.svelte'
import type { toSaveType } from '../../storage/risuSave'
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
let installCharacterSaveMarks: typeof import('../../storage/characterSaveMarks').installCharacterSaveMarks
let resetCharacterSaveMarksForTest: typeof import('../../storage/characterSaveMarks').resetCharacterSaveMarksForTest
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
    const marks = await import('../../storage/characterSaveMarks')
    installCharacterSaveMarks = marks.installCharacterSaveMarks
    resetCharacterSaveMarksForTest = marks.resetCharacterSaveMarksForTest
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

/** Stream flushes seen so far, and the save marks standing at each of them. */
let flushes = 0
let marksAtFlush: string[][] = []
let standingMarks: string[] = []

async function flushed(count: number, send: Send): Promise<void> {
    await until(() => flushes >= count, `stream flush ${count}`, send)
}

/** Installs a save-mark tracker; the returned array is the live list of marked characters. */
function trackMarks(): string[] {
    const tracker = {
        character: [] as string[], chat: [], botPreset: false, modules: false,
        loadouts: false, plugins: false, pluginCustomStorage: false,
    } as unknown as toSaveType
    standingMarks = tracker.character
    installCharacterSaveMarks({ tracker, schedule: () => {} })
    return standingMarks
}

function datas(chat: Chat): string[] {
    return chat.message.map((m) => m.data)
}

function replyOf(chat: Chat): string | undefined {
    return chat.message.at(-1)?.data
}

/** The prompt of the last request, as the provider layer receives it. */
function promptOf(): PromptEntry[] {
    const body = h.request.mock.calls.at(-1)?.[0] as { formated?: PromptEntry[] } | undefined
    return body?.formated ?? []
}

function promptTextOf(): string {
    return promptOf().map((entry) => entry.content).join('\n')
}

/** Runs `body` with `hook` added to a plugin set, and removes it afterwards. */
async function withPluginHook(mode: 'editoutput' | 'editprocess', hook: (data: string) => Promise<string | null | undefined>, body: () => Promise<void>): Promise<void> {
    pluginV2[mode].add(hook)
    try {
        await body()
    } finally {
        pluginV2[mode].delete(hook)
    }
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
    resetCharacterSaveMarksForTest()
    standingMarks = []
    flushes = 0
    marksAtFlush = []
    setStreamFlushObserverForTests(() => {
        flushes++
        marksAtFlush.push(standingMarks.slice())
    })
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

const seenOnOutput = 'listenEdit("editOutput", function(triggerId, data) setChatVar(triggerId, "seen", "saw:" .. data) return data end)'
const ranOnRequest = 'listenEdit("editRequest", function(triggerId, data) setChatVar(triggerId, "req", "req-ran") return data end)'
const countOnRequest = [
    'listenEdit("editRequest", function(triggerId, data)',
    '  local n = tonumber(getChatVar(triggerId, "n")) or 0',
    '  setChatVar(triggerId, "n", tostring(n + 1))',
    '  return data',
    'end)',
].join('\n')

function tagOnOutput(tag: string): string {
    return `listenEdit("editOutput", function(triggerId, data) return data .. "${tag}" end)`
}

function markOnRequest(value: string): string {
    return `listenEdit("editRequest", function(triggerId, data) setChatVar(triggerId, "from", "${value}") return data end)`
}

function moduleWithLua(id: string, code: string): Record<string, unknown> {
    return { id, name: id, trigger: [luaTrigger(code)] }
}

function scriptstateOf(chat: Chat, key: string): unknown {
    return chat.scriptstate[`$${key}`]
}

/** Two characters; the first one's Lua is `code`. */
function twoWorlds(code: string, extra: Record<string, unknown> = {}): { A: character, B: character } {
    const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])], { triggerscript: [luaTrigger(code)], ...extra })
    const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')])])
    installDb([A, B])
    selectedCharID.set(0)
    return { A, B }
}

/** A character whose two chats share one id; the selection is on the first. */
function dupWorld(extra: Record<string, unknown> = {}): { A: character, first: Chat, second: Chat } {
    const first = makeChat('chat-dup', [msg('user', 'Hi')])
    const second = makeChat('chat-dup', [msg('user', 'Hi'), msg('char', 'second-holder-reply')])
    const A = makeChar('char-A', 'Alice', [first, second], extra)
    installDb([A])
    selectedCharID.set(0)
    return { A, first, second }
}

/** A group with one member; the group is selected. */
function groupWorld(luaForModule: string, memberExtra: Record<string, unknown> = {}): { G: groupChat, M: character } {
    const M = makeChar('char-M', 'Mem', [makeChat('chat-M', [])], { defaultVariables: 'foo=MEMBER', ...memberExtra })
    const G = makeGroup('grp', ['char-M'], [makeChat('chat-G', [msg('user', 'Hi')])], { defaultVariables: 'foo=GROUP' })
    installDb([G, M], { modules: [moduleWithLua('mod-L', luaForModule)], enabledModules: ['mod-L'] })
    selectedCharID.set(0)
    return { G, M }
}

//#endregion

describe('a Lua editOutput trigger across a switch of the selection', () => {
    test('setChatVar during a flush after the switch lands in the send\'s chat and marks it', async () => {
        const { A, B } = twoWorlds(seenOnOutput)
        const marks = trackMarks()

        const send = await beginStreamedSend(A, A.chats[0])
        send.push('lua-one')
        await flushed(1, send)
        marks.length = 0
        selectedCharID.set(1)
        send.push('lua-one two')
        await flushed(2, send)
        await finishStream(send)

        expect(scriptstateOf(A.chats[0], 'seen')).toBe('saw:lua-one two')
        expect(scriptstateOf(B.chats[0], 'seen')).toBeUndefined()
        expect(marksAtFlush[1]).toContain('char-A')
    })

    test('the module Lua triggers that run are those of the send\'s chat', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { modules: ['mod-LA'] })])
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')], { modules: ['mod-LB'] })])
        installDb([A, B], { modules: [moduleWithLua('mod-LA', tagOnOutput('<A>')), moduleWithLua('mod-LB', tagOnOutput('<B>'))] })
        selectedCharID.set(0)
        h.request.mockImplementationOnce(async () => {
            selectedCharID.set(1)
            return { type: 'success', result: 'reply-lua-modules' }
        })

        await complete(startSend(A, A.chats[0]))

        expect(replyOf(A.chats[0])).toBe('reply-lua-modules<A>')
    })
})

describe('a Lua editRequest trigger across a switch of the selection', () => {
    test('setChatVar before the request after the switch lands in the send\'s chat and marks it', async () => {
        const { A, B } = twoWorlds(ranOnRequest)
        trackMarks()
        h.onAddInfo = () => selectedCharID.set(1)
        let marksAtRequest: string[] = []
        h.request.mockImplementationOnce(async () => {
            marksAtRequest = standingMarks.slice()
            return { type: 'success', result: 'reply-lua-request' }
        })

        await complete(startSend(A, A.chats[0]))

        expect(scriptstateOf(A.chats[0], 'req')).toBe('req-ran')
        expect(scriptstateOf(B.chats[0], 'req')).toBeUndefined()
        expect(marksAtRequest).toContain('char-A')
    })

    test('both editRequest runs of a send that stores the prompt text write the send\'s chat', async () => {
        const { A, B } = twoWorlds(countOnRequest)
        DBState.db.promptInfoInsideChat = true
        ;(DBState.db as unknown as Record<string, unknown>).promptTextInfoInsideChat = true
        h.onAddInfo = () => selectedCharID.set(1)

        await sendReply(A, A.chats[0], 'reply-lua-request-twice')

        expect(scriptstateOf(A.chats[0], 'n')).toBe('2')
        expect(scriptstateOf(B.chats[0], 'n')).toBeUndefined()
    })

    test('the module Lua triggers that run are those of the send\'s chat', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { modules: ['mod-LA'] })])
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')], { modules: ['mod-LB'] })])
        installDb([A, B], { modules: [moduleWithLua('mod-LA', markOnRequest('A')), moduleWithLua('mod-LB', markOnRequest('B'))] })
        selectedCharID.set(0)
        h.onAddInfo = () => selectedCharID.set(1)

        await sendReply(A, A.chats[0], 'reply-lua-request-modules')

        expect(scriptstateOf(A.chats[0], 'from')).toBe('A')
        expect(scriptstateOf(B.chats[0], 'from')).toBeUndefined()
    })
})

describe('a Lua trigger in a chat whose id has two holders', () => {
    test('an editOutput setChatVar goes nowhere and the returned text is used', async () => {
        const code = 'listenEdit("editOutput", function(triggerId, data) setChatVar(triggerId, "dupseen", "ran") return data .. "<L>" end)'
        const { A, first, second } = dupWorld({ triggerscript: [luaTrigger(code)] })

        await sendReply(A, first, 'reply-dup-lua-output')

        expect(replyOf(first)).toBe('reply-dup-lua-output<L>')
        expect(scriptstateOf(first, 'dupseen')).toBeUndefined()
        expect(scriptstateOf(second, 'dupseen')).toBeUndefined()
    })

    test('an editRequest setChatVar goes nowhere', async () => {
        const code = 'listenEdit("editRequest", function(triggerId, data) setChatVar(triggerId, "dupreq", "ran") return data end)'
        const { A, first, second } = dupWorld({ triggerscript: [luaTrigger(code)] })

        await sendReply(A, first, 'reply-dup-lua-request')

        expect(scriptstateOf(first, 'dupreq')).toBeUndefined()
        expect(scriptstateOf(second, 'dupreq')).toBeUndefined()
    })

    test('an editOutput getChatVar reads nothing, although the send\'s holder has the variable', async () => {
        const code = 'listenEdit("editOutput", function(triggerId, data) return data .. "<" .. tostring(getChatVar(triggerId, "y")) .. ">" end)'
        const first = makeChat('chat-dup', [msg('user', 'Hi')], { scriptstate: { $y: 'y-first' } })
        const second = makeChat('chat-dup', [msg('user', 'Hi')], { scriptstate: { $y: 'y-second' } })
        const A = makeChar('char-A', 'Alice', [first, second], { triggerscript: [luaTrigger(code)] })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, first, 'reply-dup-read')

        expect(replyOf(first)).toBe('reply-dup-read<null>')
    })
})

describe('guard: with the selection on the send\'s chat throughout, the Lua edit triggers are unchanged', () => {
    test('guard: a single character\'s Lua writes its chat and its output is the Lua\'s, character triggers before module triggers', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { modules: ['mod-LA'] })], {
            triggerscript: [luaTrigger(`${seenOnOutput}\nlistenEdit("editOutput", function(triggerId, data) return data .. "<L>" end)\n${ranOnRequest}`)],
        })
        installDb([A], { modules: [moduleWithLua('mod-LA', tagOnOutput('<A>'))] })
        selectedCharID.set(0)

        const send = await beginStreamedSend(A, A.chats[0])
        send.push('g-one')
        await flushed(1, send)
        await finishStream(send)

        expect(replyOf(A.chats[0])).toBe('g-one<L><A>')
        expect(scriptstateOf(A.chats[0], 'seen')).toBe('saw:g-one')
        expect(scriptstateOf(A.chats[0], 'req')).toBe('req-ran')
    })

    test('guard: a group module\'s editOutput upsertLocalLoreBook writes nothing, and the member\'s editRequest reads the group\'s variable default', async () => {
        const lua = [
            'listenEdit("editOutput", function(triggerId, data)',
            '  upsertLocalLoreBook(triggerId, "state", "S", {})',
            '  setChatVar(triggerId, "out", "ran")',
            '  return data',
            'end)',
            'listenEdit("editRequest", function(triggerId, data)',
            '  setChatVar(triggerId, "dv", getChatVar(triggerId, "foo"))',
            '  return data',
            'end)',
        ].join('\n')
        const { G } = groupWorld(lua)

        await sendReply(G, G.chats[0], 'reply-group-lua')

        expect(scriptstateOf(G.chats[0], 'out')).toBe('ran')
        expect(G.chats[0].localLore).toEqual([])
        expect(scriptstateOf(G.chats[0], 'dv')).toBe('GROUP')
    })

    test('guard: a group send\'s editRequest runs the member\'s triggers and the group\'s modules', async () => {
        const memberLua = 'listenEdit("editRequest", function(triggerId, data) setChatVar(triggerId, "bymember", "yes") return data end)'
        const { G } = groupWorld('listenEdit("editRequest", function(triggerId, data) setChatVar(triggerId, "bymodule", "yes") return data end)', {
            triggerscript: [luaTrigger(memberLua)],
        })

        await sendReply(G, G.chats[0], 'reply-group-triggers')

        expect(scriptstateOf(G.chats[0], 'bymember')).toBe('yes')
        expect(scriptstateOf(G.chats[0], 'bymodule')).toBe('yes')
    })
})
