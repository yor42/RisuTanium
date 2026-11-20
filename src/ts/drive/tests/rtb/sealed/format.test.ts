// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    chunkCount,
    chunkNonce,
    encodeHeader,
    encodeHeaderFromRecords,
    encodeSlotRecord,
    layoutOf,
    parseFixedPart,
    parseSealedHeader,
    sealedFileSize,
    V1_HEADER_LEN,
    type Parsed,
    type SealedHeader,
} from 'src/ts/drive/rtb/sealed/format'
import {
    DEFAULT_CAPS,
    DEFAULT_CHUNK,
    DEFAULT_M_KIB,
    DEFAULT_SEAL_PARAMS,
    DEFAULT_T,
    M_CEIL_KIB,
    WORK_CAP,
    type SealedCaps,
} from 'src/ts/drive/rtb/sealed/policy'
import { referenceSeal, vectorPlaintext, VECTOR_INPUT } from './sealedReference'

// Header of the specification vectors; bytes 120..167 are the wrapped master key.
const VECTOR_HEADER_HEX = '525442580d0a1a0a010000000100000040000000505152535455565758595a5b5c5d5e5fa8000000a546d0aad9d3f4ad520627a26273c2bccf8d3f5c625f5b73b7116ed711eccfd10100000001005800010001000001000002000000101112131415161718191a1b1c1d1e1f404142434445464748494a4b44e51b79941e16374072aaaa84d0e8a5a4711f599f1f13e01a3cb69b169cdf7f9406a72e425f336f85ffd4574472ab3d'

const SMALL_CAPS: SealedCaps = { mCeilKib: 1024, workCap: 4096 }

function baseFile(plaintextLen = 150): Buffer {
    return Buffer.from(referenceSeal({ ...VECTOR_INPUT, plaintext: vectorPlaintext(plaintextLen) }).file)
}

function parse(file: Buffer, caps: SealedCaps = SMALL_CAPS, size = file.length): Parsed<SealedHeader> {
    return parseSealedHeader(file.subarray(0, Math.min(76, size)), file.subarray(76), size, caps)
}

function refusal(result: Parsed<SealedHeader>): string {
    return result.kind === 'ok' ? 'ok' : `${result.kind} ${result.row}`
}

// Offsets inside the vector header: fixed header, then the password slot at 76.
const AT = { version: 8, flags: 10, aead: 12, reservedA: 13, chunk: 16, headerLen: 36, reservedB: 74, slotCount: 72, slotType: 76, bodyLen: 78, kdf: 80, reservedS: 81, p: 82, m: 84, t: 88 }

describe('header bytes', () => {
    test('encodeHeader writes exactly the vector header', () => {
        const wrapped = Buffer.from(VECTOR_HEADER_HEX.slice(120 * 2), 'hex')
        const header = encodeHeader({
            chunkSize: VECTOR_INPUT.C,
            fileId: VECTOR_INPUT.fileId,
            keyCommit: Buffer.from(VECTOR_HEADER_HEX.slice(40 * 2, 72 * 2), 'hex'),
            p: VECTOR_INPUT.p,
            m: VECTOR_INPUT.m,
            t: VECTOR_INPUT.t,
            salt: VECTOR_INPUT.salt,
            wrapNonce: VECTOR_INPUT.wrapNonce,
            wrappedKey: wrapped,
        })
        expect(header.length).toBe(V1_HEADER_LEN)
        expect(Buffer.from(header).toString('hex')).toBe(VECTOR_HEADER_HEX)
    })

    test('the parsed vector header carries every field', () => {
        const parsed = parse(baseFile())
        if (parsed.kind !== 'ok') {
            throw new Error(refusal(parsed))
        }
        expect(parsed.value).toMatchObject({ version: 1, flags: 0, aeadId: 1, chunkSize: 64, headerLen: 168, slotCount: 1 })
        expect(parsed.value.slot).toMatchObject({ kdfId: 1, p: 1, m: 256, t: 2 })
        expect(Buffer.from(parsed.value.fixedPart).toString('hex')).toBe(VECTOR_HEADER_HEX.slice(0, 72))
        expect(Buffer.from(parsed.value.slot.aad).toString('hex')).toBe(VECTOR_HEADER_HEX.slice(76 * 2, 120 * 2))
    })

    test('parsed fields are copies, not views of the caller buffer', () => {
        const file = baseFile()
        const parsed = parse(file)
        if (parsed.kind !== 'ok') {
            throw new Error(refusal(parsed))
        }
        const before = Buffer.from(parsed.value.slot.salt).toString('hex')
        file.fill(0, 76)
        expect(Buffer.from(parsed.value.slot.salt).toString('hex')).toBe(before)
    })
})

