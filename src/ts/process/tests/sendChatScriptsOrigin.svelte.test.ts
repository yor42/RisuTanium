// @vitest-environment node

/**
 * The send's script pass -- regex scripts, module regex, and the `@@inject`
 * and `@@repeat_back` branches -- reads the chat the send started in, and
 * writes only to it, whatever the selection is by the time each call runs.
 * The `@@` branches address the message they were called for, not a position.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real
 * `processScriptFull` (`../scripts`), `../modules`, `../lorebook.svelte`,
 * `../../parser/parser.svelte` and `../chatOrigin`. Only the provider request,
 * the memory systems, the trigger engine and the platform/IO packages are
 * mocked; `requestChatData` is a mock, so nothing here says anything about a
 * native backend. `@vitest-environment node` and the inert `dompurify` are for
 * wasmoon's sake, as in `triggerOriginReads.svelte.test.ts`.
 *
 * `runCurrentChatFunction` rewrites every message's text at each send's entry,
 * so a fixture does not rely on a message's own tags surviving a send. The
 * script cache is reset before every test and each test uses chunk text no
 * other test shares, because the cache key collides between the non-streamed
 * first reply and a streamed reply at the same index.
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

let processScriptFull: typeof import('../scripts').processScriptFull

beforeAll(async () => {
    processScriptFull = (await import('../scripts')).processScriptFull
})

const modA = { id: 'mod-A', name: 'mod-A', regex: [regexScript('AAA', 'a-done', 'editoutput')] }
const modB = { id: 'mod-B', name: 'mod-B', regex: [regexScript('BBB', 'b-done', 'editoutput')] }

function inject(inp: string, type: 'editoutput' | 'editprocess'): Record<string, unknown> {
    return regexScript(inp, '@@inject', type)
}

function repeatBack(inp: string, type: 'editoutput' | 'editprocess'): Record<string, unknown> {
    return regexScript(inp, '@@repeat_back end', type)
}

/** Two characters, each with one chat that enables its own module. */
function twoWorlds(): { A: character, B: character } {
    const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')], { modules: ['mod-A'] })])
    const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0'), msg('char', 'B-ORIGINAL')], { modules: ['mod-B'] })])
    installDb([A, B], { modules: [modA, modB] })
    selectedCharID.set(0)
    return { A, B }
}

//#endregion

describe('a streamed reply\'s script pass across a switch of the selection', () => {
    test('the module regex list is the one of the chat the send started in', async () => {
        const { A } = twoWorlds()

        const send = await beginStreamedSend(A, A.chats[0])
        send.push('start AAA BBB')
        await flushed(1, send)
        selectedCharID.set(1)
        send.push('start AAA BBB end')
        await flushed(2, send)
        await finishStream(send)

        expect(replyOf(A.chats[0])).toBe('start a-done BBB end')
    })

    test('@@inject leaves the selected chat\'s message at the reply\'s index alone and strips the pattern from the reply', async () => {
        const { A, B } = twoWorlds()
        A.customscript.push(inject('INJECT_ME', 'editoutput') as never)

        const send = await beginStreamedSend(A, A.chats[0])
        send.push('one INJECT_ME')
        await flushed(1, send)
        selectedCharID.set(1)
        send.push('one INJECT_ME two')
        await flushed(2, send)
        await finishStream(send)

        expect(datas(B.chats[0])).toEqual(['b0', 'B-ORIGINAL'])
        expect(replyOf(A.chats[0])).toBe('one  two')
    })

    test('@@inject writes the reply and strips its pattern when an earlier message is deleted during the flush', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0'), msg('char', 'c1'), msg('user', 'u2')])], {
            customscript: [inject('INJ', 'editoutput')],
        })
        installDb([A])
        selectedCharID.set(0)
        let deleted = false
        const deleteFirstMessage = async (data: string) => {
            if (!deleted && data.includes('INJ')) {
                deleted = true
                A.chats[0].message.splice(0, 1)
                await settle()
            }
            return data
        }

        await withPluginHook('editoutput', deleteFirstMessage, async () => {
            const send = await beginStreamedSend(A, A.chats[0])
            send.push('body INJ one')
            await flushed(1, send)
            await finishStream(send)
        })

        expect(deleted).toBe(true)
        expect(datas(A.chats[0])).toEqual(['c1', 'u2', 'body  one'])
    })
})

