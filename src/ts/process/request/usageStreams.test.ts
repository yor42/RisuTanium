import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
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
vi.mock('../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db, setDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: [],
}))
vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../alert', () => ({ alertError: vi.fn() }))
vi.mock('../files/inlays', () => ({
    saveInlayedSignature: vi.fn(),
    setInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(),
    supportsInlayImage: vi.fn(() => false),
}))
vi.mock('../mcp/mcp', () => ({ callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}))
vi.mock('../../plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: [] }))
vi.mock('../../model/modelData/modelDataStore', () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
    loadProviderLists: vi.fn(),
    saveProviderLists: vi.fn(async () => {}),
}))
vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

import { fetchNative, textifyReadableStream } from '../../globalApi.svelte'
import { callTool } from '../mcp/mcp'
import { createUsageMeter } from '../../usage/usageMeter'
import { settleUsage } from '../../usage/usageCapture'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer } from '../../model/types'
import type { TokenUsage, UsageMeterState } from '../../usage/usageTypes'
import { requestClaude } from './anthropic'
import { __testGeminiStream, requestGoogleCloudVertex } from './google'
import { __testOpenAIChatStream, __testResponsesAPI } from './openAI/requests'
import type { RequestDataArgumentExtended } from './request'

/**
 * Stream usage reporting of each provider's real stream code, with a recording meter. Mocked: the transport
 * (`fetchNative`), `sleep`, and the database, store and plugin modules the catalog imports, so a passing test says
 * nothing about native behaviour. Fixtures are shaped like each provider's wire format (SSE lines, final usage
 * event). Titles starting with `guard:` pass with or without the change.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const textifyMock = vi.mocked(textifyReadableStream)
const encoder = new TextEncoder()

function spyMeter() {
    const reports: TokenUsage[] = []
    const markFailed = vi.fn()
    const meter: UsageMeterState = {
        report: (usage) => { reports.push(usage) },
        markFailed,
        reported: () => null,
        failed: () => false,
    }
    return { reports, markFailed, meter }
}

async function drive<T>(stream: TransformStream<Uint8Array, T>, parts: (string | Uint8Array)[]): Promise<T[]> {
    const writer = stream.writable.getWriter()
    const reader = stream.readable.getReader()
    const pump = (async () => {
        for (const part of parts) { await writer.write(typeof part === 'string' ? encoder.encode(part) : part) }
        await writer.close()
    })()
    const out: T[] = []
    while (true) {
        const { done, value } = await reader.read()
        if (done) { break }
        out.push(value)
    }
    await pump
    return out
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        claudeAPIKey: 'plain-key',
        gptVisionQuality: 'low',
        additionalParams: [],
        customModels: [],
        modelTools: [],
        OaiCompAPIKeys: {},
        requestRetrys: 0,
        temperature: 70,
        top_p: 0.9,
    })
    fetchNativeMock.mockReset()
    textifyMock.mockReset()
    textifyMock.mockImplementation(async () => 'FAILBODY')
})

// ---- OpenAI chat ----

const oaChunk = (choices: unknown[], extra: Record<string, unknown> = {}) =>
    'data: ' + JSON.stringify({ id: 'chatcmpl-abc123', object: 'chat.completion.chunk', created: 1731000000, model: 'gpt-4o', choices, ...extra }) + '\n\n'
const oaText = (content: string) => oaChunk([{ index: 0, delta: { content } }])
const OA_USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 } }
const oaUsageChunk = (usage: unknown = OA_USAGE) => oaChunk([], { usage })
const OA_DONE = 'data: [DONE]\n\n'

function openAIStream(meter: UsageMeterState) {
    return __testOpenAIChatStream.getTranStream({ usageMeter: meter, modelInfo: { flags: [] }, multiGen: false } as unknown as RequestDataArgumentExtended)
}

describe('OpenAI chat stream usage', () => {
    test('the final usage chunk with empty choices is reported once, cached tokens split out', async () => {
        const { reports, meter } = spyMeter()
        await drive(openAIStream(meter), [oaText('Hi'), oaText(' there'), oaUsageChunk(), OA_DONE])
        expect(reports).toEqual([{ input: 6, output: 5, cacheRead: 4, cacheWrite: 0 }])
    })

    test('a usage line split across two reads is reported exactly once', async () => {
        const { reports, meter } = spyMeter()
        const line = oaUsageChunk()
        await drive(openAIStream(meter), [oaText('Hi'), line.slice(0, 40), line.slice(40), OA_DONE])
        expect(reports).toHaveLength(1)
    })

    test('a usage line still in the unfinished tail is not reported', async () => {
        const { reports, meter } = spyMeter()
        await drive(openAIStream(meter), [oaText('Hi'), oaUsageChunk().trimEnd()])
        expect(reports).toHaveLength(0)
    })

    test('guard: a stream whose every chunk has usage null reports nothing and does not error', async () => {
        const { reports, meter } = spyMeter()
        const out = await drive(openAIStream(meter), [oaChunk([{ index: 0, delta: { content: 'a' } }], { usage: null }), oaChunk([{ index: 0, delta: { content: 'b' } }], { usage: null }), OA_DONE])
        expect(reports).toHaveLength(0)
        expect(out.length).toBeGreaterThan(0)
    })

    test('a usage null chunk after the usage chunk does not erase it', async () => {
        const { reports, meter } = spyMeter()
        await drive(openAIStream(meter), [oaText('Hi'), oaUsageChunk(), oaChunk([], { usage: null }), OA_DONE])
        expect(reports).toHaveLength(1)
        expect(reports[0].output).toBe(5)
    })

    test('guard: a stream with no meter on the argument still runs', async () => {
        const out = await drive(__testOpenAIChatStream.getTranStream({ modelInfo: { flags: [] }, multiGen: false } as unknown as RequestDataArgumentExtended), [oaText('Hi'), oaUsageChunk(), OA_DONE])
        expect(out.length).toBeGreaterThan(0)
    })
})

// ---- Responses API ----

const rsEvent = (event: unknown) => 'data: ' + JSON.stringify(event) + '\n\n'
const RS_USAGE = { input_tokens: 20, input_tokens_details: { cached_tokens: 8 }, output_tokens: 6, output_tokens_details: { reasoning_tokens: 2 }, total_tokens: 26 }

describe('Responses stream usage', () => {
    test('the response.completed usage is reported once; input excludes cached tokens', async () => {
        const { reports, meter } = spyMeter()
        const stream = __testResponsesAPI.getResponsesTranStream({ usageMeter: meter, modelInfo: { flags: [] } } as unknown as RequestDataArgumentExtended)
        await drive(stream, [
            rsEvent({ type: 'response.output_text.delta', delta: 'Hi' }),
            rsEvent({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }], usage: RS_USAGE } }),
        ])
        expect(reports).toEqual([{ input: 12, output: 6, cacheRead: 8, cacheWrite: 0 }])
    })

    test('guard: a stream that never completed reports nothing', async () => {
        const { reports, meter } = spyMeter()
        const stream = __testResponsesAPI.getResponsesTranStream({ usageMeter: meter, modelInfo: { flags: [] } } as unknown as RequestDataArgumentExtended)
        await drive(stream, [rsEvent({ type: 'response.output_text.delta', delta: 'Hi' })])
        expect(reports).toHaveLength(0)
    })
})

// ---- Gemini ----

const gemEvent = (text: string, usageMetadata?: unknown) =>
    'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0 }], ...(usageMetadata ? { usageMetadata } : {}) }) + '\n\n'
const GEM_USAGE = { promptTokenCount: 30, candidatesTokenCount: 7, thoughtsTokenCount: 3, cachedContentTokenCount: 10, totalTokenCount: 40 }

describe('Gemini stream usage', () => {
    const modelInfo = { id: 'gemini-x', internalID: 'gemini-x', format: LLMFormat.GoogleCloud, flags: [] }
    test('the cumulative usageMetadata of the committed lines is reported once', async () => {
        const { reports, meter } = spyMeter()
        const stream = __testGeminiStream.getTranStream({ modelInfo: modelInfo as never, saveSignature: false, usage: meter })
        await drive(stream, [gemEvent('a', { promptTokenCount: 30, candidatesTokenCount: 1, totalTokenCount: 31 }), gemEvent('b', GEM_USAGE)])
        expect(reports).toEqual([{ input: 20, output: 10, cacheRead: 10, cacheWrite: 0 }])
    })

    test('guard: no usageMetadata reports nothing', async () => {
        const { reports, meter } = spyMeter()
        const stream = __testGeminiStream.getTranStream({ modelInfo: modelInfo as never, saveSignature: false, usage: meter })
        await drive(stream, [gemEvent('a')])
        expect(reports).toHaveLength(0)
    })

    test('a tool round meters both the first response and the follow-up stream into the one meter', async () => {
        const { reports, meter } = spyMeter()
        const call = 'data: ' + JSON.stringify({
            candidates: [{ content: { parts: [{ functionCall: { name: 'lookup', args: {} } }], role: 'model' }, index: 0 }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        }) + '\n\n'
        const answer = gemEvent('done', { promptTokenCount: 20, candidatesTokenCount: 5 })
        const bodies = [call, answer]
        let next = 0
        fetchNativeMock.mockImplementation(async () => new Response(bodies[next++], { status: 200 }))
        vi.mocked(callTool).mockResolvedValue([{ type: 'text', text: 'tool says ok' }])
        Object.assign(h.db, { google: { accessToken: 'plain-key', projectId: 'proj' }, vertexRegion: 'us-central1' })
        const response = await requestGoogleCloudVertex({
            formated: [{ role: 'user', content: 'hello' }],
            modelInfo: { id: 'dynamic_google_gemini-x', name: 'g', internalID: 'gemini-x', provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud, flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.GoogleCloud },
            maxTokens: 100,
            useStreaming: true,
            mode: 'model',
            usageMeter: meter,
            tools: [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: {} } }],
        } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
        expect(response.type).toBe('streaming')
        const reader = (response.result as ReadableStream<Record<string, string>>).getReader()
        while (!(await reader.read()).done) { /* drain */ }
        expect(fetchNativeMock).toHaveBeenCalledTimes(2)
        expect(reports).toEqual([
            { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
            { input: 20, output: 5, cacheRead: 0, cacheWrite: 0 },
        ])
    })
})

