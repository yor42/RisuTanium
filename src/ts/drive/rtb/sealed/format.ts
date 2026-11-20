/**
 * Byte format of the sealed `.rtb` envelope, version 1: a 76-byte fixed header, typed
 * length-prefixed slots, then AES-256-GCM chunks of the plaintext `.rtb`.
 *
 * Every refusal is classified before any prompt or key derivation: "newer" for a value a later
 * version could legitimately write (reserved fields, unknown identifiers, values above a cap),
 * "damaged" for a value no version will write (zero identifiers, values below a floor, broken
 * structure, impossible sizes, non-zero padding). Rows are checked in table order (H1 to H20) and
 * the first failing row decides; the row name travels with the refusal for tests and diagnostics.
 *
 * Integers are unsigned little-endian except the chunk index inside the chunk nonce, which is
 * big-endian.
 */
import { DEFAULT_CAPS, MAX_CHUNK, MAX_HEADER_LEN, MAX_LANES, MAX_SLOTS, MIN_CHUNK, MIN_HEADER_LEN, type SealedCaps } from './policy'

export const MAGIC: Readonly<Uint8Array> = Uint8Array.of(0x52, 0x54, 0x42, 0x58, 0x0d, 0x0a, 0x1a, 0x0a)
export const ENVELOPE_VERSION = 1
export const AEAD_AES_256_GCM = 1
export const KDF_ARGON2ID = 1
export const SLOT_RESERVED = 0
export const SLOT_PASSWORD = 1

/** Bytes of the fixed header, and of the part F that the key schedule binds. */
export const FIXED_LEN = 76
export const FIXED_PART_LEN = 36
export const SLOT_BODY_LEN = 88
export const SLOT_RECORD_LEN = 92
/** The slot's own first 44 bytes: type, body length and the body up to the wrap nonce. */
export const SLOT_AAD_LEN = 44
export const TAG_LEN = 16
export const MASTER_KEY_LEN = 32
export const WRAPPED_KEY_LEN = MASTER_KEY_LEN + TAG_LEN
/** Header length of a v1 writer's file: fixed header plus one password slot, no padding. */
export const V1_HEADER_LEN = FIXED_LEN + SLOT_RECORD_LEN

export interface Refusal {
    readonly kind: 'damaged' | 'newer'
    /** The S0 row that decided, for example `H7`. */
    readonly row: string
    readonly reason: string
}

export type Parsed<T> = { readonly kind: 'ok', readonly value: T } | Refusal

export interface FixedHeader {
    readonly version: number
    readonly flags: number
    readonly aeadId: number
    readonly chunkSize: number
    readonly fileId: Uint8Array
    readonly headerLen: number
    readonly keyCommit: Uint8Array
    readonly slotCount: number
    /** Header bytes 0..35, the part bound into the payload key and the key commitment. */
    readonly fixedPart: Uint8Array
}

export interface PasswordSlot {
    readonly kdfId: number
    readonly p: number
    readonly m: number
    readonly t: number
    readonly salt: Uint8Array
    readonly wrapNonce: Uint8Array
    readonly wrappedKey: Uint8Array
    /** The record's first 44 bytes, the AAD of the key wrap. */
    readonly aad: Uint8Array
}

export interface SealedHeader extends FixedHeader {
    readonly slot: PasswordSlot
}

export interface Layout {
    /** Number of chunks. */
    readonly n: number
    /** Plaintext bytes in the last chunk. */
    readonly lastLen: number
}

function damaged(row: string, reason: string): Refusal {
    return { kind: 'damaged', row, reason }
}

function newer(row: string, reason: string): Refusal {
    return { kind: 'newer', row, reason }
}

/** A plain-array copy: `Buffer.prototype.slice` would return a view of the caller's memory. */
function copyOf(bytes: Uint8Array, start: number, end: number): Uint8Array {
    return new Uint8Array(bytes.subarray(start, end))
}

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Rows H1 to H9 on the first `min(76, fileSize)` bytes. H1 needs only bytes 8 and 9, so a short
 * file of a later envelope version reads as newer, not damaged.
 */
