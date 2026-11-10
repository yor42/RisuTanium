// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { Database } from '../../database.svelte'
import {
    isWrittenUnit, planScopedEncode, previousFrom,
    type EncodedTree, type EncodeOptions, type EncodeScope, type PreviousEncoding, type ReusableUnit,
} from '../../store2/codec'
import { ChunkMemo } from '../../store2/codec/chunkMemo'
import { createKeyMint, type KeyMint } from '../../store2/commit'
import { UNIT_TYPE } from '../../store2/format'
import { buildColdStub } from '../../../process/coldCharacter'
import { createClock, testEnv } from '../store2SaveKit'
import { buildSmall, buildT5Chat, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The differential oracle of unit reuse (guard: it passes on the pre-change base, where both arms run the same code).
 * Optimised arm: the previous encoding as the encoder produced it, so shard bodies are trusted and unchanged shards are
 * taken without being framed. Reference arm: the same previous with every shard body replaced by a deep copy, which
 * nothing has noted, so every shard is framed and digested and no entry is the previous object. Both arms must name
 * the same units under the same mint: identity, key, type, Ref, digest, reused flag, bytes, the index and the manifest.
 */

const NOW = 1_700_000_000_000
const RESIDENT = 12

interface Live {
    db: Obj
    characters: Obj[]
    hot: Obj
}

function chaIdOf(slot: Obj): string {
    return slot.chaId as string
}

function mintOf(): KeyMint {
    return createKeyMint(testEnv(createClock(), 9), null).mint
}

function optionsOf(previous: PreviousEncoding, seed: number, chunkMemo?: ChunkMemo): EncodeOptions {
    return { env: seededEnv(seed), lists: fakeLists, seq: 3, createdAt: NOW, previous, ...(chunkMemo === undefined ? {} : { chunkMemo }) }
}

function withoutDigests(encoding: PreviousEncoding): PreviousEncoding {
    const units = new Map<string, ReusableUnit>()
    for (const [identity, unit] of encoding.units) {
        units.set(identity, { key: unit.key, type: unit.type, ref: unit.ref })
    }
    return { ...encoding, units }
}

function untrusted(encoding: PreviousEncoding): PreviousEncoding {
    const objects = encoding.objects
    if (objects?.shards === undefined) {
        throw new Error('The previous encoding holds no shards.')
    }
    return { ...encoding, objects: { ...objects, shards: structuredClone(objects.shards) } }
}

/** A profile of `size` characters; the ones past `RESIDENT` are real cold stubs over a real encode's entity ids. */
function liveOf(size: number): { live: Live, first: EncodedTree } {
    const db = buildSmall(size) as unknown as Obj
    const slots = db.characters as Obj[]
    slots.forEach((slot, index) => {
        slot.image = `img-${index}.png`
        slot.tags = [`tag-${index % 5}`]
    })
    // One long chat, so a pass over the hot character has several chunks.
    slots[0].chats = [buildT5Chat(120), ...(slots[0].chats as Obj[]).slice(1)]
    const first = encodeWith(db as unknown as Database, { env: seededEnv(1) })
    const characters = slots.map((slot, index) => {
        if (index < RESIDENT) {
            return slot
        }
        const u = first.index.entities.get(`${chaIdOf(slot)}#0`) as string
        return buildColdStub(JSON.parse(JSON.stringify(slot)), u, ['c']) as unknown as Obj
    })
    const stubbed = { ...db, characters, characterOrder: characters.map(chaIdOf) }
    return { live: { db: stubbed, characters, hot: characters[0] }, first }
}

function chatOf(slot: Obj, index = 0): Obj {
    return (slot.chats as Obj[])[index]
}

function messagesOf(slot: Obj, index = 0): Obj[] {
    return chatOf(slot, index).message as Obj[]
}

/** The state both arms start from: one acknowledged pass over the stubbed profile, finalised under a fixed mint. */
async function acknowledgedTree(
    live: Live, first: EncodedTree, desc = 'acknowledged edit', previous = previousFrom(first), chunkMemo?: ChunkMemo,
): Promise<EncodedTree> {
    live.hot.desc = desc
    const plan = await planScopedEncode(
        live.db as unknown as Database,
        optionsOf(previous, 5, chunkMemo),
        { modules: false, characters: new Set([chaIdOf(live.hot)]) },
    )
    return plan.finalize({ mint: mintOf(), seq: 2, now: NOW })
}

async function acknowledged(live: Live, first: EncodedTree, chunkMemo?: ChunkMemo): Promise<PreviousEncoding> {
    return previousFrom(await acknowledgedTree(live, first, 'acknowledged edit', previousFrom(first), chunkMemo))
}

function described(tree: EncodedTree): object {
    return {
        manifestKey: tree.manifestKey,
        manifest: tree.manifest,
        units: tree.units.map(unit => ({
            identity: unit.identity, key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest, reused: unit.reused,
            bytes: isWrittenUnit(unit) ? unit.bytes : null,
        })),
        indexUnits: [...tree.index.units],
    }
}

interface Scenario {
    label: string
    size?: number
    /** Changes the live profile and returns the scope of the pass; `previous` may be replaced. */
    apply: (live: Live, previous: PreviousEncoding) => { scope: EncodeScope, previous?: PreviousEncoding }
}

const HOT_ONLY = (live: Live): EncodeScope => ({ modules: false, characters: new Set([chaIdOf(live.hot)]) })

const SCENARIOS: Scenario[] = [
    { label: 'nothing changed', apply: live => ({ scope: HOT_ONLY(live) }) },
    { label: 'stub renamed', apply: (live) => { live.characters[RESIDENT + 3].name = 'Renamed'; return { scope: HOT_ONLY(live) } } },
    { label: 'stub image removed', apply: (live) => { delete live.characters[RESIDENT + 4].image; return { scope: HOT_ONLY(live) } } },
    { label: 'stub tags edited', apply: (live) => { live.characters[RESIDENT + 5].tags = ['edited']; return { scope: HOT_ONLY(live) } } },
    { label: 'stub trashed', apply: (live) => { live.characters[RESIDENT + 6].trashTime = 99; return { scope: HOT_ONLY(live) } } },
    { label: 'stub creator edited', apply: (live) => { live.characters[RESIDENT + 7].additionalData = { creator: 'Editor' }; return { scope: HOT_ONLY(live) } } },
    {
        label: 'hot chat appended',
        apply: (live) => {
            const messages = messagesOf(live.hot)
            messages.push({ ...messages[messages.length - 1], data: 'appended' })
            return { scope: HOT_ONLY(live) }
        },
    },
    {
        label: 'middle message edited with the same length',
        apply: (live) => {
            const message = messagesOf(live.hot)[60]
            message.data = 'X'.repeat((message.data as string).length)
            return { scope: HOT_ONLY(live) }
        },
    },
    { label: 'message deleted', apply: (live) => { messagesOf(live.hot).splice(40, 1); return { scope: HOT_ONLY(live) } } },
    { label: 'first message deleted', apply: (live) => { messagesOf(live.hot).splice(0, 1); return { scope: HOT_ONLY(live) } } },
    { label: 'chat removed', apply: (live) => { (live.hot.chats as Obj[]).splice(1, 1); return { scope: HOT_ONLY(live) } } },
    {
        label: 'hot character and a stub together',
        apply: (live) => {
            live.characters[RESIDENT + 1].name = 'Both'
            live.hot.desc = 'both'
            return { scope: HOT_ONLY(live) }
        },
    },
    {
        label: 'shard count grows at 257 characters',
        size: 256,
        apply: (live) => {
            const added = JSON.parse(JSON.stringify(live.characters[1])) as Obj
            added.chaId = 'added-character'
            live.characters.push(added);
            (live.db as { characterOrder: string[] }).characterOrder.push('added-character')
            return { scope: { modules: false, characters: new Set([chaIdOf(live.hot), 'added-character']) } }
        },
    },
    {
        label: 'rewrite all over a previous with no digests',
        apply: (live, previous) => ({ scope: { modules: true, characters: 'all' }, previous: withoutDigests(previous) }),
    },
]

describe('the optimised unit reuse names the units the unoptimised encode names', () => {
    test.each(SCENARIOS)('$label', async (scenario) => {
        const { live, first } = liveOf(scenario.size ?? 300)
        const previous = await acknowledged(live, first)
        const changed = scenario.apply(live, previous)
        const base = changed.previous ?? previous
        const optimised = await planScopedEncode(live.db as unknown as Database, optionsOf(base, 6), changed.scope)
        const reference = await planScopedEncode(live.db as unknown as Database, optionsOf(untrusted(base), 6), changed.scope)
        expect({ newUnits: optimised.newUnits, unchanged: optimised.unchanged, carried: optimised.carried.units, encoded: optimised.encoded })
            .toEqual({ newUnits: reference.newUnits, unchanged: reference.unchanged, carried: reference.carried.units, encoded: reference.encoded })
        expect(described(optimised.finalize({ mint: mintOf(), seq: 3, now: NOW })))
            .toEqual(described(reference.finalize({ mint: mintOf(), seq: 3, now: NOW })))
    })

    test('a previous whose units belong to another encoding than its shard bodies: a shard whose unit digest differs is framed, not taken', async () => {
        const { live, first } = liveOf(300)
        const treeA = await acknowledgedTree(live, first)
        const treeB = await acknowledgedTree(live, first, 'another edit', previousFrom(treeA))
        live.hot.desc = 'acknowledged edit'
        const mixed: PreviousEncoding = { ...previousFrom(treeA), units: previousFrom(treeB).units }
        const scope = { modules: false, characters: new Set<string>() }
        const optimised = await planScopedEncode(live.db as unknown as Database, optionsOf(mixed, 6), scope)
        const reference = await planScopedEncode(live.db as unknown as Database, optionsOf(untrusted(mixed), 6), scope)
        expect(optimised.newUnits).toBeGreaterThan(1)
        expect(described(optimised.finalize({ mint: mintOf(), seq: 3, now: NOW })))
            .toEqual(described(reference.finalize({ mint: mintOf(), seq: 3, now: NOW })))
    })

    test('a previous that kept unit bytes: a shard whose kept bytes differ is written, not taken', async () => {
        const { live, first } = liveOf(300)
        const tree = await acknowledgedTree(live, first)
        const written = tree.units.find(unit => unit.type === UNIT_TYPE.shard && !unit.reused)
        if (written === undefined || written.reused) {
            throw new Error('The acknowledged pass wrote no shard.')
        }
        const keptWhole = previousFrom(tree, true)
        const unit = keptWhole.units.get(written.identity)
        if (unit?.bytes === undefined) {
            throw new Error('The written shard kept no bytes.')
        }
        const tampered = new Uint8Array(unit.bytes)
        tampered[tampered.length - 1] ^= 0xff
        const kept: PreviousEncoding = { ...keptWhole, units: new Map([...keptWhole.units, [written.identity, { ...unit, bytes: tampered }]]) }
        // Nothing is marked: every entry of the written shard is the previous object, so only the kept bytes can refuse the reuse.
        const plan = await planScopedEncode(live.db as unknown as Database, optionsOf(kept, 6), { modules: false, characters: new Set<string>() })
        const result = plan.finalize({ mint: mintOf(), seq: 3, now: NOW })
        expect(result.units.find(candidate => candidate.identity === written.identity)?.reused).toBe(false)
    })

    test('a second pass over the optimised arm names the same units as its reference too', async () => {
        const { live, first } = liveOf(300)
        let optimisedPrevious = await acknowledged(live, first)
        let referencePrevious = optimisedPrevious
        for (let rep = 0; rep < 3; rep++) {
            live.hot.desc = `edit ${rep}`
            live.characters[RESIDENT + rep].name = `Stub ${rep}`
            const optimised = await planScopedEncode(live.db as unknown as Database, optionsOf(optimisedPrevious, 7 + rep), HOT_ONLY(live))
            const reference = await planScopedEncode(live.db as unknown as Database, optionsOf(untrusted(referencePrevious), 7 + rep), HOT_ONLY(live))
            const optimisedTree = optimised.finalize({ mint: mintOf(), seq: 3 + rep, now: NOW })
            const referenceTree = reference.finalize({ mint: mintOf(), seq: 3 + rep, now: NOW })
            expect(described(optimisedTree)).toEqual(described(referenceTree))
            optimisedPrevious = previousFrom(optimisedTree)
            referencePrevious = previousFrom(referenceTree)
        }
    })
})

/**
 * The same oracle for the chunk memo. Optimised arm: the memo warmed by the acknowledged pass, so a chunk with the
 * remembered text over a previous unit with the remembered digest is taken without being framed. Reference arm: no memo
 * and untrusted shard bodies. Both must name the same units under the same mint.
 */
describe('the chunk memo names the units the unmemoised encode names', () => {
    test.each(SCENARIOS)('$label', async (scenario) => {
        const { live, first } = liveOf(scenario.size ?? 300)
        const memo = new ChunkMemo()
        const previous = await acknowledged(live, first, memo)
        expect(memo.stats().entries).toBeGreaterThan(0)
        const changed = scenario.apply(live, previous)
        const base = changed.previous ?? previous
        const memoised = await planScopedEncode(live.db as unknown as Database, optionsOf(base, 6, memo), changed.scope)
        const reference = await planScopedEncode(live.db as unknown as Database, optionsOf(untrusted(base), 6), changed.scope)
        expect({ newUnits: memoised.newUnits, unchanged: memoised.unchanged, carried: memoised.carried.units, encoded: memoised.encoded })
            .toEqual({ newUnits: reference.newUnits, unchanged: reference.unchanged, carried: reference.carried.units, encoded: reference.encoded })
        expect(described(memoised.finalize({ mint: mintOf(), seq: 3, now: NOW })))
            .toEqual(described(reference.finalize({ mint: mintOf(), seq: 3, now: NOW })))
    })

    test('the previous unit holds another text than the memo remembers (a peer committed an edit): the chunk is written, not taken', async () => {
        const { live, first } = liveOf(300)
        const memo = new ChunkMemo()
        const previous = await acknowledged(live, first, memo)
        const message = messagesOf(live.hot)[60]
        const original = message.data as string
        message.data = 'X'.repeat(original.length)
        // Another encoder commits that edit under its own keys, so no fresh key of the peer is a key this encode holds.
        const peerPlan = await planScopedEncode(live.db as unknown as Database, optionsOf(previous, 5), HOT_ONLY(live))
        const peer = previousFrom(peerPlan.finalize({ mint: createKeyMint(testEnv(createClock(), 31), null).mint, seq: 2, now: NOW }))
        message.data = original
        const memoised = await planScopedEncode(live.db as unknown as Database, optionsOf(peer, 6, memo), HOT_ONLY(live))
        const reference = await planScopedEncode(live.db as unknown as Database, optionsOf(untrusted(peer), 6), HOT_ONLY(live))
        const memoisedTree = memoised.finalize({ mint: mintOf(), seq: 3, now: NOW })
        expect(described(memoisedTree)).toEqual(described(reference.finalize({ mint: mintOf(), seq: 3, now: NOW })))
        expect(memoisedTree.units.some(unit => unit.identity.includes(':chunk:') && !unit.reused)).toBe(true)
    })

    test('three passes in a row with the memo carried between them name the same units as the reference', async () => {
        const { live, first } = liveOf(300)
        const memo = new ChunkMemo()
        let memoisedPrevious = await acknowledged(live, first, memo)
        let referencePrevious = memoisedPrevious
        for (let rep = 0; rep < 3; rep++) {
            live.hot.desc = `edit ${rep}`
            const messages = messagesOf(live.hot)
            messages.push({ ...messages[messages.length - 1], data: `appended ${rep}` })
            messagesOf(live.hot)[10 + rep].data = `rewritten ${rep}`
            const memoised = await planScopedEncode(live.db as unknown as Database, optionsOf(memoisedPrevious, 7 + rep, memo), HOT_ONLY(live))
            const reference = await planScopedEncode(live.db as unknown as Database, optionsOf(untrusted(referencePrevious), 7 + rep), HOT_ONLY(live))
            const memoisedTree = memoised.finalize({ mint: mintOf(), seq: 3 + rep, now: NOW })
            const referenceTree = reference.finalize({ mint: mintOf(), seq: 3 + rep, now: NOW })
            expect(described(memoisedTree)).toEqual(described(referenceTree))
            memoisedPrevious = previousFrom(memoisedTree)
            referencePrevious = previousFrom(referenceTree)
        }
    })
})