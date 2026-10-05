/**
 * The Android byte transport (`src/ts/storage/tauriByteTransport.ts`) against
 * the in-memory stand-in for its three Rust commands (`tauriChunkFake.ts`).
 * The Rust side (temp file, flushes, rename, key rules) is tested in
 * `src-tauri/src/chunked_io.rs`; a pass here is not evidence about it or about
 * the native bridge.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const chunk = (await import('src/ts/storage/tests/tauriChunkFake')).createChunkedInvoke(fs)
    const state: { os: string | 'throws', override: ((command: string, args?: unknown) => Promise<unknown>) | undefined } = {
        os: 'android',
        override: undefined,
    }
    return { fs, chunk, state }
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
    invoke: (command: string, args?: unknown) => (h.state.override ? h.state.override(command, args) : h.chunk.invoke(command, args)),
}))

import {
    bytesToBase64,
    isAndroidTransport,
    RangeReadChangedError,
    READ_PIECE_BYTES,
    readRanged,
    WRITE_CHUNK_BYTES,
    writeChunked,
} from 'src/ts/storage/tauriByteTransport'

const KEY = 'blocks/gen/c/6162'
const OLD = Uint8Array.from([9, 9, 9])

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
    h.chunk.reset()
    h.state.os = 'android'
    h.state.override = undefined
})

describe('isAndroidTransport', () => {
    test.each([['android', true], ['windows', false], ['macos', false], ['linux', false], ['ios', false]] as const)(
        'answers for the %s operating system',
        (os, expected) => {
            h.state.os = os
            expect(isAndroidTransport()).toBe(expected)
        },
    )

    test('answers false, and does not throw, where the operating-system plugin cannot answer', () => {
        h.state.os = 'throws'
        expect(isAndroidTransport()).toBe(false)
    })

    test('looks at the operating system on every call', () => {
        h.state.os = 'windows'
        expect(isAndroidTransport()).toBe(false)
        h.state.os = 'android'
        expect(isAndroidTransport()).toBe(true)
    })
})

describe('bytesToBase64', () => {
    test.each([0, 1, 2, 3, 4, 0x1fff, 0x2000, 0x2001, 0x4000, 0x4005, 3 * 0x2000 + 2])('encodes %i bytes as the reference encoding does', (length) => {
        const bytes = patterned(length)

        expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    })

    test('encodes only the bytes of a view, not the buffer behind it', () => {
        const whole = patterned(100)
        const view = whole.subarray(10, 37)

        expect(bytesToBase64(view)).toBe(Buffer.from(whole.slice(10, 37)).toString('base64'))
    })
})

describe('writeChunked', () => {
    test.each([0, 1, 3, 4, 5, 7, 8, 9, 23])('puts exactly the input at the key for %i bytes in chunks of 4', async (length) => {
        const input = patterned(length)

        await writeChunked(KEY, input, true, 4)

        expect(stored(KEY)).toEqual(Array.from(input))
        expect(leftoverTemps()).toEqual([])
        expect(h.chunk.callsOf('write_chunk')).toHaveLength(Math.max(1, Math.ceil(length / 4)))
        expect(h.chunk.callsOf('abort_chunked')).toEqual([])
    })

    test('puts exactly the bytes of an input that is a view with a non-zero offset', async () => {
        const whole = patterned(40)
        const view = whole.subarray(5, 30)

        await writeChunked(KEY, view, false, 8)

        expect(stored(KEY)).toEqual(Array.from(whole.slice(5, 30)))
    })

    test('splits at the chunk size: offsets run on from zero, only the last chunk says so, and none is larger than a chunk', async () => {
        const input = patterned(WRITE_CHUNK_BYTES * 2 + 12345)

        await writeChunked(KEY, input, true)

        const chunks = h.chunk.callsOf('write_chunk')
        expect(chunks.map((call) => call.args.offset)).toEqual([0, WRITE_CHUNK_BYTES, WRITE_CHUNK_BYTES * 2])
        expect(chunks.map((call) => call.args.last)).toEqual([false, false, true])
        expect(h.chunk.chunkSizes).toEqual([WRITE_CHUNK_BYTES, WRITE_CHUNK_BYTES, 12345])
        expect(stored(KEY)).toEqual(Array.from(input))
    })

    test('an input of exactly one chunk is a single call, and one byte more is two', async () => {
        await writeChunked(KEY, patterned(WRITE_CHUNK_BYTES), true)
        expect(h.chunk.callsOf('write_chunk')).toHaveLength(1)

        h.chunk.reset()
        await writeChunked(KEY, patterned(WRITE_CHUNK_BYTES + 1), true)
        expect(h.chunk.callsOf('write_chunk')).toHaveLength(2)
    })

    test('sends the key as given, one 16-digit lowercase hex id on every chunk, and the durable flag', async () => {
        await writeChunked('assets/abc', patterned(10), false, 4)

        const chunks = h.chunk.callsOf('write_chunk')
        expect(chunks.every((call) => call.args.key === 'assets/abc')).toBe(true)
        expect(chunks.every((call) => call.args.durable === false)).toBe(true)
        const ids = new Set(chunks.map((call) => call.args.id))
        expect(ids.size).toBe(1)
        expect(String(Array.from(ids)[0])).toMatch(/^[0-9a-f]{16}$/)
    })

    test('two writes use two ids, so their temp files are separate', async () => {
        await writeChunked(KEY, patterned(5), true, 4)
        await writeChunked(KEY, patterned(5), true, 4)

        const ids = h.chunk.callsOf('write_chunk').map((call) => call.args.id)
        expect(new Set(ids).size).toBe(2)
    })

    test('a rejected chunk stops every later chunk', async () => {
        h.chunk.failWrites(({ offset }) => (offset === 8 ? 'boom' : undefined))

        await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toBe('boom')

        expect(h.chunk.callsOf('write_chunk').map((call) => call.args.offset)).toEqual([0, 4, 8])
    })

    describe('a failure', () => {
        beforeEach(() => {
            h.fs.plant(KEY, OLD)
        })

        test('at chunk 0 rejects with the original error, keeps the old bytes, leaves no temp and sends no abort', async () => {
            h.chunk.failWrites(({ offset }) => (offset === 0 ? 'disk full (os error 28)' : undefined))

            await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toBe('disk full (os error 28)')

            expect(stored(KEY)).toEqual(Array.from(OLD))
            expect(leftoverTemps()).toEqual([])
            expect(h.chunk.callsOf('abort_chunked')).toEqual([])
        })

        test('at a later chunk rejects with the original error, aborts the same write, and keeps the old bytes', async () => {
            h.chunk.failWrites(({ offset }) => (offset === 12 ? 'disk full (os error 28)' : undefined))

            await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toBe('disk full (os error 28)')

            const aborts = h.chunk.callsOf('abort_chunked')
            expect(aborts).toHaveLength(1)
            expect(aborts[0].args.key).toBe(KEY)
            expect(aborts[0].args.id).toBe(h.chunk.callsOf('write_chunk')[0].args.id)
            expect(stored(KEY)).toEqual(Array.from(OLD))
            expect(leftoverTemps()).toEqual([])
        })

        test('at the last chunk (the flush or the rename) rejects with the original error and keeps the old bytes', async () => {
            h.chunk.failWrites(({ last }) => (last ? 'failed to rename (os error 5)' : undefined))

            await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toBe('failed to rename (os error 5)')

            expect(stored(KEY)).toEqual(Array.from(OLD))
            expect(leftoverTemps()).toEqual([])
        })

        test('is reported as the original error even when the abort fails too', async () => {
            h.chunk.failWrites(({ offset }) => (offset === 4 ? 'first error' : undefined))
            h.chunk.failAborts('abort error')

            await expect(writeChunked(KEY, patterned(20), true, 4)).rejects.toBe('first error')

            expect(stored(KEY)).toEqual(Array.from(OLD))
        })

        test('on a key that does not exist yet leaves the key absent', async () => {
            h.chunk.failWrites(({ offset }) => (offset === 8 ? 'boom' : undefined))

            await expect(writeChunked('blocks/new/x', patterned(20), true, 4)).rejects.toBe('boom')

            expect(stored('blocks/new/x')).toBeUndefined()
            expect(leftoverTemps()).toEqual([])
        })
    })
})

describe('readRanged', () => {
    function plant(length: number): Uint8Array {
        const bytes = patterned(length)
        h.fs.plant('assets/x', bytes)
        return bytes
    }

    test.each([0, 1, 9, 10, 11, 19, 20, 21, 25, 30, 31])('returns exactly the %i bytes of the file in pieces of 10', async (length) => {
        const bytes = plant(length)

        const read = await readRanged('assets/x', 10)

        expect(Array.from(read)).toEqual(Array.from(bytes))
        expect(h.chunk.callsOf('read_range')).toHaveLength(Math.max(1, Math.ceil(length / 10)))
    })

    test('a file of the piece size costs one call and one byte more costs two', async () => {
        plant(READ_PIECE_BYTES)
        await readRanged('assets/x')
        expect(h.chunk.callsOf('read_range')).toHaveLength(1)

        h.chunk.reset()
        const bytes = plant(READ_PIECE_BYTES + 1)
        const read = await readRanged('assets/x')
        expect(h.chunk.callsOf('read_range')).toHaveLength(2)
        expect(read.length).toBe(bytes.length)
        expect(read[read.length - 1]).toBe(bytes[bytes.length - 1])
    })

    test('asks for the whole file from offset 0 first and for the rest after it', async () => {
        plant(25)

        await readRanged('assets/x', 10)

        expect(h.chunk.callsOf('read_range').map((call) => [call.args.key, call.args.offset, call.args.len])).toEqual([
            ['assets/x', 0, 10],
            ['assets/x', 10, 10],
            ['assets/x', 20, 5],
        ])
    })

    test('a missing file rejects with the command error after one call', async () => {
        await expect(readRanged('assets/gone', 10)).rejects.toEqual(expect.stringMatching(/\(os error 2\)$/))

        expect(h.chunk.callsOf('read_range')).toHaveLength(1)
    })

    test('a piece shorter than asked is not padded: the read goes on from the bytes it got', async () => {
        const bytes = plant(25)
        h.chunk.hooks.limit = ({ index }) => (index >= 1 ? 3 : undefined)

        const read = await readRanged('assets/x', 10)

        expect(Array.from(read)).toEqual(Array.from(bytes))
    })

    test('a piece that returns nothing before the end restarts the read twice and then rejects', async () => {
        plant(25)
        h.chunk.hooks.limit = ({ index }) => (index % 2 === 1 ? 0 : undefined)

        const outcome = readRanged('assets/x', 10)

        await expect(outcome).rejects.toBeInstanceOf(RangeReadChangedError)
        expect(h.chunk.callsOf('read_range')).toHaveLength(6)
    })

    test('a first piece that returns nothing of a non-empty file rejects instead of returning zeros', async () => {
        plant(25)
        h.chunk.hooks.limit = () => 0

        await expect(readRanged('assets/x', 10)).rejects.toBeInstanceOf(RangeReadChangedError)
    })

    test('a file replaced between pieces restarts the read, and the result comes from one file only', async () => {
        plant(25)
        const replacement = Uint8Array.from({ length: 25 }, () => 200)
        h.chunk.hooks.before = ({ index }) => {
            if (index === 1) {
                h.fs.files.set('assets/x', replacement.slice())
            }
        }

        const read = await readRanged('assets/x', 10)

        expect(Array.from(read)).toEqual(Array.from(replacement))
        expect(h.chunk.callsOf('read_range')).toHaveLength(2 + 3)
    })

    test('a file whose size changes between pieces restarts the read', async () => {
        plant(25)
        const grown = patterned(40)
        h.chunk.hooks.before = ({ index }) => {
            if (index === 1) {
                h.fs.files.set('assets/x', grown.slice())
            }
        }

        const read = await readRanged('assets/x', 10)

        expect(Array.from(read)).toEqual(Array.from(grown))
    })

    test('a file that keeps changing rejects after the first read and two restarts', async () => {
        plant(25)
        h.chunk.hooks.before = ({ index }) => {
            if (index % 2 === 1) {
                h.fs.files.set('assets/x', patterned(25))
            }
        }

        await expect(readRanged('assets/x', 10)).rejects.toBeInstanceOf(RangeReadChangedError)

        expect(h.chunk.callsOf('read_range')).toHaveLength(6)
    })

    test('a file deleted between pieces is not reported as absent by that read: it restarts, and only the restart finds it missing', async () => {
        plant(25)
        h.chunk.hooks.before = ({ index }) => {
            if (index === 1) {
                h.fs.files.delete('assets/x')
            }
        }

        await expect(readRanged('assets/x', 10)).rejects.toEqual(expect.stringMatching(/\(os error 2\)$/))

        expect(h.chunk.callsOf('read_range')).toHaveLength(3)
    })

    test('an answer longer than the file rejects without restarting', async () => {
        h.state.override = async () => {
            const out = new Uint8Array(20 + 56)
            new DataView(out.buffer, 20).setBigUint64(0, 10n, true)
            return out.buffer
        }

        await expect(readRanged('assets/x', 10)).rejects.toThrow(/10-byte file/)
    })

    test('an answer shorter than the trailer rejects', async () => {
        h.state.override = async () => new Uint8Array(10).buffer

        await expect(readRanged('assets/x', 10)).rejects.toThrow(/trailer/)
    })

    test('accepts a response delivered as a number array', async () => {
        h.state.override = async () => {
            const out = new Uint8Array(3 + 56)
            out.set([7, 8, 9], 0)
            new DataView(out.buffer, 3).setBigUint64(0, 3n, true)
            return Array.from(out)
        }

        expect(Array.from(await readRanged('assets/x', 10))).toEqual([7, 8, 9])
    })
})
