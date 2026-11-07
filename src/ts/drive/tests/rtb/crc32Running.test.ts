import { describe, test, expect } from 'vitest'
import { crc32 as crcPackage } from 'crc'
import { crc32 } from 'src/ts/storage/blockFrame'
import {
    CRC32_INIT,
    crc32Update,
    crc32Final,
    crc32Combine,
    crc32OfFill,
    crc32UpdateFill,
} from 'src/ts/drive/rtb/crc32Running'

// Deterministic generator so a failure reproduces.
function prng(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6D2B79F5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function randomBytes(length: number, next: () => number): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = Math.floor(next() * 256)
    }
    return out
}

describe('T-crc running CRC', () => {
    test('the check value of "123456789"', () => {
        const data = new TextEncoder().encode('123456789')
        expect(crc32Final(crc32Update(CRC32_INIT, data))).toBe(0xCBF43926)
    })

    test('random splits equal the one-shot crc32 and the crc package', () => {
        const next = prng(0xC0FFEE)
        for (let round = 0; round < 40; round++) {
            const data = randomBytes(1 + Math.floor(next() * 20000), next)
            const cuts = new Set<number>()
            const parts = Math.floor(next() * 8)
            for (let i = 0; i < parts; i++) {
                cuts.add(Math.floor(next() * data.length))
            }
            const bounds = [0, ...[...cuts].sort((a, b) => a - b), data.length]
            let state = CRC32_INIT
            for (let i = 0; i + 1 < bounds.length; i++) {
                state = crc32Update(state, data.subarray(bounds[i], bounds[i + 1]))
            }
            const running = crc32Final(state)
            expect(running).toBe(crc32(data))
            expect(running).toBe(crcPackage(Buffer.from(data.buffer, data.byteOffset, data.length)) >>> 0)
        }
    })

    test('an empty chunk changes nothing and the empty CRC is 0', () => {
        expect(crc32Final(CRC32_INIT)).toBe(0)
        const data = new Uint8Array([1, 2, 3])
        const once = crc32Update(CRC32_INIT, data)
        expect(crc32Update(once, new Uint8Array(0))).toBe(once)
    })
})

describe('T-fill CRC of a fill run by combine', () => {
    const lengths = [0, 1, 255, 4096, 1024 * 1024 + 3]
    for (const byte of [0x00, 0x5A, 0xFF]) {
        for (const length of lengths) {
            test(`byte ${byte} x ${length} equals the byte-wise CRC`, () => {
                const filled = new Uint8Array(length).fill(byte)
                expect(crc32OfFill(byte, length)).toBe(crc32(filled))
            })
        }
    }

    test('combine of two parts equals the CRC of the whole', () => {
        const next = prng(7)
        const a = randomBytes(777, next)
        const b = randomBytes(1301, next)
        const whole = new Uint8Array(a.length + b.length)
        whole.set(a, 0)
        whole.set(b, a.length)
        expect(crc32Combine(crc32(a), crc32(b), b.length)).toBe(crc32(whole))
        expect(crc32Combine(crc32(a), 0, 0)).toBe(crc32(a))
    })

    test('a fill folded into a running state equals the byte-wise CRC', () => {
        const next = prng(11)
        const head = randomBytes(513, next)
        const tail = randomBytes(99, next)
        const all = new Uint8Array(head.length + 70000 + tail.length)
        all.set(head, 0)
        all.fill(0xAB, head.length, head.length + 70000)
        all.set(tail, head.length + 70000)
        let state = crc32Update(CRC32_INIT, head)
        state = crc32UpdateFill(state, 0xAB, 70000)
        state = crc32Update(state, tail)
        expect(crc32Final(state)).toBe(crc32(all))
    })

    test('a doubled fill equals the combine of two halves, past 2^32', () => {
        // No byte-wise reference exists at this size; the identity ties the doubling to combine.
        const half = 2 ** 32 + 1
        const whole = crc32OfFill(0x00, half * 2)
        expect(whole).toBe(crc32Combine(crc32OfFill(0x00, half), crc32OfFill(0x00, half), half))
    })
})
