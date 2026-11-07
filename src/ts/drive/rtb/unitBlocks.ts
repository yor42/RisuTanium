/**
 * `RTBK` blocks of the `store2` section (A3.1): the entry `u/<type>/<seq>.blk` holds
 * a header (`RTBK`, u8 1, three zero bytes, u32 LE count) and then, per unit, a u8
 * tail length, the ASCII tail and the store2 frame verbatim.
 *
 * Reading accepts tails of 1-255 bytes and takes the type of a unit from its frame,
 * never from the entry name. A repeated tail, a frame that overruns the block, a count
 * that disagrees with the units present and bytes after the last unit are damaged.
 * Frames are not decoded here: their magic, checksums and bodies are checked by the
 * caller with store2's own decoder.
 *
 * Writing keeps a block at or under 4 MiB, and a unit that does not fit alone gets a
 * block of its own. Tails are 1-48 ASCII bytes and unique across the file.
 */
import { FRAME_OVERHEAD } from '../../storage/store2/format/frame'
import { storeBlockName } from './entryNames'

export const BLOCK_HEADER_BYTES = 12
/** A writer block holds at most this many bytes, header included, unless one unit is larger. */
export const BLOCK_TARGET_BYTES = 4 * 1024 * 1024
/** Longest tail the writer emits; the reader accepts up to 255. */
export const MAX_WRITE_TAIL_BYTES = 48

const BLOCK_VERSION = 1
const MAGIC = [0x52, 0x54, 0x42, 0x4B]
/** The frame type byte and the u32 payload length sit at these offsets of a frame. */
const FRAME_TYPE_AT = 5
const FRAME_LENGTH_AT = 8
const FRAME_HEADER_BYTES = 16

export interface BlockUnit {
    /** The store2 key tail; 1-48 ASCII bytes. */
    tail: string
    /** The complete frame, as store2 holds it. */
    frame: Uint8Array
}

export interface DecodedUnit {
    tail: string
    /** The frame's own type byte. */
    type: number
    frame: Uint8Array
}

export type BlockResult =
    | { kind: 'ok', units: DecodedUnit[] }
    | { kind: 'damaged', reason: string }

export interface PlannedBlock {
    type: number
    seq: number
    /** `u/<type>/<seq>.blk` */
    name: string
    /** The uncompressed block bytes. */
    bytes: Uint8Array
    units: number
}

function damaged(reason: string): BlockResult {
    return { kind: 'damaged', reason }
}

function frameLength(frame: Uint8Array): number {
    return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(FRAME_LENGTH_AT, true) + FRAME_OVERHEAD
}

function checkWriteUnit(unit: BlockUnit): number {
    const { tail, frame } = unit
    if (tail.length < 1 || tail.length > MAX_WRITE_TAIL_BYTES || !/^[\x00-\x7F]+$/.test(tail)) {
        throw new RangeError(`a unit tail must be 1-${MAX_WRITE_TAIL_BYTES} ASCII bytes: ${JSON.stringify(tail.slice(0, 60))}`)
    }
    if (frame.length < FRAME_OVERHEAD || frameLength(frame) !== frame.length) {
        throw new RangeError(`the frame of unit ${tail} is not a complete frame`)
    }
    if (frame[FRAME_TYPE_AT] < 1) {
        throw new RangeError(`the frame of unit ${tail} has type 0`)
    }
    return 1 + tail.length + frame.length
}

/** One block holding `units` in order. */
export function encodeBlock(units: readonly BlockUnit[]): Uint8Array {
    let total = BLOCK_HEADER_BYTES
    for (const unit of units) {
        total += checkWriteUnit(unit)
    }
    const out = new Uint8Array(total)
    out.set(MAGIC, 0)
    out[4] = BLOCK_VERSION
    new DataView(out.buffer).setUint32(8, units.length, true)
    let at = BLOCK_HEADER_BYTES
    for (const unit of units) {
        out[at++] = unit.tail.length
        for (let i = 0; i < unit.tail.length; i++) {
            out[at++] = unit.tail.charCodeAt(i)
        }
        out.set(unit.frame, at)
        at += unit.frame.length
    }
    return out
}

/**
 * Reads one block. `seenTails` carries the tails of the blocks read before it, so a
 * tail repeated across blocks is damaged too; the tails of this block are added to it.
 */
