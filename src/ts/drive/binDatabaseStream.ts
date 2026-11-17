import * as fflate from 'fflate'
import type { Database } from '../storage/database.svelte'
import { crc32, readU32le } from '../storage/blockFrame'
import {
    checkCompressionStreams, checkHeader, decodeMsgpackDefault, decodeMsgpackInt64Number,
    KV_BLOCK_PREFIX, MSGPACK_SAVE_HEADER_BYTES, parseBlockHeader, RisuSaveDecoder, RisuSaveType, salvageKindOfType,
    type DecodedBlock, type SalvageOmittedBlock,
} from '../storage/risuSave'
import { BinFileChangedError } from '../storage/store2/legacy/binReader'
import { BACKUP_ENCRYPTION_MARKER_NAME, parseBackupEntryHeader, type BackupIndexEntry, type BinFile } from './backupContainer'
import { CRC32_INIT, crc32Final, crc32Update } from './rtb/crc32Running'

/**
 * The database entry of a `.bin` read once, front to back, in bounded chunks, and handed out as it decodes: every
 * character as soon as its bytes are complete, then the rest of the tree, then what the decode left out. The decode is
 * the one `decodeBinDatabase` makes (`decodeRisuSave` for the msgpack formats, `salvageRisuSave` for the block format),
 * taken apart so that no more than one character and the non-character root is ever held:
 *  - msgpack: a scanner walks the root map and skips every value by its length. Each `characters` element is decoded on
 *    its own, from a fresh copy of its bytes; every other key and value stays raw, and the root is decoded once from a
 *    synthesized map that holds them in their original order with `characters` as an empty array.
 *  - blocks: each block is framed, checked and decompressed in file order; a character block is parsed and handed out,
 *    the others are kept as text, and the tree is assembled by the decoder's own assembly step, which walks the blocks
 *    in file order (a handed-out character holds its place), so the root may sit anywhere. The encoder writes it first.
 *
 * Only an entry whose streamed value provably equals the whole decode is streamed. Anything else is a decline: the
 * caller discards what the sink already received and takes the whole path. A decline is never a refusal. A read error
 * (`BinFileChangedError`) is not a decline and propagates. An error the sink or `yieldToMain` throws propagates too.
 */

export type BinStreamDeclineReason =
    /** The header is none of the four formats, or the entry is too short to carry one. */
    | 'format'
    /** A 'compressed' entry that does not start with the gzip magic: zlib and raw deflate are read by the whole path. */
    | 'not-gzip'
    /** An extension type other than 0 (undefined) and 0xff (timestamp): its meaning can depend on other elements. */
    | 'ext'
    /** The root is not a map, a key is not a string, a key repeats or is `__proto__`. */
    | 'root-shape'
    /** The root has no `characters` key, or its value is not an array. */
    | 'characters'
    /** Bytes after the root value, or a root value that stops short. */
    | 'trailing'
    /** A second gzip member. */
    | 'second-member'
    /** The gzip trailer's ISIZE differs from the inflated length. */
    | 'isize'
    /** The inflate failed or did not reach the end of its stream. */
    | 'inflate'
    /** The scanner or a msgpack element decode failed. */
    | 'decode'
    /** A block layout the incremental assembly cannot reproduce, or a block failure that ends the whole decode. */
    | 'blocks'

export interface BinStreamSink {
    /** One character in file order; `position` counts the characters handed out so far. */
    character(position: number, slot: unknown): void | Promise<void>
    /**
     * The decoded tree without its characters. A msgpack root carries `characters` as an empty array. A block root
     * carries `characters` only when the file holds a character block, as the whole decode leaves it.
     */
    root(root: Database): void | Promise<void>
    omitted(omitted: ReadonlyMap<string, SalvageOmittedBlock>): void | Promise<void>
}

export interface BinStreamOptions {
    /** Awaited after every chunk read and every character handed out; the module has no default. */
    yieldToMain: () => Promise<void>
    chunkBytes?: number
}

export interface BinStreamDone {
    /** CRC-32 of the entry's data bytes, as read. */
    crc: number
    /** The entry's data length, as read. */
    length: number
}

export interface BinStreamDecline {
    status: 'decline'
    reason: BinStreamDeclineReason
}

export const BIN_STREAM_CHUNK_BYTES = 4 * 1024 * 1024

const DATABASE_ENTRY_NAME = 'database.risudat'

/** Gunzip and DecompressionStream are fed this much at a time, which bounds what one input piece inflates to at once. */
const INFLATE_PUSH_BYTES = 64 * 1024

