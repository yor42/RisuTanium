/**
 * Byte layout of the `.rtb` v1 container (single-disk ZIP64, APPNOTE 6.3.x), writer side.
 *
 * Every record builder here is pure and returns fresh bytes. The writer
 * (`zip64Writer.ts`) decides the form of each entry and calls these.
 *
 * Sentinel rule: in the local-header form and in the end records a ZIP64 field is
 * used exactly when the value is at or above `0xFFFFFFFF` (counts: `0xFFFF`), so no
 * 32-bit field ever holds `0xFFFFFFFF` as a real value. The descriptor form always
 * writes the sentinels and the ZIP64 extra, whatever the values.
 */

export const SIG_LOCAL = 0x04034B50
export const SIG_CENTRAL = 0x02014B50
export const SIG_DESCRIPTOR = 0x08074B50
export const SIG_END = 0x06054B50
export const SIG_ZIP64_END = 0x06064B50
export const SIG_ZIP64_LOCATOR = 0x07064B50

export const SENTINEL_32 = 0xFFFFFFFF
export const SENTINEL_16 = 0xFFFF

/** Made-by field: version 4.5 on a Unix host (the external attributes are Unix mode bits). */
export const MADE_BY = 0x032D
/** `0o100644 << 16`; a negative number in JS, so it is always written with `setUint32`. */
export const EXTERNAL_ATTRIBUTES = 0x81A40000
export const VERSION_PLAIN = 20
export const VERSION_ZIP64 = 45
/** Bit 11: names are UTF-8 (the format pins ASCII names, a subset). */
export const FLAG_UTF8 = 0x0800
/** Bit 3: sizes and CRC follow the body in a data descriptor. */
export const FLAG_DESCRIPTOR = 0x0008

export type ZipMethod = 0 | 8
export type EntryForm = 'local' | 'descriptor'

export interface DosStamp {
    time: number
    date: number
}

/** Size of the fixed part of each record. */
export const LOCAL_FIXED = 30
export const CENTRAL_FIXED = 46
export const DESCRIPTOR_SIZE = 24
export const ZIP64_END_SIZE = 56
export const ZIP64_LOCATOR_SIZE = 20
export const END_SIZE = 22

export function needsZip64(value: number): boolean {
    return value >= SENTINEL_32
}

export function needsZip64Count(count: number): boolean {
    return count >= SENTINEL_16
}

/**
 * DOS time and date of an instant in UTC. Information only. Before 1980-01-01 the
 * stamp is 1980-01-01 00:00:00; after the last representable year it saturates.
 */
export function dosStamp(ms: number): DosStamp {
    if (!Number.isFinite(ms)) {
        throw new RangeError('createdAt must be a finite number')
    }
    const at = new Date(ms)
    const year = at.getUTCFullYear()
    if (year < 1980) {
        return { time: 0, date: (1 << 5) | 1 }
    }
    if (year > 2107) {
        return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 }
    }
    return {
        time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
        date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
    }
}

export interface EntryRecord {
    nameBytes: Uint8Array
    method: ZipMethod
    form: EntryForm
    /** Offset of the local header. */
    offset: number
    dos: DosStamp
    crc: number
    compressedSize: number
    uncompressedSize: number
}

/** 45 when the entry carries a ZIP64 extra in either header, else 20. */
export function versionNeeded(form: EntryForm, offset: number): number {
    return form === 'descriptor' || needsZip64(offset) ? VERSION_ZIP64 : VERSION_PLAIN
}

function setU64(dv: DataView, at: number, value: number): void {
    dv.setBigUint64(at, BigInt(value), true)
}

function checkName(nameBytes: Uint8Array): void {
    if (nameBytes.length === 0 || nameBytes.length > 0xFFFF) {
        throw new RangeError('entry name length must be 1 to 65535 bytes')
    }
}

/**
 * Local file header. In the descriptor form the CRC and sizes are not known yet:
 * flag bit 3, CRC 0, both size fields `0xFFFFFFFF` (or 0 under the M6 branch) and a
 * 16-byte ZIP64 extra with zero sizes. In the local-header form the real values
 * are written and there is no extra.
 */
export function buildLocalHeader(entry: EntryRecord, m6ZeroLocalSizes: boolean): Uint8Array {
    checkName(entry.nameBytes)
    const descriptor = entry.form === 'descriptor'
    const extraLength = descriptor ? 20 : 0
    const out = new Uint8Array(LOCAL_FIXED + entry.nameBytes.length + extraLength)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, SIG_LOCAL, true)
    dv.setUint16(4, versionNeeded(entry.form, entry.offset), true)
    dv.setUint16(6, descriptor ? FLAG_UTF8 | FLAG_DESCRIPTOR : FLAG_UTF8, true)
    dv.setUint16(8, entry.method, true)
    dv.setUint16(10, entry.dos.time, true)
    dv.setUint16(12, entry.dos.date, true)
    if (descriptor) {
        dv.setUint32(14, 0, true)
        const sizeField = m6ZeroLocalSizes ? 0 : SENTINEL_32
        dv.setUint32(18, sizeField, true)
        dv.setUint32(22, sizeField, true)
    } else {
        if (needsZip64(entry.compressedSize) || needsZip64(entry.uncompressedSize)) {
            throw new RangeError('a local-header entry must be below 0xFFFFFFFF bytes')
        }
        dv.setUint32(14, entry.crc, true)
        dv.setUint32(18, entry.compressedSize, true)
        dv.setUint32(22, entry.uncompressedSize, true)
    }
    dv.setUint16(26, entry.nameBytes.length, true)
    dv.setUint16(28, extraLength, true)
    out.set(entry.nameBytes, LOCAL_FIXED)
    if (descriptor) {
        const at = LOCAL_FIXED + entry.nameBytes.length
        dv.setUint16(at, 0x0001, true)
        dv.setUint16(at + 2, 16, true)
        // The two u64 sizes stay zero.
    }
    return out
}

