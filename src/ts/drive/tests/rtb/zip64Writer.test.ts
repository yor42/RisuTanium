import { describe, test, expect } from 'vitest'
import { crc32 as crcPackage } from 'crc'
import { Zip64Writer, fillPiece, type ZipPiece, type ZipSink } from 'src/ts/drive/rtb/zip64Writer'
import { needsZip64, needsZip64Count } from 'src/ts/drive/rtb/zip64Format'
import { SegmentSink } from './segmentSink'
import { parseZip, readBody, readDescriptor, decodeDos } from './zipTestParser'

const CREATED = Date.UTC(2023, 4, 17, 13, 45, 31)
const GIB4 = 2 ** 32

function sample(length: number, salt = 1): Uint8Array {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = ((i * 31 + salt * 17) ^ (i >> 3)) & 0xFF
    }
    return out
}

async function* pieces(...parts: ZipPiece[]): AsyncGenerator<ZipPiece> {
    for (const part of parts) {
        yield part
    }
}

function setup(options: { bufferLimit?: number, m6ZeroLocalSizes?: boolean, fills?: boolean, createdAt?: number } = {}) {
    const sink = new SegmentSink({ fills: options.fills })
    const writer = new Zip64Writer({
        sink,
        createdAt: options.createdAt ?? CREATED,
        bufferLimit: options.bufferLimit,
        m6ZeroLocalSizes: options.m6ZeroLocalSizes,
    })
    return { sink, writer }
}

function crcOf(bytes: Uint8Array): number {
    return crcPackage(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)) >>> 0
}

describe('T-sent sentinel thresholds', () => {
    test('32-bit values use ZIP64 at 0xFFFFFFFF and above', () => {
        expect(needsZip64(0xFFFFFFFE)).toBe(false)
        expect(needsZip64(0xFFFFFFFF)).toBe(true)
        expect(needsZip64(GIB4)).toBe(true)
        expect(needsZip64(0)).toBe(false)
    })

    test('16-bit counts use ZIP64 at 0xFFFF and above', () => {
        expect(needsZip64Count(0xFFFE)).toBe(false)
        expect(needsZip64Count(0xFFFF)).toBe(true)
        expect(needsZip64Count(0x10000)).toBe(true)
    })
})

describe('T-hdr header fields', () => {
    test('made-by, attributes, flags and DOS time of a small entry', async () => {
        const { sink, writer } = setup()
        const body = sample(300)
        await writer.addBuffered('a.bin', 0, body, body.length)
        await writer.addBuffered('b.bin', 8, body, body.length)
        await writer.finish()
        const zip = parseZip(sink)
        expect(zip.entries.map((e) => e.name)).toEqual(['a.bin', 'b.bin'])
        for (const entry of zip.entries) {
            expect(entry.madeBy).toBe(0x032D)
            expect(entry.externalAttrs >>> 0).toBe(0x81A40000)
            expect(entry.internalAttrs).toBe(0)
            expect(entry.diskStart).toBe(0)
            expect(entry.flags & 0x0800).toBe(0x0800)
            expect(entry.flags & 0x0006).toBe(0)
            expect(entry.local.flags & 0x0800).toBe(0x0800)
            expect(entry.local.flags & 0x0006).toBe(0)
            expect(entry.extra.length).toBe(0)
            const stamp = decodeDos(entry.dosDate, entry.dosTime)
            expect(stamp).toEqual({ year: 2023, month: 5, day: 17, hour: 13, minute: 45, second: 30 })
            expect(entry.local.dosDate).toBe(entry.dosDate)
            expect(entry.local.dosTime).toBe(entry.dosTime)
        }
    })

    test('a time before 1980 clamps to 1980-01-01 00:00:00', async () => {
        const { sink, writer } = setup({ createdAt: Date.UTC(1975, 6, 4, 9, 8, 7) })
        await writer.addBuffered('a', 0, sample(4), 4)
        await writer.finish()
        const entry = parseZip(sink).entries[0]
        expect(decodeDos(entry.dosDate, entry.dosTime)).toEqual({ year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 })
    })
})

