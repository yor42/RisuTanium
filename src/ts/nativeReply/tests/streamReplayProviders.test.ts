import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

// The readers must not read the database; `getDatabase` answers the test's own object so T8 can switch the schema on. The
// real `extractJSON` is used, so the stores its parser imports are replaced to keep the module graph inert.
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db, setDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))

vi.mock('../../process/files/inlays', () => ({ saveInlayedSignature: vi.fn(async () => '') }))

import { createRunSubject } from '../../process/chatOrigin'
import { saveInlayedSignature } from '../../process/files/inlays'
import { createUsageMeter } from '../../usage/usageMeter'
import { LLMFormat } from '../../model/types'
import type { UsageMeterState } from '../../usage/usageTypes'
import type { ReplyBlobBase, StreamReplyBlob } from '../blob'
import { replayAnthropicStream, replayGeminiStream, replayResponsesStream, replayStreamRecord } from '../streamReplay'

/**
 * Replay readers of the Responses and Anthropic stream kinds and the one kind dispatcher. The bodies are synthetic and use
 * each provider's wire format (`event:` and `data:` lines). T36: each kind's bytes reach their own reader. T10: an
 * in-band error marks the meter failed and an overload error never refetches. T8: the rule is the only input of the
 * Responses read. A1/A4: an error event is the reply text.
 */

const encoder = new TextEncoder()
const bytesOf = (body: string) => encoder.encode(body)

const base: ReplyBlobBase = {
    target: { chaId: 'cha', chatId: 'chat' }, targetName: 'Alice', saying: 'cha',
    generationInfo: { generationId: 'g1' }, promptInfo: {}, escape: false, requestedMs: 1,
}
const usage = { modelKey: 'gpt-4o', inputEstimate: 120 }
const subject = createRunSubject({ chaId: 'cha', chatId: 'chat' })

const GEMINI_PARSE = {
    kind: 'gemini-stream' as const, extractJson: null, jsonSchema: false, streamThoughts: false, saveSignatures: false,
    signatureSource: 'gemini-x', signatureFormat: LLMFormat.GoogleCloud,
}

const BLOBS: Record<'openai-chat-stream' | 'openai-responses-stream' | 'anthropic-stream' | 'gemini-stream', StreamReplyBlob> = {
    'openai-chat-stream': { ...base, usage, parse: { kind: 'openai-chat-stream', deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false } },
    'openai-responses-stream': { ...base, usage, parse: { kind: 'openai-responses-stream', extractJson: null, jsonSchema: false } },
    'anthropic-stream': { ...base, usage, parse: { kind: 'anthropic-stream' } },
    'gemini-stream': { ...base, usage, parse: GEMINI_PARSE },
}

const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
const BODIES: Record<keyof typeof BLOBS, { body: string, text: string }> = {
    'openai-chat-stream': { body: 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'oa' } }] }) + '\n\n', text: 'oa' },
    'openai-responses-stream': { body: ev('response.output_text.delta', { type: 'response.output_text.delta', delta: 'rs' }), text: 'rs' },
    'anthropic-stream': { body: ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'an' } }), text: 'an' },
    'gemini-stream': { body: 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gm' }] } }] }) + '\n\n', text: 'gm' },
}
const KINDS = Object.keys(BLOBS) as (keyof typeof BLOBS)[]

beforeEach(() => {
    for (const key of Object.keys(h.db)) { delete h.db[key] }
    vi.mocked(saveInlayedSignature).mockClear()
})

describe('T36: the dispatcher sends each kind to its own reader', () => {
    test.each(KINDS)('%s turns its own body into its text and returns no signatures', async (kind) => {
        const result = await replayStreamRecord(BLOBS[kind], bytesOf(BODIES[kind].body), true, subject, createUsageMeter())
        expect(result.modelText).toBe(BODIES[kind].text)
        expect(result.signatures).toEqual([])
    })

    test('a body replayed under each of the other kinds gives no text, so a misroute fails', async () => {
        for (const kind of KINDS) {
            for (const other of KINDS) {
                if (other === kind) {
                    continue
                }
                const result = await replayStreamRecord(BLOBS[other], bytesOf(BODIES[kind].body), true, subject, createUsageMeter())
                expect(result.modelText).toBe('')
            }
        }
    })
})