// ---- Capture wrapper ----

describe('usage capture stream wrapper', () => {
    test('the wrapper never reads ahead: the inner stream is not pulled until the consumer reads', async () => {
        let pulls = 0
        const inner = new ReadableStream<Record<string, string>>({
            pull(controller) {
                pulls++
                if (pulls > 3) { controller.close(); return }
                controller.enqueue({ '0': `chunk${pulls}` })
            },
        }, { highWaterMark: 0 })
        const meter = createUsageMeter()
        const arg = { usageMeter: meter, aiModel: 'm', formated: [] }
        const settled = settleUsage(arg, 'model', { type: 'streaming', result: inner })
        const reader = (settled.result as ReadableStream<Record<string, string>>).getReader()
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(pulls).toBe(0)
        expect((await reader.read()).value).toEqual({ '0': 'chunk1' })
        await new Promise((resolve) => setTimeout(resolve, 20))
        expect(pulls).toBe(1)
    })
})

// ---- Anthropic ----

function ev(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
const messageStart = (usage: Record<string, number> = { input_tokens: 25, output_tokens: 1, cache_read_input_tokens: 3 }) =>
    ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-3-5-sonnet-20241022', usage } })
const blockStart = () => ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
const textDelta = (text: string) => ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const messageEnd = (usage: Record<string, number> = { output_tokens: 15 }) =>
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage }) + ev('message_stop', { type: 'message_stop' })
const errorEvent = (type: string, message: string) => ev('error', { type: 'error', error: { type, message } })
const OVERLOAD = errorEvent('overloaded_error', 'Overloaded')