describe('chunk nonce', () => {
    test('index 0 with and without the last flag', () => {
        expect(Buffer.from(chunkNonce(0, false)).toString('hex')).toBe('000000000000000000000000')
        expect(Buffer.from(chunkNonce(0, true)).toString('hex')).toBe('000000000000000000000001')
    })

    test('the index is big-endian in 11 bytes', () => {
        expect(Buffer.from(chunkNonce(258, false)).toString('hex')).toBe('000000000000000000010200')
        expect(Buffer.from(chunkNonce(0x1_0000_0000, true)).toString('hex')).toBe('000000000000010000000001')
    })
})

describe('header rows H1 to H9 and H12 to H19', () => {
    const cases: Array<[string, (file: Buffer) => void, string]> = [
        ['H1 version 0', (f) => f.writeUInt16LE(0, AT.version), 'damaged H1'],
        ['H1 version 2', (f) => f.writeUInt16LE(2, AT.version), 'newer H1'],
        ['H1 version 65535', (f) => f.writeUInt16LE(65535, AT.version), 'newer H1'],
        ['H3 flags', (f) => f.writeUInt16LE(1, AT.flags), 'newer H3'],
        ['H4 aead id 0', (f) => f.writeUInt8(0, AT.aead), 'damaged H4'],
        ['H4 aead id 2', (f) => f.writeUInt8(2, AT.aead), 'newer H4'],
        ['H5 reserved_a', (f) => f.writeUInt8(1, AT.reservedA + 2), 'newer H5'],
        ['H6 chunk size 63', (f) => f.writeUInt32LE(63, AT.chunk), 'damaged H6'],
        ['H6 chunk size 0', (f) => f.writeUInt32LE(0, AT.chunk), 'damaged H6'],
        ['H6 chunk size 16777217', (f) => f.writeUInt32LE(16_777_217, AT.chunk), 'newer H6'],
        ['H6 chunk size 64 stays valid', (f) => f.writeUInt32LE(64, AT.chunk), 'ok'],
        ['H6 chunk size 16777216 parses', (f) => f.writeUInt32LE(16_777_216, AT.chunk), 'ok'],
        ['H7 header_len 79', (f) => f.writeUInt32LE(79, AT.headerLen), 'damaged H7'],
        ['H7 header_len 65537', (f) => f.writeUInt32LE(65_537, AT.headerLen), 'newer H7'],
        ['H7 header_len beyond the file', (f) => f.writeUInt32LE(367, AT.headerLen), 'damaged H7'],
        ['H8 reserved_b', (f) => f.writeUInt8(1, AT.reservedB), 'newer H8'],
        ['H9 no slots', (f) => f.writeUInt16LE(0, AT.slotCount), 'damaged H9'],
        ['H9 65 slots', (f) => f.writeUInt16LE(65, AT.slotCount), 'newer H9'],
        ['H10 second slot missing', (f) => f.writeUInt16LE(2, AT.slotCount), 'damaged H10'],
        ['H10 reserved slot type', (f) => f.writeUInt16LE(0, AT.slotType), 'damaged H10'],
        ['H10 body runs past the header', (f) => f.writeUInt16LE(89, AT.bodyLen), 'damaged H10'],
        ['H10 password body of 87', (f) => f.writeUInt16LE(87, AT.bodyLen), 'damaged H10'],
        ['H12 only an unknown type', (f) => f.writeUInt16LE(9, AT.slotType), 'newer H12'],
        ['H13 kdf id 0', (f) => f.writeUInt8(0, AT.kdf), 'damaged H13'],
        ['H13 kdf id 2', (f) => f.writeUInt8(2, AT.kdf), 'newer H13'],
        ['H14 reserved_s', (f) => f.writeUInt8(1, AT.reservedS), 'newer H14'],
        ['H15 zero lanes', (f) => f.writeUInt16LE(0, AT.p), 'damaged H15'],
        ['H15 nine lanes', (f) => f.writeUInt16LE(9, AT.p), 'newer H15'],
        ['H16 zero passes', (f) => f.writeUInt32LE(0, AT.t), 'damaged H16'],
        ['H17 memory below 8 per lane', (f) => f.writeUInt32LE(7, AT.m), 'damaged H17'],
        ['H17 memory 16 with two lanes', (f) => { f.writeUInt16LE(2, AT.p); f.writeUInt32LE(15, AT.m) }, 'damaged H17'],
        ['H18 memory at the ceiling', (f) => { f.writeUInt32LE(1024, AT.m); f.writeUInt32LE(2, AT.t) }, 'ok'],
        ['H18 memory one above the ceiling', (f) => f.writeUInt32LE(1025, AT.m), 'newer H18'],
        ['H19 work exactly at the cap', (f) => { f.writeUInt32LE(1024, AT.m); f.writeUInt32LE(4, AT.t) }, 'ok'],
        ['H19 work one pass above the cap', (f) => { f.writeUInt32LE(1024, AT.m); f.writeUInt32LE(5, AT.t) }, 'newer H19'],
    ]
    test.each(cases)('%s', (_name, patch, expected) => {
        const file = baseFile()
        patch(file)
        expect(refusal(parse(file))).toBe(expected)
    })

    test('H1 runs before H2: a version 2 file cut to 50 bytes reads as newer', () => {
        const file = baseFile().subarray(0, 50)
        file.writeUInt16LE(2, AT.version)
        expect(refusal(parse(file))).toBe('newer H1')
    })

    test('H2: a version 1 file of 50 bytes is damaged, and so is one of 9 bytes', () => {
        expect(refusal(parse(baseFile().subarray(0, 50)))).toBe('damaged H2')
        expect(refusal(parse(baseFile().subarray(0, 9)))).toBe('damaged H1')
    })

    test('the rows run in table order: an earlier row hides a later one', () => {
        const file = baseFile()
        file.writeUInt16LE(1, AT.flags)
        file.writeUInt8(0, AT.aead)
        expect(refusal(parse(file))).toBe('newer H3')
        file.writeUInt16LE(0, AT.flags)
        expect(refusal(parse(file))).toBe('damaged H4')
    })

    test('the magic is not a header row: the sniff owns it', () => {
        const file = baseFile()
        file.fill(0, 0, 8)
        expect(parseFixedPart(file.subarray(0, 76), file.length).kind).toBe('ok')
    })
})

