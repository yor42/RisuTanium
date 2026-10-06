// @vitest-environment node

/**
 * Parsing through the send's own subject changes nothing while the selection
 * is on the send's chat: every CBS tag and alias (each bare, with two
 * arguments and with a numeric argument, plus a few compound expressions),
 * parsed with and without a real `SendSubject`, across `chatID` -1 and 1 and
 * with and without a `chara`, for a character send and for a group send whose
 * member is the `chara`.
 *
 * `Math.random` is replaced by a counter that is reset before each side of a
 * comparison and the clock is frozen, so the two sides draw the same values;
 * nothing else in the parser is nondeterministic. Running the no-subject side
 * twice must agree, which is what makes a difference between the sides mean
 * something.
 *
 * Drives the real parser, `../../cbs`, `../../util`, `../modules` and
 * `../chatOrigin`. Nothing here needs a provider request.
 *
 * Tests whose title starts with `guard:` pass with or without the binding:
 * they pin behaviour that must be preserved.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { character, groupChat, Chat, Message, Database, RisuPersona } from '../../storage/database.svelte'
import type { OpenAIChat, SendChatArg } from '../index.svelte'
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

vi.mock(import('../triggers'), () => ({
    runTrigger: vi.fn(async () => undefined),
}) as unknown as typeof import('../triggers'))

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
// `../lorebook.svelte`, `../../parser/parser.svelte`, `../../parser/chatML`,
// `../../cbs`, `../../parser/chatVar.svelte`, `../chatOrigin`,
// `../exampleMessages`, `../embedding/addinfo`, `../memory/supaMemory`,
// `../index.svelte`.

//#endregion

//#region fixtures and helpers

type Owner = character | groupChat
type Selection = Writable<number>

interface PromptEntry {
    role: string
    content: string
    multimodals?: unknown[]
}

interface RequestBody {
    formated?: PromptEntry[]
    biasString?: Array<[string, number]>
}

let sendChat: typeof import('../index.svelte').sendChat
let doingChat: typeof import('../index.svelte').doingChat
let beginWork: typeof import('../chatOrigin').beginWork
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let resolutionCountForTests: typeof import('../chatOrigin').resolutionCountForTests
let resetResolutionCountForTests: typeof import('../chatOrigin').resetResolutionCountForTests
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
    const origin = await import('../chatOrigin')
    beginWork = origin.beginWork
    createSendSubject = origin.createSendSubject
    resolutionCountForTests = origin.resolutionCountForTests
    resetResolutionCountForTests = origin.resetResolutionCountForTests
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
    h.tokPerChat = 1
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

//#endregion

//#region the prompt-reads world

/**
 * Every field a prompt parse reads carries `{{char}}`, `{{user}}` and a
 * per-chat variable, so the text a parse produces names the character, the
 * persona and the chat it read.
 */
const TAGS = '{{char}}/{{user}}/{{getvar::who}}'
/** What `TAGS` reads as in chat A, whose owner is Alice, bound to persona A. */
const FROM_A = 'Alice/PersonaA/VAR-A'
const FROM_B = 'Bob/PersonaB/VAR-B'

/** The persona at `selectedPersona`: its saved entry lags the editing buffer in `db`. */
const PERSONA_SELECTED: RisuPersona = { id: 'p-S', name: 'SelectedPersona', personaPrompt: 'PS-PROMPT', icon: 'sel.png', note: 'PS-NOTE' }
const PERSONA_A: RisuPersona = { id: 'p-A', name: 'PersonaA', personaPrompt: 'PA-PROMPT', icon: 'a.png', note: '' }
const PERSONA_B: RisuPersona = { id: 'p-B', name: 'PersonaB', personaPrompt: 'PB-PROMPT', icon: 'b.png', note: '' }
const GLOBAL_PROMPT = 'GLOBAL-PROMPT'

const MODULE_A = { id: 'mod-A', name: 'mod-A', customModuleToggle: 'modA=Mod A toggle', assets: [['pic', 'path-a', 'png']] }
const MODULE_B = { id: 'mod-B', name: 'mod-B', customModuleToggle: 'modB=Mod B toggle', assets: [['picb', 'path-b', 'png']] }

function lore(comment: string, content: string): Record<string, unknown> {
    return { comment, content, mode: 'normal', insertorder: 100, alwaysActive: true, key: '', secondkey: '', selective: false }
}