/** Data descriptor after the body of a descriptor-form entry. */
export function buildDescriptor(crc: number, compressedSize: number, uncompressedSize: number): Uint8Array {
    const out = new Uint8Array(DESCRIPTOR_SIZE)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, SIG_DESCRIPTOR, true)
    dv.setUint32(4, crc, true)
    setU64(dv, 8, compressedSize)
    setU64(dv, 16, uncompressedSize)
    return out
}

/**
 * Central directory record. The ZIP64 extra holds exactly the fields that are
 * `0xFFFFFFFF`, in APPNOTE order (uncompressed size, compressed size, offset).
 */
export function buildCentralRecord(entry: EntryRecord): Uint8Array {
    checkName(entry.nameBytes)
    const descriptor = entry.form === 'descriptor'
    const uncompressedSentinel = descriptor || needsZip64(entry.uncompressedSize)
    const compressedSentinel = descriptor || needsZip64(entry.compressedSize)
    const offsetSentinel = descriptor || needsZip64(entry.offset)
    const extraFields = (uncompressedSentinel ? 1 : 0) + (compressedSentinel ? 1 : 0) + (offsetSentinel ? 1 : 0)
    const extraLength = extraFields === 0 ? 0 : 4 + 8 * extraFields
    const out = new Uint8Array(CENTRAL_FIXED + entry.nameBytes.length + extraLength)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, SIG_CENTRAL, true)
    dv.setUint16(4, MADE_BY, true)
    dv.setUint16(6, versionNeeded(entry.form, entry.offset), true)
    dv.setUint16(8, descriptor ? FLAG_UTF8 | FLAG_DESCRIPTOR : FLAG_UTF8, true)
    dv.setUint16(10, entry.method, true)
    dv.setUint16(12, entry.dos.time, true)
    dv.setUint16(14, entry.dos.date, true)
    dv.setUint32(16, entry.crc, true)
    dv.setUint32(20, compressedSentinel ? SENTINEL_32 : entry.compressedSize, true)
    dv.setUint32(24, uncompressedSentinel ? SENTINEL_32 : entry.uncompressedSize, true)
    dv.setUint16(28, entry.nameBytes.length, true)
    dv.setUint16(30, extraLength, true)
    dv.setUint16(32, 0, true)
    dv.setUint16(34, 0, true)
    dv.setUint16(36, 0, true)
    dv.setUint32(38, EXTERNAL_ATTRIBUTES, true)
    dv.setUint32(42, offsetSentinel ? SENTINEL_32 : entry.offset, true)
    out.set(entry.nameBytes, CENTRAL_FIXED)
    if (extraLength > 0) {
        let at = CENTRAL_FIXED + entry.nameBytes.length
        dv.setUint16(at, 0x0001, true)
        dv.setUint16(at + 2, 8 * extraFields, true)
        at += 4
        if (uncompressedSentinel) {
            setU64(dv, at, entry.uncompressedSize)
            at += 8
        }
        if (compressedSentinel) {
            setU64(dv, at, entry.compressedSize)
            at += 8
        }
        if (offsetSentinel) {
            setU64(dv, at, entry.offset)
        }
    }
    return out
}

/**
 * ZIP64 end record, its locator and the classic end record, in file order. The
 * classic record holds the real values where they fit, else the sentinels.
 * `zip64EndOffset` is where this block starts in the file.
 */
export function buildEndRecords(entries: number, directorySize: number, directoryOffset: number, zip64EndOffset: number): Uint8Array {
    const out = new Uint8Array(ZIP64_END_SIZE + ZIP64_LOCATOR_SIZE + END_SIZE)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, SIG_ZIP64_END, true)
    setU64(dv, 4, 44)
    dv.setUint16(12, MADE_BY, true)
    dv.setUint16(14, VERSION_ZIP64, true)
    dv.setUint32(16, 0, true)
    dv.setUint32(20, 0, true)
    setU64(dv, 24, entries)
    setU64(dv, 32, entries)
    setU64(dv, 40, directorySize)
    setU64(dv, 48, directoryOffset)

    const locator = ZIP64_END_SIZE
    dv.setUint32(locator, SIG_ZIP64_LOCATOR, true)
    dv.setUint32(locator + 4, 0, true)
    setU64(dv, locator + 8, zip64EndOffset)
    dv.setUint32(locator + 16, 1, true)

    const end = ZIP64_END_SIZE + ZIP64_LOCATOR_SIZE
    dv.setUint32(end, SIG_END, true)
    dv.setUint16(end + 4, 0, true)
    dv.setUint16(end + 6, 0, true)
    const count16 = needsZip64Count(entries) ? SENTINEL_16 : entries
    dv.setUint16(end + 8, count16, true)
    dv.setUint16(end + 10, count16, true)
    dv.setUint32(end + 12, needsZip64(directorySize) ? SENTINEL_32 : directorySize, true)
    dv.setUint32(end + 16, needsZip64(directoryOffset) ? SENTINEL_32 : directoryOffset, true)
    dv.setUint16(end + 20, 0, true)
    return out
}
