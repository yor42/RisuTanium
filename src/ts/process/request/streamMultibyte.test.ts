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

import { fetchNative } from '../../globalApi.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'
import { requestClaude } from './anthropic'
import { requestGoogleCloudVertex } from './google'

/**
 * A reply streamed over several network reads must decode to the text the server sent even when a read
 * ends inside a multi-byte character. The fixtures are shaped like the providers' SSE bodies with the
 * text as raw UTF-8, and the real `requestClaude` and `requestGoogleCloudVertex` parse them.
 * Mocked: the transport (`fetchNative`) and the database, store and plugin modules the catalog imports,
 * so a passing test says nothing about native behaviour.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const SENT = 'A가😀 end'
const encoder = new TextEncoder()

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        claudeAPIKey: 'plain-key',
        google: { accessToken: 'plain-key', projectId: 'proj' },
        vertexRegion: 'us-central1',
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
})

function sse(event: string | null, data: unknown): string {
    return (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`
}

function claudeBody(text: string): Uint8Array {
    return encoder.encode([
        sse('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 1, output_tokens: 1 } } }),
        sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
        sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
        sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
        sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }),
        sse('message_stop', { type: 'message_stop' }),
    ].join(''))
}

function geminiBody(text: string): Uint8Array {
    return encoder.encode(sse(null, {
        candidates: [{ content: { parts: [{ text }], role: 'model' }, index: 0 }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 5, totalTokenCount: 6 },
    }))
}

/** Index just after the first `skip` bytes of the first occurrence of `char` inside `bytes`. */
function cutInside(bytes: Uint8Array, char: string, skip: number): number {
    const needle = encoder.encode(char)
    for (let i = 0; i + needle.length <= bytes.length; i++) {
        if (needle.every((b, k) => bytes[i + k] === b)) {
            return i + skip
        }
    }
    throw new Error('character not found in fixture')
}

/** The body split inside '가' (after its first byte) and inside '😀' (after its second byte). */
function splitInsideCharacters(bytes: Uint8Array): Uint8Array[] {
    const first = cutInside(bytes, '가', 1)
    const second = cutInside(bytes, '😀', 2)
    return [bytes.slice(0, first), bytes.slice(first, second), bytes.slice(second)]
}

/** A response whose body yields one enqueued chunk per read, like a network stream. */
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

async function lastText(stream: ReadableStream<unknown>): Promise<string> {
    const reader = stream.getReader()
    let last = ''
    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            return last
        }
        last = (value as Record<string, string>)['0'] ?? last
    }
}

async function claudeText(chunks: Uint8Array[]): Promise<string> {
    fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
    const response = await requestClaude({
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
    } as unknown as Parameters<typeof requestClaude>[0])
    expect(response.type).toBe('streaming')
    return lastText(response.result as ReadableStream<unknown>)
}

async function geminiText(chunks: Uint8Array[]): Promise<string> {
    fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
    const modelInfo: LLMModel = {
        id: 'm', name: 'm', internalID: 'm', provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud,
        flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.GoogleCloud,
    }
    const response = await requestGoogleCloudVertex({
        formated: [{ role: 'user', content: 'hello' }],
        maxTokens: 100,
        mode: 'model',
        useStreaming: true,
        bias: {},
        modelInfo,
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
    expect(response.type).toBe('streaming')
    return lastText(response.result as ReadableStream<unknown>)
}

describe('Anthropic stream with a character split across reads', () => {
    test('the final text equals the text sent', async () => {
        const chunks = splitInsideCharacters(claudeBody(SENT))
        expect(chunks).toHaveLength(3)
        expect(await claudeText(chunks)).toBe(SENT)
    })

    test('guard: the same body in one read gives the same text', async () => {
        expect(await claudeText([claudeBody(SENT)])).toBe(SENT)
    })
})

describe('Gemini stream with a character split across reads', () => {
    test('the final text equals the text sent', async () => {
        const chunks = splitInsideCharacters(geminiBody(SENT))
        expect(chunks).toHaveLength(3)
        const text = await geminiText(chunks)
        expect(text).toContain(SENT)
        expect(text).not.toContain('�')
    })

    test('guard: the same body in one read gives the same text', async () => {
        expect(await geminiText([geminiBody(SENT)])).toContain(SENT)
    })
})
