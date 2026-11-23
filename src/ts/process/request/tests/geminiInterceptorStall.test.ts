/**
 * The Gemini event callbacks (`meta_gemini`, `meta_gemini_stream`) run after the reply is in hand: an interceptor
 * that never settles ends the notification at a Stop, not the reply. Without a Stop each interceptor is awaited,
 * the first one's return value never reaches the second, and the streaming callbacks share one object.
 *
 * Drives the real `requestGoogleCloudVertex` (non-stream body and SSE stream) with `fetchNative` mocked to return a
 * Response built as the Gemini API sends it, and the real interceptor loop.
 *
 * Tests whose title starts with `guard:` pass with or without the change.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer, type LLMModel } from '../../../model/types'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    android: { value: false },
    store: [] as Array<{ id: string, callback: (body: unknown, type: string) => Promise<unknown> }>,
}))
vi.mock('../../../globalApi.svelte', () => ({
    fetchNative: vi.fn(), globalFetch: vi.fn(),
    addFetchLog: vi.fn(), textifyReadableStream: vi.fn(async () => ''),
    readImage: vi.fn(), aiWatermarkingLawApplies: vi.fn(() => false), getFileSrc: vi.fn(async () => ''),
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
    AppendableBuffer: class {}, LocalWriter: class {}, VirtualWriter: class {}, downloadFile: vi.fn(), saveAsset: vi.fn(async () => ''),
}))
vi.mock('../../../storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../storage/tauriByteTransport')>()),
    isAndroidTransport: () => h.android.value,
}))
vi.mock('../../../tokenizer', () => ({
    ChatTokenizer: class { constructor(_a: number, _b: string) {} async tokenizeChat() { return 1 } },
    tokenize: vi.fn(async (s: string) => (s?.length ?? 0)), tokenizeNum: vi.fn(async () => [] as number[]),
}))
vi.mock('../../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: '', chaId: '' })), getCharImage: vi.fn() }))
vi.mock('../../command', () => ({ processMultiCommand: vi.fn(async () => {}) }))
vi.mock('../../../media', () => ({ compressImage: vi.fn(async (v: unknown) => v) }))
vi.mock('../../tts', () => ({ sayTTS: vi.fn() }))
vi.mock('../../../storage/database.svelte', () => ({ getDatabase: () => h.db, setDatabase: vi.fn() }))
vi.mock('../../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: h.store,
}))
vi.mock('localforage', () => ({ default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) }) } }))
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (html: string) => html } }))
vi.mock('../../../alert', () => ({ alertError: vi.fn() }))
vi.mock('../../files/inlays', () => ({
    saveInlayedSignature: vi.fn(),
    setInlayAsset: vi.fn(),
    writeInlayImage: vi.fn(),
    supportsInlayImage: vi.fn(() => false),
}))
vi.mock('../../mcp/mcp', () => ({ callTool: vi.fn(), decodeToolCall: vi.fn(), encodeToolCall: vi.fn() }))
vi.mock('../../../platform', () => ({ isTauri: false, isNodeServer: false }))
vi.mock('../../../plugins/plugins.svelte', () => ({
    customProviderStore: writable([]),
    pluginV2: { providerOptions: new Map(), providers: new Map() },
}))
vi.mock('../../../plugins/apiV3/v3.svelte', () => ({ customV3ProviderMetaStore: [] }))
vi.mock('../../../model/modelData/modelDataStore', () => ({
    startModelData: vi.fn(),
    refreshModelDataNow: vi.fn(),
    loadProviderLists: vi.fn(),
    saveProviderLists: vi.fn(async () => {}),
}))


import { fetchNative } from '../../../globalApi.svelte'
import { requestGoogleCloudVertex } from '../google'

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

const hang = () => new Promise<never>(() => {})

async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

function ask(extra: { useStreaming: boolean, abortSignal?: AbortSignal }) {
    return requestGoogleCloudVertex({
        formated: [{ role: 'user', content: 'hello' }],
        modelInfo: model,
        maxTokens: 100,
        mode: 'model',
        ...extra,
    } as unknown as Parameters<typeof requestGoogleCloudVertex>[0])
}

const usage = { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 }
const replyJson = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a reply' }] } }], usageMetadata: usage, modelStatus: 'ok' })

/** An SSE body as the streaming endpoint sends it: text chunks, `usageMetadata` on the last one. */
function sseResponse(): Response {
    const events = [
        { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
        { candidates: [{ content: { parts: [{ text: 'lo' }] }, finishReason: 'STOP' }], usageMetadata: usage },
    ]
    const bytes = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }), { status: 200 })
}

