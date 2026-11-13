// The first look at a theme-pack archive: the file size and the end record, read before any directory is walked.
// The end-record search mirrors the `.rtb` reader's own (src/ts/drive/rtb/zip64Reader.ts), so the count bounded here is
// the count the reader's walk builds records for.
import type { RangeSource } from '../drive/rtb/rangeSource'

export const PACK_MAX_ENTRIES = 512
export const PACK_MAX_UNPACKED_BYTES = 256 * 1024 * 1024
/** 256 MiB unpacked plus 1 MiB of headers: the largest file a v1 pack can be. Checked before any read. */
export const PACK_FILE_MAX_BYTES = 257 * 1024 * 1024
/** Equal to the reader's own tail window: one end record, the largest comment, one ZIP64 locator. */
export const ZIP_TAIL_BYTES = 22 + 0xFFFF + 20

export type ZipTailRefusal = 'packTooLarge' | 'notAPack' | 'zip64' | 'tooManyFiles'
export type ZipTailVerdict = { ok: true; entries: number } | { ok: false; code: ZipTailRefusal }

const END_RECORD_SIZE = 22
const LOCATOR_SIZE = 20
const CENTRAL_FIXED = 46
const SIG_END = 0x06054B50
const SIG_ZIP64_LOCATOR = 0x07064B50
const SIG_CENTRAL = 0x02014B50
const SENTINEL_32 = 0xFFFFFFFF
const SENTINEL_16 = 0xFFFF
const ZIP64_EXTRA_ID = 0x0001

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** Offset of the end record in `tail`, searched from the end exactly as the reader does; -1 when there is none. */
export function findEndRecord(tail: Uint8Array): number {
    const view = viewOf(tail)
    for (let p = tail.length - END_RECORD_SIZE; p >= 0; p--) {
        if (tail[p] === 0x50 && view.getUint32(p, true) === SIG_END && p + END_RECORD_SIZE + view.getUint16(p + 20, true) === tail.length) {
            return p
        }
    }
    return -1
}

/**
 * Judges the file size and the end record. No read happens above the size bound or below the end-record size; otherwise
 * exactly one read of the tail window. A ZIP64 locator, a ZIP64 sentinel in the end record or a count above the bound
 * is refused here, so the directory walk that follows is bounded by PACK_MAX_ENTRIES records.
 */
export async function peekZipTail(source: RangeSource): Promise<ZipTailVerdict> {
    if (source.size > PACK_FILE_MAX_BYTES) {
        return { ok: false, code: 'packTooLarge' }
    }
    if (source.size < END_RECORD_SIZE) {
        return { ok: false, code: 'notAPack' }
    }
    const length = Math.min(source.size, ZIP_TAIL_BYTES)
    const tail = await source.read(source.size - length, length)
    const p = findEndRecord(tail)
    if (p < 0) {
        return { ok: false, code: 'notAPack' }
    }
    const view = viewOf(tail)
    const entries = view.getUint16(p + 10, true)
    const hasLocator = p >= LOCATOR_SIZE && view.getUint32(p - LOCATOR_SIZE, true) === SIG_ZIP64_LOCATOR
    if (hasLocator || entries === SENTINEL_16 || view.getUint32(p + 12, true) === SENTINEL_32 || view.getUint32(p + 16, true) === SENTINEL_32) {
        return { ok: false, code: 'zip64' }
    }
    if (entries > PACK_MAX_ENTRIES) {
        return { ok: false, code: 'tooManyFiles' }
    }
    return { ok: true, entries }
}

/** The outcome of re-reading the walked central records for ZIP64 structure. */
export type CentralZip64Check = 'zip64' | 'damaged' | null

/**
 * Re-reads the fixed fields and the extra field of each of the `count` central records starting at `directoryOffset`,
 * reading only inside [directoryOffset, directoryOffset + directorySize). 'zip64' when a record holds a 0xFFFFFFFF
 * compressed size, uncompressed size or local offset, a 0xFFFF start disk, or an extra block with id 0x0001 (blocks
 * walked exactly as the reader walks them); 'damaged' when a record lacks the central signature or runs past the
 * directory, or when the records do not end exactly at the end of the directory (the reader exempts a remainder that
 * opens with the digital-signature header, so this check is the only one that refuses it); null otherwise.
 */
export async function checkCentralZip64(source: RangeSource, directoryOffset: number, directorySize: number, count: number): Promise<CentralZip64Check> {
    const directoryEnd = directoryOffset + directorySize
    let position = directoryOffset
    for (let record = 0; record < count; record++) {
        if (position + CENTRAL_FIXED > directoryEnd) {
            return 'damaged'
        }
        const fixed = await source.read(position, CENTRAL_FIXED)
        const view = viewOf(fixed)
        if (view.getUint32(0, true) !== SIG_CENTRAL) {
            return 'damaged'
        }
        const nameLength = view.getUint16(28, true)
        const extraLength = view.getUint16(30, true)
        const commentLength = view.getUint16(32, true)
        const next = position + CENTRAL_FIXED + nameLength + extraLength + commentLength
        if (next > directoryEnd) {
            return 'damaged'
        }
        if (view.getUint32(20, true) === SENTINEL_32 || view.getUint32(24, true) === SENTINEL_32 || view.getUint32(42, true) === SENTINEL_32 || view.getUint16(34, true) === SENTINEL_16) {
            return 'zip64'
        }
        if (extraLength > 0) {
            const extra = await source.read(position + CENTRAL_FIXED + nameLength, extraLength)
            if (hasZip64Block(extra)) {
                return 'zip64'
            }
        }
        position = next
    }
    return position === directoryEnd ? null : 'damaged'
}

/** Walks the extra blocks as the reader does: a block that runs past the field ends the search. */
function hasZip64Block(extra: Uint8Array): boolean {
    const view = viewOf(extra)
    let at = 0
    while (at + 4 <= extra.length) {
        const id = view.getUint16(at, true)
        const length = view.getUint16(at + 2, true)
        if (at + 4 + length > extra.length) {
            return false
        }
        if (id === ZIP64_EXTRA_ID) {
            return true
        }
        at += 4 + length
    }
    return false
}
