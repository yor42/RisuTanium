/**
 * The import sources in `src/ts/importSource.ts`: what each adapter hands back for a range, how the desktop source
 * uses one open handle (bounded plugin reads, one shared cursor, closed once), and how the read-ahead window decides
 * between one window and a direct small read.
 *
 * The plugin-fs handle is a fake that models a single file cursor: a `read` continues where the last `read` or `seek`
 * stopped, so a source that read two ranges at once, or forgot to seek, would return the wrong bytes.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    file: new Uint8Array(0),
    /** the buffer size of every plugin `read` */
    readSizes: [] as number[],
    seeks: [] as number[],
    opened: 0,
    closed: 0,
    /** the most bytes one `read` answers with; 0 means as many as asked */
    answerAtMost: 0,
    statFails: false,
    statCalls: 0,
    mtime: null as Date | null,
    openFails: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    SeekMode: { Start: 0, Current: 1, End: 2 },
    open: vi.fn(async () => {
        if (h.openFails) throw 'failed to open (os error 2)'
        h.opened++
        let position = 0
        return {
            read: async (buffer: Uint8Array) => {
                h.readSizes.push(buffer.byteLength)
                // The answer is cut at a macrotask so that two overlapping callers would interleave here.
                await new Promise((resolve) => setTimeout(resolve, 0))
                if (position >= h.file.length) return null
                const count = Math.min(buffer.byteLength, h.file.length - position, h.answerAtMost || Infinity)
                buffer.set(h.file.subarray(position, position + count), 0)
                position += count
                return count
            },
            seek: async (offset: number) => {
                h.seeks.push(offset)
                position = offset
                return position
            },
            stat: async () => {
                h.statCalls++
                if (h.statFails) throw new Error('stat failed')
                return { size: h.file.length, mtime: h.mtime }
            },
            close: async () => { h.closed++ },
        }
    }),
}))

import { CHUNK_MAX } from 'src/ts/storage/tauriByteTransport'
import {
    IMPORT_WINDOW_BYTES, PICKED_FILE_GAP_BYTES, PICKED_FILE_WINDOW_BYTES, RANGE_BATCH_MAX_RANGES, RANGE_READ_PARALLEL, RangeBatchReader, WindowedReader,
    importSourceOfBytes, importSourceOfFile, isImportSource, openDesktopImportSource, rangeSegments,
    type ImportSource,
} from 'src/ts/importSource'

const MIB = 1024 * 1024

function patternedFile(length: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(length)
    for (let i = 0; i < length; i++) {
        out[i] = (i * 7 + (i >> 8) * 3 + (i >> 16)) & 0xff
    }
    return out
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i])

async function drain(stream: ReadableStream<Uint8Array>): Promise<{ bytes: Uint8Array, pieces: number[] }> {
    const reader = stream.getReader()
    const parts: Uint8Array[] = []
    for (;;) {
        const next = await reader.read()
        if (next.done) break
        parts.push(next.value)
    }
    const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
    let at = 0
    for (const part of parts) {
        bytes.set(part, at)
        at += part.length
    }
    return { bytes, pieces: parts.map((part) => part.length) }
}

