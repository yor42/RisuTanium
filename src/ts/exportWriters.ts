import { invoke } from "@tauri-apps/api/core"
import { writeFile } from "@tauri-apps/plugin-fs"
import { language } from "src/lang"
import { alertNormalWait } from "./alert"
import streamSaver from "./vendor/streamSaver"
import { MEASURE } from "./process/memory/measureFlag"
import { bytesToBase64, isAndroidTransport } from "./storage/tauriByteTransport"
import type { ExportCancelToken } from "./exportCancel"

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

/** One file-system call of a `TauriWriter` (`writeFile`, or `export_append_b64`), as a measurement build records it. */
export interface ExportWriteCall {
    bytes: number
    /** Milliseconds until the call returned its promise; the page-side work (the base64 encode included) that runs before the call is handed on. */
    syncMs: number
    /** Milliseconds from then until the promise settled. */
    waitMs: number
    /** False for the call that created the file. */
    append: boolean
    /** Set only on a call of `export_append_b64`: the milliseconds its base64 encode took, which `syncMs` includes. */
    encodeMs?: number
    /** Set only on a call that `close` made, which is the one that completes the file. */
    closing?: true
    /** Set only on the closing call of `export_append_b64`, from its reply: whether the file's data reached storage (`sync_all`). */
    synced?: boolean
}

/** The file-system calls since the last `takeExportWriteStats`. */
export interface ExportWriteStats {
    calls: number
    bytes: number
    syncMs: number
    waitMs: number
    creates: number
    /** Calls made through `export_append_b64`; the others went through `writeFile`. */
    appendCalls: number
    /** Milliseconds spent encoding base64 text, over the calls of `export_append_b64`. */
    encodeMs: number
    /** Milliseconds the calls made by `close` took: encode, hand-off and wait. */
    closeMs: number
    /** The `synced` of the closing `export_append_b64` reply; `undefined` when no such call replied with one. */
    appendSynced: boolean | undefined
    /** Every call, in order. */
    records: ExportWriteCall[]
}

let writeRecords: ExportWriteCall[] = []
let measureClock: () => number = () => performance.now()

/** Test seam: replaces the clock the recorder reads; `null` restores it. */
export function setExportWriteClockForTest(clock: (() => number) | null): void {
    measureClock = clock ?? (() => performance.now())
}

/** Test seam: forgets the recorded calls. */
export function resetExportWriteStatsForTest(): void {
    writeRecords = []
}

/**
 * Measurement builds only (`MEASURE`): the `writeFile` calls recorded since the last take, which also clears them;
 * `null` otherwise. Recording never throws into a write and never changes what is written.
 */
export function takeExportWriteStats(): ExportWriteStats | null {
    if (!MEASURE) {
        return null
    }
    const records = writeRecords
    writeRecords = []
    const stats: ExportWriteStats = { calls: records.length, bytes: 0, syncMs: 0, waitMs: 0, creates: 0, appendCalls: 0, encodeMs: 0, closeMs: 0, appendSynced: undefined, records }
    for (const record of records) {
        stats.bytes += record.bytes
        stats.syncMs += record.syncMs
        stats.waitMs += record.waitMs
        if (!record.append) {
            stats.creates += 1
        }
        if (record.encodeMs !== undefined) {
            stats.appendCalls += 1
            stats.encodeMs += record.encodeMs
        }
        if (record.closing) {
            stats.closeMs += record.syncMs + record.waitMs
        }
        if (record.synced !== undefined) {
            stats.appendSynced = record.synced
        }
    }
    return stats
}

/** The timing of one call: `encoded` when the base64 text is ready, `returned` when the call handed back its promise, `settled` when that promise resolved. */
interface WriteTiming {
    /** Only for a call that encodes; its absence marks a call through `writeFile`. */
    encoding(): void
    encoded(): void
    returned(): void
    /** Only for a closing call that replied with a `synced`. */
    synced(value: boolean): void
    settled(): void
}