/** A root key longer than this is not one the format writes. */
const MAX_ROOT_KEY_BYTES = 4096

/** The gzip magic the 'compressed' header is followed by, and what is needed to read it after the 11-byte header. */
const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b
const COMPRESSED_PROBE_BYTES = MSGPACK_SAVE_HEADER_BYTES + 2

const TWO_POW_32 = 2 ** 32

const CHARACTERS_KEY_BYTES = (() => {
    const text = new TextEncoder().encode('characters')
    return Uint8Array.of(0xa0 | text.length, ...text)
})()
const EMPTY_ARRAY_BYTE = 0x90

class StreamDecline extends Error {
    constructor(readonly reason: BinStreamDeclineReason, cause?: unknown) {
        super(`The database entry is not streamable (${reason}).`, { cause })
        this.name = 'StreamDecline'
    }
}

/** Runs a decode step; whatever it throws is the entry's own shape failing, which is a decline of `reason`. */
function guarded<T>(reason: BinStreamDeclineReason, run: () => T): T {
    try {
        return run()
    } catch (error) {
        throw error instanceof StreamDecline ? error : new StreamDecline(reason, error)
    }
}

// ---- bytes ----

/** A growing byte buffer; `toBytes` hands out a copy that owns its memory. */
class ByteBuilder {
    private buffer: Uint8Array
    private used = 0

    constructor(private readonly initial = 256) {
        this.buffer = new Uint8Array(initial)
    }

    get length(): number {
        return this.used
    }

    append(source: Uint8Array, start: number, end: number): void {
        const count = end - start
        if (this.used + count > this.buffer.length) {
            let size = this.buffer.length
            while (size < this.used + count) {
                size *= 2
            }
            const grown = new Uint8Array(size)
            grown.set(this.buffer.subarray(0, this.used))
            this.buffer = grown
        }
        this.buffer.set(source.subarray(start, end), this.used)
        this.used += count
    }

    appendAll(source: Uint8Array): void {
        this.append(source, 0, source.length)
    }

    toBytes(): Uint8Array {
        return this.buffer.slice(0, this.used)
    }

    /** Empties the builder; a buffer that grew large is dropped so one big value does not stay held. */
    reset(): void {
        this.used = 0
        if (this.buffer.length > 1024 * 1024) {
            this.buffer = new Uint8Array(this.initial)
        }
    }
}

/** Bytes in arrival order, consumed from the front. */
class ByteQueue {
    private chunks: Uint8Array[] = []
    private head = 0
    available = 0

    push(bytes: Uint8Array): void {
        if (bytes.length > 0) {
            this.chunks.push(bytes)
            this.available += bytes.length
        }
    }

    /** The byte `index` places from the front; `index` is below `available`. */
    byteAt(index: number): number {
        let offset = this.head + index
        for (const chunk of this.chunks) {
            if (offset < chunk.length) {
                return chunk[offset]
            }
            offset -= chunk.length
        }
        throw new RangeError('The byte queue holds fewer bytes than asked for.')
    }

    /** The first `count` bytes as a copy, not consumed. */
    copy(count: number): Uint8Array {
        const out = new Uint8Array(count)
        let written = 0
        let index = 0
        let offset = this.head
        while (written < count) {
            const chunk = this.chunks[index]
            const take = Math.min(count - written, chunk.length - offset)
            out.set(chunk.subarray(offset, offset + take), written)
            written += take
            offset = 0
            index += 1
        }
        return out
    }

    /** Consumes `count` bytes from the front, appending them to `into` when given. */
    take(count: number, into: ByteBuilder | null): void {
        let left = count
        while (left > 0) {
            const chunk = this.chunks[0]
            const take = Math.min(left, chunk.length - this.head)
            if (into !== null) {
                into.append(chunk, this.head, this.head + take)
            }
            this.head += take
            left -= take
            if (this.head === chunk.length) {
                this.chunks.shift()
                this.head = 0
            }
        }
        this.available -= count
    }

    takeBytes(count: number): Uint8Array {
        const out = this.copy(count)
        this.take(count, null)
        return out
    }
}

// ---- msgpack ----

/** What the first `size` bytes of a value are: its header, the payload that follows and how many values it holds. */
interface ValueHead {
    size: number
    payload: number
    children: number
}

function unsignedAt(queue: ByteQueue, at: number, bytes: number): number {
    let value = 0
    for (let i = 0; i < bytes; i++) {
        value = value * 256 + queue.byteAt(at + i)
    }
    return value
}

