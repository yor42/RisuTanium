import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { decodeReplyBlob, encodeReplyBlob, type ReplyBlobBase } from '../blob'
import type { OpenAIParseContext } from '../../process/request/openAI/chatBodyParse'

/**
 * T5 (guard, MC-329): the committed fixture is what the producer writes, byte for byte, for the input the send builds.
 * Set `WRITE_REPLY_BLOB_FIXTURE=1` to rewrite it from `encodeReplyBlob`; it is never edited by hand. A later shape takes
 * page version 2 with a migration tested against this fixture.
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
