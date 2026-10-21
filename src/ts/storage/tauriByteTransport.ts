import { invoke } from '@tauri-apps/api/core'
import { type as osType } from '@tauri-apps/plugin-os'
import { StoreInvalidKeyError } from './store/errors'
import { tauriAddressableViolation, tauriCreatableViolation } from './store/keyRules'

/**
 * Byte transport between the page and the Rust side for files that do not fit
 * one safe IPC call. The Rust side is `src-tauri/src/chunked_io.rs` (the
 * `write_chunk`, `abort_chunked` and `read_range` commands) and the raw-body
 * chunk command `write_chunk_raw`.
 *
 * Two platforms use it, for two different reasons:
 *
 * - Android: the bridge carries a `Uint8Array` argument as a JSON number array
 *   (about 3.6 characters per byte), so a file is sent as base64 chunks of
 *   `WRITE_CHUNK_BYTES` and read in pieces of `READ_PIECE_BYTES`.
 * - Desktop (Windows, Linux, macOS): the web view allocates one contiguous
 *   buffer per call, several times the body size, so a call that carries a whole
 *   large file can take the whole application down. No call carries more than
 *   `CHUNK_MAX` bytes of file payload in either direction: chunks go as raw
 *   bodies (base64 `write_chunk` only after the command refuses a non-raw
 *   body), and a read is a series of `read_range` pieces of `CHUNK_MAX`.
 *
 * Everywhere else the existing whole-file calls stay: `transportKind` is the
 * single switch, and it answers `'other'` wherever the operating-system plugin
 * is missing.
 */

export const WRITE_CHUNK_COMMAND = 'write_chunk'
export const WRITE_CHUNK_RAW_COMMAND = 'write_chunk_raw'
export const ABORT_CHUNKED_COMMAND = 'abort_chunked'
export const READ_RANGE_COMMAND = 'read_range'

/** Most file bytes one desktop IPC call carries, in either direction. */
export const CHUNK_MAX = 4 * 1024 * 1024

/** The bytes one Android write chunk carries before base64. Each chunk is encoded and decoded on its own. */
export const WRITE_CHUNK_BYTES = 1024 * 1024

/** The bytes one Android read piece asks for. A file this size or smaller costs one call. */
export const READ_PIECE_BYTES = 8 * 1024 * 1024

/** Bytes after a piece in a ranged-read response: seven little-endian u64 words, the file's size first, then its identity. */
export const RANGE_TRAILER_BYTES = 56

/** Request headers of `write_chunk_raw`; the command reads the same names. */
export const CHUNK_KEY_HEADER = 'x-risu-key'
export const CHUNK_ID_HEADER = 'x-risu-id'
export const CHUNK_OFFSET_HEADER = 'x-risu-offset'
export const CHUNK_LAST_HEADER = 'x-risu-last'
export const CHUNK_DURABLE_HEADER = 'x-risu-durable'
/** Only on the last chunk: the percent-encoded key the finished file takes instead of `x-risu-key`. */
export const CHUNK_FINAL_KEY_HEADER = 'x-risu-final-key'

/** A read is retried from the start this many times when the file changes between pieces. */
const READ_RETRIES = 2

/** What `write_chunk_raw` answers with when its body did not arrive as raw bytes; nothing was written. */
const NOT_RAW_PREFIX = 'not-raw:'

/**
 * A rejection that names a missing file: `(os error 2)`, or `(os error 3)` for
 * a directory that does not exist on Windows, at the very end of the message.
 * The text before the code is localized, so only the suffix is read.
 */
export const MISSING_FILE_ERROR = /\(os error (2|3)\)\s*$/

export type TransportKind = 'android' | 'desktop' | 'other'

/**
 * Which transport this page uses. Evaluated on each call and never at module
 * load: the operating-system plugin reads an object the Tauri shell injects,
 * which the web build, the Node server page and the test runner lack.
 */
