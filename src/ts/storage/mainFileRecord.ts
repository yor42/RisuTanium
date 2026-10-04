/**
 * What this tab last read from, or committed to, the main database file
 * (`database/database.bin`), kept as a fingerprint: the byte length plus
 * digests of the file's bytes. The bytes themselves are never retained, so a
 * multi-hundred-megabyte main file costs a few kilobytes here.
 *
 * Two rules keep this off the critical path of a save:
 * - `noteMainFileBytes` returns immediately; the digests are computed piece by
 *   piece in the background, yielding to the event loop between pieces, so no
 *   single task walks the whole file.
 * - Only the newest note is ever finished. A note superseded while its pieces
 *   are still being hashed stops at the next piece boundary and releases its
 *   bytes.
 *
 * With `crypto.subtle` the fingerprint covers the whole file: one SHA-256 per
 * 4 MiB slice. Without it (a non-secure context) hashing a large file in
 * JavaScript after every save costs too much, so the record samples the file:
 * its first and last megabyte and a fixed number of evenly spaced windows in
 * between (the whole file when it is small). A same-length change confined to
 * unsampled bytes is therefore not detected in that context. That context has
 * no Web Locks, so the clean-up already asks the user to confirm that no other
 * tab is open. The fingerprint detects a file that changed; it is not a
 * security boundary.
 *
 * The record is exact only with the native digest. `matchesMainFileRecord`, which
 * decides that a write can be skipped, and `getMainFileRecordDigest` and
 * `digestMainFileBytes`, which name bytes in the persisted backup fingerprint,
 * answer from the SHA-256 form alone and treat the sampled form as a
 * difference.
 */

import { noteMainFileRecorded } from './mainFileOutcome'

type DigestAlgorithm = 'sha256' | 'js'

/** Bytes per native digest call. */
const NATIVE_SLICE_BYTES = 4 * 1024 * 1024
/** Bytes the JavaScript hash covers at each end of a sampled file. */
const JS_END_BYTES = 1024 * 1024
/** Evenly spaced windows the JavaScript hash covers between the two ends, and their size. */
const JS_WINDOW_COUNT = 256
const JS_WINDOW_BYTES = 4 * 1024
/** Largest piece the JavaScript path hashes in one go; it yields to the event loop after hashing this much. */
const JS_CHUNK_BYTES = 256 * 1024

interface Fingerprint {
    algorithm: DigestAlgorithm
    length: number
    pieces: string[]
}

interface Note {
    /** Resolves to null when the note was superseded before it finished or hashing failed. */
    fingerprint: Promise<Fingerprint | null>
}

let latest: Note | null = null

/** Result of comparing bytes read from storage with this tab's record. */
export type MainFileComparison = 'same' | 'different' | 'no-record'

