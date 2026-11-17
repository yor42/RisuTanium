import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    sleepCalls: [] as number[],
    onSleep: null as ((ms: number) => void) | null,
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
// Only `sleep` is replaced: the retry wait must not cost real time, and the test observes how long it was asked to wait.
vi.mock('../../util', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../util')>()),
    sleep: async (ms: number) => {
        h.sleepCalls.push(ms)
        h.onSleep?.(ms)
    },
}))

import { fetchNative, textifyReadableStream } from '../../globalApi.svelte'
import { LLMFlags, LLMFormat, LLMProvider, LLMTokenizer } from '../../model/types'
import { requestClaude } from './anthropic'
import { frozenAnthropicStream } from './tests/frozenAnthropicStream'

/**
 * The Anthropic streaming loop keeps only the unfinished tail between reads and parses each complete line
 * once. The fixtures are built like the producer: `event: X` plus `data: {json}` plus a blank line, in the
 * real event order; shapes the producer does not send are labelled synthetic in the title. The real
 * `requestClaude` runs; `frozenAnthropicStream` is the pre-change loop used as oracle.
 * Mocked: the transport (`fetchNative`), `sleep` and the database, store and plugin modules the catalog
 * imports, so a passing test says nothing about native behaviour.
 *
 * Tests whose title starts with `guard:` pass with or without the change. The guard corpus contains no
 * "overload" text: the frozen loop drops such an error event, the new loop does not.
 */

const fetchNativeMock = vi.mocked(fetchNative)
const textifyMock = vi.mocked(textifyReadableStream)
const encoder = new TextEncoder()
const decoder = new TextDecoder()

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, {
        claudeAPIKey: 'plain-key',
        gptVisionQuality: 'low',
        additionalParams: [],
        customModels: [],
        modelTools: [],
        OaiCompAPIKeys: {},
        requestRetrys: 0,
        temperature: 70,
        top_p: 0.9,
    })
    h.sleepCalls.length = 0
    h.onSleep = null
    fetchNativeMock.mockReset()
    textifyMock.mockReset()
    textifyMock.mockImplementation(async () => 'FAILBODY')
})

// ---- fixtures shaped like the producer ----

function ev(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
const messageStart = () => ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', content: [], model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 1, output_tokens: 1 } } })
const blockStart = (index: number, type: 'text' | 'thinking') => ev('content_block_start', { type: 'content_block_start', index, content_block: type === 'text' ? { type, text: '' } : { type, thinking: '' } })
const textDelta = (text: string, index = 0) => ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
const thinkingDelta = (thinking: string, index = 0) => ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } })
const signatureDelta = (index = 0) => ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'EqQBCkYIAxgCIk' } })
const ping = () => ev('ping', { type: 'ping' })
const blockStop = (index = 0) => ev('content_block_stop', { type: 'content_block_stop', index })
const messageEnd = () => ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }) + ev('message_stop', { type: 'message_stop' })
const errorEvent = (type: string, message: string) => ev('error', { type: 'error', error: { type, message } })

const OVERLOAD = errorEvent('overloaded_error', 'Overloaded')

const CORPUS: Record<string, string> = {
    'text only': messageStart() + blockStart(0, 'text') + textDelta('Hel') + ping() + textDelta('lo ') + textDelta('world') + blockStop() + messageEnd(),
    'thinking then text with signature': messageStart() + blockStart(0, 'thinking') + thinkingDelta('t1') + thinkingDelta('t2') + signatureDelta() + blockStop() + blockStart(1, 'text') + textDelta('x1', 1) + textDelta('x2', 1) + blockStop(1) + messageEnd(),
    'thinking open at the end of the body': messageStart() + blockStart(0, 'thinking') + thinkingDelta('t1') + thinkingDelta('t2'),
    'non-overload error mid-stream': messageStart() + blockStart(0, 'text') + textDelta('a') + errorEvent('api_error', 'Bad thing') + textDelta('b') + messageEnd(),
    'malformed data line': messageStart() + blockStart(0, 'text') + textDelta('a') + 'data: {not json\n\n' + textDelta('b') + messageEnd(),
    'CRLF line ends': (messageStart() + blockStart(0, 'thinking') + thinkingDelta('t1') + blockStart(1, 'text') + textDelta('x1', 1) + messageEnd()).replace(/\n/g, '\r\n'),
    'Korean and emoji': messageStart() + blockStart(0, 'text') + textDelta('가') + textDelta('😀') + textDelta(' end') + messageEnd(),
    'synthetic redacted_thinking delta': messageStart() + ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'redacted_thinking' } }) + blockStart(1, 'text') + textDelta('x1', 1) + messageEnd(),
}