describe('T-ver version needed and end-record pins', () => {
    test('20 for a small local-header entry, 45 for a descriptor entry', async () => {
        const { sink, writer } = setup({ bufferLimit: 1024 })
        await writer.addBuffered('small', 0, sample(10), 10)
        await writer.addBuffered('large', 0, sample(2000), 2000)
        await writer.finish()
        const [small, large] = parseZip(sink).entries
        expect(small.versionNeeded).toBe(20)
        expect(small.local.versionNeeded).toBe(20)
        expect(large.versionNeeded).toBe(45)
        expect(large.local.versionNeeded).toBe(45)
    })

    test('a local-header entry past 4 GiB carries 45 in both headers', async () => {
        const { sink, writer } = setup()
        await writer.addStreamed('big', 0, pieces(fillPiece(0, GIB4)), null)
        await writer.addBuffered('after', 0, sample(20), 20)
        await writer.finish()
        const zip = parseZip(sink)
        const after = zip.entries[1]
        expect(after.offset).toBeGreaterThanOrEqual(0xFFFFFFFF)
        expect(after.versionNeeded).toBe(45)
        expect(after.local.versionNeeded).toBe(45)
        // The local header itself needs no ZIP64 extra: sizes are real 32-bit values.
        expect(after.local.extra.length).toBe(0)
        expect(after.local.compressedSize32).toBe(20)
        expect(readBody(zip, after)).toEqual(sample(20))
    })

    test('ZIP64 end record size 44, made-by, version 45 and a locator with one disk', async () => {
        const { sink, writer } = setup()
        await writer.addBuffered('a', 0, sample(3), 3)
        await writer.finish()
        const { end } = parseZip(sink)
        expect(end.zip64End.recordSize).toBe(44)
        expect(end.zip64End.madeBy).toBe(0x032D)
        expect(end.zip64End.versionNeeded).toBe(45)
        expect(end.zip64End.diskNumber).toBe(0)
        expect(end.zip64End.directoryDisk).toBe(0)
        expect(end.locator.diskWithZip64End).toBe(0)
        expect(end.locator.totalDisks).toBe(1)
        expect(end.classic.commentLength).toBe(0)
    })
})

describe('T2 descriptor form', () => {
    for (const method of [0, 8] as const) {
        for (const route of ['buffered', 'streamed'] as const) {
            test(`method ${method} ${route}`, async () => {
                const { sink, writer } = setup({ bufferLimit: 1024 })
                const body = sample(5000, 3)
                if (route === 'buffered') {
                    await writer.addBuffered('d.bin', method, body, body.length)
                } else {
                    await writer.addStreamed('d.bin', method, pieces(body.subarray(0, 1700), body.subarray(1700)), null)
                }
                await writer.finish()
                const zip = parseZip(sink)
                const entry = zip.entries[0]
                expect(entry.method).toBe(method)
                expect(entry.flags).toBe(0x0808)
                expect(entry.local.flags).toBe(0x0808)
                expect(entry.local.crc).toBe(0)
                expect(entry.local.compressedSize32).toBe(0xFFFFFFFF)
                expect(entry.local.uncompressedSize32).toBe(0xFFFFFFFF)
                expect(entry.local.extraFields).toHaveLength(1)
                expect(entry.local.extraFields[0].id).toBe(1)
                expect(Array.from(entry.local.extraFields[0].data)).toEqual(new Array(16).fill(0))
                expect(entry.local.extra.length).toBe(20)
                expect(entry.compressedSize32).toBe(0xFFFFFFFF)
                expect(entry.uncompressedSize32).toBe(0xFFFFFFFF)
                expect(entry.offset32).toBe(0xFFFFFFFF)
                expect(entry.extraFields).toHaveLength(1)
                expect(entry.extraFields[0].data.length).toBe(24)
                expect(entry.uncompressedSize).toBe(body.length)
                expect(entry.crc).toBe(crcOf(body))
                const descriptor = readDescriptor(zip, entry)
                expect(descriptor).toEqual({ crc: crcOf(body), compressedSize: entry.compressedSize, uncompressedSize: body.length })
                expect(readBody(zip, entry)).toEqual(body)
            })
        }
    }

    test('the M6 branch writes 0 in the local size fields and keeps the 16-byte extra', async () => {
        const { sink, writer } = setup({ bufferLimit: 1024, m6ZeroLocalSizes: true })
        await writer.addBuffered('d.bin', 0, sample(3000), 3000)
        await writer.finish()
        const entry = parseZip(sink).entries[0]
        expect(entry.local.compressedSize32).toBe(0)
        expect(entry.local.uncompressedSize32).toBe(0)
        expect(entry.local.extra.length).toBe(20)
        expect(entry.compressedSize32).toBe(0xFFFFFFFF)
    })

    test('a body of exactly BUFFER_LIMIT stays in local-header form, one byte more does not', async () => {
        const { sink, writer } = setup({ bufferLimit: 1024 })
        await writer.addBuffered('edge', 0, sample(1024), 1024)
        await writer.addBuffered('over', 0, sample(1025), 1025)
        await writer.finish()
        const [edge, over] = parseZip(sink).entries
        expect(edge.flags).toBe(0x0800)
        expect(edge.local.crc).toBe(edge.crc)
        expect(over.flags).toBe(0x0808)
    })

    test('a streamed entry with a known size up to BUFFER_LIMIT is written in local-header form', async () => {
        const { sink, writer } = setup({ bufferLimit: 1024 })
        const body = sample(900)
        await writer.addStreamed('s', 8, pieces(body.subarray(0, 400), body.subarray(400)), 900)
        await writer.finish()
        const zip = parseZip(sink)
        const entry = zip.entries[0]
        expect(entry.flags).toBe(0x0800)
        expect(entry.local.compressedSize32).toBe(entry.compressedSize)
        expect(entry.local.uncompressedSize32).toBe(900)
        expect(readBody(zip, entry)).toEqual(body)
    })
})

