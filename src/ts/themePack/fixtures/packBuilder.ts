// Test and golden-generator builder of `.risutheme` archives (not part of the app bundle).
//
// Two writers share this file. `zipPack` builds an ordinary valid pack with fflate `zipSync`, the app's own zip writer
// family, with a fixed DOS time so the same inputs always give the same bytes. `buildRawZip` writes local headers, data,
// central records and end records field by field, so a hostile archive can carry any value a writer could put there:
// raw name bytes, flags, methods, lying declared sizes, offsets, extra blocks, gaps, a prefix, data descriptors, a ZIP64
// end record and locator, and an end record inside the comment.
import { deflateSync, zipSync, type Zippable } from 'fflate'
import { RtbCouldNotReadError, type RangeSource } from '../../drive/rtb/rangeSource'

const encoder = new TextEncoder()

export function utf8(text: string): Uint8Array {
    return encoder.encode(text)
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = (c & 1) !== 0 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
        }
        table[n] = c >>> 0
    }
    return table
})()

/** CRC-32 (IEEE), written here so the fixtures do not depend on the reader's own implementation. */
export function crc32(bytes: Uint8Array): number {
    let crc = 0xFFFFFFFF
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
    }
    return (crc ^ 0xFFFFFFFF) >>> 0
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

/** A real 1x1 PNG. */
export const PNG_1X1 = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
)

/** A synthetic font: the woff2 magic and padding, not a real font. */
export function fakeFont(magic = 'wOF2'): Uint8Array {
    const out = new Uint8Array(32)
    out.set(utf8(magic), 0)
    return out
}

/** A chat sheet the real judge accepts, naming one bundled image. */
export const CHAT_SHEET = '[data-part="chat-message-avatar"]{background-image:url(images/a.png)}'
/** A chat sheet the real judge accepts and that names nothing. */
export const PLAIN_CHAT_SHEET = '[data-part="chat-message-avatar"]{opacity:1}'

export function manifestText(overrides: Readonly<Record<string, unknown>> = {}, removed: readonly string[] = []): string {
    const base: Record<string, unknown> = {
        kind: 'risutheme',
        format: 1,
        name: 'Test Pack',
        version: '1.0.0',
        license: 'MIT',
        attribution: 'Test author',
        modes: ['dark'],
    }
    for (const key of removed) {
        delete base[key]
    }
    return JSON.stringify({ ...base, ...overrides })
}

export type PackFile = string | Uint8Array | { readonly data: string | Uint8Array; readonly stored: true }

function bytesOf(data: string | Uint8Array): Uint8Array {
    return typeof data === 'string' ? utf8(data) : data
}

/** Local-field DOS time, so the stored time is the same in every time zone. */
export const FIXED_MTIME = new Date(1980, 0, 1, 0, 0, 0)

/** An ordinary valid archive over fflate `zipSync`, deflate level 9 (stored for a `{ stored: true }` file). */
export function zipPack(files: Readonly<Record<string, PackFile>>): Uint8Array {
    const zippable: Zippable = {}
    for (const [name, file] of Object.entries(files)) {
        if (typeof file === 'string' || file instanceof Uint8Array) {
            zippable[name] = [bytesOf(file), { level: 9, mtime: FIXED_MTIME }]
        } else {
            zippable[name] = [bytesOf(file.data), { level: 0, mtime: FIXED_MTIME }]
        }
    }
    return zipSync(zippable)
}

/** The smallest valid pack files; a test overrides or adds entries. */
export function validPackFiles(extra: Readonly<Record<string, PackFile>> = {}): Record<string, PackFile> {
    return {
        'manifest.json': manifestText(),
        'chat.css': PLAIN_CHAT_SHEET,
        ...extra,
    }
}