export function parseFixedPart(prefix: Uint8Array, fileSize: number): Parsed<FixedHeader> {
    if (prefix.length < 10) {
        return damaged('H1', 'too short to hold an envelope version')
    }
    const view = viewOf(prefix)
    const version = view.getUint16(8, true)
    if (version === 0) {
        return damaged('H1', 'envelope version 0')
    }
    if (version >= 2) {
        return newer('H1', `envelope version ${version}`)
    }
    if (fileSize < FIXED_LEN || prefix.length < FIXED_LEN) {
        return damaged('H2', `${fileSize} bytes cannot hold the fixed header`)
    }
    const flags = view.getUint16(10, true)
    if (flags !== 0) {
        return newer('H3', 'flags are set')
    }
    const aeadId = prefix[12]
    if (aeadId === 0) {
        return damaged('H4', 'aead id 0')
    }
    if (aeadId >= 2) {
        return newer('H4', `aead id ${aeadId}`)
    }
    if (prefix[13] !== 0 || prefix[14] !== 0 || prefix[15] !== 0) {
        return newer('H5', 'reserved bytes are set')
    }
    const chunkSize = view.getUint32(16, true)
    if (chunkSize < MIN_CHUNK) {
        return damaged('H6', `chunk size ${chunkSize} is below the minimum`)
    }
    if (chunkSize > MAX_CHUNK) {
        return newer('H6', `chunk size ${chunkSize} is above the maximum`)
    }
    const headerLen = view.getUint32(36, true)
    if (headerLen < MIN_HEADER_LEN) {
        return damaged('H7', `header length ${headerLen} is below the minimum`)
    }
    if (headerLen > MAX_HEADER_LEN) {
        return newer('H7', `header length ${headerLen} is above the maximum`)
    }
    if (headerLen > fileSize) {
        return damaged('H7', `header length ${headerLen} is beyond the ${fileSize} byte file`)
    }
    if (prefix[74] !== 0 || prefix[75] !== 0) {
        return newer('H8', 'reserved bytes are set')
    }
    const slotCount = view.getUint16(72, true)
    if (slotCount === 0) {
        return damaged('H9', 'no slots')
    }
    if (slotCount > MAX_SLOTS) {
        return newer('H9', `${slotCount} slots`)
    }
    return {
        kind: 'ok',
        value: {
            version,
            flags,
            aeadId,
            chunkSize,
            fileId: copyOf(prefix, 20, 36),
            headerLen,
            keyCommit: copyOf(prefix, 40, 72),
            slotCount,
            fixedPart: copyOf(prefix, 0, FIXED_PART_LEN),
        },
    }
}

/**
 * Rows H10 to H19 on the bytes `[76, header_len)`: the slot walk, the zero padding, the first
 * password slot and its Argon2id parameters against the caps.
 */
