import { describe, test, expect } from 'vitest'
import { RtbCouldNotReadError, rangeSourceFrom, type RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { RTB_MIMETYPE } from 'src/ts/drive/rtb/sniff'
import {
    checkLocalHeaders,
    openContainer,
    readDirectory,
    readEntry,
    type ContainerFinding,
    type DirectoryWalk,
    type ZipIndex,
} from 'src/ts/drive/rtb/zip64Reader'
import { Zip64Writer } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { rangeSourceOfBytes } from './sparseSource'
import { bytesSource, parseZip } from './zipTestParser'

const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)
const encoder = new TextEncoder()

function sample(length: number, salt = 1): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = ((i * 31 + salt * 17) ^ (i >> 3)) & 0xFF
    }
    return out
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

interface Spec {
    name: string
    method?: 0 | 8
    body: Uint8Array
}

async function build(specs: Spec[], options: { bufferLimit?: number, firstCentral?: string } = {}): Promise<Uint8Array> {
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: CREATED, bufferLimit: options.bufferLimit })
    for (const spec of specs) {
        await writer.addBuffered(spec.name, spec.method ?? 0, spec.body, spec.body.length)
    }
    await writer.finish({ firstCentral: options.firstCentral })
    return sink.toBytes()
}

const BODY = {
    mime: encoder.encode(RTB_MIMETYPE),
    block1: sample(300, 2),
    block2: sample(100, 3),
    unknown: sample(200, 4),
    big: sample(2000, 5),
    bigz: sample(3000, 6),
    manifest: encoder.encode('{"rtb":1,"sections":[]}'),
}

/** Local-header entries and, with the small buffer limit, two descriptor entries (one stored, one deflated). */
function baseSpecs(): Spec[] {
    return [
        { name: 'mimetype', method: 0, body: BODY.mime },
        { name: 'u/1/0.blk', method: 8, body: BODY.block1 },
        { name: 'x/unknown/one', method: 0, body: BODY.unknown },
        { name: 'a/big', method: 0, body: BODY.big },
        { name: 'a/bigz', method: 8, body: BODY.bigz },
        { name: 'u/2/0.blk', method: 8, body: BODY.block2 },
        { name: 'manifest.json', method: 8, body: BODY.manifest },
    ]
}

async function baseFile(): Promise<Uint8Array> {
    return build(baseSpecs(), { bufferLimit: 1024, firstCentral: 'manifest.json' })
}

interface Layout {
    zip: ReturnType<typeof parseZip>
    starts: number[]
    eocd: number
    locator: number
    zip64End: number
    directoryOffset: number
    directoryEnd: number
}

function layout(bytes: Uint8Array): Layout {
    const zip = parseZip(bytesSource(bytes))
    const eocd = bytes.length - 22
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const starts: number[] = []
    let at = zip.end.zip64End.directoryOffset
    for (let i = 0; i < zip.entries.length; i++) {
        starts.push(at)
        at += 46 + dv.getUint16(at + 28, true) + dv.getUint16(at + 30, true) + dv.getUint16(at + 32, true)
    }
    return {
        zip,
        starts,
        eocd,
        locator: eocd - 20,
        zip64End: zip.end.locator.zip64EndOffset,
        directoryOffset: zip.end.zip64End.directoryOffset,
        directoryEnd: at,
    }
}

function centralStart(l: Layout, name: string): number {
    const i = l.zip.entries.findIndex((entry) => entry.name === name)
    if (i < 0) {
        throw new Error(`no entry ${name}`)
    }
    return l.starts[i]
}

function localStart(l: Layout, name: string): number {
    const entry = l.zip.entries.find((candidate) => candidate.name === name)
    if (!entry) {
        throw new Error(`no entry ${name}`)
    }
    return entry.offset
}

/** Copy of `bytes` with `change` applied to a DataView over the copy. */
function patched(bytes: Uint8Array, change: (dv: DataView, l: Layout) => void): Uint8Array {
    const l = layout(bytes)
    const copy = bytes.slice()
    change(new DataView(copy.buffer), l)
    return copy
}

interface ReassembleOptions {
    comment?: Uint8Array
    /** Bytes of extensible data after the fixed ZIP64 end record fields. */
    extensible?: number
    /** Replaces the entry bytes that precede the directory. */
    body?: Uint8Array
}