// ---- chunking ----

function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** The complete line that ends at the last LF before `cut`, or null. */
function lastCompleteLine(bytes: Uint8Array, cut: number): string | null {
    let end = cut - 1
    while (end >= 0 && bytes[end] !== 10) { end-- }
    if (end < 0) { return null }
    let start = end - 1
    while (start >= 0 && bytes[start] !== 10) { start-- }
    return decoder.decode(bytes.slice(start + 1, end))
}

/** A read boundary after which the old loop's rollback loses or delays a delta or error line. */
function isBadCut(bytes: Uint8Array, cut: number): boolean {
    const line = lastCompleteLine(bytes, cut)
    if (!line || !line.startsWith('data: ')) { return false }
    try {
        const type = JSON.parse(line.slice(6)).type
        return type === 'content_block_delta' || type === 'error'
    } catch {
        return false
    }
}

type CutKind = 'natural' | 'single' | 'every' | number

function cutsOf(bytes: Uint8Array, kind: CutKind): number[] {
    const cuts: number[] = []
    if (kind === 'natural') {
        for (let i = 0; i + 1 < bytes.length; i++) {
            if (bytes[i] === 10 && bytes[i + 1] === 10) { cuts.push(i + 2) }
        }
        return cuts.filter((cut) => cut < bytes.length)
    }
    if (kind === 'every') {
        for (let i = 1; i < bytes.length; i++) { cuts.push(i) }
        return cuts
    }
    if (typeof kind === 'number') {
        const random = seededRandom(kind)
        let at = 0
        while (true) {
            at += 1 + Math.floor(random() * 48)
            if (at >= bytes.length) { return cuts }
            cuts.push(at)
        }
    }
    return cuts
}

function chunksAt(bytes: Uint8Array, cuts: number[], zeroLength = false): Uint8Array[] {
    const chunks: Uint8Array[] = []
    let from = 0
    for (const cut of [...cuts, bytes.length]) {
        chunks.push(bytes.slice(from, cut))
        if (zeroLength) { chunks.push(new Uint8Array(0)) }
        from = cut
    }
    return chunks
}

function goodChunks(body: string, kind: CutKind, zeroLength = false): Uint8Array[] {
    const bytes = encoder.encode(body)
    return chunksAt(bytes, cutsOf(bytes, kind).filter((cut) => !isBadCut(bytes, cut)), zeroLength)
}

function anyChunks(body: string, kind: CutKind): Uint8Array[] {
    const bytes = encoder.encode(body)
    return chunksAt(bytes, cutsOf(bytes, kind))
}

// ---- running ----

function chunkedResponse(chunks: Uint8Array[], status = 200): Response {
    let next = 0
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (next < chunks.length) {
                controller.enqueue(chunks[next++])
            } else {
                controller.close()
            }
        },
    })
    return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

function oneRead(body: string, status = 200): Response {
    return chunkedResponse([encoder.encode(body)], status)
}

async function collect(stream: ReadableStream<unknown>): Promise<string[]> {
    const reader = stream.getReader()
    const values: string[] = []
    while (true) {
        const { done, value } = await reader.read()
        if (done) { return values }
        values.push((value as Record<string, string>)['0'])
    }
}

