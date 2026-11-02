/**
 * A `runLLM` call that a model makes through `internal:aiaccess` runs a model of its own, and that model may
 * call tools again, `runLLM` included. The nested run belongs to the user turn that made the call: it spends
 * that turn's budget of 25 tool rounds, so a chain of nested calls cannot restart the count, and it stops with
 * the turn when the caller presses Stop. Outside a turn (a call with no context) it runs as it always did.
 * The same file holds the Utility cases of the cap: a streaming reply keeps the text it already showed and
 * ends failed, and an Anthropic Utility run that asks for tools nobody advertised is bounded too.
 *
 * Drives the real `requestChatData`, `requestChatDataMain`, the provider request modules, `mcp.ts`, `modules`,
 * `aiaccess.ts` and the Utility conversation. The module is added the way the app adds it
 * (`importMCPModule` with the `internal:aiaccess` choice). Only the network (`globalFetch`, `fetchNative`),
 * the other MCP clients, the shell plugin, the prompt and the platform packages are recording fakes, so
 * nothing here says anything about a native backend or a live provider reply. The abort behaviour of the two
 * transports is a stand-in: `globalFetch` answers `ok: false` when its signal is already aborted, and
 * `fetchNative` throws when its signal is already aborted.
 *
 * Tests whose title starts with `guard:` pass with or without the change and pin behaviour that must be
 * preserved.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import type { ByteStore } from '../../storage/store/contract'
import { createMemoryByteStore } from '../files/tests/memoryByteStore'
import '../../polyfill'

//#region module mocks

const h = vi.hoisted(() => ({
    /** Every provider request, `globalFetch` and `fetchNative` together, in order. */
    requests: [] as Array<{ transport: 'global' | 'native', url: string, interceptor: string | undefined, signal: AbortSignal | null | undefined }>,
    /** The answer to request number `index`, given the request. */
    responder: null as null | ((index: number, interceptor: string | undefined) => unknown),
    /** Runs after the entry check of a request; a defined return value is the answer instead of the responder's. */
    override: null as null | ((index: number, interceptor: string | undefined) => unknown),
    alerts: [] as string[],
    inputAnswer: 'internal:aiaccess',
    store: null as ByteStore | null,
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: true, isNodeServer: false }))
vi.mock('../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../storage/tauriByteTransport')>()),
    isAndroidTransport: () => false,
    isDesktopTransport: () => true,
}))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: () => {} }))
vi.mock('../../storage/store/appStore', () => ({ getAppStore: async () => h.store }))
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: () => { throw new Error('no program may start in this file') } } }))

vi.mock('../../stores.svelte', () => {
    const state = $state({ db: {} as unknown as Database })
    const selectedCharID = writable(-1)
    return {
        DBState: state, CharEmotion: writable({}), selectedCharID, selIdState: { selId: 0 },
        CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''), bodyIntercepterStore: [] as unknown[],
    }
})

vi.mock('../../alert', () => ({
    alertError: vi.fn((message: string) => { h.alerts.push(message) }), alertToast: vi.fn(), alertInput: vi.fn(async () => h.inputAnswer), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true),
    alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(), waitUnreadNotice: vi.fn(async () => {}),
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(async (url: string, options: { signal?: AbortSignal | null, interceptor?: string }) => {
        const index = h.requests.length
        h.requests.push({ transport: 'native', url, interceptor: options?.interceptor, signal: options?.signal })
        if (options?.signal?.aborted) {
            throw new Error('aborted')
        }
        const forced = h.override?.(index, options?.interceptor)
        if (forced !== undefined) {
            return forced
        }
        return h.responder!(index, options?.interceptor)
    }),
    globalFetch: vi.fn(async (url: string, options: { abortSignal?: AbortSignal | null, interceptor?: string }) => {
        const index = h.requests.length
        h.requests.push({ transport: 'global', url, interceptor: options?.interceptor, signal: options?.abortSignal })
        if (options?.abortSignal?.aborted) {
            return { ok: false, data: 'aborted', status: 400 }
        }
        const forced = h.override?.(index, options?.interceptor)
        if (forced !== undefined) {
            return forced
        }
        return h.responder!(index, options?.interceptor)
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
    runTransformers: vi.fn(async () => ({ generated_text: '' })),
    runImageEmbedding: vi.fn(),
}))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: { characters?: Array<{ chatPage: number, chats?: unknown[] }> } }
    const getCurrentCharacter = () => {
        let id = -1
        stores.selectedCharID.subscribe((v: number) => { id = v })()
        return state.db.characters?.[id]
    }
    const getCurrentChat = () => { const c = getCurrentCharacter(); return c?.chats?.[c.chatPage] }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(getCurrentCharacter), getCurrentChat: vi.fn(getCurrentChat),
    }
})