describe('slots and padding', () => {
    const file = baseFile()
    const record = file.subarray(76, 168)
    const common = { chunkSize: 64, fileId: VECTOR_INPUT.fileId, keyCommit: file.subarray(40, 72) }

    function parseHeader(header: Uint8Array, size = header.length + 16, caps: SealedCaps = SMALL_CAPS): Parsed<SealedHeader> {
        const buffer = Buffer.from(header)
        return parseSealedHeader(buffer.subarray(0, 76), buffer.subarray(76), size, caps)
    }

    test('zero padding after the last slot is accepted', () => {
        const header = encodeHeaderFromRecords({ ...common, records: [record], padding: 40 })
        expect(refusal(parseHeader(header))).toBe('ok')
    })

    test('non-zero padding is damaged, in the first and the last padding byte', () => {
        for (const at of [168, 207]) {
            const header = encodeHeaderFromRecords({ ...common, records: [record], padding: 40 })
            header[at] = 1
            expect(refusal(parseHeader(header))).toBe('damaged H11')
        }
    })

    test('an unknown slot type before the password slot is skipped', () => {
        const unknown = encodeSlotRecord(7, new Uint8Array(13).fill(0xee))
        const header = encodeHeaderFromRecords({ ...common, records: [unknown, record] })
        const parsed = parseHeader(header)
        if (parsed.kind !== 'ok') {
            throw new Error(refusal(parsed))
        }
        expect(Buffer.from(parsed.value.slot.salt).equals(VECTOR_INPUT.salt)).toBe(true)
    })

    test('only unknown slot types is newer', () => {
        const header = encodeHeaderFromRecords({ ...common, records: [encodeSlotRecord(7, new Uint8Array(5)), encodeSlotRecord(8, new Uint8Array(0))] })
        expect(refusal(parseHeader(header))).toBe('newer H12')
    })

    test('with two password slots the first one is used', () => {
        const second = Buffer.from(record)
        second.fill(0x77, 16, 32)
        const parsed = parseHeader(encodeHeaderFromRecords({ ...common, records: [record, second] }))
        if (parsed.kind !== 'ok') {
            throw new Error(refusal(parsed))
        }
        expect(Buffer.from(parsed.value.slot.salt).equals(VECTOR_INPUT.salt)).toBe(true)
    })

    test('a second password slot with a bad body length is still damaged', () => {
        const bad = encodeSlotRecord(1, new Uint8Array(40))
        expect(refusal(parseHeader(encodeHeaderFromRecords({ ...common, records: [record, bad] })))).toBe('damaged H10')
    })

    test('header_len 65536 with zero padding parses; 65537 is newer', () => {
        const padded = encodeHeaderFromRecords({ ...common, records: [record], padding: 65_536 - 168 })
        expect(padded.length).toBe(65_536)
        expect(refusal(parseHeader(padded))).toBe('ok')
        const over = encodeHeaderFromRecords({ ...common, records: [record], padding: 65_537 - 168 })
        expect(refusal(parseHeader(over))).toBe('newer H7')
    })

    test('64 slots parse, 65 are newer', () => {
        const unknown = encodeSlotRecord(7, new Uint8Array(0))
        const records = [record, ...Array.from({ length: 63 }, () => unknown)]
        expect(refusal(parseHeader(encodeHeaderFromRecords({ ...common, records })))).toBe('ok')
        const header = encodeHeaderFromRecords({ ...common, records, slotCount: 65 })
        expect(refusal(parseHeader(header))).toBe('newer H9')
    })

    test('the default caps are used when none are passed', () => {
        const patched = baseFile()
        patched.writeUInt32LE(M_CEIL_KIB, AT.m)
        patched.writeUInt32LE(4, AT.t)
        const result = parseSealedHeader(patched.subarray(0, 76), patched.subarray(76), patched.length)
        expect(refusal(result)).toBe('ok')
        patched.writeUInt32LE(M_CEIL_KIB + 1, AT.m)
        expect(refusal(parseSealedHeader(patched.subarray(0, 76), patched.subarray(76), patched.length))).toBe('newer H18')
    })
})