export function parseSlotTable(fixed: FixedHeader, rest: Uint8Array, caps: SealedCaps = DEFAULT_CAPS): Parsed<PasswordSlot> {
    const end = fixed.headerLen - FIXED_LEN
    if (rest.length < end) {
        return damaged('H10', 'the slot area is shorter than the header length')
    }
    const table = rest.subarray(0, end)
    const view = viewOf(table)
    let pos = 0
    let first = -1
    for (let k = 0; k < fixed.slotCount; k++) {
        if (pos + 4 > end) {
            return damaged('H10', `slot ${k} has no room for its prefix`)
        }
        const type = view.getUint16(pos, true)
        if (type === SLOT_RESERVED) {
            return damaged('H10', `slot ${k} has the reserved type`)
        }
        const bodyLen = view.getUint16(pos + 2, true)
        if (pos + 4 + bodyLen > end) {
            return damaged('H10', `slot ${k} runs past the header`)
        }
        if (type === SLOT_PASSWORD) {
            if (bodyLen !== SLOT_BODY_LEN) {
                return damaged('H10', `password slot ${k} has body length ${bodyLen}`)
            }
            if (first < 0) {
                first = pos
            }
        }
        pos += 4 + bodyLen
    }
    for (let i = pos; i < end; i++) {
        if (table[i] !== 0) {
            return damaged('H11', 'padding after the last slot is not zero')
        }
    }
    if (first < 0) {
        return newer('H12', 'no password slot')
    }
    const kdfId = table[first + 4]
    if (kdfId === 0) {
        return damaged('H13', 'kdf id 0')
    }
    if (kdfId >= 2) {
        return newer('H13', `kdf id ${kdfId}`)
    }
    if (table[first + 5] !== 0) {
        return newer('H14', 'reserved byte is set')
    }
    const p = view.getUint16(first + 6, true)
    const m = view.getUint32(first + 8, true)
    const t = view.getUint32(first + 12, true)
    if (p === 0) {
        return damaged('H15', 'zero lanes')
    }
    if (p > MAX_LANES) {
        return newer('H15', `${p} lanes`)
    }
    if (t === 0) {
        return damaged('H16', 'zero passes')
    }
    if (m < 8 * p) {
        return damaged('H17', `memory ${m} KiB is below 8 per lane`)
    }
    if (m > caps.mCeilKib) {
        return newer('H18', `memory ${m} KiB is above the ceiling`)
    }
    if (m * t > caps.workCap) {
        return newer('H19', `memory ${m} KiB times ${t} passes is above the work cap`)
    }
    return {
        kind: 'ok',
        value: {
            kdfId,
            p,
            m,
            t,
            salt: copyOf(table, first + 16, first + 32),
            wrapNonce: copyOf(table, first + 32, first + 44),
            wrappedKey: copyOf(table, first + 44, first + 44 + WRAPPED_KEY_LEN),
            aad: copyOf(table, first, first + SLOT_AAD_LEN),
        },
    }
}

/**
 * Rows H1 to H19 in one call. `prefix` is the first `min(76, fileSize)` bytes; `rest` holds the
 * bytes from offset 76 on, of which only `[76, header_len)` is read.
 */
export function parseSealedHeader(prefix: Uint8Array, rest: Uint8Array, fileSize: number, caps: SealedCaps = DEFAULT_CAPS): Parsed<SealedHeader> {
    const fixed = parseFixedPart(prefix, fileSize)
    if (fixed.kind !== 'ok') {
        return fixed
    }
    const slot = parseSlotTable(fixed.value, rest, caps)
    if (slot.kind !== 'ok') {
        return slot
    }
    return { kind: 'ok', value: { ...fixed.value, slot: slot.value } }
}

/** Row H20: the chunk count and last chunk length implied by the file size. */
export function layoutOf(header: Pick<FixedHeader, 'headerLen' | 'chunkSize'>, fileSize: number): Parsed<Layout> {
    const body = fileSize - header.headerLen
    const sealedChunk = header.chunkSize + TAG_LEN
    if (body < TAG_LEN) {
        return damaged('H20', 'no room for a chunk')
    }
    const q = Math.floor(body / sealedChunk)
    const r = body - q * sealedChunk
    if (r === 0) {
        return { kind: 'ok', value: { n: q, lastLen: header.chunkSize } }
    }
    if (r < TAG_LEN) {
        return damaged('H20', 'the last chunk is shorter than its tag')
    }
    if (r === TAG_LEN) {
        if (q === 0) {
            return { kind: 'ok', value: { n: 1, lastLen: 0 } }
        }
        return damaged('H20', 'an empty last chunk follows full chunks')
    }
    return { kind: 'ok', value: { n: q + 1, lastLen: r - TAG_LEN } }
}

/** Chunk count the writer produces for a plaintext length: one empty chunk for an empty plaintext, never an empty trailing chunk. */
export function chunkCount(plaintextLen: number, chunkSize: number): number {
    return plaintextLen === 0 ? 1 : Math.ceil(plaintextLen / chunkSize)
}

/** Size of the whole file for a plaintext length. */
export function sealedFileSize(headerLen: number, plaintextLen: number, chunkSize: number): number {
    return headerLen + plaintextLen + TAG_LEN * chunkCount(plaintextLen, chunkSize)
}

/** Chunk nonce: the index as an 11-byte big-endian integer, then 1 for the last chunk and 0 otherwise. */
export function chunkNonce(index: number, last: boolean): Uint8Array {
    const nonce = new Uint8Array(12)
    let rest = index
    for (let k = 10; k >= 0; k--) {
        nonce[k] = rest % 256
        rest = Math.floor(rest / 256)
    }
    nonce[11] = last ? 1 : 0
    return nonce
}

