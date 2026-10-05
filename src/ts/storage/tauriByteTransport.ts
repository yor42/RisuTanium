import { invoke } from '@tauri-apps/api/core'
import { type as osType } from '@tauri-apps/plugin-os'

/**
 * Byte transport between the page and the Rust side on Android.
 *
 * On Android the IPC bridge carries a `Uint8Array` argument as a JSON number
 * array (about 3.6 characters per byte), so one call per file cannot move a
 * large file. The transport sends a file as base64 chunks of `WRITE_CHUNK_BYTES`
 * and reads it in pieces of `READ_PIECE_BYTES`; no call carries more than one
 * piece. The Rust side is `src-tauri/src/chunked_io.rs`.
 *
 * Every other platform keeps its existing calls: `isAndroidTransport` is the
 * single switch, and it answers false wherever the operating-system plugin is
 * missing.
 */

export const WRITE_CHUNK_COMMAND = 'write_chunk'
export const ABORT_CHUNKED_COMMAND = 'abort_chunked'
export const READ_RANGE_COMMAND = 'read_range'

/** The bytes one write chunk carries before base64. Each chunk is encoded and decoded on its own. */
export const WRITE_CHUNK_BYTES = 1024 * 1024

/** The bytes one read piece asks for. A file this size or smaller costs one call. */
export const READ_PIECE_BYTES = 8 * 1024 * 1024

/** Bytes after a piece in a ranged-read response: seven little-endian u64 words, the file's size first, then its identity. */
export const RANGE_TRAILER_BYTES = 56

/** A read is retried from the start this many times when the file changes between pieces. */
const READ_RETRIES = 2

/**
 * A rejection that names a missing file: `(os error 2)`, or `(os error 3)` for
 * a directory that does not exist on Windows, at the very end of the message.
 * The text before the code is localized, so only the suffix is read.
 */
export const MISSING_FILE_ERROR = /\(os error (2|3)\)\s*$/

/**
 * Whether this page runs in the Android app. Evaluated on each call and never
 * at module load: the operating-system plugin reads an object the Tauri shell
 * injects, which the web build, the Node server page and the test runner lack.
 */
export function isAndroidTransport(): boolean {
    try {
        return osType() === 'android'
    } catch {
        return false
    }
}

function errorText(error: unknown): string {
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

/** Base64 of exactly `bytes`, with one `btoa` call: the binary string is built from small pieces and joined first, since a `btoa` of each piece would put padding mid-string. */
export function bytesToBase64(bytes: Uint8Array): string {
    const parts: string[] = []
    for (let start = 0; start < bytes.length; start += 0x2000) {
        parts.push(String.fromCharCode(...bytes.subarray(start, Math.min(start + 0x2000, bytes.length))))
    }
    return btoa(parts.join(''))
}

function randomWriteId(): string {
    const random = crypto.getRandomValues(new Uint8Array(8))
    let id = ''
    for (const byte of random) {
        id += byte.toString(16).padStart(2, '0')
    }
    return id
}

/**
 * Writes `bytes` to `key` (relative to AppData, without any `./` prefix) as
 * base64 chunks, and replaces the file when the last chunk lands. A rejection
 * means the key holds its previous content, or stays absent. `durable` asks
 * for the flushes of `writeFileDurable`.
 *
 * A failure of chunk 0 aborts nothing: the command removes a temp file it
 * created itself, and a temp file that already existed is not this write's.
 * A later failure asks the command to remove the temp file; that request's own
 * failure never replaces the original error.
 */
export async function writeChunked(
    key: string,
    bytes: Uint8Array,
    durable: boolean,
    chunkBytes: number = WRITE_CHUNK_BYTES,
): Promise<void> {
    const id = randomWriteId()
    let offset = 0
    let started = false
    try {
        do {
            const end = Math.min(offset + chunkBytes, bytes.length)
            const data = bytesToBase64(bytes.subarray(offset, end))
            await invoke<void>(WRITE_CHUNK_COMMAND, { key, id, offset, data, last: end === bytes.length, durable })
            started = true
            offset = end
        } while (offset < bytes.length)
    } catch (error) {
        if (started) {
            try {
                await invoke<void>(ABORT_CHUNKED_COMMAND, { key, id })
            } catch {
                // The leftover temp is removed by the boot sweep.
            }
        }
        throw error
    }
}

/** The file changed, vanished or answered short between two pieces of one read. */
export class RangeReadChangedError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'RangeReadChangedError'
    }
}

