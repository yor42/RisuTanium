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

import { fetchNative, globalFetch } from '../../globalApi.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'
import { requestClaude } from './anthropic'
import { requestGoogleCloudVertex } from './google'
import { requestOpenAI } from './openAI/requests'
import { requestOpenAIResponseAPI } from './openAI/responses'

/**
 * The provider wrappers hand the caller's own abort signal to the transport unchanged. The native request
 * layer marks a request for the chat's Stop exactly when its signal is the published send unit's, so a wrapper
 * that derived a new signal would silently stop being cancellable by the notification Stop (MC-1435).
 *
 * Mocked: the transports (`fetchNative`, `globalFetch`), the database and store modules and the plugin modules the
 * catalog imports, so a passing test says nothing about native behaviour. The non-stream OpenAI chat send goes
 * through `globalFetch`, so it is checked at that call; its leg from `globalFetch` to `fetchNative` runs for real
 * in `globalApi.streamedFetch.svelte.test.ts`.
 *
 * Every test here is a compatibility guard that passes on the unchanged source. Its sensitivity is shown by
 * the scratch mutant that passes a derived signal at the streaming OpenAI site, which fails the first test.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const globalFetchMock = vi.mocked(globalFetch)

function modelInfo(overrides: Partial<LLMModel>): LLMModel {
    return {
        id: 'm', name: 'm', internalID: 'm', provider: LLMProvider.OpenAI, format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.Unknown, ...overrides,
    }
}

/** A failed head, so each wrapper returns right after the transport call without reading a body. */
const refused = () => new Response('refused', { status: 500, headers: { 'Content-Type': 'text/plain' } })

function expectOwnSignal(signal: AbortSignal) {
    expect(fetchNativeMock.mock.calls.length).toBeGreaterThanOrEqual(1)
    for (const call of fetchNativeMock.mock.calls) {
        expect((call[1] as { signal?: AbortSignal }).signal).toBe(signal)
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
    globalFetchMock.mockReset()
    fetchNativeMock.mockImplementation(async () => refused())
    globalFetchMock.mockResolvedValue({ ok: false, data: 'refused', headers: {}, status: 500 })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('provider wrappers keep the caller signal (MC-1435, MC-1476)', () => {
    test('P-1 requestOpenAI streaming passes the signal to fetchNative unchanged', async () => {
        const controller = new AbortController()
        await requestOpenAI({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'reverse_proxy',
            customURL: 'https://api.example.invalid/v1/chat/completions',
            key: 'plain-key',
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            abortSignal: controller.signal,
            bias: {},
            biasString: [],
            modelInfo: modelInfo({}),
        } as unknown as Parameters<typeof requestOpenAI>[0])

        expectOwnSignal(controller.signal)
    })

    test('P-2 requestOpenAI non-streaming passes the signal to globalFetch unchanged, marked deliverWhileFrozen', async () => {
        const controller = new AbortController()
        await requestOpenAI({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'reverse_proxy',
            customURL: 'https://api.example.invalid/v1/chat/completions',
            key: 'plain-key',
            maxTokens: 100,
            mode: 'model',
            useStreaming: false,
            abortSignal: controller.signal,
            bias: {},
            biasString: [],
            modelInfo: modelInfo({}),
        } as unknown as Parameters<typeof requestOpenAI>[0])

        expect(globalFetchMock.mock.calls.length).toBeGreaterThanOrEqual(1)
        for (const call of globalFetchMock.mock.calls) {
            const arg = call[1] as { abortSignal?: AbortSignal, deliverWhileFrozen?: boolean }
            expect(arg.abortSignal).toBe(controller.signal)
            expect(arg.deliverWhileFrozen).toBe(true)
        }
    })

    test('P-3 requestOpenAIResponseAPI streaming passes the signal to fetchNative unchanged', async () => {
        const controller = new AbortController()
        await requestOpenAIResponseAPI({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'reverse_proxy',
            customURL: 'https://api.example.invalid/v1/responses',
            key: 'plain-key',
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            abortSignal: controller.signal,
            bias: {},
            modelInfo: modelInfo({ format: LLMFormat.OpenAIResponseAPI }),
        } as unknown as Parameters<typeof requestOpenAIResponseAPI>[0])

        expectOwnSignal(controller.signal)
    })

    test('P-4 requestClaude streaming passes the signal to fetchNative unchanged', async () => {
        const controller = new AbortController()
        await requestClaude({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'claude-3-5-sonnet-20241022',
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            abortSignal: controller.signal,
            bias: {},
            modelInfo: {
                id: 'claude-3-5-sonnet-20241022', name: 'claude', internalID: 'claude-3-5-sonnet-20241022',
                provider: LLMProvider.Anthropic, format: LLMFormat.Anthropic, flags: [LLMFlags.hasStreaming],
                parameters: ['temperature'], tokenizer: LLMTokenizer.Claude,
            },
        } as unknown as Parameters<typeof requestClaude>[0])

        expectOwnSignal(controller.signal)
    })

    test('P-5 requestGoogleCloudVertex streaming passes the signal to fetchNative unchanged', async () => {
        const controller = new AbortController()
        await requestGoogleCloudVertex({
            formated: [{ role: 'user', content: 'hello' }],
            maxTokens: 100,
            mode: 'model',
            useStreaming: true,
            abortSignal: controller.signal,
            bias: {},
            modelInfo: modelInfo({ provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud, tokenizer: LLMTokenizer.GoogleCloud }),
        } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])

        expectOwnSignal(controller.signal)
    })
})
