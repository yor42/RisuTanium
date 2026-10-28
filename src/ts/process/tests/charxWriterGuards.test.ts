/**
 * `CharXWriter` in `src/ts/process/processzip.ts`: the strict size backstop, the entry and name limits, and the latch
 * that keeps a failed export failed. Every test here is NEW BEHAVIOUR (CHORE-375 stages B and C1): on the base the writer
 * has no such limit or latch, so there is nothing to be red against. The real writer runs on the real fflate `Deflate`;
 * the file writer is a recorder, and a compression or checksum failure is injected through the `charxCodec` hook. The
 * browser canvas behind `charxEncode.jpeg` is replaced by a stub that returns fixed bytes. A mocked writer is not
 * evidence of native file behaviour.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { CHARX_MAX_ENTRIES } from 'src/ts/drive/exportPreflight'
import { parseCharx } from './charxFramingParser'

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/alert'), () => ({
    alertStore: { set: vi.fn(), subscribe: vi.fn(), update: vi.fn() },
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    Semaphore: class { async acquire() { } release() { } },
    asBuffer: (a: unknown) => a,
    sleep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const { AppendableBuffer } = await import('src/ts/byteBuffer')
    return {
        AppendableBuffer,
        pieceStoreOrNull: vi.fn(async () => null),
        saveAsset: vi.fn(),
        saveAssetFromPieces: vi.fn(),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

import { CharXWriter, CharxNameTooLongError, CharxTooLargeError, CharxTooManyEntriesError, ZIP_MAX_ENTRIES, charxCodec, charxEncode } from '../processzip'

function recorder() {
    const chunks: Uint8Array[] = []
    let closed = false
    const writer = {
        write: vi.fn(async (data: Uint8Array) => { chunks.push(data.slice()) }),
        close: vi.fn(async () => { closed = true }),
    }
    return { writer, chunks, isClosed: () => closed, bytes: () => chunks.reduce((n, c) => n + c.length, 0) }
}

type Target = ConstructorParameters<typeof CharXWriter>[0]

describe('CharXWriter backstop (new behaviour)', () => {
    test('a chunk that would make the archive reach the limit is never handed on', async () => {
        const out = recorder()
        const limit = 3000
        const writer = new CharXWriter(out.writer as unknown as Target, limit)
        const payload = new Uint8Array(500).fill(7)
        let thrown: unknown = null
        let written = 0
        for (let i = 0; i < 10 && thrown === null; i++) {
            try {
                await writer.write(`entry${i}.bin`, payload)
                written++
            } catch (error) {
                thrown = error
            }
        }
        expect(thrown).toBeInstanceOf(CharxTooLargeError)
        expect(written).toBeGreaterThan(0)
        expect(written).toBeLessThan(10)
        expect(out.writer.write).toHaveBeenCalledTimes(written)
        expect(out.bytes()).toBeLessThan(limit)
    })

    test('an entry whose uncompressed size reaches the limit is refused even when it compresses far below it', async () => {
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target, 2000)
        await expect(writer.write('zeros.bin', new Uint8Array(5000), 9)).rejects.toBeInstanceOf(CharxTooLargeError)
        expect(out.writer.write).not.toHaveBeenCalled()
    })

    test('the central directory counts too: end() refuses a directory that would cross the limit', async () => {
        const out = recorder()
        const limit = 1000
        const writer = new CharXWriter(out.writer as unknown as Target, limit)
        await writer.write('a.bin', new Uint8Array(100))
        const before = out.bytes()
        // room for the entry but not for the directory that end() adds
        const probe = new CharXWriter(recorder().writer as unknown as Target, before + 1)
        await expect(probe.write('a.bin', new Uint8Array(100)).then(() => probe.end())).rejects.toBeInstanceOf(CharxTooLargeError)
    })

    test('an archive below the limit is written whole and closed', async () => {
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target)
        await writer.write('a.bin', new Uint8Array(100))
        await writer.end()
        expect(out.isClosed()).toBe(true)
        expect(out.bytes()).toBeGreaterThan(100)
    })

    describe('a jpeg in front of the archive', () => {
        const prefix = new Uint8Array(5000).fill(0xff)

        beforeEach(() => {
            vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
                if (tag === 'canvas') {
                    return {
                        width: 0,
                        height: 0,
                        getContext: () => ({ drawImage: () => { } }),
                        toBlob: (done: BlobCallback) => done(new Blob([prefix])),
                    }
                }
                return { src: '', width: 1, height: 1, decode: async () => { } }
            }) as unknown as typeof document.createElement)
            vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: () => 'blob:stub' }))
        })

        afterEach(() => {
            vi.restoreAllMocks()
            vi.unstubAllGlobals()
        })

        test('the prefix is outside the zip offsets, so it does not count against the limit', async () => {
            const out = recorder()
            const writer = new CharXWriter(out.writer as unknown as Target, 1000)
            await writer.writeJpeg(new Uint8Array([0xff, 0xd8]))
            await writer.write('a.bin', new Uint8Array(100))
            await writer.end()
            expect(out.bytes()).toBeGreaterThan(prefix.length)
            expect(out.isClosed()).toBe(true)
        })
    })
})

describe('CharXWriter header check before hand-on (new behaviour)', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    test('a compressed size that reaches the limit is refused before anything is handed on', async () => {
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target, 3000)
        // the data is small; only the body the codec returns is over the limit
        vi.spyOn(charxCodec, 'deflate').mockReturnValue(new Uint8Array(3500))
        await expect(writer.write('a.bin', new Uint8Array(10))).rejects.toBeInstanceOf(CharxTooLargeError)
        expect(out.writer.write).not.toHaveBeenCalled()
    })

    test('an entry whose bytes would carry the archive over the limit is refused before they are handed on', async () => {
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target, 300)
        await writer.write('a.bin', new Uint8Array(150).fill(1))
        const handedOn = out.bytes()
        await expect(writer.write('b.bin', new Uint8Array(150).fill(2))).rejects.toBeInstanceOf(CharxTooLargeError)
        expect(out.bytes()).toBe(handedOn)
        expect(out.writer.write).toHaveBeenCalledTimes(1)
    })
})

describe('CharXWriter entry and name limits (new behaviour)', () => {
    function writerOf(out: ReturnType<typeof recorder>) {
        return new CharXWriter(out.writer as unknown as Target)
    }

    test('the limit is the 16-bit entry count of the end record, and the pre-check uses the same number', () => {
        expect(ZIP_MAX_ENTRIES).toBe(65535)
        expect(CHARX_MAX_ENTRIES).toBe(ZIP_MAX_ENTRIES)
    })

    test('65,535 entries are written and counted by the end record', async () => {
        const out = recorder()
        const writer = writerOf(out)
        for (let i = 0; i < ZIP_MAX_ENTRIES; i++) {
            await writer.write(`e${i}.bin`, new Uint8Array([i & 255]))
        }
        await writer.end()
        expect(out.isClosed()).toBe(true)
        expect(parseCharx(Buffer.concat(out.chunks)).end.entries).toBe(ZIP_MAX_ENTRIES)
    }, 60_000)

    test('the 65,536th entry throws CharxTooManyEntriesError, hands nothing on and fails the export', async () => {
        const out = recorder()
        const writer = writerOf(out)
        for (let i = 0; i < ZIP_MAX_ENTRIES; i++) {
            await writer.write(`e${i}.bin`, new Uint8Array([i & 255]))
        }
        const handedOn = out.writer.write.mock.calls.length
        await expect(writer.write('one-too-many.bin', new Uint8Array([1]))).rejects.toBeInstanceOf(CharxTooManyEntriesError)
        expect(out.writer.write.mock.calls.length).toBe(handedOn)
        await expect(writer.end()).rejects.toBeInstanceOf(CharxTooManyEntriesError)
        expect(out.isClosed()).toBe(false)
    }, 60_000)

    test('a name of 65,535 bytes is written; one of 65,536 bytes throws CharxNameTooLongError', async () => {
        const out = recorder()
        const writer = writerOf(out)
        await writer.write('a'.repeat(65535 - 4) + '.bin', new Uint8Array([1]))
        const handedOn = out.writer.write.mock.calls.length
        await expect(writer.write('b'.repeat(65536 - 4) + '.bin', new Uint8Array([1]))).rejects.toBeInstanceOf(CharxNameTooLongError)
        expect(out.writer.write.mock.calls.length).toBe(handedOn)
    })

    test('the name limit counts UTF-8 bytes, not characters', async () => {
        const out = recorder()
        const writer = writerOf(out)
        // 21,844 three-byte characters and '.bin' are 65,536 bytes, with far fewer than 65,535 characters
        await expect(writer.write('한'.repeat(21844) + '.bin', new Uint8Array([1]))).rejects.toBeInstanceOf(CharxNameTooLongError)
        expect(out.writer.write).not.toHaveBeenCalled()
    })
})

describe('CharXWriter entry timestamp (new behaviour)', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    test('an entry has one timestamp, in its local header and in its central record, and the next entry has its own', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(new Date(2026, 2, 4, 5, 6, 8))
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target)
        await writer.write('a.bin', new Uint8Array([1]))
        vi.setSystemTime(new Date(2026, 2, 4, 5, 6, 30))
        await writer.write('b.bin', new Uint8Array([2]))
        // the clock moves again before the central directory is written
        vi.setSystemTime(new Date(2026, 5, 7, 8, 9, 10))
        await writer.end()
        const [first, second] = parseCharx(Buffer.concat(out.chunks)).entries
        expect(first.local.stamp).toBe(first.central.stamp)
        expect(second.local.stamp).toBe(second.central.stamp)
        expect(second.central.stamp).not.toBe(first.central.stamp)
        // DOS fields: year since 1980, month, day, hour, minute, seconds / 2
        const fields = (stamp: number) => [(stamp >>> 25) + 1980, (stamp >>> 21) & 15, (stamp >>> 16) & 31, (stamp >>> 11) & 31, (stamp >>> 5) & 63, (stamp & 31) * 2]
        expect(fields(first.central.stamp)).toEqual([2026, 3, 4, 5, 6, 8])
        expect(fields(second.central.stamp)).toEqual([2026, 3, 4, 5, 6, 30])
    })

    test('a clock past the year 2099 cannot be recorded: the export fails and nothing is handed on', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target)
        vi.setSystemTime(new Date(2099, 11, 31, 12, 0, 0))
        await writer.write('a.bin', new Uint8Array([1]))
        vi.setSystemTime(new Date(2100, 0, 1, 12, 0, 0))
        await expect(writer.write('b.bin', new Uint8Array([1]))).rejects.toBeInstanceOf(RangeError)
        expect(out.writer.write).toHaveBeenCalledTimes(1)
    })
})

describe('CharXWriter latch (new behaviour)', () => {
    const failure = new Error('synthetic compressor failure')

    afterEach(() => {
        vi.restoreAllMocks()
    })

    // The injected failure happens once; only the latch can make a later call fail.
    const seams: Array<[string, () => void]> = [
        ['the compressor', () => { vi.spyOn(charxCodec, 'deflate').mockImplementationOnce(() => { throw failure }) }],
        ['the checksum', () => { vi.spyOn(charxCodec, 'crc32').mockImplementationOnce(() => { throw failure }) }],
    ]

    for (const [seam, inject] of seams) {
        test(`a throwing ${seam} rejects the export and writes nothing`, async () => {
            const out = recorder()
            const writer = new CharXWriter(out.writer as unknown as Target)
            inject()
            await expect(writer.write('a.bin', new Uint8Array(10))).rejects.toBe(failure)
            expect(out.writer.write).not.toHaveBeenCalled()
        })

        test(`after a throwing ${seam}, every later write and the end rethrow the same error and write nothing`, async () => {
            const out = recorder()
            const writer = new CharXWriter(out.writer as unknown as Target)
            inject()
            await expect(writer.write('a.bin', new Uint8Array(10))).rejects.toBe(failure)
            await expect(writer.write('b.bin', new Uint8Array(10))).rejects.toBe(failure)
            await expect(writer.writeJpeg(new Uint8Array(10))).rejects.toBe(failure)
            await expect(writer.end()).rejects.toBe(failure)
            expect(out.writer.write).not.toHaveBeenCalled()
            expect(out.isClosed()).toBe(false)
        })
    }

    test('an error from the file writer latches too', async () => {
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target)
        const writeFailure = new Error('disk full')
        out.writer.write.mockRejectedValueOnce(writeFailure)
        await expect(writer.write('a.bin', new Uint8Array(10))).rejects.toBe(writeFailure)
        await expect(writer.write('b.bin', new Uint8Array(10))).rejects.toBe(writeFailure)
        await expect(writer.end()).rejects.toBe(writeFailure)
        expect(out.isClosed()).toBe(false)
    })

    test('a writer that never failed is unaffected by another writer\'s latch', async () => {
        const failed = new CharXWriter(recorder().writer as unknown as Target)
        vi.spyOn(charxCodec, 'deflate').mockImplementationOnce(() => { throw failure })
        await expect(failed.write('a.bin', new Uint8Array(10))).rejects.toBe(failure)
        const out = recorder()
        const fresh = new CharXWriter(out.writer as unknown as Target)
        await fresh.write('a.bin', new Uint8Array(10))
        await fresh.end()
        expect(out.isClosed()).toBe(true)
    })

    test('a hook that returns no JPEG leaves the archive with no prefix', async () => {
        vi.spyOn(charxEncode, 'jpeg').mockResolvedValue(null)
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target)
        await writer.writeJpeg(new Uint8Array(10))
        await writer.write('a.bin', new Uint8Array(10))
        await writer.end()
        const bytes = Buffer.concat(out.chunks)
        expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
        expect(parseCharx(bytes).prefixLength).toBe(0)
    })
})