export interface RawEntry {
    /** A string is UTF-8 encoded; raw bytes are written as they are. */
    readonly name: string | Uint8Array
    /** The uncompressed body (default empty). */
    readonly data?: Uint8Array
    /** Default 8. Method 8 deflates `data`; any other method writes `data` as the payload. */
    readonly method?: number
    /** The compressed bytes exactly as written, replacing the computed payload. */
    readonly payload?: Uint8Array
    readonly flags?: number
    /** Declared values, written to the local and central records in place of the true ones. */
    readonly crc?: number
    readonly compressedSize?: number
    readonly uncompressedSize?: number
    /** High byte is the host system, low byte the version (default 20). */
    readonly versionMadeBy?: number
    readonly externalAttributes?: number
    readonly centralExtra?: Uint8Array
    readonly localExtra?: Uint8Array
    /** Flag 0x0008: local sizes and CRC are zero and a 16-byte descriptor follows the data. */
    readonly dataDescriptor?: boolean
    /** Bytes written between this entry's data and whatever follows. */
    readonly gapAfter?: Uint8Array
    /** The central record points at the local header of entry `k` and this entry writes no local record. */
    readonly sharesLocalOf?: number
    readonly diskStart?: number
    readonly localOffset?: number
    /** The name written in the local header when it differs from the central record's. */
    readonly localName?: string | Uint8Array
}

/** One extra-field block: id, length, data. */
export function extraBlock(id: number, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + data.length)
    new DataView(out.buffer).setUint16(0, id, true)
    new DataView(out.buffer).setUint16(2, data.length, true)
    out.set(data, 4)
    return out
}

/** A ZIP64 extra block holding an uncompressed size and a compressed size. */
export function zip64SizesBlock(uncompressed: number, compressed: number): Uint8Array {
    const data = new Uint8Array(16)
    new DataView(data.buffer).setBigUint64(0, BigInt(uncompressed), true)
    new DataView(data.buffer).setBigUint64(8, BigInt(compressed), true)
    return extraBlock(0x0001, data)
}

export interface ZipLayout {
    readonly localOffsets: readonly number[]
    readonly directoryOffset: number
    readonly directorySize: number
    readonly size: number
}

export interface RawZipOptions {
    /** Bytes before the first local header; offsets stay absolute. */
    readonly prefix?: Uint8Array
    readonly gapBeforeDirectory?: Uint8Array
    /** Bytes inside the declared directory after the last central record. */
    readonly directoryTail?: Uint8Array
    /** Bytes between the central directory and the first end structure. */
    readonly gapBeforeEnd?: Uint8Array
    readonly zip64End?: boolean
    readonly locator?: boolean
    /** The classic end record carries 0xFFFF and 0xFFFFFFFF sentinels. */
    readonly sentinels?: boolean
    readonly endEntries?: number
    readonly comment?: Uint8Array | ((layout: ZipLayout) => Uint8Array)
}

const SIG_LOCAL = 0x04034B50
const SIG_CENTRAL = 0x02014B50
const SIG_END = 0x06054B50
const SIG_ZIP64_END = 0x06064B50
const SIG_ZIP64_LOCATOR = 0x07064B50
const SIG_DESCRIPTOR = 0x08074B50
const DOS_DATE_1980 = 0x0021

class Writer {
    private readonly parts: Uint8Array[] = []
    length = 0

    bytes(bytes: Uint8Array): void {
        this.parts.push(bytes)
        this.length += bytes.length
    }

    u16(value: number): void {
        this.bytes(Uint8Array.of(value & 0xFF, (value >>> 8) & 0xFF))
    }

    u32(value: number): void {
        this.bytes(Uint8Array.of(value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF))
    }

    u64(value: number): void {
        this.u32(value % 0x100000000)
        this.u32(Math.floor(value / 0x100000000))
    }

    done(): Uint8Array {
        return concat(...this.parts)
    }
}

function isAscii(bytes: Uint8Array): boolean {
    return bytes.every((byte) => byte < 0x80)
}

/** An end-of-central-directory record, for the end of an archive and for one placed inside a comment. */
export function endRecordBytes(fields: { entries: number; directorySize: number; directoryOffset: number; comment?: Uint8Array }): Uint8Array {
    const writer = new Writer()
    const comment = fields.comment ?? new Uint8Array(0)
    writer.u32(SIG_END)
    writer.u16(0)
    writer.u16(0)
    writer.u16(fields.entries)
    writer.u16(fields.entries)
    writer.u32(fields.directorySize)
    writer.u32(fields.directoryOffset)
    writer.u16(comment.length)
    writer.bytes(comment)
    return writer.done()
}

