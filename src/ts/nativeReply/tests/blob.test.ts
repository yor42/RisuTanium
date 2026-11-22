import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { decodeReplyBlob, encodeReplyBlob, encodeStreamReplyBlob, isStreamReplyBlob, type ReplyBlobBase, type ReplyUsageContext, type StreamParseContext } from '../blob'
import type { OpenAIParseContext, OpenAIStreamParseContext } from '../../process/request/openAI/chatBodyParse'
import type { ResponsesStreamParseContext } from '../../process/request/openAI/responsesStreamTransform'
import type { AnthropicStreamParseContext } from '../../process/request/anthropicStreamRead'

/**
 * T5 (guard, MC-329): the committed fixture is what the producer writes, byte for byte, for the input the send builds.
 * Set `WRITE_REPLY_BLOB_FIXTURE=1` to rewrite it from `encodeReplyBlob`; it is never edited by hand.
 * A new parse kind is additive under page version 1 (an older page lists it as unreadable); changing the fields of an
 * existing kind takes page version 2 with a migration tested against that kind's fixture; a kind marker lives only in
 * `parse.kind`. The stream kind has its own fixture, written by `encodeStreamReplyBlob` the same way.
 * T6 (guard): the decoder accepts the producer's output and refuses what it cannot read. Mutants M10, M11, M40.
 */

const FIXTURE = resolve(process.cwd(), 'src/ts/nativeReply/tests/fixtures/blob-v1.json')

// The shape `sendChatBody` builds: ids, names, the generation facts and the preset info the reply carries.
const base: ReplyBlobBase = {
    target: { chaId: 'cha-0001', chatId: 'chat-0001' },
    targetName: 'Alice',
    saying: 'cha-0001',
    generationInfo: {
        model: 'gpt-4o',
        generationId: '0b9c1a7e-0000-4000-8000-000000000001',
        inputTokens: 120,
        outputTokens: 300,
        maxContext: 4000,
        stageTiming: { stage1: 1, stage2: 2, stage3: 0, stage4: 0 },
    },
    promptInfo: { promptName: 'Main', promptToggles: [{ key: 'a', value: 'ON' }] },
    escape: false,
    requestedMs: 1700000000000,
}
const parse: OpenAIParseContext = { kind: 'openai-chat', deepSeekThinkingOutput: true, extractJson: '$.reply', jsonSchema: true, multiGen: false }

describe('blob v1 fixture', () => {
    test('the producer writes the committed fixture', () => {
        const produced = encodeReplyBlob(base, parse)
        if (process.env.WRITE_REPLY_BLOB_FIXTURE === '1') {
            writeFileSync(FIXTURE, produced)
        }
        expect(readFileSync(FIXTURE, 'utf8').replace(/\r/g, '')).toBe(produced)
    })

    test('the blob holds no URL, header, key or prompt body, even when the caller hands them in', () => {
        const request = {
            url: 'https://api.openai-compatible.invalid/v1/chat/completions?token=tok-9f31',
            headers: { Authorization: 'Bearer sk-live-4c7e1b9a02d3', 'x-api-key': 'key-77aa21' },
            body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'a private prompt body' }] }),
        }
        // Extra fields on the input must not reach the blob: only the fields the page version names are written.
        const carrying: ReplyBlobBase = { ...base, ...request } as ReplyBlobBase
        const produced = encodeReplyBlob(carrying, parse)
        const secrets = [
            request.url, 'api.openai-compatible.invalid', 'tok-9f31', 'sk-live-4c7e1b9a02d3', 'key-77aa21',
            'a private prompt body', request.body,
        ]
        for (const secret of secrets) {
            expect(produced).not.toContain(secret)
        }
        for (const forbidden of ['http', 'Authorization', 'Bearer', 'formated', 'candidateStartState']) {
            expect(produced).not.toContain(forbidden)
        }
        expect(produced).toBe(encodeReplyBlob(base, parse))
    })

    test('the committed fixture decodes to the producer input', () => {
        const decoded = decodeReplyBlob(readFileSync(FIXTURE, 'utf8'), 1)
        expect(decoded.ok).toBe(true)
        if (decoded.ok) {
            expect(decoded.blob).toEqual({ ...base, parse })
        }
    })
})