beforeEach(() => {
    h.file = patternedFile(10 * MIB + 123)
    h.readSizes = []
    h.seeks = []
    h.opened = 0
    h.closed = 0
    h.answerAtMost = 0
    h.statFails = false
    h.statCalls = 0
    h.mtime = null
    h.openFails = false
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('byte and file sources', () => {
    const bytes = patternedFile(1000)

    test.each([
        ['bytes', () => importSourceOfBytes('m.risum', bytes)],
        ['file', () => importSourceOfFile(new File([bytes], 'm.risum'))],
    ])('a %s source answers a range, clamps it to the size, and reports its size', async (_label, make) => {
        const source = make()
        expect(source.name).toBe('m.risum')
        expect(source.size).toBe(1000)
        expect(same(await source.read(10, 20), bytes.subarray(10, 20))).toBe(true)
        expect(same(await source.read(990, 5000), bytes.subarray(990))).toBe(true)
        expect((await source.read(1000, 1010)).length).toBe(0)
        expect((await source.read(50, 50)).length).toBe(0)
        expect((await source.stat()).size).toBe(1000)
        await source.close()
        await source.close()
    })

    test.each([
        ['bytes', () => importSourceOfBytes('m.risum', patternedFile(3 * MIB + 5))],
        ['file', () => importSourceOfFile(new File([patternedFile(3 * MIB + 5)], 'm.risum'))],
    ])('a %s source streams all of itself', async (_label, make) => {
        const { bytes: streamed } = await drain(make().stream())
        expect(same(streamed, patternedFile(3 * MIB + 5))).toBe(true)
    })

    test('a file source reports the modification time of its file', async () => {
        const source = importSourceOfFile(new File([bytes], 'm.risum', { lastModified: 1_700_000_000_000 }))
        expect((await source.stat()).modified).toBe(1_700_000_000_000)
    })

    test('only an object with the whole source interface is a source', () => {
        expect(isImportSource(importSourceOfBytes('a', bytes))).toBe(true)
        expect(isImportSource(new File([bytes], 'a'))).toBe(false)
        expect(isImportSource(bytes)).toBe(false)
        expect(isImportSource(new ReadableStream())).toBe(false)
        expect(isImportSource(null)).toBe(false)
    })
})

describe('the desktop source', () => {
    test('takes its size from the open handle, not from a second look at the path', async () => {
        h.mtime = new Date(1_700_000_000_000)
        const source = await openDesktopImportSource('C:\\mods\\Big.risum')
        expect(source.name).toBe('Big.risum')
        expect(source.size).toBe(h.file.length)
        expect(h.opened).toBe(1)
        expect(await source.stat()).toEqual({ size: h.file.length, modified: 1_700_000_000_000 })
        await source.close()
    })

    test('a read above one piece is several plugin reads of at most 4 MiB, and returns the right bytes', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')

        const out = await source.read(1000, 1000 + 9 * MIB + 7)

        expect(same(out, h.file.subarray(1000, 1000 + 9 * MIB + 7))).toBe(true)
        expect(h.readSizes).toEqual([CHUNK_MAX, CHUNK_MAX, MIB + 7])
        expect(Math.max(...h.readSizes)).toBeLessThanOrEqual(CHUNK_MAX)
        await source.close()
    })

    test('a short answer from the plugin is continued from where it stopped', async () => {
        h.answerAtMost = 1000
        const source = await openDesktopImportSource('/mods/Big.risum')

        const out = await source.read(5, 5 + 4500)

        expect(same(out, h.file.subarray(5, 5 + 4500))).toBe(true)
        await source.close()
    })

    test('sequential reads share one cursor: only a read that does not continue the last one seeks', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')

        await source.read(0, 100)
        await source.read(100, 200)
        await source.read(5000, 5100)
        await source.read(5100, 5200)
        const back = await source.read(300, 400)

        expect(h.seeks).toEqual([5000, 300])
        expect(same(back, h.file.subarray(300, 400))).toBe(true)
        await source.close()
    })

    test('two reads started together each get their own bytes', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')

        const [first, second, third] = await Promise.all([source.read(100, 4000), source.read(9000, 9100), source.read(50, 60)])

        expect(same(first, h.file.subarray(100, 4000))).toBe(true)
        expect(same(second, h.file.subarray(9000, 9100))).toBe(true)
        expect(same(third, h.file.subarray(50, 60))).toBe(true)
        await source.close()
    })

    test('a read past the end is clamped, and a file that shrank answers short', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')
        const size = source.size

        expect(same(await source.read(size - 10, size + 500), h.file.subarray(size - 10))).toBe(true)
        expect((await source.read(size, size + 10)).length).toBe(0)

        h.file = h.file.subarray(0, 5000)
        expect((await source.read(4000, 6000)).length).toBe(1000)
        await source.close()
    })

    test('the stream reads in pieces of at most 4 MiB and yields the whole file', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')

        const { bytes, pieces } = await drain(source.stream())

        expect(same(bytes, h.file)).toBe(true)
        expect(Math.max(...pieces)).toBeLessThanOrEqual(CHUNK_MAX)
        expect(Math.max(...h.readSizes)).toBeLessThanOrEqual(CHUNK_MAX)
        await source.close()
    })

    test('close closes the handle once, however often it is called, and a read after it fails', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')

        await source.close()
        await source.close()

        expect(h.closed).toBe(1)
        await expect(source.read(0, 10)).rejects.toThrow()
    })

    test('close waits for a read that is still running', async () => {
        const source = await openDesktopImportSource('/mods/Big.risum')

        const pending = source.read(0, 5 * MIB)
        await source.close()

        expect(same(await pending, h.file.subarray(0, 5 * MIB))).toBe(true)
        expect(h.closed).toBe(1)
    })

    test('a file that cannot be opened rejects, and a handle whose stat fails is closed', async () => {
        h.openFails = true
        await expect(openDesktopImportSource('/mods/Gone.risum')).rejects.toBe('failed to open (os error 2)')
        expect(h.opened).toBe(0)

        h.openFails = false
        h.statFails = true
        await expect(openDesktopImportSource('/mods/Bad.risum')).rejects.toThrow('stat failed')
        expect(h.opened).toBe(1)
        expect(h.closed).toBe(1)
    })
})

