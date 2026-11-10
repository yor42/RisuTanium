// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import { chunkMessageJson, splitChat } from 'src/ts/storage/store2/codec'
import { canonicalJson, encodeCanonicalJson, encodeUnit, UNIT_TYPE } from 'src/ts/storage/store2/format'
import {
    bytesIn, buildLegacyCases, buildT5Chat, dbWithCharacters, encodeWith, profileWithChats, seededEnv, unitOf,
    type Obj,
} from './codecFixtures'

/**
 * One serialisation per message: the canonical string `sealAnchored` produced for a message is the string the chunk
 * frame embeds, so the bytes are the ones the plain encoder writes. Labels: reproducer (fails on the pre-change base),
 * guard (passes before and after), rule test (new rule; the base lacks the API).
 */

function sha256Hex(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

function asJson(value: Obj): JsonObject {
    return value as JsonObject
}

function withoutChatIds(chat: Obj): Obj {
    return { ...chat, message: (chat.message as Obj[]).map((one) => {
        const { chatId: _chatId, ...rest } = one
        return rest
    }) }
}

/** The SHA-256 of every chat chunk unit's framed bytes, in identity order, folded into one hex digest. */
function chunkFold(db: Parameters<typeof encodeWith>[0]): string {
    const tree = encodeWith(db, { env: seededEnv(3) })
    const chunkIdentities = tree.units.map(unit => unit.identity).filter(identity => identity.includes(':chunk:')).sort()
    const fold = createHash('sha256')
    for (const identity of chunkIdentities) {
        fold.update(`${identity}=${sha256Hex(bytesIn(unitOf(tree, identity)))}\n`)
    }
    return fold.digest('hex')
}

describe('canonicalJson with prewritten containers', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('rule test: a prewritten array is written as its stored string, everything else as before', () => {
        const msgs = [{ b: 1, a: 'x' }, { c: 2 }]
        const body = { v: 1, msgs }
        expect(canonicalJson(body, new Map([[msgs, 'POISON']]))).toBe('{"msgs":POISON,"v":1}')
        expect(canonicalJson(body, new Map())).toBe(canonicalJson(body))
        expect(canonicalJson(body, new Map([[{ other: true }, 'POISON']]))).toBe(canonicalJson(body))
        expect(canonicalJson(body)).toBe('{"msgs":[{"a":"x","b":1},{"c":2}],"v":1}')
    })

    test('rule test: encodeCanonicalJson and encodeUnit take the same map', () => {
        const msgs = [{ role: 'user', data: 'a' }]
        const body = { v: 1, msgs }
        const prewritten = new Map([[msgs, '[' + canonicalJson(msgs[0]) + ']']])
        expect(Array.from(encodeCanonicalJson(body, prewritten))).toEqual(Array.from(encodeCanonicalJson(body)))
        expect(Array.from(encodeUnit(UNIT_TYPE.chatChunk, body, prewritten))).toEqual(Array.from(encodeUnit(UNIT_TYPE.chatChunk, body)))
    })

    test('rule test: the strings a split keeps are the messages canonical strings, chunk by chunk', () => {
        const chat = asJson(buildT5Chat(300))
        const split = splitChat(chat, 'chat')
        expect(split.chunks.length).toBeGreaterThan(1)
        for (const chunk of split.chunks) {
            const strings = chunkMessageJson(chunk)
            expect(strings).toBeDefined()
            expect(strings).toEqual(chunk.msgs.map(message => canonicalJson(message)))
        }
        // A body that did not come from a split has nothing stored.
        expect(chunkMessageJson({ v: 1, msgs: [] })).toBeUndefined()
    })

    test('R3 (reproducer): each message without a chatId is serialised once across split and emit', () => {
        const count = 1000
        const messages = Array.from({ length: count }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'char', data: `SENTINEL-${i}-${'x'.repeat(60)}`, time: 1_700_000_000_000 + i,
        }))
        const chat = { message: messages, note: '', name: 'Sentinel', localLore: [], id: 'sentinel-chat', lastDate: 1 }
        const db = profileWithChats([chat as Obj])
        const real = JSON.stringify
        let sentinelCalls = 0
        vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown, ...rest: unknown[]) => {
            if (typeof value === 'string' && value.startsWith('SENTINEL-')) {
                sentinelCalls++
            }
            return (real as (...args: unknown[]) => string)(value, ...rest)
        }) as typeof JSON.stringify)
        encodeWith(db)
        expect(sentinelCalls).toBe(count)
    })
})

describe('chunk bytes are unchanged (guard: pinned on the pre-change base)', () => {
    test('G4: mixed chatId / no chatId chat', () => {
        const chat = buildT5Chat(400)
        expect((chat.message as Obj[]).some(m => typeof m.chatId === 'string')).toBe(true)
        expect(chunkFold(profileWithChats([chat]))).toBe(PINS.mixed)
    })

    test('G4: chat with no chatId at all', () => {
        const chat = withoutChatIds(buildT5Chat(400))
        expect(chunkFold(profileWithChats([chat]))).toBe(PINS.plain)
    })

    test('G4: legacy cases, one character each', () => {
        const fold = createHash('sha256')
        for (const { label, character } of buildLegacyCases()) {
            let outcome: string
            try {
                outcome = chunkFold(dbWithCharacters([character]))
            } catch {
                outcome = 'throws'
            }
            fold.update(`${label}=${outcome}\n`)
        }
        expect(fold.digest('hex')).toBe(PINS.legacy)
    })
})

/** Recorded once on the pre-change base with the same fixtures. */
const PINS = {
    mixed: '5590df168ea14c0b156e087c618ff73619bd072043d8c0aab5b6d1e2f4d48976',
    plain: '58c251d94bdb5deec92b5d494c258ef70223f7060e512edae3e9e463a4c0ae3c',
    legacy: 'd645ca1e8e477f34157343ee323307dd2c1e9e5db2d56b08ee42c0705020d4f4',
}
