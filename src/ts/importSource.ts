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
     * Set when the cost of a call dominates the cost of its bytes: validation may then read up to `windowBytes` ahead
     * through bodies no longer than `windowGapBytes`. A source that leaves them unset is read by the default window.
     */
    readonly windowBytes?: number
    readonly windowGapBytes?: number
    /**
     * The bytes in [start, end), clamped to [0, size]. Fewer bytes than asked come back only when the source ends or
     * shrank. A view into the source's own memory is only valid as long as the caller does not change it.
     */
    read(start: number, end: number): Promise<Uint8Array>
    /**
     * The bytes of several ranges in one call, one part per range in input order. Each range is clamped as `read`
     * clamps it, and `[]` makes no call. A part is shorter than its clamped range only when the source ended or shrank.
     * A rejection is the source's own error, raised only when nothing the call started is still pending. A wrapper that
     * replaces `read` must replace or drop `readRanges`.
     */
    readRanges?(ranges: ReadonlyArray<readonly [number, number]>): Promise<Uint8Array[]>
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

/** The most bytes an importer reads from a source in one call while it saves a big asset piece by piece. */
export const IMPORT_PIECE_BYTES = CHUNK_MAX

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

/**
 * The read-ahead of a picked File. The cost of a read is per Blob item rather than per byte, and the items of
 * separate composite Blobs are read in parallel, so a batch of ranges is read as a few composites together. A body is
 * read through only while it is no longer than the gap: at the per-item cost and the per-byte rate of a phone's picker
 * File, a body of about 2.4 MiB costs as much as the item it saves.
 */
export const PICKED_FILE_WINDOW_BYTES = 8 * 1024 * 1024
export const PICKED_FILE_GAP_BYTES = 1024 * 1024

/** The composite Blobs one `readRanges` call of a picked File reads together. */
export const RANGE_READ_PARALLEL = 4

/**
 * Reads the clamped, non-empty items as `min(RANGE_READ_PARALLEL, n)` composite Blobs of consecutive items, balanced
 * by item count and started together; the first `n mod m` groups take one extra item. It settles after every composite
 * has settled, so nothing is pending when it rejects, and the rejection is the lowest-index group's own error. Parts
 * are indexed by input range. A group whose bytes differ in count from its clamped ranges returns only empty parts,
 * so the caller sees a mismatch and no byte of that group is served.
 */
async function readFileRanges(file: File, ranges: ReadonlyArray<readonly [number, number]>): Promise<Uint8Array[]> {
    const parts: Uint8Array[] = ranges.map(() => new Uint8Array(0))
    const items: { index: number, from: number, to: number }[] = []
    ranges.forEach(([start, end], index) => {
        const { from, to } = clampRange(start, end, file.size)
        if (to > from) {
            items.push({ index, from, to })
        }
    })
    if (items.length === 0) {
        return parts
    }
    const groupCount = Math.min(RANGE_READ_PARALLEL, items.length)
    const perGroup = Math.floor(items.length / groupCount)
    const extra = items.length % groupCount
    const groups: typeof items[] = []
    let at = 0
    for (let g = 0; g < groupCount; g++) {
        const count = perGroup + (g < extra ? 1 : 0)
        groups.push(items.slice(at, at + count))
        at += count
    }
    const settled = await Promise.allSettled(groups.map(async (group) => {
        return await new Blob(group.map((item) => file.slice(item.from, item.to))).arrayBuffer()
    }))
    for (const result of settled) {
        if (result.status === 'rejected') {
            throw result.reason
        }
    }
    settled.forEach((result, g) => {
        if (result.status !== 'fulfilled') {
            return
        }
        const group = groups[g]
        if (result.value.byteLength !== group.reduce((sum, item) => sum + (item.to - item.from), 0)) {
            return
        }
        let offset = 0
        for (const item of group) {
            parts[item.index] = new Uint8Array(result.value, offset, item.to - item.from)
            offset += item.to - item.from
        }
    })
    return parts
}

