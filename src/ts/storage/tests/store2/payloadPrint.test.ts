// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { payloadPrint } from 'src/ts/storage/store2/codec/payloadPrint'

/**
 * The payload print is MurmurHash3 x86_128 over the bytes, whatever the view's offset. These cases pin that it does not
 * depend on alignment, that every byte and the length reach the result, and that it is the published function.
 */

/** A seeded linear congruential stream of bytes, so a failing input can be replayed. */
function randomBytes(length: number, seed: number): Uint8Array {
    let state = seed >>> 0
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out[i] = state >>> 24
    }
    return out
}

/** `bytes` copied into a larger buffer so the view starts at `offset`. */
function atOffset(bytes: Uint8Array, offset: number): Uint8Array {
    const backing = new Uint8Array(offset + bytes.length + 5)
    backing.set(bytes, offset)
    return backing.subarray(offset, offset + bytes.length)
}

describe('payloadPrint', () => {
    test('P1 guard, new surface: the print of the same bytes is equal at every offset, aligned or not', () => {
        for (let length = 0; length <= 80; length++) {
            const bytes = randomBytes(length, 1000 + length)
            const expected = payloadPrint(bytes)
            for (let offset = 0; offset <= 7; offset++) {
                const view = atOffset(bytes, offset)
                expect(view.byteOffset, `offset ${offset}`).toBe(offset)
                expect(payloadPrint(view), `length ${length} offset ${offset}`).toBe(expected)
            }
        }
    })

    test('P2 guard, new surface: every bit, the length and the last bytes reach the print', () => {
        for (let length = 1; length <= 64; length++) {
            const bytes = randomBytes(length, 7000 + length)
            const base = payloadPrint(bytes)
            const seen = new Set<string>([base])
            for (let bit = 0; bit < length * 8; bit++) {
                const flipped = new Uint8Array(bytes)
                flipped[bit >> 3] ^= 1 << (bit & 7)
                const print = payloadPrint(flipped)
                expect(print, `length ${length} bit ${bit}`).not.toBe(base)
                seen.add(print)
            }
            expect(seen.size, `length ${length}`).toBe(length * 8 + 1)
            const longer = new Uint8Array(length + 1)
            longer.set(bytes)
            expect(payloadPrint(longer), `length ${length} plus a zero byte`).not.toBe(base)
            for (let tail = 1; tail <= Math.min(3, length); tail++) {
                const changed = new Uint8Array(bytes)
                changed[length - tail] ^= 0xa5
                expect(payloadPrint(changed), `length ${length} byte -${tail}`).not.toBe(base)
            }
        }
    })

    /** MurmurHash3 x86_128 written over BigInt with explicit 32-bit masking: a second, independent writing of the published algorithm. */
    function reference(bytes: Uint8Array, seed: number): string {
        const M = 0xffffffffn
        const rotl = (x: bigint, r: bigint) => ((x << r) | (x >> (32n - r))) & M
        const mul = (a: bigint, b: bigint) => (a * b) & M
        const mix = (h: bigint) => {
            h ^= h >> 16n
            h = mul(h, 0x85ebca6bn)
            h ^= h >> 13n
            h = mul(h, 0xc2b2ae35n)
            return h ^ (h >> 16n)
        }
        const c = [0x239b961bn, 0xab0e9789n, 0x38b34ae5n, 0xa1e38b93n]
        const rot = [15n, 16n, 17n, 18n]
        const rotH = [19n, 17n, 15n, 13n]
        const add = [0x561ccd1bn, 0x0bcaa747n, 0x96cd1c35n, 0x32ac3b17n]
        const h = [BigInt(seed), BigInt(seed), BigInt(seed), BigInt(seed)]
        const word = (at: number, count: number): bigint => {
            let k = 0n
            for (let i = count - 1; i >= 0; i--) {
                k = (k << 8n) | BigInt(bytes[at + i])
            }
            return k
        }
        const scramble = (k: bigint, lane: number) => mul(rotl(mul(k, c[lane]), rot[lane]), c[(lane + 1) % 4])
        const full = Math.floor(bytes.length / 16)
        for (let block = 0; block < full; block++) {
            for (let lane = 0; lane < 4; lane++) {
                h[lane] ^= scramble(word(block * 16 + lane * 4, 4), lane)
                h[lane] = (mul(rotl(h[lane], rotH[lane]) + h[(lane + 1) % 4], 5n) + add[lane]) & M
            }
        }
        const rest = bytes.length - full * 16
        for (let lane = 0; lane < 4; lane++) {
            const have = Math.min(4, rest - lane * 4)
            if (have > 0) {
                h[lane] ^= scramble(word(full * 16 + lane * 4, have), lane)
            }
        }
        const total = BigInt(bytes.length)
        for (let lane = 0; lane < 4; lane++) {
            h[lane] ^= total
        }
        h[0] = (h[0] + h[1] + h[2] + h[3]) & M
        for (let lane = 1; lane < 4; lane++) {
            h[lane] = (h[lane] + h[0]) & M
        }
        for (let lane = 0; lane < 4; lane++) {
            h[lane] = mix(h[lane])
        }
        h[0] = (h[0] + h[1] + h[2] + h[3]) & M
        for (let lane = 1; lane < 4; lane++) {
            h[lane] = (h[lane] + h[0]) & M
        }
        return h.map(word32 => word32.toString(16).padStart(8, '0')).join('')
    }

    test('P3 guard, new surface: the print equals an independent BigInt writing of MurmurHash3 x86_128 over 200 seeded inputs and offsets', () => {
        for (let n = 0; n < 200; n++) {
            const length = (n * 37) % 301
            const bytes = randomBytes(length, 31 * n + 5)
            const view = atOffset(bytes, n % 8)
            const print = payloadPrint(view)
            expect(print, `input ${n}`).toMatch(/^[0-9a-f]{32}$/)
            expect(print, `input ${n} length ${length}`).toBe(reference(bytes, 0))
        }
    })

    test('P3 guard, new surface: the empty input at seed 0 is all zeros, as the published function gives', () => {
        expect(payloadPrint(new Uint8Array(0))).toBe('0'.repeat(32))
    })

    /**
     * Published known answer: the SMHasher verification value of MurmurHash3_x86_128 is 0xB3ECE62A (Austin Appleby's
     * SMHasher, `VerificationTest` in KeysetTest.cpp, and the table of verification values in its README/main.cpp).
     * The procedure: for i in 0..255 hash the key bytes {0..i-1} with seed 256-i, collect the 16-byte outputs
     * (h1..h4 as little-endian words), hash that 4096-byte buffer with seed 0, and read the first four output bytes
     * as a little-endian word, which is h1.
     */
    test('P3 guard, new surface: the SMHasher verification value of MurmurHash3_x86_128 is 0xB3ECE62A', () => {
        const key = new Uint8Array(256)
        const hashes = new Uint8Array(256 * 16)
        for (let i = 0; i < 256; i++) {
            key[i] = i
            const hex = payloadPrint(key.subarray(0, i), 256 - i)
            for (let word = 0; word < 4; word++) {
                const value = parseInt(hex.slice(word * 8, word * 8 + 8), 16)
                new DataView(hashes.buffer).setUint32(i * 16 + word * 4, value, true)
            }
        }
        const final = payloadPrint(hashes, 0)
        expect(parseInt(final.slice(0, 8), 16)).toBe(0xb3ece62a)
    })
})
