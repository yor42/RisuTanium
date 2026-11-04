// @vitest-environment node
/**
 * Anchored message chunking and cross-position reuse (CHORE-412 stage S2), through the real producer: `splitChat`,
 * `encodeDatabase`, `createSaveEncoder` and the verdict.
 *
 * Classes:
 * - Regression reproducers (fail on the greedy 128 KiB split, pass with anchored chunking): the delete and grow
 *   bounds, the mean chunk band, and the chunk keys after a delete. They call only `splitChat` and `messageListBytes`
 *   and compute anchors locally from `crc32` and the literal W32 constants, so they run on a tree without the new
 *   exports.
 * - Compatibility guards (each says so): the sealing rule at its limits, the anchor key, claim-once reuse, the
 *   family restriction and the verdict after a merge.
 *
 * The production default is exercised without `vi.mock`. Tests that switch parameter sets are in
 * chunkResplitCommit.test.ts.
 */
import { describe, expect, test } from 'vitest'
import { crc32, type JsonObject } from 'src/ts/storage/blockFrame'
import type { character } from 'src/ts/storage/database.svelte'
import {
    characterMatchesAcknowledged, characterMatchesAcknowledgedPlain, MESSAGE_CHUNKING, messageListBytes, plainObject, previousFrom,
    sealAnchored, sealChunks, splitChat, utf8Length, verdictBaseOf,
} from 'src/ts/storage/store2/codec'
import { canonicalJson } from 'src/ts/storage/store2/format'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import {
    buildT5Chat, chat as chatFixture, dbWithCharacters, encodeWith, fakeLists, message, mulberry32, profileWithChats,
    prosePool, seededEnv, sparseCharacter, type Obj,
} from './codecFixtures'
import { rigRequest, RIG_NOW } from './writeAmplificationRig'

/** The W32 parameter set, literally: the reproducers must not depend on the new module. */
const W32 = { min: 2_048, target: 32_768, max: 131_072 }
const TWO_32 = 0x1_0000_0000
const KIB = 1024

function asJson(value: Obj): JsonObject {
    return value as JsonObject
}

/** The anchor key: a non-empty `chatId` stamp when present, else the message's canonical content. */
function keyOfMessage(m: JsonObject): string {
    return typeof m.chatId === 'string' && m.chatId.length > 0 ? m.chatId : canonicalJson(m)
}

/** The byte-weighted anchor predicate, restated from the rule: crc32(key)/2^32 < len/target. */
function hashAnchor(m: JsonObject, target: number = W32.target): boolean {
    return crc32(new TextEncoder().encode(keyOfMessage(m))) * target < utf8Length(canonicalJson(m)) * TWO_32
}

/** The anchor predicate over the message's canonical content, ignoring any stamp. */
function contentAnchor(m: JsonObject, target: number = W32.target): boolean {
    return crc32(new TextEncoder().encode(canonicalJson(m))) * target < utf8Length(canonicalJson(m)) * TWO_32
}

/** Nearest-rank percentile of a list of counts. */
function percentile(values: readonly number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

// ---- fixtures ----

type Profile = 'equal' | 'harness'

/** A 1,000-message chat of the profile: equal messages of about 470 bytes, or 200 to 900 bytes like the T5 tier. */
function chatOf(profile: Profile, seed: number): Obj {
    if (profile === 'harness') {
        return buildT5Chat(1000, undefined, seed)
    }
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    return chatFixture(rng, 0, Array.from({ length: 1000 }, (_, i) => message(rng, pool, i, 420)))
}

/** A chat of `count` messages whose sizes are lognormal with a 5.4 KB median and sigma 0.8. */
function realChat(seed: number, count: number): Obj {
    const rng = mulberry32(seed)
    const pool = prosePool(rng, 60, 200, 900)
    const normal = (): number => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng())
    return chatFixture(rng, 0, Array.from({ length: count }, (_, i) => message(rng, pool, i, Math.max(50, Math.round(5_400 * Math.exp(0.8 * normal()))))))
}

