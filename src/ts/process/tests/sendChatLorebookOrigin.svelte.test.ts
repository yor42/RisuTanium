// @vitest-environment node

/**
 * The send's lorebook scan reads the owner, the chat and the modules of the
 * chat the send started in, and the flags it writes
 * (`@@keep_activate_after_match`, `@@dont_activate_after_match`) land in that
 * chat's `scriptstate` and mark its character for save -- whatever the
 * selection is when the scan runs, Home included.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real
 * `loadLoreBookV3Prompt` (`../lorebook.svelte`), `../modules`,
 * `../../parser/parser.svelte` and `../chatOrigin`. The selection moves at the
 * `additionalInformations` await, the first await before the scan. Only the
 * provider request, the memory systems, the trigger engine and the platform/IO
 * packages are mocked; `requestChatData` is a mock, so nothing here says
 * anything about a native backend. `@vitest-environment node` and the inert
 * `dompurify` are for wasmoon's sake, as in
 * `triggerOriginReads.svelte.test.ts`.
 *
 * Lore content carries no CBS, so a marker in the prompt shows which chat's
 * entry was read, not which chat parsed it.
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

const keepFlagPrefix = '$__internal_ka_'

function keptFlags(chat: Chat): string[] {
    return Object.keys(chat.scriptstate).filter((key) => key.startsWith(keepFlagPrefix))
}

function keepEntry(comment: string, body: string): Record<string, unknown> {
    return lore(comment, `@@keep_activate_after_match\n${body}`)
}

function moduleWithLore(id: string, entries: Record<string, unknown>[]): Record<string, unknown> {
    return { id, name: id, lorebook: entries }
}

/** Sends A's chat, moving the selection to `target` at the first await before the lorebook scan. */
async function sendWithSwitch(A: character, target: number, reply: string): Promise<string[]> {
    let marksAtRequest: string[] = []
    h.onAddInfo = () => selectedCharID.set(target)
    h.request.mockImplementationOnce(async () => {
        marksAtRequest = standingMarks.slice()
        return { type: 'success', result: reply }
    })

    await complete(startSend(A, A.chats[0]))

    return marksAtRequest
}

//#endregion

describe('the lorebook scan across a switch of the selection', () => {
    test('the prompt holds the send\'s character\'s lore, not the selected character\'s', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])], { globalLore: [lore('la', 'OWNER-A-BODY')] })
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')])], { globalLore: [lore('lb', 'OWNER-B-ONLY')] })
        installDb([A, B])
        selectedCharID.set(0)

        await sendWithSwitch(A, 1, 'reply-lore-owner')

        expect(promptTextOf()).toContain('OWNER-A-BODY')
        expect(promptTextOf()).not.toContain('OWNER-B-ONLY')
    })

    test('the prompt holds the send\'s chat\'s local lore, not the selected chat\'s', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { localLore: [lore('ll', 'LOCAL-A-BODY')] })])
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')], { localLore: [lore('llb', 'LOCAL-B-ONLY')] })])
        installDb([A, B])
        selectedCharID.set(0)

        await sendWithSwitch(A, 1, 'reply-lore-chat')

        expect(promptTextOf()).toContain('LOCAL-A-BODY')
        expect(promptTextOf()).not.toContain('LOCAL-B-ONLY')
    })

    test('the prompt holds the lore of the modules the send\'s chat enables, not the selected chat\'s', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { modules: ['mod-lore-A'] })])
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')], { modules: ['mod-lore-B'] })])
        installDb([A, B], {
            modules: [moduleWithLore('mod-lore-A', [lore('ma', 'MODULE-A-BODY')]), moduleWithLore('mod-lore-B', [lore('mb', 'MODULE-B-ONLY')])],
        })
        selectedCharID.set(0)

        await sendWithSwitch(A, 1, 'reply-lore-module')

        expect(promptTextOf()).toContain('MODULE-A-BODY')
        expect(promptTextOf()).not.toContain('MODULE-B-ONLY')
    })

    test('a decorated entry\'s flag lands in the send\'s chat and marks its character', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])], { globalLore: [keepEntry('ka', 'KEEP-A-BODY')] })
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')])], { globalLore: [keepEntry('kb', 'KEEP-B-BODY')] })
        installDb([A, B])
        selectedCharID.set(0)
        trackMarks()

        const marksAtRequest = await sendWithSwitch(A, 1, 'reply-lore-flag')

        expect(keptFlags(A.chats[0])).toHaveLength(1)
        expect(keptFlags(B.chats[0])).toHaveLength(0)
        expect(marksAtRequest).toContain('char-A')
    })
})

describe('the lorebook scan at Home', () => {
    test('an always-active global module entry with a decorator does not stop the send, and its flag lands in the send\'s chat', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])])
        installDb([A], { modules: [moduleWithLore('mod-lore-home', [keepEntry('kh', 'KEEP-HOME-BODY')])], enabledModules: ['mod-lore-home'] })
        selectedCharID.set(0)

        await sendWithSwitch(A, -1, 'reply-lore-home')

        expect(promptTextOf()).toContain('KEEP-HOME-BODY')
        expect(keptFlags(A.chats[0])).toHaveLength(1)
    })
})

describe("guard: with the selection on the send's chat throughout, the lorebook scan is unchanged", () => {
    test("guard: the prompt holds the character's, the chat's and the modules' lore", async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { localLore: [lore('ll', 'LOCAL-A-BODY')], modules: ['mod-lore-A'] })], {
            globalLore: [lore('la', 'OWNER-A-BODY')],
        })
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')])], { globalLore: [lore('lb', 'OWNER-B-ONLY')] })
        installDb([A, B], { modules: [moduleWithLore('mod-lore-A', [lore('ma', 'MODULE-A-BODY')])] })
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'reply-lore-guard')

        expect(promptTextOf()).toContain('OWNER-A-BODY')
        expect(promptTextOf()).toContain('LOCAL-A-BODY')
        expect(promptTextOf()).toContain('MODULE-A-BODY')
        expect(promptTextOf()).not.toContain('OWNER-B-ONLY')
    })

    test("guard: a decorated entry's flag lands in the send's chat", async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])], { globalLore: [keepEntry('ka', 'KEEP-A-BODY')] })
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')])])
        installDb([A, B])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'reply-lore-flag-guard')

        expect(keptFlags(A.chats[0])).toHaveLength(1)
        expect(keptFlags(B.chats[0])).toHaveLength(0)
    })
})