/**
 * The header of the value whose first byte is `tag`, or null when more bytes are needed to read it. An extension type
 * other than 0 and 0xff declines: records, packed references, bundled strings and the like carry state across values.
 */
function describeValue(tag: number, queue: ByteQueue): ValueHead | null {
    if (tag <= 0x7f || tag >= 0xe0) return { size: 1, payload: 0, children: 0 }
    if (tag <= 0x8f) return { size: 1, payload: 0, children: 2 * (tag & 0x0f) }
    if (tag <= 0x9f) return { size: 1, payload: 0, children: tag & 0x0f }
    if (tag <= 0xbf) return { size: 1, payload: tag & 0x1f, children: 0 }
    const sized = (lengthBytes: number, children: number): ValueHead | null => {
        if (queue.available < 1 + lengthBytes) return null
        const length = unsignedAt(queue, 1, lengthBytes)
        return children === 0 ? { size: 1 + lengthBytes, payload: length, children: 0 } : { size: 1 + lengthBytes, payload: 0, children: length * children }
    }
    const fixed = (payload: number): ValueHead => ({ size: 1, payload, children: 0 })
    const fixedExt = (payload: number): ValueHead | null => {
        if (queue.available < 2) return null
        checkExtType(queue.byteAt(1))
        return { size: 2, payload, children: 0 }
    }
    const lengthExt = (lengthBytes: number): ValueHead | null => {
        if (queue.available < 2 + lengthBytes) return null
        checkExtType(queue.byteAt(1 + lengthBytes))
        return { size: 2 + lengthBytes, payload: unsignedAt(queue, 1, lengthBytes), children: 0 }
    }
    switch (tag) {
        case 0xc0: case 0xc2: case 0xc3: return fixed(0)
        case 0xc4: return sized(1, 0)
        case 0xc5: return sized(2, 0)
        case 0xc6: return sized(4, 0)
        case 0xc7: return lengthExt(1)
        case 0xc8: return lengthExt(2)
        case 0xc9: return lengthExt(4)
        case 0xca: return fixed(4)
        case 0xcb: return fixed(8)
        case 0xcc: case 0xd0: return fixed(1)
        case 0xcd: case 0xd1: return fixed(2)
        case 0xce: case 0xd2: return fixed(4)
        case 0xcf: case 0xd3: return fixed(8)
        case 0xd4: return fixedExt(1)
        case 0xd5: return fixedExt(2)
        case 0xd6: return fixedExt(4)
        case 0xd7: return fixedExt(8)
        case 0xd8: return fixedExt(16)
        case 0xd9: return sized(1, 0)
        case 0xda: return sized(2, 0)
        case 0xdb: return sized(4, 0)
        case 0xdc: return sized(2, 1)
        case 0xdd: return sized(4, 1)
        case 0xde: return sized(2, 2)
        case 0xdf: return sized(4, 2)
        default: throw new StreamDecline('decode')
    }
}

function checkExtType(type: number): void {
    if (type !== 0x00 && type !== 0xff) {
        throw new StreamDecline('ext')
    }
}

/** Walks one msgpack value by its lengths, copying its bytes into a builder, over input that arrives in pieces. */
class ValueSkipper {
    private items = 0
    private payload = 0

    begin(): void {
        this.items = 1
        this.payload = 0
    }

    /** Consumes what is available of the value; true once the value is complete. */
    advance(queue: ByteQueue, into: ByteBuilder): boolean {
        for (;;) {
            if (this.payload > 0) {
                const count = Math.min(this.payload, queue.available)
                if (count === 0) return false
                queue.take(count, into)
                this.payload -= count
                if (this.payload > 0) return false
            }
            if (this.items === 0) return true
            if (queue.available === 0) return false
            const head = describeValue(queue.byteAt(0), queue)
            if (head === null) return false
            queue.take(head.size, into)
            this.items += head.children - 1
            this.payload = head.payload
        }
    }
}

type ScanState = 'rootHeader' | 'key' | 'value' | 'charactersHeader' | 'element' | 'end'

/**
 * Reads a msgpack root map over input that arrives in pieces. `next` yields each `characters` element, decoded alone;
 * `finish` decodes everything else once, from a map synthesized in the original key order.
 */