export function decodeBlock(bytes: Uint8Array, seenTails: Set<string> = new Set<string>()): BlockResult {
    if (bytes.length < BLOCK_HEADER_BYTES) {
        return damaged('the block is shorter than its header')
    }
    for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[i] !== MAGIC[i]) {
            return damaged('the block does not start with RTBK')
        }
    }
    if (bytes[4] !== BLOCK_VERSION) {
        return damaged(`the block version is ${bytes[4]}, not ${BLOCK_VERSION}`)
    }
    if (bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) {
        return damaged('the reserved header bytes are not zero')
    }
    const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true)
    const units: DecodedUnit[] = []
    let at = BLOCK_HEADER_BYTES
    for (let n = 0; n < count; n++) {
        if (at >= bytes.length) {
            return damaged(`the block ends after ${n} of ${count} units`)
        }
        const tailLength = bytes[at++]
        if (tailLength === 0) {
            return damaged(`unit ${n} has an empty tail`)
        }
        if (at + tailLength + FRAME_HEADER_BYTES > bytes.length) {
            return damaged(`unit ${n} is cut off inside its tail or frame header`)
        }
        let tail = ''
        for (let i = 0; i < tailLength; i++) {
            const byte = bytes[at + i]
            if (byte > 0x7F) {
                return damaged(`unit ${n} has a tail byte outside ASCII`)
            }
            tail += String.fromCharCode(byte)
        }
        at += tailLength
        const frame = bytes.subarray(at, bytes.length)
        const length = frameLength(frame)
        if (at + length > bytes.length) {
            return damaged(`the frame of unit ${tail} runs past the end of the block`)
        }
        if (seenTails.has(tail)) {
            return damaged(`the tail ${tail} is repeated`)
        }
        seenTails.add(tail)
        units.push({ tail, type: bytes[at + FRAME_TYPE_AT], frame: bytes.subarray(at, at + length) })
        at += length
    }
    if (at !== bytes.length) {
        return damaged(`${bytes.length - at} bytes follow the last unit`)
    }
    return { kind: 'ok', units }
}

interface Accumulator {
    units: BlockUnit[]
    bytes: number
    nextSeq: number
}

function planned(type: number, accumulator: Accumulator): PlannedBlock {
    const block: PlannedBlock = {
        type,
        seq: accumulator.nextSeq,
        name: storeBlockName(type, accumulator.nextSeq),
        bytes: encodeBlock(accumulator.units),
        units: accumulator.units.length,
    }
    accumulator.nextSeq++
    accumulator.units = []
    accumulator.bytes = BLOCK_HEADER_BYTES
    return block
}

/**
 * Groups units into blocks by the frame's type byte. A block is emitted as soon as the
 * next unit of its type would not fit; what is left is emitted at the end, by ascending
 * type. A tail met twice fails the export.
 */
export async function* groupBlocks(units: AsyncIterable<BlockUnit>): AsyncGenerator<PlannedBlock> {
    const open = new Map<number, Accumulator>()
    const tails = new Set<string>()
    for await (const unit of units) {
        const size = checkWriteUnit(unit)
        if (tails.has(unit.tail)) {
            throw new RangeError(`the unit tail ${unit.tail} appears twice`)
        }
        tails.add(unit.tail)
        const type = unit.frame[FRAME_TYPE_AT]
        let accumulator = open.get(type)
        if (!accumulator) {
            accumulator = { units: [], bytes: BLOCK_HEADER_BYTES, nextSeq: 0 }
            open.set(type, accumulator)
        }
        if (accumulator.units.length > 0 && accumulator.bytes + size > BLOCK_TARGET_BYTES) {
            yield planned(type, accumulator)
        }
        if (accumulator.units.length === 0 && BLOCK_HEADER_BYTES + size > BLOCK_TARGET_BYTES) {
            accumulator.units.push(unit)
            yield planned(type, accumulator)
            continue
        }
        accumulator.units.push(unit)
        accumulator.bytes += size
    }
    for (const type of [...open.keys()].sort((a, b) => a - b)) {
        const accumulator = open.get(type) as Accumulator
        if (accumulator.units.length > 0) {
            yield planned(type, accumulator)
        }
    }
}
