import { open, SeekMode, type FileHandle } from '@tauri-apps/plugin-fs'
import { CHUNK_MAX } from './storage/tauriByteTransport'

/**
 * Where an import reads its bytes from: a picked or dropped `File`, bytes already in memory, or a file the operating
 * system handed to the desktop app, which is read through an open plugin-fs handle in pieces of at most `CHUNK_MAX`.
 * An importer that needs a big file never asks for all of it: it walks the structure with `read` and takes one record
 * at a time.
 *
 * `read` is called by one sequential reader at a time. A source over a handle with one shared cursor serialises its own
 * calls, but an importer must not rely on that to interleave two readers.
 */
export interface ImportSource {
    readonly name: string
    /** The size when the source was opened. `stat()` reports the size now. */
    readonly size: number
    /**
     * The bytes in [start, end), clamped to [0, size]. Fewer bytes than asked come back only when the source ends or
     * shrank. A view into the source's own memory is only valid as long as the caller does not change it.
     */
    read(start: number, end: number): Promise<Uint8Array>
    /** The whole source as a forward-only stream. A desktop source is read in pieces of at most `CHUNK_MAX`. */
    stream(): ReadableStream<Uint8Array>
    /** The size and modification time of the underlying file now; `modified` is null when the platform has none. */
    stat(): Promise<ImportSourceStat>
    /** Releases what the source holds. The importer that opened the source calls it on every exit; it never rejects and may be called again. */
    close(): Promise<void>
}

export type ImportSourceStat = {
    size: number
    modified: number | null
}

/** Bytes one read-ahead window holds when it is not told otherwise. */
export const IMPORT_WINDOW_BYTES = 256 * 1024

/** A record shorter than this is read through the window; a longer one is skipped and only its next header is read. */
const READ_AHEAD_MAX_GAP = 16 * 1024

export function isImportSource(value: unknown): value is ImportSource {
    if (typeof value !== 'object' || value === null) {
        return false
    }
    const candidate = value as Partial<ImportSource>
    return typeof candidate.read === 'function'
        && typeof candidate.stream === 'function'
        && typeof candidate.stat === 'function'
        && typeof candidate.close === 'function'
        && typeof candidate.size === 'number'
}

function clampRange(start: number, end: number, size: number): { from: number, to: number } {
    const from = Math.max(0, Math.min(start, size))
    return { from, to: Math.max(from, Math.min(end, size)) }
}

/** A forward-only stream over `read`, in pieces of `pieceBytes`. */
function streamOf(source: Pick<ImportSource, 'read'>, pieceBytes: number): ReadableStream<Uint8Array> {
    let position = 0
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            const piece = await source.read(position, position + pieceBytes)
            if (piece.length === 0) {
                controller.close()
                return
            }
            position += piece.length
            controller.enqueue(piece)
        },
    })
}

export function importSourceOfBytes(name: string, bytes: Uint8Array): ImportSource {
    return {
        name,
        size: bytes.length,
        read: async (start, end) => {
            const { from, to } = clampRange(start, end, bytes.length)
            return bytes.subarray(from, to)
        },
        stream: () => streamOf({
            read: async (start, end) => bytes.subarray(Math.min(start, bytes.length), Math.min(end, bytes.length)),
        }, 1024 * 1024),
        stat: async () => ({ size: bytes.length, modified: null }),
        close: async () => undefined,
    }
}

export function importSourceOfFile(file: File): ImportSource {
    return {
        name: file.name,
        size: file.size,
        read: async (start, end) => {
            const { from, to } = clampRange(start, end, file.size)
            if (to === from) {
                return new Uint8Array(0)
            }
            return new Uint8Array(await file.slice(from, to).arrayBuffer())
        },
        stream: () => file.stream(),
        stat: async () => ({ size: file.size, modified: file.lastModified }),
        close: async () => undefined,
    }
}

