/**
 * Streaming writer for the `.rtb` v1 container (single-disk ZIP64).
 *
 * The sink cannot seek, so each entry is written in one of two forms:
 * - local-header form: a body of known size at or below `bufferLimit` is held
 *   whole, so the local header carries the exact CRC and sizes;
 * - descriptor form: every other entry (a larger body, or a generated one of
 *   unknown size). The local header declares the sentinels, the CRC and sizes
 *   follow the body in a data descriptor, and the central record carries the real
 *   values in a 24-byte ZIP64 extra.
 *
 * Every sink write is awaited before the next one starts. Central records are
 * kept in 1 MiB packed chunks, not as one object per entry, so a directory of
 * several hundred thousand entries stays compact.
 */
import { Deflate, deflateSync } from 'fflate'
import { CRC32_INIT, crc32Final, crc32Update, crc32UpdateFill } from './crc32Running'
import {
    buildCentralRecord,
    buildDescriptor,
    buildEndRecords,
    buildLocalHeader,
    CENTRAL_FIXED,
    dosStamp,
    needsZip64,
    type DosStamp,
    type EntryRecord,
    type ZipMethod,
} from './zip64Format'

export type { ZipMethod } from './zip64Format'

export interface ZipSink {
    write(chunk: Uint8Array): Promise<void> | void
    /** Optional: a run of `length` copies of `byte`, for sinks that need not hold it. */
    writeFill?(length: number, byte: number): Promise<void> | void
}

/** A run of one repeated byte; it reaches the sink only through `writeFill`. */
export interface FillPiece {
    readonly fillByte: number
    readonly length: number
}

export type ZipPiece = Uint8Array | FillPiece

export function fillPiece(fillByte: number, length: number): FillPiece {
    if (!Number.isSafeInteger(length) || length < 0 || !Number.isInteger(fillByte) || fillByte < 0 || fillByte > 0xFF) {
        throw new RangeError('invalid fill piece')
    }
    return { fillByte, length }
}

export const DEFAULT_BUFFER_LIMIT = 16 * 1024 * 1024
const FILL_CHUNK = 1024 * 1024
const DIRECTORY_CHUNK = 1024 * 1024

export interface Zip64WriterOptions {
    sink: ZipSink
    /** Export start in ms; the DOS stamp of every entry (information only). */
    createdAt: number
    /** Largest body held whole; below `0xFFFFFFFF` so a local-header entry never needs a local ZIP64 extra. */
    bufferLimit?: number
    /** M6 branch: write 0, not `0xFFFFFFFF`, in the local size fields of a descriptor entry. */
    m6ZeroLocalSizes?: boolean
    /** fflate level for method 8. Not part of the format. */
    deflateLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
}

/** The finished central directory, in the order it will be written. */
export interface ZipDirectoryView {
    chunks: Uint8Array[]
    count: number
    directoryOffset: number
    directorySize: number
}

export interface FinishOptions {
    /** Name of the entry whose central record is written first; the others keep local order. */
    firstCentral?: string
    /** Called with the finished directory before any directory byte is written; throw to fail the export. */
    validate?: (directory: ZipDirectoryView) => void | Promise<void>
}

class PackedDirectory {
    readonly parts: { bytes: Uint8Array, used: number }[] = []
    size = 0
    count = 0

    add(record: Uint8Array): void {
        let part = this.parts[this.parts.length - 1]
        if (!part || part.bytes.length - part.used < record.length) {
            part = { bytes: new Uint8Array(Math.max(DIRECTORY_CHUNK, record.length)), used: 0 }
            this.parts.push(part)
        }
        part.bytes.set(record, part.used)
        part.used += record.length
        this.size += record.length
        this.count++
    }

    /** Chunk views in file order, the record named `first` (if any) moved to the front. */
    ordered(first: Uint8Array | null): Uint8Array[] {
        const views: Uint8Array[] = []
        let lead: Uint8Array | null = null
        for (const part of this.parts) {
            let at = 0
            let from = 0
            const dv = new DataView(part.bytes.buffer)
            while (first && !lead && at < part.used) {
                const nameLength = dv.getUint16(at + 28, true)
                const length = CENTRAL_FIXED + nameLength + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true)
                if (nameLength === first.length && sameBytes(part.bytes.subarray(at + CENTRAL_FIXED, at + CENTRAL_FIXED + nameLength), first)) {
                    lead = part.bytes.subarray(at, at + length)
                    if (at > from) {
                        views.push(part.bytes.subarray(from, at))
                    }
                    from = at + length
                    break
                }
                at += length
            }
            if (part.used > from) {
                views.push(part.bytes.subarray(from, part.used))
            }
        }
        if (first && !lead) {
            throw new Error('firstCentral names no entry')
        }
        return lead ? [lead, ...views] : views
    }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