describe('T-bl BUFFER_LIMIT check at construction', () => {
    test('0xFFFFFFFF and above are refused, 0xFFFFFFFE is accepted', () => {
        const sink = new SegmentSink()
        expect(() => new Zip64Writer({ sink, createdAt: CREATED, bufferLimit: 0xFFFFFFFF })).toThrow()
        expect(() => new Zip64Writer({ sink, createdAt: CREATED, bufferLimit: GIB4 })).toThrow()
        expect(() => new Zip64Writer({ sink, createdAt: CREATED, bufferLimit: 0xFFFFFFFE })).not.toThrow()
    })
})

describe('T18 length check', () => {
    const limit = 1024
    for (const knownSize of [500, 2000]) {
        const form = knownSize <= limit ? 'local-header' : 'descriptor'
        test(`a body shorter than the known size fails (${form} form)`, async () => {
            const { writer } = setup({ bufferLimit: limit })
            await expect(writer.addStreamed('s', 0, pieces(sample(knownSize - 1)), knownSize)).rejects.toThrow()
        })
        test(`a body longer than the known size fails (${form} form)`, async () => {
            const { writer } = setup({ bufferLimit: limit })
            await expect(writer.addStreamed('s', 0, pieces(sample(knownSize), sample(1)), knownSize)).rejects.toThrow()
        })
        test(`a fill piece past the known size fails (${form} form)`, async () => {
            const { writer } = setup({ bufferLimit: limit })
            await expect(writer.addStreamed('s', 0, pieces(fillPiece(1, knownSize + 1)), knownSize)).rejects.toThrow()
        })
        test(`a buffered body whose length differs from the known size fails (${form} form)`, async () => {
            const { writer } = setup({ bufferLimit: limit })
            await expect(writer.addBuffered('s', 8, sample(knownSize), knownSize + 1)).rejects.toThrow()
            await expect(writer.addBuffered('s', 8, sample(knownSize), knownSize - 1)).rejects.toThrow()
        })
    }

    test('a writer that failed refuses further entries and finish', async () => {
        const { writer } = setup()
        await expect(writer.addBuffered('s', 0, sample(4), 5)).rejects.toThrow()
        await expect(writer.addBuffered('t', 0, sample(4), 4)).rejects.toThrow()
        await expect(writer.finish()).rejects.toThrow()
    })
})