function claudeStreamOf(abortSignal?: AbortSignal): Promise<ReadableStream<unknown>> {
    return requestClaude({
        formated: [{ role: 'user', content: 'hello' }],
        aiModel: 'claude-3-5-sonnet-20241022',
        maxTokens: 100,
        mode: 'model',
        useStreaming: true,
        bias: {},
        abortSignal,
        modelInfo: {
            id: 'claude-3-5-sonnet-20241022', name: 'claude', internalID: 'claude-3-5-sonnet-20241022',
            provider: LLMProvider.Anthropic, format: LLMFormat.Anthropic, flags: [LLMFlags.hasStreaming],
            parameters: ['temperature'], tokenizer: LLMTokenizer.Claude,
        },
    } as unknown as Parameters<typeof requestClaude>[0]).then((response) => {
        expect(response.type).toBe('streaming')
        return response.result as ReadableStream<unknown>
    })
}

async function emissionsOf(chunks: Uint8Array[]): Promise<string[]> {
    fetchNativeMock.mockImplementation(async () => chunkedResponse(chunks))
    return collect(await claudeStreamOf())
}

/** Responses handed out one per fetch, in order; a missing one fails the test loudly. */
function respondWith(...responses: (() => Response)[]): void {
    let next = 0
    fetchNativeMock.mockImplementation(async () => {
        const make = responses[next++]
        if (!make) { throw new Error('unexpected extra fetch') }
        return make()
    })
}

const frozenCache = new Map<string, string[]>()
async function frozenEmissions(chunks: Uint8Array[]): Promise<string[]> {
    return collect(frozenAnthropicStream(chunkedResponse(chunks)))
}

/** What the old loop emits for exactly the complete lines in `bytes`, with the rollback made harmless. */
async function oracleFor(bytes: Uint8Array): Promise<string[]> {
    let end = bytes.length
    while (end > 0 && bytes[end - 1] !== 10) { end-- }
    const key = decoder.decode(bytes.slice(0, end))
    let emissions = frozenCache.get(key)
    if (!emissions) {
        emissions = await frozenEmissions([encoder.encode(key + '\n')])
        frozenCache.set(key, emissions)
    }
    return emissions
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let at = 0
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
    return out
}

// ---- equivalence with the old loop ----

describe('Anthropic stream: emissions equal the old loop where the old loop is correct', () => {
    const KINDS: [string, CutKind][] = [['natural reads', 'natural'], ['one read', 'single'], ['every byte', 'every'], ['random seed 1', 1], ['random seed 7', 7], ['random seed 99', 99]]
    for (const [name, body] of Object.entries(CORPUS)) {
        for (const [kindName, kind] of KINDS) {
            for (const zeroLength of [false, true]) {
                test(`guard: ${name}, ${kindName}${zeroLength ? ', zero-length reads' : ''}`, async () => {
                    const chunks = goodChunks(body, kind, zeroLength)
                    const expected = await frozenEmissions(chunks)
                    expect(await emissionsOf(chunks)).toEqual(expected)
                })
            }
        }
    }
})

describe('Anthropic stream: abort', () => {
    function gatedSource(chunks: Uint8Array[], allowed: number, signal: AbortSignal): Response {
        let next = 0
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (next < allowed && next < chunks.length) {
                    controller.enqueue(chunks[next++])
                    return
                }
                return new Promise<void>((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
                })
            },
        })
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }

    async function readAbortingAfter(stream: ReadableStream<unknown>, count: number, controller: AbortController): Promise<string[]> {
        const reader = stream.getReader()
        const values: string[] = []
        while (true) {
            const { done, value } = await reader.read()
            if (done) { return values }
            values.push((value as Record<string, string>)['0'])
            if (values.length === count) { controller.abort() }
        }
    }

    for (const k of [1, 2, 3]) {
        test(`guard: abort after ${k} emissions gives the old loop's emissions, closer included`, async () => {
            const chunks = goodChunks(CORPUS['thinking then text with signature'], 'natural')
            const frozenAbort = new AbortController()
            const expected = await readAbortingAfter(frozenAnthropicStream(gatedSource(chunks, k, frozenAbort.signal), frozenAbort.signal), k, frozenAbort)
            const abort = new AbortController()
            fetchNativeMock.mockImplementation(async () => gatedSource(chunks, k, abort.signal))
            const actual = await readAbortingAfter(await claudeStreamOf(abort.signal), k, abort)
            expect(expected.length).toBeGreaterThanOrEqual(k)
            expect(actual).toEqual(expected)
        })
    }
})