function cloneChat(source: Obj): Obj {
    return JSON.parse(JSON.stringify(source)) as Obj
}

function messagesOf(source: Obj): Obj[] {
    return source.message as Obj[]
}

/** The first message past the first that is an anchor and sits past the minimum chunk size, so it is a real boundary. */
function earlyAnchorIndex(source: Obj): number {
    const messages = messagesOf(source)
    for (let i = 1; i < messages.length; i++) {
        if (hashAnchor(asJson(messages[i])) && messageListBytes(messages.slice(0, i + 1).map(asJson)) >= W32.min) {
            return i
        }
    }
    throw new Error('The fixture has no early anchor.')
}

function firstNonAnchorIndex(source: Obj): number {
    const messages = messagesOf(source)
    for (let i = 1; i < messages.length; i++) {
        if (!hashAnchor(asJson(messages[i]))) {
            return i
        }
    }
    throw new Error('The fixture has no non-anchor message.')
}

function deleteAt(source: Obj, index: number): Obj {
    const copy = cloneChat(source)
    messagesOf(copy).splice(index, 1)
    return copy
}

function growAt(source: Obj, index: number): Obj {
    const copy = cloneChat(source)
    const target = messagesOf(copy)[index]
    target.data = (target.data as string) + 'g'.repeat(2 * KIB)
    return copy
}

/** Chunks of `after` whose canonical bytes no chunk of `before` has: the units a save would write for the chat. */
function newChunkCount(before: Obj, after: Obj): number {
    const old = new Set(splitChat(asJson(before), 'chat').chunks.map(chunk => canonicalJson(chunk)))
    return splitChat(asJson(after), 'chat').chunks.filter(chunk => !old.has(canonicalJson(chunk))).length
}

const SEEDS = Array.from({ length: 50 }, (_, i) => 1000 + i)
const PROFILES: Profile[] = ['equal', 'harness']

interface EditRow {
    label: string
    edit: (source: Obj) => Obj
    max: number
}

const DELETE_ROWS: EditRow[] = [
    { label: 'delete a non-anchor message at index 1 or later', edit: source => deleteAt(source, firstNonAnchorIndex(source)), max: 3 },
    { label: 'delete an early anchor', edit: source => deleteAt(source, earlyAnchorIndex(source)), max: 4 },
]

const GROW_ROWS: EditRow[] = [
    { label: 'grow message 1 by 2 KB', edit: source => growAt(source, 1), max: 3 },
    { label: 'grow message 500 by 2 KB', edit: source => growAt(source, 500), max: 3 },
]

function countsOf(profile: Profile, row: EditRow): number[] {
    return SEEDS.map((seed) => {
        const before = chatOf(profile, seed)
        return newChunkCount(before, row.edit(before))
    })
}

describe.each(PROFILES)('chunks written after a delete, %s profile', (profile) => {
    test.each(DELETE_ROWS)('regression reproducer: $label writes at most 2 new chunks at p90 and $max at most over 50 seeds', (row) => {
        const counts = countsOf(profile, row)
        expect(percentile(counts, 0.9)).toBeLessThanOrEqual(2)
        expect(Math.max(...counts)).toBeLessThanOrEqual(row.max)
    })
})

describe.each(PROFILES)('chunks written after a grow, %s profile', (profile) => {
    test.each(GROW_ROWS)('regression reproducer: $label writes at most 2 new chunks at p90 and $max at most over 50 seeds', (row) => {
        const counts = countsOf(profile, row)
        expect(percentile(counts, 0.9)).toBeLessThanOrEqual(2)
        expect(Math.max(...counts)).toBeLessThanOrEqual(row.max)
    })
})

