// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { deriveKek } from 'src/ts/drive/rtb/sealed/kdf'
import { passwordBytes } from 'src/ts/drive/rtb/sealed/password'

const NFD = 'Test ' + String.fromCharCode(0x1112, 0x1161, 0x11ab, 0x1100, 0x1173, 0x11af) + ' 1'
const NFC = 'Test 한글 1'

function hex(value: Uint8Array | string): string {
    if (typeof value === 'string') {
        throw new Error(`refused: ${value}`)
    }
    return Buffer.from(value).toString('hex')
}

describe('passwordBytes', () => {
    test('NFD and NFC Hangul give the same bytes, the ones of the vector', () => {
        expect(NFD).not.toBe(NFC)
        expect(hex(passwordBytes(NFD))).toBe('5465737420ed959ceab8802031')
        expect(hex(passwordBytes(NFC))).toBe('5465737420ed959ceab8802031')
    })

    test('both spellings derive the same key', async () => {
        const salt = new Uint8Array(16).fill(5)
        const params = { m: 64, t: 1, p: 1 }
        const a = await deriveKek(passwordBytes(NFD) as Uint8Array, salt, params)
        const b = await deriveKek(passwordBytes(NFC) as Uint8Array, salt, params)
        expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    })

    test('the empty string is refused', () => {
        expect(passwordBytes('')).toBe('empty')
    })

    test('a lone high surrogate and a lone low surrogate are refused, at any position', () => {
        expect(passwordBytes('\ud800')).toBe('ill-formed')
        expect(passwordBytes('\udc00')).toBe('ill-formed')
        expect(passwordBytes('ab\ud83d')).toBe('ill-formed')
        expect(passwordBytes('\ud83dx')).toBe('ill-formed')
        expect(passwordBytes('x\ude00')).toBe('ill-formed')
        expect(passwordBytes('\ude00\ud83d')).toBe('ill-formed')
    })

    test('a surrogate pair is accepted and encoded as one code point', () => {
        expect(hex(passwordBytes('😀'))).toBe('f09f9880')
    })

    test('nothing is trimmed and case is kept', () => {
        expect(hex(passwordBytes(' pw'))).toBe('207077')
        expect(hex(passwordBytes('pw '))).toBe('707720')
        expect(hex(passwordBytes('Pw'))).toBe('5077')
        expect(hex(passwordBytes('pw'))).not.toBe(hex(passwordBytes(' pw')))
        expect(hex(passwordBytes('　'))).toBe('e38080')
    })

    test('a text that is only whitespace is usable', () => {
        expect(hex(passwordBytes(' '))).toBe('20')
    })
})