class RootScanner {
    private readonly queue = new ByteQueue()
    private readonly skipper = new ValueSkipper()
    private readonly rootHeader = new ByteBuilder(16)
    private readonly prefix = new ByteBuilder(4096)
    private readonly suffix = new ByteBuilder(256)
    private readonly element = new ByteBuilder(4096)
    private readonly keys = new Set<string>()
    private state: ScanState = 'rootHeader'
    private pairsLeft = 0
    private elementsLeft = 0
    private charactersSeen = false

    constructor(private readonly decodeValue: (bytes: Uint8Array) => unknown) {}

    feed(bytes: Uint8Array): void {
        this.queue.push(bytes)
    }

    private section(): ByteBuilder {
        return this.charactersSeen ? this.suffix : this.prefix
    }

    private pairDone(): void {
        this.pairsLeft -= 1
        this.state = this.pairsLeft === 0 ? 'end' : 'key'
    }

    /** The next completed character, or null when more bytes are needed or the root is complete. */
    next(): { slot: unknown } | null {
        const queue = this.queue
        for (;;) {
            switch (this.state) {
                case 'rootHeader': {
                    if (queue.available < 1) return null
                    const tag = queue.byteAt(0)
                    let size: number
                    let count: number
                    if (tag >= 0x80 && tag <= 0x8f) {
                        size = 1
                        count = tag & 0x0f
                    } else if (tag === 0xde) {
                        size = 3
                        if (queue.available < size) return null
                        count = unsignedAt(queue, 1, 2)
                    } else if (tag === 0xdf) {
                        size = 5
                        if (queue.available < size) return null
                        count = unsignedAt(queue, 1, 4)
                    } else {
                        throw new StreamDecline('root-shape')
                    }
                    queue.take(size, this.rootHeader)
                    this.pairsLeft = count
                    this.state = count === 0 ? 'end' : 'key'
                    break
                }
                case 'key': {
                    if (queue.available < 1) return null
                    const tag = queue.byteAt(0)
                    let headerSize: number
                    if (tag >= 0xa0 && tag <= 0xbf) headerSize = 1
                    else if (tag === 0xd9) headerSize = 2
                    else if (tag === 0xda) headerSize = 3
                    else if (tag === 0xdb) headerSize = 5
                    else throw new StreamDecline('root-shape')
                    if (queue.available < headerSize) return null
                    const length = headerSize === 1 ? tag & 0x1f : unsignedAt(queue, 1, headerSize - 1)
                    if (length > MAX_ROOT_KEY_BYTES) throw new StreamDecline('root-shape')
                    if (queue.available < headerSize + length) return null
                    const raw = queue.copy(headerSize + length)
                    const key = new TextDecoder().decode(raw.subarray(headerSize))
                    if (key === '__proto__' || this.keys.has(key)) throw new StreamDecline('root-shape')
                    this.keys.add(key)
                    if (key === 'characters') {
                        queue.take(headerSize + length, null)
                        this.charactersSeen = true
                        this.state = 'charactersHeader'
                    } else {
                        queue.take(headerSize + length, this.section())
                        this.skipper.begin()
                        this.state = 'value'
                    }
                    break
                }
                case 'value': {
                    if (!this.skipper.advance(queue, this.section())) return null
                    this.pairDone()
                    break
                }
                case 'charactersHeader': {
                    if (queue.available < 1) return null
                    const tag = queue.byteAt(0)
                    let size: number
                    let count: number
                    if (tag >= 0x90 && tag <= 0x9f) {
                        size = 1
                        count = tag & 0x0f
                    } else if (tag === 0xdc) {
                        size = 3
                        if (queue.available < size) return null
                        count = unsignedAt(queue, 1, 2)
                    } else if (tag === 0xdd) {
                        size = 5
                        if (queue.available < size) return null
                        count = unsignedAt(queue, 1, 4)
                    } else {
                        throw new StreamDecline('characters')
                    }
                    queue.take(size, null)
                    this.elementsLeft = count
                    if (count === 0) {
                        this.pairDone()
                    } else {
                        this.skipper.begin()
                        this.state = 'element'
                    }
                    break
                }
                case 'element': {
                    if (!this.skipper.advance(queue, this.element)) return null
                    const bytes = this.element.toBytes()
                    this.element.reset()
                    const slot = guarded('decode', () => this.decodeValue(bytes))
                    this.elementsLeft -= 1
                    if (this.elementsLeft === 0) {
                        this.pairDone()
                    } else {
                        this.skipper.begin()
                    }
                    return { slot }
                }
                case 'end':
                    if (queue.available > 0) throw new StreamDecline('trailing')
                    return null
            }
        }
    }