/** Rewrites the directory and the end records from `records`, independently of the product writer. */
function reassemble(bytes: Uint8Array, l: Layout, records: Uint8Array[], options: ReassembleOptions = {}): Uint8Array {
    const body = options.body ?? bytes.slice(0, l.directoryOffset)
    const directory = concat(records)
    const extensible = options.extensible ?? 0
    const zip64 = new Uint8Array(56 + extensible)
    const zv = new DataView(zip64.buffer)
    zv.setUint32(0, 0x06064b50, true)
    zv.setBigUint64(4, BigInt(44 + extensible), true)
    zv.setUint16(12, 0x032D, true)
    zv.setUint16(14, 45, true)
    zv.setBigUint64(24, BigInt(records.length), true)
    zv.setBigUint64(32, BigInt(records.length), true)
    zv.setBigUint64(40, BigInt(directory.length), true)
    zv.setBigUint64(48, BigInt(body.length), true)
    for (let i = 0; i < extensible; i++) {
        zip64[56 + i] = 0xA5
    }
    const locator = new Uint8Array(20)
    const lv = new DataView(locator.buffer)
    lv.setUint32(0, 0x07064b50, true)
    lv.setBigUint64(8, BigInt(body.length + directory.length), true)
    lv.setUint32(16, 1, true)
    const comment = options.comment ?? new Uint8Array(0)
    const end = new Uint8Array(22 + comment.length)
    const ev = new DataView(end.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(8, records.length, true)
    ev.setUint16(10, records.length, true)
    ev.setUint32(12, directory.length, true)
    ev.setUint32(16, body.length, true)
    ev.setUint16(20, comment.length, true)
    end.set(comment, 22)
    return concat([body, directory, zip64, locator, end])
}

function records(bytes: Uint8Array, l: Layout): Uint8Array[] {
    return l.starts.map((start, i) => bytes.slice(start, i + 1 < l.starts.length ? l.starts[i + 1] : l.directoryEnd))
}

function renameInPlace(dv: DataView, at: number, name: string): void {
    const bytes = encoder.encode(name)
    for (let i = 0; i < bytes.length; i++) {
        dv.setUint8(at + i, bytes[i])
    }
}

async function walk(bytes: Uint8Array): Promise<DirectoryWalk> {
    return readDirectory(rangeSourceOfBytes(bytes))
}

function codesOf(result: { findings: ContainerFinding[] }): string[] {
    return result.findings.map((finding) => finding.code).sort()
}

async function readAll(source: RangeSource, index: ZipIndex, i: number) {
    const parts: Uint8Array[] = []
    const result = await readEntry(source, index, i, (chunk) => {
        parts.push(chunk.slice())
    })
    return { result, bytes: concat(parts) }
}

function indexOf(walked: DirectoryWalk): ZipIndex {
    if (!walked.index) {
        throw new Error('the walk produced no index')
    }
    return walked.index
}

describe('base fixture', () => {
    test('is real writer output: two descriptor entries, manifest first, no findings', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const flags = new Map(l.zip.entries.map((entry) => [entry.name, entry.flags]))
        expect((flags.get('a/big')! & 8)).toBe(8)
        expect((flags.get('a/bigz')! & 8)).toBe(8)
        expect((flags.get('u/1/0.blk')! & 8)).toBe(0)
        expect(l.zip.entries[0].name).toBe('manifest.json')
        const walked = await walk(bytes)
        expect(walked.findings).toEqual([])
        expect(indexOf(walked).count).toBe(7)
    })

    test('every entry reads back byte-exact with its CRC checked', async () => {
        const bytes = await baseFile()
        const source = rangeSourceOfBytes(bytes)
        const walked = await walk(bytes)
        const index = indexOf(walked)
        for (const spec of baseSpecs()) {
            const [i] = index.find(spec.name)
            const { result, bytes: body } = await readAll(source, index, i)
            expect(result).toEqual({ ok: true, size: spec.body.length })
            expect(body).toEqual(spec.body)
        }
    })
})