export function importSourceOfFile(file: File, windowBytes: number = PICKED_FILE_WINDOW_BYTES, windowGapBytes: number = PICKED_FILE_GAP_BYTES): ImportSource {
    return {
        windowBytes,
        windowGapBytes,
        name: file.name,
        size: file.size,
        read: async (start, end) => {
            const { from, to } = clampRange(start, end, file.size)
            if (to === from) {
                return new Uint8Array(0)
            }
            return new Uint8Array(await file.slice(from, to).arrayBuffer())
        },
        readRanges: (ranges) => readFileRanges(file, ranges),
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

    /**
     * `aheadOf` returns where a planned read may extend to. The read then covers up to that end, clamped to `limit`
     * and to `windowBytes` past `start`, and becomes the window; an end at or below the request reads exactly the
     * request. The function is called only when the window misses, because it walks the run. Without it, the read
     * guesses from the last skip.
     */
    async read(start: number, end: number, aheadOf?: () => number): Promise<Uint8Array> {
        const to = Math.min(end, this.limit)
        if (start >= to) {
            return new Uint8Array(0)
        }
        const lastEnd = this.#lastEnd
        this.#lastEnd = to
        if (start >= this.#start && to <= this.#start + this.#bytes.length) {
            return this.#bytes.subarray(start - this.#start, to - this.#start)
        }
        if (aheadOf !== undefined) {
            const planEnd = Math.min(this.limit, Math.max(to, Math.min(aheadOf(), start + this.windowBytes)))
            if (planEnd <= to) {
                return await this.source.read(start, to)
            }
            this.#bytes = await this.source.read(start, planEnd)
            this.#start = start
            return this.#bytes.subarray(0, Math.min(to - start, this.#bytes.length))
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

/** The most segments, and so Blob items, one batch of `RangeBatchReader` holds. */
export const RANGE_BATCH_MAX_RANGES = 256

/**
 * Turns ranges into the segments a batch reads. `ranges` is flat [start, end, ...], sorted by start and clamped to the
 * source; empty ranges are skipped. A range joins the current segment when the gap to it is at most `gapBytes` and the
 * segment stays within `windowBytes`; an overlap counts as a gap of zero, so the cap applies to it too. Otherwise a new
 * segment opens, cut to `windowBytes`: bytes of a range past the cut belong to no segment. The result is flat
 * [start, end, ...], sorted, disjoint, each segment at most `windowBytes` long.
 */
export function rangeSegments(ranges: Float64Array, windowBytes: number, gapBytes: number): Float64Array {
    const out: number[] = []
    let open = false
    let s = 0
    let e = 0
    for (let i = 0; i + 1 < ranges.length; i += 2) {
        const a = ranges[i]
        const b = ranges[i + 1]
        if (b <= a) {
            continue
        }
        const from = open ? Math.max(a, e) : a
        if (open && b <= from) {
            continue
        }
        if (open && from - e <= gapBytes && b - s <= windowBytes) {
            e = b
            continue
        }
        if (open) {
            out.push(s, e)
        }
        open = true
        s = from
        e = Math.min(b, from + windowBytes)
    }
    if (open) {
        out.push(s, e)
    }
    return Float64Array.from(out)
}

/**
 * Serves a walk's reads from batches of planned segments. The segments are built once from the planned ranges. A
 * request inside one segment is answered from the batch holding it; a miss fetches that segment and the following ones
 * that fit within `RANGE_BATCH_MAX_RANGES` segments and `windowBytes` in total, in one `readRanges` call when the
 * source has it. A request that is longer than `windowBytes`, or that no single segment covers, is read exactly and
 * leaves the batch as it was. A batch with a part of the wrong length is dropped, and every later request is read
 * exactly, so a short batch is never served. A source error propagates.
 *
 * A returned view is only valid until the next call.
 */
export class RangeBatchReader {
    /** Steps of work taken building and searching the segment table, which a test bounds. */
    steps = 0
    readonly #segments: Float64Array
    #cursor = 0
    #batchFrom = 0
    #parts: Uint8Array[] = []
    #exact = false

    constructor(
        private readonly source: ImportSource,
        private readonly limit: number,
        ranges: Float64Array,
        private readonly windowBytes: number,
        gapBytes: number,
    ) {
        this.steps += ranges.length / 2
        this.#segments = rangeSegments(ranges, windowBytes, gapBytes)
    }

    #find(start: number, to: number): number {
        const segments = this.#segments
        const count = segments.length / 2
        if (count === 0) {
            return -1
        }
        let found = this.#cursor
        this.steps++
        if (segments[2 * found] > start) {
            let low = 0
            let high = found - 1
            found = -1
            while (low <= high) {
                const middle = (low + high) >> 1
                this.steps++
                if (segments[2 * middle] <= start) {
                    found = middle
                    low = middle + 1
                } else {
                    high = middle - 1
                }
            }
            if (found < 0) {
                return -1
            }
        } else {
            while (found + 1 < count && segments[2 * (found + 1)] <= start) {
                found++
                this.steps++
            }
        }
        this.#cursor = found
        return to <= segments[2 * found + 1] ? found : -1
    }

    async read(start: number, end: number): Promise<Uint8Array> {
        const to = Math.min(end, this.limit)
        if (start >= to) {
            return new Uint8Array(0)
        }
        if (this.#exact || to - start > this.windowBytes) {
            return await this.source.read(start, to)
        }
        const k = this.#find(start, to)
        if (k < 0) {
            return await this.source.read(start, to)
        }
        const segments = this.#segments
        if (k < this.#batchFrom || k >= this.#batchFrom + this.#parts.length) {
            const count = segments.length / 2
            const wanted: [number, number][] = []
            let total = 0
            const maxItems = this.source.readRanges === undefined ? 1 : RANGE_BATCH_MAX_RANGES
            for (let j = k; j < count && wanted.length < maxItems; j++) {
                const length = segments[2 * j + 1] - segments[2 * j]
                if (total + length > this.windowBytes) {
                    break
                }
                total += length
                wanted.push([segments[2 * j], segments[2 * j + 1]])
                this.steps++
            }
            const parts = wanted.length >= 2 && this.source.readRanges !== undefined
                ? await this.source.readRanges(wanted)
                : [await this.source.read(wanted[0][0], wanted[0][1])]
            if (parts.length !== wanted.length || parts.some((part, i) => part.length !== wanted[i][1] - wanted[i][0])) {
                this.#parts = []
                this.#exact = true
                return await this.source.read(start, to)
            }
            this.#parts = parts
            this.#batchFrom = k
        }
        const offset = start - segments[2 * k]
        return this.#parts[k - this.#batchFrom].subarray(offset, offset + (to - start))
    }
}
