/**
 * Test-only ZIP reader that verifies what fflate's own readers never do: the CRC-32 of every entry, and the position of
 * every local header against its central record. It does not use `CharXWriter`, `fflate.Unzip` or the `crc` package;
 * only `inflateSync` decodes a deflate body.
 *
 * It works on the bytes alone. The end record gives the central directory's size and declared offset; the directory
 * sits immediately before the end record, so the start of the zip is `directoryStart - declaredOffset`. A JPEG in front
 * of the archive (a `charxJpeg` export) is therefore found, not assumed, and every central offset is checked relative to
 * that start.
 *
 * It accepts both framings: an entry whose flag bit 3 is clear carries its CRC and sizes in the local header; an entry
 * whose flag bit 3 is set carries zeros there and a 16-byte descriptor after its body. Every violation throws
 * `CharxFramingError` with the reason.
 */
import { inflateSync } from 'fflate'

export class CharxFramingError extends Error {
    constructor(reason: string) {
        super(reason)
        this.name = 'CharxFramingError'
    }
}

export interface CentralFields {
    versionMadeBy: number
    hostSystem: number
    versionNeeded: number
    flagLow: number
    flagHigh: number
    method: number
    stamp: number
    crc: number
    compressedSize: number
    size: number
    extraLength: number
    commentLength: number
    disk: number
    internalAttributes: number
    externalAttributes: number
    offset: number
}

export interface LocalFields {
    versionNeeded: number
    flagLow: number
    flagHigh: number
    method: number
    stamp: number
    crc: number
    compressedSize: number
    size: number
    extraLength: number
}

export interface ParsedEntry {
    name: string
    central: CentralFields
    local: LocalFields
    /** The raw deflate (or stored) body, as written. */
    body: Uint8Array
    /** The decoded entry data. */
    data: Uint8Array
    /** The descriptor that follows the body, when flag bit 3 is set. */
    descriptor?: { crc: number, compressedSize: number, size: number }
    /** Where the local header starts, relative to the start of the zip. */
    localOffset: number
}

export interface ParsedArchive {
    /** Bytes in front of the zip (a JPEG), 0 for a plain archive. */
    prefixLength: number
    entries: ParsedEntry[]
    end: { disk: number, directoryDisk: number, entriesOnDisk: number, entries: number, directorySize: number, directoryOffset: number, commentLength: number }
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
        }
        table[n] = c >>> 0
    }
    return table
})()

/** CRC-32 (IEEE), computed here so that the check does not depend on the writer's own helper. */
export function referenceCrc32(data: Uint8Array): number {
    let c = 0xFFFFFFFF
    for (let i = 0; i < data.length; i++) {
        c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8)
    }
    return (c ^ 0xFFFFFFFF) >>> 0
}

function fail(reason: string): never {
    throw new CharxFramingError(reason)
}

