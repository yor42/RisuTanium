import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

// The transform must not read the database; `getDatabase` answers the test's own object so T9 can switch the schema on.
// The real `extractJSON` is used, so the stores its parser imports are replaced to keep the module graph inert.
vi.mock('../../storage/database.svelte', () => ({ getDatabase: () => h.db, setDatabase: vi.fn() }))
vi.mock('../../stores.svelte', () => ({
    get DBState() { return { db: h.db } },
    CharEmotion: writable({}), selectedCharID: writable(-1), selIdState: { selId: 0 },
    CurrentTriggerIdStore: writable(null), ReloadChatPointer: writable({}), ReloadGUIPointer: writable(0),
    HideIconStore: writable(false), moduleBackgroundEmbedding: writable(''),
    bodyIntercepterStore: writable(null),
}))

import { replayOpenAIChatStream } from '../streamReplay'
import { openAIChatStreamTransform } from '../../process/request/openAI/chatStreamTransform'
import type { OpenAIChatReadRule } from '../../process/request/openAI/chatBodyParse'
import type { StreamResponseChunk } from '../../process/request/request'
import { createUsageMeter } from '../../usage/usageMeter'
import { parseOpenAIChatUsage } from '../../usage/usageParse'

/**
 * T7 (property, C2): the final text of the stream transform does not depend on how the body is cut into reads, and the
 * replay of the whole body in one read gives that text. T8 (usage once), T9 (the rule is the only input), T10 (a body
 * with no stream text gives the empty text). The bodies are synthetic SSE in the wire format of a chat completion stream.
 * The live consumer of the same transform is covered by the frozen equivalence suites, which stay unchanged.
 */

const encoder = new TextEncoder()
const MODEL = 'gpt-4o-mini'

const rule = (extra: Partial<OpenAIChatReadRule> = {}): OpenAIChatReadRule => ({
    deepSeekThinkingOutput: false, extractJson: null, jsonSchema: false, multiGen: false, ...extra,
})

function chunkEvent(delta: Record<string, unknown> | null, index = 0, extra: Record<string, unknown> = {}): string {
    const choices = delta === null ? [] : [{ index, delta, finish_reason: null }]
    return 'data: ' + JSON.stringify({ id: 'chatcmpl-abc123', object: 'chat.completion.chunk', created: 1731000000, model: MODEL, choices, ...extra }) + '\n\n'
}
const content = (text: string, index = 0) => chunkEvent({ content: text }, index)
const reasoning = (text: string, field: 'reasoning_content' | 'reasoning' = 'reasoning_content') => chunkEvent({ [field]: text })
const DONE = 'data: [DONE]\n\n'
const USAGE = { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
const usageEvent = chunkEvent(null, 0, { usage: USAGE })
const nullUsageEvent = chunkEvent(null, 0, { usage: null })
const toolStart = chunkEvent({ tool_calls: [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'get_weather', arguments: '' } }] })

interface Row {
    name: string
    body: string
    rule: OpenAIChatReadRule
    expected: string
}