vi.mock('../mcp/risuaccess', () => ({
    RisuAccessClient: class {
        serverInfo = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'risuai', version: '1' } }
        async checkHandshake() { return this.serverInfo }
        async getToolList() { return [{ name: 'risu-list-characters', description: 'x', inputSchema: { type: 'object', properties: {} } }] }
        async callTool() { return [{ type: 'text', text: 'risuai-out' }] }
        destroy() {}
    },
}))

//#endregion

//#region fixtures

type Fixture = Record<string, unknown>
type Msg = { role: string, content: string }
type Result = { type: string, result: unknown }
type Kind = 'A1' | 'O1' | 'O2' | 'R1' | 'R2' | 'G1' | 'G2'
type Outer = { kind: Kind, model: string, extra: Fixture, streaming: boolean }

let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let requestChatDataMain: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let mcp: typeof import('../mcp/mcp')
let utility: typeof import('../utility/utilityConversation.svelte')

/** A fresh page: every module reloaded. */
async function boot() {
    if (DBState) { DBState.db = {} as unknown as Database }
    vi.resetModules()
    const request = await import('../request/request')
    requestChatData = request.requestChatData as never
    requestChatDataMain = request.requestChatDataMain as never
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    mcp = await import('../mcp/mcp')
    utility = await import('../utility/utilityConversation.svelte')
    const { setPageStorageMode } = await import('../../storage/pageStorageMode')
    setPageStorageMode({ kind: 'store2' })
}

beforeEach(async () => {
    h.requests.length = 0
    h.responder = null
    h.override = null
    h.alerts.length = 0
    h.inputAnswer = 'internal:aiaccess'
    h.store = createMemoryByteStore()
    await boot()
    selectedCharID.set(-1)
})

const OUTERS: Outer[] = [
    { kind: 'A1', model: 'claude-opus-5', extra: { claudeAPIKey: 'k', thinkingType: 'off' }, streaming: false },
    { kind: 'O1', model: 'gpt4o', extra: {}, streaming: false },
    { kind: 'O2', model: 'gpt4o', extra: {}, streaming: true },
    { kind: 'R1', model: 'gpt4o-response-api', extra: { modelTools: [] }, streaming: false },
    { kind: 'R2', model: 'gpt4o-response-api', extra: { modelTools: [] }, streaming: true },
    { kind: 'G1', model: 'gemini-3.8-flash', extra: { google: { accessToken: 'k' } }, streaming: false },
    { kind: 'G2', model: 'gemini-3.8-flash', extra: { google: { accessToken: 'k' } }, streaming: true },
]
const outerOf = (kind: Kind): Outer => OUTERS.find((outer) => outer.kind === kind)!

/** The reply kind of the loop that sent a request, from the interceptor tag of its transport call. */
function kindOf(interceptor: string | undefined): Kind {
    switch (interceptor) {
        case 'anthropic_http': return 'A1'
        case 'openai_basic': return 'O1'
        case 'openai_streaming':
        case 'openai_tool': return 'O2'
        case 'openai_response_api': return 'R1'
        case 'openai_response_api_streaming':
        case 'openai_response_api_tool': return 'R2'
        case 'gemini_base': return 'G1'
        case 'gemini_base_stream':
        case 'gemini_tool': return 'G2'
    }
    throw new Error(`unexpected transport tag ${interceptor}`)
}

function installDb(outer: Outer, extra: Fixture = {}): void {
    const character = {
        chaId: 'c0', name: 'Char0', type: 'character', chatPage: 0, triggerscript: [], modules: [], customscript: [], globalLore: [],
        lowLevelAccess: false, defaultVariables: '',
        chats: [{ id: 'chat0', note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: {}, GLGlobalVariables: {}, modules: [] }],
    }
    DBState.db = {
        characters: [character], enabledModules: [], modules: [], templateDefaultVariables: '', authRefreshes: [], fallbackModels: {},
        requestRetrys: 2, banCharacterset: [],
        personas: [{ id: 'p-S', name: 'Persona', personaPrompt: '', icon: '' }], selectedPersona: 0, username: 'User',
        aiModel: outer.model, subModel: outer.model, maxResponse: 100, temperature: 80, maxContext: 4000, seperateModelsForAxModels: false,
        seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [], cipherChat: false, newOAIHandle: false,
        useInstructPrompt: false, useStreaming: outer.streaming, openAIKey: 'k',
        taskPresets: [{ id: 'preset1', name: 'Preset', instructions: 'be brief', model: outer.model, temperature: 0.5, maxTokens: 100 }],
        ...outer.extra, ...extra,
    } as unknown as Database
    selectedCharID.set(0)
}