describe('Responses replay', () => {
    const rule = { extractJson: null, jsonSchema: false }

    test('the last emission is the text, and the usage of response.completed is reported once', async () => {
        const meter = createUsageMeter()
        const body = ev('response.output_text.delta', { type: 'response.output_text.delta', delta: 'Hel' })
            + ev('response.output_text.delta', { type: 'response.output_text.delta', delta: 'lo' })
            + ev('response.completed', { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }], usage: { input_tokens: 7, output_tokens: 9, total_tokens: 16 } } })
            + 'data: [DONE]\n\n'
        const { modelText } = await replayResponsesStream({ bytes: bytesOf(body), complete: true, rule, subject }, meter)
        expect(modelText).toBe('Hello')
        expect(meter.reported()).not.toBeNull()
    })

    test('A4 (Q4 a): a response.failed event makes the error JSON the text, as the live page shows it', async () => {
        const body = ev('response.output_text.delta', { type: 'response.output_text.delta', delta: 'partial' })
            + ev('response.failed', { type: 'response.failed', error: { code: 'server_error', message: 'boom' } })
        const { modelText } = await replayResponsesStream({ bytes: bytesOf(body), complete: true, rule, subject }, createUsageMeter())
        expect(modelText).toBe(JSON.stringify({ code: 'server_error', message: 'boom' }))
    })

    test('a body that ends in the middle of an event keeps the text of the complete events', async () => {
        const body = ev('response.output_text.delta', { type: 'response.output_text.delta', delta: 'kept' })
            + 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo'
        const { modelText } = await replayResponsesStream({ bytes: bytesOf(body), complete: false, rule, subject }, createUsageMeter())
        expect(modelText).toBe('kept')
    })

    test('T8: the rule is the only input; the database schema switch does not extract', async () => {
        h.db.jsonSchemaEnabled = true
        const body = ev('response.output_text.delta', { type: 'response.output_text.delta', delta: '{"x":"inner"}' })
        const { modelText } = await replayResponsesStream({ bytes: bytesOf(body), complete: true, rule: { extractJson: '$.x', jsonSchema: false }, subject }, createUsageMeter())
        expect(modelText).toBe('{"x":"inner"}')
    })
})

describe('Anthropic replay', () => {
    const start = ev('message_start', { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 1 } } })
    const delta = (text: string) => ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    const thinking = (text: string) => ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: text } })
    const end = ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })

    test('text and usage: the usage is reported once and the meter is not failed', async () => {
        const meter = createUsageMeter()
        const { modelText } = await replayAnthropicStream({ bytes: bytesOf(start + delta('Hi ') + delta('there') + end), complete: true }, meter)
        expect(modelText).toBe('Hi there')
        expect(meter.reported()).not.toBeNull()
        expect(meter.failed()).toBe(false)
    })

    test('A3 (MC-3557): text then an error event applies the text and the error, and marks the meter failed with no usage', async () => {
        const meter = createUsageMeter()
        const body = start + delta('abc') + ev('error', { type: 'error', error: { type: 'api_error', message: 'Bad thing' } })
        const { modelText } = await replayAnthropicStream({ bytes: bytesOf(body), complete: true }, meter)
        expect(modelText).toBe('abcError:Bad thing')
        expect(meter.failed()).toBe(true)
        expect(meter.reported()).toBeNull()
    })

    test('T10 (Q5 a): an overload error reads as an ordinary in-band error; the replay never fetches or waits', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch')
        const meter = createUsageMeter()
        const body = start + delta('abc') + ev('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
        const { modelText } = await replayAnthropicStream({ bytes: bytesOf(body), complete: true }, meter)
        expect(modelText).toBe('abcError:Overloaded')
        expect(meter.failed()).toBe(true)
        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
    })

    test('an open thinking block is closed for a prefix too, and an unterminated last line is dropped', async () => {
        const body = thinking('t1') + thinking('t2') + 'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"cut'
        const { modelText } = await replayAnthropicStream({ bytes: bytesOf(body), complete: false }, createUsageMeter())
        expect(modelText).toBe('<Thoughts>\nt1t2</Thoughts>\n\n')
    })

    test('usage reaches the meter through the injected report only', async () => {
        const reports: unknown[] = []
        const meter: UsageMeterState = { report: (u) => { reports.push(u) }, markFailed: () => {}, reported: () => null, failed: () => false }
        await replayAnthropicStream({ bytes: bytesOf(start + delta('x') + end), complete: true }, meter)
        expect(reports).toHaveLength(1)
    })
})