    /** The root without its characters. Declines when the root value did not end, or held no `characters` array. */
    finish(): Database {
        if (this.state !== 'end') throw new StreamDecline('trailing')
        if (!this.charactersSeen) throw new StreamDecline('characters')
        const synthesized = new ByteBuilder(this.rootHeader.length + this.prefix.length + this.suffix.length + 16)
        synthesized.appendAll(this.rootHeader.toBytes())
        synthesized.appendAll(this.prefix.toBytes())
        synthesized.appendAll(CHARACTERS_KEY_BYTES)
        synthesized.appendAll(Uint8Array.of(EMPTY_ARRAY_BYTE))
        synthesized.appendAll(this.suffix.toBytes())
        const bytes = synthesized.toBytes()
        const root = guarded('decode', () => this.decodeValue(bytes))
        if (typeof root !== 'object' || root === null || Array.isArray(root)) throw new StreamDecline('root-shape')
        return root as Database
    }
}

// ---- consumers ----

interface EntryTrailer {
    /** The last four bytes of the entry, or fewer when the entry is shorter. */
    tail: Uint8Array
}

/** One format's reading of the entry's bytes, fed in order. */
interface EntryConsumer {
    push(bytes: Uint8Array, last: boolean): Promise<void>
    finish(trailer: EntryTrailer): Promise<void>
    /** Stops any open stream after a failed read; never throws. */
    dispose(): void
}

type MsgpackKind = 'raw' | 'compressed' | 'stream'

function noop(): void {}

class MsgpackConsumer implements EntryConsumer {
    private readonly scanner: RootScanner
    private position = 0
    private skipBytes = MSGPACK_SAVE_HEADER_BYTES
    private gzipChecked = false
    private inflatedTotal = 0

    private gunzip: fflate.Gunzip | null = null
    private gunzipOut: Uint8Array[] = []
    private gunzipFinal = false
    private secondMember = false

    private writer: WritableStreamDefaultWriter<BufferSource> | null = null
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    private pump: Promise<void> | null = null
    private pumpFailure: unknown = null
    private pumpFailed = false

    constructor(
        private readonly kind: MsgpackKind,
        private readonly sink: BinStreamSink,
        private readonly yieldToMain: () => Promise<void>,
    ) {
        this.scanner = new RootScanner(kind === 'compressed' ? decodeMsgpackDefault : decodeMsgpackInt64Number)
    }

    async push(bytes: Uint8Array, last: boolean): Promise<void> {
        if (this.skipBytes > 0) {
            const count = Math.min(this.skipBytes, bytes.length)
            bytes = bytes.subarray(count)
            this.skipBytes -= count
        }
        if (this.kind === 'raw') {
            await this.feedInflated(bytes)
            return
        }
        if (!this.gzipChecked) {
            if (this.kind === 'compressed' && (bytes.length < 2 || bytes[0] !== GZIP_MAGIC_0 || bytes[1] !== GZIP_MAGIC_1)) {
                throw new StreamDecline('not-gzip')
            }
            this.gzipChecked = true
        }
        if (this.kind === 'compressed') {
            await this.pushGunzip(bytes, last)
        } else {
            await this.pushStream(bytes)
        }
    }

    private async pushGunzip(bytes: Uint8Array, last: boolean): Promise<void> {
        if (this.gunzip === null) {
            const gunzip = new fflate.Gunzip((data, final) => {
                this.gunzipOut.push(data)
                this.inflatedTotal += data.length
                if (final) this.gunzipFinal = true
            })
            gunzip.onmember = () => {
                this.secondMember = true
            }
            this.gunzip = gunzip
        }
        const gunzip = this.gunzip
        let at = 0
        do {
            const end = Math.min(at + INFLATE_PUSH_BYTES, bytes.length)
            const final = last && end === bytes.length
            guarded('inflate', () => gunzip.push(bytes.subarray(at, end), final))
            if (this.secondMember) throw new StreamDecline('second-member')
            const produced = this.gunzipOut
            this.gunzipOut = []
            for (const piece of produced) {
                await this.feedInflated(piece)
            }
            at = end
        } while (at < bytes.length)
    }

