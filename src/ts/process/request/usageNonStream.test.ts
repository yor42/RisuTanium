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

import { fetchNative, globalFetch } from '../../globalApi.svelte'
import { callTool } from '../mcp/mcp'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'
import { createUsageMeter } from '../../usage/usageMeter'
import { requestClaude } from './anthropic'
import { requestGoogleCloudVertex } from './google'
import { requestOpenAI } from './openAI/requests'
import { requestOpenAIResponseAPI } from './openAI/responses'
import type { RequestDataArgumentExtended } from './request'

/**
 * Non-stream usage reporting of each provider's real request function with a real meter: one report per HTTP
 * response that carries usage, so the tool rounds of one attempt add up. Mocked: the transports (`globalFetch`,
 * `fetchNative`) and the database, store and plugin modules the catalog imports, so a passing test says nothing
 * about native behaviour. Response bodies are shaped like each provider's non-stream JSON.
 */

const globalFetchMock = vi.mocked(globalFetch)
const fetchNativeMock = vi.mocked(fetchNative)
const callToolMock = vi.mocked(callTool)

function modelInfo(overrides: Partial<LLMModel>): LLMModel {
    return {
        id: 'm', name: 'm', internalID: 'm', provider: LLMProvider.OpenAI, format: LLMFormat.OpenAICompatible,
        flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.Unknown, ...overrides,
    }
}

const ok = (data: unknown) => ({ ok: true, data, headers: {}, status: 200 })

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        claudeAPIKey: 'plain-key',
        openAIKey: 'plain-key',
        proxyKey: 'plain-key',
        mistralKey: 'plain-key',
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
    globalFetchMock.mockReset()
    fetchNativeMock.mockReset()
    callToolMock.mockReset()
})

function openAIArg(extra: Partial<RequestDataArgumentExtended> = {}): RequestDataArgumentExtended {
    const meter = createUsageMeter()
    return {
        formated: [{ role: 'user', content: 'hello' }],
        aiModel: 'reverse_proxy',
        customURL: 'https://api.example.invalid/v1/chat/completions',
        key: 'plain-key',
        maxTokens: 100,
        mode: 'model',
        useStreaming: false,
        bias: {},
        biasString: [],
        modelInfo: modelInfo({}),
        usageMeter: meter,
        ...extra,
    } as unknown as RequestDataArgumentExtended
}

describe('OpenAI chat non-stream usage', () => {
    test('one response reports its usage once', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } }))
        const arg = openAIArg()
        const result = await requestOpenAI(arg)
        expect(result).toEqual({ type: 'success', result: 'hi' })
        expect(arg.usageMeter.reported()).toEqual({ input: 6, output: 5, cacheRead: 4, cacheWrite: 0 })
    })

    test('a tool round adds the follow-up response to the same meter', async () => {
        callToolMock.mockResolvedValue([{ type: 'text', text: 'tool says ok' }])
        globalFetchMock
            .mockResolvedValueOnce(ok({
                choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }],
                usage: { prompt_tokens: 10, completion_tokens: 5 },
            }))
            .mockResolvedValueOnce(ok({ choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 20, completion_tokens: 3 } }))
        const arg = openAIArg({ tools: [{ name: 'lookup', description: 'd', inputSchema: { type: 'object', properties: {} } }] } as Partial<RequestDataArgumentExtended>)
        const result = await requestOpenAI(arg)
        expect(result.result).toContain('done')
        expect(globalFetchMock).toHaveBeenCalledTimes(2)
        expect(arg.usageMeter.reported()).toEqual({ input: 30, output: 8, cacheRead: 0, cacheWrite: 0 })
    })

    test('the Mistral branch reports dat.usage', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'bonjour' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }))
        const arg = openAIArg({ modelInfo: modelInfo({ format: LLMFormat.Mistral, provider: LLMProvider.Mistral }), customURL: undefined, aiModel: 'mistral-large' } as Partial<RequestDataArgumentExtended>)
        const result = await requestOpenAI(arg)
        expect(result).toEqual({ type: 'success', result: 'bonjour' })
        expect(arg.usageMeter.reported()).toEqual({ input: 7, output: 2, cacheRead: 0, cacheWrite: 0 })
    })

    test('guard: a response without usage reports nothing', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ choices: [{ message: { content: 'hi' } }] }))
        const arg = openAIArg()
        await requestOpenAI(arg)
        expect(arg.usageMeter.reported()).toBeNull()
    })
})

