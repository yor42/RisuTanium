import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { Buffer as NpmBuffer } from 'buffer/'

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
    saveInlayedSignature: vi.fn(async () => {}),
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

import { LLMFlags, LLMFormat, type LLMModel } from '../../model/types'
import { saveInlayedSignature } from '../files/inlays'
import { __testOpenAIChatStream } from './openAI/requests'
import { __testGeminiStream } from './google'
import { frozenGeminiGetTranStream, frozenInitStreamState, frozenOpenAIGetTranStream } from './tests/frozenStreamTransforms'
import type { RequestDataArgumentExtended, StreamResponseChunk } from './request'

/**
 * The OpenAI-format stream transform must emit exactly what the frozen pre-rewrite copy emits (values and
 * key order) for every corpus case, chunking and Buffer implementation: `reasoningFromStructured` sticks
 * across reads, a `[DONE]` whose emission threw is re-tested on every read, a completed `[DONE]` ends
 * line processing, and an incomplete last line never changes what later reads see.
 * The consumer mutates every received object, so an emission that aliases internal state shows up as a
 * difference in a later emission.
 * Tests whose title starts with `guard:` pass with or without the change; this whole file is a
 * compatibility guard. Mocked: the database, store and plugin modules the catalog imports.
 */

const encoder = new TextEncoder()

type Flags = { deepseek?: boolean, multiGen?: boolean, extractJson?: boolean }
type Part = string | Uint8Array
type Corpus = { name: string, parts: Part[], flags?: Flags }
type Emissions = { emissions: [string, string][][], error: string | null }

const MODEL = 'gpt-4o-mini'

function chunkEvent(delta: Record<string, unknown> | null, index = 0, extra: Record<string, unknown> = {}): string {
    const choices = delta === null ? [] : [{ index, delta, finish_reason: null }]
    return 'data: ' + JSON.stringify({ id: 'chatcmpl-abc123', object: 'chat.completion.chunk', created: 1731000000, model: MODEL, choices, ...extra }) + '\n\n'
}
const content = (text: string, index = 0) => chunkEvent({ content: text }, index)
const reasoning = (text: string, field: 'reasoning_content' | 'reasoning' = 'reasoning_content') => chunkEvent({ [field]: text })
const DONE = 'data: [DONE]\n\n'
const roleEvent = chunkEvent({ role: 'assistant', content: '' })
const usageEvent = chunkEvent(null, 0, { usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 } })
const toolStart = chunkEvent({ tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '' } }] })
const toolArgs = (fragment: string, index = 0) => chunkEvent({ tool_calls: [{ index, function: { arguments: fragment } }] })

function bytes(...parts: Part[]): Uint8Array {
    const encoded = parts.map((part) => typeof part === 'string' ? encoder.encode(part) : part)
    const out = new Uint8Array(encoded.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of encoded) { out.set(part, at); at += part.length }
    return out
}

const crlf = (text: string) => text.replace(/\n/g, '\r\n')

