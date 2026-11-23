/**
 * A Vertex request without a client email (or, for a plain key, without email or key once the stored token
 * has expired) returns a `fail` result carrying the message and raises no alert of its own: the caller shows
 * a failed result, so an extra raw alert would be a second dialog for one failure.
 *
 * Drives the real `requestGoogleCloudVertex` with the transports, database and store modules mocked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { absorbLegacyForTest } from '../../connections/tests/legacyFixture'
import { writable } from 'svelte/store'
import { language } from '../../../lang'
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
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => absorbLegacyForTest(h.db), setDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: absorbLegacyForTest(h.db) } },
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

import { alertError } from '../../alert'
import { requestGoogleCloudVertex } from './google'

function vertexModel(): LLMModel {
    return {
        id: 'vertex-gemini-x',
        name: 'gemini-x',
        internalID: 'gemini-x',
        provider: LLMProvider.VertexAI,
        format: LLMFormat.VertexAIGemini,
        flags: [LLMFlags.hasStreaming],
        parameters: ['temperature'],
        tokenizer: LLMTokenizer.GoogleCloud,
    }
}

async function request(): Promise<{ type: string, result: string }> {
    return await requestGoogleCloudVertex({
        formated: [{ role: 'user', content: 'hello' }],
        modelInfo: vertexModel(),
        maxTokens: 100,
        previewBody: false,
        useStreaming: false,
        mode: 'model',
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0]) as { type: string, result: string }
}

beforeEach(() => {
    vi.mocked(alertError).mockClear()
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        google: { accessToken: '', projectId: 'proj' },
        vertexRegion: 'us-central1',
        gptVisionQuality: 'low',
        vertexClientEmail: '',
    })
})

describe('Vertex auth that is incomplete', () => {
    test('V1: a referenced private key with no client email fails with the message and raises no alert', async () => {
        h.db.vertexPrivateKey = '${VERTEX_KEY}'
        expect(await request()).toEqual({ type: 'fail', result: language.errors.vertexAuthIncomplete })
        expect(alertError).not.toHaveBeenCalled()
    })

    test('V1b: a plain private key with an expired token and no client email fails with the message and raises no alert', async () => {
        h.db.vertexPrivateKey = 'plain-private-key'
        h.db.vertexAccessTokenExpires = Date.now() - 1000
        expect(await request()).toEqual({ type: 'fail', result: language.errors.vertexAuthIncomplete })
        expect(alertError).not.toHaveBeenCalled()
    })
})