describe('Gemini replay', () => {
    const rule = { extractJson: null, jsonSchema: false, streamThoughts: false, saveSignatures: false, signatureSource: 'gemini-x', signatureFormat: LLMFormat.GoogleCloud }
    const line = (parts: unknown[], extra: Record<string, unknown> = {}) => 'data: ' + JSON.stringify({ candidates: [{ content: { parts } }], ...extra }) + '\n\n'
    const text = (value: string) => line([{ text: value }])

    test('T13 (a): a body cut mid-line keeps the text of the complete lines', async () => {
        const body = text('one ') + text('two ') + 'data: {"candidates":[{"content":{"parts":[{"text":"thr'
        const { modelText } = await replayGeminiStream({ bytes: bytesOf(body), complete: false, rule, subject }, createUsageMeter())
        expect(modelText).toBe('one two ')
    })

    test('T13 (b): text lines before a [DONE] line are kept and the lines after it are not read', async () => {
        const body = text('one ') + text('two ') + 'data: [DONE]\n' + text('three')
        const { modelText } = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule, subject }, createUsageMeter())
        expect(modelText).toBe('one two ')
    })

    test('T13 (c): text lines before a malformed complete line are kept and the lines after it are not read', async () => {
        const body = text('one ') + text('two ') + 'data: {not json}\n' + text('three')
        const { modelText } = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule, subject }, createUsageMeter())
        expect(modelText).toBe('one two ')
    })

    test('a body with no text gives an empty text, and the usage of the committed lines is reported once', async () => {
        const meter = createUsageMeter()
        const body = line([], { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 } })
        const { modelText, signatures } = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule, subject }, meter)
        expect(modelText).toBe('')
        expect(signatures).toEqual([])
        expect(meter.reported()).not.toBeNull()
    })

    test('T14: signatures are collected for the tokens in the text, never written, with the rule and the part as content', async () => {
        const body = line([{ text: 'hi', thoughtSignature: 'S1' }]) + line([{ text: ' there', thoughtSignature: 'S2' }])
        const { modelText, signatures } = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule: { ...rule, saveSignatures: true }, subject }, createUsageMeter())
        expect(signatures).toHaveLength(2)
        expect(signatures.map((record) => record.signature.signatures[0].content)).toEqual(['hi', ' there'])
        for (const record of signatures) {
            expect(record.signature.source).toBe('gemini-x')
            expect(record.signature.sourceFormat).toBe(LLMFormat.GoogleCloud)
            expect(modelText).toContain('{{inlayeddata::' + record.id + '}}')
        }
        expect(saveInlayedSignature).not.toHaveBeenCalled()
    })

    test('T14: with saveSignatures off no token and no record exist', async () => {
        const { modelText, signatures } = await replayGeminiStream({ bytes: bytesOf(line([{ text: 'hi', thoughtSignature: 'S1' }])), complete: true, rule, subject }, createUsageMeter())
        expect(modelText).toBe('hi')
        expect(signatures).toEqual([])
    })

    test('T14: a signature whose token the JSON extraction removes from the text is dropped', async () => {
        const body = line([{ text: '{"b":"x', thoughtSignature: 'S1' }, { text: '","a":"v"}' }])
        const extracting = { ...rule, saveSignatures: true, extractJson: 'a', jsonSchema: true }
        const kept = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule: { ...extracting, extractJson: null }, subject }, createUsageMeter())
        expect(kept.signatures).toHaveLength(1)
        const { modelText, signatures } = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule: extracting, subject }, createUsageMeter())
        expect(modelText).toBe('v')
        expect(signatures).toEqual([])
    })
    test('the thought display follows the rule: streamThoughts off folds the last thought into the block, on keeps it apart', async () => {
        const body = text('a') + line([{ text: 'tt', thought: true }])
        const off = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule, subject }, createUsageMeter())
        const on = await replayGeminiStream({ bytes: bytesOf(body), complete: true, rule: { ...rule, streamThoughts: true }, subject }, createUsageMeter())
        expect(off.modelText).toBe('<Thoughts>\n\ntt\n\n</Thoughts>\n\na')
        expect(on.modelText).toBe('tt\n\na')
    })
})