export function transportKind(): TransportKind {
    try {
        const os = osType()
        if (os === 'android') {
            return 'android'
        }
        if (os === 'windows' || os === 'linux' || os === 'macos') {
            return 'desktop'
        }
    } catch {
        // No operating-system plugin: not a Tauri shell.
    }
    return 'other'
}

/** Whether this page runs in the Android app. */
export function isAndroidTransport(): boolean {
    return transportKind() === 'android'
}

/** Whether this page runs in the desktop app (Windows, Linux or macOS). */
export function isDesktopTransport(): boolean {
    return transportKind() === 'desktop'
}

/** The bytes one read piece asks for on this platform. */
export function readPieceBytes(): number {
    return isAndroidTransport() ? READ_PIECE_BYTES : CHUNK_MAX
}

/**
 * Whether a write of `length` bytes goes through the chunk commands: always on
 * Android, above `CHUNK_MAX` on desktop (a smaller write keeps its one call),
 * never elsewhere.
 */
export function shouldChunkWrite(length: number): boolean {
    const kind = transportKind()
    return kind === 'android' || (kind === 'desktop' && length > CHUNK_MAX)
}

function errorText(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

/** Set once `write_chunk_raw` refuses a body that did not arrive raw; chunks go as base64 `write_chunk` for the rest of the page. */
let rawChunksUnavailable = false

/** Test seam: forgets that raw chunk bodies were refused. */
export function resetByteTransportForTests(): void {
    rawChunksUnavailable = false
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** The alphabet as character codes, so a group of three bytes becomes four codes with no string work. */
const BASE64_CODES = Uint8Array.from(BASE64_ALPHABET, (char) => char.charCodeAt(0))

/** Input bytes per table-encoder step; a multiple of three, so padding can only fall in the final tail. */
const TABLE_STEP_BYTES = 3 * 0x4000

/**
 * Standard base64 (RFC 4648 alphabet, `=` padding) of exactly the elements of
 * `bytes`, identical to `btoa` of the same bytes as a binary string; a view
 * encodes only its own range. One table path serves every runtime: the page
 * installs a `Uint8Array.prototype.toBase64` polyfill where the native method is
 * missing, and that polyfill concatenates per character, so dispatching on the
 * method's presence would run the slow path on exactly the WebViews that need
 * the speed. Output is built from ASCII code steps decoded and joined once.
 */
export function bytesToBase64(bytes: Uint8Array): string {
    const length = bytes.length
    const whole = length - (length % 3)
    const parts: string[] = []
    if (whole > 0) {
        const codes = BASE64_CODES
        const out = new Uint8Array((TABLE_STEP_BYTES / 3) * 4)
        const decoder = new TextDecoder()
        for (let start = 0; start < whole; start += TABLE_STEP_BYTES) {
            const end = Math.min(start + TABLE_STEP_BYTES, whole)
            let o = 0
            for (let i = start; i < end; i += 3) {
                const group = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
                out[o++] = codes[group >> 18]
                out[o++] = codes[(group >> 12) & 63]
                out[o++] = codes[(group >> 6) & 63]
                out[o++] = codes[group & 63]
            }
            parts.push(decoder.decode(out.subarray(0, o)))
        }
    }
    const rest = length - whole
    if (rest === 1) {
        const a = bytes[whole]
        parts.push(BASE64_ALPHABET[a >> 2] + BASE64_ALPHABET[(a & 3) << 4] + '==')
    } else if (rest === 2) {
        const a = bytes[whole]
        const b = bytes[whole + 1]
        parts.push(BASE64_ALPHABET[a >> 2] + BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)] + BASE64_ALPHABET[(b & 15) << 2] + '=')
    }
    return parts.join('')
}

function randomWriteId(): string {
    const random = crypto.getRandomValues(new Uint8Array(8))
    let id = ''
    for (const byte of random) {
        id += byte.toString(16).padStart(2, '0')
    }
    return id
}