function startWriteTiming(bytes: number, append: boolean, closing: boolean): WriteTiming | null {
    try {
        const startedAt = measureClock()
        let returnedAt = startedAt
        let encodeStartedAt: number | undefined
        let encodeMs: number | undefined
        let synced: boolean | undefined
        return {
            encoding() {
                encodeMs = 0
                try {
                    encodeStartedAt = measureClock()
                } catch {
                    // A failing clock loses this call's encode time and nothing else.
                }
            },
            encoded() {
                try {
                    if (encodeStartedAt !== undefined) {
                        encodeMs = measureClock() - encodeStartedAt
                    }
                } catch {
                    // A failing clock loses this call's encode time and nothing else.
                }
            },
            returned() {
                try {
                    returnedAt = measureClock()
                } catch {
                    // A failing clock loses this call's timing and nothing else.
                }
            },
            synced(value) {
                synced = value
            },
            settled() {
                try {
                    const settledAt = measureClock()
                    const record: ExportWriteCall = { bytes, syncMs: returnedAt - startedAt, waitMs: settledAt - returnedAt, append }
                    if (encodeMs !== undefined) {
                        record.encodeMs = encodeMs
                    }
                    if (closing) {
                        record.closing = true
                    }
                    if (synced !== undefined) {
                        record.synced = synced
                    }
                    writeRecords.push(record)
                } catch {
                    // A failing clock loses this call's record and nothing else.
                }
            },
        }
    } catch {
        return null
    }
}

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
    /** Fixed at construction: whether chunks go to `export_append_b64` (the Android save dialog's `content://` document) instead of `writeFile`. */
    private readonly viaAppendCommand: boolean

    /**
     * Creates an instance of TauriWriter.
     *
     * @param {string} path - The file path to write to.
     */
    constructor(path: string) {
        this.path = path
        this.viaAppendCommand = path.startsWith('content://') && isAndroidTransport()
    }

    /** Whether a call that may have created or changed the file has been made; a file at `path` is untouched until then. */
    get touchedFile(): boolean {
        return this.attempted
    }

    /**
     * One chunk of base64 text to `export_append_b64`. The encode, the call and the length check are all inside the
     * caller's failure handling, so the bytes taken off the buffer are never dropped without the writer failing.
     */
    private async putViaAppendCommand(data: Uint8Array, append: boolean, closing: boolean, timing: WriteTiming | null) {
        timing?.encoding()
        const text = bytesToBase64(data)
        timing?.encoded()
        const reply = invoke<{ written?: number, synced?: boolean }>('export_append_b64', { uri: this.path, data: text, create: !append, last: closing })
        timing?.returned()
        const result = await reply
        if (result?.written !== data.byteLength) {
            throw new Error(`export_append_b64 reported ${String(result?.written)} bytes written for a chunk of ${data.byteLength}`)
        }
        if (closing && typeof result.synced === 'boolean') {
            timing?.synced(result.synced)
        }
    }

    private async put(data: Uint8Array, closing = false) {
        this.attempted = true
        const append = !this.firstWrite
        const timing = MEASURE ? startWriteTiming(data.byteLength, append, closing) : null
        try {
            if (this.viaAppendCommand) {
                await this.putViaAppendCommand(data, append, closing, timing)
            } else {
                const written = writeFile(this.path, data, {
                    append
                })
                timing?.returned()
                await written
            }
            timing?.settled()
        } catch (error) {
            this.failed = true
            this.failure = error
            throw error
        }
        this.firstWrite = false
    }

    private async flush(closing = false) {
        if (this.pending && this.pendingLength > 0) {
            const length = this.pendingLength
            this.pendingLength = 0
            await this.put(this.pending.subarray(0, length), closing)
        } else if (closing && this.viaAppendCommand && !this.firstWrite) {
            // The command syncs the file on its last call, so a file whose bytes all went out earlier still needs one.
            await this.put(new Uint8Array(0), true)
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
        await this.flush(true)
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

/**
 * What a cancelled export may have left: `kept` when a download stream was opened (the browser may already hold a file,
 * even with no byte written), `untouched` when there is no writer, it holds everything in memory, or it is a desktop
 * file writer (a desktop export offers no Cancel).
 */
export function cancelledFileState(target: ExportByteWriter | undefined): 'untouched' | 'kept' {
    if (target === undefined || target instanceof TauriWriter || target.heldInMemory === true) {
        return 'untouched'
    }
    return 'kept'
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
 * - A cancel (`cancel`) seen before the helper is asked, or after its timeout, ends the open with `ExportCancelledError`
 *   before any notice or fallback download.
 */
export async function openWebExportWriter(filename: string, cancel?: ExportCancelToken): Promise<ExportByteWriter> {
    if (globalThis.isSecureContext) {
        streamSaver.mitm = SELF_HOSTED_HELPER_URL
    }
    cancel?.throwIfCancelled()
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
    // A cancel during the helper wait ends the export here: no notice, and no download from the memory fallback.
    cancel?.throwIfCancelled()
    await alertNormalWait(language.exportHelperNotResponding)
    return new BlobDownloadWriter(filename)
}
