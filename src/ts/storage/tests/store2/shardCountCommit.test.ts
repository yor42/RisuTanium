// @vitest-environment node
/**
 * Adaptive shard count (CHORE-412 stage 1), through the real producer: `encodeDatabase`, `createSaveEncoder` and the
 * committer over the memory backend.
 *
 * - Regression reproducer: at 500 characters a one-character edit rewrites one shard, so the mean shard bytes per edit
 *   is bounded (it failed at about 22 KB on this fixture with the fixed 16 shards).
 * - Regression reproducer: the pass that adds the 257th character to a 16-shard store commits ordinarily with 32 shards
 *   (the count stayed 16 before).
 * - Same defect: after that pass the 32 shards are new keys, each entry sits at shardOfU(u, shardCount), and the mark
 *   keeps every unit the new manifest names.
 * - Compatibility guard: at 256 characters there are 16 shards (passes before and after).
 */
import { describe, expect, test } from 'vitest'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import { assembleDatabase, previousFrom, shardOfU, unitMapSource } from 'src/ts/storage/store2/codec'
import { keyOfTail, readUnit, refsOf, UNIT_TYPE, type Manifest, type Shard } from 'src/ts/storage/store2/format'
import { markLiveKeys } from 'src/ts/storage/store2/gc/mark'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createSaveEncoder } from 'src/ts/storage/store2/saveEncoder'
import { savedDatabase, seedTree } from '../store2SaveKit'
import { asDatabase, encodeWith, fakeLists, seededEnv, type Obj } from './codecFixtures'
import { committerOf, createClock, expectInvariant, parsedCommit, testEnv } from './commitFixtures'
import {
    appendRigText, buildCharactersProfile, measureRigPass, rigBase, rigRequest, RIG_NOW,
} from './writeAmplificationRig'

const KIB = 1024
/** Index of the unit-type byte in a framed unit. */
const SHARD_TYPE_BYTE = 5

describe('shard bytes per edit at 500 characters', () => {
    test('regression reproducer: the mean shard bytes written by a one-character edit stay within 15 KiB over 20 edits', async () => {
        const { db, characters } = buildCharactersProfile(500)
        const base = rigBase(db)
        let total = 0
        const edits = 20
        for (let edit = 0; edit < edits; edit++) {
            const target = characters[edit * 25]
            const pass = await measureRigPass(db, base, rigRequest([String(target.chaId)]), () => appendRigText(target, 'desc'))
            expect(pass.shardUnits).toBe(1)
            total += pass.shardBytes
        }
        expect(total / edits).toBeLessThanOrEqual(15 * KIB)
    })

    test('compatibility guard: at 256 characters there are 16 shards and a one-character edit rewrites one of them', async () => {
        const { db, characters } = buildCharactersProfile(256)
        const base = rigBase(db)
        const pass = await measureRigPass(db, base, rigRequest([String(characters[3].chaId)]), () => appendRigText(characters[3], 'desc'))
        expect(pass.shardCount).toBe(16)
        expect(pass.shardUnits).toBe(1)
    })
})

function manifestOf(entries: ReadonlyMap<string, Uint8Array>, key: string): Manifest {
    const bytes = entries.get(key)
    if (bytes === undefined) {
        throw new Error(`The manifest ${key} is not stored.`)
    }
    const parsed = readUnit(bytes, UNIT_TYPE.manifest)
    if (parsed.status !== 'ok') {
        throw new Error(`The manifest ${key} is ${parsed.status}.`)
    }
    return parsed.value.body as Manifest
}

function shardKeysOf(manifest: Manifest): string[] {
    return manifest.shards.map(ref => keyOfTail(ref[0]))
}