describe('Responses API non-stream usage', () => {
    const usage = { input_tokens: 20, input_tokens_details: { cached_tokens: 8 }, output_tokens: 6, total_tokens: 26 }
    const responsesArg = (): RequestDataArgumentExtended => openAIArg({
        customURL: 'https://api.example.invalid/v1/responses',
        modelInfo: modelInfo({ format: LLMFormat.OpenAIResponseAPI }),
    })

    test('a completed response reports usage; input excludes cached tokens', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ output_text: 'ok', usage }))
        const arg = responsesArg()
        expect(await requestOpenAIResponseAPI(arg)).toEqual({ type: 'success', result: 'ok' })
        expect(arg.usageMeter.reported()).toEqual({ input: 12, output: 6, cacheRead: 8, cacheWrite: 0 })
    })

    test('an incomplete response still reports its usage', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: 'cut', usage }))
        const arg = responsesArg()
        const result = await requestOpenAIResponseAPI(arg)
        expect(result.type).toBe('fail')
        expect(arg.usageMeter.reported()).toEqual({ input: 12, output: 6, cacheRead: 8, cacheWrite: 0 })
    })
})

describe('Anthropic non-stream usage', () => {
    test('requestClaudeHTTP reports usage including cache writes', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 12, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 1 } }))
        const meter = createUsageMeter()
        const result = await requestClaude({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: 'claude-3-5-sonnet-20241022',
            maxTokens: 100,
            mode: 'model',
            useStreaming: false,
            bias: {},
            usageMeter: meter,
            modelInfo: modelInfo({ id: 'claude-3-5-sonnet-20241022', internalID: 'claude-3-5-sonnet-20241022', provider: LLMProvider.Anthropic, format: LLMFormat.Anthropic, tokenizer: LLMTokenizer.Claude }),
        } as unknown as Parameters<typeof requestClaude>[0])
        expect(result.type).toBe('success')
        expect(meter.reported()).toEqual({ input: 12, output: 4, cacheRead: 1, cacheWrite: 2 })
    })

    test('the Bedrock invoke response reports its usage', async () => {
        globalFetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 9, output_tokens: 3, cache_read_input_tokens: 2 } }))
        const meter = createUsageMeter()
        const id = 'anthropic.claude-3-5-sonnet-20241022-v2:0'
        const result = await requestClaude({
            formated: [{ role: 'user', content: 'hello' }],
            aiModel: id,
            key: 'AKIDEXAMPLE:secretexample:us-east-1',
            maxTokens: 100,
            mode: 'model',
            useStreaming: false,
            bias: {},
            usageMeter: meter,
            modelInfo: modelInfo({ id, internalID: id, provider: LLMProvider.AWS, format: LLMFormat.AWSBedrockClaude, tokenizer: LLMTokenizer.Claude }),
        } as unknown as Parameters<typeof requestClaude>[0])
        expect(globalFetchMock).toHaveBeenCalledTimes(1)
        expect(String(globalFetchMock.mock.calls[0][0])).toContain('bedrock-runtime.us-east-1.amazonaws.com')
        expect(result.type).toBe('success')
        expect(meter.reported()).toEqual({ input: 9, output: 3, cacheRead: 2, cacheWrite: 0 })
    })
})

describe('Gemini non-stream usage', () => {
    test('the last usageMetadata of the response is reported', async () => {
        const reply = [
            { candidates: [{ content: { parts: [{ text: 'a' }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 1 } },
            { candidates: [{ content: { parts: [{ text: 'b' }] } }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 7, thoughtsTokenCount: 3, cachedContentTokenCount: 10 } },
        ]
        fetchNativeMock.mockImplementation(async () => new Response(JSON.stringify(reply), { status: 200 }))
        const meter = createUsageMeter()
        const result = await requestGoogleCloudVertex({
            formated: [{ role: 'user', content: 'hello' }],
            modelInfo: modelInfo({ id: 'dynamic_google_gemini-x', internalID: 'gemini-x', provider: LLMProvider.GoogleCloud, format: LLMFormat.GoogleCloud, tokenizer: LLMTokenizer.GoogleCloud }),
            maxTokens: 100,
            useStreaming: false,
            mode: 'model',
            usageMeter: meter,
        } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
        expect(result.type).toBe('success')
        expect(meter.reported()).toEqual({ input: 20, output: 10, cacheRead: 10, cacheWrite: 0 })
    })
})
