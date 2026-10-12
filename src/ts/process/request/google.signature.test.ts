/**
 * A stored thought signature is replayed to the Gemini model that produced it. Added Google models
 * used to carry `models/<id>` as their `internalID`, so signatures saved by that build name
 * `models/<id>` as their source; the entry now carries the bare id, and replay must still match the
 * old source form, the bare form and the entry id.
 *
 * Drives the real `requestGoogleCloudVertex` through a request preview, so no request is sent.
 * Mocked: the transports, the database and store modules, inlays, MCP, alerts and the plugin
 * modules the catalog imports.
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

import { fetchNative } from '../../globalApi.svelte'
import { getModelInfo, getModelList, registerModelDynamic } from '../../model/modellist'
import { requestGoogleCloudVertex } from './google'

const SIGNATURE = 'SIGNATURE-CONTENT'

function entry(overrides: Partial<LLMModel>): LLMModel {
    return {
        id: 'dynamic_google_gemini-x',
        name: 'gemini-x',
        internalID: 'gemini-x',
        provider: LLMProvider.GoogleCloud,
        format: LLMFormat.GoogleCloud,
        flags: [LLMFlags.hasImageInput, LLMFlags.hasStreaming],
        parameters: ['temperature'],
        tokenizer: LLMTokenizer.GoogleCloud,
        ...overrides,
    }
}

function signatureOf(source: string): string {
    const stored = { signatures: [{ type: 'text', content: SIGNATURE }], sourceFormat: LLMFormat.GoogleCloud, source }
    return Buffer.from(JSON.stringify(stored), 'utf-8').toString('base64')
}

/** The `thoughtSignature` parts the preview body carries. */
async function replayed(modelInfo: LLMModel, source: string): Promise<string[]> {
    const response = await requestGoogleCloudVertex({
        formated: [{ role: 'user', content: 'hello', multimodals: [{ type: 'signature', base64: signatureOf(source) }] }],
        modelInfo,
        maxTokens: 100,
        previewBody: true,
        useStreaming: false,
        mode: 'model',
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
    expect(response.type).toBe('success')
    const preview = JSON.parse(String(response.result)) as { body: { contents: Array<{ parts: Array<{ thoughtSignature?: string }> }> } }
    return preview.body.contents.flatMap(content => content.parts).flatMap(part => part.thoughtSignature === undefined ? [] : [part.thoughtSignature])
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        saveSignatures: true,
        google: { accessToken: 'plain-key', projectId: 'proj' },
        vertexRegion: 'us-central1',
        gptVisionQuality: 'low',
    })
})

describe('thought signature replay (F7)', () => {
    test('a signature whose source is models/<internalID> replays for the entry whose internalID is the bare id', async () => {
        expect(await replayed(entry({}), 'models/gemini-x')).toEqual([SIGNATURE])
    })

    test('guard: a signature whose source is the bare internalID replays', async () => {
        expect(await replayed(entry({}), 'gemini-x')).toEqual([SIGNATURE])
    })

    test('guard: a signature whose source is the entry id replays', async () => {
        expect(await replayed(entry({}), 'dynamic_google_gemini-x')).toEqual([SIGNATURE])
    })

    test('guard: a signature from another model does not replay', async () => {
        expect(await replayed(entry({}), 'models/gemini-y')).toEqual([])
        expect(await replayed(entry({}), 'gemini-y')).toEqual([])
    })
})

describe('a Google model added by the registry, through the public path (F8)', () => {
    test('listing it twice shows one entry, and the request URL carries the bare id once (proves the URL string, not a 404)', async () => {
        h.db.dynamicModelRegistry = true
        h.db.claudeAPIKey = ''
        h.db.openAIKey = ''
        vi.mocked(fetchNative).mockImplementation(async () => new Response(JSON.stringify({
            models: [{ name: 'models/gemini-x', displayName: 'Gemini X', supportedGenerationMethods: ['generateContent'] }],
        }), { status: 200 }))

        await registerModelDynamic()
        await registerModelDynamic()
        await vi.dynamicImportSettled()

        const listed = getModelList({ recommendedOnly: false, groupedByProvider: false }).filter(model => model.id === 'dynamic_google_gemini-x')
        expect(listed).toHaveLength(1)
        const response = await requestGoogleCloudVertex({
            formated: [{ role: 'user', content: 'hello' }],
            modelInfo: getModelInfo('dynamic_google_gemini-x'),
            maxTokens: 100,
            previewBody: true,
            useStreaming: false,
            mode: 'model',
        } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
        const preview = JSON.parse(String(response.result)) as { url: string }
        expect(preview.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent?key=plain-key')
    })
})
