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
    IMPORT_WINDOW_BYTES, WindowedReader, importSourceOfBytes, importSourceOfFile, isImportSource, openDesktopImportSource,
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
})
