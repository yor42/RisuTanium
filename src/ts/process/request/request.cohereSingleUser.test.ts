/**
 * A prompt for a Cohere-format model whose formatted list holds only one user message, or nothing
 * at all, reaches the request without throwing. The last user message becomes `message`; when it
 * is the only one, the history is empty and there is no preamble. An empty list gets the same
 * failure as a prompt with no user message. A first system message is always the preamble, even
 * when the history is empty, so the user message is never replaced by it.
 *
 * The catalog's Cohere models all start the list with a user message, so these tests use a custom
 * model in the Cohere format with a first system prompt only; that is the one way the list reaches
 * the builder short. Drives the real `requestChatDataMain` and the real Cohere builder through a
 * request preview, so no request is sent. Mocked: the transports, the database and store modules,
 * inlays, MCP, alerts and the plugin modules the catalog imports.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { LLMFlags, LLMFormat, LLMTokenizer } from '../../model/types'
import { language } from '../../../lang'

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

import { requestChatDataMain } from './request'
import type { OpenAIChat } from '../index.svelte'

const COHERE_MODEL_ID = 'xcustom:::cohere-short-list'

interface CoherePreview {
    body: {
        message: string
        chat_history: Array<{ role: string, message: string }>
        preamble?: string
    }
}

async function coherePreview(formated: OpenAIChat[]) {
    return await requestChatDataMain({
        formated,
        staticModel: COHERE_MODEL_ID,
        maxTokens: 100,
        previewBody: true,
        useStreaming: false,
    } as unknown as Parameters<typeof requestChatDataMain>[0], 'model')
}

/** The body of a Cohere request preview for these formatted messages. */
async function cohereBody(formated: OpenAIChat[]): Promise<CoherePreview['body']> {
    const response = await coherePreview(formated)
    expect(response.type).toBe('success')
    return (JSON.parse(String(response.result)) as CoherePreview).body
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        cohereAPIKey: 'plain-key',
        temperature: 70,
        maxResponse: 100,
        seperateModelsForAxModels: false,
        customModels: [{
            id: COHERE_MODEL_ID,
            name: 'cohere-short-list',
            internalId: 'command-r',
            url: '',
            key: 'plain-key',
            format: LLMFormat.Cohere,
            tokenizer: LLMTokenizer.Cohere,
            flags: [LLMFlags.hasFirstSystemPrompt],
        }],
    })
})

describe('the Cohere request body', () => {
    test('a list of only one user message becomes the message, with no history and no preamble', async () => {
        const body = await cohereBody([{ role: 'user', content: 'hi' }])
        expect(body.message).toBe('hi')
        expect(body.chat_history).toEqual([])
        expect(body.preamble).toBeUndefined()
    })

    test('an empty list fails with the missing-user-message error', async () => {
        const response = await coherePreview([])
        expect(response).toEqual({ type: 'fail', result: language.errors.cohereNeedsUserMessage })
    })

    test('guard: a system, an assistant and a final user message give a preamble, one history entry and the message', async () => {
        const body = await cohereBody([
            { role: 'system', content: 'rules' },
            { role: 'assistant', content: 'hello' },
            { role: 'user', content: 'hi' },
        ])
        expect(body.preamble).toBe('rules')
        expect(body.chat_history).toEqual([{ role: 'CHATBOT', message: 'hello' }])
        expect(body.message).toBe('hi')
    })

    test('a system message and one user message give the preamble and keep the user text as the message', async () => {
        const body = await cohereBody([
            { role: 'system', content: 'rules' },
            { role: 'user', content: 'hi' },
        ])
        expect(body.preamble).toBe('rules')
        expect(body.chat_history).toEqual([])
        expect(body.message).toBe('hi')
    })

    test('guard: a list that does not start with a system message keeps its first message in the history, with no preamble', async () => {
        const body = await cohereBody([
            { role: 'user', content: 'a' },
            { role: 'assistant', content: 'b' },
            { role: 'user', content: 'c' },
        ])
        expect(body.preamble).toBeUndefined()
        expect(body.chat_history).toEqual([{ role: 'USER', message: 'a' }, { role: 'CHATBOT', message: 'b' }])
        expect(body.message).toBe('c')
    })

    test('guard: a list with no user message fails with the missing-user-message error', async () => {
        const response = await coherePreview([{ role: 'assistant', content: 'hello' }])
        expect(response).toEqual({ type: 'fail', result: language.errors.cohereNeedsUserMessage })
    })
})
