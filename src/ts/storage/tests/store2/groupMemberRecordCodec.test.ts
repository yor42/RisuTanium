import { describe, expect, test } from 'vitest'
import { bodyOf, buildLegacyCases, dbWithCharacters, differingIdentities, identitiesWhere, roundTrip, unitOf, type Obj } from './codecFixtures'

/**
 * #283 T24, compatibility guards: the store2 codec carries the fork-only group key `risutanium_members` in the core unit
 * and assembles it back, and a group without the key encodes and assembles exactly as before. The keyed group is the
 * 'group' case of buildLegacyCases plus a record in the shape joinRecord writes ({name, slot 0..7} under the member id).
 * The cases here pass whenever the key is carried; they fail when the codec starts dropping it from the core.
 */

const KEY = 'risutanium_members'

function groupCase(): Obj {
    const found = buildLegacyCases().find(one => one.label === 'group')
    if (found === undefined) {
        throw new Error('The group case is missing.')
    }
    return found.character
}

function keyed(): Obj {
    return { ...groupCase(), [KEY]: { a: { name: 'Alice', slot: 0 }, b: { name: 'Bob', slot: 5 } } }
}

describe('the group member record key in the store2 codec (compatibility guards)', () => {
    test('a keyed group assembles with its map equal and re-encodes byte for byte', () => {
        const db = dbWithCharacters([keyed()])
        const { first, second, assembled } = roundTrip(db)
        expect((assembled.characters[0] as unknown as Obj)[KEY]).toEqual({ a: { name: 'Alice', slot: 0 }, b: { name: 'Bob', slot: 5 } })
        expect(differingIdentities(first, second)).toEqual([])
    })

    test('the key travels in the core unit and only the core unit differs from the same group without it', () => {
        const withKey = roundTrip(dbWithCharacters([keyed()])).first
        const without = roundTrip(dbWithCharacters([groupCase()])).first
        const differing = differingIdentities(withKey, without)
        const cores = identitiesWhere(withKey, 'char:').filter(identity => identity.endsWith(':core'))
        expect(cores).toHaveLength(1)
        expect(differing).toContain(cores[0])
        expect(differing.filter(identity => identity.startsWith('char:') && !identity.endsWith(':core'))).toEqual([])
        expect(bodyOf(unitOf(withKey, cores[0])).f).toHaveProperty(KEY)
    })

    test('a group without the key assembles without it and encodes to the same units twice', () => {
        const { first, second, assembled } = roundTrip(dbWithCharacters([groupCase()]))
        expect(Object.hasOwn(assembled.characters[0], KEY)).toBe(false)
        expect(differingIdentities(first, second)).toEqual([])
        const core = identitiesWhere(first, 'char:').find(identity => identity.endsWith(':core')) as string
        expect(bodyOf(unitOf(first, core)).f).not.toHaveProperty(KEY)
    })
})
