/**
 * Request-level rows of the native-reply writer for streaming Responses API, Anthropic, GoogleCloud and Vertex requests of
 * a single character: each binds the reply grant with its own stream blob, reads the stream with the rule the blob stores,
 * retires a failed head, the overloaded Anthropic attempt before its refetch and a tool round before any later request of
 * the send (every later request is unowned), and tells the page when it stops reading. `formatOwnsReply` decides which formats keep the grant.
 *
 * Drives the real `requestChatData` and the real request paths over the module mocks of `nativeReplyStreamGrant.test.ts`
 * (copied: each suite mocks its own graph). `fetchNative` is a mock that takes the owner the way the real one does, so
 * nothing here says anything about native behaviour.
 */
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import '../../polyfill'
import { resetKeyRings } from './keyRing'
import { issueNativeReplyGrant, takeReplyOwner, type NativeReplyOwnerArg } from '../../nativeReply/grant'
import { LLMFormat } from '../../model/types'
import { configurePageState, heldReply, noteAnnounced, noteInvoked, ownsPushedReply, resetPageStateForTests, setReconcileTrigger, settleNativeReplyInflight, takeAnnounced } from '../../nativeReply/pageState'
import type { PumpProbe, ReplyStamp } from '../../nativeReply/ownedBody'
import type { fetchNative as FetchNative } from '../../globalApi.svelte'

type FetchArg = NonNullable<Parameters<typeof FetchNative>[1]>
interface FetchCall {
    taken: NativeReplyOwnerArg | null
    probe: PumpProbe | undefined
    signal: AbortSignal | undefined
    abandon: ReturnType<typeof vi.fn>
    arg: FetchArg
}

const h = vi.hoisted(() => ({
    log: [] as string[],
    rules: [] as unknown[],
    respRules: [] as unknown[],
    gemRules: [] as unknown[],
    beforeRequest: new Set<(formated: unknown, model: string) => unknown>(),
    sleepGate: undefined as ((ms: number) => Promise<void>) | undefined,
}))

vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('@tauri-apps/api/path', () => ({ basename: vi.fn(async (p: string) => p.split('/').pop()) }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({ listen: vi.fn(), setTitle: vi.fn() })) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: class {} }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: [],
}))
vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))
vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async (body: ReadableStream<Uint8Array>) => new Response(body).text()),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('./openAI/chatStreamTransform', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./openAI/chatStreamTransform')>()
    return {
        ...actual,
        openAIChatStreamTransform: (rule: Parameters<typeof actual.openAIChatStreamTransform>[0], io: Parameters<typeof actual.openAIChatStreamTransform>[1]) => {
            h.rules.push(rule)
            return actual.openAIChatStreamTransform(rule, io)
        },
    }
})
vi.mock('./openAI/responsesStreamTransform', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./openAI/responsesStreamTransform')>()
    return {
        ...actual,
        responsesStreamTransform: (rule: Parameters<typeof actual.responsesStreamTransform>[0], io: Parameters<typeof actual.responsesStreamTransform>[1]) => {
            h.respRules.push(rule)
            return actual.responsesStreamTransform(rule, io)
        },
    }
})
vi.mock('./geminiStreamTransform', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./geminiStreamTransform')>()
    return {
        ...actual,
        geminiStreamTransform: (rule: Parameters<typeof actual.geminiStreamTransform>[0], io: Parameters<typeof actual.geminiStreamTransform>[1]) => {
            h.gemRules.push(rule)
            return actual.geminiStreamTransform(rule, io)
        },
    }
})
vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../files/inlays', () => ({
    getInlayAsset: vi.fn(), getInlayAssetBlob: vi.fn(async () => undefined), writeInlayImage: vi.fn(async () => 'x'), supportsInlayImage: vi.fn(() => false),
    saveInlayedSignature: vi.fn(), setInlayAsset: vi.fn(),
}))
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../plugins/plugins.svelte', () => ({
    pluginV2: {
        editdisplay: new Set(), editoutput: new Set(), editprocess: new Set(), editinput: new Set(), chatOutput: new Set(),
        replacerbeforeRequest: h.beforeRequest, replacerafterRequest: new Set(), providers: new Map(),
    },
    pluginProcess: vi.fn(),
}))
vi.mock('../mcp/mcp', () => ({ getTools: vi.fn(async () => []), callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async (ms: number) => { await h.sleepGate?.(ms) },
}))
vi.mock('../../storage/database.svelte', async () => {
    const stores = await import('../../stores.svelte')
    const state = stores.DBState as unknown as { db: object }
    return {
        appVer: '0.0.0', presetTemplate: {}, changeToPreset: vi.fn(), setCurrentChat: vi.fn(), setDatabase: vi.fn(),
        getDatabase: vi.fn(() => state.db), getCurrentCharacter: vi.fn(() => undefined), getCurrentChat: vi.fn(() => undefined),
    }
})

type Result = { type: string, result: unknown, endsTurn?: boolean }
let requestChatData: (arg: Record<string, unknown>, model: string, abortSignal?: AbortSignal | null) => Promise<Result>
let DBState: { db: Database }
let fetchNativeMock: typeof FetchNative
let formatOwnsReply: (format: number, streaming: boolean) => boolean