/** The database of `outer` with `internal:aiaccess` added through the app's own import and enabled on the character. */
async function installWithAiAccess(outer: Outer, extra: Fixture = {}): Promise<void> {
    installDb(outer, extra)
    await mcp.importMCPModule()
    const added = (DBState.db.modules as unknown as Array<{ id: string }>)
    expect(added, 'the import added the module').toHaveLength(1)
    ;(DBState.db.characters[0] as unknown as { modules: string[] }).modules = [added[0].id]
}

const prompt = (): Msg[] => [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }]

const RUN_LLM_ARGS = { model: 'normal', messages: [{ role: 'user', content: 'x' }] }
const RUN_LLM_JSON = JSON.stringify(RUN_LLM_ARGS)

function sse(events: string[]) {
    const enc = new TextEncoder()
    return {
        status: 200,
        headers: { get: () => 'text/event-stream' },
        body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(events.join(''))); c.close() } }),
    }
}
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const data = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

/** A reply of loop `kind` that asks for `blocks` calls of `name` (with `runLLM`'s arguments); `n` keeps the ids distinct. */
function toolAnswer(kind: Kind, n: number, blocks = 1, name = 'runLLM'): unknown {
    const ids = Array.from({ length: blocks }, (_, i) => `c${n}_${i}`)
    switch (kind) {
        case 'A1': return { ok: true, data: { content: ids.map((id) => ({ type: 'tool_use', id, name, input: RUN_LLM_ARGS })) } }
        case 'O1': return { ok: true, data: { choices: [{ message: { role: 'assistant', content: null, tool_calls: ids.map((id) => ({ id, type: 'function', function: { name, arguments: RUN_LLM_JSON } })) } }] } }
        case 'R1': return { ok: true, data: { output: ids.map((id) => ({ id: `fc_${id}`, type: 'function_call', call_id: id, name, arguments: RUN_LLM_JSON, status: 'completed' })) } }
        case 'G1': return okJson({ candidates: [{ content: { parts: ids.map(() => ({ functionCall: { name, args: RUN_LLM_ARGS } })) } }] })
        case 'O2': return sse([data({ choices: [{ delta: { content: 'step', tool_calls: ids.map((id, index) => ({ index, id, function: { name, arguments: RUN_LLM_JSON } })) } }] }), 'data: [DONE]\n\n'])
        case 'R2': return sse([data({ type: 'response.completed', response: { output_text: 'step', output: ids.map((id) => ({ id: `fc_${id}`, type: 'function_call', call_id: id, name, arguments: RUN_LLM_JSON, status: 'completed' })) } })])
        case 'G2': return sse([data({ candidates: [{ content: { parts: ids.map(() => ({ functionCall: { name, args: RUN_LLM_ARGS } })) } }] })])
    }
}

/** The closing text reply of loop `kind`. */
function textAnswer(kind: Kind, text = 'done'): unknown {
    switch (kind) {
        case 'A1': return { ok: true, data: { content: [{ type: 'text', text }] } }
        case 'O1': return { ok: true, data: { choices: [{ message: { role: 'assistant', content: text } }] } }
        case 'R1': return { ok: true, data: { output_text: text } }
        case 'G1': return okJson({ candidates: [{ content: { parts: [{ text }] } }] })
        case 'O2': return sse([data({ choices: [{ delta: { content: text } }] }), 'data: [DONE]\n\n'])
        case 'R2': return sse([data({ type: 'response.completed', response: { output_text: text, output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } })])
        case 'G2': return sse([data({ candidates: [{ content: { parts: [{ text }] } }] })])
    }
}

/** Every request, outer or nested, asks for tools until `ceiling` requests were answered, then answers with text. */
function everyRequestCallsTools(ceiling: number, blocks = 1, name = 'runLLM'): (index: number, interceptor: string | undefined) => unknown {
    return (index, interceptor) => index < ceiling ? toolAnswer(kindOf(interceptor), index, blocks, name) : textAnswer(kindOf(interceptor))
}

type Outcome = { result: Result, error: Error | null }

/** Runs the RP-shaped request (no `tools`, so the real `getTools` lists `runLLM`); a stream is drained and its ending error kept. */
async function run(outer: Outer, options: { controller?: AbortController, main?: boolean, arg?: Fixture } = {}): Promise<Outcome> {
    const send = options.main ? requestChatDataMain : requestChatData
    const result = await send({
        formated: prompt(), bias: {}, useStreaming: outer.streaming, noMultiGen: true, ...options.arg,
    }, 'model', options.controller?.signal ?? null)
    if (result.type !== 'streaming') {
        return { result, error: null }
    }
    let error: Error | null = null
    try {
        const reader = (result.result as ReadableStream<Record<string, string>>).getReader()
        while (!(await reader.read()).done) { /* drain */ }
    }
    catch (e) {
        error = e as Error
    }
    return { result, error }
}

function lastTurn() {
    return utility.utilityConversation.turns[utility.utilityConversation.turns.length - 1]
}

//#endregion