/** The key rules of the strictest platform; the command applies the same set. */
function creatableRefusal(key: string): string | null {
    return tauriCreatableViolation(key) ?? tauriAddressableViolation(key, 'windows')
}

/**
 * The directory-flush status a write command answered: `{ flushed: boolean }`,
 * or the `flushed` of an `ok` outcome. `undefined` when the answer carries none
 * (a command of an older shape answers nothing), never `true`.
 */
export function readFlushed(answer: unknown): boolean | undefined {
    if (typeof answer === 'object' && answer !== null) {
        const flushed = (answer as { flushed?: unknown }).flushed
        if (typeof flushed === 'boolean') {
            return flushed
        }
    }
    return undefined
}

/** Turns the structured answer of `write_chunk_raw` into its flush status or a throw. */
function settleRawOutcome(key: string, outcome: unknown): boolean | undefined {
    if (typeof outcome === 'object' && outcome !== null) {
        const item = outcome as { k?: unknown; reason?: unknown; message?: unknown }
        if (item.k === 'ok') {
            return readFlushed(outcome)
        }
        if (item.k === 'invalid' && typeof item.reason === 'string') {
            throw new StoreInvalidKeyError(key, item.reason)
        }
        if (item.k === 'error' && typeof item.message === 'string') {
            throw new Error(item.message)
        }
    }
    throw new Error('write_chunk_raw returned an unreadable result')
}

/**
 * Writes one file as a series of chunks into a temp file next to the target and
 * replaces the target when the last chunk lands. A rejection anywhere means the
 * key holds its previous content, or stays absent.
 *
 * Calls must be awaited one at a time. `write` accepts bytes of any length and
 * sends them in chunks of at most the transport's chunk size; it keeps the
 * newest chunk back so that `finish` can mark the final one, so the caller must
 * not change a passed array afterwards. Nothing becomes visible at the key
 * before `finish` resolves.
 */
export interface ChunkedWriter {
    /** Queues the bytes. Rejects with the failure of an earlier chunk or of one sent now; the temp file is already removed then. */
    write(data: Uint8Array): Promise<void>
    /**
     * Sends the final chunk (an empty one when nothing was written). A resolved
     * call means the key holds every byte written. With `finalKey`, a key in the
     * folder of `key` that the final chunk carries, the temp file becomes
     * `finalKey` instead and `key` is never created; when `finalKey` already
     * holds a file the temp file is removed, that file is kept and the call
     * resolves. A `finalKey` the command refuses rejects and removes the temp file.
     */
    finish(finalKey?: string): Promise<void>
    /** Removes the temp file of an unfinished write. Never rejects; a no-op after `finish` resolved or after a failure already did so. */
    abort(): Promise<void>
    /**
     * After `finish` resolved on a durable write: `true` when every chunk's
     * command reported that all of its directory flushes succeeded, `false` when
     * any reported a failure or, with `finalKey`, kept an existing file (no flush
     * happened for it). The bytes are written either way. `undefined` before
     * `finish`, on a non-durable write, and when a command answered no status
     * (an older shape); it is never `true` on a missing answer.
     */
    readonly flushed?: boolean | undefined
}

export interface ChunkedWriterOptions {
    /** Asks for the flushes of `writeFileDurable`. */
    durable: boolean
    /** Bytes per chunk; defaults to the platform's chunk size. */
    chunkBytes?: number
}

/**
 * Starts a chunked write of `key` (relative to AppData, without any `./`
 * prefix). Outside Android a key the store would refuse throws
 * `StoreInvalidKeyError` here, before any call and so before chunk 0, whichever
 * way the chunks travel.
 *
 * A failure of chunk 0 aborts nothing: the command removes a temp file it
 * created itself, and a temp file that already existed is not this write's.
 * A later failure asks the command to remove the temp file; that request's own
 * failure never replaces the original error.
 */
