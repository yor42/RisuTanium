import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { CRC32_INIT, crc32Final, crc32OfFill, crc32Update } from 'src/ts/drive/rtb/crc32Running'
import { checkLocalHeaders, readDirectory, readEntry } from 'src/ts/drive/rtb/zip64Reader'
import { fillPiece, Zip64Writer, type ZipPiece } from 'src/ts/drive/rtb/zip64Writer'
import { SegmentSink, type SegmentRun } from './segmentSink'
import { decodeSegmentList, rangeSourceOfSink } from './sparseSource'
import { parseZip, readDescriptor } from './zipTestParser'

// The run command's working directory is the repo root; RTB_GOLDENS_DIR points the guard at another directory of the same file names.
const GOLDEN_DIR = path.resolve(process.env.RTB_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/rtbGoldens'))

// Pinned by hand from the generator's output; the README repeats them and T-pin compares the two.
const GOLDEN4_FILE = 'v1-golden-boundary.rtbseg'
const GOLDEN4_SHA256 = 'd2c728784948118e04efd2e527631200729da35e0316336444a4ba79e8199f34'
const GOLDEN4_SIZE = 810221
const GOLDEN4_BIG_CRC = 0x9d141e95

const GIB4 = 2 ** 32
const BIG_LENGTH = GIB4 + 1
const BIG_FILL = 0x55
const SMALL_COUNT = 65536
const CREATED = Date.UTC(2024, 1, 3, 4, 5, 6)

function golden4Bytes(): Uint8Array {
    return fs.readFileSync(path.join(GOLDEN_DIR, GOLDEN4_FILE))
}

function nameOf(i: number): string {
    return `x/${i.toString().padStart(6, '0')}`
}

function smallBody(i: number): Uint8Array {
    return Uint8Array.of(i & 0xFF)
}

function smallCrc(i: number): number {
    return crc32Final(crc32Update(CRC32_INIT, smallBody(i)))
}

async function* fillOnly(piece: ZipPiece): AsyncGenerator<ZipPiece> {
    yield piece
}

function sinkOfRuns(runs: SegmentRun[]): SegmentSink {
    const sink = new SegmentSink()
    for (const run of runs) {
        if (run.kind === 'data') {
            sink.write(run.bytes)
        } else {
            sink.writeFill?.(run.length, run.byte)
        }
    }
    return sink
}

/** The same build parameters as the golden's generator, run with the writer as it is now. */
async function buildBoundarySink(): Promise<SegmentSink> {
    const sink = new SegmentSink()
    const writer = new Zip64Writer({ sink, createdAt: CREATED })
    await writer.addStreamed('a/big', 0, fillOnly(fillPiece(BIG_FILL, BIG_LENGTH)), null)
    for (let i = 0; i < SMALL_COUNT; i++) {
        await writer.addBuffered(nameOf(i), 0, smallBody(i), 1)
    }
    await writer.finish()
    return sink
}

/** First difference between two canonical run lists, or null when they are equal. */
function firstRunDifference(a: SegmentRun[], b: SegmentRun[]): string | null {
    if (a.length !== b.length) {
        return `run counts differ: ${a.length} and ${b.length}`
    }
    for (let i = 0; i < a.length; i++) {
        const x = a[i]
        const y = b[i]
        if (x.kind !== y.kind) {
            return `run ${i}: kinds differ (${x.kind}, ${y.kind})`
        }
        if (x.kind === 'fill' && y.kind === 'fill') {
            if (x.length !== y.length || x.byte !== y.byte) {
                return `run ${i}: fill differs (${x.length}x${x.byte}, ${y.length}x${y.byte})`
            }
        } else if (x.kind === 'data' && y.kind === 'data') {
            if (x.bytes.length !== y.bytes.length) {
                return `run ${i}: data lengths differ (${x.bytes.length}, ${y.bytes.length})`
            }
            if (Buffer.compare(x.bytes, y.bytes) !== 0) {
                const at = x.bytes.findIndex((value, k) => value !== y.bytes[k])
                return `run ${i}: data differs at byte ${at}`
            }
        }
    }
    return null
}

/** README lines `SHA-256 <file>: <hex>` and `Size <file>: <n> bytes`, tolerating a CRLF checkout. */
function readmePins(text: string): { sha256: Map<string, string>, size: Map<string, number> } {
    const sha256 = new Map<string, string>()
    const size = new Map<string, number>()
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '')
        const sha = /^SHA-256 (\S+): ([0-9a-f]{64})$/.exec(line)
        if (sha) {
            sha256.set(sha[1], sha[2])
        }
        const bytes = /^Size (\S+): (\d+) bytes$/.exec(line)
        if (bytes) {
            size.set(bytes[1], Number(bytes[2]))
        }
    }
    return { sha256, size }
}

