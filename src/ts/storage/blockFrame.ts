/**
 * Framing of one block of a RisuSave file (header version 1, every block
 * checksummed), as the encoder in `risuSave.ts` writes it:
 *
 *   type(1) compression(1) nameLength(1) name length(4, LE) headerCrc(4, LE)
 *   payload dataCrc(4, LE)
 *
 * The block store keeps these bytes unchanged as the value of a key, so a
 * character, module or preset block is byte-identical to the one in a `.bin`.
 * Only the root is framed here, because its content gains the block store's
 * bookkeeping. The guard test `blockStore.compat.test.ts` compares this module
 * with the encoder, which this module deliberately does not import: the encoder
 * pulls the application's whole dependency graph.
 */

export const BLOCK_TYPE_ROOT = 1
export const BLOCK_TYPE_CHARACTER_WITH_CHAT = 2

/** The bytes a block-format file starts with: `RISUSAVE` and the format version 1. */
export const FILE_HEADER_V1: Uint8Array = new TextEncoder().encode('RISUSAVE\x01')

const crc32Table = (() => {
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

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a === b) {
        return true
    }
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

export type FrameFailure =
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

export interface FramedBlock {
    type: number
    compression: boolean
    name: string
    /** A view into the buffer that was parsed. */
    payload: Uint8Array
    /** The offset just after this block's trailing checksum. */
    end: number
}

/**
 * Parses and verifies the block that starts at `offset`. A failure of the
 * header (`framing`) is thrown before the payload is looked at; a payload
 * checksum mismatch (`crc`) is thrown with the boundaries still known, so a
 * caller walking a pack can see the failure carries its `end`.
 */
export function parseFramedBlock(data: Uint8Array, offset = 0): FramedBlock {
    const header = parseFramedHeader(data, offset)
    const payload = data.subarray(header.dataStart, header.dataEnd)
    if (crc32(payload) !== header.storedDataChecksum) {
        throw new FramedCrcError(header.name, header.end)
    }
    return { type: header.type, compression: header.compression, name: header.name, payload, end: header.end }
}

export interface FramedHeader {
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

/** A payload checksum mismatch, with where the next block would start. */
export class FramedCrcError extends BlockFrameError {
    constructor(public readonly name: string, public readonly end: number) {
        super('crc', `The payload checksum of block "${name}" does not match.`)
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

export type BlockCheck =
    | { status: 'ok', block: FramedBlock }
    | { status: 'damaged', kind: 'empty' | 'framing' | 'crc' | 'wrong-name' | 'trailing-bytes', detail: string }

/**
 * Checks that `bytes` is exactly one intact block named `expectedName`: not
 * empty, framing and both checksums valid, the header's name the expected one
 * and nothing after the block.
 */
export function checkSingleBlock(bytes: Uint8Array, expectedName: string): BlockCheck {
    if (bytes.length === 0) {
        return { status: 'damaged', kind: 'empty', detail: 'The value is empty.' }
    }
    let block: FramedBlock
    try {
        block = parseFramedBlock(bytes, 0)
    } catch (error) {
        if (error instanceof BlockFrameError) {
            return { status: 'damaged', kind: error.failure === 'crc' ? 'crc' : 'framing', detail: error.message }
        }
        throw error
    }
    if (block.end !== bytes.length) {
        return { status: 'damaged', kind: 'trailing-bytes', detail: 'Bytes follow the block.' }
    }
    if (block.name !== expectedName) {
        return { status: 'damaged', kind: 'wrong-name', detail: `The block is named "${block.name}".` }
    }
    return { status: 'ok', block }
}

export interface PackContents {
    /** The framed bytes of each block that parsed intact, by the name in its header (the first block of a name wins). */
    found: Map<string, Uint8Array>
    /** Names of blocks whose payload failed its checksum (the framing was intact). */
    corrupt: Set<string>
    /** Whether the walk stopped at a header it could not trust: blocks after that point are unreachable. */
    broken: boolean
}

/** Walks a stubs pack (blocks concatenated, no file header), block by block. */
export function readPack(bytes: Uint8Array): PackContents {
    const found = new Map<string, Uint8Array>()
    const corrupt = new Set<string>()
    let offset = 0
    while (offset < bytes.length) {
        try {
            const block = parseFramedBlock(bytes, offset)
            if (!found.has(block.name)) {
                found.set(block.name, bytes.slice(offset, block.end))
            }
            offset = block.end
        } catch (error) {
            if (error instanceof FramedCrcError) {
                corrupt.add(error.name)
                offset = error.end
                continue
            }
            if (error instanceof BlockFrameError) {
                return { found, corrupt, broken: true }
            }
            throw error
        }
    }
    return { found, corrupt, broken: false }
}

/** Concatenates framed blocks into a stubs pack. */
export function buildPack(blocks: Iterable<Uint8Array>): Uint8Array {
    const parts = Array.from(blocks)
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/** The JSON object in a plain (uncompressed) block's payload. */
export function parseJsonObjectBlock(framed: Uint8Array, expectedName: string): { type: number, fields: JsonObject } {
    const checked = checkSingleBlock(framed, expectedName)
    if (checked.status !== 'ok') {
        throw new BlockFrameError(checked.kind === 'crc' ? 'crc' : 'framing', checked.detail)
    }
    if (checked.block.compression) {
        throw new BlockFrameError('compressed', `The block "${expectedName}" is compressed.`)
    }
    let parsed: JsonValue
    try {
        parsed = JSON.parse(new TextDecoder().decode(checked.block.payload)) as JsonValue
    } catch {
        throw new BlockFrameError('payload', `The payload of block "${expectedName}" is not JSON.`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new BlockFrameError('payload', `The payload of block "${expectedName}" is not a JSON object.`)
    }
    return { type: checked.block.type, fields: parsed }
}

export function frameJsonBlock(type: number, name: string, fields: JsonObject): Uint8Array {
    return frameBlock(type, name, new TextEncoder().encode(JSON.stringify(fields)))
}