describe('the read-ahead window', () => {
    function countingSource(size: number) {
        const calls: Array<[number, number]> = []
        const bytes = patternedFile(size)
        const source: ImportSource = {
            name: 's',
            size,
            read: async (start, end) => {
                calls.push([start, Math.min(end, size)])
                return bytes.slice(start, Math.min(end, size))
            },
            stream: () => new ReadableStream(),
            stat: async () => ({ size, modified: null }),
            close: async () => undefined,
        }
        return { source, calls, bytes }
    }

    test('the first read goes straight to the source', async () => {
        const { source, calls } = countingSource(MIB)
        const reader = new WindowedReader(source, MIB)

        await reader.read(0, 6)

        expect(calls).toEqual([[0, 6]])
    })

    test('small reads that follow each other cost one window', async () => {
        const { source, calls, bytes } = countingSource(MIB)
        const reader = new WindowedReader(source, MIB)
        await reader.read(0, 6)

        const headers: Uint8Array[] = []
        for (let at = 6; at < 6 + 50 * 100; at += 100) {
            headers.push(new Uint8Array(await reader.read(at, at + 5)))
        }

        expect(calls).toEqual([[0, 6], [6, 6 + IMPORT_WINDOW_BYTES]])
        headers.forEach((header, i) => expect(same(header, bytes.subarray(6 + i * 100, 11 + i * 100))).toBe(true))
    })

    test('after a long skip only the next header is read, and the window is left alone', async () => {
        const { source, calls, bytes } = countingSource(8 * MIB)
        const reader = new WindowedReader(source, 8 * MIB)
        await reader.read(0, 6)
        await reader.read(6, 11)

        const far = await reader.read(3 * MIB, 3 * MIB + 5)
        const farther = await reader.read(6 * MIB, 6 * MIB + 5)

        expect(same(far, bytes.subarray(3 * MIB, 3 * MIB + 5))).toBe(true)
        expect(same(farther, bytes.subarray(6 * MIB, 6 * MIB + 5))).toBe(true)
        expect(calls.slice(2)).toEqual([[3 * MIB, 3 * MIB + 5], [6 * MIB, 6 * MIB + 5]])
    })

    test('a read as long as the window goes straight to the source', async () => {
        const { source, calls, bytes } = countingSource(2 * MIB)
        const reader = new WindowedReader(source, 2 * MIB)
        await reader.read(0, 6)

        const big = await reader.read(6, 6 + IMPORT_WINDOW_BYTES)

        expect(same(big, bytes.subarray(6, 6 + IMPORT_WINDOW_BYTES))).toBe(true)
        expect(calls).toEqual([[0, 6], [6, 6 + IMPORT_WINDOW_BYTES]])
    })

    test('a read past the limit is clamped to it', async () => {
        const { source, bytes } = countingSource(1000)
        const reader = new WindowedReader(source, 1000)
        await reader.read(0, 6)

        expect(same(await reader.read(990, 1100), bytes.subarray(990))).toBe(true)
        expect((await reader.read(1000, 1010)).length).toBe(0)
    })

    test('a chosen window size bounds the read-ahead and a request inside it costs no call', async () => {
        const W = 64 * 1024
        const { source, calls, bytes } = countingSource(MIB)
        const reader = new WindowedReader(source, MIB, W)
        await reader.read(0, 5)

        const first = await reader.read(100, 105)
        const inside = await reader.read(20_000, 20_005)

        expect(calls).toEqual([[0, 5], [100, 100 + W]])
        expect(same(first, bytes.subarray(100, 105))).toBe(true)
        expect(same(inside, bytes.subarray(20_000, 20_005))).toBe(true)
    })
})