const corpus: Corpus[] = [
    { name: 'a: Korean and emoji content', parts: [roleEvent, content('안녕'), content('하세요 😀'), content(' 가나다'), usageEvent, DONE] },
    { name: 'b: tool_calls id and name then argument fragments', parts: [roleEvent, toolStart, toolArgs('{"city":'), toolArgs('"Seoul"}'), chunkEvent({}, 0), DONE] },
    { name: 'b2: content and a tool call together', parts: [content('Let me check. '), toolStart, toolArgs('{}'), DONE] },
    { name: 'c: reasoning_content and reasoning deltas', parts: [roleEvent, reasoning('think '), reasoning('more', 'reasoning'), content('answer'), DONE] },
    { name: "c': reasoning deltas with the deepseek flag", parts: [reasoning('think '), reasoning('more'), content('answer'), DONE], flags: { deepseek: true } },
    { name: "c2: structured reasoning, then a literal close tag in content", parts: [reasoning('r'), content('x</think>y'), DONE], flags: { deepseek: true } },
    { name: 'd: think tags in content with the deepseek flag', parts: [content('<think>plan'), content(' it</think>'), content('final'), DONE], flags: { deepseek: true } },
    { name: 'd2: deepseek flag, no think tag, with a tool call', parts: [content('plain'), toolStart, toolArgs('{}'), DONE], flags: { deepseek: true } },
    { name: 'e: deepseek flag with [DONE] before any content', parts: [DONE, content('<think>a</think>b'), content('c'), DONE, content('d')], flags: { deepseek: true } },
    { name: 'e1: [DONE] threw, then a reasoning event, then an empty read', parts: ['data: [DONE]\n', reasoning('x'), ''], flags: { deepseek: true } },
    { name: 'e2: threw [DONE], reasoning plus [DONE] in one read, empty read, content', parts: [DONE, reasoning('x') + DONE, '', content('late')], flags: { deepseek: true } },
    { name: 'e3: threw [DONE], tool call, [DONE], multiGen index 1, reasoning, empty reads', parts: ['data: [DONE]\n', toolStart, 'data: [DONE]\n', content('one', 1), reasoning('x'), '', ''], flags: { deepseek: true, multiGen: true } },
    { name: 'e4: two threw [DONE] lines in one read, then a completing one', parts: [DONE + DONE, content('<think>q</think>r'), DONE, content('z')], flags: { deepseek: true } },
    { name: 'f: extractJson with a schema', parts: [content('{"text":'), content('"hello"}'), DONE], flags: { extractJson: true } },
    { name: 'g: multiGen indexes 0 and 1', parts: [content('a0', 0), content('b1', 1), content('c0', 0), content('d1', 1), DONE], flags: { multiGen: true } },
    { name: 'h: cumulative content producer', parts: [content('Hel'), content('Hello'), content('Hello w'), content('Hello world'), DONE] },
    {
        name: 'i: malformed line, choice without delta, keep-alive and no-space data',
        parts: [
            content('one'),
            'data: {"choices":[{"index":0,"delta":{"content":"half"}},{"index":1}]}\n\n',
            ': keep-alive\n\n',
            'data:{"choices":[{"index":0,"delta":{"content":"nospace"}}]}\n\n',
            'data: {not json}\n\n',
            'event: ping\n\n',
            content('two'),
            DONE,
        ],
    },
    { name: 'j: no final LF and no [DONE]', parts: [content('one'), content('two'), 'data: {"choices":[{"index":0,"delta":{"content":"three"}}]}'] },
    { name: 'j2: a complete tail JSON with no LF, then more', parts: [content('one'), 'data: {"choices":[{"index":0,"delta":{"content":"tail"}}]}', '\n\n', content('after')] },
    { name: 'j3: a tail [DONE] with no LF', parts: [content('one'), 'data: [DONE]'] },
    { name: 'j4: a deepseek tail [DONE] with no LF and no content', parts: ['data: [DONE]'], flags: { deepseek: true } },
    {
        name: 'k: data lines after [DONE] in the same read and in later reads',
        parts: [content('a'), DONE + content('b') + toolStart, content('c'), toolArgs('{}'), DONE, content('d')],
    },
    {
        name: "k': deepseek, a reasoning event after [DONE] in the same read",
        parts: [content('<think>t</think>b'), DONE + reasoning('r'), '', content('c')],
        flags: { deepseek: true },
    },
    { name: 'l: CRLF throughout', parts: [crlf(roleEvent), crlf(content('crlf one')), crlf(content(' two')), crlf(DONE)] },
    { name: 'l-deepseek: CRLF throughout with the deepseek flag', parts: [crlf(content('<think>a</think>x')), crlf(content('y')), crlf(DONE)], flags: { deepseek: true } },
    { name: "l': a content event after a CRLF [DONE]", parts: [crlf(content('crlf one')), crlf(DONE), crlf(content('after'))] },
    { name: 'm: a leading BOM', parts: [bytes('﻿', content('bom one')), content('two'), DONE] },
    { name: 'm2: invalid UTF-8 bytes inside content', parts: [bytes('data: {"choices":[{"index":0,"delta":{"content":"bad ', new Uint8Array([0xE2, 0x82]), 'A ok"}}]}\n\n'), content('next'), DONE] },
    { name: 'n: empty reads between events', parts: ['', content('one'), '', '', content('two'), '', DONE, ''] },
    { name: 'n2: only empty reads', parts: ['', ''] },
    { name: 'n3: no data lines at all', parts: [': comment\n\n', 'retry: 1000\n\n'], flags: { deepseek: true } },
    { name: 'o: a stream that ends mid-line', parts: [content('one'), 'data: {"choices":[{"inde'] },
]