    private async pushStream(bytes: Uint8Array): Promise<void> {
        if (this.writer === null) {
            await checkCompressionStreams()
            const stream = new DecompressionStream('gzip')
            this.writer = stream.writable.getWriter()
            this.reader = stream.readable.getReader()
            this.pump = this.runPump(this.reader, this.writer)
        }
        const writer = this.writer
        for (let at = 0; at < bytes.length; at += INFLATE_PUSH_BYTES) {
            try {
                await writer.write(bytes.subarray(at, Math.min(at + INFLATE_PUSH_BYTES, bytes.length)) as BufferSource)
            } catch (error) {
                await this.pump
                throw this.pumpFailed ? this.pumpFailure : new StreamDecline('inflate', error)
            }
        }
    }

    /**
     * Reads the inflated bytes and feeds them to the scanner; the next read waits for the sink, which holds the
     * stream's backpressure on the writing side. Never rejects: a failure is kept, and the writer is aborted so that
     * a pending write ends.
     */
    private async runPump(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<BufferSource>): Promise<void> {
        const fail = (error: unknown) => {
            this.pumpFailed = true
            this.pumpFailure = error
            writer.abort(error).catch(noop)
            reader.cancel().catch(noop)
        }
        for (;;) {
            let result: ReadableStreamReadResult<Uint8Array>
            try {
                result = await reader.read()
            } catch (error) {
                fail(new StreamDecline('inflate', error))
                return
            }
            if (result.done) return
            this.inflatedTotal += result.value.length
            try {
                await this.feedInflated(result.value)
            } catch (error) {
                fail(error)
                return
            }
        }
    }

    private async feedInflated(bytes: Uint8Array): Promise<void> {
        this.scanner.feed(bytes)
        for (;;) {
            const event = this.scanner.next()
            if (event === null) return
            await this.sink.character(this.position, event.slot)
            this.position += 1
            await this.yieldToMain()
        }
    }

    async finish(trailer: EntryTrailer): Promise<void> {
        if (this.kind === 'compressed') {
            if (!this.gzipChecked) throw new StreamDecline('not-gzip')
            if (!this.gunzipFinal) throw new StreamDecline('inflate')
        } else if (this.kind === 'stream') {
            if (this.writer === null || this.pump === null) throw new StreamDecline('inflate')
            try {
                await this.writer.close()
            } catch (error) {
                await this.pump
                throw this.pumpFailed ? this.pumpFailure : new StreamDecline('inflate', error)
            }
            await this.pump
            if (this.pumpFailed) throw this.pumpFailure
        }
        if (this.kind !== 'raw') {
            if (trailer.tail.length < 4) throw new StreamDecline('isize')
            const isize = new DataView(trailer.tail.buffer, trailer.tail.byteOffset, 4).getUint32(0, true)
            if (isize !== this.inflatedTotal % TWO_POW_32) throw new StreamDecline('isize')
        }
        const root = this.scanner.finish()
        await this.sink.root(root)
        await this.sink.omitted(new Map())
    }

    dispose(): void {
        if (this.writer !== null) this.writer.abort().catch(noop)
        if (this.reader !== null) this.reader.cancel().catch(noop)
    }
}

/** A block's payload inflated the way `RisuSaveDecoder` inflates it. */
async function gunzipBlock(payload: Uint8Array): Promise<Uint8Array> {
    await checkCompressionStreams()
    const stream = new DecompressionStream('gzip')
    const writer = stream.writable.getWriter()
    // A payload that is not valid gzip errors the stream; the failure reaches the read below.
    writer.write(payload as BufferSource).catch(noop)
    writer.close().catch(noop)
    return new Uint8Array(await new Response(stream.readable).arrayBuffer())
}

type BlockStage = 'fileHeader' | 'blockHeader' | 'payload'

class BlocksConsumer implements EntryConsumer {
    private readonly queue = new ByteQueue()
    private readonly blocks: DecodedBlock[] = []
    private readonly loadedBlocks = new Set<string>()
    private decoder: RisuSaveDecoder | null = null
    private hasChecksums = false
    private stage: BlockStage = 'fileHeader'
    private consumed = 0
    private kvBlockSeen = false
    private rootCount = 0
    private position = 0
    private pending: ReturnType<typeof parseBlockHeader> | null = null

    constructor(
        private readonly dataLength: number,
        private readonly sink: BinStreamSink,
        private readonly yieldToMain: () => Promise<void>,
    ) {}

    async push(bytes: Uint8Array, last: boolean): Promise<void> {
        this.queue.push(bytes)
        while (await this.step()) {
            // Each step consumes a header or a block.
        }
        if (last && this.queue.available > 0) throw new StreamDecline('blocks')
    }