describe('T-pin golden 4 identity', () => {
    test('the golden file equals the pinned SHA-256 and size', () => {
        const bytes = golden4Bytes()
        expect(bytes.length).toBe(GOLDEN4_SIZE)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(GOLDEN4_SHA256)
    })

    test('the README hash lines equal the pinned constants, also from a CRLF copy', () => {
        const text = fs.readFileSync(path.join(GOLDEN_DIR, 'README.md'), 'utf8')
        for (const variant of [text, text.replace(/\r?\n/g, '\r\n')]) {
            const pins = readmePins(variant)
            expect(pins.sha256.get(GOLDEN4_FILE)).toBe(GOLDEN4_SHA256)
            expect(pins.size.get(GOLDEN4_FILE)).toBe(GOLDEN4_SIZE)
        }
    })

    test('the README parser reads a CRLF line as it reads an LF line', () => {
        const lf = `SHA-256 f.rtbseg: ${GOLDEN4_SHA256}\nSize f.rtbseg: 12 bytes\n`
        const crlf = lf.replace(/\n/g, '\r\n')
        expect(readmePins(crlf)).toEqual(readmePins(lf))
        expect(readmePins(crlf).sha256.get('f.rtbseg')).toBe(GOLDEN4_SHA256)
    })
})

describe('T1b golden 4 lists and reads', () => {
    test('the segment list is a valid file over 4 GiB with the directory past 4 GiB', async () => {
        const runs = decodeSegmentList(golden4Bytes())
        const sink = sinkOfRuns(runs)
        expect(sink.length).toBeGreaterThan(GIB4 + SMALL_COUNT)
        const walked = await readDirectory(rangeSourceOfSink(sink))
        expect(walked.findings).toEqual([])
        expect(walked.complete).toBe(true)
        const index = walked.index!
        expect(index.count).toBe(SMALL_COUNT + 1)
        expect(index.directoryOffset).toBeGreaterThan(GIB4)

        // Counts and offsets the classic records cannot hold come from the ZIP64 records.
        const parsed = parseZip(sink)
        expect(parsed.end.classic.entries).toBe(0xFFFF)
        expect(parsed.end.classic.directoryOffset).toBe(0xFFFFFFFF)
        expect(parsed.end.zip64End.entries).toBe(SMALL_COUNT + 1)
        expect(parsed.end.zip64End.directoryOffset).toBe(index.directoryOffset)
        expect(parsed.entries.length).toBe(SMALL_COUNT + 1)
    }, 120_000)

    test('the 4 GiB + 1 entry is a stored descriptor entry with the recorded CRC', () => {
        const sink = sinkOfRuns(decodeSegmentList(golden4Bytes()))
        const parsed = parseZip(sink)
        const big = parsed.entries[0]
        expect(big.name).toBe('a/big')
        expect(big.method).toBe(0)
        expect(big.offset).toBe(0)
        expect(big.compressedSize).toBe(BIG_LENGTH)
        expect(big.uncompressedSize).toBe(BIG_LENGTH)
        expect(big.compressedSize32).toBe(0xFFFFFFFF)
        expect(big.crc).toBe(GOLDEN4_BIG_CRC)
        expect(crc32OfFill(BIG_FILL, BIG_LENGTH)).toBe(GOLDEN4_BIG_CRC)
        expect(readDescriptor(parsed, big)).toEqual({ crc: GOLDEN4_BIG_CRC, compressedSize: BIG_LENGTH, uncompressedSize: BIG_LENGTH })
    }, 120_000)

    test('every small entry sits past 4 GiB with its offset in the ZIP64 extra and the right CRC', () => {
        const sink = sinkOfRuns(decodeSegmentList(golden4Bytes()))
        const parsed = parseZip(sink)
        let previous = parsed.entries[0].offset
        for (let i = 0; i < SMALL_COUNT; i++) {
            const entry = parsed.entries[i + 1]
            if (entry.name !== nameOf(i) || entry.method !== 0 || entry.crc !== smallCrc(i) || entry.uncompressedSize !== 1 || entry.compressedSize !== 1) {
                throw new Error(`small entry ${i} differs: ${entry.name} method ${entry.method} crc ${entry.crc} sizes ${entry.compressedSize}/${entry.uncompressedSize}`)
            }
            if (entry.offset32 !== 0xFFFFFFFF || entry.offset <= GIB4 || entry.offset <= previous) {
                throw new Error(`small entry ${i} offset ${entry.offset} (field ${entry.offset32}) is not past 4 GiB in order`)
            }
            previous = entry.offset
        }
    }, 120_000)

    test('the reader lists the entries and verifies the CRC of every small entry', async () => {
        const sink = sinkOfRuns(decodeSegmentList(golden4Bytes()))
        const source = rangeSourceOfSink(sink)
        const index = (await readDirectory(source)).index!
        // Every entry goes through the reader: a stale directory view after a chunk refill only
        // corrupts the CRC column of the records that straddle the refill.
        for (let i = 0; i < SMALL_COUNT; i++) {
            const found = index.find(nameOf(i))
            if (found.length !== 1) throw new Error(`small entry ${i} found ${found.length} times`)
            let body = 0
            let length = 0
            const result = await readEntry(source, index, found[0], (chunk) => {
                length += chunk.length
                body = chunk[0]
            })
            if (!result.ok) throw new Error(`small entry ${i} failed the reader CRC check`)
            const expected = smallBody(i)
            if (length !== expected.length || body !== expected[0]) throw new Error(`small entry ${i} body differs`)
        }
        expect(index.find(nameOf(SMALL_COUNT))).toEqual([])
        expect(await checkLocalHeaders(source, index)).toEqual([])
    }, 120_000)
})