export function createChunkedWriter(key: string, options: ChunkedWriterOptions): ChunkedWriter {
    const kind = transportKind()
    if (kind !== 'android') {
        const reason = creatableRefusal(key)
        if (reason !== null) {
            throw new StoreInvalidKeyError(key, reason)
        }
    }
    const { durable } = options
    const chunkBytes = options.chunkBytes ?? (kind === 'android' ? WRITE_CHUNK_BYTES : CHUNK_MAX)
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) {
        throw new RangeError('a chunk holds at least one byte')
    }
    const id = randomWriteId()
    let offset = 0
    let started = false
    let pending: Uint8Array | null = null
    let failure: { error: unknown } | null = null
    let cleaned = false
    let completed = false
    let anyUnflushed = false
    let anyUnreported = false

    /** The flush status the command answered for one chunk; `undefined` when it answered none. */
    async function sendChunk(piece: Uint8Array, last: boolean, finalKey: string | undefined): Promise<boolean | undefined> {
        if (kind === 'desktop' && !rawChunksUnavailable) {
            let outcome: unknown
            try {
                outcome = await invoke<unknown>(WRITE_CHUNK_RAW_COMMAND, piece, {
                    headers: {
                        [CHUNK_KEY_HEADER]: encodeURIComponent(key),
                        [CHUNK_ID_HEADER]: id,
                        [CHUNK_OFFSET_HEADER]: String(offset),
                        [CHUNK_LAST_HEADER]: last ? '1' : '0',
                        [CHUNK_DURABLE_HEADER]: durable ? '1' : '0',
                        ...(last && finalKey !== undefined ? { [CHUNK_FINAL_KEY_HEADER]: encodeURIComponent(finalKey) } : {}),
                    },
                })
            } catch (error) {
                if (!errorText(error).startsWith(NOT_RAW_PREFIX)) {
                    throw error
                }
                // Refused before any disk access: the same chunk goes again as base64.
                rawChunksUnavailable = true
                return await sendBase64(piece, last, finalKey)
            }
            return settleRawOutcome(key, outcome)
        }
        return await sendBase64(piece, last, finalKey)
    }

    async function sendBase64(piece: Uint8Array, last: boolean, finalKey: string | undefined): Promise<boolean | undefined> {
        const answer = await invoke<unknown>(WRITE_CHUNK_COMMAND, {
            key, id, offset, data: bytesToBase64(piece), last, durable,
            ...(last && finalKey !== undefined ? { finalKey } : {}),
        })
        return readFlushed(answer)
    }

    async function removeTemp(): Promise<void> {
        if (!started || cleaned) {
            return
        }
        cleaned = true
        try {
            await invoke<void>(ABORT_CHUNKED_COMMAND, { key, id })
        } catch {
            // The leftover temp is removed by the boot sweep.
        }
    }

    async function flushPending(last: boolean, finalKey?: string): Promise<void> {
        const piece = pending
        pending = null
        if (piece === null) {
            return
        }
        let status: boolean | undefined
        try {
            status = await sendChunk(piece, last, finalKey)
        } catch (error) {
            failure = { error }
            await removeTemp()
            throw error
        }
        if (status === false) {
            anyUnflushed = true
        } else if (status === undefined) {
            anyUnreported = true
        }
        started = true
        offset += piece.length
    }

    function assertOpen(): void {
        if (failure !== null) {
            throw failure.error
        }
        if (completed || cleaned) {
            throw new Error('the chunked write is already closed')
        }
    }

    return {
        get flushed(): boolean | undefined {
            if (!durable || !completed) {
                return undefined
            }
            // One failed flush decides the answer; a chunk that reported nothing leaves it unknown.
            return anyUnflushed ? false : anyUnreported ? undefined : true
        },

        async write(data: Uint8Array): Promise<void> {
            assertOpen()
            for (let start = 0; start < data.length; start += chunkBytes) {
                if (pending !== null) {
                    await flushPending(false)
                }
                pending = data.subarray(start, Math.min(start + chunkBytes, data.length))
            }
        },

        async finish(finalKey?: string): Promise<void> {
            assertOpen()
            if (finalKey !== undefined && kind !== 'android') {
                // The command applies the same rules; refusing here keeps a bad name from costing the last chunk.
                const reason = creatableRefusal(finalKey)
                if (reason !== null) {
                    const error = new StoreInvalidKeyError(finalKey, reason)
                    failure = { error }
                    await removeTemp()
                    throw error
                }
            }
            pending ??= new Uint8Array(0)
            await flushPending(true, finalKey)
            completed = true
        },

        async abort(): Promise<void> {
            pending = null
            if (completed) {
                return
            }
            failure ??= { error: new Error('the chunked write was aborted') }
            await removeTemp()
        },
    }
}