describe('T2r sizes come from the central directory', () => {
    test('wrong local CRC and sizes do not matter', async () => {
        const bytes = await baseFile()
        const copy = patched(bytes, (dv, l) => {
            for (const name of ['u/1/0.blk', 'a/bigz', 'x/unknown/one']) {
                const at = localStart(l, name)
                dv.setUint32(at + 14, 0x12345678, true)
                dv.setUint32(at + 18, 7, true)
                dv.setUint32(at + 22, 7, true)
            }
        })
        const source = rangeSourceOfBytes(copy)
        const index = indexOf(await walk(copy))
        for (const name of ['u/1/0.blk', 'a/bigz', 'x/unknown/one']) {
            const expected = baseSpecs().find((spec) => spec.name === name)!.body
            const [i] = index.find(name)
            const { result, bytes: body } = await readAll(source, index, i)
            expect(result.ok).toBe(true)
            expect(body).toEqual(expected)
        }
    })
})

describe('T21 manifest at any central position', () => {
    test('found when first, last and in the middle', async () => {
        const first = await baseFile()
        const l = layout(first)
        const all = records(first, l)
        const order = [...all]
        const manifestRecord = order.shift()!
        const last = reassemble(first, l, [...order, manifestRecord])
        const middle = reassemble(first, l, [order[0], order[1], manifestRecord, ...order.slice(2)])
        for (const bytes of [first, last, middle]) {
            const walked = await walk(bytes)
            expect(walked.findings).toEqual([])
            const index = indexOf(walked)
            const found = index.find('manifest.json')
            expect(found.length).toBe(1)
            expect(index.name(found[0])).toBe('manifest.json')
            expect(index.find('absent.json')).toEqual([])
            const { result, bytes: body } = await readAll(rangeSourceOfBytes(bytes), index, found[0])
            expect(result.ok).toBe(true)
            expect(body).toEqual(BODY.manifest)
        }
    })
})

describe('T23 each A1.1 case is damaged', () => {
    async function oneFinding(mutate: (dv: DataView, l: Layout) => void, code: string): Promise<DirectoryWalk> {
        const copy = patched(await baseFile(), mutate)
        const walked = await walk(copy)
        expect(codesOf(walked)).toEqual([code])
        return walked
    }

    test('1-3 flag bits 0, 6 and 13', async () => {
        for (const bit of [0x0001, 0x0040, 0x2000]) {
            await oneFinding((dv, l) => {
                const at = centralStart(l, 'x/unknown/one') + 8
                dv.setUint16(at, dv.getUint16(at, true) | bit, true)
            }, 'flags')
        }
    })

    test('4 central disk-start nonzero', async () => {
        await oneFinding((dv, l) => dv.setUint16(centralStart(l, 'x/unknown/one') + 34, 1, true), 'disk')
    })

    test('5-6 classic end record disk number and disk with the directory', async () => {
        await oneFinding((dv, l) => dv.setUint16(l.eocd + 4, 1, true), 'disk')
        await oneFinding((dv, l) => dv.setUint16(l.eocd + 6, 1, true), 'disk')
    })

    test('7-8 ZIP64 end record disk number and disk with the directory', async () => {
        await oneFinding((dv, l) => dv.setUint32(l.zip64End + 16, 1, true), 'disk')
        await oneFinding((dv, l) => dv.setUint32(l.zip64End + 20, 1, true), 'disk')
    })

    test('9 locator disk-with-ZIP64-end', async () => {
        await oneFinding((dv, l) => dv.setUint32(l.locator + 4, 1, true), 'disk')
    })

    test('10 locator total disks 2', async () => {
        await oneFinding((dv, l) => dv.setUint32(l.locator + 16, 2, true), 'disk')
    })

    test('11 duplicate raw name', async () => {
        const walked = await oneFinding((dv, l) => renameInPlace(dv, centralStart(l, 'u/2/0.blk') + 46, 'u/1/0.blk'), 'duplicate')
        expect(walked.findings[0].name).toBe('u/1/0.blk')
    })

    test('12 overlap caught by the walk lower bound', async () => {
        await oneFinding((dv, l) => {
            const at = centralStart(l, 'u/1/0.blk') + 20
            dv.setUint32(at, dv.getUint32(at, true) + 5, true)
        }, 'overlap')
    })

    test('13 overlap that only the local extra length reveals is caught by checkLocalHeaders', async () => {
        const copy = patched(await baseFile(), (dv, l) => {
            const central = centralStart(l, 'x/unknown/one')
            dv.setUint32(central + 20, BODY.unknown.length - 10, true)
            dv.setUint32(central + 24, BODY.unknown.length - 10, true)
            dv.setUint16(localStart(l, 'x/unknown/one') + 28, 20, true)
        })
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        const index = indexOf(walked)
        const found = await checkLocalHeaders(rangeSourceOfBytes(copy), index)
        expect(codesOf({ findings: found })).toEqual(['overlap'])
        expect(found[0].name).toBe('x/unknown/one')
        const [i] = index.find('x/unknown/one')
        const read = await readAll(rangeSourceOfBytes(copy), index, i)
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('overlap')
        }
    })

    test('14 offset past the end of the file', async () => {
        await oneFinding((dv, l) => dv.setUint32(centralStart(l, 'u/2/0.blk') + 42, 0x7FFFFFF0, true), 'offset')
    })

    test('15 local name differs from the central record', async () => {
        const copy = patched(await baseFile(), (dv, l) => dv.setUint8(localStart(l, 'u/1/0.blk') + 30, 'U'.charCodeAt(0)))
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        const found = await checkLocalHeaders(rangeSourceOfBytes(copy), indexOf(walked))
        expect(codesOf({ findings: found })).toEqual(['local-name'])
        const [i] = indexOf(walked).find('u/1/0.blk')
        const read = await readAll(rangeSourceOfBytes(copy), indexOf(walked), i)
        expect(read.result.ok).toBe(false)
    })

    test('16 method 12', async () => {
        await oneFinding((dv, l) => dv.setUint16(centralStart(l, 'x/unknown/one') + 10, 12, true), 'method')
    })

    test('17 a sentinel field with no ZIP64 extra', async () => {
        await oneFinding((dv, l) => dv.setUint32(centralStart(l, 'u/2/0.blk') + 20, 0xFFFFFFFF, true), 'zip64-extra')
    })

    test('18 a ZIP64 extra too short for its sentinel fields', async () => {
        await oneFinding((dv, l) => {
            const start = centralStart(l, 'a/big')
            const extra = start + 46 + dv.getUint16(start + 28, true)
            dv.setUint16(extra + 2, 8, true)
        }, 'zip64-extra')
    })

    test('19 method 0 with a central compressed size that differs from the uncompressed size', async () => {
        await oneFinding((dv, l) => {
            const at = centralStart(l, 'x/unknown/one') + 24
            dv.setUint32(at, dv.getUint32(at, true) - 1, true)
        }, 'stored-size')
    })

    test('method 93 passes the walk (refusal belongs to the known-section rule) but is not readable', async () => {
        const copy = patched(await baseFile(), (dv, l) => dv.setUint16(centralStart(l, 'x/unknown/one') + 10, 93, true))
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        const index = indexOf(walked)
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('x/unknown/one')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('method')
        }
    })
})

describe('T23b descriptor bytes are not an overlap', () => {
    test('the walk and the local header check are silent on descriptor entries', async () => {
        const bytes = await baseFile()
        const walked = await walk(bytes)
        expect(walked.findings).toEqual([])
        expect(await checkLocalHeaders(rangeSourceOfBytes(bytes), indexOf(walked))).toEqual([])
    })

    test('a descriptor flag with no descriptor bytes is still not an overlap (descriptors are outside the extent)', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const target = l.zip.entries.find((entry) => entry.name === 'a/big')!
        const descriptorAt = target.local.dataStart + target.compressedSize
        const body = concat([bytes.slice(0, descriptorAt), bytes.slice(descriptorAt + 24, l.directoryOffset)])
        const all = records(bytes, l)
        l.zip.entries.forEach((entry, i) => {
            if (entry.offset <= descriptorAt) {
                return
            }
            const record = all[i]
            const rv = new DataView(record.buffer, record.byteOffset, record.byteLength)
            if (rv.getUint32(42, true) === 0xFFFFFFFF) {
                // Descriptor form: the offset is the third field of the 24-byte ZIP64 extra.
                const extraAt = 46 + rv.getUint16(28, true)
                rv.setBigUint64(extraAt + 4 + 16, BigInt(entry.offset - 24), true)
            } else {
                rv.setUint32(42, entry.offset - 24, true)
            }
        })
        const copy = reassemble(bytes, l, all, { body })
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        const index = indexOf(walked)
        expect(await checkLocalHeaders(rangeSourceOfBytes(copy), index)).toEqual([])
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('a/big')[0])
        expect(read.result.ok).toBe(true)
        expect(read.bytes).toEqual(BODY.big)
    })

    test('the include filter limits which local headers are read', async () => {
        const copy = patched(await baseFile(), (dv, l) => dv.setUint8(localStart(l, 'u/1/0.blk') + 30, 'U'.charCodeAt(0)))
        const index = indexOf(await walk(copy))
        const source = rangeSourceOfBytes(copy)
        expect(await checkLocalHeaders(source, index, (i) => index.name(i).startsWith('a/'))).toEqual([])
        expect(codesOf({ findings: await checkLocalHeaders(source, index, (i) => index.name(i).startsWith('u/')) })).toEqual(['local-name'])
    })
})

describe('T-dup duplicate names are decided by the whole raw name', () => {
    test('prefixes and names differing in the last byte are not duplicates', async () => {
        const body = sample(5)
        const bytes = await build(['a/x', 'a/x0', 'a/xy', 'a/xz', 'a/x00', 'b'].map((name) => ({ name, body })))
        const walked = await walk(bytes)
        expect(walked.findings).toEqual([])
        expect(indexOf(walked).find('a/x').length).toBe(1)
    })

    test('a byte-equal pair is damaged', async () => {
        const body = sample(5)
        const bytes = await build(['a/x', 'a/x0', 'a/x', 'a/y'].map((name) => ({ name, body })))
        const walked = await walk(bytes)
        expect(codesOf(walked)).toEqual(['duplicate'])
        expect(walked.findings[0].name).toBe('a/x')
        expect(indexOf(walked).find('a/x').length).toBe(2)
    })
})

describe('T-disk accepted disk encodings', () => {
    test('locator total disks 0', async () => {
        const copy = patched(await baseFile(), (dv, l) => dv.setUint32(l.locator + 16, 0, true))
        expect((await walk(copy)).findings).toEqual([])
    })

    test('classic disk fields 0xFFFF when the ZIP64 end record is present', async () => {
        const copy = patched(await baseFile(), (dv, l) => {
            dv.setUint16(l.eocd + 4, 0xFFFF, true)
            dv.setUint16(l.eocd + 6, 0xFFFF, true)
        })
        expect((await walk(copy)).findings).toEqual([])
    })

    test('central disk-start 0xFFFF with a ZIP64 extra disk field of 0', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const all = records(bytes, l)
        const i = l.zip.entries.findIndex((entry) => entry.name === 'a/big')
        const old = all[i]
        const nameLength = new DataView(old.buffer, old.byteOffset).getUint16(28, true)
        const extraAt = 46 + nameLength
        const widened = concat([old, new Uint8Array(4)])
        const wv = new DataView(widened.buffer)
        wv.setUint16(30, wv.getUint16(30, true) + 4, true)
        wv.setUint16(34, 0xFFFF, true)
        wv.setUint16(extraAt + 2, wv.getUint16(extraAt + 2, true) + 4, true)
        all[i] = widened
        const copy = reassemble(bytes, l, all)
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        const index = indexOf(walked)
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('a/big')[0])
        expect(read.bytes).toEqual(BODY.big)
    })

    test('central disk-start 0xFFFF with a nonzero extra disk field is damaged', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const all = records(bytes, l)
        const i = l.zip.entries.findIndex((entry) => entry.name === 'a/big')
        const old = all[i]
        const nameLength = new DataView(old.buffer, old.byteOffset).getUint16(28, true)
        const extraAt = 46 + nameLength
        const widened = concat([old, new Uint8Array([2, 0, 0, 0])])
        const wv = new DataView(widened.buffer)
        wv.setUint16(30, wv.getUint16(30, true) + 4, true)
        wv.setUint16(34, 0xFFFF, true)
        wv.setUint16(extraAt + 2, wv.getUint16(extraAt + 2, true) + 4, true)
        all[i] = widened
        expect(codesOf(await walk(reassemble(bytes, l, all)))).toEqual(['disk'])
    })
})

describe('T-acc accepted APPNOTE variations', () => {
    test('an end record comment', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const copy = reassemble(bytes, l, records(bytes, l), { comment: encoder.encode('made by hand') })
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        expect(indexOf(walked).count).toBe(7)
    })

    test('an unknown extra before the ZIP64 extra', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const all = records(bytes, l)
        const i = l.zip.entries.findIndex((entry) => entry.name === 'a/bigz')
        const old = all[i]
        const nameLength = new DataView(old.buffer, old.byteOffset).getUint16(28, true)
        const extraAt = 46 + nameLength
        const unknown = new Uint8Array([0x99, 0x99, 4, 0, 1, 2, 3, 4])
        const widened = concat([old.subarray(0, extraAt), unknown, old.subarray(extraAt)])
        const wv = new DataView(widened.buffer)
        wv.setUint16(30, wv.getUint16(30, true) + unknown.length, true)
        all[i] = widened
        const copy = reassemble(bytes, l, all)
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        const index = indexOf(walked)
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('a/bigz')[0])
        expect(read.bytes).toEqual(BODY.bigz)
    })

    test('a descriptor on a deflated entry', async () => {
        const bytes = await baseFile()
        const index = indexOf(await walk(bytes))
        const i = index.find('a/bigz')[0]
        expect(index.entry(i).method).toBe(8)
        expect(index.entry(i).flags & 8).toBe(8)
        const read = await readAll(rangeSourceOfBytes(bytes), index, i)
        expect(read.result.ok).toBe(true)
        expect(read.bytes).toEqual(BODY.bigz)
    })

    test('a ZIP64 end record with extensible data is followed through the locator', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const copy = reassemble(bytes, l, records(bytes, l), { extensible: 12 })
        const walked = await walk(copy)
        expect(walked.findings).toEqual([])
        expect(indexOf(walked).count).toBe(7)
    })
})

describe('T-crcbad a damaged body is damaged on read', () => {
    test('a flipped byte in a stored entry fails the CRC', async () => {
        const bytes = await baseFile()
        const copy = patched(bytes, (dv, l) => {
            const entry = l.zip.entries.find((candidate) => candidate.name === 'x/unknown/one')!
            dv.setUint8(entry.local.dataStart + 3, dv.getUint8(entry.local.dataStart + 3) ^ 0x40)
        })
        const index = indexOf(await walk(copy))
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('x/unknown/one')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('crc')
            expect(read.result.finding.name).toBe('x/unknown/one')
        }
    })

    test('a wrong central CRC on a deflated entry fails', async () => {
        const copy = patched(await baseFile(), (dv, l) => dv.setUint32(centralStart(l, 'u/1/0.blk') + 16, 0xDEADBEEF, true))
        const index = indexOf(await walk(copy))
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('u/1/0.blk')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('crc')
        }
    })

    /** A one-byte body is checked against its central CRC like any other size. */
    async function oneByteFile(): Promise<Uint8Array> {
        return build([
            { name: 'mimetype', method: 0, body: BODY.mime },
            { name: 'o/stored', method: 0, body: new Uint8Array([0x41]) },
            { name: 'o/deflated', method: 8, body: new Uint8Array([0x42]) },
        ])
    }

    test('an intact one-byte stored entry and one-byte deflated entry read back', async () => {
        const bytes = await oneByteFile()
        const index = indexOf(await walk(bytes))
        for (const [name, value] of [['o/stored', 0x41], ['o/deflated', 0x42]] as const) {
            const read = await readAll(rangeSourceOfBytes(bytes), index, index.find(name)[0])
            expect(read.result.ok).toBe(true)
            expect(Array.from(read.bytes)).toEqual([value])
        }
    })

    test('a flipped byte in a one-byte stored entry fails the CRC', async () => {
        const copy = patched(await oneByteFile(), (dv, l) => {
            const entry = l.zip.entries.find((candidate) => candidate.name === 'o/stored')!
            dv.setUint8(entry.local.dataStart, dv.getUint8(entry.local.dataStart) ^ 0x40)
        })
        const index = indexOf(await walk(copy))
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('o/stored')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('crc')
            expect(read.result.finding.name).toBe('o/stored')
        }
    })

    test('a wrong central CRC on a one-byte deflated entry fails', async () => {
        const copy = patched(await oneByteFile(), (dv, l) => dv.setUint32(centralStart(l, 'o/deflated') + 16, 0xDEADBEEF, true))
        const index = indexOf(await walk(copy))
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('o/deflated')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('crc')
            expect(read.result.finding.name).toBe('o/deflated')
        }
    })
})

describe('T44 inflation bound', () => {
    async function bombFile(): Promise<Uint8Array> {
        return build([
            { name: 'z/bomb', method: 8, body: new Uint8Array(1024 * 1024) },
            { name: 'z/short', method: 8, body: sample(100, 9) },
            { name: 'z/ok', method: 8, body: sample(100, 9) },
        ])
    }

    test('output beyond the declared size is damaged and at most size+1 bytes are delivered', async () => {
        const copy = patched(await bombFile(), (dv, l) => dv.setUint32(centralStart(l, 'z/bomb') + 24, 10, true))
        const index = indexOf(await walk(copy))
        let delivered = 0
        const result = await readEntry(rangeSourceOfBytes(copy), index, index.find('z/bomb')[0], (chunk) => {
            delivered += chunk.length
        })
        expect(result.ok).toBe(false)
        if (result.ok === false) {
            expect(result.finding.code).toBe('size')
        }
        expect(delivered).toBeLessThanOrEqual(11)
    })

    test('output shorter than the declared size is damaged', async () => {
        const copy = patched(await bombFile(), (dv, l) => dv.setUint32(centralStart(l, 'z/short') + 24, 150, true))
        const index = indexOf(await walk(copy))
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('z/short')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('size')
        }
    })

    test('a truncated deflate stream is damaged and never delivers more than declared', async () => {
        const bytes = await bombFile()
        const copy = patched(bytes, (dv, l) => {
            const at = centralStart(l, 'z/short') + 20
            dv.setUint32(at, dv.getUint32(at, true) - 6, true)
        })
        const index = indexOf(await walk(copy))
        const read = await readAll(rangeSourceOfBytes(copy), index, index.find('z/short')[0])
        expect(read.result.ok).toBe(false)
        if (read.result.ok === false) {
            expect(read.result.finding.code).toBe('inflate')
        }
        expect(read.bytes.length).toBeLessThanOrEqual(100)
    })

    test('a well-formed entry still reads', async () => {
        const bytes = await bombFile()
        const index = indexOf(await walk(bytes))
        const read = await readAll(rangeSourceOfBytes(bytes), index, index.find('z/ok')[0])
        expect(read.result.ok).toBe(true)
        expect(read.bytes).toEqual(sample(100, 9))
    })
})

describe('T24 names in the central directory', () => {
    async function nameFinding(name: string): Promise<string[]> {
        const bytes = await build([{ name: 'mimetype', body: BODY.mime }, { name, body: sample(4) }])
        return codesOf(await walk(bytes))
    }

    test('refused names are damaged', async () => {
        for (const name of ['u/\x01x', 'u/\x1Fx', 'u/\x7Fx', 'u/../x', 'u/./x', 'u//x', 'u/x/', '/u/x', 'u\\x', 'u/café']) {
            expect(await nameFinding(name), JSON.stringify(name)).toEqual(['name'])
        }
    })

    test('a 65,535 byte name is accepted', async () => {
        expect(await nameFinding(`x/${'b'.repeat(65533)}`)).toEqual([])
    })

    test('T24x the ASCII rule holds in an unknown section and outside every prefix', async () => {
        expect(await nameFinding('x/unknown/café')).toEqual(['name'])
        expect(await nameFinding('outside-café')).toEqual(['name'])
    })
})

describe('T-col the walk collects findings', () => {
    test('a duplicate and an overlap are both returned with the index and the manifest record', async () => {
        const copy = patched(await baseFile(), (dv, l) => {
            renameInPlace(dv, centralStart(l, 'u/2/0.blk') + 46, 'u/1/0.blk')
            const at = centralStart(l, 'x/unknown/one') + 20
            dv.setUint32(at, dv.getUint32(at, true) + 5, true)
            dv.setUint32(centralStart(l, 'x/unknown/one') + 24, dv.getUint32(at, true), true)
        })
        const walked = await walk(copy)
        expect(codesOf(walked)).toEqual(['duplicate', 'overlap'])
        const index = indexOf(walked)
        expect(index.count).toBe(7)
        expect(index.find('manifest.json').length).toBe(1)
    })
})

describe('structure that cannot be walked', () => {
    test('a file without end records has no index and one finding', async () => {
        const walked = await walk(sample(500))
        expect(walked.index).toBeNull()
        expect(codesOf(walked)).toEqual(['end-records'])
    })

    test('a file shorter than an end record has no index', async () => {
        const walked = await walk(new Uint8Array(10))
        expect(walked.index).toBeNull()
        expect(codesOf(walked)).toEqual(['end-records'])
    })

    test('a truncated file has no index', async () => {
        const bytes = await baseFile()
        const walked = await walk(bytes.slice(0, bytes.length - 10))
        expect(walked.index).toBeNull()
        expect(codesOf(walked)).toEqual(['end-records'])
    })

    test('the walk stops at the first record it cannot parse and still returns what it walked', async () => {
        const copy = patched(await baseFile(), (dv, l) => dv.setUint32(l.starts[3], 0x11111111, true))
        const walked = await walk(copy)
        expect(codesOf(walked)).toEqual(['directory'])
        expect(walked.complete).toBe(false)
        expect(indexOf(walked).count).toBe(3)
    })
})

describe('T37 a short read is could-not-read, never parsed', () => {
    function shortOn(bytes: Uint8Array, shortWhen: (start: number, end: number) => boolean) {
        const calls: number[] = []
        const source = rangeSourceFrom({
            size: bytes.length,
            async read(start: number, end: number): Promise<Uint8Array> {
                calls.push(start)
                return shortWhen(start, end) ? bytes.slice(start, end - 1) : bytes.slice(start, end)
            },
        })
        return { source, calls }
    }

    test('a short tail read', async () => {
        const bytes = await baseFile()
        const { source, calls } = shortOn(bytes, () => true)
        await expect(readDirectory(source)).rejects.toBeInstanceOf(RtbCouldNotReadError)
        expect(calls.length).toBe(1)
    })

    test('a short directory read', async () => {
        const bytes = await baseFile()
        const l = layout(bytes)
        const { source } = shortOn(bytes, (start) => start === l.directoryOffset)
        await expect(readDirectory(source)).rejects.toBeInstanceOf(RtbCouldNotReadError)
    })

    test('a short body read', async () => {
        const bytes = await baseFile()
        const index = indexOf(await walk(bytes))
        const l = layout(bytes)
        const entry = l.zip.entries.find((candidate) => candidate.name === 'x/unknown/one')!
        const { source } = shortOn(bytes, (start) => start === entry.local.dataStart)
        await expect(readEntry(source, index, index.find('x/unknown/one')[0], () => {})).rejects.toBeInstanceOf(RtbCouldNotReadError)
    })

    test('a short local header read', async () => {
        const bytes = await baseFile()
        const index = indexOf(await walk(bytes))
        const { source } = shortOn(bytes, (start, end) => end - start === 30)
        await expect(checkLocalHeaders(source, index)).rejects.toBeInstanceOf(RtbCouldNotReadError)
    })
})

describe('T11 the prefix is decided before any directory read', () => {
    test('RTBX is reported sealed and nothing past the prefix is read', async () => {
        const sealed = new Uint8Array(4096)
        sealed.set([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 0x01, 0x00])
        const reads: Array<[number, number]> = []
        const source = rangeSourceFrom({
            size: sealed.length,
            async read(start: number, end: number): Promise<Uint8Array> {
                reads.push([start, end])
                return sealed.slice(start, end)
            },
        })
        const opened = await openContainer(source)
        expect(opened).toEqual({ kind: 'sealed', envelopeVersion: 1 })
        expect(reads.length).toBeGreaterThan(0)
        for (const [start, end] of reads) {
            expect(start).toBe(0)
            expect(end).toBeLessThanOrEqual(68)
        }
    })

    test('RTBX with another rest of the magic is damaged', async () => {
        const bytes = new Uint8Array(4096)
        bytes.set([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0B, 0x01, 0x00])
        expect(await openContainer(rangeSourceOfBytes(bytes))).toEqual({ kind: 'sealed-damaged' })
    })

    test('a zip without a leading mimetype entry is not an rtb and is not walked', async () => {
        const bytes = await build([{ name: 'other.txt', body: sample(100) }])
        expect(await openContainer(rangeSourceOfBytes(bytes))).toEqual({ kind: 'not-an-rtb' })
    })

    test('a real container is opened with its walk', async () => {
        const bytes = await baseFile()
        const opened = await openContainer(rangeSourceOfBytes(bytes))
        expect(opened.kind).toBe('zip')
        if (opened.kind === 'zip') {
            expect(opened.walk.findings).toEqual([])
            expect(indexOf(opened.walk).count).toBe(7)
        }
    })
})