interface WorldOptions {
    db?: Record<string, unknown>
    charA?: Record<string, unknown>
    messagesA?: Message[]
    chatA?: Record<string, unknown>
}

/**
 * Two characters: Alice (chat A, bound to persona A, module A, variable
 * `who` = `VAR-A`) and Bob (chat B, persona B, module B, `VAR-B`). The
 * selected persona is a third one, so neither chat is bound to it. The
 * selection is left to the test.
 */
function world(o: WorldOptions = {}): { A: character, B: character } {
    const A = makeChar('char-A', 'Alice', [makeChat('chat-A', o.messagesA ?? [msg('user', 'U0 hi')], {
        bindedPersona: 'p-A', modules: ['mod-A'], note: `NOTE[${TAGS}]`, scriptstate: { $who: 'VAR-A' }, ...o.chatA,
    })], {
        desc: `DESC[${TAGS}]`, personality: `PERS[${TAGS}]`, scenario: `SCEN[${TAGS}]`, firstMessage: `FIRST[${TAGS}]`,
        exampleMessage: `<START>\n{{user}}: EXU[${TAGS}]\n{{char}}: EXC[${TAGS}]`, ...o.charA,
    })
    const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')], {
        bindedPersona: 'p-B', modules: ['mod-B'], scriptstate: { $who: 'VAR-B' },
    })])
    installDb([A, B], {
        personas: [{ ...PERSONA_SELECTED }, { ...PERSONA_A }, { ...PERSONA_B }], selectedPersona: 0,
        modules: [MODULE_A, MODULE_B], personaPrompt: GLOBAL_PROMPT, ...o.db,
    })
    return { A, B }
}

/** A prompt-template card list that reaches every card class the send parses. */
function templateDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        promptTemplate: [
            { type: 'plain', text: `TPLMAIN[${TAGS}]`, role: 'system', type2: 'main' },
            { type: 'persona', innerFormat: `PCARD[${TAGS}] {{slot}}` },
            { type: 'description', innerFormat: `DCARD[${TAGS}] {{slot}}` },
            { type: 'authornote', innerFormat: `ACARD[${TAGS}] {{slot}}`, defaultText: 'x' },
            { type: 'chatML', text: `<|im_start|>system\nCHATML[${TAGS}]<|im_end|>` },
            { type: 'plain', text: `TPLPLAIN[${TAGS}]`, role: 'system', type2: 'normal' },
            { type: 'plain', text: `TPLGN[${TAGS}]`, role: 'system', type2: 'globalNote' },
            { type: 'jailbreak', text: `TPLJB[${TAGS}]`, role: 'system' },
            { type: 'cot', text: `TPLCOT[${TAGS}]`, role: 'system' },
            { type: 'lorebook' },
            { type: 'chat', rangeStart: 0, rangeEnd: 'end' },
        ],
        promptSettings: {}, promptInfoInsideChat: true, promptTextInfoInsideChat: true,
        botPresets: [{ name: 'PRESET' }], botPresetsId: 0, customPromptTemplateToggle: '',
        jailbreakToggle: true, chainOfThought: true,
        globalChatVariables: { toggle_modA: '1', toggle_modB: '1' },
        ...extra,
    }
}

/** The bracketed text of the first `label[...]` marker in `text`, or `null` when there is none. */
function marker(text: string, label: string): string | null {
    const found = new RegExp(`\\b${label}\\[[^\\]]*\\]`).exec(text)
    return found ? found[0] : null
}

interface Captured {
    outcome: boolean | Error
    /** The `model` requests, in order. */
    models: RequestBody[]
    /** The prompt of the first `model` request. */
    prompt: PromptEntry[]
    promptText: string
    biasString: Array<[string, number]> | undefined
    memoryBodies: PromptEntry[][]
    emotionBodies: PromptEntry[][]
    queries: string[]
    replyPromptInfo: { promptName?: string, promptToggles?: Array<{ key: string, value: string }>, promptText?: OpenAIChat[] } | undefined
    supaMemoryData: string | undefined
}

function textOf(entries: PromptEntry[]): string {
    return entries.map((e) => e.content).join('\n')
}

