/**
 * A request that carries a subject gets the tools of its subject's module set, and what those tools
 * read and write is its subject's chat and character -- whatever the selection is at the time. A
 * request with no subject keeps following the selection.
 *
 * Drives the real `requestChatData`, `runTrigger`, `mcp`, `modules`, `chatOrigin`, `parser` and `util`,
 * and the real internal clients (`graphmem`, `risuaccess`, `aiaccess`, `dice`). Only the network
 * (`globalFetch`, the global `fetch`, the transformers runner), the embedding processor behind graph
 * memory's reads, the tokenizer and the platform/IO packages are mocked, so nothing here says anything
 * about a native backend. Every test loads a fresh copy of the modules, because the MCP registry is
 * module-level state.
 *
 * A tool call carries its subject as `{ subject }` in the third argument of the client's `callTool`, and
 * the registry's `callTool` takes `{ subject, mcpURL }` as its third argument.
 *
 * Tests whose title starts with `guard:` pass with or without the binding and pin behaviour that must be
 * preserved.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { RunSubject } from '../chatOrigin'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    /** Every `globalFetch` call, in order. */
    fetches: [] as Array<{ url: string, body: Record<string, unknown> }>,
    /** Calls to `globalFetch` that answer with a failure before answering normally. */
    failNext: 0,
    /** Runs after each `globalFetch` call has answered. */
    afterFetch: null as null | ((count: number) => void),
    /** Runs on each attempt after the `replacerbeforeRequest` awaits, i.e. between `getTools()` and the trigger. */
    hook: null as null | (() => void),
    reply: 'ok',
    hordeBody: null as null | Record<string, unknown>,
    transformerPrompt: null as null | string,
    ollamaBody: null as null | Record<string, unknown>,
    marks: [] as string[],
    counting: false,
    reads: [] as string[],
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: (id: string) => { h.marks.push(id) } }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    const inner = writable(-1)
    // Every read of the selection goes through `subscribe` (`get()` included); `set` does not.
    const selectedCharID = {
        ...inner,
        subscribe: (run: (v: number) => void, invalidate?: () => void) => {
            if (h.counting) {
                h.reads.push(new Error().stack ?? '')
            }
            return inner.subscribe(run, invalidate)
        },
    }
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID, selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))

/** The answer to any `globalFetch` call: one body that every provider under test reads its own field from. */
function answer(reply: string) {
    return {
        ok: true,
        data: {
            output: reply,
            data: [reply],
            results: [{ text: reply }],
            choices: [{ text: reply, message: { content: reply } }],
        },
    }
}

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(async (url: string, opts: { body: Record<string, unknown> }) => {
        h.fetches.push({ url, body: JSON.parse(JSON.stringify(opts?.body ?? {})) })
        const count = h.fetches.length
        let out: unknown = answer(h.reply)
        if (h.failNext > 0) {
            h.failNext--
            out = { ok: false, data: { error: { message: 'boom' } } }
        }
        h.afterFetch?.(count)
        return out
    }),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))

vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))

vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
}))
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))

vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: new Set(), replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))

vi.mock('../transformers', () => ({
    runTransformers: vi.fn(async (prompt: string) => { h.transformerPrompt = prompt; return { generated_text: h.reply } }),
    runImageEmbedding: vi.fn(),
}))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../request/anthropic', () => ({ requestClaude: vi.fn() }))
vi.mock('../request/google', () => ({ requestGoogleCloudVertex: vi.fn() }))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => state.db.characters?.[get(stores.selectedCharID)]
    const getCurrentChat = () => { const c = getCurrentCharacter(); return c?.chats?.[c.chatPage] }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat),
    }
})

//#endregion

//#region fixtures

type Msg = { role: string, content: string }
type Fixture = Record<string, unknown>

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<{ type: string, result: unknown, model?: string }>
let runTrigger: (char: unknown, mode: string, arg: Record<string, unknown>) => Promise<{ displayData?: string } | null>
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let createRunSubject: typeof import('../chatOrigin').createRunSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let pluginV2: {
    replacerbeforeRequest: Set<(f: unknown, m: string) => Promise<unknown>>
    providers: Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
}
let mcp: typeof import('../mcp/mcp')

/**
 * Loads a fresh copy of every module under test: the MCP registry keeps module-level state, and one
 * test must not leave its clients to the next.
 */