describe('the window a source carries', () => {
    test('a picked File carries a window and a gap, and the caller can choose them', () => {
        const file = new File([patternedFile(10)], 'm.charx')
        const source = importSourceOfFile(file)
        expect(source.windowBytes).toBe(PICKED_FILE_WINDOW_BYTES)
        expect(source.windowGapBytes).toBe(PICKED_FILE_GAP_BYTES)
        expect(PICKED_FILE_GAP_BYTES).toBeLessThan(PICKED_FILE_WINDOW_BYTES)
        const chosen = importSourceOfFile(file, 64 * 1024, 16 * 1024)
        expect(chosen.windowBytes).toBe(64 * 1024)
        expect(chosen.windowGapBytes).toBe(16 * 1024)
    })

    test('a byte source and a desktop source carry none', async () => {
        expect(importSourceOfBytes('m.charx', patternedFile(10)).windowBytes).toBeUndefined()
        expect(importSourceOfBytes('m.charx', patternedFile(10)).windowGapBytes).toBeUndefined()
        const desktop = await openDesktopImportSource('/mods/Big.risum')
        expect(desktop.windowBytes).toBeUndefined()
        expect(desktop.windowGapBytes).toBeUndefined()
        await desktop.close()
    })
})

type RangePair = [number, number]

const flat = (pairs: RangePair[]) => Float64Array.from(pairs.flat())

function pairsOf(table: Float64Array): RangePair[] {
    const out: RangePair[] = []
    for (let i = 0; i < table.length; i += 2) {
        out.push([table[i], table[i + 1]])
    }
    return out
}

function readRangesOf(source: ImportSource): NonNullable<ImportSource['readRanges']> {
    if (source.readRanges === undefined) {
        throw new Error('the source has no readRanges')
    }
    return source.readRanges.bind(source)
}

/**
 * Wraps `Blob.prototype.arrayBuffer`: records the byte count of every resolved call, the calls begun while none was
 * pending (`bursts` holds how many calls each such start was followed by), and how many are pending now. `behave`
 * decides what call number `index` does; by default it reads the real bytes.
 */
function spyOnBlobReads(behave: (index: number, read: () => Promise<ArrayBuffer>) => Promise<ArrayBuffer> = (_index, read) => read()) {
    const original = Blob.prototype.arrayBuffer
    const record = { lengths: [] as number[], bursts: [] as number[], pending: 0, calls: 0 }
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
        const index = record.calls++
        if (record.pending === 0) {
            record.bursts.push(0)
        }
        record.bursts[record.bursts.length - 1]++
        record.pending++
        const result = behave(index, () => original.call(this)).then((buffer) => {
            record.lengths.push(buffer.byteLength)
            return buffer
        })
        const settled = () => { record.pending-- }
        result.then(settled, settled)
        return result
    })
    return record
}

