/**
 * The Tauri files store with the desktop transport selected (operating system
 * windows, macos or linux): reads go through `read_range` in pieces of
 * `CHUNK_MAX`, a write above `CHUNK_MAX` goes through the chunk commands
 * (durable or atomic by key), and anything smaller keeps its one call. The
 * stand-ins are `tauriDesktopFake.ts` (commands) and `tauriFsFake.ts` (plugin),
 * both with a per-call cap, so a call that carries more than `CHUNK_MAX` bytes
 * of file payload fails the test. A pass is not evidence about the Rust
 * commands, the plugin or the web view's memory behaviour.
 *
 * Tests titled "per-call bound" reproduce the whole-file calls the store made
 * before this transport: they fail against that code because a read or a write
 * of a large value is one call above the cap.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { describeByteStoreConformance } from './byteStoreConformance'
import { OS_ERROR_ACCESS_DENIED } from './tauriFsFake'

const CAP = 4 * 1024 * 1024

const h = await vi.hoisted(async () => {
    const CAP_BYTES = 4 * 1024 * 1024
    const fs = (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true })
    const fake = await import('src/ts/storage/tests/tauriDesktopFake')
    const desktop = fake.createDesktopInvoke(fs, { cap: CAP_BYTES })
    const bounded = fake.createBoundedFs(fs, { cap: CAP_BYTES })
    const paths = (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths()
    const state = { os: 'windows' }
    return { fs, desktop, bounded, paths, state }
})

vi.mock('@tauri-apps/plugin-fs', () => h.bounded.module)
vi.mock('@tauri-apps/api/path', () => h.paths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...h.paths.coreModule, invoke: h.desktop.invoke }))
vi.mock('@tauri-apps/plugin-os', () => ({ type: () => h.state.os }))

import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'

const WRITE_ONLY_INVALID = ['a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'a>b', 'a/b.', 'a/b ', `a/${'x'.repeat(256)}`]

function patterned(length: number, seed = 1): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 13 + seed) % 253)
}

function same(actual: Uint8Array | null | undefined, expected: Uint8Array): boolean {
    return actual !== null && actual !== undefined && Buffer.compare(Buffer.from(actual), Buffer.from(expected)) === 0
}

describe.each(['windows', 'linux', 'macos'])('with the operating system reported as %s', (os) => {
    beforeEach(() => {
        h.state.os = os
    })

    describeByteStoreConformance({
        name: `Tauri files (desktop transport, ${os})`,
        conditionalWrites: false,
        offersUrlFor: true,
        async create() {
            h.fs.reset()
            h.desktop.reset()
            h.bounded.reset()
            h.fs.setPlatform(os === 'windows' ? 'windows' : 'posix')
            return createTauriFilesStore({ platform: os === 'windows' ? 'windows' : 'posix' })
        },
        async plant(key, bytes) {
            h.fs.plant(key, bytes)
        },
        async peek(key) {
            return h.fs.files.get(key)?.slice() ?? null
        },
        backendCalls: () => h.fs.calls.length + h.desktop.commands.length,
        invalidEverywhere: ['', '/abs', 'a/', '/a', 'a//b', 'a/./b', 'a/../b', 'a\u0000b', 'C:x', ...(os === 'windows' ? ['x/a:b'] : [])],
        invalidPrefixes: ['', '/abs', 'a//b', 'a/../b', 'a\u0000b', 'C:x'],
        writeOnlyInvalid: [...WRITE_ONLY_INVALID, ...(os === 'windows' ? [] : ['x/a:b'])],
        oddKeys: ['assets/x.what?', 'assets/x.jpg '],
        failDeleteOf(key) {
            h.fs.failRemoves(OS_ERROR_ACCESS_DENIED, (path) => path === key)
            return () => h.fs.clearFaults()
        },
    })
})

describe('Tauri files store on desktop', () => {
    beforeEach(() => {
        h.state.os = 'windows'
        h.fs.reset()
        h.desktop.reset()
        h.bounded.reset()
        h.paths.reset()
        resetByteTransportForTests()
    })

    function store() {
        return createTauriFilesStore({ platform: 'windows' })
    }

    describe('reads', () => {
        test('a file of one piece is one read_range call with the bare key, and the plugin file read is not used', async () => {
            h.fs.plant('assets/abc', patterned(77))

            const result = await store().read('assets/abc')

            expect(Array.from(result.bytes ?? [])).toEqual(Array.from(patterned(77)))
            expect(h.desktop.chunk.callsOf('read_range').map((call) => [call.args.key, call.args.offset, call.args.len])).toEqual([['assets/abc', 0, CAP]])
            expect(h.fs.calls.filter((call) => call.op === 'readFile')).toEqual([])
        })

        test('per-call bound: a file above one piece is read in pieces of at most CHUNK_MAX and comes back exactly', async () => {
            const bytes = patterned(CAP * 2 + 5)
            h.fs.plant('database/database.bin', bytes)

            const result = await store().read('database/database.bin')

            expect(same(result.bytes, bytes)).toBe(true)
            expect(h.desktop.chunk.callsOf('read_range').map((call) => [call.args.offset, call.args.len])).toEqual([[0, CAP], [CAP, CAP], [CAP * 2, 5]])
            expect(Math.max(...h.desktop.payloads)).toBeLessThanOrEqual(CAP)
        })

        test.each([CAP, CAP + 1])('a file of %i bytes reads exactly', async (length) => {
            const bytes = patterned(length)
            h.fs.plant('assets/edge', bytes)

            const result = await store().read('assets/edge')

            expect(same(result.bytes, bytes)).toBe(true)
        })

        test('a missing file reads as null, and an error that is not a missing file rejects', async () => {
            expect((await store().read('database/database.bin')).bytes).toBeNull()

            h.desktop.chunk.hooks.before = () => {
                throw 'failed to open: Permission denied (os error 13)'
            }
            await expect(store().read('assets/x')).rejects.toEqual(expect.stringContaining('os error 13'))
        })

        test('a missing-file error from the command rejects when the file does exist', async () => {
            h.fs.plant('assets/x', patterned(3))
            h.desktop.chunk.hooks.before = () => {
                throw 'failed to open: No such file or directory (os error 2)'
            }

            await expect(store().read('assets/x')).rejects.toEqual(expect.stringContaining('os error 2'))
        })

        test('a file replaced while it is read never comes back as a mix of the old and the new', async () => {
            h.fs.plant('database/database.bin', patterned(CAP + 100))
            const replacement = new Uint8Array(CAP + 100).fill(5)
            h.desktop.chunk.hooks.before = ({ index }) => {
                if (index === 1) {
                    h.fs.files.set('database/database.bin', replacement.slice())
                }
            }

            const result = await store().read('database/database.bin')

            expect(result.bytes?.every((byte) => byte === 5)).toBe(true)
        })
    })

    describe('writes', () => {
        test('a durable key of at most CHUNK_MAX bytes is one write_durable call, and nothing is chunked', async () => {
            await store().write('blocks/gen/c/6162', patterned(CAP), 'unconditional')

            expect(h.desktop.commands).toEqual(['write_durable'])
            expect(h.fs.files.get('blocks/gen/c/6162')?.length).toBe(CAP)
        })

        test('per-call bound: a durable key above CHUNK_MAX goes as durable raw chunks of the bare key, and write_durable is not called', async () => {
            const bytes = patterned(CAP * 2 + 5)

            await store().write('blocks/gen/c/6162', bytes, 'unconditional')

            expect(h.desktop.commands).toEqual(['write_chunk_raw', 'write_chunk_raw', 'write_chunk_raw'])
            expect(h.desktop.rawCalls.every((call) => call.key === 'blocks/gen/c/6162' && call.durable)).toBe(true)
            expect(h.desktop.rawCalls.map((call) => call.size)).toEqual([CAP, CAP, 5])
            expect(h.fs.writeLog).toEqual([])
            expect(same(h.fs.files.get('blocks/gen/c/6162'), bytes)).toBe(true)
        })

        test('a plain key of at most CHUNK_MAX bytes is written through the plugin with the ./ path, and no command is invoked', async () => {
            await store().write('database/database.bin', patterned(CAP), 'unconditional')

            expect(h.desktop.commands).toEqual([])
            expect(h.fs.renameLog.at(-1)?.to).toBe('./database/database.bin')
            expect(h.fs.files.get('database/database.bin')?.length).toBe(CAP)
        })

        test('per-call bound: a plain key above CHUNK_MAX goes as non-durable raw chunks of the bare key, and the plugin writes nothing', async () => {
            const bytes = patterned(CAP + 1)

            await store().write('assets/big.bin', bytes, 'unconditional')

            expect(h.desktop.rawCalls.map((call) => [call.key, call.durable, call.size, call.last])).toEqual([
                ['assets/big.bin', false, CAP, false],
                ['assets/big.bin', false, 1, true],
            ])
            expect(h.fs.writeLog).toEqual([])
            expect(h.fs.renameLog).toEqual([])
            expect(same(h.fs.files.get('assets/big.bin'), bytes)).toBe(true)
        })

        test('a rewrite replaces the file and leaves no temp file for the listing to hide or the sweep to find', async () => {
            await store().write('assets/big.bin', patterned(CAP + 10), 'unconditional')
            await store().write('assets/big.bin', patterned(CAP + 30, 2), 'unconditional')

            expect(h.fs.listing('assets')).toEqual(['big.bin'])
            expect(h.fs.files.get('assets/big.bin')?.length).toBe(CAP + 30)
        })

        test('a failed chunk rejects the write, keeps the old value readable, and leaves no temp', async () => {
            await store().write('assets/big.bin', patterned(CAP + 10), 'unconditional')
            h.desktop.chunk.failWrites(({ offset }) => (offset === CAP ? 'No space left on device (os error 28)' : undefined))

            await expect(store().write('assets/big.bin', patterned(CAP * 2, 2), 'unconditional')).rejects.toThrow('No space left on device (os error 28)')

            expect(same((await store().read('assets/big.bin')).bytes, patterned(CAP + 10))).toBe(true)
            expect(h.fs.listing('assets')).toEqual(['big.bin'])
        })

        test('a key the store refuses is refused before any call, large or small', async () => {
            for (const length of [10, CAP + 1]) {
                await expect(store().write('assets/a:b.png', patterned(length), 'unconditional')).rejects.toMatchObject({ name: 'StoreInvalidKeyError' })
                await expect(store().write('assets/x.', patterned(length), 'unconditional')).rejects.toMatchObject({ name: 'StoreInvalidKeyError' })
            }

            expect(h.desktop.commands).toEqual([])
            expect(h.fs.writeLog).toEqual([])
        })

        test('after a not-raw refusal a large write goes as bounded base64 chunks and arrives whole', async () => {
            h.desktop.refuseRawBodies()
            const bytes = patterned(CAP + 100)

            await store().write('blocks/gen/c/6162', bytes, 'unconditional')

            expect(h.desktop.commands).toEqual(['write_chunk_raw', 'write_chunk', 'write_chunk'])
            expect(same(h.fs.files.get('blocks/gen/c/6162'), bytes)).toBe(true)
        })

        test('the reads and writes of an unknown platform keep the plugin calls', async () => {
            h.state.os = 'ios'
            h.bounded.reset()
            h.fs.plant('assets/x', patterned(5))

            await store().read('assets/x')
            await store().write('assets/y', patterned(5), 'unconditional')

            expect(h.fs.calls.filter((call) => call.op === 'readFile')).toHaveLength(1)
            expect(h.desktop.commands).toEqual([])
        })
    })
})
