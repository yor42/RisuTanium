// @vitest-environment node
import { describe, expect, test } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import {
    assembleCharacter, assembleDatabase, checkUnit, ENTRY_MOVED_FIELDS, movedValueOf, readCheckedUnit, shardOfU, unitMapSource,
    type EncodedTree,
} from 'src/ts/storage/store2/codec'
import { canonicalJson, UNIT_TYPE, type ContentBody, type Shard, type ShardEntry } from 'src/ts/storage/store2/format'
import { createLeafFallback } from 'src/ts/storage/store2/leafFallback'
import { buildLegacyCases, buildSmall, dbWithCharacters, encodeWith, type Obj } from './codecFixtures'

/**
 * The per-entity hook of `assembleDatabase` (`codec/assemble.ts`) and the leaf fallback built on it. The hook is placed
 * where `assembleCharacter` is called, so an absent option is today's assembly; the leaf fallback with nothing flagged
 * reassembles every entity through the unit check and must come to the same database. Labels: new behaviour, plus the
 * guard that an absent option changes nothing.
 */

const NOW = 1_800_000_000_000

interface FixtureTree {
    label: string
    tree: EncodedTree
}

function fixtures(): FixtureTree[] {
    const cases = buildLegacyCases()
    // Every legacy shape in one profile: groups, positional chat handles, missing lore and scripts, edge values.
    const everyShape = dbWithCharacters(cases.map(one => one.character))
    return [
        { label: 'a small profile with modules, plugins and plugin storage', tree: encodeWith(buildSmall(2)) },
        { label: 'twenty characters over several shards', tree: encodeWith(buildSmall(20)) },
        { label: 'every legacy shape: groups, repeated and missing chat ids, no lore, no scripts, edge values', tree: encodeWith(everyShape as unknown as Database) },
    ]
}

function entriesOf(tree: EncodedTree): ShardEntry[] {
    const source = unitMapSource(tree.units)
    return tree.manifest.shards.flatMap((ref) => {
        const checked = checkUnit(source, ref, UNIT_TYPE.shard)
        if (checked.status !== 'ok') {
            throw new Error('A shard of the tree does not check.')
        }
        return (checked.body as Shard).entries
    })
}

describe.each(fixtures())('new behaviour: the hook over $label', ({ tree }) => {
    const source = unitMapSource(tree.units)
    const plain = canonicalJson(assembleDatabase(tree.manifest, source))

    test('assembleCharacter passed as the hook gives the same database as no option, and the hook is called once per entity in order', () => {
        const calls: string[] = []
        const hooked = assembleDatabase(tree.manifest, source, {
            character: (entry, from) => {
                calls.push(entry.u)
                return assembleCharacter(entry, from)
            },
        })
        expect(canonicalJson(hooked)).toBe(plain)
        const order = checkUnit(source, tree.manifest.fixed.order, UNIT_TYPE.order)
        if (order.status !== 'ok') {
            throw new Error('The order unit does not check.')
        }
        expect(calls).toEqual((order.body as ContentBody).chars)
        expect(calls.length).toBe(entriesOf(tree).length)
    })

    test('the leaf fallback with nothing flagged reassembles every entity to the same database', () => {
        const fallback = createLeafFallback([], () => NOW)
        expect(canonicalJson(assembleDatabase(tree.manifest, source, { character: fallback.character }))).toBe(plain)
    })
})

describe('new behaviour: the multi-shard fixture really is multi-shard', () => {
    test('twenty characters land in at least two shards', () => {
        const tree = encodeWith(buildSmall(20))
        const shards = new Set(entriesOf(tree).map(entry => shardOfU(entry.u, tree.manifest.shardCount)))
        expect(shards.size).toBeGreaterThan(1)
    })
})

describe('new behaviour: the codec exports the leaf fallback builds on', () => {
    test('movedValueOf reads the entry field each moved name stands for', () => {
        const tree = encodeWith(buildSmall(2))
        const entry = entriesOf(tree)[0]
        for (const name of ENTRY_MOVED_FIELDS) {
            expect(movedValueOf(entry, name), name).toBe(entry[name])
        }
    })

    test('readCheckedUnit answers the body of a unit that checks and throws the assembly error for a missing one', () => {
        const tree = encodeWith(buildSmall(2))
        const source = unitMapSource(tree.units)
        const entry = entriesOf(tree)[0]
        expect(readCheckedUnit(source, entry.core, UNIT_TYPE.characterCore, 'core')).toMatchObject({ v: 1 })
        expect(() => readCheckedUnit(unitMapSource([]), entry.core, UNIT_TYPE.characterCore, 'core')).toThrow(/is missing/)
    })

    test('a database object built by the hook is whatever the hook returns', () => {
        const tree = encodeWith(buildSmall(2))
        const database = assembleDatabase(tree.manifest, unitMapSource(tree.units), { character: (entry) => ({ chaId: entry.chaId }) }) as unknown as { characters: Obj[] }
        expect(database.characters.every(one => Object.keys(one).join() === 'chaId')).toBe(true)
    })
})
