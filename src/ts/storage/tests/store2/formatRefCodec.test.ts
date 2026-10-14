import { crc32 } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { crc32 as blockCrc32 } from '../../blockFrame'
import { decodeFrame, encodeFrame, FRAME_HEADER_BYTES, FRAME_OVERHEAD, readRef, refOfFrame } from '../../store2/format'

/**
 * A frame the way a writer with another codec would store it: the same layout,
 * the codec byte set, and an arbitrary (for example compressed) payload.
 */
function frameWithCodec(codec: number, payload: Uint8Array): Uint8Array {
    const frame = encodeFrame(8, payload)
    frame[6] = codec
    const header = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    header.setUint32(12, blockCrc32(frame.subarray(0, 12)), true)
    return frame
}

const KEY = 'store2/u-0123456789abcdefghijklmnop'

describe('a Ref describes the stored bytes, whatever the codec', () => {
    const stored = Uint8Array.from([0x78, 0x9c, 0x01, 0x02, 0x03, 0xff, 0x00, 0x7f, 0x80])

    test('refOfFrame on a frame with codec 1 gives the stored length and the stored payload CRC', () => {
        const frame = frameWithCodec(1, stored)
        expect(refOfFrame(KEY, frame)).toEqual(['u-0123456789abcdefghijklmnop', FRAME_OVERHEAD + stored.length, crc32(Buffer.from(stored))])
    })

    test('the Ref is the same for the same stored bytes under any codec byte, and differs from the decoded content', () => {
        const a = refOfFrame(KEY, frameWithCodec(1, stored))
        const b = refOfFrame(KEY, frameWithCodec(200, stored))
        const plain = refOfFrame(KEY, frameWithCodec(0, stored))
        expect(a).toEqual(b)
        expect(a).toEqual(plain)
        const decoded = Uint8Array.from([...stored, 1, 2, 3, 4])
        expect(refOfFrame(KEY, frameWithCodec(1, decoded))[1]).not.toBe(a[1])
    })

    test('the frame is too-new to decode, yet its Ref is exact: bytes and crc are the stored ones', () => {
        const frame = frameWithCodec(1, stored)
        expect(decodeFrame(frame).status).toBe('too-new')
        const ref = readRef(refOfFrame(KEY, frame))
        expect(ref.bytes).toBe(frame.length)
        expect(ref.crc).toBe(blockCrc32(frame.subarray(FRAME_HEADER_BYTES, frame.length - 4)))
    })

    test('a buffer too short to be a frame is refused', () => {
        expect(() => refOfFrame(KEY, new Uint8Array(FRAME_OVERHEAD - 1))).toThrow(RangeError)
    })
})
