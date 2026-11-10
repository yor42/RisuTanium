// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'

const counts = vi.hoisted(() => ({ shardEncodes: 0, stubTags: 0 }))

vi.mock('../../store2/format', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../store2/format')>()
    return {
        ...original,
        encodeUnit: (type: Parameters<typeof original.encodeUnit>[0], body: object) => {
            if (type === original.UNIT_TYPE.shard) {
                counts.shardEncodes++
            }
            return original.encodeUnit(type, body as never)
        },
    }
})

vi.mock('../../../process/coldCharacter', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../../process/coldCharacter')>()
    return {
        ...original,
        stubTags: (slot: Parameters<typeof original.stubTags>[0]) => {
            // The resident hot character legitimately builds its tags; only a stub's overlay is under test.
            if ((slot as { coldstorage?: unknown }).coldstorage) {
                counts.stubTags++
            }
            return original.stubTags(slot)
        },
    }
})

import type { Database } from '../../database.svelte'
import { createMemoryBackend } from '../../store2/backend'
import { previousEntriesOf, previousFrom, shardOfU, type EncodedTree, type PreviousEncoding } from '../../store2/codec'
import { newManifestKey, newShardKey, newUnitKey } from '../../store2/format/keys'
import { previousOfTree } from '../../store2/previousOfTree'
import { createSaveEncoder, type SaveEncoder } from '../../store2/saveEncoder'
import { readTreeBytes } from '../../store2/treeBytes'
import { buildColdStub, stubDescription } from '../../../process/coldCharacter'
import { createClock, seedTree, testEnv } from '../store2SaveKit'
import { buildT4, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'

/**
 * The fixed per-pass cost of a marked pass over a profile of mostly stubs: a shard whose entries are the previous
 * shard's entry objects takes the previous unit without being framed, and an overlay that changes nothing returns the
 * previous entry. Labels: reproducer (fails on the pre-change base), guard (passes before and after).
 */

const NOW = 1_700_000_000_000
const RESIDENT = 30

function mintOf(seed: number) {
    const env = seededEnv(seed)
    return { shard: () => newShardKey(env), unit: () => newUnitKey(env), manifest: () => newManifestKey(env) }
}

interface Live {
    db: Obj
    characters: Obj[]
    first: EncodedTree
}

/** T4 with the characters past `RESIDENT` replaced by real cold stubs over the entity ids of a real encode. */
function stubbedLive(): Live {
    const base = buildT4().db as unknown as Obj
    const characters = (base.characters as Obj[])
    // Stub images and notes exist so that a removal and a change are both observable.
    characters.forEach((slot, index) => {
        slot.image = `img-${index}.png`
    })
    const first = encodeWith(base as unknown as Database, { env: seededEnv(1) })
    const stubbed = characters.map((slot, index) => {
        if (index < RESIDENT) {
            return slot
        }
        const u = first.index.entities.get(`${slot.chaId as string}#0`) as string
        return buildColdStub(JSON.parse(JSON.stringify(slot)), u, ['c']) as unknown as Obj
    })
    const db = { ...base, characters: stubbed, characterOrder: stubbed.map(slot => slot.chaId) }
    return { db, characters: stubbed, first }
}

interface PassCounts {
    plan: number
    build: number
}

async function pass(encoder: SaveEncoder, live: Live, marked: string[], seq: number): Promise<PassCounts> {
    counts.shardEncodes = 0
    const plan = await encoder.plan(live.db as unknown as Database, { marked: new Set(marked), modules: false, whole: false })
    const planned = counts.shardEncodes
    plan.commitRequest().build({ mint: mintOf(seq + 100), seq, now: NOW })
    const built = counts.shardEncodes - planned
    plan.acknowledge()
    return { plan: planned, build: built }
}

function chaIdOf(slot: Obj): string {
    return slot.chaId as string
}

describe('shard reuse on a marked pass over mostly stubs', () => {
    test('R1 (reproducer): three consecutive marked passes frame only the hot shard, plan window and build window counted', async () => {
        const live = stubbedLive()
        const encoder = createSaveEncoder({ previous: previousFrom(live.first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const hot = live.characters[0]
        const passes: PassCounts[] = []
        for (let rep = 0; rep < 3; rep++) {
            hot.desc = `edit ${rep}`
            passes.push(await pass(encoder, live, [chaIdOf(hot)], rep + 2))
        }
        // The plan frames the written shard once; the build frames it again under its real keys.
        expect(passes.map(entry => entry.plan)).toEqual([1, 1, 1])
        expect(passes.map(entry => entry.build)).toEqual([1, 1, 1])
    })

    test('R1b (reproducer): a shard written by an earlier pass and a shard skipped by an earlier pass are both skipped later', async () => {
        const live = stubbedLive()
        const previous: PreviousEncoding = previousFrom(live.first)
        const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const shardCount = previous.objects?.manifest?.shardCount ?? 0
        expect(shardCount).toBe(32)
        const hot = live.characters[0]
        const hotShard = shardOfU(previous.entities.get(`${chaIdOf(hot)}#0`) as string, shardCount)
        const other = live.characters.slice(RESIDENT).find(slot => shardOfU(slot.coldstorage as string, shardCount) !== hotShard) as Obj
        const passes: PassCounts[] = []
        // Pass 1 frames the stub's shard and the marked hot character's shard (its entry is rebuilt, so it is not the
        // previous object); pass 2 only the hot shard, whatever pass 1 wrote or skipped; pass 3 the same.
        other.name = 'Renamed stub'
        passes.push(await pass(encoder, live, [chaIdOf(hot)], 2))
        hot.desc = 'edit a'
        passes.push(await pass(encoder, live, [chaIdOf(hot)], 3))
        hot.desc = 'edit b'
        passes.push(await pass(encoder, live, [chaIdOf(hot)], 4))
        expect(passes.map(entry => entry.plan)).toEqual([2, 1, 1])
    })

    test('R2 (reproducer): an unchanged stub keeps its previous entry object and stubTags is not called for it', async () => {
        const live = stubbedLive()
        const encoder = createSaveEncoder({ previous: previousFrom(live.first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const hot = live.characters[0]
        const stub = live.characters[RESIDENT + 5]
        const u = stub.coldstorage as string
        const before = previousEntriesOf(encoder.acknowledged()).get(u)
        expect(before).toBeDefined()
        counts.stubTags = 0
        for (let rep = 0; rep < 2; rep++) {
            hot.desc = `edit ${rep}`
            await pass(encoder, live, [chaIdOf(hot)], rep + 2)
        }
        expect(counts.stubTags).toBe(0)
        expect(previousEntriesOf(encoder.acknowledged()).get(u)).toBe(before)
    })

    test('G1 (reproducer half, boot route): the first pass after a boot frames every shard once, the second only the written one', async () => {
        const world = createMemoryBackend()
        const clock = createClock()
        const db = JSON.parse(JSON.stringify(buildT4().db)) as Database
        const seeded = await seedTree(world, JSON.parse(JSON.stringify(db)) as Database, testEnv(clock, 3), fakeLists)
        const read = await readTreeBytes(world, seeded.manifestKey)
        if (read.status !== 'ok') {
            throw new Error('The seeded tree did not read ok.')
        }
        const previous = previousOfTree(read.tree)
        const encoder = createSaveEncoder({ previous, lists: fakeLists, env: seededEnv(78), now: () => NOW })
        const slots = (db as unknown as { characters: Obj[] }).characters
        const live: Live = { db: db as unknown as Obj, characters: slots, first: seeded.tree }
        const hot = slots[0]
        hot.desc = 'edit 0'
        const first = await pass(encoder, live, [chaIdOf(hot)], 2)
        hot.desc = 'edit 1'
        const second = await pass(encoder, live, [chaIdOf(hot)], 3)
        expect(first.plan).toBe(previous.objects?.manifest?.shardCount)
        expect(second.plan).toBe(1)
    })
})

interface FieldRow {
    label: string
    change: (slot: Obj) => void
    expected: (slot: Obj) => Obj
}

describe('G2 (guard): every overlaid field of a stub reaches the committed entry', () => {
    const rows: FieldRow[] = [
        { label: 'name', change: (slot) => { slot.name = 'New name' }, expected: () => ({ name: 'New name' }) },
        { label: 'creatorNotes', change: (slot) => { slot.creatorNotes = 'Fresh notes' }, expected: () => ({ creatorNotes: stubDescription('Fresh notes') }) },
        { label: 'image set', change: (slot) => { slot.image = 'other.png' }, expected: () => ({ image: 'other.png' }) },
        { label: 'image absent', change: (slot) => { delete slot.image }, expected: () => ({ image: undefined }) },
        { label: 'lastInteraction set', change: (slot) => { slot.lastInteraction = 12345 }, expected: () => ({ lastInteraction: 12345 }) },
        { label: 'trashTime set', change: (slot) => { slot.trashTime = 777 }, expected: () => ({ trashTime: 777 }) },
        { label: 'tags', change: (slot) => { slot.tags = ['alpha', 'beta'] }, expected: () => ({ tags: ['alpha', 'beta'] }) },
        { label: 'additionalData.creator', change: (slot) => { slot.additionalData = { creator: 'Editor' } }, expected: () => ({ creator: 'Editor' }) },
        { label: 'top-level creator', change: (slot) => { slot.creator = 'Author' }, expected: () => ({ creator: 'Author' }) },
    ]
    test.each(rows)('$label', async (row) => {
        const live = stubbedLive()
        const encoder = createSaveEncoder({ previous: previousFrom(live.first), lists: fakeLists, env: seededEnv(77), now: () => NOW })
        const stub = live.characters[RESIDENT + 7]
        const u = stub.coldstorage as string
        const hot = live.characters[0]
        // A first pass with no change, so the change below is judged against an acknowledged unchanged-stub encoding.
        hot.desc = 'edit 0'
        await pass(encoder, live, [chaIdOf(hot)], 2)
        row.change(stub)
        hot.desc = 'edit 1'
        await pass(encoder, live, [chaIdOf(hot)], 3)
        const entry = previousEntriesOf(encoder.acknowledged()).get(u) as unknown as Obj
        for (const [key, value] of Object.entries(row.expected(stub))) {
            expect(entry[key]).toEqual(value)
        }
    })
})
