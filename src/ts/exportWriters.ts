import { writeFile } from "@tauri-apps/plugin-fs"
import { language } from "src/lang"
import { alertNormalWait } from "./alert"
import streamSaver from "./vendor/streamSaver"

/** Smallest unit the exporters hand to a writer that can take a byte array. */
export interface ByteWriter {
    write(data: Uint8Array): Promise<void>
}

/** A writer an export can be finished on: every byte is accepted, then `close` completes the file. */
export interface ExportByteWriter extends ByteWriter {
    close(): Promise<void>
    /** Gives up on the export without completing the file; a failed abort leaves whatever the writer already handed on. */
    abort?(reason?: unknown): Promise<void>
    /**
     * True while the writer holds every byte in memory and has handed none to the browser, so a failed export leaves
     * no file. Absent or false for a writer that streams to a download, where a partial file may already exist.
     */
    readonly heldInMemory?: boolean
}

/** A backup entry body below this size is written together with its header. */
export const BACKUP_ENTRY_COALESCE_BYTES = 1024 * 1024

/**
 * Writes one backup entry: `[u32 name length][name][u32 data length][data]`, lengths in the platform's byte order
 * as the container has always carried them. A body below `BACKUP_ENTRY_COALESCE_BYTES` goes out in a single write;
 * a larger body is written as it is, after its header, and is never copied.
 */
export async function writeBackupEntry(writer: ByteWriter, encodedName: Uint8Array, data: Uint8Array): Promise<void> {
    const nameLength = new Uint8Array(new Uint32Array([encodedName.byteLength]).buffer)
    const dataLength = new Uint8Array(new Uint32Array([data.byteLength]).buffer)
    if (data.byteLength < BACKUP_ENTRY_COALESCE_BYTES) {
        const entry = new Uint8Array(4 + encodedName.byteLength + 4 + data.byteLength)
        entry.set(nameLength, 0)
        entry.set(encodedName, 4)
        entry.set(dataLength, 4 + encodedName.byteLength)
        entry.set(data, 8 + encodedName.byteLength)
        await writer.write(entry)
        return
    }
    const header = new Uint8Array(8 + encodedName.byteLength)
    header.set(nameLength, 0)
    header.set(encodedName, 4)
    header.set(dataLength, 4 + encodedName.byteLength)
    await writer.write(header)
    await writer.write(data)
}

/**
 * The header of a backup entry whose body of `dataLength` bytes follows in later writes: `[u32 name length][name][u32 data length]`,
 * byte for byte what `writeBackupEntry` puts before a body.
 */
export function encodeBackupEntryHeader(encodedName: Uint8Array, dataLength: number): Uint8Array {
    const header = new Uint8Array(8 + encodedName.byteLength)
    header.set(new Uint8Array(new Uint32Array([encodedName.byteLength]).buffer), 0)
    header.set(encodedName, 4)
    header.set(new Uint8Array(new Uint32Array([dataLength]).buffer), 4 + encodedName.byteLength)
    return header
}

/** Bytes a `TauriWriter` collects before it hands them to the file system in one call; no call carries more. */
export const TAURI_WRITE_CHUNK_BYTES = 4 * 1024 * 1024

/**
 * A writer for the Tauri environment. Small writes are collected and written with one `writeFile` call when
 * `TAURI_WRITE_CHUNK_BYTES` have gathered, or on `close`; a write larger than that is passed on right after the
 * collected bytes, as consecutive calls of at most that size. The first call that reaches the file system creates the file and every later one appends.
 *
 * Bytes handed to `write` may still be held until a later `write` or `close`, so a caller must treat a file as
 * complete only after `close` resolves. A failing file-system call rejects the `write` or `close` that made it, and
 * every later `write` or `close` rejects with the same error, because the file is then incomplete.
 */
export class TauriWriter {
    path: string
    firstWrite: boolean = true
    private pending: Uint8Array | null = null
    private pendingLength = 0
    private failed = false
    private failure: unknown = undefined
    private attempted = false

    /**
     * Creates an instance of TauriWriter.
     *
     * @param {string} path - The file path to write to.
     */
    constructor(path: string) {
        this.path = path
    }

    /** Whether a call that may have created or changed the file has been made; a file at `path` is untouched until then. */
    get touchedFile(): boolean {
        return this.attempted
    }

    private async put(data: Uint8Array) {
        this.attempted = true
        try {
            await writeFile(this.path, data, {
                append: !this.firstWrite
            })
        } catch (error) {
            this.failed = true
            this.failure = error
            throw error
        }
        this.firstWrite = false
    }