async function* singleChunk(bytes: Uint8Array): AsyncGenerator<ZipPiece> {
    yield bytes
}

export class Zip64Writer {
    private readonly sink: ZipSink
    private readonly dos: DosStamp
    private readonly bufferLimit: number
    private readonly m6ZeroLocalSizes: boolean
    private readonly deflateLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    private readonly directory = new PackedDirectory()
    private readonly encoder = new TextEncoder()
    private offset = 0
    private busy = false
    private failure: Error | null = null
    private finished = false

    constructor(options: Zip64WriterOptions) {
        const limit = options.bufferLimit ?? DEFAULT_BUFFER_LIMIT
        if (!Number.isSafeInteger(limit) || limit < 0 || needsZip64(limit)) {
            throw new RangeError('bufferLimit must be below 0xFFFFFFFF')
        }
        this.sink = options.sink
        this.dos = dosStamp(options.createdAt)
        this.bufferLimit = limit
        this.m6ZeroLocalSizes = options.m6ZeroLocalSizes ?? false
        this.deflateLevel = options.deflateLevel ?? 1
    }

    /** Bytes written to the sink so far. */
    get position(): number {
        return this.offset
    }

    /** An entry whose body is already in memory. `knownSize` must equal `bytes.length`. */
    addBuffered(name: string, method: ZipMethod, bytes: Uint8Array, knownSize: number): Promise<void> {
        return this.run(async () => {
            if (bytes.length !== knownSize) {
                throw new RangeError(`${name}: body is ${bytes.length} bytes, declared ${knownSize}`)
            }
            const nameBytes = this.encoder.encode(name)
            if (knownSize <= this.bufferLimit) {
                await this.writeLocalForm(nameBytes, method, bytes)
            } else {
                await this.writeDescriptorForm(nameBytes, method, singleChunk(bytes), knownSize, name)
            }
        })
    }

    /**
     * An entry whose body arrives in pieces. With `knownSize` at or below the
     * buffer limit the body is held whole (local-header form); otherwise it is
     * streamed (descriptor form) and, when `knownSize` is given, still length-checked.
     */
    addStreamed(name: string, method: ZipMethod, pieces: AsyncIterable<ZipPiece>, knownSize: number | null): Promise<void> {
        return this.run(async () => {
            const nameBytes = this.encoder.encode(name)
            if (knownSize !== null && knownSize <= this.bufferLimit) {
                await this.writeLocalForm(nameBytes, method, await this.collect(name, pieces, knownSize))
            } else {
                await this.writeDescriptorForm(nameBytes, method, pieces, knownSize, name)
            }
        })
    }

    /** Writes the central directory and the end records. The writer is closed afterwards. */
    finish(options: FinishOptions = {}): Promise<void> {
        return this.run(async () => {
            const first = options.firstCentral === undefined ? null : this.encoder.encode(options.firstCentral)
            const chunks = this.directory.ordered(first)
            const directoryOffset = this.offset
            if (options.validate) {
                await options.validate({
                    chunks,
                    count: this.directory.count,
                    directoryOffset,
                    directorySize: this.directory.size,
                })
            }
            for (const chunk of chunks) {
                await this.emit(chunk)
            }
            await this.emit(buildEndRecords(this.directory.count, this.directory.size, directoryOffset, this.offset))
            this.finished = true
        })
    }

    private async run(work: () => Promise<void>): Promise<void> {
        if (this.failure) {
            throw this.failure
        }
        if (this.finished) {
            throw new Error('the writer is finished')
        }
        if (this.busy) {
            throw new Error('the writer is already writing an entry')
        }
        this.busy = true
        try {
            await work()
        } catch (error) {
            this.failure = error instanceof Error ? error : new Error(String(error))
            throw error
        } finally {
            this.busy = false
        }
    }

    private async emit(chunk: Uint8Array): Promise<void> {
        if (chunk.length === 0) {
            return
        }
        await this.sink.write(chunk)
        this.offset += chunk.length
    }