describe('blob decode rules', () => {
    const good = () => JSON.parse(encodeReplyBlob(base, parse)) as Record<string, unknown>

    test('another page version is unreadable', () => {
        const decoded = decodeReplyBlob(encodeReplyBlob(base, parse), 2)
        expect(decoded.ok).toBe(false)
    })

    test('a missing target is unreadable', () => {
        const raw = good()
        delete raw.target
        expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
    })

    test('a mistyped known field is unreadable', () => {
        const raw = good()
        raw.escape = 'no'
        expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        const parseBroken = good()
        ;(parseBroken.parse as Record<string, unknown>).multiGen = 1
        expect(decodeReplyBlob(JSON.stringify(parseBroken), 1).ok).toBe(false)
    })

    test('a foreign format and text that is not JSON are unreadable', () => {
        const raw = good()
        raw.format = 'other'
        expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        expect(decodeReplyBlob('not json', 1).ok).toBe(false)
        expect(decodeReplyBlob(undefined, 1).ok).toBe(false)
    })

    test('an unknown extra field is ignored', () => {
        const raw = good()
        raw.laterField = { anything: true }
        ;(raw.parse as Record<string, unknown>).laterRule = 'x'
        expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(true)
    })
})

const STREAM_FIXTURE = resolve(process.cwd(), 'src/ts/nativeReply/tests/fixtures/blob-openai-chat-stream-v1.json')
const streamParse: OpenAIStreamParseContext = { kind: 'openai-chat-stream', deepSeekThinkingOutput: true, extractJson: '$.reply', jsonSchema: true, multiGen: false }
const usage: ReplyUsageContext = { modelKey: 'gpt-4o', inputEstimate: 120 }

// The stream blob text of the fixture, inlined so a decoder that does not know the kind fails an assertion here.
const STREAM_LITERAL = '{"format":"risu-native-reply-blob","target":{"chaId":"cha-0001","chatId":"chat-0001"},"targetName":"Alice","saying":"cha-0001","generationInfo":{"model":"gpt-4o","generationId":"0b9c1a7e-0000-4000-8000-000000000001","inputTokens":120,"outputTokens":300,"maxContext":4000,"stageTiming":{"stage1":1,"stage2":2,"stage3":0,"stage4":0}},"promptInfo":{"promptName":"Main","promptToggles":[{"key":"a","value":"ON"}]},"parse":{"kind":"openai-chat-stream","deepSeekThinkingOutput":true,"extractJson":"$.reply","jsonSchema":true,"multiGen":false},"usage":{"modelKey":"gpt-4o","inputEstimate":120},"escape":false,"requestedMs":1700000000000}'

