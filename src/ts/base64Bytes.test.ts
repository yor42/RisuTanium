import { describe, expect, test } from 'vitest'
// The app's `buffer` package, not Node's own Buffer: the importer being replaced decoded with this one.
import { Buffer as PolyfillBuffer } from 'buffer/index.js'
import { Base64StreamDecoder, decodeBase64Bytes } from './base64Bytes'

const encode = (text: string) => new TextEncoder().encode(text)
const reference = (text: string) => new Uint8Array(PolyfillBuffer.from(text, 'base64'))
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

/** A small deterministic generator, so a failing case can be reproduced. */
function random(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
    }
}

describe('decodeBase64Bytes (compatibility guard)', () => {
    test('is not Node\'s own Buffer: the reference is the polyfill', () => {
        expect(PolyfillBuffer).not.toBe(Buffer)
    })

    test.each([
        'QUJD', 'QUJDRA', 'QUJDRA==', 'QUJD=RA==', 'QU JD\nRA==', 'QUJD-_8', 'QUJDR', 'Q', 'QQ', '=QUJD', '', '=',
        'QUJDRA==QUJD', '﻿QUJD', 'QUJDéRA', ' \tQUJD ', 'QUJDRAB', 'QUJDRABC', 'QUJDRABCD', '+/+/', '-_-_', '-_-',
        'QUJD\r\nRABC\r\n', 'A', 'AB', 'ABC', 'ABCD', 'ABCDE', '====', 'AB==CD', 'AB=CD=EF', 'abc!def?ghi',
    ])('gives the polyfill\'s bytes for %j', (text) => {
        expect(hex(decodeBase64Bytes(encode(text)))).toBe(hex(reference(text)))
    })

    test('gives the polyfill\'s bytes for every length of text from 0 to 40 in each residue class', () => {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_'
        const next = random(7)
        for (let length = 0; length <= 40; length++) {
            for (let round = 0; round < 20; round++) {
                const text = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
                expect(hex(decodeBase64Bytes(encode(text))), JSON.stringify(text)).toBe(hex(reference(text)))
            }
        }
    })

    test('gives the polyfill\'s bytes for thousands of fuzzed texts with whitespace, invalid characters, url-safe characters and padding anywhere', () => {
        const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_ \t\r\n=!?.,éあ﻿ '
        const next = random(12345)
        let cases = 0
        for (let round = 0; round < 6000; round++) {
            const length = Math.floor(next() * 120)
            const heavy = next() < 0.5
            const text = Array.from({ length }, () => {
                //Half of the texts are mostly alphabet, the others draw from the whole pool.
                return heavy ? pool[Math.floor(next() * pool.length)] : pool[Math.floor(next() * 66)]
            }).join('')
            expect(hex(decodeBase64Bytes(encode(text))), JSON.stringify(text)).toBe(hex(reference(text)))
            cases++
        }
        expect(cases).toBe(6000)
    })

    test('gives the polyfill\'s bytes for the UTF-8 decoding of arbitrary bytes, as a text chunk is read today', () => {
        const next = random(99)
        for (let round = 0; round < 3000; round++) {
            const bytes = new Uint8Array(Math.floor(next() * 90))
            for (let i = 0; i < bytes.length; i++) {
                //Mostly alphabet bytes, with stray control, high and invalid-UTF-8 bytes among them.
                bytes[i] = next() < 0.8 ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(Math.floor(next() * 64)) : Math.floor(next() * 256)
            }
            const text = new TextDecoder().decode(bytes)
            expect(hex(decodeBase64Bytes(bytes)), hex(bytes)).toBe(hex(reference(text)))
        }
    })

    test('decodes a text of a few megabytes to the bytes that were encoded', () => {
        const original = new Uint8Array(3 * 1024 * 1024 + 2).map((_, i) => (i * 131 + (i >> 9)) & 0xff)
        const encoded = encode(Buffer.from(original).toString('base64'))
        expect(Buffer.from(decodeBase64Bytes(encoded)).equals(Buffer.from(original))).toBe(true)
    })
})

/** The bytes the stream decoder gives for the text cut at `cuts`: every push result and the finish, joined. */
function streamDecode(text: Uint8Array, cuts: number[]): Uint8Array {
    const decoder = new Base64StreamDecoder()
    const parts: Uint8Array[] = []
    let from = 0
    for (const cut of [...cuts, text.length]) {
        parts.push(decoder.push(text.subarray(from, cut)))
        from = cut
    }
    parts.push(decoder.finish())
    return Buffer.concat(parts)
}