const KEY = '0b9c1a7e-0000-4000-8000-000000000001'
const OTHER = '0b9c1a7e-0000-4000-8000-000000000002'
const parseBase = { target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha', generationInfo: {}, promptInfo: {}, escape: false, requestedMs: 1 }
const encoder = new TextEncoder()
const SSE = 'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n'
const sse = (extra: Record<string, string> = {}) => new Response(SSE, { status: 200, headers: { 'Content-Type': 'text/event-stream', ...extra } })
const calls: FetchCall[] = []
const consume = vi.fn(async (_key: string) => ({ result: 'removed' as const, flushed: true }))
const trigger = vi.fn()

beforeAll(async () => {
    const requestModule = await import('./request')
    requestChatData = requestModule.requestChatData as never
    formatOwnsReply = requestModule.formatOwnsReply as never
    DBState = (await import('../../stores.svelte')).DBState as unknown as { db: Database }
    fetchNativeMock = (await import('../../globalApi.svelte')).fetchNative
}, 60_000)

function installDb(extra: Record<string, unknown> = {}): void {
    DBState.db = {
        characters: [], enabledModules: [], modules: [], templateDefaultVariables: '', fallbackModels: {}, requestRetrys: 0, banCharacterset: [],
        aiModel: 'gpt4o', subModel: 'gpt4o', maxResponse: 100, temperature: 80, maxContext: 4000, username: 'GlobalUser', personas: [], selectedPersona: 0,
        seperateModelsForAxModels: false, seperateModels: {}, globalChatVariables: {}, customModels: [], additionalParams: [],
        cipherChat: false, newOAIHandle: false, useStreaming: true, openAIKey: 'sk-test',
        instructChatTemplate: 'chatml', localStopStrings: ['{{char}}:', '{{user}}:'],
        google: { accessToken: '', projectId: 'proj' }, vertexRegion: 'us-central1', vertexAccessTokenExpires: 0, vertexAccessToken: '',
        claudeAPIKey: '', mistralKey: '', cohereAPIKey: '', ollamaApiKey: '', nanogptKey: '', openrouterKey: '', proxyKey: '',
        OaiCompAPIKeys: {}, ollamaCloudModel: 'cloud-m', ollamaModel: 'local-m', ollamaThinkingMode: 'default',
        modelTools: [], customAPIFormat: 0,
        ...extra,
    } as unknown as Database
}

/** The transport mock: takes the owner and answers like the real `fetchNative` for an owned request that was invoked. */
function script(answer: (call: FetchCall, n: number) => Promise<Response> | Response): void {
    vi.mocked(fetchNativeMock).mockImplementation(async (_url: string, arg: FetchArg) => {
        const taken = takeReplyOwner(arg?.nativeReply)
        const call: FetchCall = { taken, probe: arg?.pumpProbe, signal: arg?.signal, abandon: vi.fn(), arg }
        calls.push(call)
        h.log.push('fetch')
        if (taken) {
            noteInvoked(taken.key)
            if (call.probe) {
                call.probe.owned = true
                call.probe.abandon = call.abandon as unknown as () => void
            }
        }
        const response = await answer(call, calls.length)
        if (call.probe) {
            call.probe.head = { status: response.status, headers: Object.fromEntries(response.headers.entries()) }
        }
        return response
    })
}

/**
 * A failed head whose body delivers the stamp as it closes, and not before it is read: the latest the pump can learn the
 * end event's stamp, since that event also closes the body. A caller that retires before it reads the body can miss it.
 */
function failedHead(call: FetchCall, status: number, text: string, value?: ReplyStamp): Response {
    let sent = false
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (!sent) {
                sent = true
                controller.enqueue(encoder.encode(text))
                return
            }
            if (value) {
                stamp(call, value)
            }
            controller.close()
        },
    }, { highWaterMark: 0 })
    return new Response(body, { status })
}

/** A non-200 head whose body errors when read, as the pump errors the body when the transport fails after the head. */
function erroredHead(status: number): Response {
    const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.error(new Error('transport lost')) },
    }, { highWaterMark: 0 })
    return new Response(body, { status })
}

/** The pause of a consume double before it completes and logs: it stands in for the store's IPC round trip. */
const suspend = () => new Promise<void>((resolve) => { setTimeout(resolve, 5) })

/** What the pump does on an end event: the probe learns the stamp, and the stream's own hook is told. */
function stamp(call: FetchCall, value: ReplyStamp): void {
    if (call.probe) {
        call.probe.stamp = value
        call.probe.onStamp?.(value)
    }
}

function ask(extra: Record<string, unknown> = {}, model = 'model', signal: AbortSignal | null = null) {
    return requestChatData({
        formated: [{ role: 'system', content: 'ORIG' }, { role: 'user', content: 'hi' }], bias: {}, useStreaming: true, noMultiGen: true, tools: [],
        chatId: KEY, usageInputEstimate: 7, ...extra,
    }, model, signal).catch((error: unknown) => ({ type: 'threw', result: error }) as Result)
}

beforeEach(() => {
    calls.length = 0
    h.log.length = 0
    h.rules.length = 0
    h.respRules.length = 0
    h.gemRules.length = 0
    h.beforeRequest.clear()
    h.sleepGate = undefined
    consume.mockReset()
    consume.mockImplementation(async (_key: string) => { await suspend(); h.log.push('consume'); return { result: 'removed' as const, flushed: true } })
    trigger.mockReset()
    resetKeyRings()
    resetPageStateForTests()
    configurePageState({
        store: { consume },
        waiter: { committedMarkCount: () => 0, markCount: () => 0, verdict: () => 'absent', afterNextCommit: () => {}, markCharacter: () => {}, requestSaveNow: () => {} },
        onUnreadable: () => {},
    })
    setReconcileTrigger(trigger)
    installDb()
    script(() => sse())
})