function oneRead(body: string, status = 200): Response {
    let sent = false
    return new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
            if (sent) { controller.close(); return }
            sent = true
            controller.enqueue(encoder.encode(body))
        },
    }), { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function respondWith(...responses: (() => Response)[]): void {
    let next = 0
    fetchNativeMock.mockImplementation(async () => {
        const make = responses[next++]
        if (!make) { throw new Error('unexpected extra fetch') }
        return make()
    })
}

async function claudeRun(meter: UsageMeterState, abortSignal?: AbortSignal): Promise<string[]> {
    const response = await requestClaude({
        formated: [{ role: 'user', content: 'hello' }],
        aiModel: 'claude-3-5-sonnet-20241022',
        maxTokens: 100,
        mode: 'model',
        useStreaming: true,
        bias: {},
        abortSignal,
        usageMeter: meter,
        modelInfo: {
            id: 'claude-3-5-sonnet-20241022', name: 'claude', internalID: 'claude-3-5-sonnet-20241022',
            provider: LLMProvider.Anthropic, format: LLMFormat.Anthropic, flags: [LLMFlags.hasStreaming],
            parameters: ['temperature'], tokenizer: LLMTokenizer.Claude,
        },
    } as unknown as Parameters<typeof requestClaude>[0])
    expect(response.type).toBe('streaming')
    const reader = (response.result as ReadableStream<Record<string, string>>).getReader()
    const values: string[] = []
    while (true) {
        const { done, value } = await reader.read()
        if (done) { return values }
        values.push(value['0'])
    }
}

describe('Anthropic stream usage', () => {
    test('message_start plus message_delta usage is reported once, merged', async () => {
        const { reports, meter } = spyMeter()
        respondWith(() => oneRead(messageStart() + blockStart() + textDelta('Hi') + messageEnd()))
        await claudeRun(meter)
        expect(reports).toEqual([{ input: 25, output: 15, cacheRead: 3, cacheWrite: 0 }])
    })

    test('guard: a stream that ends after message_start and text, without a message_delta usage, reports nothing and is not failed', async () => {
        const { reports, markFailed, meter } = spyMeter()
        respondWith(() => oneRead(messageStart() + blockStart() + textDelta('a') + textDelta('b')))
        await claudeRun(meter)
        expect(reports).toHaveLength(0)
        expect(markFailed).not.toHaveBeenCalled()
    })

    test('guard: a user Stop before the message_delta reports nothing and is not failed', async () => {
        const { reports, markFailed, meter } = spyMeter()
        const abort = new AbortController()
        let next = 0
        const chunks = [messageStart(), blockStart(), textDelta('a'), textDelta('b')].map((text) => encoder.encode(text))
        fetchNativeMock.mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
                if (next < chunks.length) { controller.enqueue(chunks[next++]); return }
                abort.abort()
                controller.close()
            },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
        await claudeRun(meter, abort.signal)
        expect(reports).toHaveLength(0)
        expect(markFailed).not.toHaveBeenCalled()
    })

    test('an in-band error event marks the attempt failed and reports nothing without a message_delta', async () => {
        const { reports, markFailed, meter } = spyMeter()
        respondWith(() => oneRead(messageStart() + blockStart() + textDelta('a') + errorEvent('api_error', 'Bad thing')))
        await claudeRun(meter)
        expect(markFailed).toHaveBeenCalledTimes(1)
        expect(reports).toHaveLength(0)
    })

    test('an overload retry answered with a failure status marks the attempt failed', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 1 })
        const { reports, markFailed, meter } = spyMeter()
        respondWith(
            () => oneRead(messageStart() + blockStart() + textDelta('a') + OVERLOAD),
            () => oneRead('', 529),
        )
        await claudeRun(meter)
        expect(markFailed).toHaveBeenCalledTimes(1)
        expect(reports).toHaveLength(0)
    })

    test('an overload retry resets the abandoned response usage: a retried response that stops early reports nothing', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 1 })
        const { reports, meter } = spyMeter()
        respondWith(
            () => oneRead(messageStart({ input_tokens: 99, output_tokens: 1 }) + blockStart() + textDelta('a') + messageEnd({ output_tokens: 40 }).split('event: message_stop')[0] + OVERLOAD),
            () => oneRead(messageStart({ input_tokens: 7, output_tokens: 1 }) + blockStart() + textDelta('b')),
        )
        await claudeRun(meter)
        expect(reports).toHaveLength(0)
    })

    test('an overload retry that completes reports only the retried response and is not failed', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 1 })
        const { reports, markFailed, meter } = spyMeter()
        respondWith(
            () => oneRead(messageStart({ input_tokens: 99, output_tokens: 1 }) + blockStart() + textDelta('a') + OVERLOAD),
            () => oneRead(messageStart({ input_tokens: 7, output_tokens: 1 }) + blockStart() + textDelta('b') + messageEnd({ output_tokens: 9 })),
        )
        await claudeRun(meter)
        expect(reports).toEqual([{ input: 7, output: 9, cacheRead: 0, cacheWrite: 0 }])
        expect(markFailed).not.toHaveBeenCalled()
    })
})