describe('chunk size', () => {
    const BAND_LOW = 17 * KIB
    const BAND_HIGH = 51 * KIB

    function meanChunkBytes(source: Obj): number {
        const chunks = splitChat(asJson(source), 'chat').chunks
        return chunks.reduce((sum, chunk) => sum + messageListBytes(chunk.msgs), 0) / chunks.length
    }

    test.each([1000, 1001, 1002])('regression reproducer: the mean chunk of a 1,000-message harness chat (seed %i) is within 17 to 51 KiB', (seed) => {
        const mean = meanChunkBytes(chatOf('harness', seed))
        expect(mean).toBeGreaterThanOrEqual(BAND_LOW)
        expect(mean).toBeLessThanOrEqual(BAND_HIGH)
    })

    test('regression reproducer: the mean chunk of a 300-message chat with a 5.4 KB median message is within 17 to 51 KiB', () => {
        const mean = meanChunkBytes(realChat(1000, 300))
        expect(mean).toBeGreaterThanOrEqual(BAND_LOW)
        expect(mean).toBeLessThanOrEqual(BAND_HIGH)
    })

    test('compatibility guard (passes before and after): no chunk is over the maximum unless it holds a single message', () => {
        for (const source of [chatOf('harness', 1000), chatOf('equal', 1000), realChat(1000, 300)]) {
            const split = splitChat(asJson(source), 'chat')
            for (const chunk of split.chunks) {
                if (chunk.msgs.length > 1) {
                    expect(messageListBytes(chunk.msgs)).toBeLessThanOrEqual(W32.max)
                }
            }
            expect(split.chunks.flatMap(chunk => chunk.msgs)).toEqual(messagesOf(source))
        }
    })
})

// ---- the sealing rule ----

function sized(extra: number, index = 0): JsonObject {
    return { role: 'user', data: `${index}`.padStart(6, '0') + 'x'.repeat(extra), time: index }
}

/** `base` with a same-length `chatId` stamp for which the anchor predicate equals `wantAnchor`. */
function stamped(base: JsonObject, wantAnchor: boolean, target: number = W32.target): JsonObject {
    for (let n = 0; n < 200_000; n++) {
        const candidate: JsonObject = { ...base, chatId: `stamp-${String(n).padStart(8, '0')}` }
        if (hashAnchor(candidate, target) === wantAnchor) {
            return candidate
        }
    }
    throw new Error('No stamp found.')
}

describe('the target-0 rule equals the greedy split', () => {
    const G = { min: 0, target: 0, max: 131_072 }

    test('compatibility guard: with target 0 the result equals sealChunks on the harness chat, the codec chat lists and an oversize message', () => {
        const harness = messagesOf(chatOf('harness', 1000)).map(asJson)
        const exact = 131_072 - 3 - 2 * utf8Length(canonicalJson(sized(0)))
        const first = Math.floor(exact / 2)
        const lists: JsonObject[][] = [
            harness,
            [sized(first), sized(exact - first)],
            [sized(first), sized(exact - first + 1)],
            Array.from({ length: 400 }, (_, i) => ({ role: 'user', data: 'w'.repeat(900 + (i % 7) * 100), time: i })),
            [sized(20), sized(131_082), sized(20)],
            [sized(131_082)],
            [],
        ]
        for (const list of lists) {
            expect(sealAnchored(list, G)).toEqual(sealChunks(list))
        }
        expect(sealAnchored(harness, G).length).toBeGreaterThan(2)
    })

    test('compatibility guard: a smaller maximum is honoured the same way', () => {
        const list = messagesOf(chatOf('harness', 1001)).map(asJson).slice(0, 200)
        expect(sealAnchored(list, { min: 0, target: 0, max: 4_096 })).toEqual(sealChunks(list, 4_096))
    })
})