export function buildRawZipDetailed(entries: readonly RawEntry[], options: RawZipOptions = {}): { bytes: Uint8Array; layout: ZipLayout } {
    const out = new Writer()
    if (options.prefix) out.bytes(options.prefix)
    const localOffsets: number[] = []
    const central = new Writer()
    interface Prepared { entry: RawEntry; name: Uint8Array; method: number; flags: number; crc: number; compressedSize: number; uncompressedSize: number }
    const prepared: Prepared[] = []

    for (const entry of entries) {
        const name = typeof entry.name === 'string' ? utf8(entry.name) : entry.name
        const data = entry.data ?? new Uint8Array(0)
        const method = entry.method ?? 8
        const payload = entry.payload ?? (method === 8 ? deflateSync(data, { level: 9 }) : data)
        const flags = (entry.flags ?? 0) | (entry.dataDescriptor ? 0x0008 : 0) | (isAscii(name) ? 0 : 0x0800)
        const crc = entry.crc ?? crc32(data)
        const compressedSize = entry.compressedSize ?? payload.length
        const uncompressedSize = entry.uncompressedSize ?? data.length
        prepared.push({ entry, name, method, flags, crc, compressedSize, uncompressedSize })

        if (entry.sharesLocalOf !== undefined) {
            localOffsets.push(localOffsets[entry.sharesLocalOf])
            continue
        }
        localOffsets.push(out.length)
        const extra = entry.localExtra ?? new Uint8Array(0)
        const localName = entry.localName === undefined ? name : typeof entry.localName === 'string' ? utf8(entry.localName) : entry.localName
        out.u32(SIG_LOCAL)
        out.u16(20)
        out.u16(flags)
        out.u16(method)
        out.u16(0)
        out.u16(DOS_DATE_1980)
        out.u32(entry.dataDescriptor ? 0 : crc)
        out.u32(entry.dataDescriptor ? 0 : compressedSize)
        out.u32(entry.dataDescriptor ? 0 : uncompressedSize)
        out.u16(localName.length)
        out.u16(extra.length)
        out.bytes(localName)
        out.bytes(extra)
        out.bytes(payload)
        if (entry.dataDescriptor) {
            out.u32(SIG_DESCRIPTOR)
            out.u32(crc)
            out.u32(compressedSize)
            out.u32(uncompressedSize)
        }
        if (entry.gapAfter) out.bytes(entry.gapAfter)
    }

    if (options.gapBeforeDirectory) out.bytes(options.gapBeforeDirectory)
    const directoryOffset = out.length
    prepared.forEach((item, i) => {
        const extra = item.entry.centralExtra ?? new Uint8Array(0)
        central.u32(SIG_CENTRAL)
        central.u16(item.entry.versionMadeBy ?? 20)
        central.u16(20)
        central.u16(item.flags)
        central.u16(item.method)
        central.u16(0)
        central.u16(DOS_DATE_1980)
        central.u32(item.crc)
        central.u32(item.compressedSize)
        central.u32(item.uncompressedSize)
        central.u16(item.name.length)
        central.u16(extra.length)
        central.u16(0)
        central.u16(item.entry.diskStart ?? 0)
        central.u16(0)
        central.u32(item.entry.externalAttributes ?? 0)
        central.u32(item.entry.localOffset ?? localOffsets[i])
        central.bytes(item.name)
        central.bytes(extra)
    })
    if (options.directoryTail) central.bytes(options.directoryTail)
    out.bytes(central.done())
    const directorySize = out.length - directoryOffset
    if (options.gapBeforeEnd) out.bytes(options.gapBeforeEnd)

    const zip64EndOffset = out.length
    if (options.zip64End) {
        out.u32(SIG_ZIP64_END)
        out.u64(44)
        out.u16(45)
        out.u16(45)
        out.u32(0)
        out.u32(0)
        out.u64(entries.length)
        out.u64(entries.length)
        out.u64(directorySize)
        out.u64(directoryOffset)
    }
    if (options.locator) {
        out.u32(SIG_ZIP64_LOCATOR)
        out.u32(0)
        out.u64(options.zip64End ? zip64EndOffset : 0)
        out.u32(1)
    }
    const sizeBeforeEnd = out.length
    const layout: ZipLayout = { localOffsets, directoryOffset, directorySize, size: 0 }
    const comment = typeof options.comment === 'function' ? options.comment({ ...layout, size: sizeBeforeEnd }) : options.comment
    const sentinels = options.sentinels === true
    out.bytes(endRecordBytes({
        entries: sentinels ? 0xFFFF : options.endEntries ?? entries.length,
        directorySize: sentinels ? 0xFFFFFFFF : directorySize,
        directoryOffset: sentinels ? 0xFFFFFFFF : directoryOffset,
        comment,
    }))
    const bytes = out.done()
    return { bytes, layout: { ...layout, size: bytes.length } }
}