async function boot() {
    // A module-level effect of the parser reads the database as soon as it loads; the database of the previous test must not be there for it to read.
    if (DBState) { DBState.db = {} as unknown as Database }
    vi.resetModules()
    requestChatData = (await import('../request/request')).requestChatData as never
    runTrigger = (await import('../triggers')).runTrigger as never
    const chatOrigin = await import('../chatOrigin')
    createSendSubject = chatOrigin.createSendSubject
    createRunSubject = chatOrigin.createRunSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    pluginV2 = (await import('../../plugins/plugins.svelte')).pluginV2 as never
    mcp = await import('../mcp/mcp')
}

/** The persona at `selectedPersona` is a third one, so no chat below is bound to it. */
const PERSONAS = [
    { id: 'p-S', name: 'SelectedPersona', personaPrompt: '', icon: '' },
    { id: 'p-A', name: 'PersonaAlpha', personaPrompt: '', icon: '' },
    { id: 'p-B', name: 'SentinelPersona', personaPrompt: '', icon: '' },
]

function chat(id: string, vars: Record<string, string> = {}, extra: Fixture = {}): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: vars, GLGlobalVariables: {}, modules: [], ...extra }
}

/** A `request` trigger that sets one message of the prompt to `${tag}:${$v}` (the chat variable `v`). */
function reqTrigger(tag: string, index = '0'): Fixture {
    return {
        comment: `request ${tag}`, type: 'request', conditions: [], lowLevelAccess: false,
        effect: [{ type: 'v2SetRequestState', index, indexType: 'value', value: `${tag}:{{getvar::v}}`, valueType: 'value', indent: 0 }],
    }
}

function makeChar(chaId: string, name: string, chats: Fixture[], triggers: Fixture[] = [], extra: Fixture = {}): Fixture {
    return {
        chaId, name, type: 'character', chatPage: 0, chats, triggerscript: triggers, modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '', ...extra,
    }
}

const JINJA = "{% for message in messages %}[{{ message['role'] }}] {{ message['content'] }}\n{% endfor %}RC=[{{ risu_char }}] RU=[{{ risu_user }}]"

function installDb(characters: Fixture[], extra: Fixture = {}, modules: Fixture[] = []): void {
    DBState.db = {
        characters, enabledModules: [], modules, templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 2, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: PERSONAS, selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: false, openAIKey: 'k',
        instructChatTemplate: 'jinja', JinjaTemplate: JINJA, localStopStrings: ['{{char}}:', '{{user}}:'],
        NAIsettings: { seperator: '\n', starter: '', topK: 1, topP: 1, topA: 1, tailFreeSampling: 1, repetitionPenalty: 1, repetitionPenaltyRange: 1, repetitionPenaltySlope: 1, frequencyPenalty: 0, presencePenalty: 0, typicalp: 1 },
        NAIappendName: true, NAIadventure: false, novelai: { token: 't' },
        ainconfig: { top_p: 1, top_k: 1, rep_pen: 1, top_a: 1, rep_pen_slope: 1, rep_pen_range: 1, typical_p: 1, badwords: '', stoptokens: '' }, novellistAPI: 'k',
        ooba: { formating: { userPrefix: 'U:', seperator: '\n' }, top_k: 1, top_p: 1, repetition_penalty: 1, typical_p: 1 },
        textgenWebUIStreamURL: 'ws://ooba.test/api/v1/stream', textgenWebUIBlockingURL: 'http://ooba.test/api/v1/generate', reverseProxyOobaArgs: {}, mancerHeader: 'k',
        koboldURL: 'http://kobold.test/api/v1/generate', hordeConfig: { apiKey: '' }, top_k: 1, top_p: 1,
        ollamaURL: 'http://ollama.test', ollamaModel: 'llama', ollamaThinkingMode: 'default', ollamaModelSource: 'x',
        useInstructPrompt: false, openrouterRequestModel: 'x/y', openrouterKey: 'k', proxyRequestModel: 'x',
        ...extra,
    } as unknown as Database
}

const prompt = (): Msg[] => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

/** A request that carries `subject` (when given); the provider is the model in `db.aiModel`. */
async function ask(subject: RunSubject | null, extra: Fixture = {}, formated: Msg[] = prompt(), model = 'model') {
    return requestChatData({
        formated, bias: {}, useStreaming: false, noMultiGen: true, ...(subject ? { subject } : {}), ...extra,
    }, model)
}