export function fixedPart(header: Pick<FixedHeader, 'fixedPart'>): Uint8Array {
    return header.fixedPart
}

/** Bytes 0..35 of a v1 file for a chunk size and file id. */
export function encodeFixedPart(chunkSize: number, fileId: Uint8Array): Uint8Array {
    const out = new Uint8Array(FIXED_PART_LEN)
    const view = viewOf(out)
    out.set(MAGIC, 0)
    view.setUint16(8, ENVELOPE_VERSION, true)
    out[12] = AEAD_AES_256_GCM
    view.setUint32(16, chunkSize, true)
    out.set(fileId, 20)
    return out
}

export interface PasswordSlotFields {
    readonly p: number
    readonly m: number
    readonly t: number
    readonly salt: Uint8Array
    readonly wrapNonce: Uint8Array
}

/** The first 44 bytes of a password slot record: the AAD of the key wrap. */
export function encodeSlotPrefix(fields: PasswordSlotFields): Uint8Array {
    const out = new Uint8Array(SLOT_AAD_LEN)
    const view = viewOf(out)
    view.setUint16(0, SLOT_PASSWORD, true)
    view.setUint16(2, SLOT_BODY_LEN, true)
    out[4] = KDF_ARGON2ID
    view.setUint16(6, fields.p, true)
    view.setUint32(8, fields.m, true)
    view.setUint32(12, fields.t, true)
    out.set(fields.salt, 16)
    out.set(fields.wrapNonce, 32)
    return out
}

export function encodePasswordSlot(fields: PasswordSlotFields, wrappedKey: Uint8Array): Uint8Array {
    const out = new Uint8Array(SLOT_RECORD_LEN)
    out.set(encodeSlotPrefix(fields), 0)
    out.set(wrappedKey, SLOT_AAD_LEN)
    return out
}

/** A slot record of any type, for headers that carry skippable or malformed slots. */
export function encodeSlotRecord(type: number, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + body.length)
    const view = viewOf(out)
    view.setUint16(0, type, true)
    view.setUint16(2, body.length, true)
    out.set(body, 4)
    return out
}

export interface HeaderSpec {
    readonly chunkSize: number
    readonly fileId: Uint8Array
    readonly keyCommit: Uint8Array
    readonly records: readonly Uint8Array[]
    /** Zero bytes after the last record. */
    readonly padding?: number
    /** Overrides the header length that would otherwise match the records and padding. */
    readonly headerLen?: number
    /** Overrides the slot count that would otherwise match the records. */
    readonly slotCount?: number
}

/** A header from raw slot records; the v1 writer uses one password record and no padding. */
export function encodeHeaderFromRecords(spec: HeaderSpec): Uint8Array {
    const recordsLen = spec.records.reduce((sum, record) => sum + record.length, 0)
    const padding = spec.padding ?? 0
    const out = new Uint8Array(FIXED_LEN + recordsLen + padding)
    const view = viewOf(out)
    out.set(encodeFixedPart(spec.chunkSize, spec.fileId), 0)
    view.setUint32(36, spec.headerLen ?? out.length, true)
    out.set(spec.keyCommit, 40)
    view.setUint16(72, spec.slotCount ?? spec.records.length, true)
    let at = FIXED_LEN
    for (const record of spec.records) {
        out.set(record, at)
        at += record.length
    }
    return out
}

export interface HeaderFields extends PasswordSlotFields {
    readonly chunkSize: number
    readonly fileId: Uint8Array
    readonly keyCommit: Uint8Array
    readonly wrappedKey: Uint8Array
}

/** The v1 writer's header: 168 bytes, one password slot. */
export function encodeHeader(fields: HeaderFields): Uint8Array {
    return encodeHeaderFromRecords({
        chunkSize: fields.chunkSize,
        fileId: fields.fileId,
        keyCommit: fields.keyCommit,
        records: [encodePasswordSlot(fields, fields.wrappedKey)],
    })
}
