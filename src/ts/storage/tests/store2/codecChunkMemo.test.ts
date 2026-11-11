// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Sha256 } from 'src/ts/assetHash'
import type { Database } from '../../database.svelte'
import { isWrittenUnit, previousFrom, type EncodedUnit, type PreviousEncoding, type ReusableUnit } from '../../store2/codec'
import { ChunkMemo, chunkMemoChargeOf } from '../../store2/codec/chunkMemo'
import { UnitSink, unitDigest } from '../../store2/codec/reuse'
import { canonicalJson, encodeUnit, newManifestKey, newShardKey, newUnitKey, UNIT_TYPE } from '../../store2/format'
import { createSaveEncoder } from '../../store2/saveEncoder'
import { buildT5Chat, encodeWith, fakeLists, profileWithChats, seededEnv, type Obj } from './codecFixtures'

/**
 * The chunk memo: a chunk whose saved text is the remembered one, and whose previous unit carries the remembered
 * digest, is taken without being framed or digested. Labels: reproducer (fails on the pre-change base), guard (passes
 * before and after), rule test (new rule; the base lacks the API).
 */

const NOW = 1_700_000_000_000
const CHUNK = UNIT_TYPE.chatChunk
const FAMILY = 'chat:u1:c1:chunk:'
const BIG_UPDATE = 8 * 1024

afterEach(() => {
    vi.restoreAllMocks()
})

function bodyOf(data: string): { v: 1, msgs: { role: string, data: string }[] } {
    return { v: 1, msgs: [{ role: 'user', data }] }
}

function payloadOf(body: object): string {
    return canonicalJson(body)
}

function digestOfBody(body: object): string {
    return unitDigest(encodeUnit(CHUNK, body))
}

/** What a sink of the previous encode left: units without bytes, as `previousFrom` keeps them. */
function previousOf(units: readonly EncodedUnit[]): PreviousEncoding {
    const held = new Map<string, ReusableUnit>()
    for (const unit of units) {
        held.set(unit.identity, { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest })
    }
    return { units: held, entities: new Map() }
}

/** An encode of `bodies` as chunks 0.. of one family; returns its units. */
function encodeChunks(bodies: readonly object[], previous: PreviousEncoding | null, seed: number, memo?: ChunkMemo): EncodedUnit[] {
    const sink = new UnitSink(seededEnv(seed), previous, undefined, memo === undefined ? {} : { chunkMemo: memo })
    bodies.forEach((body, index) => {
        sink.putReusing(`${FAMILY}${index}`, CHUNK, body, FAMILY)
    })
    return sink.units
}

