// @vitest-environment node

/**
 * The start trigger and Lua under the prompt view: while a send builds the
 * prompt, the start trigger's system-prompt effects (`systemprompt`,
 * `v2SystemPrompt`), including those of every run the start trigger starts,
 * read only sent messages. Every other trigger parse, Lua's `cbs()`, the Lua
 * chat functions and the Lua lorebook scan keep reading the whole chat.
 *
 * Drives the REAL `sendChat` (`../index.svelte`) with the real trigger engine
 * (`../triggers`), Lua (wasmoon, through `../scriptings`), scripts, lorebook,
 * parser, CBS and `../chatOrigin`. Only the provider request, the embedding
 * processor, the memory systems and the platform/IO packages are mocked;
 * `requestChatData` is a mock, so nothing here says anything about a native
 * backend. `@vitest-environment node` and the inert `dompurify` are for
 * wasmoon's sake, as in `sendChatPromptReads.svelte.test.ts`, whose mock set
 * this suite shares apart from the trigger engine.
 *
 * A start trigger can replace the chat's message list (`cutchat`,
 * `v2CutChat`, Lua `setFullChat`) or edit it in place (Lua `removeChat`,
 * `addChat`) before a later effect is parsed; the tests below put a hidden
 * message where a set of hidden messages taken before the trigger would
 * point at another message.
 *
 * Tests whose title starts with `guard:` pass with or without the prompt
 * view: they pin behaviour that must be preserved. Every other test is a
 * reproducer of a behaviour the prompt view changes.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, Chat, Message, Database } from '../../storage/database.svelte'
import type { SendChatArg } from '../index.svelte'
import type { WorkHandle } from '../chatOrigin'
// Installs the real `globalThis.safeStructuredClone`, the same way
// `src/main.ts` does (`import "./ts/polyfill"`): the setup file's stand-in
// throws on `undefined`, which the script pass clones.
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    request: vi.fn(),
    queries: [] as string[],
    searchResult: [] as string[],
    tokPerChat: 1,
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
    readImage: vi.fn(async () => new Uint8Array([1, 2, 3])),
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

// `tokenizeChat` answers `h.tokPerChat` for every chat, so a test decides how
// soon the context overflows into the memory systems.
vi.mock(import('../../tokenizer'), () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return h.tokPerChat }
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

// The embedding processor records what the additional-information query
// searched for and answers with `h.searchResult`; `addText` is the hook a
// test uses to change the world in the middle of a send.
vi.mock(import('../memory/hypamemory'), () => ({
    HypaProcesser: class {
        async addText() { h.onAddInfo?.() }
        async similaritySearch(query: string) { h.queries.push(query); return h.searchResult }
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

// The real plugin module reads `document` at load time.
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

vi.mock(import('../tts'), () => ({
    sayTTS: vi.fn(),
}) as unknown as typeof import('../tts'))

vi.mock(import('../memory/hanuraiMemory'), () => ({
    hanuraiMemory: vi.fn(),
}) as unknown as typeof import('../memory/hanuraiMemory'))

// The two memory systems that are not exercised for real here record their
// arguments (the send's subject, when it passes one, is a trailing argument)
// and hand the chats back untouched.
vi.mock(import('../memory/hypav2'), () => ({
    hypaMemoryV2: vi.fn(async (chats: OpenAIChat[], currentTokens: number, ..._rest: Array<object | number>) => ({ chats, currentTokens })),
}) as unknown as typeof import('../memory/hypav2'))

vi.mock(import('../memory/hypav3'), () => ({
    hypaMemoryV3: vi.fn(async (chats: OpenAIChat[], currentTokens: number, ..._rest: Array<object | number>) => ({ chats, currentTokens })),
}) as unknown as typeof import('../memory/hypav3'))

vi.mock(import('../group'), () => ({
    groupOrder: vi.fn((order: unknown) => order),
}) as unknown as typeof import('../group'))

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

// Real: `../../util`, `../scripts`, `../scriptings` (wasmoon), `../triggers`,
// `../modules`, `../lorebook.svelte`, `../../parser/parser.svelte`,
// `../../parser/chatML`, `../../cbs`, `../../parser/chatVar.svelte`,
// `../chatOrigin`, `../exampleMessages`, `../embedding/addinfo`,
// `../memory/supaMemory`, `../index.svelte`.

//#endregion


//#region fixtures and helpers

type Selection = Writable<number>

interface PromptEntry {
    role: string
    content: string
}

interface RequestBody {
    formated?: PromptEntry[]
}

let sendChat: typeof import('../index.svelte').sendChat
let doingChat: typeof import('../index.svelte').doingChat
let beginWork: typeof import('../chatOrigin').beginWork
let resetScriptCache: typeof import('../scripts').resetScriptCache
let refreshModules: typeof import('../modules').refreshModules
let DBState: { db: Database }
let selectedCharID: Selection

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
})

beforeEach(() => {
    h.request.mockReset()
    h.queries.length = 0
    h.searchResult = []
    h.onAddInfo = null
    doingChat.set(false)
    resetScriptCache()
    refreshModules()
})

afterEach(() => {
    selectedCharID.set(-1)
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

function makeChar(chaId: string, name: string, chats: Chat[], extra: Record<string, unknown> = {}): character {
    return {
        chaId, name, type: 'character', chatPage: 0, firstMessage: 'Hello!', alternateGreetings: [],
        desc: `${name} desc`, personality: '', scenario: '', bias: [], utilityBot: false,
        inlayViewScreen: false, reloadKeys: 0, supaMemory: false, customscript: [], triggerscript: [],
        globalLore: [], emotionImages: [], additionalAssets: [], modules: [], exampleMessage: '', chats, ...extra,
    } as unknown as character
}

function installDb(characters: character[], extra: Record<string, unknown> = {}): void {
    DBState.db = {
        formatversion: 5, botPresets: [], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        personas: [], selectedPersona: 0, characterOrder: characters.map((c) => c.chaId), characters,
        statics: { messages: 0 }, aiModel: 'gpt-3.5-turbo', maxContext: 999999, maxResponse: 500,
        bias: [], mainPrompt: '', globalNote: '', jailbreakToggle: false, chainOfThought: false,
        personaPrompt: '', promptPreprocess: false, additionalPrompt: '', descriptionPrefix: '',
        promptTemplate: undefined, promptInfoInsideChat: false,
        formatingOrder: ['main', 'description', 'personaPrompt', 'chats', 'lastChat', 'jailbreak', 'lorebook', 'globalNote', 'authorNote'],
        autoContinueMinTokens: 0, autoContinueChat: false, igpPrompt: '', notification: false,
        removeIncompleteResponse: false, streamingDisplayOptimizationMode: 'off', ttsAutoSpeech: false,
        presetChain: '', outputImageModal: false, rememberToolUsage: false, supaModelType: 'none',
        supaMemoryPrompt: '', hypav2: false, hypaV3: false, hanuraiEnable: false, inlayErrorResponse: false,
        loreBookDepth: 20, loreBookToken: 999999, templateDefaultVariables: '', globalChatVariables: {},
        enabledModules: [], username: 'GlobalUser', userIcon: 'global.png', ...extra,
    } as unknown as Database
    ;(globalThis as unknown as { __risuTestDb: Database }).__risuTestDb = DBState.db
}

interface Captured {
    outcome: boolean | Error
    promptText: string
    chat: Chat
}

/** One whole send from Alice's chat, with the selection on it, and what it asked the provider for. */
async function sendFrom(A: character, arg: SendChatArg = {}): Promise<Captured> {
    selectedCharID.set(0)
    h.request.mockReset()
    h.request.mockImplementation(async (_body: RequestBody, mode: string) => {
        if (mode === 'memory') return { type: 'success', result: 'SUMMARY' }
        if (mode === 'emotion') return { type: 'success', result: 'EMO' }
        return { type: 'success', result: 'reply' }
    })
    const chat = A.chats[0]
    const handle: WorkHandle = beginWork(A, chat)!
    let outcome: boolean | Error
    try {
        outcome = await sendChat(-1, { ...arg, origin: handle.origin, originHint: { owner: A, chat } })
    } catch (error) {
        outcome = error instanceof Error ? error : new Error(String(error))
    }
    handle.end()
    const calls = h.request.mock.calls as Array<[RequestBody, string]>
    const model = calls.find((c) => c[1] === 'model')?.[0]
    return { outcome, promptText: (model?.formated ?? []).map((e) => e.content).join('\n'), chat }
}

