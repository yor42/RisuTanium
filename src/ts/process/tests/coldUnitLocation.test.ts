/**
 * Where a unit lives (`coldUnitLocation.ts`): the one mapping from a unit key to
 * the page store's key on each platform, the inverse used by the listings, the
 * legacy OPFS file name, and the store's refusal of keys the cold-key rule
 * accepts. Pure functions over a platform flag; a pass here says nothing about
 * any store. Every test is labelled "new behaviour" except the ones titled
 * "guard", which pin the names earlier builds already wrote.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

const platform = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platform.isTauri },
    get isNodeServer() { return platform.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

import { coldUnitKeyOfStoreKey, coldUnitStoreKey, coldUnitStoreRefusal, legacyOpfsUnitKeyOfName, legacyOpfsUnitName } from '../coldUnitLocation'

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'

function on(which: 'web' | 'node' | 'tauri'): void {
    platform.isTauri = which === 'tauri'
    platform.isNodeServer = which === 'node'
}

afterEach(() => on('web'))

describe('the page store key of a unit', () => {
    test.each([
        ['web', `coldstorage/${UUID}`],
        ['node', `coldstorage/${UUID}`],
        ['tauri', `coldstorage/${UUID}.json`],
    ] as const)('guard: on %s a unit is kept at the name earlier builds used', (which, expected) => {
        on(which)

        expect(coldUnitStoreKey(UUID)).toBe(expected)
    })

    test.each(['web', 'node', 'tauri'] as const)('new behaviour: on %s a listed store key maps back to the unit key it came from', (which) => {
        on(which)

        expect(coldUnitKeyOfStoreKey(coldUnitStoreKey(UUID))).toBe(UUID)
        expect(coldUnitKeyOfStoreKey(coldUnitStoreKey(UUID + '_accessMeta'))).toBe(UUID + '_accessMeta')
    })

    test.each([
        ['an entry outside coldstorage/', 'assets/a.png'],
        ['a nested entry', `coldstorage/sub/${UUID}.json`],
        ['the folder itself', 'coldstorage/'],
    ])('new behaviour: %s is not a unit', (_label, storeKey) => {
        on('tauri')

        expect(coldUnitKeyOfStoreKey(storeKey)).toBeNull()
    })

    test('new behaviour: on the desktop only a .json name is a unit, elsewhere a nested name is not', () => {
        on('tauri')
        expect(coldUnitKeyOfStoreKey(`coldstorage/${UUID}`)).toBeNull()
        on('node')
        expect(coldUnitKeyOfStoreKey(`coldstorage/${UUID}`)).toBe(UUID)
        expect(coldUnitKeyOfStoreKey(`coldstorage/a/${UUID}`)).toBeNull()
    })
})

describe('the legacy OPFS file name', () => {
    test('guard: it is coldstorage_<key>.json in the OPFS root', () => {
        expect(legacyOpfsUnitName(UUID)).toBe(`coldstorage_${UUID}.json`)
        expect(legacyOpfsUnitKeyOfName(`coldstorage_${UUID}.json`)).toBe(UUID)
    })

    test.each([
        ['a hex-named store file', '636f6c6473746f726167652f61'],
        ['a name with no key', 'coldstorage_.json'],
        ['a different suffix', `coldstorage_${UUID}.bin`],
        ['a different prefix', `unit_${UUID}.json`],
    ])('new behaviour: %s is not a legacy unit file', (_label, name) => {
        expect(legacyOpfsUnitKeyOfName(name)).toBeNull()
    })
})

describe('keys the page store refuses although the cold-key rule accepts them', () => {
    test.each(['web', 'node', 'tauri'] as const)('new behaviour: on %s a UUID and its _accessMeta form are accepted', (which) => {
        on(which)

        expect(coldUnitStoreRefusal(UUID)).toBeNull()
        expect(coldUnitStoreRefusal(UUID + '_accessMeta')).toBeNull()
    })

    test.each(['web', 'node', 'tauri'] as const)('new behaviour: on %s a name starting with a dot is refused', (which) => {
        on(which)

        expect(coldUnitStoreRefusal('.hidden')).not.toBeNull()
    })

    test('new behaviour: on the Node server a key whose store key exceeds the write limit is refused, a 100-byte key is not', () => {
        on('node')

        expect(coldUnitStoreRefusal('k'.repeat(100))).toBeNull()
        expect(coldUnitStoreRefusal('k'.repeat(110))).not.toBeNull()
    })
})
