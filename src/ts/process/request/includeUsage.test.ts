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
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'
import { requestOpenAI } from './openAI/requests'

/**
 * `stream_options.include_usage` is sent only on streaming requests to `api.openai.com`, and a user additional
 * parameter overrides it. Mocked: the transports, which answer with a refused head after the request body is
 * captured, so a passing test says nothing about what a provider does with the field.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const globalFetchMock = vi.mocked(globalFetch)

const model: LLMModel = {
    id: 'm', name: 'm', internalID: 'm', provider: LLMProvider.OpenAI, format: LLMFormat.OpenAICompatible,
    flags: [LLMFlags.hasStreaming], parameters: ['temperature'], tokenizer: LLMTokenizer.Unknown,
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        proxyKey: 'plain-key',
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
    fetchNativeMock.mockImplementation(async () => new Response('refused', { status: 500, headers: { 'Content-Type': 'text/plain' } }))
    globalFetchMock.mockResolvedValue({ ok: false, data: 'refused', headers: {}, status: 500 })
})

async function send(url: string, useStreaming: boolean): Promise<Record<string, unknown>> {
    await requestOpenAI({
        formated: [{ role: 'user', content: 'hello' }],
        aiModel: 'reverse_proxy',
        customURL: url,
        key: 'plain-key',
        maxTokens: 100,
        mode: 'model',
        useStreaming,
        bias: {},
        biasString: [],
        modelInfo: model,
    } as unknown as Parameters<typeof requestOpenAI>[0])
    if (useStreaming) {
        return JSON.parse((fetchNativeMock.mock.calls[0][1] as { body: string }).body)
    }
    return (globalFetchMock.mock.calls[0][1] as { body: Record<string, unknown> }).body
}

describe('include_usage on the chat request body', () => {
    test('a streaming request to api.openai.com asks for usage', async () => {
        const body = await send('https://api.openai.com/v1/chat/completions', true)
        expect(body.stream_options).toEqual({ include_usage: true })
    })

    test('guard: a streaming request to a custom host does not carry the field', async () => {
        const body = await send('https://api.example.invalid/v1/chat/completions', true)
        expect(body).not.toHaveProperty('stream_options')
    })

    test('guard: a non-streaming request to api.openai.com does not carry the field', async () => {
        const body = await send('https://api.openai.com/v1/chat/completions', false)
        expect(body).not.toHaveProperty('stream_options')
    })

    test('guard: a host that only contains api.openai.com in its name does not carry the field', async () => {
        const body = await send('https://api.openai.com.example.invalid/v1/chat/completions', true)
        expect(body).not.toHaveProperty('stream_options')
    })

    test('a user additional parameter overrides the field', async () => {
        h.db.additionalParams = [['stream_options', 'json::{"include_usage":false}']]
        const body = await send('https://api.openai.com/v1/chat/completions', true)
        expect(body.stream_options).toEqual({ include_usage: false })
    })

    test('a user parameter that removes the field wins', async () => {
        h.db.additionalParams = [['stream_options', '{{none}}']]
        const body = await send('https://api.openai.com/v1/chat/completions', true)
        expect(body).not.toHaveProperty('stream_options')
    })
})
