/**
 * `CharXWriter` in `src/ts/process/processzip.ts`: the strict size backstop and the handling of an fflate error.
 * Every test here is NEW BEHAVIOUR (CHORE-375 stage B): on the base the writer has neither, so there is nothing to be
 * red against. The real writer runs on the real fflate; the file writer is a recorder, and the fflate error is
 * injected by calling the zip's own `ondata` the way the library does. The browser canvas of `writeJpeg` is replaced by
 * a stub that returns fixed bytes. A mocked writer is not evidence of native file behaviour.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type * as fflate from 'fflate'

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

import { CharXWriter, CharxTooLargeError } from '../processzip'

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

describe('CharXWriter fflate errors (new behaviour)', () => {
    const failure = Object.assign(new Error('synthetic fflate failure'), { code: 0 }) as fflate.FlateError

    function failingWriter() {
        const out = recorder()
        const writer = new CharXWriter(out.writer as unknown as Target)
        const add = writer.zip.add.bind(writer.zip)
        vi.spyOn(writer.zip, 'add').mockImplementation((file) => {
            add(file)
            writer.zip.ondata(failure, new Uint8Array(0), false)
        })
        return { out, writer }
    }

    test('the export rejects with the error and writes nothing', async () => {
        const { out, writer } = failingWriter()
        await expect(writer.write('a.bin', new Uint8Array(10))).rejects.toBe(failure)
        expect(out.writer.write).not.toHaveBeenCalled()
    })

    test('every later write and the end throw the recorded error and write nothing', async () => {
        const { out, writer } = failingWriter()
        await expect(writer.write('a.bin', new Uint8Array(10))).rejects.toBe(failure)
        await expect(writer.write('b.bin', new Uint8Array(10))).rejects.toBe(failure)
        await expect(writer.end()).rejects.toBe(failure)
        expect(out.writer.write).not.toHaveBeenCalled()
        expect(out.isClosed()).toBe(false)
    })
})
