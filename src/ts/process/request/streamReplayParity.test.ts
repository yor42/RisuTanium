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
// The JSON extraction is the same module for the live read and the replay; a recognisable stand-in shows where it ran.
vi.mock('../templates/jsonSchema', () => ({
    extractJSON: (data: string, path: string) => `X[${path}]${data}`,
    getOpenAIJSONSchema: () => ({ name: 'format', strict: true, schema: { type: 'object' } }),
    getGeneralJSONSchema: () => ({ type: 'object' }),
}))
vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async () => {},
}))

import { fetchNative } from '../../globalApi.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer } from '../../model/types'
import { createUsageMeter } from '../../usage/usageMeter'
import { replayAnthropicStream, replayGeminiStream, replayResponsesStream } from '../../nativeReply/streamReplay'
import { saveInlayedSignature } from '../files/inlays'
import { requestGoogleCloudVertex } from './google'
import { requestClaude } from './anthropic'
import { __testResponsesAPI, requestOpenAIResponseAPI } from './openAI/requests'
import type { RequestDataArgumentExtended } from './request'

/**
 * I6 (parity): for every byte partition of a body, the last emission of the live Responses or Anthropic stream equals the
 * replay's text and the hand-written text (Gemini: under the per-line partition). The live half is the real `requestOpenAIResponseAPI` / `requestClaude` with a
 * mocked transport; the bodies are synthetic and use each provider's wire format. Mocked: the transport, `sleep`, the
 * database, store and plugin modules and the JSON extraction, so a pass says nothing about native behaviour.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const encoder = new TextEncoder()

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        claudeAPIKey: 'plain-key',
        openAIKey: 'plain-key',
        gptVisionQuality: 'low',
        additionalParams: [],
        customModels: [],
        modelTools: [],
        OaiCompAPIKeys: {},
        requestRetrys: 0,
        temperature: 70,
        top_p: 0.9,
        jsonSchemaEnabled: false,
    })
    fetchNativeMock.mockReset()
    vi.mocked(saveInlayedSignature).mockReset()
    vi.mocked(saveInlayedSignature).mockResolvedValue('')
})

// ---- partitions ----

function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function cutsAtEveryByte(bytes: Uint8Array): number[] {
    return Array.from({ length: Math.max(0, bytes.length - 1) }, (_, i) => i + 1)
}

function randomCuts(bytes: Uint8Array, seed: number): number[] {
    const random = seededRandom(seed)
    const cuts: number[] = []
    let at = 0
    for (;;) {
        at += 1 + Math.floor(random() * 48)
        if (at >= bytes.length) {
            return cuts
        }
        cuts.push(at)
    }
}

/** Every offset strictly inside an occurrence of `needle`: a read boundary that splits it. */
function cutsInside(bytes: Uint8Array, needle: Uint8Array): number[] {
    const cuts: number[] = []
    for (let i = 0; i + needle.length <= bytes.length; i++) {
        if (needle.every((value, j) => bytes[i + j] === value)) {
            for (let j = 1; j < needle.length; j++) {
                cuts.push(i + j)
            }
        }
    }
    return cuts
}

function chunksAt(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
    const chunks: Uint8Array[] = []
    let from = 0
    for (const cut of [...new Set(cuts)].sort((a, b) => a - b)) {
        chunks.push(bytes.slice(from, cut))
        from = cut
    }
    chunks.push(bytes.slice(from))
    return chunks
}

function partitionsOf(body: string): [string, Uint8Array[]][] {
    const bytes = encoder.encode(body)
    const out: [string, Uint8Array[]][] = [
        ['one chunk', [bytes]],
        ['every byte', chunksAt(bytes, cutsAtEveryByte(bytes))],
        ['inside data:', chunksAt(bytes, cutsInside(bytes, encoder.encode('data:')))],
        ['inside CRLF CRLF', chunksAt(bytes, cutsInside(bytes, encoder.encode('\r\n\r\n')))],
        ['inside a 3-byte character', chunksAt(bytes, cutsInside(bytes, encoder.encode('가')))],
        ['inside a 4-byte character', chunksAt(bytes, cutsInside(bytes, encoder.encode('😀')))],
    ]
    for (let seed = 1; seed <= 200; seed++) {
        out.push([`random seed ${seed}`, chunksAt(bytes, randomCuts(bytes, seed))])
    }
    return out
}

function chunkedResponse(chunks: Uint8Array[]): Response {
    let next = 0
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (next < chunks.length) {
                controller.enqueue(chunks[next++])
            } else {
                controller.close()
            }
        },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function lastEmission(stream: ReadableStream<unknown>): Promise<string> {
    const reader = stream.getReader()
    let last = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) {
            return last
        }
        last = (value as Record<string, string>)['0']
    }
}

// ---- Responses ----