/** The chat messages of the `globalFetch` call number `n` (the last one by default), as one string per message. */
function messagesOf(n = -1): string[] {
    const call = h.fetches.at(n)!
    return (call.body.messages as Msg[]).map((m) => m.content)
}

beforeEach(async () => {
    await boot()
    h.fetches.length = 0; h.failNext = 0; h.afterFetch = null; h.hook = null; h.reply = 'ok'
    h.hordeBody = null; h.transformerPrompt = null; h.ollamaBody = null; h.marks.length = 0; h.counting = false; h.reads.length = 0
    pluginV2.replacerbeforeRequest.clear()
    pluginV2.replacerbeforeRequest.add(async (f) => { const run = h.hook; h.hook = null; run?.(); return f })
    pluginV2.providers.clear()
    selectedCharID.set(-1)
})

//#endregion

// Graph memory's read searches the chat's graph through an embedding processor; the stand-in returns every
// entry name, so the entries the read returns are exactly the ones in the chat's graph.
vi.mock('../memory/hypamemory', async (importOriginal) => {
    const orig = await importOriginal<Record<string, unknown>>()
    class StubProcesser {
        private documents: string[] = []
        async embedDocuments(documents: string[]) { this.documents = documents }
        async similaritySearch(_query: string) { return this.documents }
    }
    return { ...orig, HypaProcesser: StubProcesser }
})

//#region fixtures for the tool path

/** The subject of a send that started in chat `chatIndex` of the character at `charIndex`, read back through the live database. */
function subjectAt(charIndex: number, chatIndex = 0, memberChaId?: string): RunSubject {
    const owner = DBState.db.characters[charIndex] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[chatIndex]
    return createSendSubject(
        { chaId: owner.chaId, chatId: target.id, ...(memberChaId ? { memberChaId } : {}) },
        { owner: owner as never, chat: target as never },
    )
}

const liveChar = (index: number) => DBState.db.characters[index] as unknown as Fixture & { chatPage: number, chats: Fixture[], name: string }

const M_GRAPH = 'mod-graph'
const M_DICE = 'mod-dice'
const modGraph = { id: M_GRAPH, name: 'graph', description: '', mcp: { url: 'internal:graphmem' } }
const modDice = { id: M_DICE, name: 'dice', description: '', mcp: { url: 'internal:dice' } }

const textOf = (r: Array<{ type: string, text?: string }>) => r.map((x) => x.text ?? '').join('|')
const msg = (data: string) => ({ role: 'char', data, time: 1 })
const NEW_ENTRY = { name: 'n1', summary: 's', connections: [] as string[] }

/** The stored graph of the chat at `chatIndex` of the character at `charIndex`. */
const graphOf = (charIndex: number, chatIndex: number) => {
    const c = (DBState.db.characters[charIndex] as unknown as { chats: Array<{ scriptstate?: Record<string, string> }> }).chats[chatIndex]
    return c.scriptstate?.['$graphmem_graph']
}

const nameOf = (charIndex: number) => (DBState.db.characters[charIndex] as { name: string }).name

/** The tool names of the last request the provider received. */
const toolNames = () => {
    const body = h.fetches.at(-1)!.body as { tools?: Array<{ function: { name: string } }> }
    return body.tools?.map((t) => t.function.name) ?? []
}

/** A trigger whose one effect runs the model on `hello`. */
function llmTrigger(): Fixture {
    return {
        comment: 'llm', type: 'start', conditions: [], lowLevelAccess: true,
        effect: [{ type: 'v2RunLLM', value: 'hello', valueType: 'value', model: 'model', outputVar: 'o', streaming: false, indent: 0 }],
    }
}

//#endregion

//#region which tools a request gets

