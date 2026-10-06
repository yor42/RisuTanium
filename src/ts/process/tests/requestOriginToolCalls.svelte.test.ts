/**
 * Every provider that runs a tool call itself hands the call to the MCP registry together with the
 * request's subject and the URL of the client that listed the tool: `callTool(name, args, { subject,
 * mcpURL })`. The streaming loops read both after `requestChatData` has returned, so a request that
 * ends before its stream is read still binds its tool calls.
 *
 * Drives the real `requestChatData` and the real Anthropic, Google, OpenAI-compatible and Responses
 * request modules. Only the network (`globalFetch`, `fetchNative`), the tool path (`callTool` is a spy),
 * the tokenizer and the platform/IO packages are mocked, so nothing here says anything about a native
 * backend or a real MCP server.
 */
import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest'
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
    /** Scripted answers of `globalFetch`, taken before the default answer. */
    globalScript: [] as unknown[],
    /** Scripted answers of `fetchNative`. */
    nativeScript: [] as unknown[],
    nativeImpl: null as null | ((url: string, opts: Record<string, unknown>) => unknown),
    nativeCalls: [] as string[],
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
        HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''), bodyIntercepterStore: [] as unknown[],
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
    fetchNative: vi.fn(async (url: string, opts: Record<string, unknown>) => { h.nativeCalls.push(url); if (h.nativeScript.length) { return h.nativeScript.shift() } return h.nativeImpl?.(url, opts) }),
    globalFetch: vi.fn(async (url: string, opts: { body: Record<string, unknown> }) => {
        h.fetches.push({ url, body: JSON.parse(JSON.stringify(opts?.body ?? {})) })
        if (h.globalScript.length) { return h.globalScript.shift() }
        if (String(url).includes('api.anthropic.com') || String(url).includes('amazonaws.com')) { return { ok: true, data: { content: [{ type: 'text', text: h.reply }] } } }
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

const m = vi.hoisted(() => ({ callTool: vi.fn() }))

// The tool path is a spy: what a request's tool call is handed is what this file checks.
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: m.callTool, decodeToolCall: vi.fn(), encodeToolCall: vi.fn(async () => '') }))

vi.mock('../transformers', () => ({
    runTransformers: vi.fn(async (prompt: string) => { h.transformerPrompt = prompt; return { generated_text: h.reply } }),
    runImageEmbedding: vi.fn(),
}))

vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

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
let createSendSubject: typeof import('../chatOrigin').createSendSubject
let DBState: { db: Database }
let selectedCharID: ReturnType<typeof writable<number>>
let pluginV2: {
    replacerbeforeRequest: Set<(f: unknown, m: string) => Promise<unknown>>
    providers: Map<string, (args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>>
}

beforeAll(async () => {
    requestChatData = (await import('../request/request')).requestChatData as never
    const chatOrigin = await import('../chatOrigin')
    createSendSubject = chatOrigin.createSendSubject
    const stores = await import('../../stores.svelte')
    DBState = stores.DBState as unknown as { db: Database }
    selectedCharID = stores.selectedCharID as unknown as ReturnType<typeof writable<number>>
    pluginV2 = (await import('../../plugins/plugins.svelte')).pluginV2 as never
})

/** The persona at `selectedPersona` is a third one, so no chat below is bound to it. */
const PERSONAS = [
    { id: 'p-S', name: 'SelectedPersona', personaPrompt: '', icon: '' },
    { id: 'p-A', name: 'PersonaAlpha', personaPrompt: '', icon: '' },
    { id: 'p-B', name: 'SentinelPersona', personaPrompt: '', icon: '' },
]

function chat(id: string, vars: Record<string, string> = {}, extra: Fixture = {}): Fixture {
    return { id, note: '', name: '', localLore: [], fmIndex: -1, message: [], scriptstate: vars, GLGlobalVariables: {}, modules: [], ...extra }
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

beforeEach(() => {
    h.fetches.length = 0; h.failNext = 0; h.afterFetch = null; h.hook = null; h.reply = 'ok'
    h.hordeBody = null; h.transformerPrompt = null; h.ollamaBody = null; h.marks.length = 0; h.counting = false; h.reads.length = 0
    pluginV2.replacerbeforeRequest.clear()
    pluginV2.replacerbeforeRequest.add(async (f) => { const run = h.hook; h.hook = null; run?.(); return f })
    pluginV2.providers.clear()
    selectedCharID.set(-1)
})

//#endregion

//#region the tool call sites

/** The subject of a send that started in chat `chatIndex` of the character at `charIndex`, read back through the live database. */
function subjectAt(charIndex: number, chatIndex = 0): RunSubject {
    const owner = DBState.db.characters[charIndex] as unknown as { chaId: string, chats: Array<{ id: string }> }
    const target = owner.chats[chatIndex]
    return createSendSubject({ chaId: owner.chaId, chatId: target.id }, { owner: owner as never, chat: target as never })
}

const U = 'https://u.test/mcp'
/** The tool list of a request, as `getTools` returns it: each tool carries the URL of the client that listed it. */
const TOOLS = [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: { q: { type: 'number' } } }, mcpURL: U }]

function sseBytes(events: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder()
    return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(events.join(''))); c.close() } })
}

async function drain(stream: ReadableStream<Record<string, string>>): Promise<Record<string, string>[]> {
    const out: Record<string, string>[] = []
    const reader = stream.getReader()
    while (true) {
        const { done, value } = await reader.read()
        if (done) { break }
        out.push(value)
    }
    return out
}