/** Answers every request kind; `model` replies `reply`, `memory` replies `SUMMARY`, `emotion` replies `EMO`. */
function installRequestMock(): void {
    h.request.mockReset()
    h.request.mockImplementation(async (_body: RequestBody, mode: string) => {
        if (mode === 'memory') return { type: 'success', result: 'SUMMARY' }
        if (mode === 'emotion') return { type: 'success', result: 'EMO' }
        return { type: 'success', result: 'reply' }
    })
}

function capture(outcome: boolean | Error, chat: Chat): Captured {
    const calls = h.request.mock.calls as Array<[RequestBody, string]>
    const models = calls.filter((c) => c[1] === 'model').map((c) => c[0])
    const prompt = models[0]?.formated ?? []
    return {
        outcome,
        models,
        prompt,
        promptText: textOf(prompt),
        biasString: models[0]?.biasString,
        memoryBodies: calls.filter((c) => c[1] === 'memory').map((c) => c[0].formated ?? []),
        emotionBodies: calls.filter((c) => c[1] === 'emotion').map((c) => c[0].formated ?? []),
        queries: [...h.queries],
        replyPromptInfo: chat.message.at(-1)?.promptInfo,
        supaMemoryData: chat.supaMemoryData,
    }
}

/**
 * One whole send from `owner`'s `chat`, with the selection at `selection`
 * from its first line (`-1` is Home), and what it asked the provider for.
 */
async function sendWith(owner: Owner, chat: Chat, selection: number, arg: SendChatArg = {}): Promise<Captured> {
    selectedCharID.set(selection)
    installRequestMock()
    h.queries.length = 0
    const send = startSend(owner, chat, arg)
    const outcome = await send.outcome
    send.handle.end()
    return capture(outcome, chat)
}

/**
 * Memoises one scenario per key, so the tests that each look at one part of
 * the same send share a single run. The run happens inside the first test
 * that asks, after the per-test reset.
 */
const scenarios = new Map<string, Captured>()
async function scenario(key: string, run: () => Promise<Captured>): Promise<Captured> {
    let found = scenarios.get(key)
    if (!found) {
        found = await run()
        scenarios.set(key, found)
    }
    return found
}

//#endregion

//#region the corpus

/** Every registered CBS tag name and alias, as the registry itself lists them. */
async function tagNames(): Promise<string[]> {
    const { registerCBS, defaultCBSRegisterArg } = await import('../../cbs')
    const names = new Set<string>()
    registerCBS({
        ...defaultCBSRegisterArg,
        registerFunction: (spec) => {
            names.add(spec.name)
            for (const alias of spec.alias) {
                names.add(alias)
            }
        },
    })
    return [...names]
}

async function corpus(): Promise<string[]> {
    const tags: string[] = []
    for (const name of await tagNames()) {
        tags.push(`{{${name}}}`, `{{${name}::a::b}}`, `{{${name}::0}}`)
    }
    tags.push(
        '{{#when {{getvar::x}}}}YES{{/when}}', '{{#when::var::x}}VAR{{/when}}', '{{? 1+{{getvar::n}}}}',
        '{{lorebook::LB}}', '{{char}} said {{user}} to {{char}}',
    )
    return tags
}

const FROZEN_NOW = new Date('2026-01-02T03:04:05Z')
let drawn = 0

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FROZEN_NOW)
    vi.spyOn(Math, 'random').mockImplementation(() => ((drawn++ * 0.6180339887) % 1))
})

afterEach(() => {
    vi.useRealTimers()
    vi.mocked(Math.random).mockRestore()
})

function attempt(fn: () => string): string {
    try {
        return fn()
    } catch (error) {
        return `THROW:${(error as Error).message}`
    }
}

interface Comparison {
    same: number
    nondeterministic: string[]
    differing: string[]
}

/**
 * Parses the whole corpus for `owner`'s `chat` with and without a send
 * subject (and `member`, for a group), resetting the random counter and the
 * chat variables before each side.
 */
