import { BlockFrameError, bytesEqual, crc32, FILE_HEADER_V1, parseFramedHeader } from './blockFrame'
import { PRE_BLOCKS_PREFIX } from './blockKeys'

/**
 * The identity of the main-file bytes a conversion read, and the rule that
 * decides when that file may be renamed aside. Both are pure.
 *
 * The fingerprint is a function of the bytes alone, with no `crypto.subtle` and
 * no state. It is not a security boundary: it tells "the bytes this conversion
 * read" from "bytes something else wrote there later".
 *
 * - A block-format file (`RISUSAVE`, version 1): the length plus the stored
 *   header and payload checksums of every block, from a walk that reads no
 *   payload.
 * - Any other format, or a block file whose walk fails: the length plus one
 *   CRC-32 over the file.
 */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

function fnv1a(data: Uint8Array): number {
    let hash = FNV_OFFSET
    for (let i = 0; i < data.length; i++) {
        hash ^= data[i]
        hash = Math.imul(hash, FNV_PRIME) >>> 0
    }
    return hash >>> 0
}

function hex32(value: number): string {
    return value.toString(16).padStart(8, '0')
}

function isBlockFormatV1(data: Uint8Array): boolean {
    if (data.length < FILE_HEADER_V1.length) {
        return false
    }
    for (let i = 0; i < FILE_HEADER_V1.length; i++) {
        if (data[i] !== FILE_HEADER_V1[i]) {
            return false
        }
    }
    return true
}

/** The stored checksum pairs of a version-1 block file, or `null` when the walk cannot complete. Reads headers only. */
function storedChecksums(data: Uint8Array): Uint8Array | null {
    const pairs: number[] = []
    let offset = FILE_HEADER_V1.length
    while (offset < data.length) {
        try {
            const header = parseFramedHeader(data, offset)
            pairs.push(header.headerChecksum, header.storedDataChecksum)
            offset = header.end
        } catch (error) {
            if (error instanceof BlockFrameError) {
                return null
            }
            throw error
        }
    }
    const out = new Uint8Array(pairs.length * 4)
    const view = new DataView(out.buffer)
    pairs.forEach((value, index) => view.setUint32(index * 4, value, true))
    return out
}
/** The `convertedFrom` value of the main-file bytes `data`. */
export function fingerprintMainFile(data: Uint8Array): string {
    if (isBlockFormatV1(data)) {
        const checksums = storedChecksums(data)
        if (checksums !== null) {
            return `b1:${data.length}:${checksums.length / 8}:${hex32(crc32(checksums))}:${hex32(fnv1a(checksums))}`
        }
    }
    return `c1:${data.length}:${hex32(crc32(data))}`
}

export function matchesConvertedFrom(data: Uint8Array, convertedFrom: string): boolean {
    return fingerprintMainFile(data) === convertedFrom
}

export interface PreBlocksFile {
    key: string
    bytes: Uint8Array
}

export type RenameDecision =
    /** There is no main file, or it is not ours to touch. */
    | { action: 'leave' }
    /** A byte-identical copy already sits under a pre-blocks name: delete the main file. */
    | { action: 'delete-main' }
    /** Copy the main file to `target`, then delete it. */
    | { action: 'copy-then-delete', target: string }

/** The name the first pre-blocks copy takes, and the numbered variants after it. */
export function preBlocksKey(index: number): string {
    return index === 0 ? `${PRE_BLOCKS_PREFIX}.bin` : `${PRE_BLOCKS_PREFIX}-${index}.bin`
}

/** Whether `key` names a pre-blocks copy (the plain name or a numbered variant). */
export function isPreBlocksKey(key: string): boolean {
    return key === `${PRE_BLOCKS_PREFIX}.bin` || new RegExp(`^${PRE_BLOCKS_PREFIX.replace(/[.]/g, '\\.')}-[0-9]+\\.bin$`).test(key)
}

/**
 * Decides what the finish of a conversion's rename does at a boot.
 *
 * - No main file: nothing.
 * - A pre-blocks copy equals the main file: delete the main file (a crash
 *   between the copy and the delete).
 * - The main file matches `convertedFrom` (the head's record, `null` when the
 *   head has none): copy it to the first pre-blocks name that is free. An
 *   existing pre-blocks file with different bytes is never overwritten.
 * - Anything else, for example a file written after the conversion: leave it.
 */
export function decideMainFileRename(
    main: Uint8Array | null,
    preBlocks: readonly PreBlocksFile[],
    convertedFrom: string | null,
): RenameDecision {
    if (main === null) {
        return { action: 'leave' }
    }
    if (preBlocks.some((file) => bytesEqual(file.bytes, main))) {
        return { action: 'delete-main' }
    }
    if (convertedFrom === null || !matchesConvertedFrom(main, convertedFrom)) {
        return { action: 'leave' }
    }
    const taken = new Set(preBlocks.map((file) => file.key))
    let index = 0
    while (taken.has(preBlocksKey(index))) {
        index++
    }
    return { action: 'copy-then-delete', target: preBlocksKey(index) }
}