describe('blob openai-chat-stream fixture', () => {
    test('T1: the producer writes the committed stream fixture, key order frozen', () => {
        const produced = encodeStreamReplyBlob(base, streamParse, usage)
        if (process.env.WRITE_REPLY_BLOB_FIXTURE === '1') {
            writeFileSync(STREAM_FIXTURE, produced)
        }
        expect(readFileSync(STREAM_FIXTURE, 'utf8').replace(/\r/g, '')).toBe(produced)
        expect(produced).toBe(STREAM_LITERAL)
    })

    test('T2: the stream literal decodes to the exact fields', () => {
        const decoded = decodeReplyBlob(STREAM_LITERAL, 1)
        expect(decoded.ok).toBe(true)
        if (decoded.ok) {
            expect(decoded.blob).toEqual({ ...base, parse: streamParse, usage })
            expect(isStreamReplyBlob(decoded.blob)).toBe(true)
        }
        const committed = decodeReplyBlob(readFileSync(STREAM_FIXTURE, 'utf8'), 1)
        expect(committed.ok && committed.blob).toEqual({ ...base, parse: streamParse, usage })
    })

    test('T3: the openai-chat encoding never carries usage, and its text decodes without usage', () => {
        const withUsage = JSON.parse(encodeReplyBlob(base, parse)) as Record<string, unknown>
        withUsage.usage = usage
        const decoded = decodeReplyBlob(JSON.stringify(withUsage), 1)
        expect(decoded.ok).toBe(true)
        if (decoded.ok) {
            expect('usage' in decoded.blob).toBe(false)
            expect(isStreamReplyBlob(decoded.blob)).toBe(false)
        }
        expect(encodeReplyBlob(base, parse)).not.toContain('usage')
        const fixture = decodeReplyBlob(readFileSync(FIXTURE, 'utf8'), 1)
        expect(fixture.ok && fixture.blob).toEqual({ ...base, parse })
    })

    test('T5: the stream producer holds no URL, header, key or prompt even when the caller hands them in', () => {
        const request = {
            url: 'https://api.openai-compatible.invalid/v1/chat/completions?token=tok-9f31',
            headers: { Authorization: 'Bearer sk-live-4c7e1b9a02d3' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'a private prompt body' }] }),
        }
        const carrying = { ...base, ...request } as ReplyBlobBase
        const carryingUsage = { ...usage, apiKey: 'key-77aa21', url: request.url } as ReplyUsageContext
        const produced = encodeStreamReplyBlob(carrying, streamParse, carryingUsage)
        for (const secret of [request.url, 'tok-9f31', 'sk-live-4c7e1b9a02d3', 'key-77aa21', 'a private prompt body']) {
            expect(produced).not.toContain(secret)
        }
        for (const forbidden of ['http', 'Authorization', 'Bearer', 'formated', 'apiKey']) {
            expect(produced).not.toContain(forbidden)
        }
        expect(produced).toBe(encodeStreamReplyBlob(base, streamParse, usage))
    })
})

describe('blob stream decode rules', () => {
    const goodStream = () => JSON.parse(STREAM_LITERAL) as Record<string, unknown>

    test('T4: unknown and missing parse kinds are unreadable', () => {
        for (const kind of ['gemini-stream', 'openai-chat-stream2', undefined]) {
            const raw = goodStream()
            ;(raw.parse as Record<string, unknown>).kind = kind
            expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        }
    })

    test('T4: a stream blob with a missing or malformed usage block is unreadable', () => {
        const usages: unknown[] = [
            undefined,
            null,
            'gpt-4o',
            { inputEstimate: 120 },
            { modelKey: 5, inputEstimate: 120 },
            { modelKey: 'gpt-4o' },
            { modelKey: 'gpt-4o', inputEstimate: -1 },
            { modelKey: 'gpt-4o', inputEstimate: '120' },
            { modelKey: 'gpt-4o', inputEstimate: null },
        ]
        for (const bad of usages) {
            const raw = goodStream()
            if (bad === undefined) {
                delete raw.usage
            } else {
                raw.usage = bad
            }
            expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        }
        const zero = goodStream()
        zero.usage = { modelKey: '', inputEstimate: 0 }
        expect(decodeReplyBlob(JSON.stringify(zero), 1).ok).toBe(true)
    })

    test('T4: the stream kind keeps the parse-field checks and page version 2 stays unreadable', () => {
        const raw = goodStream()
        ;(raw.parse as Record<string, unknown>).multiGen = 'no'
        expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        expect(decodeReplyBlob(STREAM_LITERAL, 2).ok).toBe(false)
    })

    test('a sibling stream marker on an openai-chat kind does not make a stream blob', () => {
        const raw = JSON.parse(encodeReplyBlob(base, parse)) as Record<string, unknown>
        raw.stream = true
        raw.usage = usage
        const decoded = decodeReplyBlob(JSON.stringify(raw), 1)
        expect(decoded.ok && isStreamReplyBlob(decoded.blob)).toBe(false)
    })
})