/** A provider connection holding two key lines: the slot of the provider then leases a line, so a 429 head rotates. */
const twoKeyConnection = (provider: 'openai' | 'anthropic' | 'google') => ({ id: 'conn-1', name: provider, provider, key: 'k1\nk2' })

const RESPONSES_MODEL = 'gpt4o-response-api'
const respEvent = (name: string, data: Record<string, unknown>) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`
const RESP_TEXT = (text: string) => respEvent('response.output_text.delta', { delta: text })
    + respEvent('response.completed', { response: { output_text: text, output: [], usage: { input_tokens: 7, output_tokens: 1, total_tokens: 8 } } })
const respSse = (text = 'hi') => new Response(RESP_TEXT(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const respToolSse = () => new Response(
    respEvent('response.output_item.done', { item: { type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' } })
    + respEvent('response.completed', { response: { output: [{ type: 'function_call', call_id: 'c1', name: 'f', arguments: '{}' }] } }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const chatToolSse = () => new Response(
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"f","arguments":"{}"}}]},"finish_reason":null}]}\n\n'
    + 'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

async function drain(out: Result): Promise<string> {
    expect(out.type).toBe('streaming')
    const reader = (out.result as ReadableStream<Record<string, string>>).getReader()
    let last = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            return last
        }
        last = value?.['0'] ?? last
    }
}

beforeEach(() => {
    installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL })
    script(() => respSse())
})

describe('B1: a streaming Responses request binds a stream blob of its own kind', () => {
    test('the request runs, then the grant is bound with the openai-responses-stream rule and the usage context', async () => {
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(1)
        expect(heldReply(KEY)?.bound).toBe(true)
        const blob = JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown>, usage: { modelKey: string, inputEstimate: number } }
        expect(blob.parse).toEqual({ kind: 'openai-responses-stream', extractJson: null, jsonSchema: false })
        expect(blob.usage).toEqual({ modelKey: RESPONSES_MODEL, inputEstimate: 7 })
        expect(calls[0].probe).toBeDefined()
    })
})

describe('N1: formatOwnsReply', () => {
    test('OpenAI-compatible owns streamed or not; Responses, Anthropic, GoogleCloud and Vertex own only streamed; every other LLMFormat is refused', () => {
        const ownsAlways = new Set<number>([LLMFormat.OpenAICompatible])
        const ownsStreamed = new Set<number>([LLMFormat.OpenAIResponseAPI, LLMFormat.Anthropic, LLMFormat.GoogleCloud, LLMFormat.VertexAIGemini])
        const formats: number[] = Object.values(LLMFormat)
        expect(formats.length).toBeGreaterThan(ownsAlways.size + ownsStreamed.size)
        for (const format of formats) {
            expect(formatOwnsReply(format, true), `${format} streamed`).toBe(ownsAlways.has(format) || ownsStreamed.has(format))
            expect(formatOwnsReply(format, false), `${format} not streamed`).toBe(ownsAlways.has(format))
        }
    })
})

describe('N2: formats that never own leave the grant unbound', () => {
    test('a non-stream Responses request', async () => {
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), useStreaming: false })
        expect(heldReply(KEY)?.bound).toBe(false)
    })

    test('Claude 2 (AnthropicLegacy)', async () => {
        installDb({ aiModel: 'claude-2.1', subModel: 'claude-2.1', claudeAPIKey: 'k' })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(heldReply(KEY)?.bound).toBe(false)
        expect(calls.every((call) => call.taken === null)).toBe(true)
    })
})

describe('C1: the live Responses read uses the rule of the blob', () => {
    test('a switch flipped between the bind and the reader changes neither the rule nor the text', async () => {
        script((call) => {
            expect(call.taken).not.toBeNull()
            ;(DBState.db as unknown as Record<string, unknown>).jsonSchemaEnabled = true
            return respSse('{"text":"x"}')
        })
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), extractJson: 'text' })
        const text = await drain(out)

        const stored = (JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown> }).parse
        expect(stored).toMatchObject({ kind: 'openai-responses-stream', extractJson: 'text', jsonSchema: false })
        expect(h.respRules).toHaveLength(1)
        expect(h.respRules[0]).toEqual({ extractJson: stored.extractJson, jsonSchema: stored.jsonSchema })
        expect(text).toBe('{"text":"x"}')
    })
})

describe('F: a failed head is retired before any retry, and an announced one ends the turn', () => {
    test('F1: 429 unannounced, then 200: consume is logged between the fetches and the retry is unowned', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 1 })
        script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, status: 429 }) : respSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('F2: an announced 429 gives one request and ends the turn', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 2 })
        script((call) => failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 }))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out).toMatchObject({ type: 'fail', endsTurn: true })
        expect(calls).toHaveLength(1)
        expect(consume).toHaveBeenCalledTimes(1)
    })

    test('a key-limited 429 head with an unannounced stamp is retired before the rotation, whose request is unowned', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 0, connections: [twoKeyConnection('openai')] })
        script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, status: 429 }) : respSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('an announced key-limited 429 head ends the turn instead of rotating', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 0, connections: [twoKeyConnection('openai')] })
        script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 }) : respSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out).toMatchObject({ type: 'fail', endsTurn: true })
        expect(calls).toHaveLength(1)
        expect(h.log).toEqual(['fetch', 'consume'])
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('F3: a 200 that is not an event stream is retired and retried', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 1 })
        script((_call, n) => (n === 1 ? new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }) : respSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
    })

    test('a 200 with no Content-Type header counts as a failed head and does not throw', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 1 })
        script((_call, n) => (n === 1 ? new Response(RESP_TEXT('hi'), { status: 200 }) : respSse()))
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(out.type).toBe('streaming')
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
    })

    test('a failed head of a request with no owner consumes nothing', async () => {
        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 1 })
        script((_call, n) => (n === 1 ? new Response('x', { status: 500 }) : respSse()))
        await ask({})
        expect(consume).not.toHaveBeenCalled()
    })
})

describe('H: a throw or a Stop is the page ending its read', () => {
    test('H1: a throw after the owner was taken notes pageEnded, abandons once, and settle consumes without a reconcile', async () => {
        script((call) => {
            stamp(call, { key: KEY, outcome: 'failed', stored: false })
            throw new Error('connection refused')
        })
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(out.type).toBe('threw')
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)

        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })

    test('H2: a page timeout before the head (no stamp) notes pageEnded and settle consumes', async () => {
        script(() => { throw new Error('requestTimedOut') })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })

    test('H3: a Stop after the stream is returned and before anything is read notes pageEnded and abandons once, with no settle', async () => {
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(RESP_TEXT('hi'))) } })
        script(() => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
        const controller = new AbortController()

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) }, 'model', controller.signal)
        expect(out.type).toBe('streaming')
        expect(heldReply(KEY)?.pageEnded).toBeUndefined()

        controller.abort()

        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)
        expect(consume).not.toHaveBeenCalled()
    })

    test('H4: a request of another reply binds nothing and leaves the grant usable; no input estimate binds nothing', async () => {
        const grant = issueNativeReplyGrant(KEY, parseBase)
        await ask({ nativeReplyGrant: grant, chatId: OTHER })
        expect(calls[0].taken).toBeNull()
        expect(heldReply(KEY)?.bound).toBe(false)
        await ask({ nativeReplyGrant: grant, chatId: KEY })
        expect(calls[1].taken?.key).toBe(KEY)

        await ask({ nativeReplyGrant: issueNativeReplyGrant(OTHER, parseBase), chatId: OTHER, usageInputEstimate: undefined })
        expect(calls[2].taken).toBeNull()
    })
})

describe('W: a tool round on an owned stream retires the record before the follow-up request', () => {
    test('W0: an OpenAI-compatible stream whose final emission has tool calls', async () => {
        installDb({ aiModel: 'gpt4o', subModel: 'gpt4o' })
        script((_call, n) => (n === 1 ? chatToolSse() : sse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        await drain(out)

        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
    })

    test('W1: a Responses stream whose completed response holds a function call', async () => {
        script((_call, n) => (n === 1 ? respToolSse() : respSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        await drain(out)

        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
    })

    test('a stream with no tool call consumes nothing while the request runs', async () => {
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        await drain(out)
        expect(consume).not.toHaveBeenCalled()
    })
})

describe('K1: two owned requests of different formats never retire each other', () => {
    test("retiring one reply's failed head leaves the other held entry as it was", async () => {
        const grantA = issueNativeReplyGrant(KEY, parseBase)
        const grantB = issueNativeReplyGrant(OTHER, parseBase)
        installDb({ aiModel: 'gpt4o', subModel: 'gpt4o' })
        await ask({ nativeReplyGrant: grantB, chatId: OTHER })
        const before = structuredClone(heldReply(OTHER))
        expect(before?.bound).toBe(true)

        installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL })
        script((call) => failedHead(call, 500, 'x', { key: KEY, outcome: 'done', stored: true, status: 500 }))
        await ask({ nativeReplyGrant: grantA, chatId: KEY })

        expect(consume).toHaveBeenCalledTimes(1)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(heldReply(OTHER)).toEqual(before)
    })
})

// ---- Anthropic (S4b) ----

const CLAUDE_MODEL = 'claude-3-5-sonnet-latest'
const claudeEvent = (name: string, data: Record<string, unknown>) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`
const claudeStart = () => claudeEvent('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 1, output_tokens: 1 } } })
const claudeBlock = () => claudeEvent('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
const claudeDelta = (text: string) => claudeEvent('content_block_delta', { index: 0, delta: { type: 'text_delta', text } })
const claudeEnd = () => claudeEvent('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) + claudeEvent('message_stop', {})
const CLAUDE_OVERLOAD = claudeEvent('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })
const claudeText = (text = 'hi') => claudeStart() + claudeBlock() + claudeDelta(text) + claudeEnd()
const claudeSse = (text = 'hi') => new Response(claudeText(text), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

/** An open body that ends its owned read like `tauriReadableStream.cancel` does: the native request is abandoned. */
function claudeOverloadBody(call: FetchCall): Response {
    const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(encoder.encode(claudeStart() + claudeBlock() + claudeDelta('partial') + CLAUDE_OVERLOAD)) },
        cancel() { h.log.push('abandon'); (call.abandon as unknown as () => void)() },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function installClaude(extra: Record<string, unknown> = {}): void {
    installDb({ aiModel: CLAUDE_MODEL, subModel: CLAUDE_MODEL, claudeAPIKey: 'k', ...extra })
}

describe('B2: a streaming Anthropic request binds a stream blob of its own kind', () => {
    test('the request runs, then the grant is bound with the anthropic-stream rule and the usage context', async () => {
        installClaude()
        script(() => claudeSse())
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(1)
        expect(heldReply(KEY)?.bound).toBe(true)
        const blob = JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown>, usage: { modelKey: string, inputEstimate: number } }
        expect(blob.parse).toEqual({ kind: 'anthropic-stream' })
        expect(blob.usage).toEqual({ modelKey: CLAUDE_MODEL, inputEstimate: 7 })
        expect(calls[0].probe).toBeDefined()
        expect(await drain(out)).toBe('hi')
    })
})

describe('N2/N3 (Anthropic): requests that never own leave the grant unbound', () => {
    test('a non-stream Anthropic request', async () => {
        installClaude()
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), useStreaming: false })
        expect(heldReply(KEY)?.bound).toBe(false)
    })

    test('N3: batching returns before the stream branch: no request carries an owner and settle drops the key without a consume', async () => {
        installClaude({ claudeBatching: true })
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(calls.every((call) => call.taken === null)).toBe(true)
        expect(heldReply(KEY)?.bound).toBe(false)
        await settleNativeReplyInflight(KEY)
        expect(consume).not.toHaveBeenCalled()
    })
})

describe('F (Anthropic): a failed head is retired before any retry, and an announced one ends the turn', () => {
    test('F1: 429 unannounced, then 200: consume is logged between the fetches and the retry is unowned', async () => {
        installClaude({ requestRetrys: 1 })
        script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, status: 429 }) : claudeSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('F2: an announced 429 gives one request and ends the turn', async () => {
        installClaude({ requestRetrys: 2 })
        script((call) => failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 }))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out).toMatchObject({ type: 'fail', endsTurn: true })
        expect(calls).toHaveLength(1)
        expect(consume).toHaveBeenCalledTimes(1)
    })
})

