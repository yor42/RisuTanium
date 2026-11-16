/**
 * A prompt in which every formatted message is a system message, or no message at all, reaches the
 * request without throwing. Models with a first system prompt move the leading system messages
 * into one system prompt; when nothing follows them the list holds only that prompt. The Gemini
 * builder takes a leading system message as its system instruction and then sends no contents;
 * the provider's answer to that request is passed on as it is.
 *
 * Drives the real `reformater` and the real `requestGoogleCloudVertex` through a request preview, so
 * no request is sent. Mocked: the transports, the database and store modules, inlays, MCP, alerts
 * and the plugin modules the catalog imports.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'

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

import { reformater } from './request'
import { requestGoogleCloudVertex } from './google'
import type { OpenAIChat } from '../index.svelte'

const FIRST_SYSTEM = [LLMFlags.hasFirstSystemPrompt]

function gemini(): LLMModel {
    return {
        id: 'gemini-x',
        name: 'gemini-x',
        internalID: 'gemini-x',
        provider: LLMProvider.GoogleCloud,
        format: LLMFormat.GoogleCloud,
        flags: [LLMFlags.hasStreaming, LLMFlags.hasFirstSystemPrompt],
        parameters: ['temperature'],
        tokenizer: LLMTokenizer.GoogleCloud,
    }
}

interface GeminiPreview {
    body: {
        contents: Array<{ role?: string, parts: Array<{ text?: string }> }>
        systemInstruction?: { parts: Array<{ text: string }> }
    }
}

/** The body of a Gemini request preview for these formatted messages. */
async function geminiPreview(formated: OpenAIChat[]): Promise<GeminiPreview['body']> {
    const response = await requestGoogleCloudVertex({
        formated,
        modelInfo: gemini(),
        maxTokens: 100,
        previewBody: true,
        useStreaming: false,
        mode: 'model',
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
    expect(response.type).toBe('success')
    return (JSON.parse(String(response.result)) as GeminiPreview).body
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        google: { accessToken: 'plain-key', projectId: 'proj' },
        vertexRegion: 'us-central1',
        gptVisionQuality: 'low',
    })
})

describe('reformater with a first system prompt', () => {
    test('a list of only system messages becomes one system prompt', () => {
        const result = reformater([
            { role: 'system', content: 'one' },
            { role: 'system', content: 'two' },
        ], FIRST_SYSTEM)
        expect(result).toEqual([{ role: 'system', content: 'one\n\ntwo' }])
    })

    test('an empty list stays empty', () => {
        expect(reformater([], FIRST_SYSTEM)).toEqual([])
    })

    test('guard: leading system messages are merged and the rest is kept', () => {
        const result = reformater([
            { role: 'system', content: 'one' },
            { role: 'system', content: 'two' },
            { role: 'user', content: 'hi' },
        ], FIRST_SYSTEM)
        expect(result).toEqual([
            { role: 'system', content: 'one\n\ntwo' },
            { role: 'user', content: 'hi' },
        ])
    })
})

describe('the Gemini request body', () => {
    test('an empty list sends no contents and no system instruction', async () => {
        const body = await geminiPreview([])
        expect(body.contents).toEqual([])
        expect(body.systemInstruction).toBeUndefined()
    })

    test('guard: a list of only a system message sends it as the system instruction, with no contents', async () => {
        const body = await geminiPreview([{ role: 'system', content: 'rules' }])
        expect(body.contents).toEqual([])
        expect(body.systemInstruction).toEqual({ parts: [{ text: 'rules' }] })
    })

    test('guard: a system message then a user message sends the instruction and the user turn', async () => {
        const body = await geminiPreview([
            { role: 'system', content: 'rules' },
            { role: 'user', content: 'hi' },
        ])
        expect(body.systemInstruction).toEqual({ parts: [{ text: 'rules' }] })
        expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
    })
})
