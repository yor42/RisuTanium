/**
 * A Gemini image reply becomes an inlay on a plain-HTTP page, where `crypto.randomUUID` does not exist.
 *
 * Drives the real `requestGoogleCloudVertex` with `fetchNative` mocked and `crypto` replaced by an object
 * that has only `getRandomValues`. `uuid` captures the native `randomUUID` when it is first evaluated, so
 * this proves that the inlay id is no longer taken from `crypto.randomUUID` directly; it does not prove
 * the library's own fallback.
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
    isAndroidTransport: () => false,
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
import { writeInlayImage } from '../files/inlays'
import { requestGoogleCloudVertex } from './google'

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

const realCrypto = globalThis.crypto
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, { saveSignatures: false, google: { accessToken: 'plain-key', projectId: 'proj' }, vertexRegion: 'us-central1', gptVisionQuality: 'low' })
    vi.mocked(fetchNative).mockReset()
    vi.mocked(writeInlayImage).mockReset()
})

afterEach(() => {
    vi.stubGlobal('crypto', realCrypto)
})

describe('a Gemini image reply without crypto.randomUUID', () => {
    test('regression: the image becomes an inlay with a v4 id', async () => {
        vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
        expect((globalThis.crypto as { randomUUID?: unknown }).randomUUID).toBeUndefined()
        const reply = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }
        vi.mocked(fetchNative).mockImplementation(async () => new Response(JSON.stringify(reply), { status: 200 }))

        const outcome = await requestGoogleCloudVertex({
            formated: [{ role: 'user', content: 'draw' }],
            modelInfo: model,
            maxTokens: 100,
            useStreaming: false,
            mode: 'model',
        } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])

        expect(vi.mocked(writeInlayImage)).toHaveBeenCalledTimes(1)
        const id = (vi.mocked(writeInlayImage).mock.calls[0][1] as { id: string }).id
        expect(id).toMatch(V4)
        expect(outcome).toMatchObject({ type: 'success' })
        expect(String((outcome as { result: unknown }).result)).toContain(`{{inlayeddata::${id}}}`)
    })
})