describe('F (Anthropic): a key-limited failed head', () => {
    test('a 429 head with an unannounced stamp is retired before the rotation, whose request is unowned', async () => {
        installClaude({ requestRetrys: 0, connections: [twoKeyConnection('anthropic')] })
        script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, status: 429 }) : claudeSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('streaming')
        expect(calls).toHaveLength(2)
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        expect(heldReply(KEY)).toBeUndefined()
    })

    test('an announced key-limited 429 head ends the turn instead of rotating', async () => {
        installClaude({ requestRetrys: 0, connections: [twoKeyConnection('anthropic')] })
        script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 }) : claudeSse()))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out).toMatchObject({ type: 'fail', endsTurn: true })
        expect(calls).toHaveLength(1)
        expect(h.log).toEqual(['fetch', 'consume'])
        expect(heldReply(KEY)).toBeUndefined()
    })
})

describe('H (Anthropic): a throw or a Stop is the page ending its read', () => {
    test('H1: a throw after the owner was taken notes pageEnded, abandons once, and settle consumes without a reconcile', async () => {
        installClaude()
        script((call) => {
            stamp(call, { key: KEY, outcome: 'failed', stored: false })
            throw new Error('connection refused')
        })
        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(out.type).toBe('threw')
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)

        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })

    test('a Stop after the stream is returned notes pageEnded and abandons once, with no settle', async () => {
        installClaude()
        const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(claudeStart())) } })
        script(() => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
        const controller = new AbortController()

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) }, 'model', controller.signal)
        expect(out.type).toBe('streaming')
        expect(heldReply(KEY)?.pageEnded).toBeUndefined()
        controller.abort()

        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)
        expect(consume).not.toHaveBeenCalled()
    })
})