    private async emitFill(fillByte: number, length: number): Promise<void> {
        if (length === 0) {
            return
        }
        if (this.sink.writeFill) {
            await this.sink.writeFill(length, fillByte)
            this.offset += length
            return
        }
        const chunk = new Uint8Array(Math.min(length, FILL_CHUNK)).fill(fillByte)
        let left = length
        while (left > 0) {
            await this.emit(left >= chunk.length ? chunk : chunk.subarray(0, left))
            left -= Math.min(left, chunk.length)
        }
    }

    private async collect(name: string, pieces: AsyncIterable<ZipPiece>, knownSize: number): Promise<Uint8Array> {
        const body = new Uint8Array(knownSize)
        let at = 0
        for await (const piece of pieces) {
            const length = piece.length
            if (at + length > knownSize) {
                throw new RangeError(`${name}: body is longer than the declared ${knownSize} bytes`)
            }
            if (piece instanceof Uint8Array) {
                body.set(piece, at)
            } else {
                body.fill(piece.fillByte, at, at + length)
            }
            at += length
        }
        if (at < knownSize) {
            throw new RangeError(`${name}: body is ${at} bytes, declared ${knownSize}`)
        }
        return body
    }

    private async writeLocalForm(nameBytes: Uint8Array, method: ZipMethod, data: Uint8Array): Promise<void> {
        const body = method === 8 ? deflateSync(data, { level: this.deflateLevel }) : data
        const record: EntryRecord = {
            nameBytes,
            method,
            form: 'local',
            offset: this.offset,
            dos: this.dos,
            crc: crc32Final(crc32Update(CRC32_INIT, data)),
            compressedSize: body.length,
            uncompressedSize: data.length,
        }
        await this.emit(buildLocalHeader(record, false))
        await this.emit(body)
        this.directory.add(buildCentralRecord(record))
    }

    private async writeDescriptorForm(
        nameBytes: Uint8Array,
        method: ZipMethod,
        pieces: AsyncIterable<ZipPiece>,
        knownSize: number | null,
        name: string,
    ): Promise<void> {
        const offset = this.offset
        const open: EntryRecord = {
            nameBytes, method, form: 'descriptor', offset, dos: this.dos, crc: 0, compressedSize: 0, uncompressedSize: 0,
        }
        await this.emit(buildLocalHeader(open, this.m6ZeroLocalSizes))

        let crc = CRC32_INIT
        let uncompressed = 0
        let compressed = 0
        let pending: Uint8Array[] = []
        let deflater: Deflate | null = null
        if (method === 8) {
            deflater = new Deflate({ level: this.deflateLevel })
            deflater.ondata = (chunk) => {
                pending.push(chunk)
            }
        }
        const drain = async () => {
            const out = pending
            pending = []
            for (const chunk of out) {
                await this.emit(chunk)
                compressed += chunk.length
            }
        }

        for await (const piece of pieces) {
            const length = piece.length
            if (knownSize !== null && uncompressed + length > knownSize) {
                throw new RangeError(`${name}: body is longer than the declared ${knownSize} bytes`)
            }
            if (piece instanceof Uint8Array) {
                crc = crc32Update(crc, piece)
                if (deflater) {
                    deflater.push(piece)
                    await drain()
                } else {
                    await this.emit(piece)
                    compressed += length
                }
            } else if (deflater) {
                const chunk = new Uint8Array(Math.min(length, FILL_CHUNK)).fill(piece.fillByte)
                let left = length
                while (left > 0) {
                    const part = left >= chunk.length ? chunk : chunk.subarray(0, left)
                    crc = crc32Update(crc, part)
                    deflater.push(part)
                    await drain()
                    left -= part.length
                }
            } else {
                crc = crc32UpdateFill(crc, piece.fillByte, length)
                await this.emitFill(piece.fillByte, length)
                compressed += length
            }
            uncompressed += length
        }
        if (deflater) {
            deflater.push(new Uint8Array(0), true)
            await drain()
        }
        if (knownSize !== null && uncompressed < knownSize) {
            throw new RangeError(`${name}: body is ${uncompressed} bytes, declared ${knownSize}`)
        }
        const finalCrc = crc32Final(crc)
        await this.emit(buildDescriptor(finalCrc, compressed, uncompressed))
        this.directory.add(buildCentralRecord({ ...open, crc: finalCrc, compressedSize: compressed, uncompressedSize: uncompressed }))
    }
}