describe('the prompt pass\'s @@inject and @@repeat_back address the message being processed', () => {
    const suffixHook = async (data: string) => (data.includes('INJ') ? `${data}!` : data)

    test('@@inject with a disabled message earlier writes the processed message, not the one at its position among the sent messages', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('user', 'u0-text', { disabled: true }),
            msg('char', 'c1-text'),
            msg('user', 'INJ u2-text'),
        ])], { customscript: [inject('INJ', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)

        await withPluginHook('editprocess', suffixHook, () => sendReply(A, A.chats[0], 'reply-disabled'))

        expect(datas(A.chats[0]).slice(0, 3)).toEqual(['u0-text', 'c1-text', 'INJ u2-text!'])
    })

    test('@@inject after an allBefore reset writes the processed message, not the one at its position among the sent messages', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('user', 'm0-text'),
            msg('char', 'm1-text'),
            msg('user', 'm2-text', { disabled: 'allBefore' }),
            msg('char', 'c3-text'),
            msg('user', 'INJ u4-text'),
        ])], { customscript: [inject('INJ', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)

        await withPluginHook('editprocess', suffixHook, () => sendReply(A, A.chats[0], 'reply-reset'))

        expect(datas(A.chats[0]).slice(0, 5)).toEqual(['m0-text', 'm1-text', 'm2-text', 'c3-text', 'INJ u4-text!'])
    })

    test('@@repeat_back with a disabled message earlier compares against the processed message\'s role', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('char', 'c0 TAGc0'),
            msg('user', 'D TAGD', { disabled: true }),
            msg('user', 'u2 TAGu2'),
            msg('char', 'c3'),
        ])], { customscript: [repeatBack('TAG\\w+', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'reply-repeat-back')

        const processed = promptOf().find((entry) => entry.content.startsWith('c3'))
        expect(processed?.content).toBe('c3TAGc0')
    })

    test('@@inject marks the send\'s character for save before the request', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('user', 'u0-text', { disabled: true }),
            msg('char', 'c1-text'),
            msg('user', 'INJ u2-text'),
        ])], { customscript: [inject('INJ', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)
        trackMarks()
        let marksAtRequest: string[] = []
        h.request.mockImplementationOnce(async () => {
            marksAtRequest = standingMarks.slice()
            return { type: 'success', result: 'reply-mark' }
        })

        await withPluginHook('editprocess', suffixHook, async () => {
            await complete(startSend(A, A.chats[0]))
        })

        expect(datas(A.chats[0]).slice(0, 3)).toEqual(['u0-text', 'c1-text', 'INJ u2-text!'])
        expect(marksAtRequest).toContain('char-A')
    })

    test('guard: without an @@inject script nothing marks the send\'s character before the request', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('user', 'u0-text', { disabled: true }),
            msg('char', 'c1-text'),
            msg('user', 'INJ u2-text'),
        ])])
        installDb([A])
        selectedCharID.set(0)
        trackMarks()
        let marksAtRequest: string[] = []
        h.request.mockImplementationOnce(async () => {
            marksAtRequest = standingMarks.slice()
            return { type: 'success', result: 'reply-mark-control' }
        })

        await complete(startSend(A, A.chats[0]))

        expect(marksAtRequest).not.toContain('char-A')
    })

    test('after two messages are deleted during the pass, @@inject writes no message with another message\'s text', async () => {
        const messages: Message[] = [msg('char', 'D-text', { disabled: true, chatId: 'mD' })]
        for (let i = 1; i < 12; i++) {
            messages.push(msg(i % 2 === 1 ? 'user' : 'char', `INJ m${i}`, { chatId: `m${i}` }))
        }
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)], { customscript: [inject('INJ', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)
        const chat = A.chats[0]
        let calls = 0
        const deleteFirstTwice = async (data: string) => {
            if (data.includes('INJ')) {
                calls++
                if (calls === 1 || calls === 5) {
                    chat.message.splice(0, 1)
                }
                return `${data}!`
            }
            return data
        }

        await withPluginHook('editprocess', deleteFirstTwice, () => sendReply(A, chat, 'reply-two-deletions'))

        expect(calls).toBeGreaterThan(5)
        const foreign = chat.message.slice(0, -1)
            .filter((m) => m.data !== `INJ ${m.chatId}` && m.data !== `INJ ${m.chatId}!`)
            .map((m) => `${m.chatId}: ${m.data}`)
        expect(foreign).toEqual([])
    })

    test('the index tags of the prompt pass describe the chat index of the message and the walk-back reads the nearest earlier sent message', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [
            msg('char', 'c0 T0'),
            msg('char', 'c1 T1'),
            msg('user', 'D-text', { disabled: true }),
            msg('char', 'c3 T3'),
            msg('char', 'c4'),
        ])], { customscript: [regexScript('^c4$', 'c4 i={{chat_index}} p={{previouscharchat}}', 'editprocess')] })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'reply-index-tags')

        const processed = promptOf().find((entry) => entry.content.startsWith('c4'))
        expect(processed?.content).toBe('c4 i=4 p=c3 T3')
    })
})

