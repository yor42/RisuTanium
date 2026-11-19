/**
 * The Tauri files store with the Android transport selected: reads go through
 * `read_range` and writes through `write_chunk`, against the in-memory stand-ins
 * in `tauriChunkFake.ts` and `tauriFsFake.ts`. The shared conformance scenarios
 * must hold exactly as they do on desktop. A pass here is not evidence about the
 * Rust commands or the native bridge.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { describeByteStoreConformance } from './byteStoreConformance'
import { OS_ERROR_ACCESS_DENIED } from './tauriFsFake'

const h = await vi.hoisted(async () => {
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const chunk = (await import('src/ts/storage/tests/tauriChunkFake')).createChunkedInvoke(fs)
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    return { fs, chunk, paths }
})

vi.mock('@tauri-apps/plugin-fs', () => h.fs.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.chunk.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'android' }))

import { CHUNK_MAX, READ_PIECE_BYTES, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'

const WRITE_ONLY_INVALID = ['a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'a>b', 'a/b.', 'a/b ', `a/${'x'.repeat(256)}`, 'x/a:b']

describeByteStoreConformance({
    name: 'Tauri files (android transport)',
    conditionalWrites: false,
    offersUrlFor: true,
    streamsBlobWrites: true,
    blobWritesTakeAssetKeys: true,
    async create() {
        h.fs.reset()
        h.chunk.reset()
        return createTauriFilesStore({ platform: 'posix' })
    },
    async plant(key, bytes) {
        h.fs.plant(key, bytes)
    },
    async peek(key) {
        return h.fs.files.get(key)?.slice() ?? null
    },
    // `app_data_dir_path` names the data directory and reads no file: a URL still comes from the key alone.
    backendCalls: () => h.fs.calls.length + h.chunk.calls.filter((call) => call.command !== 'app_data_dir_path').length,
    invalidEverywhere: ['', '/abs', 'a/', '/a', 'a//b', 'a/./b', 'a/../b', 'a\u0000b', 'C:x'],
    invalidPrefixes: ['', '/abs', 'a//b', 'a/../b', 'a\u0000b', 'C:x'],
    writeOnlyInvalid: WRITE_ONLY_INVALID,
    oddKeys: ['assets/x.what?', 'assets/x.jpg '],
    failDeleteOf(key) {
        h.fs.failRemoves(OS_ERROR_ACCESS_DENIED, (path) => path === key)
        return () => h.fs.clearFaults()
    },
})

describe('Tauri files store on Android', () => {
    beforeEach(() => {
        h.fs.reset()
        h.chunk.reset()
        h.paths.reset()
    })

    function patterned(length: number): Uint8Array {
        return Uint8Array.from({ length }, (_, i) => (i * 13 + 1) % 253)
    }

    test('a durable key is written as durable chunks of the bare key, and the plugin writes nothing', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write('blocks/gen/c/6162', patterned(WRITE_CHUNK_BYTES + 5), 'unconditional')

        const chunks = h.chunk.callsOf('write_chunk')
        expect(chunks).toHaveLength(2)
        expect(chunks.every((call) => call.args.key === 'blocks/gen/c/6162' && call.args.durable === true)).toBe(true)
        expect(h.fs.writeLog).toEqual([])
        expect(h.fs.renameLog).toEqual([])
        expect(h.fs.files.get('blocks/gen/c/6162')?.length).toBe(WRITE_CHUNK_BYTES + 5)
    })

    test('a durable key carries the chunk flush status into WriteResult.flushed; an answer of the old shape leaves it absent', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        const bytes = patterned(WRITE_CHUNK_BYTES + 5)

        const oldShape = await store.write('store2-commit', bytes, 'unconditional')
        expect('flushed' in oldShape).toBe(false)

        h.chunk.reportFlushes()
        expect(await store.write('store2-fence', bytes, 'unconditional')).toEqual({ version: null, flushed: true })

        h.chunk.failFlushes((call) => call.offset === 0)
        expect(await store.write('blocks/gen/c/6162', bytes, 'unconditional')).toEqual({ version: null, flushed: false })

        const plain = await store.write('store2-sweep', patterned(40), 'unconditional')
        expect('flushed' in plain).toBe(false)
    })

    test('a plain key is written as non-durable chunks of the bare key, without the plugin prefix', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write('database/database.bin', patterned(40), 'unconditional')

        const chunks = h.chunk.callsOf('write_chunk')
        expect(chunks).toHaveLength(1)
        expect(chunks[0].args.key).toBe('database/database.bin')
        expect(chunks[0].args.durable).toBe(false)
        expect(h.fs.writeLog).toEqual([])
        expect(Array.from(h.fs.files.get('database/database.bin') ?? [])).toEqual(Array.from(patterned(40)))
    })

    test('a rewrite replaces the file and leaves no temp file for the listing to hide or the sweep to find', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write('database/database.bin', patterned(10), 'unconditional')
        await store.write('database/database.bin', patterned(30), 'unconditional')

        expect(h.fs.listing('database')).toEqual(['database.bin'])
        expect(h.fs.files.get('database/database.bin')?.length).toBe(30)
    })

    test('a failed chunk rejects the write and keeps the old value readable', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        await store.write('database/database.bin', patterned(10), 'unconditional')
        h.chunk.failWrites(({ offset }) => (offset === 0 ? 'No space left on device (os error 28)' : undefined))

        await expect(store.write('database/database.bin', patterned(30), 'unconditional')).rejects.toBe('No space left on device (os error 28)')

        expect(Array.from((await store.read('database/database.bin')).bytes ?? [])).toEqual(Array.from(patterned(10)))
    })

    test('a read goes through the ranged command with the bare key and never through the plugin file read', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        h.fs.plant('assets/abc', patterned(77))

        const result = await store.read('assets/abc')

        expect(Array.from(result.bytes ?? [])).toEqual(Array.from(patterned(77)))
        expect(h.chunk.callsOf('read_range').map((call) => call.args.key)).toEqual(['assets/abc'])
        expect(h.fs.calls.filter((call) => call.op === 'readFile')).toEqual([])
    })

    test.each([READ_PIECE_BYTES, READ_PIECE_BYTES + 1, READ_PIECE_BYTES * 2, READ_PIECE_BYTES * 2 + 1])(
        'reads a file of %i bytes exactly',
        async (length) => {
            const store = createTauriFilesStore({ platform: 'posix' })
            const bytes = patterned(length)
            h.fs.plant('database/database.bin', bytes)

            const result = await store.read('database/database.bin')

            expect(result.bytes?.length).toBe(length)
            expect(Buffer.compare(Buffer.from(result.bytes ?? []), Buffer.from(bytes))).toBe(0)
        },
    )

    test('a missing file reads as null: the first launch finds no main file', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })

        expect((await store.read('database/database.bin')).bytes).toBeNull()
        expect((await store.read('gone/dir/file')).bytes).toBeNull()
    })

    test('a missing-file error from the command rejects when the file does exist', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        h.fs.plant('assets/x', patterned(3))
        h.chunk.hooks.before = () => {
            throw 'failed to open: No such file or directory (os error 2)'
        }

        await expect(store.read('assets/x')).rejects.toEqual(expect.stringContaining('os error 2'))
    })

    test('an error that is not a missing file rejects although the file does not exist', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        h.chunk.hooks.before = () => {
            throw 'failed to open: Permission denied (os error 13)'
        }

        await expect(store.read('assets/x')).rejects.toEqual(expect.stringContaining('os error 13'))
    })

    test('a file replaced while it is read never comes back as a mix of the old and the new', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        h.fs.plant('database/database.bin', patterned(READ_PIECE_BYTES + 100))
        const replacement = new Uint8Array(READ_PIECE_BYTES + 100).fill(5)
        h.chunk.hooks.before = ({ index }) => {
            if (index === 1) {
                h.fs.files.set('database/database.bin', replacement.slice())
            }
        }

        const result = await store.read('database/database.bin')

        expect(result.bytes?.every((byte) => byte === 5)).toBe(true)
    })
})

describe('Tauri files store writeBlob progress on Android', () => {
    const KEY = 'assets/p.mp4'

    beforeEach(() => {
        h.fs.reset()
        h.chunk.reset()
        h.paths.reset()
    })

    function patterned(length: number): Uint8Array {
        return Uint8Array.from({ length }, (_, i) => (i * 7 + 3) % 251)
    }

    // Regression reproducer: before the progress parameter existed, no report was made.
    test('reports the bytes handed over per slice, increasing, each before the write settles, and nothing after', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        const bytes = patterned(2 * CHUNK_MAX + 5)
        const total = bytes.length
        const reports: Array<[number, number, boolean]> = []
        let settled = false

        const write = store.writeBlob?.(KEY, new Blob([bytes as BlobPart]), 'unconditional', (written, size) => {
            reports.push([written, size, settled])
        })
        void write?.finally(() => { settled = true })
        await write
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(reports.map(([written, size]) => [written, size])).toEqual([[CHUNK_MAX, total], [2 * CHUNK_MAX, total], [total, total]])
        expect(reports.every(([, , wasSettled]) => !wasSettled)).toBe(true)
        expect(Buffer.compare(Buffer.from(h.fs.files.get(KEY) ?? []), Buffer.from(bytes))).toBe(0)
    })

    // Compatibility guard: passes before the change too, because the callback was never called then.
    test('a callback that throws on every call neither aborts nor changes the write', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        const bytes = patterned(2 * CHUNK_MAX + 5)

        await store.writeBlob?.(KEY, new Blob([bytes as BlobPart]), 'unconditional', () => {
            throw new Error('progress callback failure')
        })

        expect(Buffer.compare(Buffer.from(h.fs.files.get(KEY) ?? []), Buffer.from(bytes))).toBe(0)
        expect(h.chunk.callsOf('abort_chunked')).toEqual([])
    })

    // Regression reproducer: the report before the failing slice is the only one, and none follows the rejection.
    test('a slice read that fails rejects with that error, after the earlier report only', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        const failure = new Error('slice read failed')
        class FailingBlob extends Blob {
            slice(start?: number, end?: number, type?: string): Blob {
                const part = super.slice(start, end, type)
                if ((start ?? 0) >= CHUNK_MAX) {
                    Object.defineProperty(part, 'arrayBuffer', { value: () => Promise.reject(failure) })
                }
                return part
            }
        }
        const blob = new FailingBlob([patterned(3 * CHUNK_MAX) as BlobPart])
        const reports: Array<[number, number]> = []

        await expect(store.writeBlob?.(KEY, blob, 'unconditional', (written, size) => { reports.push([written, size]) })).rejects.toBe(failure)
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(reports).toEqual([[CHUNK_MAX, 3 * CHUNK_MAX]])
        expect(h.fs.files.has(KEY)).toBe(false)
    })

    // Regression reproducer: a report made before the writer accepts a slice would add one for the slice whose write rejects.
    test('a chunk write that rejects on a later slice reports only the slices the writer accepted, and nothing after', async () => {
        const store = createTauriFilesStore({ platform: 'posix' })
        const total = 3 * CHUNK_MAX
        h.chunk.failWrites(({ offset }) => (offset >= 2 * CHUNK_MAX ? 'No space left on device (os error 28)' : undefined))
        const reports: Array<[number, number]> = []

        await expect(store.writeBlob?.(KEY, new Blob([patterned(total) as BlobPart]), 'unconditional', (written, size) => { reports.push([written, size]) })).rejects.toThrow()
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(reports).toEqual([[CHUNK_MAX, total], [2 * CHUNK_MAX, total]])
        expect(h.fs.files.has(KEY)).toBe(false)
    })
})