describe('T19 CRC of every entry', () => {
    test('local-header, descriptor, deflated and fill entries carry the exact CRC', async () => {
        const { sink, writer } = setup({ bufferLimit: 2048 })
        const small = sample(700, 5)
        const large = sample(9000, 6)
        await writer.addBuffered('small0', 0, small, small.length)
        await writer.addBuffered('small8', 8, small, small.length)
        await writer.addBuffered('large0', 0, large, large.length)
        await writer.addBuffered('large8', 8, large, large.length)
        await writer.addStreamed('fill0', 0, pieces(small, fillPiece(0x7E, 3 * 1024 * 1024 + 5), large), null)
        await writer.addStreamed('fill8', 8, pieces(small, fillPiece(0x00, 2 * 1024 * 1024 + 9)), null)
        await writer.finish()
        const zip = parseZip(sink)
        for (const entry of zip.entries) {
            const body = readBody(zip, entry)
            expect(body.length).toBe(entry.uncompressedSize)
            expect(entry.crc).toBe(crcOf(body))
        }
        expect(zip.entries[4].uncompressedSize).toBe(small.length + 3 * 1024 * 1024 + 5 + large.length)
    })

    test('a fill piece through a sink without writeFill is expanded in chunks of at most 1 MiB', async () => {
        const { sink, writer } = setup({ fills: false })
        await writer.addStreamed('f', 0, pieces(fillPiece(0x41, 2 * 1024 * 1024 + 7)), null)
        await writer.finish()
        expect(sink.runs.every((run) => run.kind === 'data')).toBe(true)
        const biggest = Math.max(...sink.runs.map((run) => (run.kind === 'data' ? run.bytes.length : 0)))
        expect(biggest).toBeLessThanOrEqual(1024 * 1024)
        const zip = parseZip(sink)
        const body = readBody(zip, zip.entries[0])
        expect(body.length).toBe(2 * 1024 * 1024 + 7)
        expect(body.every((byte) => byte === 0x41)).toBe(true)
        expect(zip.entries[0].crc).toBe(crcOf(body))
    })

    test('a fill piece reaches a sink with writeFill as one fill run', async () => {
        const { sink, writer } = setup()
        await writer.addStreamed('f', 0, pieces(fillPiece(0x41, 5 * 1024 * 1024)), null)
        await writer.finish()
        const fills = sink.runs.filter((run) => run.kind === 'fill')
        expect(fills).toHaveLength(1)
        expect(fills[0]).toEqual({ kind: 'fill', length: 5 * 1024 * 1024, byte: 0x41 })
    })
})

