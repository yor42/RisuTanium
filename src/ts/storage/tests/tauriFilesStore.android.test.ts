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

import { READ_PIECE_BYTES, WRITE_CHUNK_BYTES } from 'src/ts/storage/tauriByteTransport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'

const WRITE_ONLY_INVALID = ['a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'a>b', 'a/b.', 'a/b ', `a/${'x'.repeat(256)}`, 'x/a:b']

describeByteStoreConformance({
    name: 'Tauri files (android transport)',
    conditionalWrites: false,
    offersUrlFor: true,
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
