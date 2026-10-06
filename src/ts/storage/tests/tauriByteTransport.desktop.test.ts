/**
 * The desktop byte transport (`src/ts/storage/tauriByteTransport.ts`) against
 * the in-memory stand-in for its commands (`tauriDesktopFake.ts` over
 * `tauriChunkFake.ts`): which platform uses which transport, raw chunks and the
 * base64 switch after a not-raw refusal, the key check before chunk 0, abort on
 * failure, the incremental writer and the ranged reader. The Rust commands are
 * tested in `src-tauri`; a pass here is not evidence about them or about the
 * web view's memory behaviour.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const desktop = (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fs)
    const state: { os: string | 'throws', override: ((command: string, args?: unknown, options?: unknown) => Promise<unknown>) | undefined } = {
        os: 'windows',
        override: undefined,
    }
    return { fs, desktop, state }
})

vi.mock('@tauri-apps/plugin-os', () => ({
    type: () => {
        if (h.state.os === 'throws') {
            throw new TypeError('the shell is missing')
        }
        return h.state.os
    },
}))
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (command: string, args?: unknown, options?: unknown) =>
        (h.state.override ? h.state.override(command, args, options) : h.desktop.invoke(command, args, options as { headers?: Record<string, string> })),
}))

import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'
import {
    CHUNK_MAX,
    createChunkedWriter,
    isAndroidTransport,
    isDesktopTransport,
    RangeReadChangedError,
    readPieceBytes,
    readRanged,
    readRangedPieces,
    resetByteTransportForTests,
    shouldChunkWrite,
    transportKind,
    WRITE_CHUNK_BYTES,
    writeChunked,
} from 'src/ts/storage/tauriByteTransport'

const KEY = 'blocks/gen/c/6162'

function patterned(length: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + 3) % 251)
}

function stored(key: string): number[] | undefined {
    const bytes = h.fs.files.get(key)
    return bytes === undefined ? undefined : Array.from(bytes)
}

function leftoverTemps(): string[] {
    return Array.from(h.fs.files.keys()).filter((key) => /risu-write-[0-9a-f]{16}\.tmp$/.test(key))
}

beforeEach(() => {
    h.fs.reset()
    h.desktop.reset()
    h.state.os = 'windows'
    h.state.override = undefined
    resetByteTransportForTests()
})

describe('which transport a platform uses', () => {
    test.each([['windows', 'desktop'], ['macos', 'desktop'], ['linux', 'desktop'], ['android', 'android'], ['ios', 'other']] as const)(
        'the %s operating system uses the %s transport',
        (os, kind) => {
            h.state.os = os
            expect(transportKind()).toBe(kind)
            expect(isDesktopTransport()).toBe(kind === 'desktop')
            expect(isAndroidTransport()).toBe(kind === 'android')
        },
    )

    test('a page where the operating-system plugin cannot answer uses neither, and does not throw', () => {
        h.state.os = 'throws'
        expect(transportKind()).toBe('other')
    })

    test('the read piece is CHUNK_MAX on desktop and 8 MiB on Android', () => {
        h.state.os = 'windows'
        expect(readPieceBytes()).toBe(CHUNK_MAX)
        h.state.os = 'android'
        expect(readPieceBytes()).toBe(8 * 1024 * 1024)
    })

    test('a write is chunked above CHUNK_MAX on desktop, always on Android and never elsewhere', () => {
        h.state.os = 'linux'
        expect(shouldChunkWrite(0)).toBe(false)
        expect(shouldChunkWrite(CHUNK_MAX)).toBe(false)
        expect(shouldChunkWrite(CHUNK_MAX + 1)).toBe(true)
        h.state.os = 'android'
        expect(shouldChunkWrite(0)).toBe(true)
        expect(shouldChunkWrite(1)).toBe(true)
        h.state.os = 'throws'
        expect(shouldChunkWrite(CHUNK_MAX * 4)).toBe(false)
    })
})

describe('desktop raw chunks', () => {
    test('a write above one chunk sends raw bodies of at most CHUNK_MAX, offsets running on from zero, only the last marked', async () => {
        const input = patterned(CHUNK_MAX * 2 + 12345)

        await writeChunked(KEY, input, true)

        expect(h.desktop.commands).toEqual(['write_chunk_raw', 'write_chunk_raw', 'write_chunk_raw'])
        expect(h.desktop.rawCalls.map((call) => [call.offset, call.size, call.last])).toEqual([
            [0, CHUNK_MAX, false],
            [CHUNK_MAX, CHUNK_MAX, false],
            [CHUNK_MAX * 2, 12345, true],
        ])
        expect(Buffer.compare(Buffer.from(h.fs.files.get(KEY) ?? []), Buffer.from(input))).toBe(0)
        expect(leftoverTemps()).toEqual([])
    })

    test('sends the key percent-encoded, one 16-digit hex id on every chunk, and the durable flag as 1 or 0', async () => {
        const seen: Array<Record<string, string>> = []
        h.state.override = async (command, args, options) => {
            seen.push((options as { headers: Record<string, string> }).headers)
            return await h.desktop.invoke(command, args, options as { headers: Record<string, string> })
        }

        await writeChunked('assets/a b%c.png', patterned(10), false, 4)
        await writeChunked('blocks/x', patterned(5), true, 4)

        expect(seen.map((headers) => decodeURIComponent(headers['x-risu-key']))).toEqual(['assets/a b%c.png', 'assets/a b%c.png', 'assets/a b%c.png', 'blocks/x', 'blocks/x'])
        expect(seen[0]['x-risu-key']).toBe(encodeURIComponent('assets/a b%c.png'))
        expect(new Set(seen.slice(0, 3).map((headers) => headers['x-risu-id'])).size).toBe(1)
        expect(seen[0]['x-risu-id']).toMatch(/^[0-9a-f]{16}$/)
        expect(seen[0]['x-risu-id']).not.toBe(seen[3]['x-risu-id'])
        expect(seen.map((headers) => headers['x-risu-offset'])).toEqual(['0', '4', '8', '0', '4'])
        expect(seen.map((headers) => headers['x-risu-last'])).toEqual(['0', '0', '1', '0', '1'])
        expect(seen.map((headers) => headers['x-risu-durable'])).toEqual(['0', '0', '0', '1', '1'])
    })

    test('an input of exactly one chunk is a single call, and one byte more is two', async () => {
        await writeChunked(KEY, patterned(CHUNK_MAX), true)
        expect(h.desktop.count('write_chunk_raw')).toBe(1)

        h.desktop.reset()
        await writeChunked(KEY, patterned(CHUNK_MAX + 1), true)
        expect(h.desktop.count('write_chunk_raw')).toBe(2)
    })

    test('an empty input is one empty last chunk', async () => {
        await writeChunked(KEY, new Uint8Array(0), true)

        expect(h.desktop.rawCalls.map((call) => [call.offset, call.size, call.last])).toEqual([[0, 0, true]])
        expect(stored(KEY)).toEqual([])
    })

    test('a refused key on chunk 0 comes back as StoreInvalidKeyError carrying the reason, and writes nothing', async () => {
        h.state.override = async () => ({ k: 'invalid', reason: 'a name may not end in a dot' })

        await expect(writeChunked(KEY, patterned(10), true, 4)).rejects.toMatchObject({ name: 'StoreInvalidKeyError', reason: 'a name may not end in a dot' })
    })

    test('an error outcome rejects with its message, and aborts only when an earlier chunk had landed', async () => {
        h.desktop.chunk.failWrites(({ offset }) => (offset === 0 ? 'disk full (os error 28)' : undefined))

        await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toThrow('disk full (os error 28)')
        expect(h.desktop.count('abort_chunked')).toBe(0)

        h.desktop.reset()
        h.desktop.chunk.failWrites(({ offset }) => (offset === 8 ? 'disk full (os error 28)' : undefined))

        await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toThrow('disk full (os error 28)')
        expect(h.desktop.count('abort_chunked')).toBe(1)
        expect(leftoverTemps()).toEqual([])
        expect(stored(KEY)).toBeUndefined()
    })

    test('an unreadable outcome rejects', async () => {
        h.state.override = async () => 'something else'

        await expect(writeChunked(KEY, patterned(10), true, 4)).rejects.toThrow(/unreadable/)
    })
})

describe('the not-raw refusal', () => {
    test('moves the same chunk and every later write of the page to base64 write_chunk, each at most CHUNK_MAX', async () => {
        h.desktop.refuseRawBodies()
        const input = patterned(CHUNK_MAX + 100)

        await writeChunked(KEY, input, true)
        await writeChunked('assets/b', patterned(CHUNK_MAX + 1), false)

        expect(h.desktop.commands).toEqual([
            'write_chunk_raw', 'write_chunk', 'write_chunk',
            'write_chunk', 'write_chunk',
        ])
        expect(h.desktop.chunk.chunkSizes).toEqual([CHUNK_MAX, 100, CHUNK_MAX, 1])
        expect(Buffer.compare(Buffer.from(h.fs.files.get(KEY) ?? []), Buffer.from(input))).toBe(0)
        expect(stored('assets/b')?.length).toBe(CHUNK_MAX + 1)
        expect(Math.max(...h.desktop.payloads)).toBeLessThanOrEqual(CHUNK_MAX)
    })

    test('a refusal does not hide a real failure of the resent chunk', async () => {
        h.desktop.refuseRawBodies()
        h.desktop.chunk.failWrites(({ offset }) => (offset === 0 ? 'No space left (os error 28)' : undefined))

        await expect(writeChunked(KEY, patterned(10), true, 4)).rejects.toBe('No space left (os error 28)')
    })

    test('a rejection that is not a not-raw refusal is not mistaken for one', async () => {
        h.state.override = async () => { throw 'malformed: truncated header' }

        await expect(writeChunked(KEY, patterned(10), true, 4)).rejects.toBe('malformed: truncated header')

        h.state.override = undefined
        await writeChunked(KEY, patterned(10), true, 4)
        expect(h.desktop.count('write_chunk_raw')).toBeGreaterThan(1)
    })
})

describe('the key check before chunk 0', () => {
    test.each(['assets/x.', 'assets/a:b.png', 'assets/.hidden', 'a//b', 'assets/a|b'])(
        'a refused key %j throws StoreInvalidKeyError before any call, raw or base64',
        async (key) => {
            expect(() => createChunkedWriter(key, { durable: false })).toThrow(StoreInvalidKeyError)
            expect(h.desktop.commands).toEqual([])

            // After a not-raw refusal the chunks travel as base64, and the key is still checked first.
            h.desktop.refuseRawBodies()
            await writeChunked('assets/ok', patterned(5), false, 4)
            h.desktop.commands.length = 0
            expect(() => createChunkedWriter(key, { durable: false })).toThrow(StoreInvalidKeyError)
            expect(h.desktop.commands).toEqual([])
        },
    )

    test('an accepted key creates a writer without any call', () => {
        createChunkedWriter('assets/ok.png', { durable: true })

        expect(h.desktop.commands).toEqual([])
    })
})

describe('the incremental writer', () => {
    test('assembles the pieces it is given in order, however they are split, and marks only the final chunk', async () => {
        const first = patterned(CHUNK_MAX)
        const second = patterned(CHUNK_MAX).map((byte) => byte ^ 0x55)
        const third = patterned(77)
        const writer = createChunkedWriter('assets/big.bin', { durable: true })

        await writer.write(first)
        await writer.write(second)
        await writer.write(third)
        expect(h.desktop.count('write_chunk_raw')).toBe(2)
        expect(stored('assets/big.bin')).toBeUndefined()
        await writer.finish()

        expect(h.desktop.rawCalls.map((call) => [call.offset, call.size, call.last])).toEqual([
            [0, CHUNK_MAX, false],
            [CHUNK_MAX, CHUNK_MAX, false],
            [CHUNK_MAX * 2, 77, true],
        ])
        expect(Buffer.compare(Buffer.from(h.fs.files.get('assets/big.bin') ?? []), Buffer.concat([first, second, third]))).toBe(0)
    })

    test('splits a piece above the chunk size, and joins nothing across pieces', async () => {
        const writer = createChunkedWriter('assets/x', { durable: false, chunkBytes: 4 })

        await writer.write(patterned(10))
        await writer.write(patterned(3))
        await writer.finish()

        expect(h.desktop.rawCalls.map((call) => call.size)).toEqual([4, 4, 2, 3])
    })

    test('finish with nothing written sends one empty last chunk', async () => {
        const writer = createChunkedWriter('assets/empty', { durable: false })

        await writer.finish()

        expect(h.desktop.rawCalls.map((call) => [call.offset, call.size, call.last])).toEqual([[0, 0, true]])
        expect(stored('assets/empty')).toEqual([])
    })

    test('a failure rejects the write that sent the chunk, removes the temp, and every later call rejects with the same error', async () => {
        h.desktop.chunk.failWrites(({ offset }) => (offset === 4 ? 'boom' : undefined))
        const writer = createChunkedWriter('assets/x', { durable: false, chunkBytes: 4 })
        await writer.write(patterned(4))
        await writer.write(patterned(4))

        await expect(writer.write(patterned(4))).rejects.toThrow('boom')

        expect(h.desktop.count('abort_chunked')).toBe(1)
        expect(leftoverTemps()).toEqual([])
        await expect(writer.write(patterned(1))).rejects.toThrow('boom')
        await expect(writer.finish()).rejects.toThrow('boom')
        expect(h.desktop.count('abort_chunked')).toBe(1)
    })

    test('abort after chunks landed removes the temp once and leaves the key as it was', async () => {
        h.fs.plant('assets/x', Uint8Array.from([9]))
        const writer = createChunkedWriter('assets/x', { durable: false, chunkBytes: 4 })
        await writer.write(patterned(12))

        await writer.abort()
        await writer.abort()

        expect(h.desktop.count('abort_chunked')).toBe(1)
        expect(leftoverTemps()).toEqual([])
        expect(stored('assets/x')).toEqual([9])
        await expect(writer.write(patterned(1))).rejects.toThrow()
    })

    test('abort before any chunk landed calls nothing, and abort after finish changes nothing', async () => {
        const unstarted = createChunkedWriter('assets/y', { durable: false, chunkBytes: 4 })
        await unstarted.write(patterned(3))
        await unstarted.abort()
        expect(h.desktop.commands).toEqual([])

        const done = createChunkedWriter('assets/z', { durable: false })
        await done.write(patterned(3))
        await done.finish()
        await done.abort()
        expect(h.desktop.count('abort_chunked')).toBe(0)
        expect(stored('assets/z')?.length).toBe(3)
    })

    test('an abort whose own call fails never rejects', async () => {
        const writer = createChunkedWriter('assets/x', { durable: false, chunkBytes: 4 })
        await writer.write(patterned(8))
        h.desktop.chunk.failAborts('abort error')

        await expect(writer.abort()).resolves.toBeUndefined()
    })

    test('a zero chunk size is refused', () => {
        expect(() => createChunkedWriter('assets/x', { durable: false, chunkBytes: 0 })).toThrow(RangeError)
    })
})

describe('Android keeps base64 chunks of one megabyte', () => {
    test('a write is chunked from the first byte, as base64, and the key is not checked page-side', async () => {
        h.state.os = 'android'

        await writeChunked('assets/a:b', patterned(WRITE_CHUNK_BYTES + 5), true)

        expect(h.desktop.commands).toEqual(['write_chunk', 'write_chunk'])
        expect(h.desktop.chunk.chunkSizes).toEqual([WRITE_CHUNK_BYTES, 5])
    })
})

describe('the ranged reader on desktop', () => {
    function plant(length: number): Uint8Array {
        const bytes = patterned(length)
        h.fs.plant('assets/x', bytes)
        return bytes
    }

    test('asks for pieces of CHUNK_MAX: a file of one piece costs one call and one byte more costs two', async () => {
        plant(CHUNK_MAX)
        await readRanged('assets/x')
        expect(h.desktop.chunk.callsOf('read_range').map((call) => call.args.len)).toEqual([CHUNK_MAX])

        h.desktop.reset()
        const bytes = plant(CHUNK_MAX + 1)
        const read = await readRanged('assets/x')
        expect(h.desktop.chunk.callsOf('read_range').map((call) => [call.args.offset, call.args.len])).toEqual([[0, CHUNK_MAX], [CHUNK_MAX, 1]])
        expect(Buffer.compare(Buffer.from(read), Buffer.from(bytes))).toBe(0)
    })

    test('yields the first piece with the trailer total and identity, then each later piece, and nothing after the end', async () => {
        const bytes = plant(25)
        const pieces: Array<{ offset: number, length: number, total: number }> = []
        const identities = new Set<string>()

        for await (const piece of readRangedPieces('assets/x', 10)) {
            pieces.push({ offset: piece.offset, length: piece.bytes.length, total: piece.total })
            identities.add(piece.identity)
        }

        expect(pieces).toEqual([{ offset: 0, length: 10, total: 25 }, { offset: 10, length: 10, total: 25 }, { offset: 20, length: 5, total: 25 }])
        expect(identities.size).toBe(1)
        expect(h.desktop.chunk.callsOf('read_range')).toHaveLength(3)
        expect(bytes.length).toBe(25)
    })

    test('an empty file yields one empty piece with total 0', async () => {
        plant(0)

        const pieces = []
        for await (const piece of readRangedPieces('assets/x', 10)) {
            pieces.push(piece)
        }

        expect(pieces.map((piece) => [piece.offset, piece.bytes.length, piece.total])).toEqual([[0, 0, 0]])
    })

    test('a missing file rejects the first step with the command error', async () => {
        const reading = readRangedPieces('assets/gone', 10).next()

        await expect(reading).rejects.toEqual(expect.stringMatching(/\(os error 2\)$/))
    })

    test('a file replaced between pieces ends the stream with RangeReadChangedError and asks for nothing more', async () => {
        plant(25)
        h.desktop.chunk.hooks.before = ({ index }) => {
            if (index === 1) {
                h.fs.files.set('assets/x', patterned(25))
            }
        }
        const seen: number[] = []

        const reading = (async () => {
            for await (const piece of readRangedPieces('assets/x', 10)) {
                seen.push(piece.offset)
            }
        })()

        await expect(reading).rejects.toBeInstanceOf(RangeReadChangedError)
        expect(seen).toEqual([0])
        expect(h.desktop.chunk.callsOf('read_range')).toHaveLength(2)
    })

    test.each([
        ['vanishes', (): void => { h.fs.files.delete('assets/x') }],
        ['changes size', (): void => { h.fs.files.set('assets/x', patterned(40)) }],
    ])('a file that %s between pieces ends the stream with RangeReadChangedError', async (_name, change) => {
        plant(25)
        h.desktop.chunk.hooks.before = ({ index }) => {
            if (index === 1) {
                change()
            }
        }

        const reading = (async () => {
            for await (const piece of readRangedPieces('assets/x', 10)) {
                void piece
            }
        })()

        await expect(reading).rejects.toBeInstanceOf(RangeReadChangedError)
    })

    test('a short piece is continued from where it stopped, and a piece of nothing before the end rejects', async () => {
        plant(25)
        h.desktop.chunk.hooks.limit = ({ index }) => (index >= 1 ? 3 : undefined)
        const lengths: number[] = []
        for await (const piece of readRangedPieces('assets/x', 10)) {
            lengths.push(piece.bytes.length)
        }
        expect(lengths).toEqual([10, 3, 3, 3, 3, 3])

        h.desktop.reset()
        h.desktop.chunk.hooks.limit = ({ index }) => (index === 1 ? 0 : undefined)
        const reading = (async () => {
            for await (const piece of readRangedPieces('assets/x', 10)) {
                void piece
            }
        })()
        await expect(reading).rejects.toBeInstanceOf(RangeReadChangedError)
    })
})
