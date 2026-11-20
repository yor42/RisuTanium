// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { unitMapSource, type EncodedTree } from '../../store2/codec'
import { entityIdsOf, previousOfTree } from '../../store2/previousOfTree'
import type { ContentBody, ShardEntry } from '../../store2/format'
import { buildSmall, encodeWith, type Obj } from './codecFixtures'

function storedOf(tree: EncodedTree, lacking: (identity: string) => boolean = () => false) {
    return { manifestKey: tree.manifestKey, manifest: tree.manifest, source: unitMapSource(tree.units.filter(unit => !lacking(unit.identity))) }
}

describe('guard: the in-memory bodies a stored tree is read into', () => {
    const db = buildSmall(6)
    const tree = encodeWith(db)

    test('the order, statics and preset bodies are the stored ones', () => {
        const objects = previousOfTree(storedOf(tree)).objects
        expect(objects?.order?.chars).toEqual(tree.index.entities.size === 0 ? [] : [...tree.index.entities.values()])
        expect(objects?.statics).toEqual({ v: 1, ...(db.statics === undefined ? {} : { value: JSON.parse(JSON.stringify(db.statics)) }) })
        expect(objects?.presets).toEqual(JSON.parse(JSON.stringify(db.botPresets)))
    })

    test('a preset unit the boot did not read leaves the preset bodies unknown, and nothing else is lost', () => {
        const objects = previousOfTree(storedOf(tree, identity => identity === 'preset:1')).objects
        expect(objects?.presets).toBeUndefined()
        expect(objects?.order).toBeDefined()
        expect(objects?.statics).toBeDefined()
    })

    test('a statics unit the boot did not read leaves it unknown', () => {
        const objects = previousOfTree(storedOf(tree, identity => identity === 'statics')).objects
        expect(objects?.statics).toBeUndefined()
        expect(objects?.presets?.length).toBe((db.botPresets as unknown as Obj[]).length)
    })

    test('the loadouts body is the stored list, and a loadouts unit the boot did not read leaves it unknown', () => {
        expect(previousOfTree(storedOf(tree)).objects?.loadouts).toEqual(JSON.parse(JSON.stringify(db.loadouts ?? [])))
        const objects = previousOfTree(storedOf(tree, identity => identity === 'loadouts')).objects
        expect(objects?.loadouts).toBeUndefined()
        expect(objects?.statics).toBeDefined()
        expect(objects?.order).toBeDefined()
    })

    test('entityIdsOf numbers repeated ids by occurrence and refuses an order that names an unknown entity', () => {
        const entry = (u: string, chaId: string): ShardEntry => ({ u, chaId }) as unknown as ShardEntry
        const entries = new Map([['u1', entry('u1', 'a')], ['u2', entry('u2', 'a')], ['u3', entry('u3', 'b')]])
        const order: ContentBody = { v: 1, chars: ['u1', 'u3', 'u2'] }
        expect(Object.fromEntries(entityIdsOf(order, entries))).toEqual({ 'a#0': 'u1', 'b#0': 'u3', 'a#1': 'u2' })
        expect(() => entityIdsOf({ v: 1, chars: ['missing'] }, entries)).toThrow()
    })
})