    private async step(): Promise<boolean> {
        const queue = this.queue
        switch (this.stage) {
            case 'fileHeader': {
                if (queue.available < 9) return false
                const header = queue.takeBytes(9)
                this.consumed += 9
                const version = header[8]
                if (version !== 0 && version !== 1) throw new StreamDecline('blocks')
                this.hasChecksums = version === 1
                this.decoder = new RisuSaveDecoder(this.hasChecksums, false, true)
                this.stage = 'blockHeader'
                return true
            }
            case 'blockHeader': {
                if (queue.available < 3) return false
                const headerSize = 3 + queue.byteAt(2) + 4 + (this.hasChecksums ? 4 : 0)
                if (queue.available < headerSize) return false
                const bytes = queue.takeBytes(headerSize)
                this.consumed += headerSize
                const header = guarded('blocks', () => parseBlockHeader(bytes, 0, this.hasChecksums))
                if (header.type === RisuSaveType.REMOTE || header.type === RisuSaveType.ROOT_COMPONENT) throw new StreamDecline('blocks')
                if (header.type === RisuSaveType.ROOT) {
                    this.rootCount += 1
                    if (this.rootCount > 1) throw new StreamDecline('blocks')
                }
                if (header.type === RisuSaveType.KV && header.name.startsWith(KV_BLOCK_PREFIX)) this.kvBlockSeen = true
                if (header.length > this.dataLength - this.consumed) throw new StreamDecline('blocks')
                this.pending = header
                this.stage = 'payload'
                return true
            }
            case 'payload': {
                const header = this.pending
                if (header === null) throw new StreamDecline('blocks')
                // A checksum cut short by the end of the entry is read zero-padded, as the whole decode reads it.
                const checksumBytes = this.hasChecksums ? Math.min(4, this.dataLength - this.consumed - header.length) : 0
                if (queue.available < header.length + checksumBytes) return false
                const payload = queue.takeBytes(header.length)
                const stored = new Uint8Array(4)
                stored.set(queue.takeBytes(checksumBytes))
                this.consumed += header.length + checksumBytes
                this.pending = null
                this.stage = 'blockHeader'
                await this.acceptBlock(header, payload, readU32le(stored, 0))
                return true
            }
        }
    }

    /** One block's pass over the whole decode's first half: checksum, inflate, text; then a character is handed out. */
    private async acceptBlock(header: ReturnType<typeof parseBlockHeader>, payload: Uint8Array, storedChecksum: number): Promise<void> {
        const decoder = this.decoder
        if (decoder === null) throw new StreamDecline('blocks')
        const { type, compression, name } = header
        let content: string
        try {
            if (this.hasChecksums) {
                const actual = crc32(payload)
                if (actual !== storedChecksum) {
                    throw new Error(`Data checksum mismatch for block "${name}" (type ${type}): expected ${storedChecksum}, got ${actual} — this block's content is corrupted.`)
                }
            }
            const data = compression ? await gunzipBlock(payload) : payload
            content = new TextDecoder().decode(data)
        } catch (error) {
            decoder.recordOmitted(name, salvageKindOfType(type), error)
            return
        }
        this.loadedBlocks.add(name)
        const block: DecodedBlock = { name, type, compression, content }
        this.blocks.push(block)
        if (type !== RisuSaveType.CHARACTER_WITH_CHAT && type !== RisuSaveType.CHARACTER_WITHOUT_CHAT) {
            return
        }
        let slot: unknown
        try {
            slot = JSON.parse(content)
        } catch (failure) {
            block.delivered = { failure }
            block.content = ''
            return
        }
        block.delivered = {}
        block.content = ''
        await this.sink.character(this.position, slot)
        this.position += 1
        await this.yieldToMain()
    }

    async finish(): Promise<void> {
        const decoder = this.decoder
        if (decoder === null || this.stage !== 'blockHeader' || this.queue.available > 0) throw new StreamDecline('blocks')
        const root = this.blocks.find((block) => block.type === RisuSaveType.ROOT)
        if (root === undefined) throw new StreamDecline('blocks')
        guarded('blocks', () => {
            const parsed: unknown = JSON.parse(root.content)
            if (typeof parsed === 'object' && parsed !== null && Object.hasOwn(parsed, 'characters')) {
                throw new StreamDecline('blocks')
            }
        })
        let db: Database
        try {
            db = await decoder.assembleBlocks(this.blocks, this.loadedBlocks, this.kvBlockSeen)
        } catch (error) {
            throw new StreamDecline('blocks', error)
        }
        await this.sink.root(db)
        await this.sink.omitted(decoder.omitted)
    }