// ---- the defects of the old loop ----

describe('Anthropic stream: each emission holds every complete line received so far', () => {
    const THINKING = CORPUS['thinking then text with signature']
    const KINDS: [string, CutKind][] = [['every byte is a read', 'every'], ['random seed 3', 3], ['random seed 11', 11], ['random seed 42', 42]]

    for (const [kindName, kind] of KINDS) {
        test(`emission k equals the old loop over the complete lines of reads 1..k: ${kindName}`, async () => {
            const chunks = anyChunks(THINKING, kind)
            const emissions = await emissionsOf(chunks)
            const received: Uint8Array[] = []
            for (let k = 0; k < chunks.length; k++) {
                received.push(chunks[k])
                const oracle = await oracleFor(concat(received))
                expect(emissions[k], `read ${k + 1} of ${chunks.length}`).toBe(oracle[0])
            }
            const final = await oracleFor(concat(received))
            expect(emissions[emissions.length - 1]).toBe(final[final.length - 1])
        })
    }

    test('every read ends right after a data line of the thinking shape: markers present, no lag', async () => {
        const bytes = encoder.encode(messageStart() + blockStart(0, 'thinking') + thinkingDelta('t1') + thinkingDelta('t2') + blockStart(1, 'text') + textDelta('x1', 1) + textDelta('x2', 1))
        const cuts: number[] = []
        for (let i = 0; i + 1 < bytes.length; i++) {
            if (bytes[i] === 10 && isBadCut(bytes, i + 1)) { cuts.push(i + 1) }
        }
        expect(cuts).toHaveLength(4)
        const emissions = await emissionsOf(chunksAt(bytes, cuts))
        expect(emissions[emissions.length - 1]).toBe('<Thoughts>\nt1t2</Thoughts>\n\nx1x2')
        expect(emissions).toContain('<Thoughts>\nt1')
        expect(emissions).toContain('<Thoughts>\nt1t2</Thoughts>\n\nx1')
    })
})

describe('Anthropic stream: the end of the body', () => {
    test('a final data line terminated by one LF and no blank line is kept', async () => {
        const body = messageStart() + blockStart(0, 'text') + textDelta('a') + `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'LAST' } })}\n`
        const emissions = await emissionsOf([encoder.encode(body)])
        expect(emissions[emissions.length - 1]).toBe('aLAST')
    })

    test('guard: an unterminated final data line is not parsed, before and after', async () => {
        const body = messageStart() + blockStart(0, 'text') + textDelta('a') + `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'LAST' } })}`
        const chunks = [encoder.encode(body)]
        const emissions = await emissionsOf(chunks)
        expect(emissions[emissions.length - 1]).toBe('a')
        expect(await frozenEmissions(chunks)).toEqual(emissions)
    })
})

// ---- overload events ----