class DesktopImportSource implements ImportSource {
    readonly name: string
    readonly size: number
    #handle: FileHandle
    /** Where the handle's cursor stands, or null when it is not known. */
    #cursor: number | null = 0
    /** Calls on the handle run one after another, so the shared cursor is never used by two reads at once. */
    #queue: Promise<unknown> = Promise.resolve()
    #closed = false

    constructor(name: string, size: number, handle: FileHandle) {
        this.name = name
        this.size = size
        this.#handle = handle
    }

    /** A call made after `close` is refused; one made before it still runs, and `close` waits for it. */
    #serial<T>(run: () => Promise<T>): Promise<T> {
        if (this.#closed) {
            return Promise.reject(new Error('the import source is closed'))
        }
        const result = this.#queue.then(run)
        this.#queue = result.catch(() => undefined)
        return result
    }

    read(start: number, end: number): Promise<Uint8Array> {
        return this.#serial(async () => {
            const { from, to } = clampRange(start, end, this.size)
            const out = new Uint8Array(to - from)
            if (out.length === 0) {
                return out
            }
            if (this.#cursor !== from) {
                this.#cursor = null
                await this.#handle.seek(from, SeekMode.Start)
            }
            this.#cursor = null
            let got = 0
            while (got < out.length) {
                const count = await this.#handle.read(out.subarray(got, Math.min(got + CHUNK_MAX, out.length)))
                if (count === null) {
                    break
                }
                got += count
            }
            this.#cursor = from + got
            return got === out.length ? out : out.subarray(0, got)
        })
    }

    stream(): ReadableStream<Uint8Array> {
        return streamOf(this, CHUNK_MAX)
    }

    stat(): Promise<ImportSourceStat> {
        return this.#serial(async () => {
            const info = await this.#handle.stat()
            return { size: info.size, modified: info.mtime ? info.mtime.getTime() : null }
        })
    }

    async close(): Promise<void> {
        if (this.#closed) {
            return
        }
        this.#closed = true
        await this.#queue
        // A read handle that fails to close holds nothing the caller needs.
        await this.#handle.close().catch(() => undefined)
    }
}

/**
 * Opens the file at `path` for reading through the plugin. The size comes from the open handle, so it describes the
 * file that is read. The caller owns the source and closes it.
 */
export async function openDesktopImportSource(path: string): Promise<ImportSource> {
    const handle = await open(path, { read: true })
    try {
        const info = await handle.stat()
        return new DesktopImportSource(path.split(/[\\/]/).pop() || path, info.size, handle)
    } catch (error) {
        await handle.close().catch(() => undefined)
        throw error
    }
}

/**
 * Reads a source through a read-ahead window, for a walk over many small headers: adjacent small reads cost one source
 * call. A read that is long, or that follows a long skip, goes straight to the source and leaves the window as it was,
 * so skipping over big records never loads their bytes.
 *
 * A returned view is only valid until the next call.
 */
export class WindowedReader {
    #start = 0
    #bytes: Uint8Array = new Uint8Array(0)
    #lastEnd: number | null = null

    constructor(
        private readonly source: ImportSource,
        private readonly limit: number,
        private readonly windowBytes: number = IMPORT_WINDOW_BYTES,
    ) {}

    async read(start: number, end: number): Promise<Uint8Array> {
        const to = Math.min(end, this.limit)
        if (start >= to) {
            return new Uint8Array(0)
        }
        const lastEnd = this.#lastEnd
        this.#lastEnd = to
        if (start >= this.#start && to <= this.#start + this.#bytes.length) {
            return this.#bytes.subarray(start - this.#start, to - this.#start)
        }
        const length = to - start
        const skipped = lastEnd === null ? Infinity : start - lastEnd
        if (length >= this.windowBytes || skipped > READ_AHEAD_MAX_GAP) {
            return await this.source.read(start, to)
        }
        const windowEnd = Math.min(this.limit, start + this.windowBytes)
        this.#bytes = await this.source.read(start, windowEnd)
        this.#start = start
        return this.#bytes.subarray(0, Math.min(length, this.#bytes.length))
    }
}
