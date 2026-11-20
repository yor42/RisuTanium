// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    builtCommitOf, encodeScoped, IDENTITY, planScopedEncode, previousFrom, UnitSink, unitDigest, unitsToWrite,
    type ContentIndex, type EncodedTree, type EncodeOptions, type EncodeScope, type ReusableUnit,
} from '../../store2/codec'
import { checkBuiltUnits, createKeyMint } from '../../store2/commit'
import { encodeUnit, newUnitKey, refOfFrame, UNIT_TYPE, type UnitType } from '../../store2/format'
import {
    buildSmall, chat, dbWithCharacters, fakeLists, identitiesWhere, loreEntry, message, mulberry32, prosePool, seededEnv, sparseCharacter,
    unitOf, uuidLike, type Obj,
} from './codecFixtures'

/**
 * The content rule of `UnitSink` and its plumbing through the scoped encode (NEW-import-dedup stage 1). Every test here
 * asserts the new `content` option, which does not exist before the change: they are guards of the new rule, not
 * reproducers of the defect (re-importing stores no unit whose content is stored; that is asserted at the import).
 * Producer: the real scoped encode of `buildSmall`.
 */

const NOW = 1_700_000_000_000
const EVERYTHING: EncodeScope = { modules: true, characters: 'all' }
const NEVER_INDEXED: readonly UnitType[] = [UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.order]

function optionsOf(seed: number, extra: Partial<EncodeOptions> = {}): EncodeOptions {
    return { env: seededEnv(seed), lists: fakeLists, seq: 2, createdAt: NOW, ...extra }
}

/** The base: a complete tree under real keys. */
async function baseTree(db = buildSmall(6)): Promise<EncodedTree> {
    return encodeScoped(db, optionsOf(1, { seq: 1, keys: createKeyMint(seededEnv(50), null).mint }), EVERYTHING)
}

/** What an index over `tree` holds: every unit but the ones an import never takes (the manifest, shards and `order`). */
function contentOf(tree: EncodedTree): ContentIndex {
    const units = new Map<string, ReusableUnit[]>()
    for (const unit of tree.units) {
        if (NEVER_INDEXED.includes(unit.type)) {
            continue
        }
        const entry: ReusableUnit = { key: unit.key, type: unit.type, ref: unit.ref, digest: unit.digest }
        units.set(unit.digest, [...(units.get(unit.digest) ?? []), entry])
    }
    return { units }
}

function importOver(db: ReturnType<typeof buildSmall>, content: ContentIndex, seed = 2) {
    return planScopedEncode(db, optionsOf(seed, { content }), EVERYTHING)
}

describe('guard (new rule): a unit equal to a stored unit takes its key', () => {
    test('re-encoding the same profile with the base content writes only the manifest, shards and order, and every other unit is the base\'s', async () => {
        const base = await baseTree()
        const content = contentOf(base)
        const plan = await importOver(buildSmall(6), content)
        const { mint } = createKeyMint(seededEnv(60), null)
        const tree = plan.finalize({ mint, seq: 2, now: NOW })

        const baseKeys = new Set(base.units.map(unit => unit.key))
        const written = unitsToWrite(tree)
        expect(new Set(written.map(unit => unit.type))).toEqual(new Set(NEVER_INDEXED))
        expect(plan.newUnits).toBe(written.length)
        for (const unit of tree.units.filter(unit => !NEVER_INDEXED.includes(unit.type))) {
            expect(unit.reused, `${unit.identity} is reused`).toBe(true)
            expect(baseKeys.has(unit.key), `${unit.identity} holds a base key`).toBe(true)
        }
        // Chat chunks come through `putReusing`, the other units through `put`.
        expect(tree.units.some(unit => unit.type === UNIT_TYPE.chatChunk && unit.reused)).toBe(true)
        expect(tree.units.some(unit => unit.type === UNIT_TYPE.characterCore && unit.reused)).toBe(true)
    })

    test('a parent that is reused names only base Refs, and the entity ids of the import are new', async () => {
        const base = await baseTree()
        const plan = await importOver(buildSmall(6), contentOf(base))
        const tree = plan.finalize({ mint: createKeyMint(seededEnv(60), null).mint, seq: 2, now: NOW })

        const moduleIndex = unitOf(tree, IDENTITY.moduleIndex)
        expect(moduleIndex.reused).toBe(true)
        expect(moduleIndex.key).toBe(unitOf(base, IDENTITY.moduleIndex).key)
        const baseEntities = new Set(base.index.entities.values())
        expect(tree.index.entities.size).toBeGreaterThan(0)
        for (const entity of tree.index.entities.values()) {
            expect(baseEntities.has(entity)).toBe(false)
        }
        // Shard and order keys are all new.
        const baseKeys = new Set(base.units.map(unit => unit.key))
        for (const unit of tree.units.filter(unit => NEVER_INDEXED.includes(unit.type))) {
            expect(baseKeys.has(unit.key)).toBe(false)
        }
    })

    test('without a content index the same encode reuses nothing', async () => {
        const plan = await planScopedEncode(buildSmall(6), optionsOf(2), EVERYTHING)
        const tree = plan.finalize({ mint: createKeyMint(seededEnv(60), null).mint, seq: 2, now: NOW })
        expect(tree.units.some(unit => unit.reused)).toBe(false)
        expect(plan.carried.units).toBe(0)
    })
})