const RESET = 'RESET-MARK'
const BRANCH = 'BRANCH-COMMENT'

const editprocess = (inp: string, out: string, extra: Record<string, unknown> = {}): Record<string, unknown> => (
    { comment: `${inp}->${out}`, in: inp, out, type: 'editprocess', ableFlag: false, ...extra }
)

/** The text between the first `open` and the next `close`, or `null`. */
function between(text: string, open: string, close: string): string | null {
    const from = text.indexOf(open)
    if (from < 0) return null
    const to = text.indexOf(close, from + open.length)
    return to < 0 ? null : text.slice(from + open.length, to)
}

//#endregion

//#region trigger fixtures

type Trigger = Record<string, unknown>

const trig = (comment: string, type: string, effect: Array<Record<string, unknown>>): Trigger => ({ comment, type, conditions: [], effect })
const luaTrig = (code: string): Trigger => trig('lua', 'start', [{ type: 'triggerlua', code }])

/** The effects that put text into the prompt: version 1 and version 2. */
const sysPrompt = (value: string): Record<string, unknown> => ({ type: 'systemprompt', location: 'promptend', value })
const v2SysPrompt = (value: string): Record<string, unknown> => ({ type: 'v2SystemPrompt', indent: 0, location: 'promptend', valueType: 'value', value })
const setVar = (name: string, value: string): Record<string, unknown> => ({ type: 'setvar', var: name, operator: '=', value })
const v2SetVar = (name: string, value: string): Record<string, unknown> => ({ type: 'v2SetVar', indent: 0, var: name, operator: '=', valueType: 'value', value })
const cutChat = (start: number, end: number): Record<string, unknown> => ({ type: 'cutchat', start: `${start}`, end: `${end}` })
const v2CutChat = (start: number, end: number): Record<string, unknown> => ({ type: 'v2CutChat', indent: 0, startType: 'value', start: `${start}`, endType: 'value', end: `${end}` })
const runTriggerEffect = (name: string): Record<string, unknown> => ({ type: 'runtrigger', value: name })
const v2RunTriggerEffect = (name: string): Record<string, unknown> => ({ type: 'v2RunTrigger', indent: 0, target: name })

