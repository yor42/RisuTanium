import { crc32, readU32le } from '../../blockFrame'
import { keyOfTail, tailOfKey } from './keys'
import type { Ref } from './types'
import { FRAME_CODEC, FRAME_FMT, FRAME_RESERVED, isKnownUnitType, type UnitType } from './versions'

/**
 * Frame of one store2 unit:
 *
 *   0  magic "RSAL"   4 fmt   5 type   6 codec   7 reserved
 *   8  payload length u32 LE   12 CRC32 of bytes 0..11 u32 LE
 *   16 payload   16+n CRC32 of the payload u32 LE
 *
 * Classification: only a bad magic, `fmt` 0, a failed checksum or a cut-off or
 * over-long buffer is `damaged`. A frame whose header checksum holds but whose
 * `fmt`, `codec`, `reserved` or `type` this build does not know is `too-new`:
 * a newer writer made it, and it must never lead to recovery or deletion.
 */

export const FRAME_HEADER_BYTES = 16
/** Header plus the trailing payload checksum. */
export const FRAME_OVERHEAD = 20
const MAGIC = [0x52, 0x53, 0x41, 0x4c]

export type FrameResult =
    | { status: 'ok', type: UnitType, payload: Uint8Array, payloadCrc: number }
    | { status: 'damaged', reason: string }
    | { status: 'too-new', reason: string }

function writeU32le(target: Uint8Array, offset: number, value: number): void {
    new DataView(target.buffer, target.byteOffset + offset, 4).setUint32(0, value, true)
}

export function encodeFrame(type: UnitType, payload: Uint8Array): Uint8Array {
    if (!isKnownUnitType(type)) {
        throw new RangeError(`Unknown unit type ${type}.`)
    }
    if (payload.length > 0xFFFFFFFF) {
        throw new RangeError('The payload does not fit a u32 length.')
    }
    const out = new Uint8Array(FRAME_OVERHEAD + payload.length)
    out.set(MAGIC, 0)
    out[4] = FRAME_FMT
    out[5] = type
    out[6] = FRAME_CODEC
    out[7] = FRAME_RESERVED
    writeU32le(out, 8, payload.length)
    writeU32le(out, 12, crc32(out.subarray(0, 12)))
    out.set(payload, FRAME_HEADER_BYTES)
    writeU32le(out, FRAME_HEADER_BYTES + payload.length, crc32(payload))
    return out
}

export function decodeFrame(bytes: Uint8Array): FrameResult {
    if (bytes.length < FRAME_HEADER_BYTES) {
        return { status: 'damaged', reason: 'The frame is cut off inside its header.' }
    }
    for (let i = 0; i < MAGIC.length; i++) {
        if (bytes[i] !== MAGIC[i]) {
            return { status: 'damaged', reason: 'The frame does not start with RSAL.' }
        }
    }
    if (crc32(bytes.subarray(0, 12)) !== readU32le(bytes, 12)) {
        return { status: 'damaged', reason: 'The frame header checksum does not match.' }
    }
    const fmt = bytes[4]
    const type = bytes[5]
    const codec = bytes[6]
    const reserved = bytes[7]
    if (fmt === 0) {
        return { status: 'damaged', reason: 'Frame format 0 never existed.' }
    }
    if (fmt > FRAME_FMT) {
        return { status: 'too-new', reason: `Frame format ${fmt} is newer than this build.` }
    }
    if (codec !== FRAME_CODEC) {
        return { status: 'too-new', reason: `Codec ${codec} is unknown to this build.` }
    }
    if (reserved !== FRAME_RESERVED) {
        return { status: 'too-new', reason: `Reserved byte ${reserved} is unknown to this build.` }
    }
    if (!isKnownUnitType(type)) {
        return { status: 'too-new', reason: `Unit type ${type} is unknown to this build.` }
    }
    const length = readU32le(bytes, 8)
    if (bytes.length !== FRAME_OVERHEAD + length) {
        return { status: 'damaged', reason: 'The frame length does not match the buffer.' }
    }
    const payload = bytes.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length)
    const payloadCrc = readU32le(bytes, FRAME_HEADER_BYTES + length)
    if (crc32(payload) !== payloadCrc) {
        return { status: 'damaged', reason: 'The payload checksum does not match.' }
    }
    return { status: 'ok', type, payload, payloadCrc }
}

/** The Ref of a stored frame: its tail, its framed length and the payload CRC it stores. */
export function refOfFrame(key: string, frame: Uint8Array): Ref {
    if (frame.length < FRAME_OVERHEAD) {
        throw new RangeError('Not a frame.')
    }
    return [tailOfKey(key), frame.length, readU32le(frame, frame.length - 4)]
}

/** Reads the `[tail, bytes, crc]` prefix of any Ref-bearing tuple and ignores what follows. */
export function readRef(tuple: Ref): { tail: string, bytes: number, crc: number } {
    return { tail: tuple[0], bytes: tuple[1], crc: tuple[2] }
}

/** The full store key a Ref names. */
export function keyOfRef(ref: Ref): string {
    return keyOfTail(ref[0])
}
