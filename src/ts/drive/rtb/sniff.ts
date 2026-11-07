/**
 * Prefix sniff for `.rtb` files (A4.1 and the A1.3 `mimetype` rule).
 *
 * The decision is made from the first bytes only, before any ZIP structure is read:
 * - `RTBX\r\n\x1a\n` and a u16 version: a sealed file, which a plain v1 reader
 *   refuses as made by a newer version;
 * - `RTBX` with a different rest of the magic: damaged;
 * - `PK\x03\x04`, a stored `mimetype` entry with no extra field and the format's
 *   content at offsets 30 and 38: a ZIP candidate;
 * - anything else, including a ZIP that does not start with that entry: not an `.rtb`.
 */
import type { RangeSource } from './rangeSource'

export const RTB_MIMETYPE = 'application/vnd.risutanium.rtb'

const MIMETYPE_NAME = 'mimetype'
const LOCAL_FIXED = 30
const CONTENT_END = LOCAL_FIXED + MIMETYPE_NAME.length + RTB_MIMETYPE.length
/** Bytes the sniff may read: the local header of `mimetype` and its content. */
export const SNIFF_BYTES = CONTENT_END

const SEALED_MAGIC = [0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A]
const SEALED_PREFIX = SEALED_MAGIC.slice(0, 4)

export type SniffResult =
    | { kind: 'zip' }
    | { kind: 'sealed', envelopeVersion: number }
    | { kind: 'sealed-damaged' }
    | { kind: 'not-an-rtb' }

function startsWith(bytes: Uint8Array, expected: ArrayLike<number>, at = 0): boolean {
    if (bytes.length < at + expected.length) {
        return false
    }
    for (let i = 0; i < expected.length; i++) {
        if (bytes[at + i] !== expected[i]) {
            return false
        }
    }
    return true
}

function asciiBytes(text: string): number[] {
    return Array.from(text, (char) => char.charCodeAt(0))
}

/** Classifies the first bytes of a file (at most `SNIFF_BYTES` are looked at). */
export function classifyPrefix(prefix: Uint8Array): SniffResult {
    if (startsWith(prefix, SEALED_PREFIX)) {
        if (!startsWith(prefix, SEALED_MAGIC) || prefix.length < SEALED_MAGIC.length + 2) {
            return { kind: 'sealed-damaged' }
        }
        const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
        return { kind: 'sealed', envelopeVersion: view.getUint16(SEALED_MAGIC.length, true) }
    }
    if (prefix.length < CONTENT_END || !startsWith(prefix, [0x50, 0x4B, 0x03, 0x04])) {
        return { kind: 'not-an-rtb' }
    }
    const view = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength)
    const nameLength = view.getUint16(26, true)
    const extraLength = view.getUint16(28, true)
    if (nameLength !== MIMETYPE_NAME.length || extraLength !== 0) {
        return { kind: 'not-an-rtb' }
    }
    if (!startsWith(prefix, asciiBytes(MIMETYPE_NAME), LOCAL_FIXED)) {
        return { kind: 'not-an-rtb' }
    }
    if (!startsWith(prefix, asciiBytes(RTB_MIMETYPE), LOCAL_FIXED + MIMETYPE_NAME.length)) {
        return { kind: 'not-an-rtb' }
    }
    return { kind: 'zip' }
}

/** Reads the prefix of `source` and classifies it. A short read rejects as could-not-read. */
export async function sniffRtb(source: RangeSource): Promise<SniffResult> {
    const prefix = await source.read(0, Math.min(source.size, SNIFF_BYTES))
    return classifyPrefix(prefix)
}