describe('guard (new rule): the counts of a plan over a content index (I4)', () => {
    test('reused units keep base keys, the built commit passes the attempt\'s unit check, and carried.units is the reused count', async () => {
        const base = await baseTree()
        const plan = await importOver(buildSmall(6), contentOf(base))
        const { mint, issued } = createKeyMint(seededEnv(60), null)
        const tree = plan.finalize({ mint, seq: 2, now: NOW })

        const reused = tree.units.filter(unit => unit.reused)
        expect(reused.length).toBeGreaterThan(0)
        expect(plan.carried.units).toBe(reused.length)
        expect(checkBuiltUnits(builtCommitOf(tree), issued, plan.newUnits, false)).toBeNull()
        for (const unit of reused) {
            expect(issued.has(unit.key)).toBe(false)
        }
    })
})

/** Two characters whose units are equal but for their ids: the asset lists of the two are the same bytes. */
function twinCharacters(count: number): Obj[] {
    const rng = mulberry32(31)
    const pool = prosePool(rng, 10, 50, 200)
    const original = sparseCharacter(rng, pool, 'twin-0', 'Twin', [chat(rng, 0, [message(rng, pool, 0, 80)])], [loreEntry(rng, pool, 0, 80)])
    delete original.additionalAssets
    return Array.from({ length: count }, (_, index) => ({ ...structuredClone(original), chaId: `${uuidLike(mulberry32(index + 1))}` }))
}

describe('guard (new rule): a stored key is handed out at most once per encode (I3)', () => {
    test('two equal units of the import take distinct keys: the first reuses the stored copy, the second gets a fresh key', async () => {
        const base = await baseTree(dbWithCharacters(twinCharacters(1)))
        const baseLists = identitiesWhere(base, IDENTITY.alChar).map(identity => unitOf(base, identity))
        expect(baseLists).toHaveLength(1)

        const plan = await importOver(dbWithCharacters(twinCharacters(2)), contentOf(base))
        const tree = plan.finalize({ mint: createKeyMint(seededEnv(60), null).mint, seq: 2, now: NOW })

        const lists = identitiesWhere(tree, IDENTITY.alChar).map(identity => unitOf(tree, identity))
        expect(lists).toHaveLength(2)
        expect(lists.filter(unit => unit.reused)).toHaveLength(1)
        expect(lists.find(unit => unit.reused)?.key).toBe(baseLists[0].key)
        expect(new Set(lists.map(unit => unit.key)).size).toBe(2)
        expect(new Set(tree.units.map(unit => unit.key)).size).toBe(tree.units.length)
    })

    test('the sink alone: one stored copy serves one unit, a candidate list of two serves two', () => {
        const env = seededEnv(4)
        const body = { v: 1, preset: { name: 'same' } }
        const bytes = encodeUnit(UNIT_TYPE.preset, body)
        const entry = (key: string): ReusableUnit => ({ key, type: UNIT_TYPE.preset, ref: refOfFrame(key, bytes), digest: unitDigest(bytes) })
        const keyA = newUnitKey(env)
        const keyB = newUnitKey(env)

        const single = new UnitSink(seededEnv(5), null, undefined, { content: { units: new Map([[unitDigest(bytes), [entry(keyA)]]]) } })
        const first = single.put('preset:0', UNIT_TYPE.preset, body)
        const second = single.put('preset:1', UNIT_TYPE.preset, body)
        expect([first.reused, first.key]).toEqual([true, keyA])
        expect(second.reused).toBe(false)
        expect(second.key).not.toBe(keyA)
        expect(single.reused).toBe(1)

        const pair = new UnitSink(seededEnv(5), null, undefined, { content: { units: new Map([[unitDigest(bytes), [entry(keyA), entry(keyB)]]]) } })
        expect(pair.put('preset:0', UNIT_TYPE.preset, body).key).toBe(keyA)
        expect(pair.put('preset:1', UNIT_TYPE.preset, body).key).toBe(keyB)
        expect(pair.put('preset:2', UNIT_TYPE.preset, body).reused).toBe(false)
    })

    test('a candidate whose key this encode already handed out fresh is never taken', () => {
        const body = { v: 1, preset: { name: 'collide' } }
        const bytes = encodeUnit(UNIT_TYPE.preset, body)
        const taken = newUnitKey(seededEnv(8))
        const content: ContentIndex = {
            units: new Map([[unitDigest(bytes), [{ key: taken, type: UNIT_TYPE.preset, ref: refOfFrame(taken, bytes), digest: unitDigest(bytes) }]]]),
        }
        const later = seededEnv(12)
        let issued = 0
        const unit = (): string => (issued++ === 0 ? taken : newUnitKey(later))
        const sink = new UnitSink(seededEnv(5), null, { shard: unit, unit, manifest: unit }, { content })
        // The mint hands `taken` out for a unit the index does not hold; the next unit must not then take it by content.
        sink.put('other', UNIT_TYPE.preset, { v: 1, preset: { name: 'other' } })
        const second = sink.put('preset:0', UNIT_TYPE.preset, body)
        expect(second.reused).toBe(false)
        expect(second.key).not.toBe(taken)
    })
})