describe('Anthropic stream: overload events', () => {
    const retryCall = () => fetchNativeMock.mock.calls.map((call) => (call[1] as { interceptor?: string }).interceptor)

    test('setting on: retry with fresh state and the retried reply as the final text', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 1 })
        respondWith(
            () => oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + textDelta('z') + messageEnd()),
            () => oneRead(messageStart() + blockStart(0, 'thinking') + thinkingDelta('r') + blockStart(1, 'text') + textDelta('b', 1) + messageEnd()),
        )
        const emissions = await collect(await claudeStreamOf())
        expect(fetchNativeMock).toHaveBeenCalledTimes(2)
        expect(retryCall()).toEqual(['anthropic_streaming', 'anthropic_streaming_retry'])
        expect(emissions).toContain('Overload detected, retrying...')
        expect(emissions[emissions.length - 1]).toBe('<Thoughts>\nr</Thoughts>\n\nb')
        expect(h.sleepCalls).toEqual([1000])
    })

    test('setting on, thinking open at the overload: a text-only retry has no stray closer', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 1 })
        respondWith(
            () => oneRead(messageStart() + blockStart(0, 'thinking') + thinkingDelta('t') + OVERLOAD),
            () => oneRead(messageStart() + blockStart(0, 'text') + textDelta('b') + messageEnd()),
        )
        const emissions = await collect(await claudeStreamOf())
        expect(fetchNativeMock).toHaveBeenCalledTimes(2)
        expect(emissions[emissions.length - 1]).toBe('b')
        expect(emissions.filter((value) => value.includes('</Thoughts>'))).toEqual([])
    })

    test('setting off: the error text is appended like any stream error', async () => {
        Object.assign(h.db, { antiServerOverloads: false, requestRetrys: 3 })
        respondWith(() => oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + messageEnd()))
        const emissions = await collect(await claudeStreamOf())
        expect(fetchNativeMock).toHaveBeenCalledTimes(1)
        expect(emissions[emissions.length - 1]).toBe('aError:Overloaded')
        expect(h.sleepCalls).toEqual([])
    })

    test('setting on with no retries allowed: no second fetch and the error is shown', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 0 })
        respondWith(() => oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + messageEnd()))
        const emissions = await collect(await claudeStreamOf())
        expect(fetchNativeMock).toHaveBeenCalledTimes(1)
        expect(emissions[emissions.length - 1]).toBe('aError:Overloaded')
        expect(emissions).not.toContain('Overload detected, retrying...')
    })

    test('the retry cap: 1 + requestRetrys fetches, a 1 s wait before each retry, the error shown at the cap', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 2 })
        const overloaded = () => oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + messageEnd())
        respondWith(overloaded, overloaded, overloaded)
        const emissions = await collect(await claudeStreamOf())
        expect(fetchNativeMock).toHaveBeenCalledTimes(3)
        expect(h.sleepCalls).toEqual([1000, 1000])
        expect(emissions.filter((value) => value === 'Overload detected, retrying...')).toHaveLength(2)
        expect(emissions[emissions.length - 1]).toBe('aError:Overloaded')
    })

    test('a retry answered with a failure status ends the stream on the failure body', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 1 })
        respondWith(
            () => oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + messageEnd()),
            () => oneRead('overloaded', 529),
        )
        const emissions = await collect(await claudeStreamOf())
        expect(fetchNativeMock).toHaveBeenCalledTimes(2)
        expect(emissions[emissions.length - 1]).toBe('FAILBODY')
    })

    test('an abort during the 1 s wait ends the stream without another fetch', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 2 })
        const abort = new AbortController()
        h.onSleep = (ms) => { if (ms === 1000) { abort.abort() } }
        respondWith(() => oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + messageEnd()))
        const emissions = await collect(await claudeStreamOf(abort.signal))
        expect(fetchNativeMock).toHaveBeenCalledTimes(1)
        expect(emissions).toContain('Overload detected, retrying...')
    })

    test('an abort during the retry fetch ends the stream and does not fetch again', async () => {
        Object.assign(h.db, { antiServerOverloads: true, requestRetrys: 3 })
        const abort = new AbortController()
        let calls = 0
        fetchNativeMock.mockImplementation(async () => {
            calls++
            if (calls === 1) {
                return oneRead(messageStart() + blockStart(0, 'text') + textDelta('a') + OVERLOAD + messageEnd())
            }
            abort.abort()
            throw new DOMException('Aborted', 'AbortError')
        })
        const emissions = await collect(await claudeStreamOf(abort.signal))
        expect(fetchNativeMock).toHaveBeenCalledTimes(2)
        expect(emissions).toContain('Overload detected, retrying...')
    })
})