    dispose(): void {}
}

// ---- the entry ----

/** The entry's header, read again and checked against the walk. Throws `BinFileChangedError`. */
async function readIndexedHeader(file: BinFile, entry: BackupIndexEntry): Promise<void> {
    let bytes: Uint8Array
    try {
        bytes = new Uint8Array(await file.slice(entry.headerOffset, entry.headerOffset + entry.headerLength).arrayBuffer())
    } catch (error) {
        throw new BinFileChangedError('unreadable', DATABASE_ENTRY_NAME, { cause: error })
    }
    if (bytes.length !== entry.headerLength) {
        throw new BinFileChangedError('length', DATABASE_ENTRY_NAME)
    }
    const parsed = parseBackupEntryHeader(bytes)
    if (parsed.status !== 'ok' || parsed.header.name === undefined) {
        throw new BinFileChangedError('header', DATABASE_ENTRY_NAME)
    }
    const header = parsed.header
    if (header.name === BACKUP_ENCRYPTION_MARKER_NAME) {
        throw new BinFileChangedError('marker', header.name)
    }
    if (header.nameLength !== entry.nameLength || header.dataLength !== entry.dataLength || header.headerLength !== entry.headerLength) {
        throw new BinFileChangedError('header', header.name)
    }
    if (header.name !== DATABASE_ENTRY_NAME) {
        throw new BinFileChangedError('header', header.name)
    }
}

async function readChunk(file: BinFile, start: number, length: number): Promise<Uint8Array> {
    let bytes: Uint8Array
    try {
        bytes = new Uint8Array(await file.slice(start, start + length).arrayBuffer())
    } catch (error) {
        throw new BinFileChangedError('unreadable', DATABASE_ENTRY_NAME, { cause: error })
    }
    if (bytes.length !== length) {
        throw new BinFileChangedError('length', DATABASE_ENTRY_NAME)
    }
    return bytes
}

function createConsumer(bytes: Uint8Array, dataLength: number, sink: BinStreamSink, yieldToMain: () => Promise<void>): EntryConsumer {
    const header = checkHeader(bytes)
    switch (header) {
        case 'raw':
        case 'compressed':
        case 'stream':
            return new MsgpackConsumer(header, sink, yieldToMain)
        case 'risusave':
            return new BlocksConsumer(dataLength, sink, yieldToMain)
        default:
            throw new StreamDecline('format')
    }
}

/**
 * Streams the database entry of a `.bin` once through `sink` (see the module comment). Declines with a reason when the
 * entry is not one whose streamed value is the whole decode's; throws `BinFileChangedError` when the file is not what
 * the walk indexed. A decline can follow calls to `sink.character`; the caller discards what it received.
 */
export async function streamBinDatabase(file: BinFile, entry: BackupIndexEntry, sink: BinStreamSink, options: BinStreamOptions): Promise<BinStreamDone | BinStreamDecline> {
    const chunkBytes = options.chunkBytes ?? BIN_STREAM_CHUNK_BYTES
    const yieldToMain = options.yieldToMain
    await readIndexedHeader(file, entry)
    const start = entry.headerOffset + entry.headerLength
    const end = start + entry.dataLength
    let consumer: EntryConsumer | null = null
    try {
        const first = new ByteBuilder(64)
        let crc = CRC32_INIT
        let tail: Uint8Array = new Uint8Array(0)
        for (let at = start; at < end; at += chunkBytes) {
            const length = Math.min(chunkBytes, end - at)
            const last = at + length >= end
            const chunk = await readChunk(file, at, length)
            crc = crc32Update(crc, chunk)
            tail = chunk.length >= 4 ? chunk.slice(chunk.length - 4) : Uint8Array.from([...tail, ...chunk]).slice(-4)
            if (consumer === null) {
                first.appendAll(chunk)
                if (first.length >= COMPRESSED_PROBE_BYTES || last) {
                    const head = first.toBytes()
                    consumer = createConsumer(head, entry.dataLength, sink, yieldToMain)
                    await consumer.push(head, last)
                }
            } else {
                await consumer.push(chunk, last)
            }
            await yieldToMain()
        }
        if (consumer === null) {
            throw new StreamDecline('format')
        }
        await consumer.finish({ tail })
        return { crc: crc32Final(crc), length: entry.dataLength }
    } catch (error) {
        if (error instanceof StreamDecline) {
            return { status: 'decline', reason: error.reason }
        }
        throw error
    } finally {
        consumer?.dispose()
    }
}