interface WorldOptions {
    charA?: Record<string, unknown>
    chatA?: Record<string, unknown>
    db?: Record<string, unknown>
}

/**
 * Alice with `messages` as her chat, the first message `FIRSTMSG` and the
 * alternate greeting `GREETING-1`, and `triggers` as her trigger scripts; the
 * character as the database now holds it.
 */
function triggerWorld(messages: Message[], triggers: Trigger[], o: WorldOptions = {}): character {
    const A = makeChar('char-A', 'Alice', [makeChat('chat-A', messages, o.chatA)], {
        firstMessage: 'FIRSTMSG', alternateGreetings: ['GREETING-1'], triggerscript: triggers, ...o.charA,
    })
    installDb([A], o.db)
    return DBState.db.characters[0] as character
}

/** A branched chat ends with a disabled "branched from" comment. */
const branched = (): Message[] => [msg('user', 'Q0'), msg('char', 'A1'), msg('char', BRANCH, { disabled: true })]

//#endregion

//#region 2: the first message stays unsent when a start trigger removes the reset

describe('a start trigger that removes the reset does not make the walk-back fall back to the unsent first message', () => {
    const prevChar = editprocess('^hi$', 'hi (p={{previouscharchat}})')
    const found = (r: Captured): string | null => /hi \(p=([^)]*)\)/.exec(r.promptText)?.[1] ?? null
    /** A chat whose reset is the first message and whose next message is the one the script processes. */
    const afterReset = (): Message[] => [msg('user', RESET, { disabled: 'allBefore' }), msg('char', 'hi'), msg('user', 'Q')]

    const removers: Array<[string, Trigger]> = [
        ['cutchat', trig('cut', 'start', [cutChat(1, 3)])],
        ['v2CutChat', trig('cut', 'start', [v2CutChat(1, 3)])],
        ['Lua setFullChat', luaTrig(`
function onStart(triggerId)
    local chat = getFullChat(triggerId)
    table.remove(chat, 1)
    setFullChat(triggerId, chat)
end
`)],
    ]

    for (const [name, remover] of removers) {
        test(`${name} removing the reset: {{previouscharchat}} returns nothing, because the first message was not sent`, async () => {
            const A = triggerWorld(afterReset(), [remover], { charA: { customscript: [prevChar] } })
            const r = await sendFrom(A)
            expect(r.outcome).toBe(true)
            expect(A.chats[0].message.map((m) => m.data), 'the trigger removed the reset').toEqual(['hi', 'Q', 'reply'])
            expect(found(r)).toBe('')
        })
    }

    test('guard: a cutchat that keeps a chat with no reset leaves the sent first message as the fallback', async () => {
        const A = triggerWorld([msg('char', 'hi'), msg('user', 'Q')], [trig('cut', 'start', [cutChat(0, 2)])], { charA: { customscript: [prevChar] } })
        const r = await sendFrom(A)
        expect(found(r)).toBe('FIRSTMSG')
    })
})