interface RangePiece {
    bytes: Uint8Array
    total: number
    identity: string
}

type RangeResponse = ArrayBuffer | ArrayBufferView | readonly number[]

function responseBytes(response: RangeResponse): Uint8Array {
    if (response instanceof ArrayBuffer) {
        return new Uint8Array(response)
    }
    if (ArrayBuffer.isView(response)) {
        return new Uint8Array(response.buffer, response.byteOffset, response.byteLength)
    }
    return Uint8Array.from(response)
}

async function requestPiece(key: string, offset: number, len: number): Promise<RangePiece> {
    const response = responseBytes(await invoke<RangeResponse>(READ_RANGE_COMMAND, { key, offset, len }))
    if (response.length < RANGE_TRAILER_BYTES) {
        throw new Error(`the range read of ${key} answered ${response.length} bytes, fewer than its trailer`)
    }
    const pieceLength = response.length - RANGE_TRAILER_BYTES
    const trailer = response.subarray(pieceLength)
    const words = new DataView(trailer.buffer, trailer.byteOffset, trailer.byteLength)
    const total = Number(words.getBigUint64(0, true))
    if (!Number.isSafeInteger(total)) {
        throw new Error(`the range read of ${key} reported the size ${total}`)
    }
    let identity = ''
    for (const byte of trailer) {
        identity += byte.toString(16).padStart(2, '0')
    }
    return { bytes: response.subarray(0, pieceLength), total, identity }
}

async function readPieces(key: string, pieceBytes: number): Promise<Uint8Array> {
    // An error here is the caller's: a missing file is how an absent key shows.
    const first = await requestPiece(key, 0, pieceBytes)
    if (first.bytes.length > first.total) {
        throw new Error(`the range read of ${key} returned ${first.bytes.length} bytes of a ${first.total}-byte file`)
    }
    if (first.bytes.length === first.total) {
        return first.bytes
    }
    const out = new Uint8Array(first.total)
    out.set(first.bytes, 0)
    let filled = first.bytes.length
    if (filled === 0) {
        throw new RangeReadChangedError(`the range read of ${key} returned nothing at 0 of ${first.total} bytes`)
    }
    while (filled < first.total) {
        let piece: RangePiece
        try {
            piece = await requestPiece(key, filled, Math.min(pieceBytes, first.total - filled))
        } catch (error) {
            // A file that vanishes between pieces was replaced or deleted mid-read; it is not an absent key.
            if (MISSING_FILE_ERROR.test(errorText(error))) {
                throw new RangeReadChangedError(`${key} went missing while it was read`)
            }
            throw error
        }
        if (piece.total !== first.total || piece.identity !== first.identity) {
            throw new RangeReadChangedError(`${key} changed while it was read`)
        }
        if (piece.bytes.length === 0) {
            throw new RangeReadChangedError(`the range read of ${key} returned nothing at ${filled} of ${first.total} bytes`)
        }
        if (filled + piece.bytes.length > first.total) {
            throw new Error(`the range read of ${key} returned more than the ${first.total} bytes of the file`)
        }
        out.set(piece.bytes, filled)
        filled += piece.bytes.length
    }
    return out
}

/**
 * Reads the whole file at `key` (relative to AppData, without any `./` prefix)
 * in pieces and returns exactly its bytes. A file of `pieceBytes` or fewer
 * costs one call. A short piece is continued from where it stopped. A piece
 * that returns nothing before the end, or a file that changes or goes missing
 * between pieces, restarts the read at most twice and then rejects; the result is never
 * padded or mixed from two files. A missing file on the first piece rejects
 * with the command's own error, which ends in `(os error 2)`.
 */
export async function readRanged(key: string, pieceBytes: number = READ_PIECE_BYTES): Promise<Uint8Array> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await readPieces(key, pieceBytes)
        } catch (error) {
            if (!(error instanceof RangeReadChangedError) || attempt >= READ_RETRIES) {
                throw error
            }
        }
    }
}
