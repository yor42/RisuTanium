import { sha256Hex } from '../assetHash'
import type { InlayRecord } from '../process/files/inlayStore'

/**
 * How an inlay is carried in a local backup: one entry per part, named
 * `risu-inlay-<sha256 of the id's UTF-16 code units, hex>-<part index>.part`.
 *
 * - Part 0 is `[u32 headerLength][header JSON][first slice of the body]`; every
 *   later part is a raw slice of the body. The header names the id, so an id
 *   never has to be spelled in a file name.
 * - No entry exceeds `PART_DATA_MAX`, so every entry fits upstream's Node
 *   request limit, and there is one entry per part with no separate index.
 * - The name has no path separator, uses only `a-z0-9-.`, never ends in a dot
 *   or space, and is neither a cold-storage unit name, a database or marker
 *   name, a dotfile, a temp-file name nor an asset name (`<sha256>.<ext>`), so
 *   a reader that does not know the format files it as an ordinary asset.
 * - The id is hashed over its UTF-16 code units, not its UTF-8 bytes, so two
 *   ids that differ only in lone surrogates never share a name.
 */

const MIB = 1024 * 1024

/** The most data bytes of one part entry, header included. */
export const PART_DATA_MAX = 64 * MIB

/** Room reserved in part 0 for the length field and the header. */
export const HEADER_ROOM = MIB

/** The most body bytes part 0 holds. */
export const FIRST_PART_BODY_MAX = PART_DATA_MAX - HEADER_ROOM

/** The most header JSON bytes part 0 can carry. */
export const MAX_HEADER_BYTES = HEADER_ROOM - 4

/** The most parts a header may claim; far above what the largest inlay needs. */
const MAX_PARTS = 4096

const NAME_PREFIX = 'risu-inlay-'
const NAME_SUFFIX = '.part'
const NAME_PATTERN = /^risu-inlay-([0-9a-f]{64})-(0|[1-9][0-9]{0,6})\.part$/

/** The shortest and the longest entry name this module writes or accepts. */
export const MIN_ENTRY_NAME_LENGTH = NAME_PREFIX.length + 64 + 1 + 1 + NAME_SUFFIX.length
export const MAX_ENTRY_NAME_LENGTH = NAME_PREFIX.length + 64 + 1 + 7 + NAME_SUFFIX.length

export function inlayEntryName(hash: string, index: number): string {
    return `${NAME_PREFIX}${hash}-${index}${NAME_SUFFIX}`
}

/** The hash and part index an entry name stands for, or `null` when `name` is not an inlay entry name. */
export function parseInlayEntryName(name: string): { hash: string, index: number } | null {
    if (name.length < MIN_ENTRY_NAME_LENGTH || name.length > MAX_ENTRY_NAME_LENGTH) {
        return null
    }
    const match = NAME_PATTERN.exec(name)
    return match === null ? null : { hash: match[1], index: Number(match[2]) }
}

/** The name-hash of an inlay id: SHA-256 over the id's UTF-16 code units, little endian. */
export async function inlayIdHash(id: string): Promise<string> {
    const bytes = new Uint8Array(id.length * 2)
    const view = new DataView(bytes.buffer)
    for (let i = 0; i < id.length; i++) {
        view.setUint16(i * 2, id.charCodeAt(i), true)
    }
    return await sha256Hex(bytes)
}

/** How many part entries a body of `len` bytes takes. */
export function partsFor(len: number): number {
    return len <= FIRST_PART_BODY_MAX ? 1 : 1 + Math.ceil((len - FIRST_PART_BODY_MAX) / PART_DATA_MAX)
}

export interface InlayEntryHeader {
    v: 1
    id: string
    repr: InlayRecord['repr']
    mime: string
    fields: Record<string, unknown>
    /** Byte length of the whole body. */
    len: number
    /** Number of part entries. */
    parts: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

/** The header JSON bytes, or `null` when the header would not fit part 0 or cannot be written as JSON. */
export function encodeInlayHeader(header: InlayEntryHeader): Uint8Array | null {
    let bytes: Uint8Array
    try {
        bytes = encoder.encode(JSON.stringify(header))
    } catch {
        return null
    }
    return bytes.length <= MAX_HEADER_BYTES ? bytes : null
}

/** The header of part 0's data, or `null` when it is not a well-formed header of this format. */
export function parseInlayHeader(headerBytes: Uint8Array): InlayEntryHeader | null {
    let value: Partial<InlayEntryHeader> | null
    try {
        value = JSON.parse(decoder.decode(headerBytes)) as Partial<InlayEntryHeader> | null
    } catch {
        return null
    }
    if (value === null || typeof value !== 'object' || value.v !== 1 || typeof value.id !== 'string') {
        return null
    }
    if (value.repr !== 'blob' && value.repr !== 'string' && value.repr !== 'string16') {
        return null
    }
    if (typeof value.mime !== 'string' || value.fields === null || typeof value.fields !== 'object' || Array.isArray(value.fields)) {
        return null
    }
    if (typeof value.len !== 'number' || !Number.isInteger(value.len) || value.len < 0) {
        return null
    }
    if (typeof value.parts !== 'number' || !Number.isInteger(value.parts) || value.parts < partsFor(value.len) || value.parts > MAX_PARTS) {
        return null
    }
    return value as InlayEntryHeader
}

/** The length of the header that opens part 0's data, read from its first four bytes; `null` when it cannot fit part 0. */
export function headerLengthOf(firstFour: Uint8Array): number | null {
    if (firstFour.length < 4) {
        return null
    }
    const length = new DataView(firstFour.buffer, firstFour.byteOffset, 4).getUint32(0, true)
    return length <= MAX_HEADER_BYTES ? length : null
}