async function readToEnd(stream: ReadableStream<unknown>): Promise<{ ended: boolean }> {
    const reader = stream.getReader()
    let ended = false
    void (async () => { while (!(await reader.read()).done) { /* drain */ } ended = true })()
    await flush()
    return { get ended() { return ended } }
}

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    h.store.length = 0
    unhandled = []
    process.on('unhandledRejection', onUnhandled)
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
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
})

describe('a non-streamed Gemini reply with a never-settling meta_gemini interceptor', () => {
    test('G-1: the request settles with its text after the abort', async () => {
        h.store.push({ id: 'hang', callback: hang })
        vi.mocked(fetchNative).mockImplementation(async () => new Response(replyJson, { status: 200 }))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const controller = new AbortController()

        let settled = false
        const call = ask({ useStreaming: false, abortSignal: controller.signal }).then((value) => { settled = true; return value })
        await flush()
        expect(settled).toBe(false)
        controller.abort()
        await flush()

        expect(settled).toBe(true)
        expect(await call).toMatchObject({ type: 'success', result: expect.stringContaining('a reply') })
    })

    test('G-3: guard, two interceptors are awaited, the first return value is not passed on, each gets a fresh object', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const received: Array<Record<string, unknown>> = []
        h.store.push(
            { id: 'a', callback: async (body) => { received.push(body as Record<string, unknown>); (body as Record<string, unknown>).usageMetadata = 'mut'; return 'x' } },
            { id: 'b', callback: async (body) => { received.push(body as Record<string, unknown>); return undefined } },
        )
        vi.mocked(fetchNative).mockImplementation(async () => new Response(replyJson, { status: 200 }))

        const outcome = await ask({ useStreaming: false })

        expect(outcome).toMatchObject({ type: 'success' })
        expect(received).toHaveLength(2)
        expect(received[1]).not.toBe(received[0])
        expect(received[1]).toEqual({ usageMetadata: usage, modelStatus: 'ok', promptFeedback: undefined })
    })
})

describe('a streamed Gemini reply with a never-settling meta_gemini_stream interceptor', () => {
    test('G-2: a direct reader of the stream gets done after the abort and nothing is left unhandled', async () => {
        h.store.push({ id: 'hang', callback: hang })
        vi.mocked(fetchNative).mockImplementation(async () => sseResponse())
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const controller = new AbortController()

        const outcome = await ask({ useStreaming: true, abortSignal: controller.signal })
        expect(outcome.type).toBe('streaming')
        const read = await readToEnd((outcome as { result: ReadableStream<unknown> }).result)
        expect(read.ended).toBe(false)
        controller.abort()
        await flush()

        expect(read.ended).toBe(true)
        expect(unhandled).toEqual([])
    })

    test('G-3b: guard, two interceptors receive the same object, the first return value is not passed on, and the stream closes', async () => {
        const received: unknown[] = []
        h.store.push(
            { id: 'a', callback: async (body) => { received.push(body); return 'x' } },
            { id: 'b', callback: async (body) => { received.push(body); return undefined } },
        )
        vi.mocked(fetchNative).mockImplementation(async () => sseResponse())

        const outcome = await ask({ useStreaming: true })
        const read = await readToEnd((outcome as { result: ReadableStream<unknown> }).result)

        expect(read.ended).toBe(true)
        expect(received).toHaveLength(2)
        expect(received[1]).toBe(received[0])
        expect(received[1]).not.toBe('x')
    })
})
