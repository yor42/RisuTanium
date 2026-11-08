import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { Buffer as NodeBuffer } from 'node:buffer'

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
    saveInlayedSignature: vi.fn(async () => {}),
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
import { requestOpenAI } from './openAI/requests'
import { requestGoogleCloudVertex } from './google'
import { saveInlayedSignature } from '../files/inlays'

/**
 * A streamed reply of N events must cost work proportional to its size, not to N squared: each complete
 * event is parsed once and each byte is decoded once, however many reads deliver it. The counts are taken
 * through the public `requestOpenAI` entry point, with the real transform.
 * Mocked: the transport (`fetchNative`) and the database, store and plugin modules the catalog imports,
 * so a passing test says nothing about native behaviour.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const encoder = new TextEncoder()
const EVENTS = 40

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        openAIKey: 'plain-key',
        proxyKey: 'plain-key',
        gptVisionQuality: 'low',
        additionalParams: [],
        customModels: [],
        modelTools: [],
        OaiCompAPIKeys: {},
        requestRetrys: 0,
        temperature: 70,
        top_p: 0.9,
        google: { accessToken: 'plain-key', projectId: 'proj' },
        vertexRegion: 'us-central1',
    })
    fetchNativeMock.mockReset()
    vi.mocked(saveInlayedSignature).mockReset()
    vi.mocked(saveInlayedSignature).mockImplementation(async () => '')
    // The request builder logs the prompt; the test runner decodes that output with the Buffer under measurement.
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** One event shaped like an OpenAI-compatible provider's `chat.completion.chunk` line plus its blank line. */
function contentEvent(index: number): string {
    return 'data: ' + JSON.stringify(eventPayload(index)) + '\n\n'
}

function eventPayload(index: number) {
    return {
        id: 'chatcmpl-abc123', object: 'chat.completion.chunk', created: 1731000000, model: 'gpt-4o-mini',
        choices: [{ index: 0, delta: { content: `word${index} ` }, finish_reason: null }],
    }
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

async function readToEnd(stream: ReadableStream<unknown>): Promise<Record<string, string>[]> {
    const reader = stream.getReader()
    const values: Record<string, string>[] = []
    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            return values
        }
        values.push(value as Record<string, string>)
    }
}

async function runOpenAI(chunks: Uint8Array[]): Promise<Record<string, string>[]> {
    fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
    const modelInfo: LLMModel = {
        id: 'm', name: 'm', internalID: 'm', provider: LLMProvider.OpenAI, format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.Unknown,
    }
    const response = await requestOpenAI({
        formated: [{ role: 'user', content: 'hello' }],
        aiModel: 'reverse_proxy',
        customURL: 'https://api.example.invalid/v1/chat/completions',
        key: 'plain-key',
        maxTokens: 100,
        mode: 'model',
        useStreaming: true,
        bias: {},
        biasString: [],
        modelInfo,
    } as unknown as Parameters<typeof requestOpenAI>[0])
    expect(response.type).toBe('streaming')
    return readToEnd(response.result as ReadableStream<unknown>)
}

function oneEventPerChunk(): { chunks: Uint8Array[], payloads: string[] } {
    const chunks: Uint8Array[] = []
    const payloads: string[] = []
    for (let i = 0; i < EVENTS; i++) {
        payloads.push(JSON.stringify(eventPayload(i)))
        chunks.push(encoder.encode(contentEvent(i)))
    }
    chunks.push(encoder.encode('data: [DONE]\n\n'))
    return { chunks, payloads }
}

describe('OpenAI-format stream cost over a long reply', () => {
    test('each event payload is parsed once', async () => {
        const { chunks, payloads } = oneEventPerChunk()
        const parse = vi.spyOn(JSON, 'parse')
        try {
            const values = await runOpenAI(chunks)
            expect(values.length).toBeGreaterThan(0)
            expect(values[values.length - 1]['0']).toBe(Array.from({ length: EVENTS }, (_v, i) => `word${i} `).join(''))
            const counts = payloads.map((payload) => parse.mock.calls.filter((call) => call[0] === payload).length)
            expect(counts).toEqual(payloads.map(() => 1))
        } finally {
            parse.mockRestore()
        }
    })

    test('each byte is decoded once, not once per read', async () => {
        const { chunks } = oneEventPerChunk()
        const bodyBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        // Resolved after the imports: the transform uses whatever `Buffer` the global holds.
        const B = globalThis.Buffer
        const original = B.prototype.toString
        let decoded = 0
        B.prototype.toString = function (this: Buffer, ...args: Parameters<Buffer['toString']>) {
            decoded += this.length
            return original.apply(this, args)
        }
        try {
            await runOpenAI(chunks)
        } finally {
            B.prototype.toString = original
        }
        // Every chunk ends in a blank line, so no tail is decoded and each read leaves out only its final LF.
        // The message names which Buffer was hit (Node's or the browser polyfill).
        expect(decoded, B === NodeBuffer ? 'node Buffer' : 'polyfill Buffer').toBe(bodyBytes - chunks.length)
    })
})