/** Counts the SHA-256 updates of at least `minimum` bytes from now on, one spy per test. */
function sha256UpdateCalls(minimum = 0): { count: () => number, reset: () => void } {
    let calls = 0
    const original = Sha256.prototype.update
    vi.spyOn(Sha256.prototype, 'update').mockImplementation(function (this: Sha256, data: Uint8Array) {
        if (data.length >= minimum) {
            calls++
        }
        return original.call(this, data)
    })
    return { count: () => calls, reset: () => { calls = 0 } }
}
describe('ChunkMemo', () => {
    test('rule test: it answers only for the exact payload, type and identity it remembered', () => {
        const memo = new ChunkMemo()
        const id = `${FAMILY}0`
        expect(memo.remember(id, CHUNK, 'aaaa', 'digest-a')).toBe(true)
        expect(memo.digestOf(id, CHUNK, 'aaaa')).toBe('digest-a')
        // The same length, another text: a memo that compared lengths would answer.
        expect(memo.digestOf(id, CHUNK, 'aaab')).toBeUndefined()
        expect(memo.digestOf(id, CHUNK, 'aaa')).toBeUndefined()
        expect(memo.digestOf(id, UNIT_TYPE.chatCore, 'aaaa')).toBeUndefined()
        expect(memo.digestOf(`${FAMILY}1`, CHUNK, 'aaaa')).toBeUndefined()
    })

    test('rule test: remembering an identity again replaces its text and its charge', () => {
        const memo = new ChunkMemo()
        const id = `${FAMILY}0`
        memo.remember(id, CHUNK, 'a'.repeat(100), 'd1')
        memo.remember(id, CHUNK, 'b'.repeat(40), 'd2')
        expect(memo.digestOf(id, CHUNK, 'a'.repeat(100))).toBeUndefined()
        expect(memo.digestOf(id, CHUNK, 'b'.repeat(40))).toBe('d2')
        expect(memo.stats()).toEqual({ entries: 1, charged: chunkMemoChargeOf('b'.repeat(40)) })
    })

    test('G5 (rule test): a character over its cap is not remembered, and the total never passes the budget', () => {
        const text = 'x'.repeat(1000)
        const charge = chunkMemoChargeOf(text)
        // One character holds one text; the budget holds three characters.
        const memo = new ChunkMemo(charge * 2 - 1, charge * 3)
        const of = (entity: string, index: number): string => `chat:${entity}:c:chunk:${index}`
        expect(memo.remember(of('e1', 0), CHUNK, text, 'd')).toBe(true)
        expect(memo.remember(of('e1', 1), CHUNK, text, 'd')).toBe(false)
        expect(memo.stats().charged).toBeLessThanOrEqual(charge * 2 - 1)
        for (const entity of ['e2', 'e3', 'e4', 'e5', 'e6']) {
            memo.remember(of(entity, 0), CHUNK, text, 'd')
            expect(memo.stats().charged).toBeLessThanOrEqual(charge * 3)
        }
        expect(memo.stats()).toEqual({ entries: 3, charged: charge * 3 })
        // The oldest characters went first; the newest is held.
        expect(memo.digestOf(of('e1', 0), CHUNK, text)).toBeUndefined()
        expect(memo.digestOf(of('e6', 0), CHUNK, text)).toBe('d')
    })

    test('G5 (rule test): a lookup counts as use, so the least recently used character is the one dropped', () => {
        const text = 'x'.repeat(500)
        const charge = chunkMemoChargeOf(text)
        const memo = new ChunkMemo(charge, charge * 3)
        const of = (entity: string): string => `chat:${entity}:c:chunk:0`
        memo.remember(of('e1'), CHUNK, text, 'd')
        memo.remember(of('e2'), CHUNK, text, 'd')
        memo.remember(of('e3'), CHUNK, text, 'd')
        expect(memo.digestOf(of('e1'), CHUNK, text)).toBe('d')
        memo.remember(of('e4'), CHUNK, text, 'd')
        expect(memo.digestOf(of('e1'), CHUNK, text)).toBe('d')
        expect(memo.digestOf(of('e2'), CHUNK, text)).toBeUndefined()
    })

    test('G5 (rule test): a text larger than the whole budget is refused and evicts nothing', () => {
        const small = 'y'.repeat(100)
        const memo = new ChunkMemo(10_000, 10_000)
        memo.remember('chat:e1:c:chunk:0', CHUNK, small, 'd')
        expect(memo.remember('chat:e2:c:chunk:0', CHUNK, 'z'.repeat(6000), 'd')).toBe(false)
        expect(memo.digestOf('chat:e1:c:chunk:0', CHUNK, small)).toBe('d')
    })
})

