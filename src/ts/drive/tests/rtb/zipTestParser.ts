/**
 * Independent ZIP64 parser for tests of the `.rtb` container writer. It shares no
 * code with the writer or the product reader: it reads the end records from the
 * file tail, walks the central directory and each local header, and exposes every
 * field the format pins, so a test can assert header bytes and not only a round trip.
 */
import { inflateSync } from 'fflate'

export interface ByteSource {
    readonly length: number
    read(offset: number, length: number): Uint8Array
}

export function bytesSource(bytes: Uint8Array): ByteSource {
    return {
        length: bytes.length,
        read(offset: number, length: number): Uint8Array {
            if (offset < 0 || offset + length > bytes.length) {
                throw new RangeError('read outside the buffer')
            }
            return bytes.subarray(offset, offset + length)
        },
    }
}

export interface ExtraField {
    id: number
    data: Uint8Array
}

export interface ParsedLocal {
    versionNeeded: number
    flags: number
    method: number
    dosTime: number
    dosDate: number
    crc: number
    compressedSize32: number
    uncompressedSize32: number
    name: string
    extra: Uint8Array
    extraFields: ExtraField[]
    dataStart: number
}

export interface ParsedEntry {
    name: string
    madeBy: number
    versionNeeded: number
    flags: number
    method: number
    dosTime: number
    dosDate: number
    crc: number
    compressedSize32: number
    uncompressedSize32: number
    offset32: number
    diskStart: number
    internalAttrs: number
    externalAttrs: number
    extra: Uint8Array
    extraFields: ExtraField[]
    /** Sizes and offset after the ZIP64 extra is applied to the sentinel fields. */
    compressedSize: number
    uncompressedSize: number
    offset: number
    local: ParsedLocal
}

export interface ParsedEndRecords {
    classic: {
        diskNumber: number
        directoryDisk: number
        entriesOnDisk: number
        entries: number
        directorySize: number
        directoryOffset: number
        commentLength: number
    }
    locator: { diskWithZip64End: number, zip64EndOffset: number, totalDisks: number }
    zip64End: {
        recordSize: number
        madeBy: number
        versionNeeded: number
        diskNumber: number
        directoryDisk: number
        entriesOnDisk: number
        entries: number
        directorySize: number
        directoryOffset: number
    }
}

export interface ParsedZip {
    source: ByteSource
    end: ParsedEndRecords
    entries: ParsedEntry[]
}

function view(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function u64(dv: DataView, at: number): number {
    const value = dv.getBigUint64(at, true)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error('u64 beyond the safe integer range')
    }
    return Number(value)
}

export function parseExtra(extra: Uint8Array): ExtraField[] {
    const fields: ExtraField[] = []
    const dv = view(extra)
    let at = 0
    while (at < extra.length) {
        if (at + 4 > extra.length) {
            throw new Error('truncated extra header')
        }
        const id = dv.getUint16(at, true)
        const size = dv.getUint16(at + 2, true)
        if (at + 4 + size > extra.length) {
            throw new Error('extra field overruns')
        }
        fields.push({ id, data: extra.subarray(at + 4, at + 4 + size) })
        at += 4 + size
    }
    return fields
}

const decoder = new TextDecoder()

