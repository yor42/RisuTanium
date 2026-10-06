// @vitest-environment happy-dom

/**
 * The send's `@@inject` addresses messages by identity on a database whose
 * `$state` is really proxied, and finding them costs a bounded number of map
 * rebuilds however long the chat is.
 *
 * The node suites compile `$state` without a proxy, so an identity check or a
 * per-access cost that only shows on a proxy is invisible to them; this suite
 * runs under happy-dom, where `$state` is proxied, and has no Lua (`../scriptings`
 * is a passthrough because wasmoon needs an environment without `document`).
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real
 * `processScriptFull` (`../scripts`), `../modules`, `../lorebook.svelte`,
 * `../../parser/parser.svelte` and `../chatOrigin`. Only the provider request,
 * the memory systems, the trigger engine and the platform/IO packages are
 * mocked; `requestChatData` is a mock, so nothing here says anything about a
 * native backend.
 *
 * `runCurrentChatFunction` replaces `chat.message` with a new array of the
 * same messages at each send's entry, so every scenario below runs across that
 * replacement. The script cache is reset before every test.
 *
 * The tests of the first block are reproducers: each fails when the pass
 * addresses a message by its position, because the wrong message is written or
 * the pattern is left in place. The tests of the second block, titled
 * `guard:`, pin the cost of finding the messages through the lookup's
 * test-only counters, and also check that each message received its own
 * `@@inject` write, so they too fail when a message is addressed by position.
 */
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

// Inert passthrough: sanitization is not what this suite tests.
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

// No Lua: the edit triggers hand their text back unchanged.
vi.mock(import('../scriptings'), () => ({
    runLuaEditTrigger: vi.fn(async (_char: unknown, _type: string, data: string) => data),
}) as unknown as typeof import('../scriptings'))

// Real: `../../util`, `../scripts`, `../modules`,
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

/** Stream flushes seen so far. */
let flushes = 0

async function flushed(count: number, send: Send): Promise<void> {
    await until(() => flushes >= count, `stream flush ${count}`, send)
}

function datas(chat: Chat): string[] {
    return chat.message.map((m) => m.data)
}

