import { describe, test, expect } from 'vitest'
import { checkLocalHeaders, readDirectory, readEntry, type ZipIndex } from 'src/ts/drive/rtb/zip64Reader'
import { fillPiece, Zip64Writer, type ZipPiece } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink } from './segmentSink'
import { decodeSegmentList, encodeSegmentList, rangeSourceOfSink, sparseSourceOfRuns } from './sparseSource'
import { parseZip } from './zipTestParser'

const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)
const GIB4 = 2 ** 32

function smallBody(i: number): Uint8Array {
    return Uint8Array.of(i & 0xFF)
}

function nameOf(i: number): string {
    return `x/${i.toString().padStart(6, '0')}`
}

async function* fillOnly(piece: ZipPiece): AsyncGenerator<ZipPiece> {
    yield piece
}

async function buildEntries(count: number): Promise<SegmentSink> {
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: CREATED })
    for (let i = 0; i < count; i++) {
        await writer.addBuffered(nameOf(i), 0, smallBody(i), 1)
    }
    await writer.finish()
    return sink
}

async function bodyOf(source: ReturnType<typeof rangeSourceOfSink>, index: ZipIndex, i: number): Promise<Uint8Array> {
    const parts: number[] = []
    const result = await readEntry(source, index, i, (chunk) => {
        parts.push(...chunk)
    })
    expect(result.ok).toBe(true)
    return Uint8Array.from(parts)
}

describe('T1a 65,535 and 65,536 entries', () => {
    for (const count of [65535, 65536]) {
        test(`${count} entries round-trip with counts from the ZIP64 end record`, async () => {
            const sink = await buildEntries(count)
            const source = rangeSourceOfSink(sink)
            const walked = await readDirectory(source)
            expect(walked.findings).toEqual([])
            expect(walked.complete).toBe(true)
            const index = walked.index!
            expect(index.count).toBe(count)
            // The independent parser agrees on the count the classic end record cannot hold.
            expect(parseZip(sink).end.zip64End.entries).toBe(count)
            for (const i of [0, 1, 997, 32768, count - 2, count - 1]) {
                const found = index.find(nameOf(i))
                expect(found.length).toBe(1)
                expect(await bodyOf(source, index, found[0])).toEqual(smallBody(i))
            }
            expect(index.find(nameOf(count))).toEqual([])
        }, 60_000)
    }
})

describe('T1c a file past 4 GiB', () => {
    test('a 4 GiB + 1 fill entry, then 65,536 entries, with the directory past 4 GiB', async () => {
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: CREATED })
        await writer.addStreamed('a/big', 0, fillOnly(fillPiece(0x55, GIB4 + 1)), null)
        for (let i = 0; i < 65536; i++) {
            await writer.addBuffered(nameOf(i), 0, smallBody(i), 1)
        }
        await writer.finish()
        expect(sink.length).toBeGreaterThan(GIB4 + 65536)

        const source = rangeSourceOfSink(sink)
        const walked = await readDirectory(source)
        expect(walked.findings).toEqual([])
        const index = walked.index!
        expect(index.count).toBe(65537)
        expect(index.directoryOffset).toBeGreaterThan(GIB4)
        const big = index.entry(index.find('a/big')[0])
        expect(big.compressedSize).toBe(GIB4 + 1)
        expect(big.uncompressedSize).toBe(GIB4 + 1)
        expect(big.offset).toBe(0)
        for (const i of [0, 4096, 65535]) {
            const entry = index.entry(index.find(nameOf(i))[0])
            expect(entry.offset).toBeGreaterThan(GIB4)
            expect(await bodyOf(source, index, entry.index)).toEqual(smallBody(i))
        }
        const local = await checkLocalHeaders(source, index, (i) => i === index.find('a/big')[0] || i % 8191 === 0)
        expect(local).toEqual([])
    }, 120_000)
})

describe('segment list codec', () => {
    test('encode and decode round-trip, and the decoded list reads like the sink', async () => {
        const sink = new SegmentSink()
        const writer = new Zip64Writer({ sink, createdAt: CREATED })
        await writer.addStreamed('a/fill', 0, fillOnly(fillPiece(0x7E, 300_000)), null)
        await writer.addBuffered('x/one', 0, smallBody(9), 1)
        await writer.finish()
        const runs = sink.canonicalRuns()
        const decoded = decodeSegmentList(encodeSegmentList(runs))
        expect(decoded).toEqual(runs)
        const source = sparseSourceOfRuns(decoded)
        const walked = await readDirectory(source)
        expect(walked.findings).toEqual([])
        expect(walked.index!.count).toBe(2)
    })

    test('a handmade three-run list keeps its fill length beyond 32 bits', () => {
        const runs = [
            { kind: 'data' as const, bytes: Uint8Array.of(1, 2, 3) },
            { kind: 'fill' as const, length: GIB4 + 5, byte: 0xAB },
            { kind: 'data' as const, bytes: Uint8Array.of(9) },
        ]
        expect(decodeSegmentList(encodeSegmentList(runs))).toEqual(runs)
    })
})