export function parseZip(source: ByteSource): ParsedZip {
    const total = source.length
    const tail = source.read(total - 22, 22)
    const tailView = view(tail)
    if (tailView.getUint32(0, true) !== 0x06054b50) {
        throw new Error('classic end record not at the tail')
    }
    const classic = {
        diskNumber: tailView.getUint16(4, true),
        directoryDisk: tailView.getUint16(6, true),
        entriesOnDisk: tailView.getUint16(8, true),
        entries: tailView.getUint16(10, true),
        directorySize: tailView.getUint32(12, true),
        directoryOffset: tailView.getUint32(16, true),
        commentLength: tailView.getUint16(20, true),
    }
    const locatorBytes = source.read(total - 22 - 20, 20)
    const locatorView = view(locatorBytes)
    if (locatorView.getUint32(0, true) !== 0x07064b50) {
        throw new Error('ZIP64 locator missing')
    }
    const locator = {
        diskWithZip64End: locatorView.getUint32(4, true),
        zip64EndOffset: u64(locatorView, 8),
        totalDisks: locatorView.getUint32(16, true),
    }
    const zip64Bytes = source.read(locator.zip64EndOffset, 56)
    const zip64View = view(zip64Bytes)
    if (zip64View.getUint32(0, true) !== 0x06064b50) {
        throw new Error('ZIP64 end record missing')
    }
    const zip64End = {
        recordSize: u64(zip64View, 4),
        madeBy: zip64View.getUint16(12, true),
        versionNeeded: zip64View.getUint16(14, true),
        diskNumber: zip64View.getUint32(16, true),
        directoryDisk: zip64View.getUint32(20, true),
        entriesOnDisk: u64(zip64View, 24),
        entries: u64(zip64View, 32),
        directorySize: u64(zip64View, 40),
        directoryOffset: u64(zip64View, 48),
    }

    const directory = source.read(zip64End.directoryOffset, zip64End.directorySize)
    const dv = view(directory)
    const entries: ParsedEntry[] = []
    let at = 0
    for (let index = 0; index < zip64End.entries; index++) {
        if (dv.getUint32(at, true) !== 0x02014b50) {
            throw new Error(`central record ${index} has no signature`)
        }
        const nameLength = dv.getUint16(at + 28, true)
        const extraLength = dv.getUint16(at + 30, true)
        const commentLength = dv.getUint16(at + 32, true)
        const nameBytes = directory.subarray(at + 46, at + 46 + nameLength)
        const extra = directory.subarray(at + 46 + nameLength, at + 46 + nameLength + extraLength)
        const extraFields = parseExtra(extra)
        const compressedSize32 = dv.getUint32(at + 20, true)
        const uncompressedSize32 = dv.getUint32(at + 24, true)
        const offset32 = dv.getUint32(at + 42, true)

        let compressedSize = compressedSize32
        let uncompressedSize = uncompressedSize32
        let offset = offset32
        const z64 = extraFields.find((field) => field.id === 0x0001)
        if (z64) {
            const zv = view(z64.data)
            let z = 0
            if (uncompressedSize32 === 0xFFFFFFFF) {
                uncompressedSize = u64(zv, z)
                z += 8
            }
            if (compressedSize32 === 0xFFFFFFFF) {
                compressedSize = u64(zv, z)
                z += 8
            }
            if (offset32 === 0xFFFFFFFF) {
                offset = u64(zv, z)
                z += 8
            }
            if (z !== z64.data.length) {
                throw new Error(`ZIP64 extra holds ${z64.data.length} bytes, sentinel fields need ${z}`)
            }
        } else if (compressedSize32 === 0xFFFFFFFF || uncompressedSize32 === 0xFFFFFFFF || offset32 === 0xFFFFFFFF) {
            throw new Error('sentinel field without a ZIP64 extra')
        }

        const localHead = source.read(offset, 30)
        const lv = view(localHead)
        if (lv.getUint32(0, true) !== 0x04034b50) {
            throw new Error(`local header of ${decoder.decode(nameBytes)} has no signature`)
        }
        const localNameLength = lv.getUint16(26, true)
        const localExtraLength = lv.getUint16(28, true)
        const localRest = source.read(offset + 30, localNameLength + localExtraLength)
        const localExtra = localRest.subarray(localNameLength)
        entries.push({
            name: decoder.decode(nameBytes),
            madeBy: dv.getUint16(at + 4, true),
            versionNeeded: dv.getUint16(at + 6, true),
            flags: dv.getUint16(at + 8, true),
            method: dv.getUint16(at + 10, true),
            dosTime: dv.getUint16(at + 12, true),
            dosDate: dv.getUint16(at + 14, true),
            crc: dv.getUint32(at + 16, true),
            compressedSize32,
            uncompressedSize32,
            offset32,
            diskStart: dv.getUint16(at + 34, true),
            internalAttrs: dv.getUint16(at + 36, true),
            externalAttrs: dv.getUint32(at + 38, true),
            extra,
            extraFields,
            compressedSize,
            uncompressedSize,
            offset,
            local: {
                versionNeeded: lv.getUint16(4, true),
                flags: lv.getUint16(6, true),
                method: lv.getUint16(8, true),
                dosTime: lv.getUint16(10, true),
                dosDate: lv.getUint16(12, true),
                crc: lv.getUint32(14, true),
                compressedSize32: lv.getUint32(18, true),
                uncompressedSize32: lv.getUint32(22, true),
                name: decoder.decode(localRest.subarray(0, localNameLength)),
                extra: localExtra,
                extraFields: parseExtra(localExtra),
                dataStart: offset + 30 + localNameLength + localExtraLength,
            },
        })
        at += 46 + nameLength + extraLength + commentLength
    }
    if (at !== directory.length) {
        throw new Error('central directory has trailing bytes')
    }
    return { source, end: { classic, locator, zip64End }, entries }
}

/** Stored or inflated body of one entry (small entries only). */
export function readBody(zip: ParsedZip, entry: ParsedEntry): Uint8Array {
    const raw = zip.source.read(entry.local.dataStart, entry.compressedSize)
    if (entry.method === 0) {
        return raw.slice()
    }
    if (entry.method === 8) {
        return inflateSync(raw)
    }
    throw new Error(`method ${entry.method}`)
}

export interface ParsedDescriptor {
    crc: number
    compressedSize: number
    uncompressedSize: number
}

/** The 24-byte data descriptor that follows the body of a descriptor-form entry. */
export function readDescriptor(zip: ParsedZip, entry: ParsedEntry): ParsedDescriptor {
    const at = entry.local.dataStart + entry.compressedSize
    const bytes = zip.source.read(at, 24)
    const dv = view(bytes)
    if (dv.getUint32(0, true) !== 0x08074b50) {
        throw new Error('descriptor signature missing')
    }
    return { crc: dv.getUint32(4, true), compressedSize: u64(dv, 8), uncompressedSize: u64(dv, 16) }
}

/** DOS date and time fields back to UTC components. */
export function decodeDos(dosDate: number, dosTime: number) {
    return {
        year: 1980 + (dosDate >> 9),
        month: (dosDate >> 5) & 0x0F,
        day: dosDate & 0x1F,
        hour: dosTime >> 11,
        minute: (dosTime >> 5) & 0x3F,
        second: (dosTime & 0x1F) * 2,
    }
}