describe('the sealing rule at its limits', () => {
    test('compatibility guard: with no anchor a chunk seals only at the maximum, and no chunk is over it', () => {
        const list = Array.from({ length: 100 }, (_, i) => stamped(sized(5_000, i), false))
        const chunks = sealAnchored(list, W32)
        expect(chunks).toEqual(sealChunks(list, W32.max))
        expect(chunks.length).toBeGreaterThan(3)
        for (const chunk of chunks) {
            expect(messageListBytes(chunk)).toBeLessThanOrEqual(W32.max)
        }
    })

    test('compatibility guard: when every message anchors, no chunk seals below the minimum', () => {
        const list = Array.from({ length: 40 }, (_, i) => stamped(sized(600, i), true))
        const chunks = sealAnchored(list, W32)
        expect(chunks.flat()).toEqual(list)
        expect(chunks.length).toBeGreaterThan(5)
        chunks.slice(0, -1).forEach((chunk) => {
            expect(messageListBytes(chunk)).toBeGreaterThanOrEqual(W32.min)
            expect(messageListBytes(chunk.slice(0, -1))).toBeLessThan(W32.min)
        })
    })

    test('compatibility guard: a message above the maximum is a chunk of its own wherever it sits', () => {
        const small = stamped(sized(20, 1), false)
        const other = stamped(sized(20, 2), false)
        const huge = sized(W32.max + 10)
        expect(sealAnchored([small, huge, other], W32).map(chunk => chunk.length)).toEqual([1, 1, 1])
        expect(sealAnchored([huge, small], W32).map(chunk => chunk.length)).toEqual([1, 1])
        expect(sealAnchored([small, other, huge], W32).map(chunk => chunk.length)).toEqual([2, 1])
        expect(sealAnchored([huge], W32)).toEqual([[huge]])
        expect(sealAnchored([], W32)).toEqual([[]])
    })

    test('compatibility guard: an anchor as the last message leaves no empty chunk, and the per-send state is on the last chunk only', () => {
        const params = MESSAGE_CHUNKING
        const list = [
            ...Array.from({ length: 9 }, (_, i) => stamped(sized(700, i), false, params.target)),
            stamped(sized(700, 9), true, params.target),
        ]
        const chunks = sealAnchored(list, params)
        expect(chunks.flat()).toEqual(list)
        for (const chunk of chunks) {
            expect(chunk.length).toBeGreaterThan(0)
        }
        const chat: JsonObject = { message: list, name: 'c', id: 'chat-tail', lastDate: 9, scriptstate: { a: 1 } }
        const split = splitChat(chat, 'chat')
        expect(split.chunks.map(chunk => chunk.msgs.length)).toEqual(chunks.map(chunk => chunk.length))
        split.chunks.forEach((chunk, index) => {
            expect(chunk.st !== undefined, `chunk ${index}`).toBe(index === split.chunks.length - 1)
        })
    })
})

describe('the anchor key', () => {
    /** Twelve messages: stamped non-anchors, with `middle` at index 6, where the first chunk should end. */
    function list(middle: JsonObject): JsonObject[] {
        return Array.from({ length: 12 }, (_, i) => (i === 6 ? middle : stamped(sized(700, i), false)))
    }

    /** A same-length variant of `base` (data digits changed) whose content-only anchor value is `wanted`. */
    function variant(base: JsonObject, wanted: boolean): JsonObject {
        const data = base.data as string
        for (let n = 0; n < 200_000; n++) {
            const candidate: JsonObject = { ...base, data: data.slice(0, 6) + String(n).padStart(8, '0') + data.slice(14) }
            if (contentAnchor(candidate) === wanted) {
                return candidate
            }
        }
        throw new Error('No variant found.')
    }

    test('compatibility guard: a message with a chatId keeps its boundary under a same-length edit that changes its content hash', () => {
        const stamp = stamped(sized(700, 6), true)
        const edited = variant(stamp, false)
        // Same length and same stamp, so the stamp decides: it still anchors, though its content would not.
        expect(utf8Length(canonicalJson(edited))).toBe(utf8Length(canonicalJson(stamp)))
        expect(hashAnchor(edited)).toBe(true)
        expect(contentAnchor(edited)).toBe(false)
        const before = sealAnchored(list(stamp), W32).map(chunk => chunk.length)
        expect(before[0]).toBe(7)
        expect(sealAnchored(list(edited), W32).map(chunk => chunk.length)).toEqual(before)
    })

    test('compatibility guard: without a chatId the content decides, so a same-length edit that changes the hash moves the boundary', () => {
        const anchoring = variant(sized(700, 6), true)
        const before = sealAnchored(list(anchoring), W32).map(chunk => chunk.length)
        expect(before[0]).toBe(7)
        const edited = variant(sized(700, 6), false)
        expect(utf8Length(canonicalJson(edited))).toBe(utf8Length(canonicalJson(anchoring)))
        expect(sealAnchored(list(edited), W32)[0].length).toBeGreaterThan(7)
    })
})