describe('O: an overload refetch retires the first record before the unowned retry', () => {
    const overloadSetup = (extra: Record<string, unknown> = {}) => installClaude({ antiServerOverloads: true, requestRetrys: 1, ...extra })

    test('O1: the order is fetch(owned), abandon, consume, fetch(unowned); the retry text is the reply and nothing waits for its push', async () => {
        overloadSetup()
        script((call, n) => (n === 1 ? claudeOverloadBody(call) : claudeSse('retried')))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        expect(out.type).toBe('streaming')
        const text = await drain(out)

        expect(h.log).toEqual(['fetch', 'abandon', 'consume', 'fetch'])
        expect(calls[0].taken).not.toBeNull()
        expect(calls[1].taken).toBeNull()
        expect(text).toBe('retried')
        expect(ownsPushedReply(KEY)).toBe(false)
    })

    test('O2: a live: answer leaves the entry release, the retry still runs, and nothing waits for its push', async () => {
        overloadSetup()
        // The store rejects with a plain string, as the native command's error text reaches the page.
        consume.mockImplementation(async (_key: string) => { await suspend(); h.log.push('consume'); throw 'live: reply 0b9c1a7e-0000-4000-8000-000000000001 is still being received' })
        script((call, n) => (n === 1 ? claudeOverloadBody(call) : claudeSse('retried')))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        const text = await drain(out)

        expect(h.log).toEqual(['fetch', 'abandon', 'consume', 'fetch'])
        expect(text).toBe('retried')
        expect(ownsPushedReply(KEY)).toBe(false)
        expect(heldReply(KEY)?.state).toBe('release')
    })

    test('O3: a Stop during the sleep retires nothing and does not refetch; the listener noted pageEnded', async () => {
        overloadSetup()
        let entered!: () => void
        const sleeping = new Promise<void>((resolve) => { entered = resolve })
        let release!: () => void
        h.sleepGate = () => { entered(); return new Promise<void>((resolve) => { release = resolve }) }
        script((call) => claudeOverloadBody(call))
        const controller = new AbortController()

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) }, 'model', controller.signal)
        const drained = drain(out)
        await sleeping
        controller.abort()
        release()
        await drained

        expect(consume).not.toHaveBeenCalled()
        expect(calls).toHaveLength(1)
        expect(heldReply(KEY)?.pageEnded).toBe(true)
    })

    test('O3b: a Stop landing during the retire skips the refetch', async () => {
        overloadSetup()
        const controller = new AbortController()
        consume.mockImplementation(async (_key: string) => { await suspend(); h.log.push('consume'); controller.abort(); return { result: 'removed' as const, flushed: true } })
        script((call) => claudeOverloadBody(call))

        // The Stop lands while the retire is suspended; the refetch must not follow once the retire completes.
        await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) }, 'model', controller.signal)
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(consume).toHaveBeenCalledTimes(1)
        expect(calls).toHaveLength(1)
    })

    test('O4: the retry stream overloading too retires only once', async () => {
        overloadSetup({ requestRetrys: 2 })
        const overloadClosed = () => new Response(claudeStart() + claudeBlock() + claudeDelta('p') + CLAUDE_OVERLOAD, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        script((call, n) => (n === 1 ? claudeOverloadBody(call) : n === 2 ? overloadClosed() : claudeSse('third')))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        const text = await drain(out)

        expect(calls).toHaveLength(3)
        expect(consume).toHaveBeenCalledTimes(1)
        expect(text).toBe('third')
    })

    test('O5: with the setting off the overload text is the reply and nothing is retired while the request runs', async () => {
        overloadSetup({ antiServerOverloads: false })
        script(() => new Response(claudeStart() + claudeBlock() + claudeDelta('partial') + CLAUDE_OVERLOAD, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        const text = await drain(out)

        expect(calls).toHaveLength(1)
        expect(consume).not.toHaveBeenCalled()
        expect(text).toContain('Error:')
        expect(text).toContain('Overloaded')
    })

    test('O6: the announced fact the first stamp set is dropped, so the page posts its own notice at the real end', async () => {
        overloadSetup()
        let announcedBeforeRetire: boolean | undefined
        h.sleepGate = async () => {
            announcedBeforeRetire = takeAnnounced([KEY])
            noteAnnounced(KEY)
        }
        script((call, n) => {
            if (n === 1) {
                stamp(call, { key: KEY, outcome: 'done', stored: true, announced: true, status: 200 })
                return claudeOverloadBody(call)
            }
            return claudeSse('retried')
        })

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
        await drain(out)

        expect(announcedBeforeRetire).toBe(true)
        expect(takeAnnounced([KEY])).toBe(false)
    })
})

// ---- Gemini (S4c) ----

const GEMINI_MODEL = 'gemini-3.8-flash'
const VERTEX_MODEL = 'gemini-3.8-flash-vertex'
type GeminiPartFixture = { text?: string, thought?: boolean, thoughtSignature?: string, functionCall?: { name: string, args: Record<string, unknown> } }
const geminiLine = (parts: GeminiPartFixture[], usage = true) => `data: ${JSON.stringify({
    candidates: [{ content: { role: 'model', parts } }],
    ...(usage ? { usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1, totalTokenCount: 8 } } : {}),
})}\n\n`
const sseResponse = (text: string) => new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const geminiSse = (text = 'hi') => sseResponse(geminiLine([{ text }]))
const geminiToolSse = () => sseResponse(geminiLine([{ functionCall: { name: 'f', args: {} } }]))

function installGemini(extra: Record<string, unknown> = {}, model = GEMINI_MODEL): void {
    installDb({ aiModel: model, subModel: model, google: { accessToken: 'gk', projectId: 'proj' }, vertexAccessTokenExpires: Date.now() + 3_600_000, vertexAccessToken: 'vt', ...extra })
}

describe('Gemini (S4c)', () => {
    describe('B3/B4: a streaming Gemini request binds a stream blob of its own kind', () => {
        test('B3: GoogleCloud binds gemini-stream with the rule of the request and the usage context', async () => {
            installGemini()
            script(() => geminiSse())
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out.type).toBe('streaming')
            expect(calls).toHaveLength(1)
            expect(heldReply(KEY)?.bound).toBe(true)
            const blob = JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown>, usage: { modelKey: string, inputEstimate: number } }
            expect(blob.parse).toEqual({
                kind: 'gemini-stream', extractJson: null, jsonSchema: false, streamThoughts: false, saveSignatures: false,
                signatureSource: GEMINI_MODEL, signatureFormat: LLMFormat.GoogleCloud,
            })
            expect(blob.usage).toEqual({ modelKey: GEMINI_MODEL, inputEstimate: 7 })
            expect(calls[0].probe).toBeDefined()
            expect(await drain(out)).toBe('hi')
        })

        test('B4: Vertex binds gemini-stream with the Vertex signature format', async () => {
            installGemini({}, VERTEX_MODEL)
            script(() => geminiSse())
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out.type).toBe('streaming')
            expect(calls).toHaveLength(1)
            expect(heldReply(KEY)?.bound).toBe(true)
            const blob = JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown> }
            expect(blob.parse).toMatchObject({ kind: 'gemini-stream', signatureFormat: LLMFormat.VertexAIGemini })
            expect(calls[0].probe).toBeDefined()
        })
    })

    describe('N2/N4 (Gemini): requests that never own leave the grant unbound', () => {
        test('a non-stream Gemini request', async () => {
            installGemini()
            await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), useStreaming: false })
            expect(heldReply(KEY)?.bound).toBe(false)
            expect(calls.every((call) => call.taken === null)).toBe(true)
        })

        test('N4: image output turns streaming off after the strip: no request carries an owner and settle drops the key without a consume', async () => {
            installGemini()
            await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), imageResponse: true })
            expect(calls.every((call) => call.taken === null)).toBe(true)
            expect(heldReply(KEY)?.bound).toBe(false)
            await settleNativeReplyInflight(KEY)
            expect(consume).not.toHaveBeenCalled()
        })
    })

    describe('C1 (Gemini): the live read and the tool wrap use the rule of the blob', () => {
        test('the transform gets the blob rule, and a thoughts switch flipped after the bind changes neither', async () => {
            installGemini()
            script((call) => {
                expect(call.taken).not.toBeNull()
                ;(DBState.db as unknown as Record<string, unknown>).streamGeminiThoughts = true
                return sseResponse(geminiLine([{ text: 'x' }, { text: 'T', thought: true }]))
            })
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
            const text = await drain(out)

            const stored = (JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown> }).parse
            expect(stored.streamThoughts).toBe(false)
            expect(h.gemRules).toHaveLength(1)
            const { kind, ...fields } = stored
            expect(kind).toBe('gemini-stream')
            expect(h.gemRules[0]).toEqual(fields)
            expect(text).toBe('<Thoughts>\n\nT\n\n</Thoughts>\n\nx')
        })

        test('a JSON-schema switch flipped after the bind does not change the extraction', async () => {
            installGemini({ jsonSchemaEnabled: true, jsonSchema: '{"type":"object"}' })
            script((call) => {
                expect(call.taken).not.toBeNull()
                ;(DBState.db as unknown as Record<string, unknown>).jsonSchemaEnabled = false
                return geminiSse('{"text":"x"}')
            })
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), extractJson: 'text' })
            const text = await drain(out)

            const stored = (JSON.parse(calls[0].taken!.blob) as { parse: Record<string, unknown> }).parse
            expect(stored).toMatchObject({ extractJson: 'text', jsonSchema: true })
            expect(text).toBe('x')
        })
    })

    describe('F (Gemini): a failed head is retired before any retry, and an announced one ends the turn', () => {
        test('F1: 429 unannounced, then 200: consume is logged between the fetches and the retry is unowned', async () => {
            installGemini({ requestRetrys: 1 })
            script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, status: 429 }) : geminiSse()))

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out.type).toBe('streaming')
            expect(calls).toHaveLength(2)
            expect(calls[0].taken).not.toBeNull()
            expect(calls[1].taken).toBeNull()
            expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
            expect(heldReply(KEY)).toBeUndefined()
        })

        test('F2: an announced 429 gives one request and ends the turn', async () => {
            installGemini({ requestRetrys: 2 })
            script((call) => failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 }))

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out).toMatchObject({ type: 'fail', endsTurn: true })
            expect(calls).toHaveLength(1)
            expect(consume).toHaveBeenCalledTimes(1)
        })

        test('F4: an unannounced RESOURCE_EXHAUSTED is retired before the fallback request, which is unowned', async () => {
            installGemini({ antiServerOverloads: true })
            script((call, n) => (n === 1
                ? failedHead(call, 429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}', { key: KEY, outcome: 'done', stored: true, status: 429 })
                : geminiSse()))

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out.type).toBe('streaming')
            expect(calls).toHaveLength(2)
            expect(calls[0].taken).not.toBeNull()
            expect(calls[1].taken).toBeNull()
            expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        })

        test('F4: an announced RESOURCE_EXHAUSTED ends the turn without the fallback request', async () => {
            installGemini({ antiServerOverloads: true })
            // A second request answers 200, so a fallback that recurses ends the loop instead of repeating the 429 forever.
            script((call, n) => {
                if (n > 1) {
                    return geminiSse()
                }
                return failedHead(call, 429, '{"error":{"status":"RESOURCE_EXHAUSTED"}}', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 })
            })

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out).toMatchObject({ type: 'fail', endsTurn: true })
            expect(calls).toHaveLength(1)
            expect(consume).toHaveBeenCalledTimes(1)
        })
    })

    describe('F (Gemini): a key-limited failed head', () => {
        test('a 429 head with an unannounced stamp is retired before the rotation, whose request is unowned', async () => {
            installGemini({ requestRetrys: 0, connections: [twoKeyConnection('google')] })
            script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, status: 429 }) : geminiSse()))

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out.type).toBe('streaming')
            expect(calls).toHaveLength(2)
            expect(calls[0].taken).not.toBeNull()
            expect(calls[1].taken).toBeNull()
            expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
            expect(heldReply(KEY)).toBeUndefined()
        })

        test('an announced key-limited 429 head ends the turn instead of rotating', async () => {
            installGemini({ requestRetrys: 0, connections: [twoKeyConnection('google')] })
            script((call, n) => (n === 1 ? failedHead(call, 429, 'slow down', { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 }) : geminiSse()))

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

            expect(out).toMatchObject({ type: 'fail', endsTurn: true })
            expect(calls).toHaveLength(1)
            expect(h.log).toEqual(['fetch', 'consume'])
            expect(heldReply(KEY)).toBeUndefined()
        })
    })

    describe('H (Gemini): a throw or a Stop is the page ending its read', () => {
        test('H1: a throw after the owner was taken notes pageEnded, abandons once, and settle consumes without a reconcile', async () => {
            installGemini()
            script((call) => {
                stamp(call, { key: KEY, outcome: 'failed', stored: false })
                throw new Error('connection refused')
            })
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
            expect(out.type).toBe('threw')
            expect(heldReply(KEY)?.pageEnded).toBe(true)
            expect(calls[0].abandon).toHaveBeenCalledTimes(1)

            await settleNativeReplyInflight(KEY)
            expect(consume).toHaveBeenCalledWith(KEY)
            expect(trigger).not.toHaveBeenCalled()
        })
    })

    describe('W2: a tool round on an owned Gemini stream retires the record before the follow-up request', () => {
        test('a stream whose final emission holds a function call', async () => {
            installGemini()
            script((_call, n) => (n === 1 ? geminiToolSse() : geminiSse()))

            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
            await drain(out)

            expect(calls).toHaveLength(2)
            expect(calls[0].taken).not.toBeNull()
            expect(calls[1].taken).toBeNull()
            expect(h.log).toEqual(['fetch', 'consume', 'fetch'])
        })

        test('a stream with no function call consumes nothing while the request runs', async () => {
            installGemini()
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })
            await drain(out)
            expect(consume).not.toHaveBeenCalled()
        })
    })

    describe('G5: the live path keeps its fire-and-forget signature writes on an owned stream', () => {
        const signed = () => sseResponse(geminiLine([{ text: 'a', thoughtSignature: 'sigA' }], false) + geminiLine([{ text: 'b', thoughtSignature: 'sigB' }]))
        const written = async () => {
            const saved = vi.mocked((await import('../files/inlays')).saveInlayedSignature)
            return saved.mock.calls.map(([, signature]) => signature)
        }

        test('the owned run writes the same signatures as the unowned run, and the stream never waits on a write', async () => {
            const saved = vi.mocked((await import('../files/inlays')).saveInlayedSignature)
            installGemini()
            saved.mockReset()
            saved.mockImplementation(async () => '')
            script(() => signed())
            await drain(await ask({ saveSignatures: true }))
            const unowned = await written()
            expect(unowned.length).toBeGreaterThan(0)

            saved.mockReset()
            saved.mockImplementation(() => new Promise<string>(() => {}))
            script(() => signed())
            const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase), saveSignatures: true })
            expect(calls[calls.length - 1].taken).not.toBeNull()
            await drain(out)
            expect(await written()).toEqual(unowned)
        })
    })

    describe('K1: two owned requests of different formats never retire each other', () => {
        test("retiring an Anthropic reply's failed head leaves the Gemini held entry as it was", async () => {
            const grantA = issueNativeReplyGrant(KEY, parseBase)
            const grantB = issueNativeReplyGrant(OTHER, parseBase)
            installGemini()
            script(() => geminiSse())
            await ask({ nativeReplyGrant: grantB, chatId: OTHER })
            const before = structuredClone(heldReply(OTHER))
            expect(before?.bound).toBe(true)

            installClaude()
            script((call) => failedHead(call, 500, 'x', { key: KEY, outcome: 'done', stored: true, status: 500 }))
            await ask({ nativeReplyGrant: grantA, chatId: KEY })

            expect(consume).toHaveBeenCalledTimes(1)
            expect(consume).toHaveBeenCalledWith(KEY)
            expect(heldReply(OTHER)).toEqual(before)
        })
    })
})

describe('D: a non-200 head whose body errors is the page ending its read', () => {
    const providers: Array<[string, () => void]> = [
        ['Responses', () => installDb({ aiModel: RESPONSES_MODEL, subModel: RESPONSES_MODEL, requestRetrys: 2 })],
        ['Anthropic', () => installClaude({ requestRetrys: 2 })],
        ['Gemini', () => installGemini({ requestRetrys: 2 })],
    ]

    test.each(providers)('%s: the read ends like a throw, with no retire and no later owned request', async (_name, install) => {
        install()
        script(() => erroredHead(500))

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out.type).toBe('threw')
        expect(calls).toHaveLength(1)
        expect(heldReply(KEY)?.pageEnded).toBe(true)
        expect(calls[0].abandon).toHaveBeenCalledTimes(1)
        expect(consume).not.toHaveBeenCalled()

        await settleNativeReplyInflight(KEY)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(trigger).not.toHaveBeenCalled()
    })
})