//#endregion

//#region 7: the history tags and walk-backs in the start trigger's system-prompt effects

describe('the start trigger\'s system-prompt effects read only sent messages', () => {
    test('a version 1 systemprompt effect\'s {{lastmessage}} skips the trailing disabled comment of a branched chat', async () => {
        const A = triggerWorld(branched(), [trig('start', 'start', [sysPrompt('SPD<<{{lastmessage}}>>')])])
        const r = await sendFrom(A)
        expect(between(r.promptText, 'SPD<<', '>>')).toBe('A1')
    })

    test('a version 2 v2SystemPrompt effect\'s {{lastmessage}} skips the trailing disabled comment of a branched chat', async () => {
        const A = triggerWorld(branched(), [trig('start', 'start', [v2SysPrompt('SPD<<{{lastmessage}}>>')])])
        const r = await sendFrom(A)
        expect(between(r.promptText, 'SPD<<', '>>')).toBe('A1')
    })

    const nested: Array<[string, Trigger[]]> = [
        ['runtrigger', [trig('start', 'start', [runTriggerEffect('inner')]), trig('inner', 'manual', [v2SysPrompt('SPD<<{{lastmessage}}>>')])]],
        ['v2RunTrigger', [trig('start', 'start', [v2RunTriggerEffect('inner')]), trig('inner', 'manual', [sysPrompt('SPD<<{{lastmessage}}>>')])]],
        ['a run started by a run started by the start trigger', [
            trig('start', 'start', [runTriggerEffect('mid')]),
            trig('mid', 'manual', [v2RunTriggerEffect('inner')]),
            trig('inner', 'manual', [v2SysPrompt('SPD<<{{lastmessage}}>>')]),
        ]],
    ]

    for (const [name, triggers] of nested) {
        test(`a manual trigger run by ${name} hands back system-prompt text that skips the trailing disabled comment of a branched chat`, async () => {
            const A = triggerWorld(branched(), triggers)
            const r = await sendFrom(A)
            expect(between(r.promptText, 'SPD<<', '>>')).toBe('A1')
        })
    }

    test('guard: a manual run started outside a send still reads the whole chat', async () => {
        const A = triggerWorld(branched(), [trig('inner', 'manual', [v2SysPrompt('SPD<<{{lastmessage}}>>')])])
        const { runTrigger } = await import('../triggers')
        const handle = beginWork(A, A.chats[0])!
        const result = await runTrigger(A, 'manual', { chat: A.chats[0], manualName: 'inner', origin: handle.origin })
        handle.end()
        expect(result?.additonalSysPrompt.promptend).toContain(`SPD<<${BRANCH}>>`)
    })

    test('guard: the start trigger\'s variable effects read the whole chat', async () => {
        const A = triggerWorld(branched(), [trig('start', 'start', [setVar('tv', '{{lastmessage}}'), v2SetVar('tv2', '{{lastmessage}}')])])
        await sendFrom(A)
        expect(A.chats[0].scriptstate.$tv).toBe(BRANCH)
        expect(A.chats[0].scriptstate.$tv2).toBe(BRANCH)
    })

    test('guard: the variable effects of a manual run started by the start trigger read the whole chat', async () => {
        const A = triggerWorld(branched(), [trig('start', 'start', [runTriggerEffect('inner')]), trig('inner', 'manual', [setVar('tv', '{{lastmessage}}')])])
        await sendFrom(A)
        expect(A.chats[0].scriptstate.$tv).toBe(BRANCH)
    })

    const cutters: Array<[string, Record<string, unknown>]> = [['cutchat', cutChat(1, 3)], ['v2CutChat', v2CutChat(1, 3)]]

    for (const [name, cutter] of cutters) {
        test(`after ${name} replaces the list and shifts the indices, a later system-prompt {{previouscharchat}} does not return the disabled message`, async () => {
            const A = triggerWorld(
                [msg('char', 'C0-TEXT'), msg('char', 'C1-HID', { disabled: true }), msg('user', 'U2-TEXT')],
                [trig('start', 'start', [cutter, sysPrompt('PC<<{{previouscharchat}}>>')])],
            )
            const r = await sendFrom(A)
            expect(r.outcome).toBe(true)
            expect(between(r.promptText, 'PC<<', '>>')).toBe('FIRSTMSG')
        })
    }

    test('after Lua removeChat and addChat edit the list in place, a later trigger\'s system-prompt {{history}} holds the sent messages only', async () => {
        const A = triggerWorld(
            [msg('char', 'C0-TEXT'), msg('char', 'D-HID', { disabled: true }), msg('user', 'U2-TEXT')],
            [
                luaTrig(`
function onStart(triggerId)
    removeChat(triggerId, 0)
    addChat(triggerId, 'user', 'ADDED')
end
`),
                trig('history', 'start', [sysPrompt('H<<{{history}}>>')]),
            ],
        )
        const r = await sendFrom(A)
        expect(r.outcome).toBe(true)
        const text = between(r.promptText, 'H<<', '>>') ?? ''
        expect(text, 'the tag expanded').toContain('U2-TEXT')
        expect(text).toContain('ADDED')
        expect(text).not.toContain('D-HID')
    })

    test('guard: Lua cbs() reads the whole chat', async () => {
        const A = triggerWorld(branched(), [luaTrig(`
function onStart(triggerId)
    setChatVar(triggerId, 'cbsOut', cbs('CBSTXT<<{{lastmessage}}>>'))
end
`)])
        await sendFrom(A)
        expect(A.chats[0].scriptstate.$cbsOut).toBe(`CBSTXT<<${BRANCH}>>`)
    })

    test('guard: the Lua chat functions read the whole chat', async () => {
        const A = triggerWorld(branched(), [luaTrig(`
function onStart(triggerId)
    setChatVar(triggerId, 'luaLast', getChatData(triggerId, -1))
    setChatVar(triggerId, 'luaLen', tostring(getChatLength(triggerId)))
end
`)])
        await sendFrom(A)
        expect(A.chats[0].scriptstate.$luaLast).toBe(BRANCH)
        expect(A.chats[0].scriptstate.$luaLen).toBe('3')
    })
})