describe('a nested runLLM spends the outer turn\'s budget', () => {
    test.each(OUTERS.map((outer, index) => [`S2-R25${'abcdefg'[index]}`, outer.kind] as const))('%s %s: nested runLLM calls share one budget of 25 rounds', async (_id, kind) => {
        const outer = outerOf(kind)
        await installWithAiAccess(outer, { fallbackModels: { model: [outer.model] } })
        h.responder = everyRequestCallsTools(40)

        const { result, error } = await run(outer)

        expect(h.requests, 'provider requests, outer and nested together').toHaveLength(26)
        if (outer.streaming) {
            expect(error?.message, 'the stream error').toContain('25')
        }
        else {
            expect(result.type).toBe('fail')
            expect(String(result.result)).toContain('25')
        }
    })

    test('S2-R26 sibling runLLM blocks of one reply do not each get a budget', async () => {
        const outer = outerOf('A1')
        await installWithAiAccess(outer)
        h.responder = everyRequestCallsTools(40, 2)

        const { result } = await run(outer)

        expect(h.requests, 'provider requests').toHaveLength(26)
        expect(result.type).toBe('fail')
    })

    test('S2-R29 a runLLM found by the search path shares the budget too', async () => {
        const outer = outerOf('O1')
        await installWithAiAccess(outer)
        h.responder = everyRequestCallsTools(40)

        const { result } = await run(outer, {
            main: true,
            arg: { tools: [{ name: 'runLLM', description: 'd', inputSchema: { type: 'object', properties: {} } }] },
        })

        expect(h.requests, 'provider requests').toHaveLength(26)
        expect(result.type).toBe('fail')
        expect(String(result.result)).toContain('25')
    })
})

describe('Stop reaches a nested runLLM', () => {
    test.each([['S2-R27', 'A1'], ['S2-R28', 'O1']] as const)('%s %s: the nested request carries the outer signal and ends both loops', async (_id, kind) => {
        const outer = outerOf(kind)
        await installWithAiAccess(outer)
        const controller = new AbortController()
        h.responder = everyRequestCallsTools(40)
        h.override = (index, interceptor) => {
            if (index === 1) {
                controller.abort()
                return toolAnswer(kindOf(interceptor), index)
            }
            return undefined
        }

        const { result } = await run(outer, { controller })

        expect(h.requests, 'provider requests').toHaveLength(2)
        expect(h.requests[1].signal, 'the signal of the nested request').toBe(controller.signal)
        expect(result).toMatchObject({ type: 'fail', result: 'Aborted' })
        expect(h.alerts).toEqual([])
    })
})

describe('Utility keeps its text and ends failed at the cap', () => {
    test('S2-R17 a streaming Utility reply that kept calling tools ends failed and names the cap', async () => {
        const outer = outerOf('O2')
        installDb(outer)
        h.responder = everyRequestCallsTools(30)

        await utility.sendUtility('preset1', 'hello')

        const turn = lastTurn()
        expect(turn.state).toBe('failed')
        expect(turn.content, 'the text shown before the cap').toContain('step')
        expect(turn.error).toContain('25')
    })

    test('S2-R18 an Anthropic Utility run that asks for tools nobody advertised is bounded', async () => {
        const outer = outerOf('A1')
        installDb(outer, { useStreaming: false })
        h.responder = everyRequestCallsTools(30, 1, 'risu-list-characters')

        await utility.sendUtility('preset1', 'hello')

        expect(h.requests, 'provider requests').toHaveLength(26)
        const turn = lastTurn()
        expect(turn.state).toBe('failed')
        expect(turn.error).toContain('25')
    })
})

describe('a nested runLLM under the cap, and one outside any turn, still work', () => {
    test.each([['A1'], ['O1']] as const)('guard: S2-G4 %s a nested chain under the cap returns the outer reply', async (kind) => {
        const outer = outerOf(kind)
        await installWithAiAccess(outer)
        h.responder = (index, interceptor) => {
            if (index === 0) { return toolAnswer(kindOf(interceptor), index) }
            return textAnswer(kindOf(interceptor), index === 1 ? 'inner' : 'outer done')
        }

        const { result } = await run(outer)

        expect(h.requests).toHaveLength(3)
        expect(result.type).toBe('success')
        expect(String(result.result)).toContain('outer done')
    })

    test('guard: S2-G5 runLLM called with no context (the Playground shape) runs one nested request', async () => {
        const outer = outerOf('A1')
        await installWithAiAccess(outer)
        h.responder = (_index, interceptor) => textAnswer(kindOf(interceptor), 'inner only')

        const out = await mcp.callTool('runLLM', RUN_LLM_ARGS)

        expect(h.requests).toHaveLength(1)
        expect(JSON.parse((out[0] as { text: string }).text)).toEqual({ success: true, message: 'inner only' })
    })
})
