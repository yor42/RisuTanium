/**
 * Framing of one block of a RisuSave file (header version 1, every block
 * checksummed), as the encoder in `risuSave.ts` writes it:
 *
 *   type(1) compression(1) nameLength(1) name length(4, LE) headerCrc(4, LE)
 *   payload dataCrc(4, LE)
 *
 * The framing and checksum the `.bin` path uses are guarded by
 * `drive/tests/binDatabaseStream.test.ts` (fixtures from the real encoder) and
 * `drive/tests/rtb/crc32Running.test.ts` (`crc32` against the `crc` package).
 * This module deliberately does not import the encoder: the encoder pulls the application's whole dependency
 * graph.
 */

export const BLOCK_TYPE_ROOT = 1
export const BLOCK_TYPE_CHARACTER_WITH_CHAT = 2

/** The bytes a block-format file starts with: `RISUSAVE` and the format version 1. */
export const FILE_HEADER_V1: Uint8Array = new TextEncoder().encode('RISUSAVE\x01')

export const crc32Table = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
        }
        table[n] = c
    }
    return table
})()

/** Standard CRC-32 (IEEE 802.3), the checksum the block format stores. */
export function crc32(data: Uint8Array): number {
    let crc = 0xFFFFFFFF
    for (let i = 0; i < data.length; i++) {
        crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

export function readU32le(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
}

function u32le(value: number): Uint8Array {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value, true)
    return out
}

type FrameFailure =
    /** The header is cut off, its checksum is wrong, or the block runs past the buffer: no later block can be located. */
    | 'framing'
    /** The framing is intact and the payload's checksum is wrong. */
    | 'crc'
    /** The block is compressed; this module reads only plain payloads. */
    | 'compressed'
    /** The payload is not the JSON object the caller expected. */
    | 'payload'

export class BlockFrameError extends Error {
    constructor(public readonly failure: FrameFailure, message: string) {
        super(message)
        this.name = 'BlockFrameError'
    }
}

interface FramedHeader {
    type: number
    compression: boolean
    name: string
    headerChecksum: number
    dataStart: number
    dataEnd: number
    storedDataChecksum: number
    end: number
}

/**
 * Reads and verifies only the header of the block at `offset` and checks that
 * the block fits the buffer; the payload is not read.
 */
export function parseFramedHeader(data: Uint8Array, offset = 0): FramedHeader {
    if (offset + 3 > data.length) {
        throw new BlockFrameError('framing', 'The block header is cut off.')
    }
    const type = data[offset]
    const compression = data[offset + 1] === 1
    const nameLength = data[offset + 2]
    const nameStart = offset + 3
    const lengthAt = nameStart + nameLength
    const headerEnd = lengthAt + 4
    if (headerEnd + 4 > data.length) {
        throw new BlockFrameError('framing', 'The block header is cut off.')
    }
    if (crc32(data.subarray(offset, headerEnd)) !== readU32le(data, headerEnd)) {
        throw new BlockFrameError('framing', 'The block header checksum does not match.')
    }
    const name = new TextDecoder().decode(data.subarray(nameStart, lengthAt))
    const length = readU32le(data, lengthAt)
    const dataStart = headerEnd + 4
    const dataEnd = dataStart + length
    if (dataEnd + 4 > data.length) {
        throw new BlockFrameError('framing', 'The block claims more bytes than the buffer holds.')
    }
    return {
        type,
        compression,
        name,
        headerChecksum: readU32le(data, headerEnd),
        dataStart,
        dataEnd,
        storedDataChecksum: readU32le(data, dataEnd),
        end: dataEnd + 4,
    }
}

/** Frames `payload` as an uncompressed block. Same bytes as the encoder's `encodeRawBlock` for a block it does not compress. */
export function frameBlock(type: number, name: string, payload: Uint8Array): Uint8Array {
    const nameBytes = new TextEncoder().encode(name)
    if (nameBytes.length > 255) {
        throw new RangeError('A block name is at most 255 UTF-8 bytes.')
    }
    const header = new Uint8Array(2 + 1 + nameBytes.length + 4)
    header.set([type, 0, nameBytes.length], 0)
    header.set(nameBytes, 3)
    header.set(u32le(payload.length), 3 + nameBytes.length)
    const out = new Uint8Array(header.length + 4 + payload.length + 4)
    out.set(header, 0)
    out.set(u32le(crc32(header)), header.length)
    out.set(payload, header.length + 4)
    out.set(u32le(crc32(payload)), header.length + 4 + payload.length)
    return out
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }
