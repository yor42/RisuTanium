/**
 * Reader for the `.rtb` v1 container (single-disk ZIP64, methods 0 and 8).
 *
 * All bytes come through a `RangeSource`, which returns exactly what was asked or
 * rejects with `RtbCouldNotReadError`; nothing short is ever parsed, and a short
 * read is never reported as damage.
 *
 * `readDirectory` locates the end records from the file tail and walks the central
 * directory in 1 MiB steps into a packed index (typed arrays and one name pool, not
 * one object per entry). It records every central-level A1.1 finding it can see and
 * keeps walking while records still parse, so a caller can look at the manifest of
 * a file whose container is damaged. It stops at the first record it cannot parse
 * and never throws for a damaged container.
 *
 * Overlap is decided in two steps. The walk checks a lower bound that the central
 * directory alone can show: `offset + 30 + nameLength + compressedSize` must not
 * pass the next entry's offset. The local header carries the extra field length the
 * directory lacks, so `checkLocalHeaders` and `readEntry` complete the exact extent
 * `offset + 30 + localNameLength + localExtraLength + compressedSize` against the
 * next offset in offset order. Data descriptors lie outside the extent.
 *
 * `readEntry` delivers a body to a sink while checking it, and returns a finding
 * instead of throwing when the entry is damaged. Bytes already handed to the sink
 * are not trustworthy until the result is `ok`.
 */
import { Inflate } from 'fflate'
import { CRC32_INIT, crc32Final, crc32Update } from './crc32Running'
import { checkEntryPath } from './entryPath'
import type { RangeSource } from './rangeSource'
import { sniffRtb } from './sniff'

export type FindingCode =
    | 'end-records'
    | 'directory'
    | 'flags'
    | 'disk'
    | 'method'
    | 'name'
    | 'duplicate'
    | 'overlap'
    | 'offset'
    | 'local-header'
    | 'local-name'
    | 'zip64-extra'
    | 'stored-size'
    | 'crc'
    | 'size'
    | 'inflate'

export interface ContainerFinding {
    code: FindingCode
    /** The entry the finding is about, or null for the end records and the directory as a whole. */
    name: string | null
    detail: string
}

export interface ZipEntry {
    index: number
    name: string
    method: number
    flags: number
    crc: number
    compressedSize: number
    uncompressedSize: number
    /** Offset of the local header. */
    offset: number
}

export interface DirectoryWalk {
    /** Null only when the end records could not be located or make no sense. */
    index: ZipIndex | null
    findings: ContainerFinding[]
    /** Findings beyond the cap that were counted but not kept. */
    findingsOmitted: number
    /** False when the walk stopped before the end of the directory. */
    complete: boolean
}

const LOCAL_FIXED = 30
const CENTRAL_FIXED = 46
const EOCD_SIZE = 22
const LOCATOR_SIZE = 20
const ZIP64_END_FIXED = 56
const MAX_COMMENT = 0xFFFF
const TAIL_BYTES = EOCD_SIZE + MAX_COMMENT + LOCATOR_SIZE
const DIRECTORY_CHUNK = 1024 * 1024
const BODY_READ_BLOCK = 1024 * 1024
/** Compressed input is fed to the inflater in slices of at most this size, so output per push stays bounded. */
const INFLATE_FEED = 16 * 1024
const MAX_FINDINGS = 1000

const SIG_LOCAL = 0x04034B50
const SIG_CENTRAL = 0x02014B50
const SIG_END = 0x06054B50
const SIG_ZIP64_END = 0x06064B50
const SIG_ZIP64_LOCATOR = 0x07064B50
const SIG_DIGITAL_SIGNATURE = 0x05054B50

const SENTINEL_32 = 0xFFFFFFFF
const SENTINEL_16 = 0xFFFF
const FLAGS_REFUSED = 0x0001 | 0x0040 | 0x2000

/** Central record fields that cannot be trusted, so the entry is left out of ordering and refused on read. */
const UNUSABLE = 1

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function readU64(dv: DataView, at: number): number | null {
    const value = dv.getBigUint64(at, true)
    return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value)
}

class Findings {
    readonly list: ContainerFinding[] = []
    omitted = 0

    add(code: FindingCode, name: string | null, detail: string): void {
        if (this.list.length < MAX_FINDINGS) {
            this.list.push({ code, name, detail })
        } else {
            this.omitted++
        }
    }
}

function compareRaw(a: Uint8Array, aStart: number, aLength: number, b: Uint8Array, bStart: number, bLength: number): number {
    const common = Math.min(aLength, bLength)
    for (let i = 0; i < common; i++) {
        const difference = a[aStart + i] - b[bStart + i]
        if (difference !== 0) {
            return difference
        }
    }
    return aLength - bLength
}

interface IndexData {
    size: number
    count: number
    directoryOffset: number
    directorySize: number
    offset: Float64Array
    compressedSize: Float64Array
    uncompressedSize: Float64Array
    crc: Uint32Array
    method: Uint16Array
    flags: Uint16Array
    nameStart: Float64Array
    nameLength: Uint16Array
    state: Uint8Array
    pool: Uint8Array
}

/** Packed view of a walked central directory. */
export class ZipIndex {
    readonly size: number
    readonly count: number
    readonly directoryOffset: number
    readonly directorySize: number
    private readonly data: IndexData
    /** Entry indices ordered by local header offset (entries with a usable offset only). */
    private order = new Uint32Array(0)
    /** Position of each entry in `order`, or `0xFFFFFFFF`. */
    private rank = new Uint32Array(0)
    /** Entry indices ordered by raw name bytes. */
    private byName = new Uint32Array(0)

    constructor(data: IndexData) {
        this.data = data
        this.size = data.size
        this.count = data.count
        this.directoryOffset = data.directoryOffset
        this.directorySize = data.directorySize
    }

    /** @internal Sorts the entries by offset and by name; called once by the walk. */
    prepare(): void {
        const { offset, state } = this.data
        const good: number[] = []
        for (let i = 0; i < this.count; i++) {
            if ((state[i] & UNUSABLE) === 0) {
                good.push(i)
            }
        }
        this.order = Uint32Array.from(good).sort((a, b) => (offset[a] - offset[b]) || (a - b))
        this.rank = new Uint32Array(this.count).fill(0xFFFFFFFF)
        for (let k = 0; k < this.order.length; k++) {
            this.rank[this.order[k]] = k
        }
        const names = new Uint32Array(this.count)
        for (let i = 0; i < this.count; i++) {
            names[i] = i
        }
        this.byName = names.sort((a, b) => this.compareNames(a, b) || (a - b))
    }

    /** @internal Entry indices in offset order. */
    offsetOrder(): Uint32Array {
        return this.order
    }

    /** @internal Entry indices in raw-name order. */
    nameOrder(): Uint32Array {
        return this.byName
    }

    compareNames(a: number, b: number): number {
        const { pool, nameStart, nameLength } = this.data
        return compareRaw(pool, nameStart[a], nameLength[a], pool, nameStart[b], nameLength[b])
    }

    nameBytes(i: number): Uint8Array {
        const start = this.data.nameStart[i]
        return this.data.pool.subarray(start, start + this.data.nameLength[i])
    }

    name(i: number): string {
        return textDecoder.decode(this.nameBytes(i))
    }

    entry(i: number): ZipEntry {
        const d = this.data
        return {
            index: i,
            name: this.name(i),
            method: d.method[i],
            flags: d.flags[i],
            crc: d.crc[i],
            compressedSize: d.compressedSize[i],
            uncompressedSize: d.uncompressedSize[i],
            offset: d.offset[i],
        }
    }

    /** True when the central record's offset or sizes could not be recovered. */
    unusable(i: number): boolean {
        return (this.data.state[i] & UNUSABLE) !== 0
    }

    /** Offset that bounds entry `i`: the next entry's local header, or the central directory. */
    nextOffset(i: number): number {
        const k = this.rank[i]
        if (k === 0xFFFFFFFF || k + 1 >= this.order.length) {
            return this.directoryOffset
        }
        return this.data.offset[this.order[k + 1]]
    }

    /** Every entry whose raw name equals `name` (UTF-8), in index order. */
    find(name: string): number[] {
        const target = textEncoder.encode(name)
        const { pool, nameStart, nameLength } = this.data
        let low = 0
        let high = this.byName.length
        while (low < high) {
            const mid = (low + high) >> 1
            const i = this.byName[mid]
            if (compareRaw(pool, nameStart[i], nameLength[i], target, 0, target.length) < 0) {
                low = mid + 1
            } else {
                high = mid
            }
        }
        const found: number[] = []
        for (let k = low; k < this.byName.length; k++) {
            const i = this.byName[k]
            if (compareRaw(pool, nameStart[i], nameLength[i], target, 0, target.length) !== 0) {
                break
            }
            found.push(i)
        }
        return found
    }
}

/** Growable column store the walk fills before the index is frozen. */
class Columns {
    capacity = 0
    count = 0
    offset = new Float64Array(0)
    compressedSize = new Float64Array(0)
    uncompressedSize = new Float64Array(0)
    crc = new Uint32Array(0)
    method = new Uint16Array(0)
    flags = new Uint16Array(0)
    nameStart = new Float64Array(0)
    nameLength = new Uint16Array(0)
    state = new Uint8Array(0)
    pool = new Uint8Array(0)
    poolUsed = 0

    private static grown<T extends Float64Array | Uint32Array | Uint16Array | Uint8Array>(old: T, capacity: number): T {
        const next = new (old.constructor as new (length: number) => T)(capacity)
        next.set(old)
        return next
    }

    reserve(): void {
        if (this.count < this.capacity) {
            return
        }
        const capacity = Math.max(1024, this.capacity * 2)
        this.offset = Columns.grown(this.offset, capacity)
        this.compressedSize = Columns.grown(this.compressedSize, capacity)
        this.uncompressedSize = Columns.grown(this.uncompressedSize, capacity)
        this.crc = Columns.grown(this.crc, capacity)
        this.method = Columns.grown(this.method, capacity)
        this.flags = Columns.grown(this.flags, capacity)
        this.nameStart = Columns.grown(this.nameStart, capacity)
        this.nameLength = Columns.grown(this.nameLength, capacity)
        this.state = Columns.grown(this.state, capacity)
        this.capacity = capacity
    }

    addName(name: Uint8Array): number {
        if (this.poolUsed + name.length > this.pool.length) {
            this.pool = Columns.grown(this.pool, Math.max(64 * 1024, this.pool.length * 2, this.poolUsed + name.length))
        }
        const start = this.poolUsed
        this.pool.set(name, start)
        this.poolUsed += name.length
        return start
    }

    freeze(size: number, directoryOffset: number, directorySize: number): ZipIndex {
        const n = this.count
        return new ZipIndex({
            size,
            count: n,
            directoryOffset,
            directorySize,
            offset: this.offset.subarray(0, n),
            compressedSize: this.compressedSize.subarray(0, n),
            uncompressedSize: this.uncompressedSize.subarray(0, n),
            crc: this.crc.subarray(0, n),
            method: this.method.subarray(0, n),
            flags: this.flags.subarray(0, n),
            nameStart: this.nameStart.subarray(0, n),
            nameLength: this.nameLength.subarray(0, n),
            state: this.state.subarray(0, n),
            pool: this.pool.subarray(0, this.poolUsed),
        })
    }
}

interface EndInfo {
    entries: number
    directorySize: number
    directoryOffset: number
}

/**
 * Finds the end records from the file tail. Returns null (with a finding) when the
 * directory cannot be located; disk-field problems are findings and do not stop the walk.
 */
async function locateEnd(source: RangeSource, findings: Findings): Promise<EndInfo | null> {
    const size = source.size
    if (size < EOCD_SIZE) {
        findings.add('end-records', null, `the file is ${size} bytes, smaller than an end record`)
        return null
    }
    const tailLength = Math.min(size, TAIL_BYTES)
    const tailStart = size - tailLength
    const tail = await source.read(tailStart, tailLength)
    const tv = viewOf(tail)
    let eocd = -1
    for (let p = tail.length - EOCD_SIZE; p >= 0; p--) {
        if (tail[p] === 0x50 && tv.getUint32(p, true) === SIG_END && p + EOCD_SIZE + tv.getUint16(p + 20, true) === tail.length) {
            eocd = p
            break
        }
    }
    if (eocd < 0) {
        findings.add('end-records', null, 'no end of central directory record at the end of the file')
        return null
    }

    const classicDiskNumber = tv.getUint16(eocd + 4, true)
    const classicDirectoryDisk = tv.getUint16(eocd + 6, true)
    const classicEntries = tv.getUint16(eocd + 10, true)
    const classicSize = tv.getUint32(eocd + 12, true)
    const classicOffset = tv.getUint32(eocd + 16, true)
    const eocdFileOffset = tailStart + eocd

    const hasLocator = eocd >= LOCATOR_SIZE && tv.getUint32(eocd - LOCATOR_SIZE, true) === SIG_ZIP64_LOCATOR
    let info: EndInfo
    let endLimit: number
    if (hasLocator) {
        const at = eocd - LOCATOR_SIZE
        const locatorFileOffset = tailStart + at
        if (tv.getUint32(at + 4, true) !== 0) {
            findings.add('disk', null, 'the ZIP64 locator names a disk other than 0 for the ZIP64 end record')
        }
        if (tv.getUint32(at + 16, true) > 1) {
            findings.add('disk', null, 'the ZIP64 locator reports more than one disk')
        }
        const zip64Offset = readU64(tv, at + 8)
        if (zip64Offset === null || zip64Offset + ZIP64_END_FIXED > locatorFileOffset) {
            findings.add('end-records', null, 'the ZIP64 locator points outside the file')
            return null
        }
        const record = await source.read(zip64Offset, ZIP64_END_FIXED)
        const rv = viewOf(record)
        if (rv.getUint32(0, true) !== SIG_ZIP64_END) {
            findings.add('end-records', null, 'the ZIP64 end record is missing at the locator offset')
            return null
        }
        const recordSize = readU64(rv, 4)
        if (recordSize === null || recordSize < 44 || zip64Offset + 12 + recordSize > locatorFileOffset) {
            findings.add('end-records', null, 'the ZIP64 end record has an invalid size')
            return null
        }
        if (rv.getUint32(16, true) !== 0) {
            findings.add('disk', null, 'the ZIP64 end record names a disk other than 0')
        }
        if (rv.getUint32(20, true) !== 0) {
            findings.add('disk', null, 'the ZIP64 end record puts the directory on a disk other than 0')
        }
        if ((classicDiskNumber !== 0 && classicDiskNumber !== SENTINEL_16) || (classicDirectoryDisk !== 0 && classicDirectoryDisk !== SENTINEL_16)) {
            findings.add('disk', null, 'the end record names a disk other than 0')
        }
        const entriesOnDisk = readU64(rv, 24)
        const entries = readU64(rv, 32)
        const directorySize = readU64(rv, 40)
        const directoryOffset = readU64(rv, 48)
        if (entries === null || directorySize === null || directoryOffset === null || entriesOnDisk === null) {
            findings.add('end-records', null, 'the ZIP64 end record holds a value beyond the safe integer range')
            return null
        }
        if (entriesOnDisk !== entries) {
            findings.add('disk', null, 'the entry count on this disk differs from the total')
        }
        info = { entries, directorySize, directoryOffset }
        endLimit = zip64Offset
    } else {
        if (classicDiskNumber !== 0 || classicDirectoryDisk !== 0) {
            findings.add('disk', null, 'the end record names a disk other than 0')
        }
        if (classicEntries === SENTINEL_16 || classicSize === SENTINEL_32 || classicOffset === SENTINEL_32) {
            findings.add('end-records', null, 'the end record holds a ZIP64 sentinel and no ZIP64 end record is present')
            return null
        }
        if (tv.getUint16(eocd + 8, true) !== classicEntries) {
            findings.add('disk', null, 'the entry count on this disk differs from the total')
        }
        info = { entries: classicEntries, directorySize: classicSize, directoryOffset: classicOffset }
        endLimit = eocdFileOffset
    }

    if (info.directoryOffset + info.directorySize > endLimit) {
        findings.add('end-records', null, 'the central directory lies outside the file')
        return null
    }
    if (info.entries * CENTRAL_FIXED > info.directorySize) {
        findings.add('end-records', null, 'the central directory is too small for its entry count')
        return null
    }
    return info
}

/** Sequential reader over the directory bytes that keeps whole records in one buffer. */
class DirectoryCursor {
    buffer: Uint8Array = new Uint8Array(0)
    position = 0
    private nextFileOffset: number
    private readonly endOffset: number
    private cachedView: DataView | null = null

    constructor(private readonly source: RangeSource, start: number, end: number) {
        this.nextFileOffset = start
        this.endOffset = end
    }

    /** Makes `needed` bytes available at `position`; false when the directory holds fewer. */
    async ensure(needed: number): Promise<boolean> {
        const have = this.buffer.length - this.position
        if (have >= needed) {
            return true
        }
        const remaining = this.endOffset - this.nextFileOffset
        if (have + remaining < needed) {
            return false
        }
        const want = Math.min(remaining, Math.max(DIRECTORY_CHUNK, needed - have))
        const more = await this.source.read(this.nextFileOffset, want)
        const merged = new Uint8Array(have + want)
        merged.set(this.buffer.subarray(this.position), 0)
        merged.set(more, have)
        this.buffer = merged
        this.position = 0
        this.nextFileOffset += want
        this.cachedView = null
        return true
    }

    view(): DataView {
        if (!this.cachedView) {
            this.cachedView = viewOf(this.buffer)
        }
        return this.cachedView
    }

    /** Bytes of the directory not yet consumed. */
    remaining(): number {
        return this.buffer.length - this.position + (this.endOffset - this.nextFileOffset)
    }
}

/** The first ZIP64 extra field (id 0x0001) in an extra block; a block that overruns ends the search. */
function findZip64Extra(extra: Uint8Array): Uint8Array | null {
    const dv = viewOf(extra)
    let at = 0
    while (at + 4 <= extra.length) {
        const id = dv.getUint16(at, true)
        const length = dv.getUint16(at + 2, true)
        if (at + 4 + length > extra.length) {
            return null
        }
        if (id === 0x0001) {
            return extra.subarray(at + 4, at + 4 + length)
        }
        at += 4 + length
    }
    return null
}

async function walkDirectory(source: RangeSource, end: EndInfo, findings: Findings): Promise<{ index: ZipIndex, complete: boolean }> {
    const columns = new Columns()
    const cursor = new DirectoryCursor(source, end.directoryOffset, end.directoryOffset + end.directorySize)
    let complete = true
    while (columns.count < end.entries) {
        if (!(await cursor.ensure(CENTRAL_FIXED))) {
            findings.add('directory', null, `the central directory ends after ${columns.count} of ${end.entries} records`)
            complete = false
            break
        }
        let dv = cursor.view()
        if (dv.getUint32(cursor.position, true) !== SIG_CENTRAL) {
            findings.add('directory', null, `central record ${columns.count} has no signature`)
            complete = false
            break
        }
        const total = CENTRAL_FIXED + dv.getUint16(cursor.position + 28, true) + dv.getUint16(cursor.position + 30, true) + dv.getUint16(cursor.position + 32, true)
        if (!(await cursor.ensure(total))) {
            findings.add('directory', null, `central record ${columns.count} runs past the end of the directory`)
            complete = false
            break
        }
        dv = cursor.view()
        const at = cursor.position
        const nameLength = dv.getUint16(at + 28, true)
        const extraLength = dv.getUint16(at + 30, true)
        const nameBytes = cursor.buffer.subarray(at + CENTRAL_FIXED, at + CENTRAL_FIXED + nameLength)
        const extra = cursor.buffer.subarray(at + CENTRAL_FIXED + nameLength, at + CENTRAL_FIXED + nameLength + extraLength)
        const name = textDecoder.decode(nameBytes)

        const flags = dv.getUint16(at + 8, true)
        const method = dv.getUint16(at + 10, true)
        const diskStart = dv.getUint16(at + 34, true)
        const compressed32 = dv.getUint32(at + 20, true)
        const uncompressed32 = dv.getUint32(at + 24, true)
        const offset32 = dv.getUint32(at + 42, true)
        let compressedSize = compressed32
        let uncompressedSize = uncompressed32
        let offset = offset32
        let state = 0

        const needUncompressed = uncompressed32 === SENTINEL_32
        const needCompressed = compressed32 === SENTINEL_32
        const needOffset = offset32 === SENTINEL_32
        const needDisk = diskStart === SENTINEL_16
        if (needUncompressed || needCompressed || needOffset || needDisk) {
            const zip64 = findZip64Extra(extra)
            let ok = zip64 !== null
            if (zip64 === null) {
                findings.add('zip64-extra', name, 'a field holds a ZIP64 sentinel and the record has no ZIP64 extra')
            } else {
                const zv = viewOf(zip64)
                let p = 0
                const take = (): number | null => {
                    if (p + 8 > zip64.length) {
                        return null
                    }
                    const value = readU64(zv, p)
                    p += 8
                    return value
                }
                const uncompressedValue = needUncompressed ? take() : uncompressed32
                const compressedValue = needCompressed ? take() : compressed32
                const offsetValue = needOffset ? take() : offset32
                let diskValue: number | null = 0
                if (needDisk) {
                    diskValue = p + 4 <= zip64.length ? zv.getUint32(p, true) : null
                    p += 4
                }
                if (uncompressedValue === null || compressedValue === null || offsetValue === null || diskValue === null) {
                    findings.add('zip64-extra', name, 'the ZIP64 extra is too short for its sentinel fields')
                    ok = false
                } else {
                    uncompressedSize = uncompressedValue
                    compressedSize = compressedValue
                    offset = offsetValue
                    if (diskValue !== 0) {
                        findings.add('disk', name, 'the ZIP64 extra names a disk other than 0')
                    }
                }
            }
            if (!ok) {
                state |= UNUSABLE
                compressedSize = 0
                uncompressedSize = 0
                offset = 0
            }
        } else if (diskStart !== 0) {
            findings.add('disk', name, 'the central record names a disk other than 0')
        }

        if ((flags & FLAGS_REFUSED) !== 0) {
            findings.add('flags', name, `general purpose flag bits 0x${(flags & FLAGS_REFUSED).toString(16)} are not allowed`)
        }
        if (method !== 0 && method !== 8 && method !== 93) {
            findings.add('method', name, `compression method ${method} is not allowed`)
        }
        const problem = checkEntryPath(nameBytes)
        if (problem) {
            findings.add('name', name, `the entry name breaks the path rules (${problem})`)
        }
        if ((state & UNUSABLE) === 0) {
            if (method === 0 && compressedSize !== uncompressedSize) {
                findings.add('stored-size', name, `a stored entry has compressed size ${compressedSize} and uncompressed size ${uncompressedSize}`)
            }
            if (offset + LOCAL_FIXED > source.size) {
                findings.add('offset', name, `the local header offset ${offset} is past the end of the file`)
                state |= UNUSABLE
            }
        }

        columns.reserve()
        const i = columns.count
        columns.offset[i] = offset
        columns.compressedSize[i] = compressedSize
        columns.uncompressedSize[i] = uncompressedSize
        columns.crc[i] = dv.getUint32(at + 16, true)
        columns.method[i] = method
        columns.flags[i] = flags
        columns.nameStart[i] = columns.addName(nameBytes)
        columns.nameLength[i] = nameLength
        columns.state[i] = state
        columns.count++
        cursor.position = at + total
    }
    if (complete && cursor.remaining() > 0) {
        const signature = (await cursor.ensure(4)) ? cursor.view().getUint32(cursor.position, true) : 0
        if (signature !== SIG_DIGITAL_SIGNATURE) {
            findings.add('directory', null, `${cursor.remaining()} bytes follow the last central record`)
        }
    }
    const index = columns.freeze(source.size, end.directoryOffset, end.directorySize)
    index.prepare()
    return { index, complete }
}

function checkNamesAndExtents(index: ZipIndex, findings: Findings): void {
    const byName = index.nameOrder()
    for (let k = 1; k < byName.length; k++) {
        if (index.compareNames(byName[k - 1], byName[k]) === 0) {
            findings.add('duplicate', index.name(byName[k]), 'two central records have the same raw name')
        }
    }
    const order = index.offsetOrder()
    for (let k = 0; k < order.length; k++) {
        const i = order[k]
        const entry = index.entry(i)
        const lowerBound = entry.offset + LOCAL_FIXED + index.nameBytes(i).length + entry.compressedSize
        const next = index.nextOffset(i)
        if (lowerBound > next) {
            findings.add('overlap', entry.name, `the entry reaches ${lowerBound - next} bytes into the next entry or the central directory`)
        }
    }
}

/**
 * Locates the end records and walks the central directory. A short or failed read
 * rejects with `RtbCouldNotReadError`; a damaged container returns findings.
 */
export async function readDirectory(source: RangeSource): Promise<DirectoryWalk> {
    const findings = new Findings()
    const end = await locateEnd(source, findings)
    if (!end) {
        return { index: null, findings: findings.list, findingsOmitted: findings.omitted, complete: false }
    }
    const { index, complete } = await walkDirectory(source, end, findings)
    checkNamesAndExtents(index, findings)
    return { index, findings: findings.list, findingsOmitted: findings.omitted, complete }
}

type LocalResult =
    | { ok: true, dataStart: number }
    | { ok: false, finding: ContainerFinding }

function sameName(index: ZipIndex, i: number, local: Uint8Array): boolean {
    const central = index.nameBytes(i)
    return compareRaw(central, 0, central.length, local, 0, local.length) === 0
}

/** Reads the local header of entry `i` and checks its name and the exact extent. */
async function readLocal(source: RangeSource, index: ZipIndex, i: number): Promise<LocalResult> {
    const entry = index.entry(i)
    const fail = (code: FindingCode, detail: string): LocalResult => ({ ok: false, finding: { code, name: entry.name, detail } })
    const header = await source.read(entry.offset, LOCAL_FIXED)
    const hv = viewOf(header)
    if (hv.getUint32(0, true) !== SIG_LOCAL) {
        return fail('local-header', 'the local header has no signature')
    }
    const nameLength = hv.getUint16(26, true)
    const extraLength = hv.getUint16(28, true)
    const dataStart = entry.offset + LOCAL_FIXED + nameLength + extraLength
    if (dataStart > source.size) {
        return fail('local-header', 'the local header runs past the end of the file')
    }
    const rest = await source.read(entry.offset + LOCAL_FIXED, nameLength + extraLength)
    if (!sameName(index, i, rest.subarray(0, nameLength))) {
        return fail('local-name', 'the local header name differs from the central record')
    }
    const extentEnd = dataStart + entry.compressedSize
    const next = index.nextOffset(i)
    if (extentEnd > next) {
        return fail('overlap', `the entry extent reaches ${extentEnd - next} bytes into the next entry or the central directory`)
    }
    return { ok: true, dataStart }
}

/**
 * Checks the local header of every entry `include` accepts (all by default): the
 * signature, the name against the central record, and the exact extent. Entries whose
 * central record could not be used were already reported by the walk and are skipped.
 */
export async function checkLocalHeaders(
    source: RangeSource,
    index: ZipIndex,
    include?: (i: number) => boolean,
): Promise<ContainerFinding[]> {
    const findings: ContainerFinding[] = []
    for (let i = 0; i < index.count; i++) {
        if (index.unusable(i) || (include && !include(i))) {
            continue
        }
        const local = await readLocal(source, index, i)
        if (local.ok === false) {
            findings.push(local.finding)
        }
    }
    return findings
}