describe('T-seg segment decoder', () => {
    test('golden 4 decodes to a data run, one fill run and a data run', () => {
        const runs = decodeSegmentList(golden4Bytes())
        expect(runs.map((r) => r.kind)).toEqual(['data', 'fill', 'data'])
        const fill = runs[1]
        expect(fill.kind === 'fill' && fill.length === BIG_LENGTH && fill.byte === BIG_FILL).toBe(true)
    })

    test('a truncated list and a wrong magic are refused', () => {
        const bytes = golden4Bytes().slice()
        expect(() => decodeSegmentList(bytes.subarray(0, bytes.length - 1))).toThrow()
        const magic = bytes.slice()
        magic[0] ^= 0xFF
        expect(() => decodeSegmentList(magic)).toThrow(/not a segment list/)
    })
})

describe('T1d v1-writer determinism guard', () => {
    test('the canonical run list of the current writer equals golden 4', async () => {
        const golden = sinkOfRuns(decodeSegmentList(golden4Bytes())).canonicalRuns()
        const built = (await buildBoundarySink()).canonicalRuns()
        expect(firstRunDifference(built, golden)).toBeNull()
    }, 300_000)

    test('the run comparison reports a changed byte and a changed fill', () => {
        const base: SegmentRun[] = [
            { kind: 'data', bytes: Uint8Array.of(1, 2, 3) },
            { kind: 'fill', length: 10, byte: 7 },
        ]
        expect(firstRunDifference(base, base)).toBeNull()
        expect(firstRunDifference(base, [{ kind: 'data', bytes: Uint8Array.of(1, 9, 3) }, base[1]])).toMatch(/data differs at byte 1/)
        expect(firstRunDifference(base, [base[0], { kind: 'fill', length: 10, byte: 8 }])).toMatch(/fill differs/)
        expect(firstRunDifference(base, [base[0]])).toMatch(/run counts differ/)
    })
})