/**
 * Writes `bytes` to `key` (relative to AppData, without any `./` prefix) in
 * chunks, and replaces the file when the last chunk lands. A rejection means the
 * key holds its previous content, or stays absent. Resolves with the writer's
 * `flushed` status: `false` when any chunk answered `false` (even if another
 * answered nothing), otherwise `undefined` when the write is not durable or
 * at least one chunk answered nothing, otherwise `true`.
 */
export async function writeChunked(
    key: string,
    bytes: Uint8Array,
    durable: boolean,
    chunkBytes?: number,
): Promise<boolean | undefined> {
    const writer = createChunkedWriter(key, { durable, chunkBytes })
    await writer.write(bytes)
    await writer.finish()
    return writer.flushed
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

/** One piece of a ranged read, with what the trailer said about the file at that moment. */
export interface RangedPiece {
    bytes: Uint8Array
    /** Where the piece starts in the file. */
    offset: number
    /** The file's size as the trailer reported it; equal on every piece of one read. */
    total: number
    /** The file's identity as the trailer reported it; equal on every piece of one read. */
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

/**
 * Reads the file at `key` (relative to AppData, without any `./` prefix) piece
 * by piece, in order, and yields each piece with the size and identity the
 * trailer reported. The first piece is always yielded, empty for an empty file;
 * its `total` is the size every later piece is checked against.
 *
 * A missing file on the first piece rejects with the command's own error, which
 * ends in `(os error 2)`. After the first piece the read never continues over
 * a change: a file that vanishes, changes size or identity, or answers nothing
 * before the end rejects with `RangeReadChangedError`, and one that answers
 * more than it holds rejects with an `Error`. No restart happens here; the
 * caller decides what a change means. The pieces are views into the responses,
 * so a caller that keeps one past the next `next()` keeps its whole response.
 */
export async function* readRangedPieces(key: string, pieceBytes: number = readPieceBytes()): AsyncGenerator<RangedPiece, void, undefined> {
    // An error here is the caller's: a missing file is how an absent key shows.
    const first = await requestPiece(key, 0, pieceBytes)
    if (first.bytes.length > first.total) {
        throw new Error(`the range read of ${key} returned ${first.bytes.length} bytes of a ${first.total}-byte file`)
    }
    if (first.bytes.length === 0 && first.total > 0) {
        throw new RangeReadChangedError(`the range read of ${key} returned nothing at 0 of ${first.total} bytes`)
    }
    yield { bytes: first.bytes, offset: 0, total: first.total, identity: first.identity }
    let filled = first.bytes.length
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
        yield { bytes: piece.bytes, offset: filled, total: first.total, identity: first.identity }
        filled += piece.bytes.length
    }
}

async function readPieces(key: string, pieceBytes: number): Promise<Uint8Array> {
    let out: Uint8Array | null = null
    for await (const piece of readRangedPieces(key, pieceBytes)) {
        if (piece.offset === 0) {
            if (piece.bytes.length === piece.total) {
                return piece.bytes
            }
            out = new Uint8Array(piece.total)
        }
        out?.set(piece.bytes, piece.offset)
    }
    return out ?? new Uint8Array(0)
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
export async function readRanged(key: string, pieceBytes: number = readPieceBytes()): Promise<Uint8Array> {
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