describe('a request gets the tools of its subject\'s module set', () => {
    test('a request with a subject gets its module\'s tools while the selection is on a character without the module', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [], { modules: [M_DICE] })
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B], {}, [modDice]); selectedCharID.set(1)

        await ask(subjectAt(0))

        expect(toolNames()).toContain('rollDice')
    })

    test('a request with a subject gets its module\'s tools while the selection is at Home', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [], { modules: [M_DICE] })
        installDb([A], {}, [modDice]); selectedCharID.set(-1)

        await ask(subjectAt(0))

        expect(toolNames()).toContain('rollDice')
    })

    test('a request with a subject gets the tools of a module enabled on its own chat after the character moved to another chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', {}, { modules: [M_DICE] }), chat('cA2')], [])
        installDb([A], {}, [modDice]); selectedCharID.set(0)
        liveChar(0).chatPage = 1

        await ask(subjectAt(0, 0))

        expect(toolNames()).toContain('rollDice')
    })

    test('a model call of a trigger run gets the tools of the run\'s chat while the selection is on another character', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [llmTrigger()], { modules: [M_DICE], lowLevelAccess: true })
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B], {}, [modDice]); selectedCharID.set(1)

        await runTrigger(liveChar(0), 'start', { chat: liveChar(0).chats[0], origin: { chaId: 'a', chatId: 'cA' } })

        expect(h.fetches.length, 'the model was called once').toBe(1)
        expect(toolNames()).toContain('rollDice')
    })

    test('guard: a request with no subject gets the tools of the selection\'s module set', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [], { modules: [M_DICE] })
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B], {}, [modDice]); selectedCharID.set(0)

        await ask(null)
        const onA = toolNames()
        selectedCharID.set(1)
        await ask(null)
        const onB = toolNames()

        expect(onA).toEqual(['rollDice'])
        expect(onB).toEqual([])
    })
})

//#endregion

//#region graph memory

describe('graph memory reads and writes the chat of the call\'s subject', () => {
    async function graphClient() {
        const { GraphMemClient } = await import('../mcp/graphmem')
        return new GraphMemClient()
    }

    test('the first write in a chat with no stored graph succeeds and stores the entry', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A]); selectedCharID.set(0)

        const result = await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject: subjectAt(0) })

        expect(textOf(result)).toContain('written successfully')
        expect(graphOf(0, 0)).toContain('n1')
    })

    test('guard: a write in a chat whose stored graph is an empty list stores the entry', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' })], [])
        installDb([A]); selectedCharID.set(0)

        const result = await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject: subjectAt(0) })

        expect(textOf(result)).toContain('written successfully')
        expect(graphOf(0, 0)).toContain('n1')
    })

    test('a write after the character moved to another chat lands in the subject\'s chat and marks its character for save', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' }), chat('cA2', { $graphmem_graph: '[]' })], [])
        installDb([A]); selectedCharID.set(0)
        const subject = subjectAt(0, 0)
        liveChar(0).chatPage = 1

        await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject })

        expect(graphOf(0, 0)).toContain('n1')
        expect(graphOf(0, 1)).toBe('[]')
        expect(h.marks).toContain('a')
    })

    test('a write while the selection is at Home lands in the subject\'s chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' })], [])
        installDb([A]); selectedCharID.set(-1)

        const result = await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject: subjectAt(0) })

        expect(textOf(result)).toContain('written successfully')
        expect(graphOf(0, 0)).toContain('n1')
    })

    test('guard: a read of a chat with no stored graph answers that there are no entries', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A]); selectedCharID.set(-1)

        const result = await (await graphClient()).callTool('readMemory', { query: ['x'] }, { subject: subjectAt(0) })

        expect(textOf(result)).toContain('No memory entries found')
    })

    test('a read after the character moved to another chat returns the entries of the subject\'s chat', async () => {
        const A = makeChar('a', 'AliceName', [
            chat('cA', { $graphmem_graph: JSON.stringify([{ name: 'n-send', summary: 'from the send chat', connections: [] }]) }),
            chat('cA2', { $graphmem_graph: JSON.stringify([{ name: 'n-other', summary: 'from the other chat', connections: [] }]) }),
        ], [])
        installDb([A]); selectedCharID.set(0)
        const subject = subjectAt(0, 0)
        liveChar(0).chatPage = 1

        const result = await (await graphClient()).callTool('readMemory', { query: ['x'] }, { subject })

        expect(textOf(result)).toContain('n-send')
        expect(textOf(result)).not.toContain('n-other')
    })

    test('a write through the registry after the selection moved to a character without the module reaches graph memory and the subject\'s chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' })], [], { modules: [M_GRAPH] })
        const B = makeChar('b', 'SentinelBob', [chat('cB', { $graphmem_graph: '[]' })], [])
        installDb([A, B], {}, [modGraph]); selectedCharID.set(0)
        const subject = subjectAt(0)
        await mcp.getTools(subject)
        selectedCharID.set(1)

        const result = await mcp.callTool('writeMemory', NEW_ENTRY, { subject, mcpURL: 'internal:graphmem' })

        expect(textOf(result)).toContain('written successfully')
        expect(graphOf(0, 0)).toContain('n1')
        expect(graphOf(1, 0)).toBe('[]')
    })

    test('a write through the registry after the character moved to another chat lands in the subject\'s chat and marks its character for save', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' }), chat('cA2', { $graphmem_graph: '[]' })], [], { modules: [M_GRAPH] })
        installDb([A], {}, [modGraph]); selectedCharID.set(0)
        const subject = subjectAt(0, 0)
        await mcp.getTools(subject)
        liveChar(0).chatPage = 1

        await mcp.callTool('writeMemory', NEW_ENTRY, { subject, mcpURL: 'internal:graphmem' })

        expect(graphOf(0, 0)).toContain('n1')
        expect(graphOf(0, 1)).toBe('[]')
        expect(h.marks).toContain('a')
    })

    test('a write whose chat was deleted answers with an error and stores nothing in the remaining chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' }), chat('cA2', { $graphmem_graph: '[]' })], [])
        installDb([A]); selectedCharID.set(0)
        const subject = subjectAt(0, 0)
        liveChar(0).chats.splice(0, 1)

        const result = await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject })

        expect(textOf(result)).toMatch(/^Error:/)
        expect(graphOf(0, 0)).toBe('[]')
    })

    test('a write from a send whose chat id is shared by another chat goes to the send\'s own chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', { $graphmem_graph: '[]' }), chat('cA', { $graphmem_graph: '[]' })], [])
        installDb([A]); selectedCharID.set(0)

        await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject: subjectAt(0, 1) })

        expect(graphOf(0, 1)).toContain('n1')
        expect(graphOf(0, 0)).toBe('[]')
    })

    test('a write from a trigger run whose chat id is shared by two chats answers with an error and stores nothing', async () => {
        const A = makeChar('a', 'AliceName', [chat('dup', { $graphmem_graph: '[]' }), chat('dup', { $graphmem_graph: '[]' })], [])
        installDb([A]); selectedCharID.set(0)
        const subject = createRunSubject({ chaId: 'a', chatId: 'dup' })

        const result = await (await graphClient()).callTool('writeMemory', NEW_ENTRY, { subject })

        expect(textOf(result)).toMatch(/^Error:/)
        expect(graphOf(0, 0)).toBe('[]')
        expect(graphOf(0, 1)).toBe('[]')
    })
})