const rev = (type: string, extra: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
const textDelta = (delta: string) => rev('response.output_text.delta', { delta })
const completedWith = (response: Record<string, unknown>) => rev('response.completed', { response })
const DONE = 'data: [DONE]\n\n'

interface ResponsesRow {
    name: string
    body: string
    text: string
    extractJson?: string
    jsonSchema?: boolean
}

const RESPONSES_ROWS: ResponsesRow[] = [
    { name: 'plain deltas', body: textDelta('Hel') + textDelta('lo ') + textDelta('world') + DONE, text: 'Hello world' },
    { name: 'refusal', body: rev('response.refusal.delta', { delta: 'I cannot' }), text: 'I cannot' },
    { name: 'reasoning deltas then text', body: rev('response.reasoning_summary_text.delta', { delta: 'think' }) + textDelta('ans') + DONE, text: '<Thoughts>\n\nthink\n\n</Thoughts>\nans' },
    { name: 'reasoning .done replaces', body: rev('response.reasoning_text.delta', { delta: 'th' }) + rev('response.reasoning_text.done', { text: 'thought' }) + textDelta('A') + DONE, text: '<Thoughts>\n\nthought\n\n</Thoughts>\nA' },
    { name: 'output_text.done replaces', body: textDelta('Hel') + rev('response.output_text.done', { text: 'Hello' }) + DONE, text: 'Hello' },
    { name: 'completed with reasoning', body: textDelta('Hello') + completedWith({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'R' }], summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }] }) + DONE, text: '<Thoughts>\n\nR\n\n</Thoughts>\nHello' },
    { name: 'extractJson with the schema on', body: textDelta('{"a":1}') + DONE, text: 'X[$.a]{"a":1}', extractJson: '$.a', jsonSchema: true },
    { name: 'extractJson with the schema off', body: textDelta('{"a":1}') + DONE, text: '{"a":1}', extractJson: '$.a', jsonSchema: false },
    { name: 'usage in completed', body: textDelta('Hi') + completedWith({ output_text: 'Hi', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hi' }] }], usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } }) + DONE, text: 'Hi' },
    { name: 'response.failed after text', body: textDelta('part') + rev('response.failed', { error: { code: 'server_error', message: 'boom' } }), text: JSON.stringify({ code: 'server_error', message: 'boom' }) },
    { name: 'a body ending mid-event', body: textDelta('kept') + 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo', text: 'kept' },
    { name: 'CRLF, Korean and emoji', body: (textDelta('가') + textDelta('😀 end') + DONE).replace(/\n/g, '\r\n'), text: '가😀 end' },
]

function responsesArg(row: ResponsesRow): RequestDataArgumentExtended {
    return {
        aiModel: 'gpt-5-response-api',
        formated: [{ role: 'user', content: 'hello' }],
        maxTokens: 100,
        mode: 'model',
        useStreaming: true,
        bias: {},
        biasString: [],
        extractJson: row.extractJson,
        modelInfo: {
            id: 'gpt-5-response-api', name: 'responses', internalID: 'gpt-5', provider: LLMProvider.OpenAI,
            format: LLMFormat.OpenAIResponseAPI, flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.Unknown,
        },
    } as unknown as RequestDataArgumentExtended
}

describe('Responses: the live last emission equals the replay for every partition', () => {
    for (const row of RESPONSES_ROWS) {
        test(row.name, async () => {
            h.db.jsonSchemaEnabled = row.jsonSchema === true
            for (const [partition, chunks] of partitionsOf(row.body)) {
                fetchNativeMock.mockReset()
                fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
                const response = await requestOpenAIResponseAPI(responsesArg(row))
                expect(response.type).toBe('streaming')
                const live = await lastEmission(response.result as ReadableStream<unknown>)
                expect(live, `live, ${partition}`).toBe(row.text)
                const replayed = await replayResponsesStream({
                    bytes: encoder.encode(row.body),
                    complete: true,
                    rule: { extractJson: row.extractJson ?? null, jsonSchema: row.jsonSchema === true },
                }, createUsageMeter())
                expect(replayed.modelText, `replay, ${partition}`).toBe(row.text)
            }
        })
    }

    test('function-call deltas leave the text unchanged', async () => {
        const body = textDelta('T') + rev('response.function_call_arguments.delta', { call_id: 'c1', delta: '{"q":' }) + DONE
        const stream = __testResponsesAPI.getResponsesTranStream({ modelInfo: { flags: [] } } as unknown as RequestDataArgumentExtended)
        const live = lastEmission(stream.readable)
        const writer = stream.writable.getWriter()
        await writer.write(encoder.encode(body))
        await writer.close()
        expect(await live).toBe('T')
        const replayed = await replayResponsesStream({ bytes: encoder.encode(body), complete: true, rule: { extractJson: null, jsonSchema: false } }, createUsageMeter())
        expect(replayed.modelText).toBe('T')
    })
})

// ---- Anthropic ----

const aev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const messageStart = () => aev('message_start', { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 1 } } })
const aText = (text: string, index = 0) => aev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
const aThinking = (thinking: string, index = 0) => aev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } })
const aRedacted = () => aev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'redacted_thinking' } })
const aEnd = () => aev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }) + aev('message_stop', { type: 'message_stop' })
const aError = (type: string, message: string) => aev('error', { type: 'error', error: { type, message } })

