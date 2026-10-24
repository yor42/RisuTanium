import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
    bodyIntercepterStore: writable(null),
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
import { MCPClient } from '../mcp/mcplib'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'
import { requestClaude } from './anthropic'
import { requestGoogleCloudVertex } from './google'
import { requestOpenAI } from './openAI/requests'
import { requestOpenAIResponseAPI } from './openAI/responses'

/**
 * A native stream that failed mid-flight reaches these wrappers as a body whose reads reject.
 * Mocked: the transport (`fetchNative`), the database and store modules and the plugin modules
 * the catalog imports, so a passing test says nothing about native behaviour.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const FAILURE = 'native stream reset'

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const settle = async () => { for (let i = 0; i < 8; i++) { await tick() } }
const within = <T,>(promise: Promise<T>): Promise<T> => Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('stalled')), 1000)),
])

/** A response whose body fails on its first read, like a stream the native side errored. */
function erroredResponse() {
    const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.error(new Error(FAILURE)) },
    })
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

async function readFailure(stream: ReadableStream<unknown>) {
    const reader = stream.getReader()
    try {
        for (let i = 0; i < 20; i++) {
            const { done } = await within(reader.read())
            if (done) {
                return null
            }
        }
        return 'never settled'
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        claudeAPIKey: 'plain-key',
        openAIKey: 'plain-key',
        proxyKey: 'plain-key',
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
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
})

describe('Anthropic stream wrapper over a failed source', () => {
    function claudeArg(abortSignal: AbortSignal) {
        return {
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'claude-3-5-sonnet-20241022',
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            abortSignal,
            bias: {},
            modelInfo: {
                id: 'claude-3-5-sonnet-20241022', name: 'claude', internalID: 'claude-3-5-sonnet-20241022',
                provider: LLMProvider.Anthropic, format: LLMFormat.Anthropic, flags: [LLMFlags.hasStreaming],
                parameters: ['temperature'], tokenizer: LLMTokenizer.Claude,
            },
        } as unknown as Parameters<typeof requestClaude>[0]
    }

    test('a source whose reads reject errors the wrapper after a bounded number of reads', async () => {
        const controller = new AbortController()
        const read = vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => { throw new Error(FAILURE) })
        fetchNativeMock.mockResolvedValue({
            status: 200,
            headers: new Headers({ 'Content-Type': 'text/event-stream' }),
            body: { getReader: () => ({ read, cancel: vi.fn(async () => {}) }) },
        } as unknown as Response)
        try {
            const response = await requestClaude(claudeArg(controller.signal))
            expect(response.type).toBe('streaming')

            expect(await readFailure(response.result as ReadableStream<unknown>)).toBe(FAILURE)
            expect(read.mock.calls.length).toBeLessThanOrEqual(2)
        } finally {
            // Ends the retry loop of an unfixed wrapper so it cannot outlive the test.
            controller.abort()
        }
    })

    test('guard: an aborted signal still ends the wrapper quietly', async () => {
        const controller = new AbortController()
        const read = vi.fn(async (): Promise<ReadableStreamReadResult<Uint8Array>> => { throw new Error(FAILURE) })
        fetchNativeMock.mockResolvedValue({
            status: 200,
            headers: new Headers({ 'Content-Type': 'text/event-stream' }),
            body: { getReader: () => ({ read, cancel: vi.fn(async () => {}) }) },
        } as unknown as Response)
        controller.abort()

        const response = await requestClaude(claudeArg(controller.signal))
        expect(response.type).toBe('streaming')

        expect(await readFailure(response.result as ReadableStream<unknown>)).toBeNull()
    })
})

describe('pipeTo of a failed source raises no unhandled rejection', () => {
    function modelInfo(overrides: Partial<LLMModel>): LLMModel {
        return {
            id: 'm', name: 'm', internalID: 'm', provider: LLMProvider.OpenAI, format: LLMFormat.OpenAICompatible,
            flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.Unknown, ...overrides,
        }
    }

    const cases: [string, () => Promise<{ type: string, result: unknown }>][] = [
        ['openAI/requests.ts', () => requestOpenAI({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'reverse_proxy',
            customURL: 'https://api.example.invalid/v1/chat/completions',
            key: 'plain-key',
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            bias: {},
            biasString: [],
            modelInfo: modelInfo({}),
        } as unknown as Parameters<typeof requestOpenAI>[0])],
        ['openAI/responses.ts', () => requestOpenAIResponseAPI({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'reverse_proxy',
            customURL: 'https://api.example.invalid/v1/responses',
            key: 'plain-key',
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            bias: {},
            modelInfo: modelInfo({ format: LLMFormat.OpenAIResponseAPI }),
        } as unknown as Parameters<typeof requestOpenAIResponseAPI>[0])],
        ['google.ts', () => requestGoogleCloudVertex({
            formated: [{ role: 'user', content: 'hello' }],
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            bias: {},
            modelInfo: modelInfo({ provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud, tokenizer: LLMTokenizer.GoogleCloud }),
        } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])],
    ]

    test.each(cases)('%s: the downstream stream rejects and nothing is left unhandled', async (_name, run) => {
        fetchNativeMock.mockImplementation(async () => erroredResponse())

        const response = await run()
        expect(response.type).toBe('streaming')

        expect(await readFailure(response.result as ReadableStream<unknown>)).toBe(FAILURE)
        await settle()
        expect(unhandled).toEqual([])
    })
})

describe('MCP SSE connection over a failed source', () => {
    test('a read error ends connectSSE quietly like a clean close', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const client = new MCPClient('https://mcp.example.invalid/sse')
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { controller.error(new Error(FAILURE)) },
        })

        await within(client.connectSSE(stream))
        await settle()

        expect(unhandled).toEqual([])
    })
})