function cutAt(body: Uint8Array, points: number[]): Uint8Array[] {
    const unique = Array.from(new Set(points.filter((p) => p > 0 && p < body.length))).sort((x, y) => x - y)
    const out: Uint8Array[] = []
    let from = 0
    for (const point of unique) { out.push(body.slice(from, point)); from = point }
    out.push(body.slice(from))
    return out
}

function seeded(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 4294967296
    }
}

function randomChunks(body: Uint8Array, seed: number, withEmpty: boolean): Uint8Array[] {
    const next = seeded(seed)
    const out: Uint8Array[] = []
    let at = 0
    while (at < body.length) {
        if (withEmpty && next() < 0.2) { out.push(new Uint8Array(0)) }
        const size = 1 + Math.floor(next() * 48)
        out.push(body.slice(at, at + size))
        at += size
    }
    return out
}

function chunkings(parts: Part[]): [string, Uint8Array[]][] {
    const natural = parts.map((part) => bytes(part))
    const body = bytes(...parts)
    const afterLF: number[] = []
    const afterBlank: number[] = []
    const afterBrace: number[] = []
    const insidePrefix: number[] = []
    const insideCharacter: number[] = []
    const prefix = encoder.encode('data: ')
    for (let i = 0; i < body.length; i++) {
        if (body[i] === 0x0A) { afterLF.push(i + 1); if (i > 0 && body[i - 1] === 0x0A) { afterBlank.push(i + 1) } }
        if (body[i] === 0x7D && (body[i + 1] === 0x0A || body[i + 1] === 0x0D)) { afterBrace.push(i + 1) }
        if (prefix.every((b, k) => body[i + k] === b)) { insidePrefix.push(i + 3) }
        if ((body[i] & 0xC0) === 0x80) { insideCharacter.push(i) }
    }
    return [
        ['natural', natural],
        ['whole', [body]],
        ['one event per read', cutAt(body, afterBlank)],
        ['one line per read', cutAt(body, afterLF)],
        ['cut after the closing brace', cutAt(body, afterBrace)],
        ['cut inside the data: prefix', cutAt(body, insidePrefix)],
        ['cut inside every multibyte character', cutAt(body, insideCharacter)],
        ['one byte per read', cutAt(body, Array.from({ length: body.length }, (_v, i) => i))],
        ...[11, 22, 33, 44, 55].map((seed): [string, Uint8Array[]] => [`random ${seed}`, randomChunks(body, seed, false)]),
        ...[66, 77].map((seed): [string, Uint8Array[]] => [`random with empty reads ${seed}`, randomChunks(body, seed, true)]),
    ]
}

function makeArg(flags: Flags = {}): RequestDataArgumentExtended {
    return {
        modelInfo: { flags: flags.deepseek ? [LLMFlags.hasStreaming, LLMFlags.deepSeekThinkingOutput] : [LLMFlags.hasStreaming] },
        multiGen: flags.multiGen,
        extractJson: flags.extractJson ? 'text' : undefined,
    } as unknown as RequestDataArgumentExtended
}

type Factory = (arg: RequestDataArgumentExtended) => TransformStream<Uint8Array, StreamResponseChunk>

async function drive(factory: Factory, flags: Flags, chunks: Uint8Array[], abortAfter: number | null = null): Promise<Emissions> {
    return driveStream(factory(makeArg(flags)), chunks, abortAfter, (received) => {
        received['0'] = 'MUTATED'
        received['__alias'] = 'MUTATED'
    })
}

