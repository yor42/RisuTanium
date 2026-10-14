import { describe, expect, test } from 'vitest'
import { assetRefKey, hexStemToBase64url, isHashStemRun, parseAssetList, parseInlayList, splitHashStems } from '../../store2/format'

const HASH = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12'

const oracleStem = (hex: string) => Buffer.from(hex, 'hex').toString('base64url')

describe('hash stem forms', () => {
    test('a 64-hex stem converts to the 43-character unpadded base64url form, in either case', () => {
        for (const hex of [HASH, '00'.repeat(32), 'ff'.repeat(32), 'fb'.repeat(32), '3e'.repeat(32)]) {
            expect(hexStemToBase64url(hex)).toBe(oracleStem(hex))
            expect(hexStemToBase64url(hex.toUpperCase())).toBe(oracleStem(hex))
            expect(hexStemToBase64url(hex)).toHaveLength(43)
        }
        expect(hexStemToBase64url('fb'.repeat(32))).toContain('-')
        expect(hexStemToBase64url('ff'.repeat(32))).toContain('_')
    })

    test('a name round-trips through assetRefKey into its h stem', () => {
        expect(hexStemToBase64url(assetRefKey(`${HASH.toUpperCase()}.PNG`))).toBe(oracleStem(HASH))
    })

    test('a stem whose last character is not canonical for 32 bytes is refused everywhere', () => {
        const stem = 'A'.repeat(42) + 'B'
        expect(isHashStemRun(stem)).toBe(false)
        expect(() => splitHashStems(stem)).toThrow(RangeError)
        expect(parseAssetList({ v: 1, h: stem, l: [] }).status).toBe('damaged')
        expect(parseInlayList({ v: 1, u: [], h: stem, o: [] }).status).toBe('damaged')
        for (const last of 'AEIMQUYcgkosw048') {
            expect(isHashStemRun('A'.repeat(42) + last), last).toBe(true)
        }
        expect(isHashStemRun(oracleStem(HASH) + stem)).toBe(false)
    })

    test('every converted stem is canonical', () => {
        for (let i = 0; i < 300; i++) {
            const hex = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')
            expect(isHashStemRun(hexStemToBase64url(hex)), hex).toBe(true)
        }
        expect(isHashStemRun(hexStemToBase64url('ff'.repeat(32)))).toBe(true)
    })

    test('a stem that is not 64 hex digits is refused', () => {
        expect(() => hexStemToBase64url(HASH.slice(1))).toThrow(RangeError)
        expect(() => hexStemToBase64url(`${'g'.repeat(64)}`)).toThrow(RangeError)
    })

    test('an h string splits into 43-character stems and refuses what the schema refuses', () => {
        const a = oracleStem(HASH)
        const b = oracleStem('00'.repeat(32))
        expect(splitHashStems('')).toEqual([])
        expect(splitHashStems(a + b)).toEqual([a, b])
        expect(isHashStemRun(a + b)).toBe(true)
        expect(() => splitHashStems(a + 'x')).toThrow(RangeError)
        expect(() => splitHashStems('!'.repeat(43))).toThrow(RangeError)
        expect(isHashStemRun('+'.repeat(43))).toBe(false)
    })
})

describe('assetRefKey', () => {
    test('a lower-case hash name reduces to its stem', () => {
        expect(assetRefKey(`${HASH}.png`)).toBe(HASH)
    })

    test('an upper-case extension and an upper-case hash stem reduce to the same lower-case stem', () => {
        expect(assetRefKey(`${HASH}.PNG`)).toBe(HASH)
        expect(assetRefKey(`${HASH.toUpperCase()}.png`)).toBe(HASH)
        expect(assetRefKey(`${HASH.toUpperCase()}.PNG`)).toBe(HASH)
    })

    test('an empty extension still reduces to the stem', () => {
        expect(assetRefKey(`${HASH}.`)).toBe(HASH)
    })

    test('the directory part is dropped', () => {
        expect(assetRefKey(`assets/${HASH}.PNG`)).toBe(HASH)
    })

    test('a custom id is lower-cased whole, extension kept', () => {
        expect(assetRefKey('My-Avatar.PNG')).toBe('my-avatar.png')
        expect(assetRefKey('assets/Custom_ID.Webp')).toBe('custom_id.webp')
    })

    test('a name that only looks like a hash is not reduced', () => {
        expect(assetRefKey(`${HASH.slice(1)}.png`)).toBe(`${HASH.slice(1)}.png`)
        expect(assetRefKey(`${HASH}0.png`)).toBe(`${HASH}0.png`)
        expect(assetRefKey(HASH)).toBe(HASH)
        expect(assetRefKey(`${'g'.repeat(64)}.png`)).toBe(`${'g'.repeat(64)}.png`)
    })
})