export function parseCharx(bytes: Uint8Array): ParsedArchive {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let eocd = bytes.length - 22
    while (eocd >= 0) {
        if (view.getUint32(eocd, true) === 0x06054B50 && eocd + 22 + view.getUint16(eocd + 20, true) === bytes.length) {
            break
        }
        eocd--
    }
    if (eocd < 0) {
        fail('no end of central directory record')
    }
    const end = {
        disk: view.getUint16(eocd + 4, true),
        directoryDisk: view.getUint16(eocd + 6, true),
        entriesOnDisk: view.getUint16(eocd + 8, true),
        entries: view.getUint16(eocd + 10, true),
        directorySize: view.getUint32(eocd + 12, true),
        directoryOffset: view.getUint32(eocd + 16, true),
        commentLength: view.getUint16(eocd + 20, true),
    }
    if (end.entriesOnDisk !== end.entries) {
        fail('the end record counts different entries on the disk and in total')
    }
    const directoryStart = eocd - end.directorySize
    const zipStart = directoryStart - end.directoryOffset
    if (directoryStart < 0 || zipStart < 0) {
        fail('the end record points outside the file')
    }

    const records: Array<{ name: string, central: CentralFields }> = []
    let at = directoryStart
    for (let i = 0; i < end.entries; i++) {
        if (at + 46 > eocd || view.getUint32(at, true) !== 0x02014B50) {
            fail(`central record ${i} does not start with its signature`)
        }
        const nameLength = view.getUint16(at + 28, true)
        const extraLength = view.getUint16(at + 30, true)
        const commentLength = view.getUint16(at + 32, true)
        records.push({
            name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
            central: {
                versionMadeBy: bytes[at + 4],
                hostSystem: bytes[at + 5],
                versionNeeded: view.getUint16(at + 6, true),
                flagLow: bytes[at + 8],
                flagHigh: bytes[at + 9],
                method: view.getUint16(at + 10, true),
                stamp: view.getUint32(at + 12, true),
                crc: view.getUint32(at + 16, true),
                compressedSize: view.getUint32(at + 20, true),
                size: view.getUint32(at + 24, true),
                extraLength,
                commentLength,
                disk: view.getUint16(at + 34, true),
                internalAttributes: view.getUint16(at + 36, true),
                externalAttributes: view.getUint32(at + 38, true),
                offset: view.getUint32(at + 42, true),
            },
        })
        at += 46 + nameLength + extraLength + commentLength
    }
    if (at !== eocd) {
        fail('the central records do not end exactly at the end record')
    }

    const entries: ParsedEntry[] = []
    let pos = zipStart
    for (const { name, central } of records) {
        if (central.offset !== pos - zipStart) {
            fail(`${name}: the central offset ${central.offset} is not the local header position ${pos - zipStart}`)
        }
        if (pos + 30 > directoryStart || view.getUint32(pos, true) !== 0x04034B50) {
            fail(`${name}: no local header at its central offset`)
        }
        const nameLength = view.getUint16(pos + 26, true)
        const local: LocalFields = {
            versionNeeded: view.getUint16(pos + 4, true),
            flagLow: bytes[pos + 6],
            flagHigh: bytes[pos + 7],
            method: view.getUint16(pos + 8, true),
            stamp: view.getUint32(pos + 10, true),
            crc: view.getUint32(pos + 14, true),
            compressedSize: view.getUint32(pos + 18, true),
            size: view.getUint32(pos + 22, true),
            extraLength: view.getUint16(pos + 28, true),
        }
        const localName = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLength))
        if (localName !== name) {
            fail(`${name}: the local header names ${localName}`)
        }
        const hasDescriptor = (local.flagLow & 8) !== 0
        if (hasDescriptor !== ((central.flagLow & 8) !== 0)) {
            fail(`${name}: the local and central records disagree on flag bit 3`)
        }
        const bodyStart = pos + 30 + nameLength + local.extraLength
        const bodyLength = hasDescriptor ? central.compressedSize : local.compressedSize
        if (!hasDescriptor && (local.crc !== central.crc || local.compressedSize !== central.compressedSize || local.size !== central.size)) {
            fail(`${name}: the local header and the central record disagree on the CRC or the sizes`)
        }
        if (hasDescriptor && (local.crc !== 0 || local.compressedSize !== 0 || local.size !== 0)) {
            fail(`${name}: flag bit 3 is set but the local header states a CRC or a size`)
        }
        if (bodyStart + bodyLength > directoryStart) {
            fail(`${name}: the body runs into the central directory`)
        }
        const body = bytes.subarray(bodyStart, bodyStart + bodyLength)
        pos = bodyStart + bodyLength
        let descriptor: ParsedEntry['descriptor']
        if (hasDescriptor) {
            if (view.getUint32(pos, true) !== 0x08074B50) {
                fail(`${name}: no data descriptor after the body`)
            }
            descriptor = { crc: view.getUint32(pos + 4, true), compressedSize: view.getUint32(pos + 8, true), size: view.getUint32(pos + 12, true) }
            if (descriptor.crc !== central.crc || descriptor.compressedSize !== central.compressedSize || descriptor.size !== central.size) {
                fail(`${name}: the data descriptor and the central record disagree`)
            }
            pos += 16
        }
        let data: Uint8Array
        if (central.method === 8) {
            data = inflateSync(body)
        } else if (central.method === 0) {
            data = body
        } else {
            fail(`${name}: unsupported method ${central.method}`)
        }
        if (data.length !== central.size) {
            fail(`${name}: the decoded length ${data.length} is not the declared size ${central.size}`)
        }
        if (referenceCrc32(data) !== central.crc) {
            fail(`${name}: the CRC-32 of the decoded data is not the declared one`)
        }
        entries.push({ name, central, local, body, data, descriptor, localOffset: central.offset })
    }
    if (pos !== directoryStart) {
        fail('the entries do not end exactly where the central directory starts')
    }
    return { prefixLength: zipStart, entries, end }
}
