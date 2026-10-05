/**
 * The durable Tauri write (`src/ts/storage/tauriDurableWrite.ts`), its routing
 * in the Tauri files store and the recursive boot sweep, against an invoke mock
 * and the in-memory file system in `tauriFsFake.ts`. The command's file steps
 * (write, flush, rename, directory flush) run in Rust and are tested by the
 * `durable_write` unit tests in `src-tauri/src/durable_write.rs`; a pass here
 * is not evidence about them or about the native IPC.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())
const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)
vi.mock('@tauri-apps/api/path', () => fakePaths.pathModule)
vi.mock('@tauri-apps/api/core', () => ({ ...fakePaths.coreModule, invoke: invokeMock }))

import { sweepAtomicWriteTemps } from 'src/ts/storage/tauriAtomicWrite'
import { DURABLE_KEY_HEADER, DURABLE_WRITE_COMMAND, isDurableKey, writeFileDurable } from 'src/ts/storage/tauriDurableWrite'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'

const BYTES = Uint8Array.from([1, 2, 3, 4])
const TEMP = 'risu-write-0123456789abcdef.tmp'

beforeEach(() => {
    fakeFs.reset()
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
})

describe('writeFileDurable', () => {
    test('sends the key in a percent-encoded header and the bytes as the raw body, not as a number array', async () => {
        const key = 'blocks/20261005-x/c/6162'

        await writeFileDurable(key, BYTES)

        expect(invokeMock).toHaveBeenCalledTimes(1)
        const [command, body, options] = invokeMock.mock.calls[0]
        expect(command).toBe(DURABLE_WRITE_COMMAND)
        expect(body).toBe(BYTES)
        expect(ArrayBuffer.isView(body)).toBe(true)
        expect(options).toEqual({ headers: { [DURABLE_KEY_HEADER]: 'blocks%2F20261005-x%2Fc%2F6162' } })
    })

    test('encodes a key outside ASCII so the header stays ASCII and decodes back to the key', async () => {
        const key = 'blocks/g/\u{d55c}\u{ae00} +x'

        await writeFileDurable(key, BYTES)

        const header: string = invokeMock.mock.calls[0][2].headers[DURABLE_KEY_HEADER]
        expect(/^[\x20-\x7e]*$/.test(header)).toBe(true)
        expect(decodeURIComponent(header)).toBe(key)
    })

    test('resolves only after the command resolves', async () => {
        let finish: () => void = () => undefined
        invokeMock.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
        let settled = false

        const write = writeFileDurable('blocks/head', BYTES).then(() => { settled = true })
        await Promise.resolve()
        await Promise.resolve()
        expect(settled).toBe(false)

        finish()
        await write
        expect(settled).toBe(true)
    })

    test('rejects with the command error', async () => {
        invokeMock.mockRejectedValue('failed to rename (os error 5)')

        await expect(writeFileDurable('blocks/head', BYTES)).rejects.toBe('failed to rename (os error 5)')
    })
})

/** Every shape the key rules refuse, on both sides: the Rust test holds the same list. */
const REFUSED_KEYS = [
    '', '/abs', 'a/', '/a', 'a//b', 'a/./b', 'a/../b', '../x', '..', '.hidden', 'a/.hidden',
    'C:x', 'c:/x', 'a\\b', 'a\u0000b', 'a\nb', 'x/a:b', 'a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'a>b',
    'a/b.', 'a/b ', `blocks/${TEMP}`, `a/${'x'.repeat(256)}`,
]

describe('key rules', () => {
    test.each(REFUSED_KEYS)('writeFileDurable refuses %j without calling the command', async (key) => {
        await expect(writeFileDurable(key, BYTES)).rejects.toBeInstanceOf(StoreInvalidKeyError)

        expect(invokeMock).not.toHaveBeenCalled()
    })

    test.each(REFUSED_KEYS)('the store refuses %j before any backend call', async (key) => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await expect(store.write(key, BYTES, 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)

        expect(invokeMock).not.toHaveBeenCalled()
        expect(fakeFs.calls).toEqual([])
    })
})