// ---- reuse across positions, through the real encode ----

type Tree = ReturnType<typeof encodeWith>

function chunkPosition(identity: string): number {
    return Number(identity.slice(identity.lastIndexOf(':') + 1))
}

/** The chat chunk units of an encoding whose identity contains `within`, in chunk order. */
function chunkUnits(tree: Tree, within = ''): { identity: string, key: string, reused: boolean }[] {
    return tree.units
        .filter(unit => unit.identity.includes(':chunk:') && unit.identity.includes(within))
        .map(unit => ({ identity: unit.identity, key: unit.key, reused: unit.reused === true }))
        .sort((a, b) => chunkPosition(a.identity) - chunkPosition(b.identity))
}

function named(rng: () => number, id: string, messages: Obj[]): Obj {
    const out = chatFixture(rng, 0, messages)
    out.id = id
    delete out.lastDate
    return out
}

describe('chunk keys after a delete', () => {
    test('regression reproducer: deleting the last message of the first chunk writes at most two chunk units, and the later chunks keep their keys', () => {
        const source = chatOf('harness', 1000)
        expect(messageListBytes(messagesOf(source).map(asJson))).toBeGreaterThan(400 * KIB)
        const firstChunk = splitChat(asJson(source), 'chat').chunks[0]
        const first = encodeWith(profileWithChats([source]))
        const oldKeys = chunkUnits(first).map(unit => unit.key)
        expect(oldKeys.length).toBeGreaterThanOrEqual(4)

        const after = deleteAt(source, firstChunk.msgs.length - 1)
        const second = encodeWith(profileWithChats([after]), { previous: previousFrom(first), env: seededEnv(2) })
        const units = chunkUnits(second)
        expect(units.filter(unit => !unit.reused).length).toBeLessThanOrEqual(2)
        const reusedKeys = units.filter(unit => unit.reused).map(unit => unit.key)
        expect(reusedKeys.length).toBeGreaterThanOrEqual(units.length - 2)
        for (const key of reusedKeys) {
            expect(oldKeys).toContain(key)
        }
        expect(new Set(units.map(unit => unit.key)).size).toBe(units.length)
    })

    test('compatibility guard: a chunk key is claimed once, so two equal chunks reuse two different prior keys', () => {
        const rng = mulberry32(2)
        const pool = prosePool(rng, 20, 200, 900)
        const x = message(rng, pool, 0, 70_000)
        const a = message(rng, pool, 1, 70_000)
        const first = encodeWith(profileWithChats([named(rng, 'chat-claim', [x, a, { ...a }])]))
        const oldKeys = chunkUnits(first).map(unit => unit.key)
        expect(oldKeys).toHaveLength(3)
        expect(new Set(oldKeys).size).toBe(3)

        const second = encodeWith(profileWithChats([named(rng, 'chat-claim', [a, { ...a }])]), { previous: previousFrom(first), env: seededEnv(2) })
        const units = chunkUnits(second)
        expect(units).toHaveLength(2)
        expect(units.every(unit => unit.reused)).toBe(true)
        expect(units.map(unit => unit.key)).toEqual([oldKeys[1], oldKeys[2]])
    })

    test('compatibility guard: reuse stays inside the chat, so a chunk equal to another chat\'s chunk gets a fresh key and the other chat keeps its own', () => {
        const rng = mulberry32(3)
        const pool = prosePool(rng, 20, 200, 900)
        const c = message(rng, pool, 0, 70_000)
        const d = message(rng, pool, 1, 70_000)
        // Q comes before P, so a lookup across chats would let Q claim P's key first.
        const first = encodeWith(profileWithChats([named(rng, 'chat-q', [d]), named(rng, 'chat-p', [c])]))
        const pKeyBefore = chunkUnits(first, ':chat-p:')[0].key
        const qKeyBefore = chunkUnits(first, ':chat-q:')[0].key

        const second = encodeWith(profileWithChats([named(rng, 'chat-q', [c, d]), named(rng, 'chat-p', [c])]), { previous: previousFrom(first), env: seededEnv(2) })
        const pUnits = chunkUnits(second, ':chat-p:')
        const qUnits = chunkUnits(second, ':chat-q:')
        expect(pUnits).toHaveLength(1)
        expect(pUnits[0].key).toBe(pKeyBefore)
        expect(pUnits[0].reused).toBe(true)
        expect(qUnits).toHaveLength(2)
        expect(qUnits[0].reused).toBe(false)
        expect(qUnits[0].key).not.toBe(pKeyBefore)
        expect(qUnits[1].key).toBe(qKeyBefore)
        expect(qUnits[1].reused).toBe(true)
    })

    test('compatibility guard: a scoped pass that encodes only one character gives its chunk a key of its own even when it equals a carried character\'s chunk', async () => {
        const rng = mulberry32(4)
        const pool = prosePool(rng, 20, 200, 900)
        const c = message(rng, pool, 0, 70_000)
        const d = message(rng, pool, 1, 70_000)
        const alpha = sparseCharacter(rng, pool, 'cha-alpha', 'Alpha', [named(rng, 'chat-alpha', [c])], [])
        const beta = sparseCharacter(rng, pool, 'cha-beta', 'Beta', [named(rng, 'chat-beta', [d])], [])
        const first = encodeWith(dbWithCharacters([alpha, beta]))
        const alphaKey = chunkUnits(first, ':chat-alpha:')[0].key

        beta.chats = [named(rng, 'chat-beta', [c])]
        const encoder = createSaveEncoder({ previous: previousFrom(first), lists: fakeLists, env: seededEnv(77), now: () => RIG_NOW })
        const plan = await encoder.plan(dbWithCharacters([alpha, beta]), rigRequest(['cha-beta']))
        expect(plan.encoded).toEqual(['cha-beta'])
        const { mint } = createKeyMint(seededEnv(900), null)
        await plan.commitRequest().build({ mint, seq: 2, now: RIG_NOW })
        plan.acknowledge()
        const units = encoder.acknowledged().units
        const betaChunk = [...units].find(([identity]) => identity.includes(':chat-beta:chunk:0'))
        const alphaChunk = [...units].find(([identity]) => identity.includes(':chat-alpha:chunk:0'))
        expect(betaChunk).toBeDefined()
        expect(alphaChunk?.[1].key).toBe(alphaKey)
        expect(betaChunk?.[1].key).not.toBe(alphaKey)
    })
})

