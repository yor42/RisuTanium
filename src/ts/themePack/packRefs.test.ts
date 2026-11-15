// The reserved pack file name and the walk that names every asset an installed pack keeps (`packRefs.ts`). Titles beginning
// "guard:" pass with or without the walk's depth and cycle rules; every other test names a rule a mutant breaks.
import { describe, expect, test } from 'vitest'
import { collectPackAssetRefs, isPackAssetName, PACK_ARCHIVE_KEY, PACK_ASSET_NAME } from './packRefs'

const HEX = 'ab'.repeat(32)

function namesIn(value: unknown): string[] {
    const found: string[] = []
    collectPackAssetRefs(value, (name) => found.push(name))
    return found
}

describe('the reserved pack file name', () => {
    test('a name is tp-, 64 lower-case hex digits and one lower-case extension', () => {
        expect(PACK_ASSET_NAME.test(`tp-${HEX}.risutheme`)).toBe(true)
        expect(PACK_ASSET_NAME.test(`tp-${HEX}.png`)).toBe(true)
        expect(PACK_ASSET_NAME.test(`tp-${HEX.slice(1)}.png`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`tp-${HEX}0.png`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`tp-${HEX}.`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`tp-${HEX}`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`TP-${HEX}.png`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`tp-${HEX}.PNG`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`xtp-${HEX}.png`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`tp-${HEX}.png.extra`)).toBe(false)
        expect(PACK_ASSET_NAME.test(`tp-${HEX.replace('a', 'g')}.png`)).toBe(false)
    })

    test('the archive key is assets/ and the pack name with the one extension a pack archive has', () => {
        expect(PACK_ARCHIVE_KEY.test(`assets/tp-${HEX}.risutheme`)).toBe(true)
        expect(PACK_ARCHIVE_KEY.test(`assets/tp-${HEX}.png`)).toBe(false)
        expect(PACK_ARCHIVE_KEY.test(`tp-${HEX}.risutheme`)).toBe(false)
        expect(PACK_ARCHIVE_KEY.test(`assets/sub/tp-${HEX}.risutheme`)).toBe(false)
        expect(PACK_ARCHIVE_KEY.test(`assets/tp-${HEX.toUpperCase()}.risutheme`)).toBe(false)
        expect(PACK_ARCHIVE_KEY.test(`assets/tp-${HEX}.risutheme.bak`)).toBe(false)
    })

    test('the basename after the last / or \\ is judged, whatever its case', () => {
        expect(isPackAssetName(`tp-${HEX}.png`)).toBe(true)
        expect(isPackAssetName(`assets/tp-${HEX}.risutheme`)).toBe(true)
        expect(isPackAssetName(`assets\\tp-${HEX}.risutheme`)).toBe(true)
        expect(isPackAssetName(`some/dir\\tp-${HEX}.png`)).toBe(true)
        expect(isPackAssetName(`TP-${HEX.toUpperCase()}.PNG`)).toBe(true)
        expect(isPackAssetName(`assets/Tp-${HEX}.Png`)).toBe(true)
    })

    test('a name that only resembles a pack name is an ordinary asset', () => {
        expect(isPackAssetName(`tp-${HEX}.png/other.png`)).toBe(false)
        expect(isPackAssetName(`tp-${HEX}.png.extra`)).toBe(false)
        expect(isPackAssetName(`atp-${HEX}.png`)).toBe(false)
        expect(isPackAssetName(`tp-${HEX.slice(2)}.png`)).toBe(false)
        expect(isPackAssetName(`${HEX}.png`)).toBe(false)
        expect(isPackAssetName('')).toBe(false)
        expect(isPackAssetName('/')).toBe(false)
    })
})

describe('the walk over installed packs', () => {
    test('every assets/ string anywhere in the value is added, in arrays and objects of any depth', () => {
        const value = [
            { archive: 'assets/a.risutheme', nested: { more: ['assets/b.bin', { deeper: 'assets/c.bin' }] } },
            ['assets/d.bin', 3, null, true, undefined],
        ]

        expect(namesIn(value).sort()).toEqual(['assets/a.risutheme', 'assets/b.bin', 'assets/c.bin', 'assets/d.bin'])
    })

    test('a string that does not start with assets/ is not added, and a key is never a name', () => {
        expect(namesIn([{ 'assets/key-only': 'plain', archive: 'Assets/x', other: ' assets/y', third: 'xassets/z', empty: '' }])).toEqual([])
    })

    test('an entry of an unknown version and shape is walked all the same, at a depth far beyond any reader', () => {
        let node: unknown = ['assets/deep.bin']
        for (let level = 0; level < 5000; level++) {
            node = { next: node }
        }

        expect(namesIn([{ v: 99, future: node }])).toEqual(['assets/deep.bin'])
    })

    test('a value that is not a list or an object adds nothing and does not throw', () => {
        for (const value of [undefined, null, 'x', 'assets/top-level-string', 3, true, {}, [], [null], [undefined], [[]], [{}]]) {
            expect(namesIn(value), String(value)).toEqual([])
        }
    })

    test('a top-level object (not a list) is walked like a list: its strings are still kept', () => {
        expect(namesIn({ future: ['assets/a.bin'] })).toEqual(['assets/a.bin'])
    })

    test('guard: a cyclic value ends, and each string is added once per occurrence in the value', () => {
        const entry: Record<string, unknown> = { archive: 'assets/a.bin' }
        entry.self = entry
        entry.list = [entry, 'assets/b.bin']

        expect(namesIn([entry, entry]).sort()).toEqual(['assets/a.bin', 'assets/b.bin'])
    })

    test('guard: an array that shares a child with another array walks the child once', () => {
        const shared = { archive: 'assets/shared.bin' }

        expect(namesIn([[shared], [shared]])).toEqual(['assets/shared.bin'])
    })
})
