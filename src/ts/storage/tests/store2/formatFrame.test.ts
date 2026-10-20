import { crc32 } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import {
    decodeFrame, encodeFrame, FRAME_OVERHEAD, readRef, refOfFrame, UNIT_TYPE_IDS, type ChunkRef, type UnitType,
} from '../../store2/format'
import { oracleFrame } from './goldenVectors'

const TEXT = new TextEncoder()
const PAYLOAD = '{"v":1}'

describe('frame encode', () => {
    test('every unit type encodes to the oracle bytes', () => {
        for (const type of UNIT_TYPE_IDS) {
            expect(encodeFrame(type, TEXT.encode(PAYLOAD))).toEqual(oracleFrame(type, PAYLOAD))
        }
    })

    test('the overhead is 20 bytes and an empty payload is a valid frame', () => {
        const frame = encodeFrame(8, new Uint8Array(0))
        expect(frame.length).toBe(FRAME_OVERHEAD)
        expect(decodeFrame(frame).status).toBe('ok')
    })

    test('an unknown type is refused by the writer', () => {
        expect(() => encodeFrame(0 as UnitType, TEXT.encode(PAYLOAD))).toThrow(RangeError)
        expect(() => encodeFrame(25 as UnitType, TEXT.encode(PAYLOAD))).toThrow(RangeError)
    })
})

describe('frame decode: ok', () => {
    test('round trip gives the type, the payload and the stored payload CRC', () => {
        const result = decodeFrame(oracleFrame(7, PAYLOAD))
        expect(result.status).toBe('ok')
        if (result.status === 'ok') {
            expect(result.type).toBe(7)
            expect(new TextDecoder().decode(result.payload)).toBe(PAYLOAD)
            expect(result.payloadCrc).toBe(crc32(Buffer.from(PAYLOAD)))
        }
    })
})

describe('frame decode: too-new is never damaged', () => {
    test.each([
        ['codec 1', { codec: 1 }, 1],
        ['codec 255', { codec: 255 }, 1],
        ['reserved 1', { reserved: 1 }, 1],
        ['reserved 128', { reserved: 128 }, 1],
        ['fmt 2', { fmt: 2 }, 1],
        ['fmt 255', { fmt: 255 }, 1],
        ['type 0', {}, 0],
        ['type 25', {}, 25],
        ['type 255', {}, 255],
    ])('valid header CRC with %s is too-new', (_name, header, type) => {
        expect(decodeFrame(oracleFrame(type, PAYLOAD, header)).status).toBe('too-new')
    })

    test('a newer format is too-new even when nothing after its header matches this layout', () => {
        const header = oracleFrame(1, PAYLOAD, { fmt: 2 }).subarray(0, 16)
        expect(decodeFrame(header).status).toBe('too-new')
    })

    test.each([
        ['codec 1', { codec: 1 }, 1],
        ['reserved 1', { reserved: 1 }, 1],
        ['type 99', {}, 99],
    ])('%s is too-new from a valid header alone, whatever follows it', (_name, header, type) => {
        const whole = oracleFrame(type, PAYLOAD, header)
        expect(decodeFrame(whole.subarray(0, 16)).status).toBe('too-new')
        expect(decodeFrame(whole.subarray(0, 19)).status).toBe('too-new')
        const garbage = new Uint8Array(40).fill(0xab)
        garbage.set(whole.subarray(0, 16), 0)
        expect(decodeFrame(garbage).status).toBe('too-new')
        const wrongLength = new Uint8Array(whole.length + 5)
        wrongLength.set(whole)
        expect(decodeFrame(wrongLength).status).toBe('too-new')
    })

    test('an unknown codec with a failed header CRC is damaged: the header cannot be trusted', () => {
        const bytes = oracleFrame(1, PAYLOAD, { codec: 1 })
        bytes[12] ^= 0xff
        expect(decodeFrame(bytes).status).toBe('damaged')
    })
})

describe('frame decode: damaged', () => {
    test('bad magic', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        bytes[0] = 0x58
        expect(decodeFrame(bytes).status).toBe('damaged')
    })

    test.each([4, 5, 6, 7, 8, 11])('a flipped header byte %i fails the header checksum', (index) => {
        const bytes = oracleFrame(1, PAYLOAD)
        bytes[index] ^= 0x01
        expect(decodeFrame(bytes).status).toBe('damaged')
    })

    test('bad magic is damaged even when the header checksum is recomputed to match', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        bytes.set([0x58, 0x58, 0x58, 0x58], 0)
        new DataView(bytes.buffer).setUint32(12, crc32(bytes.subarray(0, 12)), true)
        expect(decodeFrame(bytes).status).toBe('damaged')
    })

    test('a flipped header checksum byte', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        bytes[13] ^= 0x01
        expect(decodeFrame(bytes).status).toBe('damaged')
    })

    test('a flipped payload byte fails the payload checksum', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        bytes[17] ^= 0x01
        expect(decodeFrame(bytes).status).toBe('damaged')
    })

    test('a flipped payload checksum byte', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        bytes[bytes.length - 1] ^= 0x01
        expect(decodeFrame(bytes).status).toBe('damaged')
    })

    test('every truncation of a frame is damaged', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        for (let length = 0; length < bytes.length; length++) {
            expect(decodeFrame(bytes.subarray(0, length)).status).toBe('damaged')
        }
    })

    test('bytes after the frame are damaged', () => {
        const bytes = oracleFrame(1, PAYLOAD)
        const longer = new Uint8Array(bytes.length + 1)
        longer.set(bytes)
        expect(decodeFrame(longer).status).toBe('damaged')
    })

    test('fmt 0 never existed and is damaged', () => {
        expect(decodeFrame(oracleFrame(1, PAYLOAD, { fmt: 0 })).status).toBe('damaged')
    })
})

describe('Ref of a stored frame', () => {
    const KEY = 'store2/u-' + '0'.repeat(26)

    test('refOfFrame carries the tail, the framed length and the stored payload CRC', () => {
        const frame = oracleFrame(14, PAYLOAD)
        expect(refOfFrame(KEY, frame)).toEqual(['u-' + '0'.repeat(26), frame.length, crc32(Buffer.from(PAYLOAD))])
    })

    test('the generic Ref reader reads the prefix of a chunk tuple and a list tuple', () => {
        const chunk: ChunkRef = ['u-x', 4096, 7, 12]
        expect(readRef(chunk)).toEqual({ tail: 'u-x', bytes: 4096, crc: 7 })
        const longer: ChunkRef = ['u-x', 4096, 7, 12, 'later', { a: 1 }]
        expect(readRef(longer).bytes).toBe(4096)
    })
})