describe('readRanges of a picked File', () => {
    const bytes = patternedFile(1000)
    const sourceOf = () => importSourceOfFile(new File([bytes], 'm.charx'))

    test('3 ranges are 3 items read together, with exact bytes in input order', async () => {
        const record = spyOnBlobReads()
        const parts = await readRangesOf(sourceOf())([[10, 20], [100, 130], [500, 600]])
        expect(record.calls).toBe(3)
        expect(record.bursts).toEqual([3])
        expect(parts.map((part) => part.length)).toEqual([10, 30, 100])
        expect(same(parts[0], bytes.subarray(10, 20))).toBe(true)
        expect(same(parts[1], bytes.subarray(100, 130))).toBe(true)
        expect(same(parts[2], bytes.subarray(500, 600))).toBe(true)
    })

    test('5 ranges are read as min(4, 5) composites balanced by item count, in one burst', async () => {
        const record = spyOnBlobReads()
        const lengths = [1, 2, 4, 8, 16]
        let at = 0
        const ranges = lengths.map((length): RangePair => { const range: RangePair = [at, at + length]; at += length + 3; return range })
        const parts = await readRangesOf(sourceOf())(ranges)
        expect(RANGE_READ_PARALLEL).toBe(4)
        expect(record.bursts).toEqual([4])
        expect([...record.lengths].sort((a, b) => a - b)).toEqual([3, 4, 8, 16])
        expect(parts).toHaveLength(5)
        ranges.forEach(([start, end], i) => expect(same(parts[i], bytes.subarray(start, end))).toBe(true))
    })

    test('101 ranges split 26/25/25/25 across 4 composites', async () => {
        const record = spyOnBlobReads()
        const ranges = Array.from({ length: 101 }, (_unused, i): RangePair => [i * 8, i * 8 + 1])
        const parts = await readRangesOf(importSourceOfFile(new File([patternedFile(900)], 'm.charx')))(ranges)
        expect(record.bursts).toEqual([4])
        expect([...record.lengths].sort((a, b) => a - b)).toEqual([25, 25, 25, 26])
        expect(parts).toHaveLength(101)
    })

    test('a range is clamped to the size, an empty clamped range is an empty part without an item, [] makes no call, one range makes one call', async () => {
        const record = spyOnBlobReads()
        const readRanges = readRangesOf(sourceOf())
        expect(await readRanges([])).toEqual([])
        expect(record.calls).toBe(0)
        const parts = await readRanges([[990, 5000], [1000, 1010], [50, 50], [-5, 3]])
        expect(parts.map((part) => part.length)).toEqual([10, 0, 0, 3])
        expect(same(parts[0], bytes.subarray(990))).toBe(true)
        expect(same(parts[3], bytes.subarray(0, 3))).toBe(true)
        expect(record.calls).toBe(2)
        record.calls = 0
        await readRanges([[1000, 1010], [5, 5]])
        expect(record.calls).toBe(0)
        await readRanges([[1, 2]])
        expect(record.calls).toBe(1)
    })

    test('a group whose bytes come back short yields empty parts, and the other groups are served', async () => {
        spyOnBlobReads(async (index, read) => {
            const buffer = await read()
            return index === 1 ? buffer.slice(0, buffer.byteLength - 1) : buffer
        })
        const ranges = Array.from({ length: 8 }, (_unused, i): RangePair => [i * 10, i * 10 + 5])
        const parts = await readRangesOf(sourceOf())(ranges)
        parts.forEach((part, i) => {
            if (i === 2 || i === 3) {
                expect(part.length).toBe(0)
            } else {
                expect(same(part, bytes.subarray(ranges[i][0], ranges[i][1]))).toBe(true)
            }
        })
    })

    test('parts are in input order whatever order the composites settle in', async () => {
        let resolved = 0
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => { release = resolve })
        spyOnBlobReads(async (index, read) => {
            if (index === 0) {
                await gate
            }
            const buffer = await read()
            if (index !== 0 && ++resolved === 3) {
                release()
            }
            return buffer
        })
        const ranges = Array.from({ length: 8 }, (_unused, i): RangePair => [i * 10, i * 10 + 5])
        const parts = await readRangesOf(sourceOf())(ranges)
        ranges.forEach(([start, end], i) => expect(same(parts[i], bytes.subarray(start, end))).toBe(true))
    })

    test('a rejection is reported only after every composite has settled, with the lowest group error', async () => {
        const ranges = Array.from({ length: 8 }, (_unused, i): RangePair => [i * 10, i * 10 + 5])
        const timer = () => new Promise<void>((resolve) => setTimeout(resolve, 20))

        const first = spyOnBlobReads(async (index, read) => {
            if (index === 0) {
                throw new Error('group 0')
            }
            if (index === 3) {
                await timer()
            }
            return await read()
        })
        const caught = await readRangesOf(sourceOf())(ranges).then(() => null, (error: Error) => ({ error, pending: first.pending }))
        expect(caught?.error.message).toBe('group 0')
        expect(caught?.pending).toBe(0)
        vi.restoreAllMocks()

        spyOnBlobReads(async (index, read) => {
            if (index === 2) {
                throw new Error('group 2')
            }
            if (index === 1) {
                await timer()
                throw new Error('group 1')
            }
            return await read()
        })
        const second = await readRangesOf(sourceOf())(ranges).then(() => null, (error: Error) => error)
        expect(second?.message).toBe('group 1')
    })
})