function hex(bytes: Uint8Array): string {
    let out = ''
    for (let i = 0; i < bytes.length; i++) {
        out += bytes[i].toString(16).padStart(2, '0')
    }
    return out
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/**
 * Hashes 32-bit little-endian words, then the tail bytes. The same bytes give
 * the same hash whatever the view's alignment: an aligned view on a
 * little-endian platform reads whole words directly, every other view builds
 * the same words byte by byte.
 */
function jsSliceHash(slice: Uint8Array): string {
    let h1 = 0x811c9dc5
    let h2 = 0x9747b28c
    const wordCount = slice.length >>> 2
    const aligned = LITTLE_ENDIAN && slice.byteOffset % 4 === 0 ? new Uint32Array(slice.buffer, slice.byteOffset, wordCount) : null
    for (let k = 0; k < wordCount; k++) {
        const j = k << 2
        const w = aligned ? aligned[k] : (slice[j] | (slice[j + 1] << 8) | (slice[j + 2] << 16) | (slice[j + 3] << 24)) >>> 0
        h1 = Math.imul(h1 ^ w, 0x01000193)
        h2 = Math.imul(h2 + w + 1, 0x85ebca6b) ^ (h2 >>> 15)
    }
    for (let i = wordCount << 2; i < slice.length; i++) {
        const b = slice[i]
        h1 = Math.imul(h1 ^ b, 0x01000193)
        h2 = Math.imul(h2 + b + 1, 0x85ebca6b) ^ (h2 >>> 15)
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

/**
 * The byte ranges the JavaScript hash covers, a function of the length alone
 * so that a record and a later comparison always cover the same ranges: the
 * whole file when it is small, otherwise both ends and evenly spaced windows.
 */
function jsRanges(length: number): Array<[number, number]> {
    const ranges: Array<[number, number]> = []
    const addChunked = (from: number, to: number) => {
        for (let start = from; start < to; start += JS_CHUNK_BYTES) {
            ranges.push([start, Math.min(start + JS_CHUNK_BYTES, to)])
        }
    }
    if (length <= 2 * JS_END_BYTES + JS_WINDOW_COUNT * JS_WINDOW_BYTES) {
        addChunked(0, length)
        return ranges
    }
    addChunked(0, JS_END_BYTES)
    const middleStart = JS_END_BYTES
    const middleSpan = length - 2 * JS_END_BYTES
    for (let w = 0; w < JS_WINDOW_COUNT; w++) {
        const start = middleStart + Math.floor((w * (middleSpan - JS_WINDOW_BYTES)) / (JS_WINDOW_COUNT - 1))
        ranges.push([start, start + JS_WINDOW_BYTES])
    }
    addChunked(length - JS_END_BYTES, length)
    return ranges
}

async function nativeSliceDigest(slice: Uint8Array): Promise<string> {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof crypto.subtle.digest !== 'function') {
        throw new Error('crypto.subtle is unavailable')
    }
    return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', slice as BufferSource)))
}

/**
 * Fingerprints `bytes`. Resolves to null when `isStale` turns true between
 * pieces. Rejects when a native digest is required but unavailable.
 */
async function fingerprintBytes(bytes: Uint8Array, algorithm: DigestAlgorithm, isStale: () => boolean): Promise<Fingerprint | null> {
    const pieces: string[] = []
    if (algorithm === 'sha256') {
        for (let start = 0; start < bytes.length; start += NATIVE_SLICE_BYTES) {
            if (isStale()) {
                return null
            }
            pieces.push(await nativeSliceDigest(bytes.subarray(start, Math.min(start + NATIVE_SLICE_BYTES, bytes.length))))
        }
    } else {
        let hashedSinceYield = 0
        for (const [start, end] of jsRanges(bytes.length)) {
            if (isStale()) {
                return null
            }
            if (hashedSinceYield >= JS_CHUNK_BYTES) {
                // No native digest to hand the work to: keeps the event loop turning.
                await new Promise<void>((resolve) => setTimeout(resolve, 0))
                hashedSinceYield = 0
            }
            pieces.push(jsSliceHash(bytes.subarray(start, end)))
            hashedSinceYield += end - start
        }
    }
    if (isStale()) {
        return null
    }
    return { algorithm, length: bytes.length, pieces }
}

function nativeDigestAvailable(): boolean {
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.digest === 'function'
}

/**
 * Records the main file bytes this tab has just read from storage or has
 * just written to it. Call it only after a read succeeded or a write
 * completed: a failed write leaves the earlier record standing. Also tells
 * `mainFileOutcome.ts` that bytes were recorded, which is what makes the outcome
 * of an unconfirmed write known again after a read of the file. Never
 * throws, and does not wait for the digest.
 */
export function noteMainFileBytes(bytes: Uint8Array): void {
    noteMainFileRecorded()
    const note: Note = { fingerprint: Promise.resolve(null) }
    // The note must be the latest before hashing starts: the staleness check
    // runs synchronously on the first piece.
    latest = note
    const isStale = () => latest !== note
    const compute = async (): Promise<Fingerprint | null> => {
        if (nativeDigestAvailable()) {
            try {
                return await fingerprintBytes(bytes, 'sha256', isStale)
            } catch (error) {
                // Fall through to the JavaScript hash below.
            }
        }
        return await fingerprintBytes(bytes, 'js', isStale)
    }
    note.fingerprint = compute().catch(() => null)
}

/**
 * Compares bytes freshly read from storage with the record of what this tab
 * last read or committed. `'no-record'` covers a tab that never noted the
 * file and a record whose digest could not be computed.
 */
export async function compareWithMainFileRecord(bytes: Uint8Array): Promise<MainFileComparison> {
    const recorded = latest
    if (!recorded) {
        return 'no-record'
    }
    const expected = await recorded.fingerprint
    if (!expected) {
        return 'no-record'
    }
    if (expected.length !== bytes.length) {
        return 'different'
    }
    let actual: Fingerprint | null
    try {
        actual = await fingerprintBytes(bytes, expected.algorithm, () => false)
    } catch (error) {
        return 'no-record'
    }
    if (!actual || actual.pieces.length !== expected.pieces.length) {
        return 'different'
    }
    return actual.pieces.every((digest, i) => digest === expected.pieces[i]) ? 'same' : 'different'
}

/**
 * Whether `bytes` are exactly the bytes this tab last read or committed, for a
 * caller that skips a write on a yes. Yes only when the record is the SHA-256
 * form, has finished, was not replaced while the comparison ran, and every
 * slice digest matches. The sampled form, a missing record and any failure
 * answer no.
 */
export async function matchesMainFileRecord(bytes: Uint8Array): Promise<boolean> {
    try {
        const recorded = latest
        if (!recorded) {
            return false
        }
        const expected = await recorded.fingerprint
        if (!expected || expected.algorithm !== 'sha256' || latest !== recorded || expected.length !== bytes.length) {
            return false
        }
        const actual = await fingerprintBytes(bytes, 'sha256', () => false)
        if (!actual || latest !== recorded || actual.pieces.length !== expected.pieces.length) {
            return false
        }
        return actual.pieces.every((digest, i) => digest === expected.pieces[i])
    } catch (error) {
        return false
    }
}

/**
 * The persisted name of a SHA-256 fingerprint: its length and one digest of
 * its slice digests. Equal bytes always give the same name.
 */
async function nameOfFingerprint(fingerprint: Fingerprint): Promise<string> {
    const joined = `${fingerprint.length}:${fingerprint.pieces.join(',')}`
    const digest = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined) as BufferSource)))
    return `sha256:${fingerprint.length}:${digest}`
}

/**
 * The persisted name of the newest recorded bytes, or null when there is no
 * finished SHA-256 record, the record was replaced while this ran, or anything
 * failed.
 */
export async function getMainFileRecordDigest(): Promise<string | null> {
    try {
        const recorded = latest
        if (!recorded) {
            return null
        }
        const fingerprint = await recorded.fingerprint
        if (!fingerprint || fingerprint.algorithm !== 'sha256') {
            return null
        }
        const name = await nameOfFingerprint(fingerprint)
        return latest === recorded ? name : null
    } catch (error) {
        return null
    }
}

/**
 * The persisted name of `bytes`, computed the way `getMainFileRecordDigest`
 * names the record, so the two are equal exactly when the bytes are. Null when
 * the native digest is unavailable or fails: the sampled form is never named.
 */
export async function digestMainFileBytes(bytes: Uint8Array): Promise<string | null> {
    try {
        if (!nativeDigestAvailable()) {
            return null
        }
        const fingerprint = await fingerprintBytes(bytes, 'sha256', () => false)
        return fingerprint ? await nameOfFingerprint(fingerprint) : null
    } catch (error) {
        return null
    }
}

/** Clears the recorded main file fingerprint between tests. */
export function resetMainFileRecordForTests(): void {
    latest = null
}