beforeEach(() => {
    m.callTool.mockReset()
    m.callTool.mockResolvedValue([{ type: 'text', text: 'tool-out' }])
    h.globalScript.length = 0; h.nativeScript.length = 0; h.nativeImpl = null; h.nativeCalls.length = 0
})

/** The request's one tool call reached the registry with the tool's name and arguments, the request's subject, and the URL of the client that listed it. */
function expectBoundCall(subject: RunSubject) {
    const calls = m.callTool.mock.calls
    expect(calls, 'the site was driven and found the tool').toHaveLength(1)
    expect(calls[0][0]).toBe('lookup')
    expect(calls[0][1]).toEqual({ q: 1 })
    expect(calls[0], 'name, arguments and the context').toHaveLength(3)
    expect((calls[0][2] as { mcpURL: string }).mcpURL).toBe(U)
    expect((calls[0][2] as { subject: RunSubject }).subject).toBe(subject)
}

describe('a provider hands its tool call to the registry with the request\'s subject and the tool\'s client URL', () => {
    test('Anthropic, non-streaming', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'claude-opus-5', claudeAPIKey: 'k', thinkingType: 'off' }); selectedCharID.set(0)
        const subject = subjectAt(0)
        h.globalScript.push(
            { ok: true, data: { content: [{ type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 1 } }] } },
            { ok: true, data: { content: [{ type: 'text', text: 'done' }] } },
        )

        const result = await ask(subject, { tools: TOOLS })

        expect(result.type).toBe('success')
        expectBoundCall(subject)
    })

    test('Google, non-streaming', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'gemini-3.8-flash', google: { accessToken: 'k' } }); selectedCharID.set(0)
        const subject = subjectAt(0)
        const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
        h.nativeScript.push(
            okJson({ candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { q: 1 } } }] } }] }),
            okJson({ candidates: [{ content: { parts: [{ text: 'done' }] } }] }),
        )

        await ask(subject, { tools: TOOLS })

        expectBoundCall(subject)
    })

    test('Google, streaming, read after the request returned', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'gemini-3.8-flash', google: { accessToken: 'k' }, useStreaming: true }); selectedCharID.set(0)
        const subject = subjectAt(0)
        h.nativeScript.push(
            { status: 200, body: sseBytes([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: { q: 1 } } }] } }] })}\n\n`]) },
            { status: 200, body: sseBytes([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'done' }] } }] })}\n\n`]) },
        )

        const result = await ask(subject, { tools: TOOLS, useStreaming: true })
        expect(result.type).toBe('streaming')
        expect(m.callTool.mock.calls, 'the loop has not run before the stream is read').toHaveLength(0)
        await drain(result.result as ReadableStream<Record<string, string>>)

        expectBoundCall(subject)
    })

    test('OpenAI-compatible, non-streaming', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'gpt4o' }); selectedCharID.set(0)
        const subject = subjectAt(0)
        h.globalScript.push(
            { ok: true, data: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":1}' } }] } }] } },
            { ok: true, data: { choices: [{ message: { role: 'assistant', content: 'done' } }] } },
        )

        const result = await ask(subject, { tools: TOOLS })

        expect(result.type).toBe('success')
        expectBoundCall(subject)
    })

    test('OpenAI-compatible, streaming, read after the request returned', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'gpt4o', useStreaming: true }); selectedCharID.set(0)
        const subject = subjectAt(0)
        const headers = { get: () => 'text/event-stream' }
        h.nativeScript.push(
            { status: 200, headers, body: sseBytes([`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'lookup', arguments: '{"q":1}' } }] } }] })}\n\n`, 'data: [DONE]\n\n']) },
            { status: 200, headers, body: sseBytes([`data: ${JSON.stringify({ choices: [{ delta: { content: 'done' } }] })}\n\n`, 'data: [DONE]\n\n']) },
        )

        const result = await ask(subject, { tools: TOOLS, useStreaming: true })
        expect(result.type).toBe('streaming')
        expect(m.callTool.mock.calls, 'the loop has not run before the stream is read').toHaveLength(0)
        await drain(result.result as ReadableStream<Record<string, string>>)

        expectBoundCall(subject)
    })

    test('Responses API, non-streaming', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'gpt4o-response-api', modelTools: [] }); selectedCharID.set(0)
        const subject = subjectAt(0)
        h.globalScript.push(
            { ok: true, data: { output: [{ id: 'fc1', type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"q":1}', status: 'completed' }] } },
            { ok: true, data: { output_text: 'final' } },
        )

        const result = await ask(subject, { tools: TOOLS })

        expect(result.type).toBe('success')
        expectBoundCall(subject)
    })

    test('Responses API, streaming, read after the request returned', async () => {
        const A = makeChar('a', 'AliceName', [chat('cA')], [])
        installDb([A], { aiModel: 'gpt4o-response-api', modelTools: [], useStreaming: true }); selectedCharID.set(0)
        const subject = subjectAt(0)
        const headers = { get: () => 'text/event-stream' }
        h.nativeScript.push(
            { status: 200, headers, body: sseBytes(['data: {"type":"response.completed","response":{"output_text":"Need","output":[{"id":"fc1","type":"function_call","call_id":"c1","name":"lookup","arguments":"{\\"q\\":1}","status":"completed"}]}}\n\n']) },
            { status: 200, headers, body: sseBytes(['data: {"type":"response.completed","response":{"output_text":"final","output":[{"type":"message","content":[{"type":"output_text","text":"final"}]}]}}\n\n']) },
        )

        const result = await ask(subject, { tools: TOOLS, useStreaming: true })
        expect(result.type).toBe('streaming')
        await drain(result.result as ReadableStream<Record<string, string>>)

        expectBoundCall(subject)
    })
})

//#endregion