describe('routing in the Tauri files store', () => {
    const DURABLE = ['blocks/head', 'blocks/gen/root', 'blocks/gen/c/6162', 'database/dbbackup-17909517188.bin', 'coldstorage/unit-1', 'database/database.pre-blocks.bin', 'database/database.pre-blocks-2.bin']
    const PLAIN = [
        'database/database.bin', 'assets/abc123', 'remotes/x', 'database/dbbackup-x.bin',
        'database/dbbackup-1.bin.old', 'database/database.pre-blocks.txt', 'blocksx/y', 'coldstorage_unit.json', 'other/file',
    ]

    test.each(DURABLE)('%s goes to the durable command and not to the plain file write', async (key) => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write(key, BYTES, 'unconditional')

        expect(invokeMock).toHaveBeenCalledTimes(1)
        expect(invokeMock.mock.calls[0][2].headers[DURABLE_KEY_HEADER]).toBe(encodeURIComponent(key))
        expect(fakeFs.writeLog).toEqual([])
        expect(fakeFs.renameLog).toEqual([])
        expect(fakeFs.calls.filter((call) => call.op === 'mkdir')).toEqual([])
    })

    test.each(PLAIN)('%s keeps the plain atomic write', async (key) => {
        const store = createTauriFilesStore({ platform: 'posix' })

        await store.write(key, BYTES, 'unconditional')

        expect(invokeMock).not.toHaveBeenCalled()
        expect(Array.from(fakeFs.files.get(key) ?? [])).toEqual(Array.from(BYTES))
    })

    test('isDurableKey picks exactly the four kinds', () => {
        for (const key of DURABLE) {
            expect(isDurableKey(key)).toBe(true)
        }
        for (const key of PLAIN) {
            expect(isDurableKey(key)).toBe(false)
        }
    })

    test('a command failure rejects the store write', async () => {
        invokeMock.mockRejectedValue('boom')
        const store = createTauriFilesStore({ platform: 'posix' })

        await expect(store.write('blocks/head', BYTES, 'unconditional')).rejects.toBe('boom')
    })
})

describe('the recursive boot sweep', () => {
    test('removes a stale temp file under a nested blocks directory and leaves other files alone', async () => {
        fakeFs.plant(`blocks/gen1/c/${TEMP}`, Uint8Array.from([9]))
        fakeFs.plant('blocks/gen1/c/6162', Uint8Array.from([1]))
        fakeFs.plant(`blocks/gen1/${TEMP}`, Uint8Array.from([9]))
        fakeFs.plant('blocks/gen1/root', Uint8Array.from([2]))
        fakeFs.plant(`blocks/${TEMP}`, Uint8Array.from([9]))
        fakeFs.plant('blocks/head', Uint8Array.from([3]))
        fakeFs.plant('blocks/gen1/c/risu-write-nothex.tmp', Uint8Array.from([4]))

        await sweepAtomicWriteTemps('blocks', { recursive: true })

        expect(Array.from(fakeFs.files.keys()).sort()).toEqual([
            'blocks/gen1/c/6162',
            'blocks/gen1/c/risu-write-nothex.tmp',
            'blocks/gen1/root',
            'blocks/head',
        ])
    })

    test('without recursive it still sweeps one level only', async () => {
        fakeFs.plant(`blocks/gen1/c/${TEMP}`, Uint8Array.from([9]))
        fakeFs.plant(`blocks/${TEMP}`, Uint8Array.from([9]))

        await sweepAtomicWriteTemps('blocks')

        expect(Array.from(fakeFs.files.keys())).toEqual([`blocks/gen1/c/${TEMP}`])
    })

    test('does not enter a symbolic link and survives an unreadable directory', async () => {
        fakeFs.plant(`blocks/gen1/${TEMP}`, Uint8Array.from([9]))
        fakeFs.plantSymlink('blocks/link', { kind: 'directory' })
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        await expect(sweepAtomicWriteTemps('blocks', { recursive: true })).resolves.toBeUndefined()
        expect(fakeFs.files.has(`blocks/gen1/${TEMP}`)).toBe(false)
        expect(fakeFs.readDirLog).not.toContain('blocks/link')

        fakeFs.failReadDirs('Access is denied. (os error 5)')
        await expect(sweepAtomicWriteTemps('blocks', { recursive: true })).resolves.toBeUndefined()
        expect(errors).toHaveBeenCalled()
        errors.mockRestore()
    })
})