describe('encodeStreamReplyBlob refuses a usage context the decoder would refuse', () => {
    test('F6: NaN, negative, missing and non-numeric estimates and a non-string model key throw', () => {
        const bad: unknown[] = [
            { modelKey: 'gpt-4o', inputEstimate: Number.NaN },
            { modelKey: 'gpt-4o', inputEstimate: -1 },
            { modelKey: 'gpt-4o', inputEstimate: Number.POSITIVE_INFINITY },
            { modelKey: 'gpt-4o', inputEstimate: undefined },
            { modelKey: 'gpt-4o', inputEstimate: '120' },
            { modelKey: 7, inputEstimate: 120 },
            { modelKey: undefined, inputEstimate: 120 },
        ]
        for (const candidate of bad) {
            expect(() => encodeStreamReplyBlob(base, streamParse, candidate as ReplyUsageContext)).toThrow()
        }
        expect(() => encodeStreamReplyBlob(base, streamParse, { modelKey: 'gpt-4o', inputEstimate: 0 })).not.toThrow()
    })
})

const RESPONSES_FIXTURE = resolve(process.cwd(), 'src/ts/nativeReply/tests/fixtures/blob-openai-responses-stream-v1.json')
const ANTHROPIC_FIXTURE = resolve(process.cwd(), 'src/ts/nativeReply/tests/fixtures/blob-anthropic-stream-v1.json')
const responsesParse: ResponsesStreamParseContext = { kind: 'openai-responses-stream', extractJson: '$.reply', jsonSchema: true }
const anthropicParse: AnthropicStreamParseContext = { kind: 'anthropic-stream' }

// The blob texts of the two fixtures, inlined so a decoder that does not know the kind fails an assertion here.
const RESPONSES_LITERAL = '{"format":"risu-native-reply-blob","target":{"chaId":"cha-0001","chatId":"chat-0001"},"targetName":"Alice","saying":"cha-0001","generationInfo":{"model":"gpt-4o","generationId":"0b9c1a7e-0000-4000-8000-000000000001","inputTokens":120,"outputTokens":300,"maxContext":4000,"stageTiming":{"stage1":1,"stage2":2,"stage3":0,"stage4":0}},"promptInfo":{"promptName":"Main","promptToggles":[{"key":"a","value":"ON"}]},"parse":{"kind":"openai-responses-stream","extractJson":"$.reply","jsonSchema":true},"usage":{"modelKey":"gpt-4o","inputEstimate":120},"escape":false,"requestedMs":1700000000000}'
const ANTHROPIC_LITERAL = '{"format":"risu-native-reply-blob","target":{"chaId":"cha-0001","chatId":"chat-0001"},"targetName":"Alice","saying":"cha-0001","generationInfo":{"model":"gpt-4o","generationId":"0b9c1a7e-0000-4000-8000-000000000001","inputTokens":120,"outputTokens":300,"maxContext":4000,"stageTiming":{"stage1":1,"stage2":2,"stage3":0,"stage4":0}},"promptInfo":{"promptName":"Main","promptToggles":[{"key":"a","value":"ON"}]},"parse":{"kind":"anthropic-stream"},"usage":{"modelKey":"gpt-4o","inputEstimate":120},"escape":false,"requestedMs":1700000000000}'

const NEW_KINDS: { name: string, fixture: string, literal: string, parse: StreamParseContext }[] = [
    { name: 'openai-responses-stream', fixture: RESPONSES_FIXTURE, literal: RESPONSES_LITERAL, parse: responsesParse },
    { name: 'anthropic-stream', fixture: ANTHROPIC_FIXTURE, literal: ANTHROPIC_LITERAL, parse: anthropicParse },
]