const ANTHROPIC_ROWS: { name: string, body: string, text: string }[] = [
    { name: 'text', body: messageStart() + aText('Hel') + aText('lo ') + aText('world') + aEnd(), text: 'Hello world' },
    { name: 'thinking then text', body: messageStart() + aThinking('t1') + aThinking('t2') + aText('x1', 1) + aEnd(), text: '<Thoughts>\nt1t2</Thoughts>\n\nx1' },
    { name: 'thinking open at the end', body: messageStart() + aThinking('t1'), text: '<Thoughts>\nt1</Thoughts>\n\n' },
    { name: 'redacted thinking', body: messageStart() + aRedacted() + aText('x', 1) + aEnd(), text: '<Thoughts>\n\n{{redacted_thinking}}\n</Thoughts>\n\nx' },
    { name: 'text then error', body: messageStart() + aText('abc') + aError('api_error', 'Bad thing') + aEnd(), text: 'abcError:Bad thing' },
    { name: 'usage start only', body: messageStart() + aText('a'), text: 'a' },
    { name: 'an unterminated last line', body: messageStart() + aText('kept') + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"cut', text: 'kept' },
    { name: 'a partial cut mid-event', body: messageStart() + aText('kept') + 'event: content_block_delta\ndata: {"type":"content_block_de', text: 'kept' },
    { name: 'CRLF, Korean and emoji', body: (messageStart() + aText('가') + aText('😀 end') + aEnd()).replace(/\n/g, '\r\n'), text: '가😀 end' },
]

function claudeStreamOf(): Promise<ReadableStream<unknown>> {
    return requestClaude({
        formated: [{ role: 'user', content: 'hello' }],
        aiModel: 'claude-3-5-sonnet-20241022',
        maxTokens: 100,
        mode: 'model',
        useStreaming: true,
        bias: {},
        modelInfo: {
            id: 'claude-3-5-sonnet-20241022', name: 'claude', internalID: 'claude-3-5-sonnet-20241022',
            provider: LLMProvider.Anthropic, format: LLMFormat.Anthropic, flags: [LLMFlags.hasStreaming],
            parameters: ['temperature'], tokenizer: LLMTokenizer.Claude,
        },
    } as unknown as Parameters<typeof requestClaude>[0]).then((response) => {
        expect(response.type).toBe('streaming')
        return response.result as ReadableStream<unknown>
    })
}

describe('Anthropic: the live last emission equals the replay for every partition', () => {
    for (const row of ANTHROPIC_ROWS) {
        test(row.name, async () => {
            for (const [partition, chunks] of partitionsOf(row.body)) {
                fetchNativeMock.mockReset()
                fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
                const live = await lastEmission(await claudeStreamOf())
                expect(live, `live, ${partition}`).toBe(row.text)
                const replayed = await replayAnthropicStream({ bytes: encoder.encode(row.body), complete: true }, createUsageMeter())
                expect(replayed.modelText, `replay, ${partition}`).toBe(row.text)
            }
        })
    }
})


// ---- Gemini ----

const gline = (parts: unknown[], extra: Record<string, unknown> = {}) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts } }], ...extra }) + '\n\n'
const gtext = (text: string) => gline([{ text }])
const GEM_USAGE = { promptTokenCount: 30, candidatesTokenCount: 7, totalTokenCount: 37 }

interface GeminiRow {
    name: string
    body: string
    /** The per-line live text, ids normalised. */
    text: string
    streamThoughts?: boolean
    extractJson?: string
    jsonSchema?: boolean
    saveSignatures?: boolean
}