describe('T-eocd / T-extra / T-order directory and end records', () => {
    test('the ZIP64 end record and locator are written for a small file; classic values are real', async () => {
        const { sink, writer } = setup()
        await writer.addBuffered('a', 0, sample(3), 3)
        await writer.addBuffered('b', 0, sample(3), 3)
        await writer.finish()
        const { end } = parseZip(sink)
        expect(end.zip64End.entries).toBe(2)
        expect(end.classic.entries).toBe(2)
        expect(end.classic.entriesOnDisk).toBe(2)
        expect(end.classic.directorySize).toBe(end.zip64End.directorySize)
        expect(end.classic.directoryOffset).toBe(end.zip64End.directoryOffset)
        expect(end.classic.diskNumber).toBe(0)
        expect(end.classic.directoryDisk).toBe(0)
        expect(sink.length).toBe(end.zip64End.directoryOffset + end.zip64End.directorySize + 56 + 20 + 22)
    })

    test('a directory offset past 4 GiB gives a sentinel in the classic offset only', async () => {
        const { sink, writer } = setup()
        await writer.addStreamed('big', 0, pieces(fillPiece(0, GIB4 + 1)), null)
        await writer.addBuffered('after', 0, sample(8), 8)
        await writer.finish()
        const { end } = parseZip(sink)
        expect(end.zip64End.directoryOffset).toBeGreaterThan(GIB4)
        expect(end.classic.directoryOffset).toBe(0xFFFFFFFF)
        expect(end.classic.directorySize).toBe(end.zip64End.directorySize)
        expect(end.classic.entries).toBe(2)
    })

    test('65,535 entries give the 16-bit count sentinel and the real ZIP64 count', async () => {
        const { sink, writer } = setup()
        const one = new Uint8Array([7])
        for (let i = 0; i < 65535; i++) {
            await writer.addBuffered(`e${i}`, 0, one, 1)
        }
        await writer.finish()
        const zip = parseZip(sink)
        expect(zip.end.classic.entries).toBe(0xFFFF)
        expect(zip.end.classic.entriesOnDisk).toBe(0xFFFF)
        expect(zip.end.zip64End.entries).toBe(65535)
        expect(zip.entries).toHaveLength(65535)
        expect(zip.entries[65534].name).toBe('e65534')
    })

    test('the central extra holds exactly the sentinel fields', async () => {
        const { sink, writer } = setup({ bufferLimit: 1024 })
        await writer.addBuffered('plain', 0, sample(10), 10)
        await writer.addBuffered('desc', 0, sample(3000), 3000)
        await writer.addStreamed('big', 0, pieces(fillPiece(0, GIB4)), null)
        await writer.addBuffered('pastFourGiB', 0, sample(10), 10)
        await writer.finish()
        const [plain, desc, , past] = parseZip(sink).entries
        expect(plain.extra.length).toBe(0)
        expect(desc.extra.length).toBe(28)
        expect(past.extra.length).toBe(12)
        expect(past.extraFields[0].data.length).toBe(8)
        expect(past.compressedSize32).toBe(10)
        expect(past.uncompressedSize32).toBe(10)
        expect(past.offset32).toBe(0xFFFFFFFF)
    })

    test('the firstCentral entry leads the directory and the rest keep local order', async () => {
        const { sink, writer } = setup()
        for (const name of ['mimetype', 'u/one', 'manifest.json', 'a/two']) {
            await writer.addBuffered(name, 0, sample(5), 5)
        }
        await writer.finish({ firstCentral: 'manifest.json' })
        const zip = parseZip(sink)
        expect(zip.entries.map((e) => e.name)).toEqual(['manifest.json', 'mimetype', 'u/one', 'a/two'])
        const local = [...zip.entries].sort((a, b) => a.offset - b.offset).map((e) => e.name)
        expect(local).toEqual(['mimetype', 'u/one', 'manifest.json', 'a/two'])
    })

    test('without firstCentral the directory is in local order, and a missing name fails', async () => {
        const first = setup()
        await first.writer.addBuffered('x', 0, sample(2), 2)
        await first.writer.addBuffered('y', 0, sample(2), 2)
        await first.writer.finish()
        expect(parseZip(first.sink).entries.map((e) => e.name)).toEqual(['x', 'y'])

        const second = setup()
        await second.writer.addBuffered('x', 0, sample(2), 2)
        await expect(second.writer.finish({ firstCentral: 'absent' })).rejects.toThrow()
    })

    test('validate sees the finished directory before any directory byte is written; a throw fails finish', async () => {
        const { sink, writer } = setup()
        await writer.addBuffered('x', 0, sample(2), 2)
        await writer.addBuffered('y', 0, sample(2), 2)
        const before = sink.length
        let seen = { count: 0, size: 0, offset: -1 }
        await expect(writer.finish({
            validate: (directory) => {
                seen = {
                    count: directory.count,
                    size: directory.chunks.reduce((sum, chunk) => sum + chunk.length, 0),
                    offset: directory.directoryOffset,
                }
                expect(directory.directorySize).toBe(seen.size)
                throw new Error('finding')
            },
        })).rejects.toThrow('finding')
        expect(seen.count).toBe(2)
        expect(seen.offset).toBe(before)
        expect(sink.length).toBe(before)
    })
})

describe('T-await sequential sink writes', () => {
    class DeferredSink implements ZipSink {
        inflight = 0
        maxInflight = 0
        calls = 0
        length = 0
        private async hold(): Promise<void> {
            this.calls++
            this.inflight++
            this.maxInflight = Math.max(this.maxInflight, this.inflight)
            await new Promise<void>((resolve) => setTimeout(resolve, 1))
            this.inflight--
        }
        async write(chunk: Uint8Array): Promise<void> {
            await this.hold()
            this.length += chunk.length
        }
        async writeFill(length: number): Promise<void> {
            await this.hold()
            this.length += length
        }
    }

    test('no write starts before the previous one resolves', async () => {
        const sink = new DeferredSink()
        const writer = new Zip64Writer({ sink, createdAt: CREATED, bufferLimit: 1024 })
        await writer.addBuffered('a', 0, sample(10), 10)
        await writer.addBuffered('b', 8, sample(3000), 3000)
        await writer.addStreamed('c', 0, pieces(sample(100), fillPiece(1, 5000), sample(100)), null)
        await writer.addStreamed('d', 8, pieces(sample(2000), sample(2000)), null)
        await writer.finish()
        expect(sink.calls).toBeGreaterThan(10)
        expect(sink.maxInflight).toBe(1)
    })
})