describe('rangeSegments', () => {
    const W = 100
    const G = 10
    const rows: [string, RangePair[], RangePair[]][] = [
        ['a gap of exactly G merges', [[0, 40], [50, 100]], [[0, 100]]],
        ['a gap over G splits', [[0, 40], [51, 100]], [[0, 40], [51, 100]]],
        ['a merge over W splits', [[0, 40], [50, 101]], [[0, 40], [50, 101]]],
        ['an overlap exactly at W merges', [[0, 60], [50, 100]], [[0, 100]]],
        ['an overlap over W is cut at the end of the first', [[0, 60], [50, 101]], [[0, 60], [60, 101]]],
        ['an overlap chain is cut at W', [[0, 30], [20, 60], [50, 90], [80, 120]], [[0, 90], [90, 120]]],
        ['a contained range is skipped', [[0, 50], [10, 20]], [[0, 50]]],
        ['a range longer than W is trimmed', [[0, 150]], [[0, 100]]],
        ['a trimmed remainder is dropped', [[0, 150], [140, 160]], [[0, 100], [140, 160]]],
        ['empty ranges are skipped', [[5, 5], [0, 10], [12, 12]], [[0, 10]]],
    ]

    test.each(rows)('%s', (_label, ranges, expected) => {
        expect(pairsOf(rangeSegments(flat(ranges), W, G))).toEqual(expected)
    })

    test('a seeded sweep keeps segments sorted, disjoint, within W and covering every range up to W', () => {
        let seed = 12345
        const next = (limit: number) => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            return seed % limit
        }
        for (let round = 0; round < 1000; round++) {
            const ranges = Array.from({ length: next(9) }, (): RangePair => {
                const start = next(400)
                return [start, start + next(161)]
            }).sort((a, b) => a[0] - b[0])
            const segments = pairsOf(rangeSegments(flat(ranges), W, G))
            segments.forEach(([start, end], i) => {
                expect(end - start).toBeGreaterThan(0)
                expect(end - start).toBeLessThanOrEqual(W)
                if (i > 0) {
                    expect(start).toBeGreaterThanOrEqual(segments[i - 1][1])
                }
            })
            for (const [start, end] of ranges) {
                if (end - start > W) continue
                for (let byte = start; byte < end; byte++) {
                    expect(segments.some(([s, e]) => s <= byte && byte < e)).toBe(true)
                }
            }
        }
    })
})