const GEMINI_ROWS: GeminiRow[] = [
    { name: 'text', body: gtext('Hel') + gtext('lo ') + gtext('world'), text: 'Hello world' },
    { name: 'thought parts then text, thoughts folded', body: gline([{ text: 'think', thought: true }, { text: 'ans' }]), text: '<Thoughts>\n\nthink\n\n</Thoughts>\n\nans' },
    { name: 'a trailing thought with streamThoughts off', body: gtext('a') + gline([{ text: 'tt', thought: true }]), text: '<Thoughts>\n\ntt\n\n</Thoughts>\n\na' },
    { name: 'a trailing thought with streamThoughts on', body: gtext('a') + gline([{ text: 'tt', thought: true }]), text: 'tt\n\na', streamThoughts: true },
    { name: 'extractJson with the schema on', body: gtext('{"a":1}'), text: 'X[$.a]{"a":1}', extractJson: '$.a', jsonSchema: true },
    { name: 'extractJson with the schema off', body: gtext('{"a":1}'), text: '{"a":1}', extractJson: '$.a', jsonSchema: false },
    { name: 'a thought signature with saveSignatures on', body: gline([{ text: 'hi', thoughtSignature: 'S1' }]) + gtext(' there'), text: 'hi{{inlayeddata::#1}} there', saveSignatures: true },
    { name: 'a thought signature with saveSignatures off', body: gline([{ text: 'hi', thoughtSignature: 'S1' }]) + gtext(' there'), text: 'hi there', saveSignatures: false },
    { name: 'text then [DONE] then trailing lines', body: gtext('a') + gtext('b') + 'data: [DONE]\n\n' + gtext('c'), text: 'ab' },
    { name: 'text then a malformed complete line', body: gtext('a') + gtext('b') + 'data: {not json}\n' + gtext('c'), text: 'ab' },
    { name: 'usageMetadata', body: gline([{ text: 'x' }], { usageMetadata: GEM_USAGE }) + gtext('y'), text: 'xy' },
    { name: 'CRLF, Korean and emoji', body: (gtext('가') + gtext('😀 end')).replace(/\n/g, '\r\n'), text: '가😀 end' },
]

/** The tokens of one text numbered by first appearance, so two runs with different generated ids compare. */
function normalisedIds(text: string): string {
    const seen: string[] = []
    return text.replace(/\{\{inlayeddata::([^}]+)\}\}/g, (_, id: string) => {
        if (!seen.includes(id)) {
            seen.push(id)
        }
        return `{{inlayeddata::#${seen.indexOf(id) + 1}}}`
    })
}

/** One chunk per complete line, then the unterminated rest. */
function perLineChunks(body: string): Uint8Array[] {
    const bytes = encoder.encode(body)
    const cuts: number[] = []
    bytes.forEach((value, i) => {
        if (value === 0x0A && i + 1 < bytes.length) {
            cuts.push(i + 1)
        }
    })
    return chunksAt(bytes, cuts)
}

function geminiStreamOf(row: GeminiRow): Promise<ReadableStream<unknown>> {
    return requestGoogleCloudVertex({
        formated: [{ role: 'user', content: 'hello' }],
        modelInfo: { id: 'dynamic_google_gemini-x', name: 'g', internalID: 'gemini-x', provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud, flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.GoogleCloud },
        maxTokens: 100,
        useStreaming: true,
        mode: 'model',
        extractJson: row.extractJson,
        saveSignatures: row.saveSignatures,
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0]).then((response) => {
        expect(response.type).toBe('streaming')
        return response.result as ReadableStream<unknown>
    })
}

describe('Gemini: the replay equals the live last emission under the per-line partition', () => {
    for (const row of GEMINI_ROWS) {
        test(row.name, async () => {
            Object.assign(h.db, {
                google: { accessToken: 'plain-key', projectId: 'proj' },
                vertexRegion: 'us-central1',
                jsonSchemaEnabled: row.jsonSchema === true,
                streamGeminiThoughts: row.streamThoughts === true,
            })
            const rule = {
                extractJson: row.extractJson ?? null,
                jsonSchema: row.jsonSchema === true,
                streamThoughts: row.streamThoughts === true,
                saveSignatures: row.saveSignatures === true,
                signatureSource: 'gemini-x',
                signatureFormat: LLMFormat.GoogleCloud,
            }
            const replayed = await replayGeminiStream({ bytes: encoder.encode(row.body), complete: true, rule }, createUsageMeter())
            const replayText = normalisedIds(replayed.modelText)
            expect(replayText, 'replay').toBe(row.text)

            fetchNativeMock.mockReset()
            fetchNativeMock.mockImplementation(async () => chunkedResponse(perLineChunks(row.body)))
            const perLine = normalisedIds(await lastEmission(await geminiStreamOf(row)))
            expect(perLine, 'live, per-line').toBe(row.text)

            // Another partition never shows more than the per-line replay, and the replay keeps what the page last showed.
            const thoughtFree = !row.body.includes('"thought":true')
            for (const [partition, chunks] of partitionsOf(row.body)) {
                fetchNativeMock.mockReset()
                fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
                const live = normalisedIds(await lastEmission(await geminiStreamOf(row)))
                expect(replayText.length, `length, ${partition}`).toBeGreaterThanOrEqual(live.length)
                if (thoughtFree) {
                    expect(replayText.startsWith(live), `prefix, ${partition}`).toBe(true)
                }
            }
        })
    }
})