describe('the non-streamed first reply\'s @@ branches across a switch of the selection', () => {
    test('@@inject leaves the selected chat\'s message alone when that chat is longer than the send\'s chat', async () => {
        const { A, B } = twoWorlds()
        A.customscript.push(inject('INJ', 'editoutput') as never)
        h.request.mockImplementationOnce(async () => {
            selectedCharID.set(1)
            return { type: 'success', result: 'first INJ reply' }
        })

        await complete(startSend(A, A.chats[0]))

        expect(datas(B.chats[0])).toEqual(['b0', 'B-ORIGINAL'])
        expect(replyOf(A.chats[0])).toBe('first INJ reply')
    })

    test('@@repeat_back reads nothing from the selected chat', async () => {
        const { A, B } = twoWorlds()
        B.chats[0].message = [msg('char', 'B STATUS:3'), msg('char', 'B-ORIGINAL')]
        A.customscript.push(repeatBack('STATUS:\\d+', 'editoutput') as never)
        h.request.mockImplementationOnce(async () => {
            selectedCharID.set(1)
            return { type: 'success', result: 'first plain' }
        })

        await complete(startSend(A, A.chats[0]))

        expect(replyOf(A.chats[0])).toBe('first plain')
    })
})

describe('guard: the non-streamed reply\'s @@ branches behave as before', () => {
    test('guard: @@inject on the first reply leaves the reply as sent, pattern included, and the chat alone', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi')])], {
            customscript: [inject('INJ', 'editoutput')],
        })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'first reply INJ tail')

        expect(datas(A.chats[0])).toEqual(['Hi', 'first reply INJ tail'])
    })

    test('guard: @@repeat_back on the first reply in a non-empty chat appends nothing', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0'), msg('char', 'c1 STATUS:5'), msg('user', 'u2')])], {
            customscript: [repeatBack('STATUS:\\d+', 'editoutput')],
            firstMessage: 'Welcome STATUS:9',
        })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'first reply nonempty')

        expect(replyOf(A.chats[0])).toBe('first reply nonempty')
    })

    test('guard: @@repeat_back on the first reply in an empty chat appends the first message\'s match', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [])], {
            customscript: [repeatBack('STATUS:\\d+', 'editoutput')],
            firstMessage: 'Welcome STATUS:9',
        })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], 'first reply empty')

        expect(replyOf(A.chats[0])).toBe('first reply emptySTATUS:9')
    })

    test('guard: @@inject on a continue strips the pattern from the continued reply', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'q'), msg('char', 'Part one')])], {
            customscript: [inject('INJ', 'editoutput')],
        })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], ' INJ two', { continue: true })

        expect(datas(A.chats[0])).toEqual(['q', 'Part one  two'])
    })

    test('guard: @@repeat_back on a continue compares against the continued message', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'q'), msg('char', 'Part one')])], {
            customscript: [repeatBack('STATUS:\\d+', 'editoutput')],
            firstMessage: 'Welcome STATUS:9',
        })
        installDb([A])
        selectedCharID.set(0)

        await sendReply(A, A.chats[0], ' two', { continue: true })

        expect(datas(A.chats[0])).toEqual(['q', 'Part one twoSTATUS:9'])
    })
})

