/**
 * A non-streamed Gemini reply read on Android never goes through the Body mixin and has no native time limit,
 * so it arrives while a hidden page is frozen. Web and desktop keep the Body-mixin reads and the native default.
 *
 * Drives the real `requestGoogleCloudVertex` with `fetchNative` mocked to return a Response. While `frozen`, every
 * Body-mixin read on a Response never settles (a labelled model of the measured stall, not native evidence).
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../model/types'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    android: { value: true },
}))

vi.mock('../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../storage/tauriByteTransport')>()),
    isAndroidTransport: () => h.android.value,
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
import { requestGoogleCloudVertex } from './google'

const BODY_MIXIN = ['text', 'json', 'arrayBuffer', 'blob', 'bytes', 'formData'] as const
const hung: string[] = []

const model: LLMModel = {
    id: 'dynamic_google_gemini-x',
    name: 'gemini-x',
    internalID: 'gemini-x',
    provider: LLMProvider.GoogleCloud,
    format: LLMFormat.GoogleCloud,
    flags: [LLMFlags.hasImageInput, LLMFlags.hasStreaming],
    parameters: ['temperature'],
    tokenizer: LLMTokenizer.GoogleCloud,
}

function freezeBodyMixin(): void {
    for (const name of BODY_MIXIN) {
        Object.defineProperty(Response.prototype, name, {
            configurable: true,
            writable: true,
            value: function () {
                hung.push('body-mixin:' + name)
                return new Promise(() => {})
            },
        })
    }
}

function streamResponse(text: string, status: number): Response {
    const bytes = new TextEncoder().encode(text)
    return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes.subarray(0, 9))
            controller.enqueue(bytes.subarray(9))
            controller.close()
        },
    }), { status })
}

async function ask() {
    return await requestGoogleCloudVertex({
        formated: [{ role: 'user', content: 'hello' }],
        modelInfo: model,
        maxTokens: 100,
        useStreaming: false,
        mode: 'model',
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
}

const replyJson = JSON.stringify({ candidates: [{ content: { parts: [{ text: '한국어 reply' }] } }] })

beforeEach(() => {
    hung.length = 0
    h.android.value = true
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        saveSignatures: false,
        google: { accessToken: 'plain-key', projectId: 'proj' },
        vertexRegion: 'us-central1',
        gptVisionQuality: 'low',
    })
    vi.mocked(fetchNative).mockReset()
})

afterEach(() => {
    for (const name of BODY_MIXIN) {
        delete (Response.prototype as unknown as Record<string, unknown>)[name]
    }
})

describe('a non-streamed Gemini reply on Android', () => {
    test('is parsed without a Body-mixin read and the request has no native time limit (regression: res.json() never settled frozen)', async () => {
        vi.mocked(fetchNative).mockImplementation(async () => streamResponse(replyJson, 200))
        freezeBodyMixin()
        const outcome = await Promise.race([ask(), new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 500))])
        expect(hung).toEqual([])
        expect(outcome).not.toBe('pending')
        expect(outcome).toMatchObject({ type: 'success' })
        expect(String((outcome as { result: unknown }).result)).toContain('한국어 reply')
        expect(vi.mocked(fetchNative).mock.calls[0][1].noNativeTimeout).toBe(true)
    })

    test('an error reply is read without the Body mixin and reports its status', async () => {
        vi.mocked(fetchNative).mockImplementation(async () => streamResponse('{"error":"nope"}', 500))
        freezeBodyMixin()
        const outcome = await Promise.race([ask(), new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 500))])
        expect(hung).toEqual([])
        expect(outcome).toMatchObject({ type: 'fail' })
        expect(String((outcome as { result: unknown }).result)).toContain('status: 500')
    })
})

describe('a non-streamed Gemini reply off Android', () => {
    test.each([['web'], ['desktop']])('guard: %s keeps the Body-mixin reads and the native default', async () => {
        h.android.value = false
        const json = vi.spyOn(Response.prototype, 'json')
        vi.mocked(fetchNative).mockImplementation(async () => new Response(replyJson, { status: 200 }))
        const outcome = await ask()
        expect(outcome).toMatchObject({ type: 'success' })
        expect(json).toHaveBeenCalledTimes(1)
        expect(vi.mocked(fetchNative).mock.calls[0][1].noNativeTimeout).not.toBe(true)
        json.mockRestore()
    })
})