//#endregion

//#region 8: the lorebook scan from Lua

describe('guard: the lorebook scan a Lua trigger runs reads the whole chat', () => {
    test('guard: loadLoreBooks activates an entry whose keyword is only in a disabled message', async () => {
        const A = triggerWorld(
            [msg('user', 'q0'), msg('user', 'a zebra passes', { disabled: true }), msg('char', 'ok'), msg('user', 'hello')],
            [luaTrig(`
onStart = async(function(triggerId)
    local books = loadLoreBooks(triggerId)
    local out = ''
    for i, b in ipairs(books) do out = out .. b.data end
    setChatVar(triggerId, 'luaLore', out)
end)
`)],
            { charA: {
                lowLevelAccess: true,
                globalLore: [{ comment: 'zebra', content: 'LORE-ZEBRA', mode: 'normal', insertorder: 100, alwaysActive: false, key: 'zebra', secondkey: '', selective: false }],
            } },
        )
        const r = await sendFrom(A)
        expect(r.outcome).toBe(true)
        expect(A.chats[0].scriptstate.$luaLore).toContain('LORE-ZEBRA')
    })
})

//#endregion

//#region 9: the view follows the list as the start trigger leaves it

/**
 * Each system-prompt parse describes the message list as it stands at that
 * parse, and the send's decision on the first message is the one taken before
 * the start trigger ran, whatever the trigger does to the list.
 */