describe('Base64StreamDecoder (compatibility guard: the same bytes as decodeBase64Bytes wherever the text is cut)', () => {
    const texts = [
        'QUJD', 'QUJDRA', 'QUJDRA==', 'QUJD=RA==', 'QU JD\nRA==', 'QUJD-_8', 'QUJDR', 'Q', 'QQ', '=QUJD', '', '=',
        'QUJDRA==QUJD', '﻿QUJD', 'QUJDéRA', ' \tQUJD ', 'QUJDRAB', 'QUJDRABC', 'QUJDRABCD', '+/+/', '-_-_', '-_-',
        'QUJD\r\nRABC\r\n', 'A', 'AB', 'ABC', 'ABCD', 'ABCDE', '====', 'AB==CD', 'AB=CD=EF', 'abc!def?ghi',
        'QUJDRABC\r\nREVG\r\nR0hJ\r\nSktM\r\n', 'QUJDREVGR0hJ=', 'QUJDREVGR0hJ=Zm9v',
    ]

    test.each(texts)('gives the bytes of decodeBase64Bytes for %j cut at every offset, and at every pair of offsets', (text) => {
        const bytes = encode(text)
        const whole = hex(decodeBase64Bytes(bytes))
        for (let a = 0; a <= bytes.length; a++) {
            expect(hex(streamDecode(bytes, [a])), `${JSON.stringify(text)} cut at ${a}`).toBe(whole)
            for (let b = a; b <= bytes.length; b++) {
                expect(hex(streamDecode(bytes, [a, b])), `${JSON.stringify(text)} cut at ${a},${b}`).toBe(whole)
            }
        }
    })

    test('gives the bytes of decodeBase64Bytes for fuzzed texts with whitespace, url-safe characters, non-ASCII bytes and padding anywhere, cut at random places', () => {
        const pool = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_ \t\r\n=!?.,éあ﻿ '
        const next = random(4242)
        for (let round = 0; round < 6000; round++) {
            const length = Math.floor(next() * 160)
            const heavy = next() < 0.5
            const text = Array.from({ length }, () => heavy ? pool[Math.floor(next() * pool.length)] : pool[Math.floor(next() * 66)]).join('')
            const bytes = encode(text)
            const cuts = Array.from({ length: Math.floor(next() * 6) }, () => Math.floor(next() * (bytes.length + 1))).sort((a, b) => a - b)
            expect(hex(streamDecode(bytes, cuts)), `${JSON.stringify(text)} cut at ${cuts}`).toBe(hex(decodeBase64Bytes(bytes)))
        }
    })

    test('gives the bytes of decodeBase64Bytes for arbitrary bytes, cut at random places', () => {
        const next = random(77)
        for (let round = 0; round < 3000; round++) {
            const bytes = new Uint8Array(Math.floor(next() * 120))
            for (let i = 0; i < bytes.length; i++) {
                bytes[i] = next() < 0.8 ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(Math.floor(next() * 64)) : Math.floor(next() * 256)
            }
            const cuts = Array.from({ length: Math.floor(next() * 5) }, () => Math.floor(next() * (bytes.length + 1))).sort((a, b) => a - b)
            expect(hex(streamDecode(bytes, cuts)), hex(bytes)).toBe(hex(decodeBase64Bytes(bytes)))
        }
    })

    test('keeps ignoring text after an = that came in an earlier piece, and a group cut across pieces is completed by the next', () => {
        const decoder = new Base64StreamDecoder()
        expect(hex(decoder.push(encode('QU')))).toBe('')
        expect(hex(decoder.push(encode('JDRA=')))).toBe('414243')
        expect(hex(decoder.push(encode('QUJDQUJD')))).toBe('')
        expect(hex(decoder.finish())).toBe('44')
    })

    test('a text of a few megabytes in pieces of an odd size decodes to the bytes that were encoded, and the pieces are never touched', () => {
        const original = new Uint8Array(3 * 1024 * 1024 + 2).map((_, i) => (i * 131 + (i >> 9)) & 0xff)
        const encoded = encode(Buffer.from(original).toString('base64'))
        const pristine = encoded.slice()
        const decoder = new Base64StreamDecoder()
        const parts: Uint8Array[] = []
        for (let at = 0; at < encoded.length; at += 65537) {
            parts.push(decoder.push(encoded.subarray(at, at + 65537)))
        }
        parts.push(decoder.finish())
        expect(Buffer.concat(parts).equals(Buffer.from(original))).toBe(true)
        expect(Buffer.compare(Buffer.from(encoded), Buffer.from(pristine))).toBe(0)
    })

    test('every result is an array of its own: a later push never changes an earlier result', () => {
        const decoder = new Base64StreamDecoder()
        const first = decoder.push(encode('QUJDRABC'))
        const kept = hex(first)
        decoder.push(encode('REVGR0hJ'))
        decoder.finish()
        expect(hex(first)).toBe(kept)
    })
})