export type EntryReadResult =
    | { ok: true, size: number }
    | { ok: false, finding: ContainerFinding }

export type BodySink = (chunk: Uint8Array) => void | Promise<void>

/**
 * Reads one entry, handing the uncompressed bytes to `sink` in order. The CRC of
 * everything delivered is compared with the central CRC at the end. A deflated body
 * is inflated in bounded steps and never delivers more than the declared size.
 */
export async function readEntry(source: RangeSource, index: ZipIndex, i: number, sink: BodySink): Promise<EntryReadResult> {
    const entry = index.entry(i)
    const fail = (code: FindingCode, detail: string): EntryReadResult => ({ ok: false, finding: { code, name: entry.name, detail } })
    if (index.unusable(i)) {
        return fail('directory', 'the central record could not be used')
    }
    if ((entry.flags & FLAGS_REFUSED) !== 0) {
        return fail('flags', 'the entry uses a flag the format does not allow')
    }
    if (entry.method !== 0 && entry.method !== 8) {
        return fail('method', `compression method ${entry.method} cannot be read`)
    }
    const local = await readLocal(source, index, i)
    if (local.ok === false) {
        return { ok: false, finding: local.finding }
    }
    const end = local.dataStart + entry.compressedSize
    let crc = CRC32_INIT
    let produced = 0

    if (entry.method === 0) {
        if (entry.compressedSize !== entry.uncompressedSize) {
            return fail('stored-size', 'a stored entry has different compressed and uncompressed sizes')
        }
        for (let at = local.dataStart; at < end; at += BODY_READ_BLOCK) {
            const block = await source.read(at, Math.min(BODY_READ_BLOCK, end - at))
            crc = crc32Update(crc, block)
            produced += block.length
            await sink(block)
        }
    } else {
        let pending: Uint8Array[] = []
        let overflow = false
        const inflater = new Inflate((chunk) => {
            if (overflow) {
                return
            }
            const room = entry.uncompressedSize - produced
            if (chunk.length > room) {
                if (room > 0) {
                    pending.push(chunk.subarray(0, room))
                }
                produced += room
                overflow = true
            } else {
                pending.push(chunk)
                produced += chunk.length
            }
        })
        for (let at = local.dataStart; at < end && !overflow; ) {
            const block = await source.read(at, Math.min(BODY_READ_BLOCK, end - at))
            for (let s = 0; s < block.length && !overflow; s += INFLATE_FEED) {
                const slice = block.subarray(s, Math.min(s + INFLATE_FEED, block.length))
                try {
                    inflater.push(slice, at + s + slice.length === end)
                } catch (error) {
                    const reason = error instanceof Error ? error.message : String(error)
                    return fail('inflate', `the deflate stream is damaged (${reason})`)
                }
                const out = pending
                pending = []
                for (const part of out) {
                    crc = crc32Update(crc, part)
                    await sink(part)
                }
            }
            at += block.length
        }
        if (overflow) {
            return fail('size', `the entry inflates past its declared ${entry.uncompressedSize} bytes`)
        }
    }
    if (produced !== entry.uncompressedSize) {
        return fail('size', `the entry yields ${produced} bytes, declared ${entry.uncompressedSize}`)
    }
    if (crc32Final(crc) !== entry.crc) {
        return fail('crc', 'the entry bytes do not match the central CRC-32')
    }
    return { ok: true, size: produced }
}

export type OpenResult =
    | { kind: 'not-an-rtb' }
    | { kind: 'sealed', envelopeVersion: number }
    | { kind: 'sealed-damaged' }
    | { kind: 'zip', walk: DirectoryWalk }

/**
 * Sniffs the prefix and, only for a ZIP candidate, walks the directory. A sealed or
 * foreign file is decided from the first bytes and nothing else is read.
 */
export async function openContainer(source: RangeSource): Promise<OpenResult> {
    const sniffed = await sniffRtb(source)
    if (sniffed.kind !== 'zip') {
        return sniffed
    }
    return { kind: 'zip', walk: await readDirectory(source) }
}