async function driveStream(
    stream: TransformStream<Uint8Array, StreamResponseChunk>,
    chunks: Uint8Array[],
    abortAfter: number | null,
    mutate: (received: Record<string, string>) => void
): Promise<Emissions> {
    const writer = stream.writable.getWriter()
    const reader = stream.readable.getReader()
    const emissions: [string, string][][] = []
    const collected = (async (): Promise<string | null> => {
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) { return null }
                const received = value as Record<string, string>
                emissions.push(Object.entries(received))
                mutate(received)
            }
        } catch (error) {
            return error instanceof Error ? error.message : String(error)
        }
    })()
    try {
        for (let i = 0; i < chunks.length; i++) {
            if (abortAfter !== null && i === abortAfter) {
                await writer.abort(new Error('aborted by test'))
                break
            }
            await writer.write(chunks[i])
        }
        if (abortAfter === null || abortAfter >= chunks.length) {
            await writer.close()
        }
    } catch (error) {
        // A write after the readable errored rejects; the collector reports the error.
    }
    const error = await collected
    return { emissions, error }
}

async function withBuffer<T>(impl: typeof globalThis.Buffer, run: () => Promise<T>): Promise<T> {
    const original = globalThis.Buffer
    globalThis.Buffer = impl
    try {
        return await run()
    } finally {
        globalThis.Buffer = original
    }
}

const implementations: [string, typeof globalThis.Buffer][] = [
    ['global Buffer', globalThis.Buffer],
    ['npm buffer', NpmBuffer as unknown as typeof globalThis.Buffer],
]

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    Object.assign(h.db, { jsonSchemaEnabled: true })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.mocked(saveInlayedSignature).mockReset()
    vi.mocked(saveInlayedSignature).mockImplementation(async () => '')
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('OpenAI-format stream transform against the frozen reference', () => {
    test.each(corpus.map((c) => [c.name, c] as const))('guard: %s', async (_name, item) => {
        for (const [implName, impl] of implementations) {
            for (const [chunkName, chunks] of chunkings(item.parts)) {
                const flags = item.flags ?? {}
                const expected = await withBuffer(impl, () => drive(frozenOpenAIGetTranStream, flags, chunks))
                const actual = await withBuffer(impl, () => drive(__testOpenAIChatStream.getTranStream, flags, chunks))
                expect(actual, `${implName}, ${chunkName}`).toEqual(expected)
            }
        }
    })

    test('guard: a write abort errors the readable the same way after the same emissions', async () => {
        const parts = [roleEvent, content('one'), content('two'), content('three'), DONE]
        const natural = chunkings(parts)[0][1]
        for (let abortAfter = 0; abortAfter < natural.length; abortAfter++) {
            const expected = await drive(frozenOpenAIGetTranStream, {}, natural, abortAfter)
            const actual = await drive(__testOpenAIChatStream.getTranStream, {}, natural, abortAfter)
            expect(actual, `abort after ${abortAfter}`).toEqual(expected)
        }
    })

    test('guard: the Gate 1 scenario emits the thoughts block, then an empty object', async () => {
        const chunks = [encoder.encode('data: [DONE]\n'), encoder.encode(reasoning('x')), new Uint8Array(0)]
        const expected = await drive(frozenOpenAIGetTranStream, { deepseek: true }, chunks)
        const actual = await drive(__testOpenAIChatStream.getTranStream, { deepseek: true }, chunks)
        expect(expected.emissions).toEqual([[['0', '<Thoughts>\nx\n</Thoughts>\n']], []])
        expect(actual).toEqual(expected)
    })
})

/**
 * The Gemini stream transform must emit what the frozen pre-rewrite copy emits for every corpus case and
 * chunking: `[DONE]` and a malformed complete line end all emission, an unfinished last line never changes
 * what later reads see, and a character or line split across reads is joined. The consumer mutates every
 * received object the way `wrapToolStream` does (`initStreamState`, then a write to key 0).
 * With signature saving on, ids are random: the text is compared once ids are normalized, the sets of
 * distinct saved signatures are equal, and every id an emission references was saved.
 * Mocked: the signature store.
 */
const GEMINI_MODEL = { id: 'gemini-2.5-flash', name: 'gemini', internalID: 'gemini-2.5-flash', format: LLMFormat.GoogleCloud, flags: [LLMFlags.hasStreaming] } as unknown as LLMModel