describe('the memo in the unit sink', () => {
    test('rule test: a remembered chunk over an unchanged previous unit is taken without framing or digesting', () => {
        const memo = new ChunkMemo()
        const bodies = [bodyOf('a'.repeat(20_000)), bodyOf('b'.repeat(20_000))]
        const first = encodeChunks(bodies, null, 1, memo)
        const digests = sha256UpdateCalls()
        const second = encodeChunks(bodies, previousOf(first), 2, memo)
        expect(digests.count()).toBe(0)
        expect(second.map(unit => ({ key: unit.key, reused: unit.reused, digest: unit.digest, ref: unit.ref })))
            .toEqual(first.map(unit => ({ key: unit.key, reused: true, digest: unit.digest, ref: unit.ref })))
    })

    test('guard: the units with a memo are the units without one, for unchanged, edited and appended chunks', () => {
        const memo = new ChunkMemo()
        const original = [bodyOf('a'.repeat(300)), bodyOf('b'.repeat(300)), bodyOf('c'.repeat(300))]
        const first = encodeChunks(original, null, 1, memo)
        const changes: Record<string, object[]> = {
            unchanged: original,
            'same length edit': [original[0], bodyOf('b'.repeat(299) + 'X'), original[2]],
            appended: [...original, bodyOf('d')],
            'first deleted': original.slice(1),
            'two swapped': [original[1], original[0], original[2]],
        }
        for (const [label, bodies] of Object.entries(changes)) {
            const withMemo = encodeChunks(bodies, previousOf(first), 9, memo)
            const without = encodeChunks(bodies, previousOf(first), 9)
            expect(withMemo, label).toEqual(without)
        }
    })

    test('guard: a same-length edit of a remembered chunk is written, with the new bytes and digest', () => {
        const memo = new ChunkMemo()
        const before = bodyOf('m'.repeat(500))
        const edited = bodyOf('m'.repeat(499) + 'N')
        const first = encodeChunks([before], null, 1, memo)
        const [unit] = encodeChunks([edited], previousOf(first), 2, memo)
        expect(unit.reused).toBe(false)
        expect(unit.digest).toBe(digestOfBody(edited))
        expect(unit.key).not.toBe(first[0].key)
    })

    test('R4b (guard): the previous unit holds other text than the memo remembers: the chunk is written, not taken', () => {
        const memo = new ChunkMemo()
        const p1 = bodyOf('p'.repeat(400) + '1')
        const p2 = bodyOf('p'.repeat(400) + '2')
        // The memo remembers P1 at chunk 0; another encoder has since committed P2 there.
        const rememberedP1 = encodeChunks([p1], null, 1, memo)
        const peer = encodeChunks([p2], null, 3)
        expect(rememberedP1[0].digest).not.toBe(peer[0].digest)
        const [unit] = encodeChunks([p1], previousOf(peer), 4, memo)
        expect(unit.reused).toBe(false)
        expect(unit.key).not.toBe(peer[0].key)
        expect(unit.digest).toBe(digestOfBody(p1))
    })

    test('guard: a previous key already claimed by another chunk is never taken twice', () => {
        const memo = new ChunkMemo()
        const a = bodyOf('a'.repeat(300))
        const b = bodyOf('b'.repeat(300))
        // Chunk 1 is remembered with text B over its previous unit B.
        const first = encodeChunks([a, b], null, 1, memo)
        // Now chunk 0 holds B too: it takes the previous key of chunk 1 through the family, so chunk 1 must not take it again.
        const withMemo = encodeChunks([b, b], previousOf(first), 5, memo)
        const without = encodeChunks([b, b], previousOf(first), 5)
        expect(withMemo).toEqual(without)
        expect(withMemo[0].reused).toBe(true)
        expect(withMemo[0].key).toBe(first[1].key)
        expect(withMemo[1].reused).toBe(false)
        expect(withMemo[1].key).not.toBe(first[1].key)
        expect(new Set(withMemo.map(unit => unit.key)).size).toBe(2)
    })

    test('guard: a previous unit without a digest or with kept bytes is never taken', () => {
        const memo = new ChunkMemo()
        const body = bodyOf('k'.repeat(400))
        const first = encodeChunks([body], null, 1, memo)
        const noDigest: PreviousEncoding = {
            units: new Map([[first[0].identity, { key: first[0].key, type: CHUNK, ref: first[0].ref }]]), entities: new Map(),
        }
        const [rewritten] = encodeChunks([body], noDigest, 2, memo)
        expect(rewritten.reused).toBe(false)
        const written = first[0]
        if (!isWrittenUnit(written)) {
            throw new Error('The first encode must have written the chunk.')
        }
        const tampered = new Uint8Array(written.bytes)
        tampered[tampered.length - 1] ^= 0xff
        const kept: PreviousEncoding = {
            units: new Map([[written.identity, { key: written.key, type: CHUNK, ref: written.ref, digest: written.digest, bytes: tampered }]]),
            entities: new Map(),
        }
        const [afterKept] = encodeChunks([body], kept, 3, memo)
        expect(afterKept.reused).toBe(false)
    })

    test('guard: a reuse-only sink with a memo never reaches the memo', () => {
        const body = bodyOf('r'.repeat(400))
        const first = encodeChunks([body], null, 1, new ChunkMemo())
        const memo = new ChunkMemo()
        const sink = new UnitSink(seededEnv(2), previousOf(first), undefined, { reuseOnly: true })
        expect(sink.putReusing(`${FAMILY}0`, CHUNK, body, FAMILY).reused).toBe(true)
        expect(memo.stats().entries).toBe(0)
    })
})