/** The prompt of the last request, as the provider layer receives it. */
function promptOf(): PromptEntry[] {
    const body = h.request.mock.calls.at(-1)?.[0] as { formated?: PromptEntry[] } | undefined
    return body?.formated ?? []
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
    flushes = 0
    setStreamFlushObserverForTests(() => {
        flushes++
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

let messageMapRebuildsForTests: typeof import('../index.svelte').messageMapRebuildsForTests
let resetMessageMapRebuildsForTests: typeof import('../index.svelte').resetMessageMapRebuildsForTests
let scriptPassCountersForTests: typeof import('../scripts').scriptPassCountersForTests
let resetScriptPassCountersForTests: typeof import('../scripts').resetScriptPassCountersForTests

beforeAll(async () => {
    const index = await import('../index.svelte')
    messageMapRebuildsForTests = index.messageMapRebuildsForTests
    resetMessageMapRebuildsForTests = index.resetMessageMapRebuildsForTests
    const scripts = await import('../scripts')
    scriptPassCountersForTests = scripts.scriptPassCountersForTests
    resetScriptPassCountersForTests = scripts.resetScriptPassCountersForTests
})

function inject(inp: string, type: 'editoutput' | 'editprocess'): Record<string, unknown> {
    return regexScript(inp, '@@inject', type)
}

/** Appends `!` to the text of every message that carries `INJ`, so that what `@@inject` writes differs from what the message held. */
const suffixHook = async (data: string) => (data.includes('INJ') ? `${data}!` : data)

/**
 * Installs one character with one chat holding `messages` and returns the
 * character and chat as the database now holds them, which are proxies of the
 * fixtures that went in.
 */
function proxiedWorld(messages: Message[]): { A: character, chat: Chat } {
    const raw = makeChar('char-A', 'Alice', [makeChat('chat-A', messages)], {
        customscript: [inject('INJ', 'editoutput'), inject('INJ', 'editprocess')],
    })
    installDb([raw])
    selectedCharID.set(0)
    const A = DBState.db.characters[0] as character
    expect(A).not.toBe(raw)
    return { A, chat: A.chats[0] }
}

//#endregion

describe('@@inject addresses messages by identity on a proxied database', () => {
    test('with a disabled message earlier, the prompt pass writes the processed message and no other, across the replacement of the message array', async () => {
        const { A, chat } = proxiedWorld([
            msg('user', 'u0-text', { disabled: true }),
            msg('char', 'c1-text'),
            msg('user', 'INJ u2-text'),
        ])
        const arrayBefore = chat.message
        const before = [...chat.message]
        pluginV2.editprocess.add(suffixHook)

        await sendReply(A, chat, 'reply-proxied-disabled')

        expect(chat.message).not.toBe(arrayBefore)
        expect(chat.message.slice(0, 3).map((m, i) => m === before[i])).toEqual([true, true, true])
        expect(datas(chat).slice(0, 3)).toEqual(['u0-text', 'c1-text', 'INJ u2-text!'])
        expect(chat.message).toHaveLength(4)
    })

    test('with a disabled message earlier, two enabled messages that carry the pattern each receive their own write', async () => {
        const { A, chat } = proxiedWorld([
            msg('user', 'u0-text', { disabled: true }),
            msg('char', 'INJ c1-text'),
            msg('user', 'INJ u2-text'),
        ])
        const before = [...chat.message]
        pluginV2.editprocess.add(suffixHook)

        await sendReply(A, chat, 'reply-proxied-two')

        expect(chat.message.slice(0, 3).map((m, i) => m === before[i])).toEqual([true, true, true])
        expect(datas(chat).slice(0, 3)).toEqual(['u0-text', 'INJ c1-text!', 'INJ u2-text!'])
    })

    test('the streamed reply is written and stripped, and no other message changes, when an earlier message is deleted during the flush', async () => {
        const { A, chat } = proxiedWorld([msg('user', 'u0'), msg('char', 'c1'), msg('user', 'u2')])
        const before = [...chat.message]
        let deleted = false
        pluginV2.editoutput.add(async (data: string) => {
            if (!deleted && data.includes('INJ')) {
                deleted = true
                chat.message.splice(0, 1)
                await settle()
            }
            return data
        })

        const send = await beginStreamedSend(A, chat)
        send.push('body INJ one')
        await flushed(1, send)
        await finishStream(send)

        expect(deleted).toBe(true)
        expect(datas(chat)).toEqual(['c1', 'u2', 'body  one'])
        expect(chat.message[0]).toBe(before[1])
        expect(chat.message[1]).toBe(before[2])
    })
})

describe('guard: finding the messages of the prompt pass costs a bounded number of map rebuilds', () => {
    const length = 2000

    /** A disabled message first, then alternating roles, each carrying the pattern. */
    function longChat(): Message[] {
        const messages: Message[] = [msg('char', 'D-text', { disabled: true })]
        for (let i = 1; i < length; i++) {
            messages.push(msg(i % 2 === 1 ? 'user' : 'char', `INJ m${i}`))
        }
        return messages
    }

    /** The messages that do not hold their own text with the suffix `@@inject` wrote, message `first + k` being expected at `k`. */
    function notInjected(messages: Message[], first: number): string[] {
        return messages
            .map((m, k) => (m.data === `INJ m${first + k}!` ? '' : `${first + k}: ${m.data}`))
            .filter((problem) => problem !== '')
    }

    test('guard: the pass builds no map while nothing moves, and never scans for a message', async () => {
        const { A, chat } = proxiedWorld(longChat())
        pluginV2.editprocess.add(suffixHook)
        resetMessageMapRebuildsForTests()
        resetScriptPassCountersForTests()

        await sendReply(A, chat, 'reply-long-still')

        expect(messageMapRebuildsForTests()).toBe(0)
        expect(scriptPassCountersForTests().scans).toBe(0)
        expect(chat.message[0].data).toBe('D-text')
        expect(chat.message).toHaveLength(length + 1)
        expect(notInjected(chat.message.slice(1, length), 1)).toEqual([])
    }, 60000)

    test('guard: the pass builds one map when a message before the processed ones is deleted mid-pass', async () => {
        const { A, chat } = proxiedWorld(longChat())
        let deleted = false
        pluginV2.editprocess.add(async (data: string) => {
            if (!deleted && data.includes('INJ')) {
                deleted = true
                chat.message.splice(0, 1)
            }
            return suffixHook(data)
        })
        resetMessageMapRebuildsForTests()
        resetScriptPassCountersForTests()

        await sendReply(A, chat, 'reply-long-shifted')

        expect(deleted).toBe(true)
        expect(messageMapRebuildsForTests()).toBe(1)
        expect(scriptPassCountersForTests().scans).toBe(0)
        expect(chat.message).toHaveLength(length)
        expect(notInjected(chat.message.slice(0, length - 1), 1)).toEqual([])
    }, 60000)
})