describe('size arithmetic (H20)', () => {
    const header = { headerLen: 168, chunkSize: 64 }
    const at = (body: number) => layoutOf(header, 168 + body)

    test.each([
        [0, 'damaged'],
        [15, 'damaged'],
        [16, { n: 1, lastLen: 0 }],
        [17, { n: 1, lastLen: 1 }],
        [79, { n: 1, lastLen: 63 }],
        [80, { n: 1, lastLen: 64 }],
        [81, 'damaged'],
        [95, 'damaged'],
        [96, 'damaged'],
        [97, { n: 2, lastLen: 1 }],
        [160, { n: 2, lastLen: 64 }],
        [161, 'damaged'],
    ] as Array<[number, 'damaged' | { n: number, lastLen: number }]>)('%i bytes after the header', (body, expected) => {
        const result = at(body)
        if (expected === 'damaged') {
            expect(result).toMatchObject({ kind: 'damaged', row: 'H20' })
        } else {
            expect(result).toEqual({ kind: 'ok', value: expected })
        }
    })

    test('a header larger than the file is not a layout', () => {
        expect(layoutOf(header, 100)).toMatchObject({ kind: 'damaged', row: 'H20' })
    })

    test('the writer arithmetic matches the reader arithmetic for every length around the boundaries', () => {
        for (const chunkSize of [64, 100]) {
            for (let length = 0; length <= 4 * chunkSize + 3; length++) {
                const size = sealedFileSize(168, length, chunkSize)
                const layout = layoutOf({ headerLen: 168, chunkSize }, size)
                if (layout.kind !== 'ok') {
                    throw new Error(`length ${length} chunk ${chunkSize}: ${layout.reason}`)
                }
                expect(layout.value.n).toBe(chunkCount(length, chunkSize))
                expect((layout.value.n - 1) * chunkSize + layout.value.lastLen).toBe(length)
            }
        }
    })

    test('an empty plaintext is one chunk; an exact multiple has no empty trailing chunk', () => {
        expect(chunkCount(0, 64)).toBe(1)
        expect(sealedFileSize(168, 0, 64)).toBe(168 + 16)
        expect(chunkCount(128, 64)).toBe(2)
        expect(chunkCount(129, 64)).toBe(3)
        expect(sealedFileSize(168, 1, 64)).toBe(168 + 1 + 16)
    })
})

describe('policy', () => {
    test('the named values are the ones the format records', () => {
        expect(DEFAULT_M_KIB).toBe(131_072)
        expect(DEFAULT_T).toBe(3)
        expect(M_CEIL_KIB).toBe(1_048_576)
        expect(WORK_CAP).toBe(4_194_304)
        expect(DEFAULT_CHUNK).toBe(1_048_576)
        expect(DEFAULT_CAPS).toEqual({ mCeilKib: M_CEIL_KIB, workCap: WORK_CAP })
        expect(DEFAULT_SEAL_PARAMS).toEqual({ m: DEFAULT_M_KIB, t: DEFAULT_T, chunkSize: DEFAULT_CHUNK })
    })

    test('the constraints between them hold', () => {
        expect(DEFAULT_M_KIB).toBeLessThanOrEqual(M_CEIL_KIB)
        expect(4 * DEFAULT_M_KIB * DEFAULT_T).toBeLessThanOrEqual(WORK_CAP)
        expect(M_CEIL_KIB).toBeLessThanOrEqual(WORK_CAP)
        expect(DEFAULT_CHUNK).toBeGreaterThanOrEqual(64)
        expect(DEFAULT_CHUNK).toBeLessThanOrEqual(16_777_216)
    })
})