// ---- the verdict after a merge ----

describe('the verdict after a chat is merged or re-split', () => {
    test('compatibility guard: after deleting an early anchor, saving and acknowledging, the character reads clean (also through the pre-read entry point), and an edit makes it dirty', () => {
        const source = chatOf('harness', 1000)
        const first = encodeWith(profileWithChats([source]))
        const database = profileWithChats([deleteAt(source, earlyAnchorIndex(source))])
        const second = encodeWith(database, { previous: previousFrom(first), env: seededEnv(2) })
        expect(chunkUnits(second).some(unit => unit.reused)).toBe(true)

        const acknowledged = previousFrom(second)
        const options = { env: seededEnv(5), lists: fakeLists, previous: acknowledged }
        const slot = database.characters[0] as unknown as character
        expect(characterMatchesAcknowledged(slot, options)).toBe('clean')
        const base = verdictBaseOf(slot, acknowledged)
        expect(base).not.toBeNull()
        if (base !== null) {
            expect(characterMatchesAcknowledgedPlain(slot, plainObject(slot, 'characters[0]'), base, options)).toBe('clean')
        }

        const live = database.characters[0] as unknown as { chats: { message: { data: string }[] }[] }
        live.chats[0].message[0].data += ' [edited]'
        expect(characterMatchesAcknowledged(slot, options)).toBe('dirty')
    })
})