describe.each(NEW_KINDS)('blob $name fixture', ({ fixture, literal, parse: kindParse }) => {
    test('T1: the producer writes the committed fixture, key order frozen', () => {
        const produced = encodeStreamReplyBlob(base, kindParse, usage)
        if (process.env.WRITE_REPLY_BLOB_FIXTURE === '1') {
            writeFileSync(fixture, produced)
        }
        expect(readFileSync(fixture, 'utf8').replace(/\r/g, '')).toBe(produced)
        expect(produced).toBe(literal)
    })

    test('T2: the literal and the committed fixture decode to the exact fields', () => {
        const decoded = decodeReplyBlob(literal, 1)
        expect(decoded.ok).toBe(true)
        if (decoded.ok) {
            expect(decoded.blob).toEqual({ ...base, parse: kindParse, usage })
            expect(isStreamReplyBlob(decoded.blob)).toBe(true)
        }
        const committed = decodeReplyBlob(readFileSync(fixture, 'utf8'), 1)
        expect(committed.ok && committed.blob).toEqual({ ...base, parse: kindParse, usage })
    })

    test('T4: a missing, malformed or negative usage block is unreadable', () => {
        const usages: unknown[] = [
            undefined, null, 'gpt-4o', { inputEstimate: 120 }, { modelKey: 5, inputEstimate: 120 },
            { modelKey: 'gpt-4o' }, { modelKey: 'gpt-4o', inputEstimate: -1 }, { modelKey: 'gpt-4o', inputEstimate: '120' },
        ]
        for (const bad of usages) {
            const raw = JSON.parse(literal) as Record<string, unknown>
            if (bad === undefined) {
                delete raw.usage
            } else {
                raw.usage = bad
            }
            expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        }
        expect(decodeReplyBlob(literal, 2).ok).toBe(false)
    })

    test('T5: the producer holds no URL, header, key or prompt even when the caller hands them in', () => {
        const request = {
            url: 'https://api.example.invalid/v1/responses?token=tok-9f31',
            headers: { Authorization: 'Bearer sk-live-4c7e1b9a02d3' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'a private prompt body' }] }),
        }
        const carrying = { ...base, ...request } as ReplyBlobBase
        const carryingParse = { ...kindParse, apiKey: 'key-77aa21' } as unknown as StreamParseContext
        const produced = encodeStreamReplyBlob(carrying, carryingParse, { ...usage, apiKey: 'key-77aa21' } as ReplyUsageContext)
        for (const secret of [request.url, 'tok-9f31', 'sk-live-4c7e1b9a02d3', 'key-77aa21', 'a private prompt body']) {
            expect(produced).not.toContain(secret)
        }
        expect(produced).toBe(literal)
    })

    test('F6: a usage context the decoder would refuse makes the producer throw', () => {
        expect(() => encodeStreamReplyBlob(base, kindParse, { modelKey: 'gpt-4o', inputEstimate: -1 })).toThrow()
        expect(() => encodeStreamReplyBlob(base, kindParse, { modelKey: 7, inputEstimate: 1 } as unknown as ReplyUsageContext)).toThrow()
    })
})

describe('blob responses rule fields', () => {
    const good = () => JSON.parse(RESPONSES_LITERAL) as Record<string, unknown>

    test('T4: a missing or mistyped extractJson or jsonSchema is unreadable', () => {
        for (const [field, bad] of [['extractJson', 5], ['extractJson', undefined], ['jsonSchema', 'yes'], ['jsonSchema', undefined]] as const) {
            const raw = good()
            const parseRecord = raw.parse as Record<string, unknown>
            if (bad === undefined) {
                delete parseRecord[field]
            } else {
                parseRecord[field] = bad
            }
            expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
        }
        const noExtract = good()
        ;(noExtract.parse as Record<string, unknown>).extractJson = null
        expect(decodeReplyBlob(JSON.stringify(noExtract), 1).ok).toBe(true)
    })

    test('T4: the unknown kind cohere-stream is unreadable', () => {
        const raw = good()
        ;(raw.parse as Record<string, unknown>).kind = 'cohere-stream'
        expect(decodeReplyBlob(JSON.stringify(raw), 1).ok).toBe(false)
    })

    test('T3: the encodings of the older kinds are untouched by the new kinds', () => {
        expect(encodeStreamReplyBlob(base, streamParse, usage)).toBe(STREAM_LITERAL)
        expect(readFileSync(STREAM_FIXTURE, 'utf8').replace(/\r/g, '')).toBe(STREAM_LITERAL)
        expect(encodeReplyBlob(base, parse)).toBe(readFileSync(FIXTURE, 'utf8').replace(/\r/g, ''))
    })
})