describe('guard (new rule): a candidate is the same unit only by type, framed length, CRC and digest (I7)', () => {
    const body = { v: 1, preset: { name: 'p' } }
    const bytes = encodeUnit(UNIT_TYPE.preset, body)
    const digest = unitDigest(bytes)
    const key = newUnitKey(seededEnv(9))

    function takenFrom(candidate: ReusableUnit): boolean {
        const sink = new UnitSink(seededEnv(5), null, undefined, { content: { units: new Map([[digest, [candidate]]]) } })
        const unit = sink.put('preset:0', UNIT_TYPE.preset, body)
        return unit.reused && unit.key === key
    }

    test('the matching entry is taken (control)', () => {
        expect(takenFrom({ key, type: UNIT_TYPE.preset, ref: refOfFrame(key, bytes), digest })).toBe(true)
    })

    test('another type is not taken', () => {
        expect(takenFrom({ key, type: UNIT_TYPE.taskPreset, ref: refOfFrame(key, bytes), digest })).toBe(false)
    })

    test('another framed length is not taken', () => {
        const ref = refOfFrame(key, bytes)
        expect(takenFrom({ key, type: UNIT_TYPE.preset, ref: [ref[0], ref[1] + 1, ref[2]], digest })).toBe(false)
    })

    test('another CRC is not taken', () => {
        const ref = refOfFrame(key, bytes)
        expect(takenFrom({ key, type: UNIT_TYPE.preset, ref: [ref[0], ref[1], ref[2] ^ 1], digest })).toBe(false)
    })

    test('an entry without a digest is never taken', () => {
        const ref = refOfFrame(key, bytes)
        expect(takenFrom({ key, type: UNIT_TYPE.preset, ref })).toBe(false)
    })

    test('the manifest and the reuse-at path never consult the index', () => {
        const sink = new UnitSink(seededEnv(5), null, undefined, { content: { units: new Map([[digest, [{ key, type: UNIT_TYPE.preset, ref: refOfFrame(key, bytes), digest }]]]) } })
        const fresh = sink.putFresh('manifest', UNIT_TYPE.preset, body, 'unit')
        expect(fresh.reused).toBe(false)
        expect(sink.reuseAt('manifest', UNIT_TYPE.preset)).toBeNull()
        expect(sink.reused).toBe(0)
    })
})

describe('guard (new rule): a content index is an import-only rule', () => {
    test('content with a previous encoding, reuseOnly or collect is refused', async () => {
        const base = await baseTree()
        const content = contentOf(base)
        expect(() => new UnitSink(seededEnv(1), previousFrom(base), undefined, { content })).toThrow(TypeError)
        expect(() => new UnitSink(seededEnv(1), null, undefined, { content, reuseOnly: true })).toThrow(TypeError)
        expect(() => new UnitSink(seededEnv(1), null, undefined, { content, collect: true })).toThrow(TypeError)
        expect(() => new UnitSink(seededEnv(1), null, undefined, { content })).not.toThrow()
    })
})

describe('guard: the reuse counter also counts identity reuse', () => {
    test('a unit equal to the previous encoding\'s unit at its identity counts as reused, a changed one does not', () => {
        const first = new UnitSink(seededEnv(1), null)
        const body = { v: 1, preset: { name: 'x' } }
        const written = first.put('preset:0', UNIT_TYPE.preset, body)
        const previous = { units: new Map([['preset:0', { key: written.key, type: written.type, ref: written.ref, digest: written.digest }]]), entities: new Map<string, string>() }

        const sink = new UnitSink(seededEnv(2), previous)
        expect(sink.put('preset:0', UNIT_TYPE.preset, body).reused).toBe(true)
        expect(sink.reused).toBe(1)
        const changed = new UnitSink(seededEnv(2), previous)
        expect(changed.put('preset:0', UNIT_TYPE.preset, { v: 1, preset: { name: 'y' } }).reused).toBe(false)
        expect(changed.reused).toBe(0)
    })
})