function gEvent(parts: Record<string, unknown>[], extra: Record<string, unknown> = {}): string {
    return 'data: ' + JSON.stringify({
        candidates: [{ content: { parts, role: 'model' }, index: 0 }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 },
        modelVersion: 'gemini-2.5-flash',
        ...extra,
    }) + '\n\n'
}
const gText = (text: string, extra: Record<string, unknown> = {}) => ({ text, ...extra })
const gThought = (text: string, extra: Record<string, unknown> = {}) => ({ text, thought: true, ...extra })
const gCall = (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ functionCall: { name, args }, ...extra })
const GDONE = 'data: [DONE]\n\n'

const geminiCorpus: Corpus[] = [
    { name: 'a: Korean and emoji text', parts: [gEvent([gText('안녕')]), gEvent([gText('하세요 😀')]), gEvent([gText(' 가나다')]), gEvent([], { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 9, totalTokenCount: 14 } })] },
    { name: 'b: thought parts, then the answer', parts: [gEvent([gThought('plan ')]), gEvent([gThought('more')]), gEvent([gText('answer ')]), gEvent([gText('done')])] },
    { name: 'b2: signed text parts and a signed thought', parts: [gEvent([gThought('t', { thoughtSignature: 'sig-t' })]), gEvent([gText('one ', { thoughtSignature: 'sig-1' })]), gEvent([gText('two ', { thoughtSignature: 'sig-2' }), gText('three')]), gEvent([gText('four', { thoughtSignature: 'sig-4' })])] },
    { name: 'c: function calls with and without a signature', parts: [gEvent([gText('checking ')]), gEvent([gCall('get_weather', { city: 'Seoul' })]), gEvent([gCall('get_time', { zone: 'KST' }, { thoughtSignature: 'sig-f' }), gCall('get_news', {})]), gEvent([gText('end')])] },
    { name: 'c2: a signed call before text in one event', parts: [gEvent([gCall('lookup', { q: '가' }, { thoughtSignature: 'sig-g' }), gText('after', { thoughtSignature: 'sig-h' })]), gEvent([gText(' tail')])] },
    { name: 'd: model status, no candidates, empty text part', parts: [gEvent([gText('x')], { modelStatus: { modelStage: 'STABLE' } }), gEvent([], { candidates: undefined }), gEvent([gText('')]), gEvent([gText('y')])] },
    { name: 'e: CRLF throughout', parts: [crlf(gEvent([gText('crlf one ')])), crlf(gEvent([gText('two', { thoughtSignature: 'sig-c' })])), crlf(gEvent([gCall('f', { a: 1 })]))] },
    { name: 'f: a malformed complete line, then more events', parts: [gEvent([gText('before')]), 'data: {not json}\n\n', gEvent([gText('after')]), gEvent([gText('later')])] },
    { name: "g: [DONE] then more events", parts: [gEvent([gText('a', { thoughtSignature: 'sig-a' })]), GDONE, gEvent([gText('b', { thoughtSignature: 'sig-b' })]), gEvent([gText('c')])] },
    { name: "g2: a CRLF [DONE] then more events", parts: [crlf(gEvent([gText('a')])), crlf(GDONE), crlf(gEvent([gText('b')]))] },
    { name: "g3: [DONE] and an event in the same read", parts: [gEvent([gText('a')]) + GDONE + gEvent([gText('b')]), gEvent([gText('c')])] },
    { name: 'h: an unfinished last line with no final break', parts: [gEvent([gText('one ')]), gEvent([gText('two ', { thoughtSignature: 'sig-2' })]), gEvent([gText('three')]).trimEnd()] },
    { name: 'h2: a complete tail JSON with no break, then more', parts: [gEvent([gText('one ')]), gEvent([gText('tail ', { thoughtSignature: 'sig-t' })]).trimEnd(), '\n\n', gEvent([gText('after')])] },
    { name: 'h3: a tail [DONE] with no break', parts: [gEvent([gText('one')]), 'data: [DONE]'] },
    { name: 'h4: a stream that ends mid-line', parts: [gEvent([gText('one')]), 'data: {"candidates":[{"conte'] },
    { name: 'i: keep-alive, event line, no-space data and unrelated lines', parts: [gEvent([gText('one')]), ': keep-alive\n\n', 'event: ping\n\n', 'data:{"candidates":[]}\n\n', 'retry: 1000\n\n', gEvent([gText('two')])] },
    { name: 'j: empty reads between events', parts: ['', gEvent([gText('one')]), '', '', gEvent([gText('two', { thoughtSignature: 'sig-2' })]), '', gEvent([gText('three')]), ''] },
    { name: 'j2: only empty reads', parts: ['', ''] },
    { name: 'k: an event split over two lines of the body', parts: ['data: {"candidates":[{"content":{"parts":[{"text":"split"}],\n"role":"model"},"index":0}]}\n\n', gEvent([gText('next')])] },
]