describe('RangeBatchReader', () => {
    const bytes = patternedFile(1000)

    function fakeSource(overrides: Partial<ImportSource> = {}) {
        const calls = { reads: [] as RangePair[], batches: [] as RangePair[][] }
        const source: ImportSource = {
            name: 'f',
            size: bytes.length,
            read: async (start, end) => {
                calls.reads.push([start, end])
                return bytes.slice(start, Math.min(end, bytes.length))
            },
            readRanges: async (ranges) => {
                calls.batches.push(ranges.map(([a, b]): RangePair => [a, b]))
                return ranges.map(([a, b]) => bytes.slice(a, Math.min(b, bytes.length)))
            },
            stream: () => new ReadableStream(),
            stat: async () => ({ size: bytes.length, modified: null }),
            close: async () => undefined,
            ...overrides,
        }
        return { source, calls }
    }

    const isBytes = (got: Uint8Array, start: number, end: number) => same(got, bytes.subarray(start, end))

    test('segments of one batch are fetched in one readRanges call and served as views', async () => {
        const { source, calls } = fakeSource()
        const reader = new RangeBatchReader(source, 1000, flat([[0, 20], [50, 70], [200, 220]]), 100, 10)
        expect(isBytes(await reader.read(0, 10), 0, 10)).toBe(true)
        expect(isBytes(await reader.read(55, 65), 55, 65)).toBe(true)
        expect(isBytes(await reader.read(200, 220), 200, 220)).toBe(true)
        expect(calls.batches).toEqual([[[0, 20], [50, 70], [200, 220]]])
        expect(calls.reads).toEqual([])
    })

    test('a batch never holds more than the window in total', async () => {
        const { source, calls } = fakeSource()
        const reader = new RangeBatchReader(source, 1000, flat([[0, 40], [100, 140], [200, 240]]), 100, 0)
        for (const start of [0, 100, 200]) {
            expect(isBytes(await reader.read(start, start + 40), start, start + 40)).toBe(true)
        }
        expect(calls.batches).toEqual([[[0, 40], [100, 140]]])
        expect(calls.reads).toEqual([[200, 240]])
    })

    test('a batch never holds more than RANGE_BATCH_MAX_RANGES segments', async () => {
        const many = patternedFile(6100)
        const batches: number[] = []
        const source: ImportSource = {
            ...fakeSource().source,
            size: many.length,
            readRanges: async (ranges) => {
                batches.push(ranges.length)
                return ranges.map(([a, b]) => many.slice(a, b))
            },
        }
        const ranges = Array.from({ length: 600 }, (_unused, i): RangePair => [i * 10, i * 10 + 1])
        const reader = new RangeBatchReader(source, many.length, flat(ranges), 1 << 20, 0)
        for (const [start, end] of ranges) {
            expect(same(await reader.read(start, end), many.subarray(start, end))).toBe(true)
        }
        expect(RANGE_BATCH_MAX_RANGES).toBe(256)
        expect(batches).toEqual([256, 256, 88])
    })

    test('an uncovered or oversize request is read exactly and leaves the batch held', async () => {
        const { source, calls } = fakeSource()
        const reader = new RangeBatchReader(source, 1000, flat([[0, 20], [50, 70]]), 100, 10)
        await reader.read(0, 10)
        expect(isBytes(await reader.read(10, 500), 10, 500)).toBe(true)
        expect(isBytes(await reader.read(30, 40), 30, 40)).toBe(true)
        expect(isBytes(await reader.read(50, 60), 50, 60)).toBe(true)
        expect(calls.batches).toHaveLength(1)
        expect(calls.reads).toEqual([[10, 500], [30, 40]])
    })

    test('a request below the cursor is found again', async () => {
        const { source, calls } = fakeSource()
        const reader = new RangeBatchReader(source, 1000, flat([[0, 20], [200, 220], [400, 420], [600, 620]]), 100, 0)
        const starts = [0, 600, 400, 0, 200, 0, 600]
        for (const start of starts) {
            expect(isBytes(await reader.read(start, start + 20), start, start + 20)).toBe(true)
        }
        // The window holds all four segments, so the first request fills one batch and every later request, forward or
        // below the cursor, is served from it: no exact read and no second batch.
        expect(calls.reads).toEqual([])
        expect(calls.batches).toEqual([[[0, 20], [200, 220], [400, 420], [600, 620]]])
    })

    test('a part of the wrong length drops the batch and every later request is read exactly', async () => {
        const batchesSeen: RangePair[][] = []
        const { source, calls } = fakeSource({
            readRanges: async (ranges) => {
                batchesSeen.push(ranges.map(([a, b]): RangePair => [a, b]))
                const parts = ranges.map(([a, b]) => bytes.slice(a, b))
                parts[parts.length - 1] = parts[parts.length - 1].slice(1)
                return parts
            },
        })
        const reader = new RangeBatchReader(source, 1000, flat([[0, 20], [50, 70]]), 100, 10)
        expect(isBytes(await reader.read(0, 10), 0, 10)).toBe(true)
        expect(isBytes(await reader.read(50, 60), 50, 60)).toBe(true)
        expect(isBytes(await reader.read(0, 5), 0, 5)).toBe(true)
        expect(batchesSeen).toHaveLength(1)
        expect(calls.reads).toEqual([[0, 10], [50, 60], [0, 5]])
    })

    test('a source without readRanges is read one segment per miss', async () => {
        const { source, calls } = fakeSource({ readRanges: undefined })
        const reader = new RangeBatchReader(source, 1000, flat([[0, 20], [50, 70]]), 100, 10)
        expect(isBytes(await reader.read(5, 10), 5, 10)).toBe(true)
        expect(isBytes(await reader.read(50, 60), 50, 60)).toBe(true)
        expect(calls.reads).toEqual([[0, 20], [50, 70]])
    })

    test('a source error propagates and nothing is held', async () => {
        const { source, calls } = fakeSource({ readRanges: async () => { throw new Error('gone') } })
        const reader = new RangeBatchReader(source, 1000, flat([[0, 20], [50, 70]]), 100, 10)
        await expect(reader.read(0, 10)).rejects.toThrow('gone')
        expect(calls.reads).toEqual([])
    })

    describe('the work to build and search the table', () => {
        const MIB_8 = 8 * MIB
        const zeroSource: ImportSource = {
            name: 'z',
            size: 2 ** 40,
            read: async (start, end) => new Uint8Array(end - start),
            readRanges: async (ranges) => ranges.map(([a, b]) => new Uint8Array(b - a)),
            stream: () => new ReadableStream(),
            stat: async () => ({ size: 2 ** 40, modified: null }),
            close: async () => undefined,
        }

        test.each([
            [3000, 2 * MIB],
            [20000, 2 * MIB],
            [3000, 4096],
            [20000, 4096],
        ])('%i ranges spaced %i apart take work linear in ranges and requests', async (count, spacing) => {
            const ranges = Array.from({ length: count }, (_unused, i): RangePair => [i * spacing, i * spacing + 64])
            const reader = new RangeBatchReader(zeroSource, 2 ** 40, flat(ranges), MIB_8, MIB)
            let requests = 0
            for (const [start] of ranges) {
                expect((await reader.read(start, start + 16)).length).toBe(16)
                expect((await reader.read(start + 16, start + 64)).length).toBe(48)
                requests += 2
            }
            expect(reader.steps).toBeLessThanOrEqual(4 * (count + requests))
        })
    })
})
