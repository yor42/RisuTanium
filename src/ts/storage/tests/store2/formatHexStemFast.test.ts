// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { hexStemToBase64url } from '../../store2/format'
import { mulberry32 } from './codecFixtures'

/**
 * `hexStemToBase64url` is a table-driven rewrite of the earlier `btoa` form. Stored lists keep the stems the earlier
 * form wrote and a carried list keeps them across passes, so the new function must give the same 43 characters for
 * every input: these tests compare it with that earlier form (copied below as the oracle) and with Node's own
 * base64url. All of them are compatibility guards: they pass before and after the rewrite, and fail on a mutant of it.
 * The repository corpus is a sample; the exhaustive 24-bit group and 16-bit tail check ran as a scratch diagnostic.
 */

const HEX_STEM = /^[0-9a-f]{64}$/i

/** The function as it was before the rewrite. */
function oracle(hex: string): string {
    if (!HEX_STEM.test(hex)) {
        throw new RangeError('A hash stem is 64 hex digits.')
    }
    let binary = ''
    for (let i = 0; i < 64; i += 2) {
        binary += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function bytesToHex(bytes: readonly number[]): string {
    return bytes.map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function mixedCase(hex: string): string {
    return [...hex].map((char, index) => (index % 2 === 0 ? char.toUpperCase() : char)).join('')
}

/** Both oracles and the function under test agree on `hex`. */
function expectSame(hex: string): void {
    const expected = oracle(hex)
    if (hexStemToBase64url(hex) !== expected || expected !== Buffer.from(hex, 'hex').toString('base64url')) {
        // Fail with the input named; a bare boolean would not say which stem differs.
        expect(hexStemToBase64url(hex), hex).toBe(expected)
        expect(Buffer.from(hex, 'hex').toString('base64url'), hex).toBe(expected)
    }
}

const FILLERS = [0x00, 0xff, 0xfb, 0x3e, 0xab]

describe('guard: hexStemToBase64url gives the earlier form\'s stem for every input', () => {
    test('every byte value at every byte position over five fillers, in lower, upper and mixed case', () => {
        for (const filler of FILLERS) {
            for (let position = 0; position < 32; position++) {
                for (let value = 0; value < 256; value++) {
                    const bytes = new Array<number>(32).fill(filler)
                    bytes[position] = value
                    const hex = bytesToHex(bytes)
                    expectSame(hex)
                    expectSame(hex.toUpperCase())
                    expectSame(mixedCase(hex))
                }
            }
        }
    })

    test('every nibble value (both cases) at every one of the 64 positions', () => {
        for (const fill of ['0', 'f', 'a']) {
            for (let position = 0; position < 64; position++) {
                for (const digit of '0123456789abcdefABCDEF') {
                    expectSame(fill.repeat(position) + digit + fill.repeat(63 - position))
                }
            }
        }
    })

    test('every single-bit flip of a zero and of an all-ones stem', () => {
        for (let bit = 0; bit < 256; bit++) {
            const zero = new Array<number>(32).fill(0)
            const ones = new Array<number>(32).fill(255)
            zero[bit >> 3] |= 1 << (bit & 7)
            ones[bit >> 3] &= ~(1 << (bit & 7)) & 255
            expectSame(bytesToHex(zero))
            expectSame(bytesToHex(ones).toUpperCase())
        }
    })

    test('200 000 seeded random stems, in lower, upper and mixed case', () => {
        const random = mulberry32(225)
        for (let n = 0; n < 200_000; n++) {
            const hex = bytesToHex(Array.from({ length: 32 }, () => Math.floor(random() * 256)))
            expectSame(n % 3 === 0 ? hex : n % 3 === 1 ? hex.toUpperCase() : mixedCase(hex))
        }
    })

    test('the 4-bit last character is one of the 16 canonical values and the alphabet reaches - and _', () => {
        const lasts = new Set<string>()
        for (let nibble = 0; nibble < 16; nibble++) {
            const stem = hexStemToBase64url('0'.repeat(63) + nibble.toString(16))
            lasts.add(stem[42])
            expect(stem).toHaveLength(43)
        }
        expect([...lasts].sort().join('')).toBe([...'AEIMQUYcgkosw048'].sort().join(''))
        expect(hexStemToBase64url('fb'.repeat(32))).toContain('-')
        expect(hexStemToBase64url('ff'.repeat(32))).toContain('_')
    })
})

describe('guard: hexStemToBase64url refuses what the earlier form refused, with the same error', () => {
    const refused: [string, string][] = [
        ['the empty string', ''],
        ['63 digits', '0'.repeat(63)],
        ['65 digits', '0'.repeat(65)],
        ['a non-hex letter', 'g' + '0'.repeat(63)],
        ['a trailing newline after 64 digits', '0'.repeat(64) + '\n'],
        ['a leading space', ' ' + '0'.repeat(63)],
        ['a non-ASCII digit', '٠' + '0'.repeat(63)],
        ['a 0x prefix', '0x' + '0'.repeat(62)],
        ['a stem with a separator', '0'.repeat(32) + '-' + '0'.repeat(31)],
    ]

    test.each(refused)('%s', (_label, input) => {
        let expected: unknown
        try {
            oracle(input)
        } catch (error) {
            expected = error
        }
        expect(expected).toBeInstanceOf(RangeError)
        expect(() => hexStemToBase64url(input)).toThrow(RangeError)
        expect(() => hexStemToBase64url(input)).toThrow('A hash stem is 64 hex digits.')
    })
})