function normalizeIds(emissions: [string, string][][]): [string, string][][] {
    return emissions.map((entries) => entries.map(([key, value]): [string, string] => [key, value.replace(/\{\{inlayeddata::[0-9a-f-]{36}\}\}/g, '{{inlayeddata::ID}}')]))
}

function referencedFrom(emissions: [string, string][][]): string[] {
    return emissions.flatMap((entries) => entries.flatMap(([, value]) => Array.from(value.matchAll(/\{\{inlayeddata::([^}]+)\}\}/g), (match) => match[1])))
}

function makeGemini(factory: typeof __testGeminiStream.getTranStream | typeof frozenGeminiGetTranStream, saveSignature: boolean) {
    return factory({ modelInfo: GEMINI_MODEL, saveSignature })
}

function driveGemini(factory: typeof __testGeminiStream.getTranStream | typeof frozenGeminiGetTranStream, saveSignature: boolean, chunks: Uint8Array[], abortAfter: number | null = null): Promise<Emissions> {
    return driveStream(makeGemini(factory, saveSignature), chunks, abortAfter, (received) => {
        frozenInitStreamState(received)
        received['0'] = 'MUTATED'
        received['__alias'] = 'MUTATED'
    })
}

const savedSignatures = () => new Set(vi.mocked(saveInlayedSignature).mock.calls.map((call) => JSON.stringify(call[1])))

describe('Gemini stream transform against the frozen reference', () => {
    test.each(geminiCorpus.map((c) => [c.name, c] as const))('guard: %s without signature saving', async (_name, item) => {
        for (const [chunkName, chunks] of chunkings(item.parts)) {
            const expected = await driveGemini(frozenGeminiGetTranStream, false, chunks)
            const actual = await driveGemini(__testGeminiStream.getTranStream, false, chunks)
            expect(actual, chunkName).toEqual(expected)
        }
    })

    test.each(geminiCorpus.map((c) => [c.name, c] as const))('guard: %s with signature saving', async (_name, item) => {
        for (const [chunkName, chunks] of chunkings(item.parts)) {
            vi.mocked(saveInlayedSignature).mockClear()
            const expected = await driveGemini(frozenGeminiGetTranStream, true, chunks)
            const expectedSaved = savedSignatures()
            vi.mocked(saveInlayedSignature).mockClear()
            const actual = await driveGemini(__testGeminiStream.getTranStream, true, chunks)
            const actualCalls = vi.mocked(saveInlayedSignature).mock.calls.map((call) => call[0])
            const actualSaved = savedSignatures()

            expect({ ...actual, emissions: normalizeIds(actual.emissions) }, chunkName).toEqual({ ...expected, emissions: normalizeIds(expected.emissions) })
            expect(actualSaved, chunkName).toEqual(expectedSaved)
            const saved = new Set(actualCalls)
            expect(referencedFrom(actual.emissions).every((id) => saved.has(id)), `${chunkName}: every referenced id was saved`).toBe(true)
        }
    })

    test('guard: a write abort errors the readable the same way after the same emissions', async () => {
        const parts = [gEvent([gText('one')]), gEvent([gText('two')]), gEvent([gText('three')])]
        const natural = chunkings(parts)[0][1]
        for (let abortAfter = 0; abortAfter < natural.length; abortAfter++) {
            const expected = await driveGemini(frozenGeminiGetTranStream, false, natural, abortAfter)
            const actual = await driveGemini(__testGeminiStream.getTranStream, false, natural, abortAfter)
            expect(actual, `abort after ${abortAfter}`).toEqual(expected)
        }
    })
})