const rows: Row[] = [
    { name: 'plain', body: content('Hello, ') + content('world.') + DONE, rule: rule(), expected: 'Hello, world.' },
    {
        name: 'deepSeek </think> in content',
        body: content('<think>plan') + content(' it</think>') + content('final') + DONE,
        rule: rule({ deepSeekThinkingOutput: true }),
        expected: '<Thoughts>\nplan it\n</Thoughts>\nfinal',
    },
    {
        name: 'reasoning_content deltas',
        body: reasoning('think ') + content('answer') + DONE,
        rule: rule(),
        expected: '<Thoughts>\nthink \n</Thoughts>\nanswer',
    },
    {
        name: 'OpenRouter reasoning deltas',
        body: reasoning('why', 'reasoning') + content('because') + DONE,
        rule: rule(),
        expected: '<Thoughts>\nwhy\n</Thoughts>\nbecause',
    },
    {
        name: 'multiGen indices 0 and 1',
        body: content('a0', 0) + content('b1', 1) + content('c0', 0) + content('d1', 1) + DONE,
        rule: rule({ multiGen: true }),
        expected: 'a0c0',
    },
    {
        name: 'extractJson with jsonSchema on',
        body: content('{"text":') + content('"hello"}') + DONE,
        rule: rule({ extractJson: 'text', jsonSchema: true }),
        expected: 'hello',
    },
    {
        name: 'extractJson with jsonSchema off',
        body: content('{"text":') + content('"hello"}') + DONE,
        rule: rule({ extractJson: 'text', jsonSchema: false }),
        expected: '{"text":"hello"}',
    },
    { name: 'usage chunk then usage null', body: content('Hi') + usageEvent + nullUsageEvent + DONE, rule: rule(), expected: 'Hi' },
    { name: 'error chunk after text', body: content('partial text') + 'data: {"error":{"message":"overloaded"}}\n\n' + DONE, rule: rule(), expected: 'partial text' },
    { name: 'tool_calls delta only', body: toolStart + DONE, rule: rule(), expected: '' },
    { name: 'Korean and emoji text', body: content('안녕') + content('하세요 😀') + content(' 가나다') + DONE, rule: rule(), expected: '안녕하세요 😀 가나다' },
    { name: '[DONE] then trailing bytes', body: content('kept') + DONE + content('dropped') + 'tail', rule: rule(), expected: 'kept' },
    { name: 'no [DONE], ends mid-line (partial body)', body: content('one') + content('two') + 'data: {"choices":[{"index":0,"delta":{"conte', rule: rule(), expected: 'onetwo' },
    { name: 'no [DONE], last line complete without a line feed', body: content('one') + content('two').trimEnd(), rule: rule(), expected: 'onetwo' },
    { name: 'deepSeek flag set, [DONE] before any content', body: DONE, rule: rule({ deepSeekThinkingOutput: true }), expected: '' },
]

/** Feeds `parts` to the transform as separate reads while draining its readable, and returns the last emission. */
async function runParts(r: OpenAIChatReadRule, parts: Uint8Array[]): Promise<{ text: string, usage: number }> {
    let usage = 0
    const transform = openAIChatStreamTransform(r, { onUsage: () => { usage += 1 } })
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const part of parts) {
                controller.enqueue(part)
            }
            controller.close()
        },
    })
    const piping = source.pipeTo(transform.writable)
    const reader = transform.readable.getReader()
    let last: StreamResponseChunk | undefined
    for (;;) {
        const read = await reader.read()
        if (read.done) {
            break
        }
        if (read.value) {
            last = read.value
        }
    }
    await piping
    return { text: last?.['0'] || '', usage }
}

function cutAt(bytes: Uint8Array, points: number[]): Uint8Array[] {
    const sorted = [...new Set(points)].filter((p) => p > 0 && p < bytes.length).sort((a, b) => a - b)
    const out: Uint8Array[] = []
    let from = 0
    for (const point of sorted) {
        out.push(bytes.subarray(from, point))
        from = point
    }
    out.push(bytes.subarray(from))
    return out
}

function seeded(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
    }
}

function partitionsOf(bytes: Uint8Array, body: string): Uint8Array[][] {
    const all: Uint8Array[][] = [[bytes]]
    all.push(cutAt(bytes, Array.from({ length: bytes.length - 1 }, (_, i) => i + 1)))
    const random = seeded(7)
    for (let i = 0; i < 200; i++) {
        const count = 1 + Math.floor(random() * 8)
        all.push(cutAt(bytes, Array.from({ length: count }, () => Math.floor(random() * bytes.length))))
    }
    const dataAt = body.indexOf('data: ')
    if (dataAt >= 0) {
        all.push(cutAt(bytes, [encoder.encode(body.slice(0, dataAt)).length + 3]))
    }
    const lf = body.indexOf('\n')
    if (lf >= 0) {
        const lfByte = encoder.encode(body.slice(0, lf)).length
        all.push(cutAt(bytes, [lfByte]), cutAt(bytes, [lfByte + 1]))
    }
    for (const width of [3, 4]) {
        const ch = [...body].find((c) => encoder.encode(c).length === width)
        if (ch !== undefined) {
            const before = encoder.encode(body.slice(0, body.indexOf(ch))).length
            for (let inside = 1; inside < width; inside++) {
                all.push(cutAt(bytes, [before + inside]))
            }
        }
    }
    return all
}