describe('a system-prompt parse describes the message list as it stands at that parse', () => {
    test('a system-prompt {{history}} before and one after Lua edits the list in place, keeping its length, each hold the sent messages only', async () => {
        const A = triggerWorld(
            [msg('char', 'C0-TEXT'), msg('char', 'D-HID', { disabled: true }), msg('user', 'U2-TEXT')],
            [
                trig('before', 'start', [sysPrompt('E<<{{history}}>>')]),
                luaTrig(`
function onStart(triggerId)
    removeChat(triggerId, 0)
    addChat(triggerId, 'user', 'ADDED')
end
`),
                trig('after', 'start', [sysPrompt('H<<{{history}}>>')]),
            ],
        )
        const r = await sendFrom(A)
        expect(r.outcome).toBe(true)
        const before = between(r.promptText, 'E<<', '>>') ?? ''
        const after = between(r.promptText, 'H<<', '>>') ?? ''
        expect(before, 'the tag expanded before the edit').toContain('C0-TEXT')
        expect(before).toContain('U2-TEXT')
        expect(before).not.toContain('D-HID')
        expect(after, 'the tag expanded after the edit').toContain('U2-TEXT')
        expect(after).toContain('ADDED')
        expect(after).not.toContain('D-HID')
    })

    const cutters: Array<[string, Record<string, unknown>]> = [['cutchat', cutChat(1, 3)], ['v2CutChat', v2CutChat(1, 3)]]

    for (const [name, cutter] of cutters) {
        test(`a system-prompt {{previouscharchat}} before and one after ${name} shifts the indices each skip the disabled message`, async () => {
            const A = triggerWorld(
                [msg('char', 'C0-TEXT'), msg('char', 'C1-HID', { disabled: true }), msg('user', 'U2-TEXT')],
                [trig('start', 'start', [sysPrompt('E<<{{previouscharchat}}>>'), cutter, sysPrompt('PC<<{{previouscharchat}}>>')])],
            )
            const r = await sendFrom(A)
            expect(r.outcome).toBe(true)
            expect(between(r.promptText, 'E<<', '>>'), 'before the cut').toBe('C0-TEXT')
            expect(between(r.promptText, 'PC<<', '>>'), 'after the cut').toBe('FIRSTMSG')
        })
    }

    const parse = 'PC<<{{previouscharchat}}>>'
    const resetRemovers: Array<[string, Trigger[]]> = [
        ['cutchat', [trig('cut', 'start', [cutChat(1, 3), sysPrompt(parse)])]],
        ['v2CutChat', [trig('cut', 'start', [v2CutChat(1, 3), v2SysPrompt(parse)])]],
        ['Lua setFullChat', [
            luaTrig(`
function onStart(triggerId)
    local chat = getFullChat(triggerId)
    table.remove(chat, 1)
    setFullChat(triggerId, chat)
end
`),
            trig('prompt', 'start', [sysPrompt(parse)]),
        ]],
    ]

    for (const [name, triggers] of resetRemovers) {
        test(`a system-prompt {{previouscharchat}} after ${name} removes the reset returns nothing, because the first message was not sent`, async () => {
            const A = triggerWorld([msg('user', RESET, { disabled: 'allBefore' }), msg('user', 'Q1'), msg('user', 'Q2')], triggers)
            const r = await sendFrom(A)
            expect(r.outcome).toBe(true)
            expect(A.chats[0].message.map((m) => m.data).slice(0, 2), 'the trigger removed the reset').toEqual(['Q1', 'Q2'])
            expect(between(r.promptText, 'PC<<', '>>')).toBe('')
        })
    }

    test('after a start-trigger cutchat shifts the indices, the per-message pass\'s {{previouscharchat}} skips the message that is disabled now', async () => {
        const A = triggerWorld(
            [msg('char', 'C0-TEXT'), msg('char', 'C1-VIS'), msg('char', 'C2-HID', { disabled: true }), msg('user', 'U3'), msg('char', 'hi')],
            [trig('cut', 'start', [cutChat(1, 5)])],
            { charA: { customscript: [editprocess('^hi$', 'hi (p={{previouscharchat}})')] } },
        )
        const r = await sendFrom(A)
        expect(r.outcome).toBe(true)
        expect(A.chats[0].message.map((m) => m.data).slice(0, 4), 'the trigger cut the first message').toEqual(['C1-VIS', 'C2-HID', 'U3', 'hi'])
        expect(/hi \(p=([^)]*)\)/.exec(r.promptText)?.[1]).toBe('C1-VIS')
    })

    test('the expansion after the reply keeps the send\'s decision that the first message was not sent, although a start trigger removed the reset', async () => {
        const A = triggerWorld(
            [msg('user', RESET, { disabled: 'allBefore' }), msg('user', 'Q1')],
            [
                trig('cut', 'start', [cutChat(1, 2)]),
                luaTrig(`
function onStart(triggerId)
    addChat(triggerId, 'user', 'ADD p={{previouscharchat}}')
end
`),
            ],
        )
        const r = await sendFrom(A)
        expect(r.outcome).toBe(true)
        expect(A.chats[0].message.map((m) => m.data).slice(0, 2), 'the trigger removed the reset and added a message').toEqual(['Q1', 'ADD p='])
    })
})

//#endregion
