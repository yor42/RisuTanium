// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    deriveCharacterAssets, deriveConfigAssets, deriveLegacyList, deriveModuleAssets, createListDerivation,
} from '../../store2/lists'
import { retainedNamesOf } from '../../store2/lists/assetList'
import { ASSET_REF_V } from '../../store2/format'
import { ASSET_RETAINED_KEY } from '../../../studio/assets/assetOwnerKeys'

/**
 * The retained-paths field of an owner is a reference like any other: every list derivation reads it through
 * `retainedNamesOf`, so a path the owner's history can still restore stays in the owner's asset list. These are feature
 * guards (the field did not exist before); the mutant that skips one collector, or reads only the shape the writer
 * produces, fails them.
 */

const KEPT = 'assets/K.png'
const OTHER = 'assets/K2.png'
const pairs = (path: string) => [['x', path]]
const sameAs = (path: string) => [['x', path, 'png']]

describe('every list derivation includes the retained paths', () => {
    test('a character list holds the path of a conforming value and of a value of another shape', () => {
        const conforming = { [ASSET_RETAINED_KEY]: pairs(KEPT) }
        const nonConforming = { [ASSET_RETAINED_KEY]: { a: [OTHER] } }
        expect(deriveCharacterAssets(conforming)).toEqual(deriveCharacterAssets({ additionalAssets: sameAs(KEPT) }))
        expect(deriveCharacterAssets(conforming).l).toEqual(['k.png'])
        expect(deriveCharacterAssets(nonConforming)).toEqual(deriveCharacterAssets({ additionalAssets: sameAs(OTHER) }))
        expect(deriveCharacterAssets(nonConforming).l).toEqual(['k2.png'])
    })

    test('a module list holds the path of a conforming value and of a value of another shape', () => {
        expect(deriveModuleAssets({ [ASSET_RETAINED_KEY]: pairs(KEPT) })).toEqual(deriveModuleAssets({ assets: sameAs(KEPT) }))
        expect(deriveModuleAssets({ [ASSET_RETAINED_KEY]: { a: [OTHER] } }).l).toEqual(['k2.png'])
    })

    test('a config list holds the path of a persona embedded module, whatever the value shape', () => {
        const config = (value: unknown) => ({ personas: [{ embeddedModule: { [ASSET_RETAINED_KEY]: value } }] })
        expect(deriveConfigAssets(config(pairs(KEPT)), []).l).toEqual(['k.png'])
        expect(deriveConfigAssets(config({ a: [OTHER] }), []).l).toEqual(['k2.png'])
    })

    test('the legacy list holds the path of a character, a module, an embedded module and a cold character', () => {
        const database = {
            characters: [{ [ASSET_RETAINED_KEY]: pairs('assets/c.png') }],
            modules: [{ [ASSET_RETAINED_KEY]: pairs('assets/m.png') }],
            personas: [{ embeddedModule: { [ASSET_RETAINED_KEY]: { deep: [['assets/p.png']] } } }],
        }
        const list = deriveLegacyList([{
            key: 'database/database.bin', status: 'ok', database,
            coldCharacters: [{ [ASSET_RETAINED_KEY]: pairs('assets/cold.png') }],
        }])
        expect(list.l).toEqual(['c.png', 'cold.png', 'm.png', 'p.png'])
    })

    test('the real derivation handed to the codec derives the same lists', () => {
        const lists = createListDerivation()
        const owner = { [ASSET_RETAINED_KEY]: pairs(KEPT) }
        expect(lists.characterAssets(owner).l).toEqual(['k.png'])
        expect(lists.moduleAssets(owner).l).toEqual(['k.png'])
    })

    test('guard: an owner without the field derives the list it always did, and the list version is 1', () => {
        expect(deriveCharacterAssets({ image: KEPT })).toEqual({ v: 1, h: '', l: ['k.png'] })
        expect(ASSET_REF_V).toBe(1)
    })
})

describe('retainedNamesOf', () => {
    test('a list of pairs yields the second string of each row', () => {
        expect(retainedNamesOf([['a', 'assets/1.png'], ['b', 'assets/2.png']])).toEqual(['assets/1.png', 'assets/2.png'])
        expect(retainedNamesOf([])).toEqual([])
    })

    test('a value that is not a list of pairs yields every string leaf of its plain objects and arrays', () => {
        expect(retainedNamesOf({ a: ['p', { b: 'q' }], c: 3, d: null })).toEqual(['p', 'q'])
        expect(retainedNamesOf([['x', 'p'], ['only-one']])).toEqual(['x', 'p', 'only-one'])
        expect(retainedNamesOf('bare')).toEqual(['bare'])
    })

    test('20,000 string leaves are all yielded: the walk has no leaf cap', () => {
        const leaves = Array.from({ length: 20_000 }, (_, index) => `assets/${index}.png`)
        expect(retainedNamesOf(leaves)).toEqual(leaves)
        expect(retainedNamesOf({ nested: { leaves } })).toHaveLength(20_000)
    })

    test('a leaf at depth 8 is read and a leaf at depth 9 is not', () => {
        const nested = (depth: number): unknown => {
            let value: unknown = 'assets/deep.png'
            for (let level = 0; level < depth; level++) {
                value = { next: value }
            }
            return value
        }
        expect(retainedNamesOf(nested(8))).toEqual(['assets/deep.png'])
        expect(retainedNamesOf(nested(9))).toEqual([])
    })

    test('maps, class instances, null, numbers and undefined yield nothing and never throw', () => {
        class Holder {
            path = 'assets/class.png'
        }
        const throwing = new Proxy({}, { ownKeys() { throw new Error('trap') } })
        for (const value of [new Map([['a', 'assets/map.png']]), new Holder(), new Uint8Array(4), null, undefined, 7, true, throwing]) {
            expect(() => retainedNamesOf(value)).not.toThrow()
            expect(retainedNamesOf(value)).toEqual([])
        }
        const cycle: Record<string, unknown> = { path: 'assets/cycle.png' }
        cycle.self = cycle
        // The depth bound ends the walk of a cycle; each pass over the same leaf may repeat it, which the callers' sets absorb.
        expect(new Set(retainedNamesOf(cycle))).toEqual(new Set(['assets/cycle.png']))
    })
})