/** One Gemini `streamGenerateContent` event without its terminating blank line. */
function geminiEventLine(parts: Record<string, unknown>[]): string {
    return 'data: ' + JSON.stringify(geminiPayload(parts))
}

function geminiPayload(parts: Record<string, unknown>[]) {
    return {
        candidates: [{ content: { parts, role: 'model' }, index: 0 }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
        modelVersion: 'gemini-2.5-flash',
    }
}

async function runGemini(chunks: Uint8Array[], saveSignatures: boolean): Promise<Record<string, string>[]> {
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
        saveSignatures,
        modelInfo,
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
    expect(response.type).toBe('streaming')
    return readToEnd(response.result as ReadableStream<unknown>)
}

const savedIds = () => vi.mocked(saveInlayedSignature).mock.calls.map((call) => call[0])
const referencedIds = (values: Record<string, string>[]) =>
    values.flatMap((value) => Array.from((value['0'] ?? '').matchAll(/\{\{inlayeddata::([^}]+)\}\}/g), (match) => match[1]))

describe('Gemini stream cost over a long reply', () => {
    test('each event payload is parsed once', async () => {
        const payloads: string[] = []
        const chunks: Uint8Array[] = []
        for (let i = 0; i < EVENTS; i++) {
            const parts = [{ text: `word${i} ` }]
            payloads.push(JSON.stringify(geminiPayload(parts)))
            chunks.push(encoder.encode(geminiEventLine(parts) + '\n\n'))
        }
        const parse = vi.spyOn(JSON, 'parse')
        try {
            const values = await runGemini(chunks, false)
            expect(values.length).toBeGreaterThan(0)
            expect(values[values.length - 1]['0']).toContain(Array.from({ length: EVENTS }, (_v, i) => `word${i} `).join(''))
            const counts = payloads.map((payload) => parse.mock.calls.filter((call) => call[0] === payload).length)
            expect(counts).toEqual(payloads.map(() => 1))
        } finally {
            parse.mockRestore()
        }
    })
})

describe('Gemini signature records over a long reply', () => {
    const SIGNED = 20
    const signedPart = (i: number) => [{ text: `part${i} `, thoughtSignature: `signature-${i}` }]

    test('each signed part is saved once when every read ends at an event boundary', async () => {
        const chunks = Array.from({ length: SIGNED }, (_v, i) => encoder.encode(geminiEventLine(signedPart(i)) + '\n\n'))
        const values = await runGemini(chunks, true)
        expect(values.length).toBeGreaterThan(0)
        expect(savedIds()).toHaveLength(SIGNED)
        const saved = new Set(savedIds())
        expect(referencedIds(values).every((id) => saved.has(id))).toBe(true)
    })

    test('a part read as an unfinished last line is saved once as that tail and once when committed', async () => {
        // Read 1 is an event with no line break; read k breaks the previous event's line and starts the next.
        const chunks = [encoder.encode(geminiEventLine(signedPart(0)))]
        for (let i = 1; i < SIGNED; i++) {
            chunks.push(encoder.encode('\n\n' + geminiEventLine(signedPart(i))))
        }
        chunks.push(encoder.encode('\n\n'))
        const values = await runGemini(chunks, true)
        expect(values.length).toBeGreaterThan(0)
        expect(savedIds()).toHaveLength(2 * SIGNED)
        const saved = new Set(savedIds())
        expect(referencedIds(values).length).toBeGreaterThan(0)
        expect(referencedIds(values).every((id) => saved.has(id))).toBe(true)
    })
})