export function buildRawZip(entries: readonly RawEntry[], options: RawZipOptions = {}): Uint8Array {
    return buildRawZipDetailed(entries, options).bytes
}

export interface ReadRecord { readonly offset: number; readonly length: number }
export interface SpySource extends RangeSource { readonly reads: ReadRecord[] }

/** A range source over bytes that records every read. Mutating `bytes` afterwards changes what later reads return. */
export function spySource(bytes: Uint8Array): SpySource {
    const reads: ReadRecord[] = []
    return {
        size: bytes.length,
        reads,
        async read(offset, length) {
            reads.push({ offset, length })
            if (offset < 0 || length < 0 || offset + length > bytes.length) {
                throw new RtbCouldNotReadError(`read of ${length} at ${offset} is outside the file`, offset, length)
            }
            return bytes.subarray(offset, offset + length)
        },
    }
}

/** A source that throws `error` for every read the predicate selects. */
export function failingSource(bytes: Uint8Array, selects: (offset: number, length: number) => boolean, error: Error): RangeSource {
    return {
        size: bytes.length,
        async read(offset, length) {
            if (selects(offset, length)) {
                throw error
            }
            return bytes.subarray(offset, offset + length)
        },
    }
}

/** A source of a given size whose reads fail the test: the size bound must be decided before any read. */
export function unreadableSource(size: number): SpySource {
    const reads: ReadRecord[] = []
    return {
        size,
        reads,
        async read(offset, length) {
            reads.push({ offset, length })
            throw new Error(`unexpected read of ${length} bytes at ${offset}`)
        },
    }
}

/**
 * The reads that are neither a tail read nor inside the central directory. A tail read is exactly the last
 * min(size, tailBytes) bytes; at most two are expected (the peek's and the reader's).
 */
export function readsOutsideTailAndDirectory(reads: readonly ReadRecord[], layout: ZipLayout, tailBytes: number): ReadRecord[] {
    const tailLength = Math.min(layout.size, tailBytes)
    return reads.filter((read) => {
        const isTail = read.offset === layout.size - tailLength && read.length === tailLength
        const inDirectory = read.offset >= layout.directoryOffset && read.offset + read.length <= layout.directoryOffset + layout.directorySize
        return !isTail && !inDirectory
    })
}

export function tailReads(reads: readonly ReadRecord[], size: number, tailBytes: number): ReadRecord[] {
    const tailLength = Math.min(size, tailBytes)
    return reads.filter((read) => read.offset === size - tailLength && read.length === tailLength)
}

/**
 * Four bytes appended to the end of `body` that make its CRC-32 equal `target`: the standard solve for a stored entry
 * whose head was changed and whose declared CRC must stay equal.
 */
export function crcPatch(body: Uint8Array, target: number): Uint8Array {
    // State after `body`, then solve the four bytes that drive the register to the state `target` finalises from.
    let state = 0xFFFFFFFF
    for (const byte of body) {
        state = CRC_TABLE[(state ^ byte) & 0xFF] ^ (state >>> 8)
    }
    const wanted = (target ^ 0xFFFFFFFF) >>> 0
    // Walk the table backwards: the high byte of each table entry is unique, so each step is invertible.
    const indexOfHigh = new Map<number, number>()
    for (let n = 0; n < 256; n++) {
        indexOfHigh.set(CRC_TABLE[n] >>> 24, n)
    }
    const needed: number[] = []
    let reg = wanted
    for (let k = 0; k < 4; k++) {
        const n = indexOfHigh.get(reg >>> 24)
        if (n === undefined) {
            throw new Error('crc patch: table lookup failed')
        }
        needed.push(n)
        reg = ((reg ^ CRC_TABLE[n]) << 8) >>> 0
    }
    // `needed[k]` is the table index of the (3 - k)-th appended byte step; recover the bytes forward.
    const patch = new Uint8Array(4)
    let forward = state
    for (let k = 3; k >= 0; k--) {
        const n = needed[k]
        // The byte b satisfies (forward ^ b) & 0xFF === n.
        patch[3 - k] = (forward ^ n) & 0xFF
        forward = CRC_TABLE[n] ^ (forward >>> 8)
    }
    return patch
}
