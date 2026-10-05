// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { FIXED_BLOCK_NAMES } from 'src/ts/storage/blockKeys'
import { packedNamesOf } from 'src/ts/storage/packedNames'

const cold = (chaId: unknown) => ({ chaId, coldstorage: 'unit-key' })
const loaded = (chaId: unknown) => ({ chaId })

describe('the names that live in the stubs pack', () => {
    test('are the archived characters, and only those', () => {
        const names = packedNamesOf([loaded('a'), cold('b'), cold('c'), loaded('d')])
        expect(Array.from(names).sort()).toEqual(['b', 'c'])
    })

    test.each([undefined, null, '', 0, false])('a coldstorage value of %j does not archive a character', (coldstorage) => {
        expect(packedNamesOf([{ chaId: 'a', coldstorage }]).size).toBe(0)
    })

    test('a name held by two characters is never packed, whichever holder is archived', () => {
        expect(packedNamesOf([cold('twin'), loaded('twin')]).size).toBe(0)
        expect(packedNamesOf([loaded('twin'), cold('twin')]).size).toBe(0)
        expect(packedNamesOf([cold('twin'), cold('twin'), cold('solo')])).toEqual(new Set(['solo']))
    })

    test.each(FIXED_BLOCK_NAMES)('the fixed block name %s is never packed', (name) => {
        expect(packedNamesOf([cold(name)]).size).toBe(0)
    })

    test('a frozen key is never packed', () => {
        expect(packedNamesOf([cold('a'), cold('b')], new Set(['a']))).toEqual(new Set(['b']))
    })

    test('a numeric chaId is told apart by the string it keys a block with', () => {
        expect(packedNamesOf([cold(5), loaded('5')]).size).toBe(0)
        expect(packedNamesOf([cold(5)])).toEqual(new Set(['5']))
    })

    test('a name that cannot be a character block of a layout is not packed', () => {
        expect(packedNamesOf([cold('root')]).size).toBe(0)
    })

    test('names that look like object keys are handled as plain names', () => {
        expect(packedNamesOf([cold('__proto__'), cold('constructor')])).toEqual(new Set(['__proto__', 'constructor']))
    })

    test('an empty tree packs nothing and the input is not changed', () => {
        const characters = [cold('a'), loaded('b')]
        const frozen = new Set(['x'])
        packedNamesOf(characters, frozen)
        expect(packedNamesOf([]).size).toBe(0)
        expect(characters).toEqual([cold('a'), loaded('b')])
        expect(frozen).toEqual(new Set(['x']))
    })
})