async function compare(owner: Owner, chat: Chat, member: character | undefined): Promise<Comparison> {
    const parser = await import('../../parser/parser.svelte')
    const handle = beginWork(owner, chat, member)!
    const subject = createSendSubject(handle.origin, { owner, chat })
    if (member) {
        expect(subject.pinMember()).toBe(true)
    }
    const tags = await corpus()
    const seedVars = () => {
        chat.scriptstate = { $x: '5', $n: '2' }
        chat.GLGlobalVariables = {}
    }
    const result: Comparison = { same: 0, nondeterministic: [], differing: [] }
    for (const chatID of [-1, 1]) {
        for (const withChara of [true, false]) {
            const base = { chara: withChara ? (member ?? owner) : undefined, chatID }
            for (const tag of tags) {
                // The parser counts its call depth in the options object it is
                // given, so every parse gets a fresh one.
                const side = (withSubject: boolean) => {
                    drawn = 0
                    seedVars()
                    return attempt(() => parser.risuChatParser(tag, withSubject ? { ...base, subject } : { ...base }))
                }
                const first = side(false)
                const second = side(false)
                if (first !== second) {
                    result.nondeterministic.push(`chatID=${chatID} chara=${withChara} ${tag}`)
                    continue
                }
                const bound = side(true)
                if (first === bound) {
                    result.same++
                } else {
                    result.differing.push(`chatID=${chatID} chara=${withChara} ${tag} :: none=${JSON.stringify(first).slice(0, 60)} subject=${JSON.stringify(bound).slice(0, 60)}`)
                }
            }
        }
    }
    handle.end()
    return result
}

//#endregion

describe('guard: parsing through the send\'s subject changes nothing while the selection is on the send\'s chat', () => {
    test('guard: a character send parses every tag the same with and without its subject', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0'), msg('char', 'c1'), msg('user', 'u2')], { bindedPersona: 'p-A', modules: ['mod-A'] })])
        installDb([A], { personas: [{ ...PERSONA_SELECTED }, { ...PERSONA_A }], modules: [MODULE_A], personaPrompt: GLOBAL_PROMPT })
        selectedCharID.set(0)

        const result = await compare(A, A.chats[0], undefined)

        expect(result.nondeterministic).toEqual([])
        expect(result.differing).toEqual([])
        expect(result.same).toBeGreaterThan(3000)
    })

    test('guard: a group send parses every tag the same with and without its subject', async () => {
        const M1 = makeChar('m1', 'Mia', [makeChat('mc1', [msg('user', 'x')])], { desc: 'MIA-DESC[{{user}}]', personality: 'MIA-PERS' })
        const M2 = makeChar('m2', 'Max', [makeChat('mc2', [msg('user', 'y')])])
        const G = makeGroup('grp', ['m1', 'm2'], [makeChat('gc1', [msg('user', 'gu0'), msg('char', 'gc1', { saying: 'm2' }), msg('user', 'gu2')], {
            bindedPersona: 'p-B', modules: ['mod-B'],
        })])
        installDb([G, M1, M2], { personas: [{ ...PERSONA_SELECTED }, { ...PERSONA_A }, { ...PERSONA_B }], modules: [MODULE_A, MODULE_B], personaPrompt: GLOBAL_PROMPT })
        selectedCharID.set(0)

        const result = await compare(G, G.chats[0], M1)

        expect(result.nondeterministic).toEqual([])
        expect(result.differing).toEqual([])
        expect(result.same).toBeGreaterThan(3000)
    })

    test('guard: with the selection on another chat the comparison sees the difference', async () => {
        const A = makeChar('char-A', 'Alice', [makeChat('chat-A', [msg('user', 'u0')], { bindedPersona: 'p-A', scriptstate: { $who: 'VAR-A' } })])
        const B = makeChar('char-B', 'Bob', [makeChat('chat-B', [msg('user', 'b0')], { bindedPersona: 'p-B', scriptstate: { $who: 'VAR-B' } })])
        installDb([A, B], { personas: [{ ...PERSONA_SELECTED }, { ...PERSONA_A }, { ...PERSONA_B }], personaPrompt: GLOBAL_PROMPT })
        selectedCharID.set(1)
        const parser = await import('../../parser/parser.svelte')
        const handle = beginWork(A, A.chats[0])!
        const subject = createSendSubject(handle.origin, { owner: A, chat: A.chats[0] })

        const differing = ['{{char}}', '{{user}}', '{{getvar::who}}'].filter((tag) => (
            parser.risuChatParser(tag, { chara: A }) !== parser.risuChatParser(tag, { chara: A, subject })
        ))
        handle.end()

        expect(differing).toEqual(['{{char}}', '{{user}}', '{{getvar::who}}'])
    })
})
