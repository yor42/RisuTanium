import { describe, expect, test } from 'vitest'
import { RANGE_TRAILER_BYTES, splitRangeReply } from './tauriByteTransport'

/**
 * T16: `splitRangeReply` strips the fixed trailer of a range reply (the file's size as its first little-endian word,
 * then the identity words) and returns the piece. A compatibility guard for `requestPiece`, which uses it, and a guard
 * for the native reply body read, which does too. Mutant M28 returns the whole reply as the piece.
 */

function reply(piece: Uint8Array, total: number, fill = 7): Uint8Array {
    const out = new Uint8Array(piece.length + RANGE_TRAILER_BYTES)
    out.set(piece, 0)
    const trailer = new DataView(out.buffer, piece.length, RANGE_TRAILER_BYTES)
    trailer.setBigUint64(0, BigInt(total), true)
    for (let i = 8; i < RANGE_TRAILER_BYTES; i++) {
        out[piece.length + i] = fill
    }
    return out
}

describe('splitRangeReply', () => {
    test('returns the piece without the trailer and the size the trailer reports', () => {
        const piece = new TextEncoder().encode('hello')
        const split = splitRangeReply(reply(piece, 12345), 'k')
        expect(new TextDecoder().decode(split.bytes)).toBe('hello')
        expect(split.total).toBe(12345)
        expect(split.identity).toHaveLength(RANGE_TRAILER_BYTES * 2)
    })

    test('an empty piece is allowed and a reply shorter than the trailer throws', () => {
        expect(splitRangeReply(reply(new Uint8Array(0), 0), 'k').bytes).toHaveLength(0)
        expect(() => splitRangeReply(new Uint8Array(RANGE_TRAILER_BYTES - 1), 'k')).toThrow(/fewer than its trailer/)
    })

    test('the identity differs when the trailer differs', () => {
        const a = splitRangeReply(reply(new Uint8Array(2), 2, 1), 'k')
        const b = splitRangeReply(reply(new Uint8Array(2), 2, 2), 'k')
        expect(a.identity).not.toBe(b.identity)
    })
})