beforeEach(() => {
    h.db = {}
})

describe('T7 chunk invariance', () => {
    for (const row of rows) {
        test(row.name, async () => {
            const bytes = encoder.encode(row.body)
            const partitions = partitionsOf(bytes, row.body)
            for (const parts of partitions) {
                expect((await runParts(row.rule, parts)).text).toBe(row.expected)
            }
            const replay = await replayOpenAIChatStream({ bytes, complete: true, rule: row.rule }, createUsageMeter())
            expect(replay.modelText).toBe(row.expected)
            const partial = await replayOpenAIChatStream({ bytes, complete: false, rule: row.rule }, createUsageMeter())
            expect(partial.modelText).toBe(row.expected)
        })
    }

    test('a cut inside a multi-byte character really occurs for the Korean and emoji row', () => {
        const row = rows.find((r) => r.name === 'Korean and emoji text')!
        const bytes = encoder.encode(row.body)
        const partitions = partitionsOf(bytes, row.body)
        const emojiAt = encoder.encode(row.body.slice(0, row.body.indexOf('😀'))).length
        const cuts = partitions.filter((parts) => parts.length === 2 && parts[0].length > emojiAt && parts[0].length < emojiAt + 4)
        expect(cuts.length).toBeGreaterThan(0)
    })
})

describe('T8 usage', () => {
    test('the parsed usage is reported once, and a later usage null does not erase it', async () => {
        const meter = createUsageMeter()
        const body = content('Hi') + usageEvent + nullUsageEvent + DONE
        await replayOpenAIChatStream({ bytes: encoder.encode(body), complete: true, rule: rule() }, meter)
        expect(meter.reported()).toEqual(parseOpenAIChatUsage(USAGE))
        expect(meter.reported()).not.toBeNull()
    })

    test('a stream without usage leaves the meter unreported', async () => {
        const meter = createUsageMeter()
        await replayOpenAIChatStream({ bytes: encoder.encode(content('Hi') + DONE), complete: true, rule: rule() }, meter)
        expect(meter.reported()).toBeNull()
    })

    test('every partition reports once', async () => {
        const bytes = encoder.encode(content('Hi') + usageEvent + DONE)
        for (const parts of [[bytes], cutAt(bytes, [5, 40, 90])]) {
            expect((await runParts(rule(), parts)).usage).toBe(1)
        }
    })
})

describe('T9 the rule is the only input', () => {
    test('a rule without the schema does not extract even when the database switches it on', async () => {
        h.db = { jsonSchemaEnabled: true, extractJson: 'text' }
        const bytes = encoder.encode(content('{"text":"hello"}') + DONE)
        const off = await replayOpenAIChatStream({ bytes, complete: true, rule: rule({ extractJson: 'text', jsonSchema: false }) }, createUsageMeter())
        expect(off.modelText).toBe('{"text":"hello"}')
        const on = await replayOpenAIChatStream({ bytes, complete: true, rule: rule({ extractJson: 'text', jsonSchema: true }) }, createUsageMeter())
        expect(on.modelText).toBe('hello')
    })
})

describe('T10 bodies without stream text', () => {
    test('a JSON body, an error-only SSE body and an empty body give the empty text', async () => {
        const json = JSON.stringify({ choices: [{ message: { content: 'not a stream' } }] })
        const errorOnly = 'data: {"error":{"message":"overloaded"}}\n\n' + DONE
        for (const body of [json, errorOnly, '']) {
            const replay = await replayOpenAIChatStream({ bytes: encoder.encode(body), complete: true, rule: rule() }, createUsageMeter())
            expect(replay.modelText).toBe('')
        }
    })
})
