/**
 * Request-level rows of the S4a native-reply writer: a streaming Responses API request of a single character binds the
 * reply grant with its own stream blob, reads the stream with the rule the blob stores, retires a failed head and a tool
 * round before any later request of the send (every later request is unowned), and tells the page when it stops reading.
 * `formatOwnsReply` decides which formats keep the grant.
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
import { configurePageState, heldReply, noteInvoked, resetPageStateForTests, setReconcileTrigger, settleNativeReplyInflight, takeAnnounced } from '../../nativeReply/pageState'
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
    beforeRequest: new Set<(formated: unknown, model: string) => unknown>(),
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
    bodyIntercepterStore: writable(null),
}))
vi.mock('../../alert', () => ({
    alertError: vi.fn(), alertToast: vi.fn(), alertInput: vi.fn(async () => ''), alertNormal: vi.fn(), alertSelect: vi.fn(async () => ''),
    alertConfirm: vi.fn(async () => true), alertClear: vi.fn(), alertModuleSelect: vi.fn(async () => -1), alertStore: writable({ type: '', msg: '' }), alertWait: vi.fn(),
}))
vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
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
    sleep: async () => {},
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
        return answer(call, calls.length)
    })
}

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
    h.beforeRequest.clear()
    consume.mockReset()
    consume.mockImplementation(async (_key: string) => { h.log.push('consume'); return { result: 'removed' as const, flushed: true } })
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
    test('OpenAI-compatible owns streamed or not; Responses owns only streamed; every other format is refused', () => {
        expect(formatOwnsReply(LLMFormat.OpenAICompatible, true)).toBe(true)
        expect(formatOwnsReply(LLMFormat.OpenAICompatible, false)).toBe(true)
        expect(formatOwnsReply(LLMFormat.OpenAIResponseAPI, true)).toBe(true)
        expect(formatOwnsReply(LLMFormat.OpenAIResponseAPI, false)).toBe(false)
        for (const format of [LLMFormat.AnthropicLegacy, LLMFormat.AWSBedrockClaude, LLMFormat.NanoGPTMessages, LLMFormat.NanoGPTResponses, LLMFormat.Mistral, LLMFormat.NanoGPT, LLMFormat.Ollama]) {
            expect(formatOwnsReply(format, true), String(format)).toBe(false)
            expect(formatOwnsReply(format, false), String(format)).toBe(false)
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
        script((call, n) => {
            if (n === 1) {
                stamp(call, { key: KEY, outcome: 'done', stored: true, status: 429 })
                return new Response('slow down', { status: 429 })
            }
            return respSse()
        })

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
        script((call) => {
            stamp(call, { key: KEY, outcome: 'done', stored: true, announced: true, status: 429 })
            return new Response('slow down', { status: 429 })
        })

        const out = await ask({ nativeReplyGrant: issueNativeReplyGrant(KEY, parseBase) })

        expect(out).toMatchObject({ type: 'fail', endsTurn: true })
        expect(calls).toHaveLength(1)
        expect(consume).toHaveBeenCalledTimes(1)
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
        script((call) => {
            stamp(call, { key: KEY, outcome: 'done', stored: true, status: 500 })
            return new Response('x', { status: 500 })
        })
        await ask({ nativeReplyGrant: grantA, chatId: KEY })

        expect(consume).toHaveBeenCalledTimes(1)
        expect(consume).toHaveBeenCalledWith(KEY)
        expect(heldReply(OTHER)).toEqual(before)
    })
})