    private async flush() {
        if (this.pending && this.pendingLength > 0) {
            const length = this.pendingLength
            this.pendingLength = 0
            await this.put(this.pending.subarray(0, length))
        }
    }

    /**
     * Writes data to the file.
     *
     * @param {Uint8Array} data - The data to write.
     */
    async write(data: Uint8Array) {
        if (this.failed) {
            throw this.failure
        }
        if (data.byteLength > TAURI_WRITE_CHUNK_BYTES) {
            await this.flush()
            for (let start = 0; start < data.byteLength; start += TAURI_WRITE_CHUNK_BYTES) {
                await this.put(data.subarray(start, Math.min(start + TAURI_WRITE_CHUNK_BYTES, data.byteLength)))
            }
            return
        }
        if (this.pendingLength + data.byteLength > TAURI_WRITE_CHUNK_BYTES) {
            await this.flush()
        }
        this.pending ??= new Uint8Array(TAURI_WRITE_CHUNK_BYTES)
        this.pending.set(data, this.pendingLength)
        this.pendingLength += data.byteLength
        if (this.pendingLength >= TAURI_WRITE_CHUNK_BYTES) {
            await this.flush()
        }
    }

    /**
     * Writes the collected tail. The file is complete only when this resolves.
     */
    async close() {
        if (this.failed) {
            throw this.failure
        }
        await this.flush()
    }
}

/**
 * Collects an export in memory and hands it to the browser as one download on `close`. Chunks passed to `write` are
 * kept as they are, so a caller must not change them afterwards.
 */
export class BlobDownloadWriter implements ExportByteWriter {
    private chunks: Uint8Array[] = []
    private handedOver = false

    constructor(private filename: string) {}

    get heldInMemory(): boolean {
        return !this.handedOver
    }

    async write(data: Uint8Array) {
        this.chunks.push(data)
    }

    async abort() {
        this.chunks = []
    }

    async close() {
        this.handedOver = true
        const blob = new Blob(this.chunks as BlobPart[], { type: 'application/octet-stream' })
        this.chunks = []
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = this.filename
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000)
    }
}

/**
 * A stream writer of streamsaver's own memory path: the stream keeps every chunk and hands the browser the download
 * only when it is closed, so until `close` is called a failed export leaves no file.
 */
class HeldInMemoryStreamWriter implements ExportByteWriter {
    private handedOver = false

    constructor(private inner: WritableStreamDefaultWriter<Uint8Array>) {}

    get heldInMemory(): boolean {
        return !this.handedOver
    }

    write(data: Uint8Array): Promise<void> {
        return this.inner.write(data)
    }

    abort(reason?: unknown): Promise<void> {
        return this.inner.abort(reason)
    }

    close(): Promise<void> {
        this.handedOver = true
        return this.inner.close()
    }
}

/** The helper page the application serves itself; used on a secure page, where a service worker can run. */
export const SELF_HOSTED_HELPER_URL = '/streamsaver/mitm.html'

/** How long an export waits for the download helper to answer before it falls back to memory. */
export const STREAM_HELPER_READY_TIMEOUT_MS = 10_000

function answeredWithin(ready: Promise<void>, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), timeoutMs)
        void ready.then(() => {
            clearTimeout(timer)
            resolve(true)
        })
    })
}

/**
 * Opens the writer a browser export goes through.
 *
 * - On a secure page the helper is the one the application serves itself, set before the first stream is created.
 *   A plain-HTTP page keeps the helper page streamsaver names by default.
 * - When streamsaver would collect the download in memory itself, the user is told so before the export starts and
 *   `ready` is not awaited, because no helper is involved.
 * - Otherwise nothing is written until the helper has answered. If it does not answer within
 *   `STREAM_HELPER_READY_TIMEOUT_MS`, the stream (which has received no bytes) is aborted, never closed, and the
 *   export is built in memory from its first byte and offered as one download.
 */
export async function openWebExportWriter(filename: string): Promise<ExportByteWriter> {
    if (globalThis.isSecureContext) {
        streamSaver.mitm = SELF_HOSTED_HELPER_URL
    }
    if (streamSaver.useBlobFallback) {
        await alertNormalWait(language.exportHeldInMemory)
        return new HeldInMemoryStreamWriter(streamSaver.createWriteStream(filename).writable.getWriter())
    }
    const { writable, ready } = streamSaver.createWriteStream(filename)
    const writer = writable.getWriter()
    if (await answeredWithin(ready, STREAM_HELPER_READY_TIMEOUT_MS)) {
        return writer
    }
    try {
        await writer.abort(new Error('The download helper did not respond'))
    } catch (error) {
        console.error(error)
    }
    await alertNormalWait(language.exportHelperNotResponding)
    return new BlobDownloadWriter(filename)
}