describe('the memo in the save encoder', () => {
    function mintOf(seed: number) {
        const env = seededEnv(seed)
        return { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) }
    }

    /** One marked pass; returns the chunk-sized SHA-256 updates its plan made (build and acknowledge are not counted). */
    async function pass(encoder: ReturnType<typeof createSaveEncoder>, digests: { count: () => number, reset: () => void }, db: Database, chaId: string, seq: number): Promise<number> {
        digests.reset()
        const plan = await encoder.plan(db, { marked: new Set([chaId]), modules: false, whole: false })
        const big = digests.count()
        plan.commitRequest().build({ mint: mintOf(seq + 100), seq, now: NOW })
        plan.acknowledge()
        return big
    }

    test('R4 (reproducer): a second marked pass over a long chat with one appended message digests only the changed chunk', async () => {
        const db = profileWithChats([buildT5Chat(1200)])
        const first = encodeWith(db, { env: seededEnv(1) })
        const bigChunks = first.units.filter(unit => isWrittenUnit(unit) && unit.identity.includes(':chunk:') && unit.bytes.length >= BIG_UPDATE).length
        expect(bigChunks).toBeGreaterThanOrEqual(10)
        const slot = (db as unknown as { characters: Obj[] }).characters[0]
        const chaId = slot.chaId as string
        const encoder = createSaveEncoder({ previous: previousFrom(first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const messages = (slot.chats as Obj[])[0].message as Obj[]
        const digests = sha256UpdateCalls(BIG_UPDATE)

        slot.desc = 'edit 0'
        // The first pass has nothing remembered: it digests every chunk.
        expect(await pass(encoder, digests, db, chaId, 2)).toBeGreaterThanOrEqual(bigChunks)
        expect(encoder.chunkMemoStats().entries).toBeGreaterThanOrEqual(bigChunks)

        const { chatId: _chatId, ...rest } = messages[messages.length - 1]
        messages.push({ ...rest, data: 'appended' })
        expect(await pass(encoder, digests, db, chaId, 3)).toBeLessThanOrEqual(2)
    })

    test('guard: the memo stays within its own budget over passes of a long chat', async () => {
        const db = profileWithChats([buildT5Chat(1200)])
        const first = encodeWith(db, { env: seededEnv(1) })
        const slot = (db as unknown as { characters: Obj[] }).characters[0]
        const encoder = createSaveEncoder({ previous: previousFrom(first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const digests = sha256UpdateCalls(BIG_UPDATE)
        for (let rep = 0; rep < 3; rep++) {
            slot.desc = `edit ${rep}`
            await pass(encoder, digests, db, slot.chaId as string, rep + 2)
        }
        const { entries, charged } = encoder.chunkMemoStats()
        expect(entries).toBeGreaterThan(0)
        expect(charged).toBeLessThanOrEqual(64 * 1024 * 1024)
    })
})