describe('a pass that grows the store past 256 characters', () => {
    async function growPast256() {
        const full = buildCharactersProfile(257)
        const newcomer = full.characters[256]
        const before = asDatabase({ ...(full.db as unknown as Obj), characters: full.characters.slice(0, 256), characterOrder: full.characters.slice(0, 256).map(slot => slot.chaId) })
        const clock = createClock()
        const memory = createMemoryBackend()
        const seeded = await seedTree(memory, before, testEnv(clock, 1))
        const seedManifest = manifestOf(memory.snapshot(), seeded.manifestKey)
        const encoder = createSaveEncoder({ previous: previousFrom(seeded.tree), lists: fakeLists, env: testEnv(clock, 5), now: () => RIG_NOW })
        const plan = await encoder.plan(full.db, rigRequest([String(newcomer.chaId)]))
        const committer = committerOf(memory, clock, 100)
        const result = await committer.commit(await committer.readCommit(), plan.commitRequest())
        return { full, before, newcomer, clock, memory, seeded, seedManifest, encoder, plan, result }
    }

    test('regression reproducer: the 257th character commits ordinarily with 32 shards, assembles equal, leaves no marker and the next pass is unchanged', async () => {
        const { full, newcomer, memory, seedManifest, encoder, plan, result } = await growPast256()
        expect(seedManifest.shardCount).toBe(16)
        expect(plan.encoded).toEqual([String(newcomer.chaId)])
        expect(plan.newUnits).toBeLessThanOrEqual(59)
        expect(result.status).toBe('committed')
        if (result.status !== 'committed') {
            throw new Error(`Expected committed, got ${result.status}.`)
        }
        expect(result.mode).toBe('ordinary')
        plan.acknowledge()

        const manifest = manifestOf(memory.snapshot(), result.manifestKey)
        expect(manifest.shardCount).toBe(32)
        expect(manifest.shards).toHaveLength(32)
        expect((await parsedCommit(memory)).staging).toBeNull()

        const independent = encodeWith(full.db, { env: seededEnv(3) })
        const expected = assembleDatabase(independent.manifest, unitMapSource(independent.units))
        const saved = await savedDatabase(memory)
        expect(saved.characters).toHaveLength(257)
        expect(saved).toEqual(expected)

        const next = await encoder.plan(full.db, rigRequest([String(newcomer.chaId)]))
        expect(next.unchanged).toBe(true)
        await expectInvariant(memory)
    })

    test('regression reproducer for the previous-count wiring: removing the character again keeps 32 shards and rewrites at most one (no flip across 256/257)', async () => {
        const { before, encoder, plan, result } = await growPast256()
        expect(result.status).toBe('committed')
        plan.acknowledge()
        const shrink = await encoder.plan(before, rigRequest())
        const { mint } = createKeyMint(seededEnv(900), null)
        const built = await shrink.commitRequest().build({ mint, seq: 3, now: RIG_NOW })
        expect(built.manifest.body.shardCount).toBe(32)
        const shardUnits = built.units.filter(unit => unit.bytes[SHARD_TYPE_BYTE] === UNIT_TYPE.shard)
        expect(shardUnits.length).toBeGreaterThanOrEqual(1)
        expect(shardUnits.length).toBeLessThanOrEqual(1)
    })

    test('regression reproducer (same defect as above): the 32 new shards are fresh keys, every entry sits at shardOfU of the manifest count and the mark keeps every unit the new manifest names', async () => {
        const { memory, seeded, seedManifest, result } = await growPast256()
        if (result.status !== 'committed') {
            throw new Error(`Expected committed, got ${result.status}.`)
        }
        const entries = memory.snapshot()
        const manifest = manifestOf(entries, result.manifestKey)
        const shardKeys = shardKeysOf(manifest)
        expect(shardKeys).toHaveLength(manifest.shardCount)
        let counted = 0
        shardKeys.forEach((key, index) => {
            const shard = readUnit(entries.get(key) as Uint8Array, UNIT_TYPE.shard)
            expect(shard.status).toBe('ok')
            if (shard.status !== 'ok') {
                return
            }
            for (const entry of (shard.value.body as Shard).entries) {
                expect(shardOfU(entry.u, manifest.shardCount)).toBe(index)
                counted++
            }
        })
        expect(counted).toBe(257)

        const marked = await markLiveKeys(memory, await memory.readCommit())
        expect(marked.status).toBe('marked')
        if (marked.status !== 'marked') {
            return
        }
        for (const target of refsOf(UNIT_TYPE.manifest, manifest)) {
            expect(marked.live.has(keyOfTail(target.tail)), `${target.path} is kept`).toBe(true)
        }
        const oldShardKeys = shardKeysOf(seedManifest)
        expect(oldShardKeys).toHaveLength(16)
        for (const oldKey of oldShardKeys) {
            expect(shardKeys).not.toContain(oldKey)
        }
        expect(seeded.manifestKey).not.toBe(result.manifestKey)
    })
})