//#endregion

//#region risuaccess with no id

describe('risuaccess with no id acts on the call\'s subject', () => {
    const NOT_FOUND = /^Error: Character with ID\s+not found\./

    async function risuClient() {
        const { RisuAccessClient } = await import('../mcp/risuaccess/client')
        return new RisuAccessClient()
    }

    test('the chat history after the character moved to another chat is the subject\'s chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', {}, { message: [msg('FROM-SEND-CHAT')] }), chat('cA2', {}, { message: [msg('FROM-OTHER-CHAT')] })], [])
        installDb([A]); selectedCharID.set(0)
        const subject = subjectAt(0, 0)
        liveChar(0).chatPage = 1

        const result = await (await risuClient()).callTool('risu-get-chat-history', { id: '' }, { subject })

        expect(textOf(result)).toContain('FROM-SEND-CHAT')
        expect(textOf(result)).not.toContain('FROM-OTHER-CHAT')
    })

    test('the chat history while the selection is at Home is the subject\'s chat', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA', {}, { message: [msg('FROM-SEND-CHAT')] })], [])
        installDb([A]); selectedCharID.set(-1)

        const result = await (await risuClient()).callTool('risu-get-chat-history', { id: '' }, { subject: subjectAt(0) })

        expect(textOf(result)).toContain('FROM-SEND-CHAT')
    })

    test('the character info after the selection moved to another character is the subject\'s character', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B]); selectedCharID.set(1)

        const result = await (await risuClient()).callTool('risu-get-character-info', { id: '', fields: ['name'] }, { subject: subjectAt(0) })

        expect(textOf(result)).toContain('AliceName')
        expect(textOf(result)).not.toContain('SentinelBob')
    })

    test('setting the character info after the selection moved to another character renames the subject\'s character and marks only it for save', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B]); selectedCharID.set(1)

        await (await risuClient()).callTool('risu-set-character-info', { id: '', data: { name: 'Renamed' } }, { subject: subjectAt(0) })

        expect(nameOf(0)).toBe('Renamed')
        expect(nameOf(1)).toBe('SentinelBob')
        expect(h.marks).toEqual(['a'])
    })

    test('setting the character info while the selection is at Home renames the subject\'s character', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A]); selectedCharID.set(-1)

        await (await risuClient()).callTool('risu-set-character-info', { id: '', data: { name: 'Renamed' } }, { subject: subjectAt(0) })

        expect(nameOf(0)).toBe('Renamed')
    })

    test('guard: a switch to another character while the write prompt is open still writes the subject\'s character, and the prompt names it', async () => {
        const { alertConfirm } = await import('../../alert')
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        const B = makeChar('b', 'SentinelBob', [chat('cB')], [])
        installDb([A, B]); selectedCharID.set(0)
        const subject = subjectAt(0)
        const prompts: string[] = []
        vi.mocked(alertConfirm).mockImplementationOnce(async (message: string) => { prompts.push(message); selectedCharID.set(1); return true })

        await (await risuClient()).callTool('risu-set-character-info', { id: '', data: { name: 'Renamed' } }, { subject })

        expect(prompts).toHaveLength(1)
        expect(prompts[0]).toContain('AliceName')
        expect(nameOf(0)).toBe('Renamed')
        expect(nameOf(1)).toBe('SentinelBob')
    })

    type CharacterFixture = { globalLore: Array<{ content: string }>, customscript: Array<{ in: string, out: string }>, additionalAssets: unknown[], triggerscript: Array<{ effect: Array<{ code: string }> }>, name: string }

    /** The write's tool, its arguments, and whether the write's effect is present on the character. */
    const NO_ID_WRITES: Array<[string, Record<string, unknown>, (c: CharacterFixture) => boolean]> = [
        ['risu-set-character-info', { id: '', data: { name: 'Renamed' } }, (c) => c.name === 'Renamed'],
        ['risu-set-character-lorebook', { id: '', name: 'e1', content: 'c' }, (c) => c.globalLore[0]?.content === 'c'],
        ['risu-delete-character-lorebook', { id: '', name: 'e1' }, (c) => c.globalLore.length === 0],
        ['risu-set-character-regex-scripts', { id: '', name: 's1', in: 'a', out: 'b', type: 'editdisplay' }, (c) => c.customscript[0]?.in === 'a' && c.customscript[0]?.out === 'b'],
        ['risu-delete-character-regex-scripts', { id: '', name: 's1' }, (c) => c.customscript.length === 0],
        ['risu-delete-character-additional-assets', { id: '', assetName: 'asset1' }, (c) => c.additionalAssets.length === 0],
        ['risu-set-character-lua-script', { id: '', code: 'x' }, (c) => c.triggerscript[0]?.effect[0]?.code === 'x'],
    ]

    /** A character that every write above can change: one lorebook entry, one regex script, one additional asset and a Lua first trigger. */
    function writableChar(): Fixture {
        return makeChar('a', 'AliceName', [chat('cA')], [
            { comment: 'lua', type: 'start', conditions: [], lowLevelAccess: true, effect: [{ type: 'triggerlua', code: 'old' }] },
        ], {
            globalLore: [{ comment: 'e1', content: 'x', key: '', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
            customscript: [{ comment: 's1', in: 'x', out: 'y', type: 'editdisplay', flag: '', ableFlag: true }],
            additionalAssets: [['asset1', 'p', 'e']],
        })
    }

    // Every write that prompts before it writes re-resolves the subject's character after the prompt.
    test.each(NO_ID_WRITES)('%s, with its character slot replaced during the confirm prompt, writes the live object and marks its character', async (tool, args, landed) => {
        const { alertConfirm } = await import('../../alert')
        installDb([writableChar()]); selectedCharID.set(0)
        const subject = subjectAt(0)
        const detached = DBState.db.characters[0]
        const before = JSON.stringify(detached)
        vi.mocked(alertConfirm).mockImplementationOnce(async () => {
            DBState.db.characters[0] = JSON.parse(JSON.stringify(DBState.db.characters[0]))
            return true
        })

        const result = await (await risuClient()).callTool(tool, args, { subject })

        expect(textOf(result)).toContain('Successfully')
        expect(landed(DBState.db.characters[0] as unknown as CharacterFixture)).toBe(true)
        expect(JSON.stringify(detached)).toBe(before)
        expect(h.marks).toEqual(['a'])
    })

    test.each(NO_ID_WRITES)('%s, with its character removed while the prompt was open, answers with an error, changes nothing and marks nothing for save', async (tool, args) => {
        const { alertConfirm } = await import('../../alert')
        installDb([writableChar(), makeChar('b', 'SentinelBob', [chat('cB')], [])]); selectedCharID.set(0)
        const subject = subjectAt(0)
        const detached = DBState.db.characters[0]
        const before = JSON.stringify(detached)
        vi.mocked(alertConfirm).mockImplementationOnce(async () => { DBState.db.characters.splice(0, 1); return true })

        const result = await (await risuClient()).callTool(tool, args, { subject })

        expect(textOf(result)).toMatch(/^Error: The character\b.*\bexist/)
        expect(JSON.stringify(detached)).toBe(before)
        expect(h.marks).toEqual([])
    })

    describe('with the subject\'s character removed', () => {
        /** The send's character A is removed after the subject was formed; the selection is then set to `selection` (an index into the remaining list). */
        async function setup(selection: number) {
            const A = makeChar('a', 'AliceName', [chat('cA', {}, { message: [msg('FROM-A')] })], [])
            const B = makeChar('b', 'SentinelBob', [chat('cB', {}, { message: [msg('FROM-B')] })], [])
            installDb([A, B])
            selectedCharID.set(0)
            const subject = subjectAt(0)
            DBState.db.characters.splice(0, 1)
            selectedCharID.set(selection)
            return { client: await risuClient(), subject }
        }

        test('the character info answers that the character was not found while the selection is on another character', async () => {
            const { client, subject } = await setup(0)

            const result = await client.callTool('risu-get-character-info', { id: '', fields: ['name'] }, { subject })

            expect(textOf(result)).toMatch(NOT_FOUND)
        })

        test('the chat history answers that the character was not found while the selection is on another character', async () => {
            const { client, subject } = await setup(0)

            const result = await client.callTool('risu-get-chat-history', { id: '' }, { subject })

            expect(textOf(result)).toMatch(NOT_FOUND)
        })

        test('guard: the character info answers that the character was not found while the selection is at Home', async () => {
            const { client, subject } = await setup(-1)

            const result = await client.callTool('risu-get-character-info', { id: '', fields: ['name'] }, { subject })

            expect(textOf(result)).toMatch(NOT_FOUND)
        })

        test('guard: the chat history answers that the character was not found while the selection is at Home', async () => {
            const { client, subject } = await setup(-1)

            const result = await client.callTool('risu-get-chat-history', { id: '' }, { subject })

            expect(textOf(result)).toMatch(NOT_FOUND)
        })
    })

    describe('with a trigger run whose chat id has two holders', () => {
        const DUP = () => makeChar('a', 'AliceName', [chat('dup', {}, { message: [msg('FIRST')] }), chat('dup', {}, { message: [msg('SECOND')] })], [])

        test('guard: the run\'s subject resolves to nothing', () => {
            installDb([DUP()]); selectedCharID.set(0)

            expect(createRunSubject({ chaId: 'a', chatId: 'dup' }).resolve()).toBeNull()
        })

        test('the chat history answers that the character was not found instead of reading the first holder', async () => {
            installDb([DUP()]); selectedCharID.set(0)
            const subject = createRunSubject({ chaId: 'a', chatId: 'dup' })

            const result = await (await risuClient()).callTool('risu-get-chat-history', { id: '' }, { subject })

            expect(textOf(result)).toMatch(NOT_FOUND)
        })
    })
})

//#endregion

//#region aiaccess

describe('the nested request of aiaccess carries the calling request\'s subject', () => {
    test('with the selection on another character, the nested request runs the calling chat\'s request trigger and gets its tools', async () => {
        const { AIAccessClient } = await import('../mcp/aiaccess')
        const A = makeChar('a', 'AliceName', [chat('cA', { $v: 'A1' })], [reqTrigger('TA')], { modules: [M_DICE] })
        const B = makeChar('b', 'SentinelBob', [chat('cB', { $v: 'B1' })], [reqTrigger('TB')])
        installDb([A, B], {}, [modDice]); selectedCharID.set(1)

        await new AIAccessClient().callTool('runLLM', { model: 'normal', messages: [{ role: 'user', content: 'nested' }] }, { subject: subjectAt(0) })

        expect(messagesOf()[0]).toBe('TA:A1')
        expect(toolNames()).toEqual(['rollDice'])
    })
})

//#endregion