describe('guard: with the selection on the send\'s chat throughout, the script pass is unchanged', () => {
    test('guard: a single character\'s streamed reply and prompt pass apply the scripts, the module regex and the lorebook flag', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'Hi INJP')], { modules: ['mod-A'] })], {
            customscript: [inject('INJP', 'editprocess'), inject('INJO', 'editoutput')],
            globalLore: [lore('la', 'LORE-A-BODY'), lore('lk', '@@keep_activate_after_match\nKEEP-A-BODY')],
        })
        installDb([A], { modules: [modA] })
        selectedCharID.set(0)

        const send = await beginStreamedSend(A, A.chats[0])
        send.push('x INJO AAA')
        await flushed(1, send)
        await finishStream(send)

        expect(datas(A.chats[0])).toEqual(['Hi INJP', 'x  a-done'])
        expect(promptTextOf()).toContain('LORE-A-BODY')
        expect(promptTextOf()).not.toContain('INJP')
        expect(Object.keys(A.chats[0].scriptstate).filter((key) => key.startsWith('$__internal_ka_'))).toHaveLength(1)
    })

    test('guard: a group\'s streamed reply and prompt pass apply the group\'s scripts', async () => {
        const member = makeChar('char-M', 'Mem', [makeChat('chat-M', [])])
        const group = makeGroup('grp', ['char-M'], [makeChat('chat-G', [msg('user', 'Hi INJP')])], {
            customscript: [inject('INJP', 'editprocess'), inject('INJO', 'editoutput'), regexScript('AAA', 'a-done', 'editoutput')],
        })
        installDb([group, member])
        selectedCharID.set(0)

        const send = await beginStreamedSend(group, group.chats[0])
        send.push('x INJO AAA')
        await flushed(1, send)
        await finishStream(send)

        expect(datas(group.chats[0])).toEqual(['Hi INJP', 'x  a-done'])
        expect(promptTextOf()).not.toContain('INJP')
    })
})

describe('a chat whose id has two holders', () => {
    function dupWorld(): { A: character, first: Chat, second: Chat } {
        const first = makeChat('chat-dup', [msg('user', 'Hi')], { modules: ['mod-A'] })
        const second = makeChat('chat-dup', [msg('user', 'Hi'), msg('char', 'second-holder-reply')], { modules: ['mod-B'] })
        const A = makeChar('char-A', 'Alice', [first, second])
        installDb([A], { modules: [modA, modB] })
        selectedCharID.set(0)
        return { A, first, second }
    }

    test('guard: with the selection on the holder the send started from, the module regex list is that holder\'s', async () => {
        const { A, first } = dupWorld()

        const send = await beginStreamedSend(A, first)
        send.push('start AAA BBB dup-still')
        await flushed(1, send)
        await finishStream(send)

        expect(replyOf(first)).toBe('start a-done BBB dup-still')
    })

    test('the module regex list stays the send\'s holder\'s after the selection moves to the other holder', async () => {
        const { A, first } = dupWorld()

        const send = await beginStreamedSend(A, first)
        send.push('start AAA BBB dup-moved')
        await flushed(1, send)
        A.chatPage = 1
        send.push('start AAA BBB dup-moved end')
        await flushed(2, send)
        await finishStream(send)

        expect(replyOf(first)).toBe('start a-done BBB dup-moved end')
    })

    test('@@inject writes the send\'s holder, not the holder the selection moved to', async () => {
        const { A, first, second } = dupWorld()
        A.customscript.push(inject('INJECT_ME', 'editoutput') as never)

        const send = await beginStreamedSend(A, first)
        send.push('one INJECT_ME')
        await flushed(1, send)
        A.chatPage = 1
        send.push('one INJECT_ME two')
        await flushed(2, send)
        await finishStream(send)

        expect(datas(second)).toEqual(['Hi', 'second-holder-reply'])
        expect(replyOf(first)).toBe('one  two')
    })
})

describe('guard: a call with no subject and no named message reads the selection', () => {
    test('guard: @@inject writes the selected chat\'s message at the given index', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0'), msg('char', 'c1')])], {
            customscript: [inject('INJ', 'editprocess')],
        })
        installDb([A])
        selectedCharID.set(0)

        const result = await processScriptFull(A, 'INJ x', 'editprocess', 1, { chatRole: 'user' })

        expect(result.data).toBe(' x')
        expect(datas(A.chats[0])).toEqual(['u0', 'INJ x'])
    })

    test('guard: the module regex list is the selected chat\'s', async () => {
        const { A } = twoWorlds()
        selectedCharID.set(1)

        const result = await processScriptFull(A, 'AAA BBB', 'editoutput', -1, {})

        expect(result.data).toBe('AAA b-done')
    })

    test("guard: an editdisplay call applies the character's display scripts", async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0')])], {
            customscript: [regexScript('DDD', 'd-done', 'editdisplay')],
        })
        installDb([A])
        selectedCharID.set(0)

        const result = await processScriptFull(A, 'DDD', 'editdisplay', 0, {})

        expect(result.data).toBe('d-done')
    })

    test('guard: @@repeat_back reads the selected chat from the given index', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0 STATUS:7'), msg('user', 'u1')])], {
            customscript: [repeatBack('STATUS:\\d+', 'editprocess')],
        })
        installDb([A])
        selectedCharID.set(0)

        const result = await processScriptFull(A, 'plain', 'editprocess', 1, {})

        expect(result.data).toBe('plainSTATUS:7')
    })
})
