/**
 * The Tauri adapter (`src/ts/storage/store/tauriFilesStore.ts`) against the
 * strict in-memory file system in `tauriFsFake.ts`: the shared conformance
 * scenarios on both platform shapes, then what only this adapter does. These
 * are conformance and compatibility guards for code with no callers; a pass
 * here is not evidence about the native plugin or about Windows.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'
import { describeByteStoreConformance } from './byteStoreConformance'
import {
    OS_ERROR_ACCESS_DENIED,
    OS_ERROR_DISK_FULL,
    OS_ERROR_FILE_NOT_FOUND,
    OS_ERROR_NO_SUCH_FILE,
    OS_ERROR_PATH_NOT_FOUND,
    type FakeFsPlatform,
} from './tauriFsFake'

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))
const fakePaths = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriPathFake')).createFakeTauriPaths())

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)
vi.mock('@tauri-apps/api/path', () => fakePaths.pathModule)
vi.mock('@tauri-apps/api/core', () => fakePaths.coreModule)

import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'

const OLD = Uint8Array.from([1, 2, 3])
const NEW = Uint8Array.from([4, 5, 6, 7, 8, 9])
const PLATFORMS: FakeFsPlatform[] = ['posix', 'windows']

/** Characters and shapes that cannot be created on the desktop file system, on both platforms. */
const WRITE_ONLY_INVALID = ['a<b', 'a|b', 'a?b', 'a*b', 'a"b', 'a>b', 'a/b.', 'a/b ', `a/${'x'.repeat(256)}`]

for (const platform of PLATFORMS) {
    describeByteStoreConformance({
        name: `Tauri files (${platform})`,
        conditionalWrites: false,
        offersUrlFor: true,
        async create() {
            fakeFs.reset()
            fakeFs.setPlatform(platform)
            return createTauriFilesStore({ platform })
        },
        async plant(key, bytes) {
            fakeFs.plant(key, bytes)
        },
        async peek(key) {
            return fakeFs.files.get(key)?.slice() ?? null
        },
        backendCalls: () => fakeFs.calls.length,
        invalidEverywhere: ['', '/abs', 'a/', '/a', 'a//b', 'a/./b', 'a/../b', 'a\u0000b', 'C:x', ...(platform === 'windows' ? ['x/a:b'] : [])],
        invalidPrefixes: ['', '/abs', 'a//b', 'a/../b', 'a\u0000b', 'C:x'],
        writeOnlyInvalid: [...WRITE_ONLY_INVALID, ...(platform === 'posix' ? ['x/a:b'] : [])],
        oddKeys: ['assets/x.what?', 'assets/x.jpg '],
        failDeleteOf(key) {
            fakeFs.failRemoves(OS_ERROR_ACCESS_DENIED, (path) => path === key)
            return () => fakeFs.clearFaults()
        },
    })
}

describe('strict fake file system', () => {
    beforeEach(() => {
        fakeFs.reset()
    })

    test.each(PLATFORMS)('mkdir without recursive fails when the parent is missing and when the path exists (%s)', async (platform) => {
        fakeFs.setPlatform(platform)

        await expect(fakeFs.module.mkdir('./a/b')).rejects.toEqual(expect.stringMatching(/\(os error \d+\)$/))
        await fakeFs.module.mkdir('./a')
        await fakeFs.module.mkdir('./a/b')
        await expect(fakeFs.module.mkdir('./a/b')).rejects.toEqual(expect.stringMatching(/\(os error \d+\)$/))
    })

    test('a recursive mkdir creates every ancestor and succeeds on an existing directory', async () => {
        await fakeFs.module.mkdir('./a/b/c', { recursive: true })
        await fakeFs.module.mkdir('./a/b/c', { recursive: true })

        expect(await fakeFs.module.exists('./a')).toBe(true)
        expect(await fakeFs.module.exists('./a/b')).toBe(true)
        expect((await fakeFs.module.readDir('./a')).map((entry) => [entry.name, entry.isDirectory])).toEqual([['b', true]])
    })

    test('a file cannot be written into a directory that does not exist', async () => {
        await expect(fakeFs.module.writeFile('./a/b', Uint8Array.from([1]))).rejects.toEqual(expect.stringMatching(/\(os error [23]\)$/))
    })
})

describe('Tauri files store', () => {
    beforeEach(() => {
        fakeFs.reset()
        fakePaths.reset()
    })

    describe('symbolic links in a listing', () => {
        const LINKED = Uint8Array.from([7, 7])

        test('new behaviour: a link that resolves is listed as a key, beside the plain files', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('assets/a.png', OLD)
            fakeFs.plantSymlink('assets/linked.png', { kind: 'file', data: LINKED })

            expect((await store.list('assets/')).sort()).toEqual(['assets/a.png', 'assets/linked.png'])
            expect(Array.from((await store.read('assets/linked.png')).bytes ?? [])).toEqual(Array.from(LINKED))
        })

        test('guard: a link whose target is gone is not listed', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('assets/a.png', OLD)
            fakeFs.plantSymlink('assets/dangling.png', { kind: 'missing' })

            expect(await store.list('assets/')).toEqual(['assets/a.png'])
        })

        test('guard: a link to a directory is never entered, so nothing behind it is listed', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('assets/a.png', OLD)
            fakeFs.plantSymlink('assets/linkdir', { kind: 'directory' })

            const keys = await store.list('assets/')

            expect(keys).toContain('assets/a.png')
            expect(fakeFs.readDirLog).not.toContain('./assets/linkdir')
        })

        test('guard: a link named like an atomic-write temp is not listed', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plantSymlink('assets/risu-write-0123456789abcdef.tmp', { kind: 'file', data: LINKED })

            expect(await store.list('assets/')).toEqual([])
        })

        test('new behaviour: the rule holds for every prefix, a name-start prefix included', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plantSymlink('database/dbbackup-1.bin', { kind: 'file', data: LINKED })
            fakeFs.plantSymlink('database/dbbackup-2.bin', { kind: 'missing' })

            expect(await store.list('database/dbbackup-')).toEqual(['database/dbbackup-1.bin'])
        })
    })

    describe('urlFor', () => {
        const WINDOWS_URL = 'http://asset.localhost/C%3A%5CUsers%5Ctester%5CAppData%5CRoaming%5Ccom.risuai.app%5Cassets%5Cabc.png'
        const POSIX_URL = 'asset://localhost/%2Fhome%2Ftester%2F.local%2Fshare%2Fcom.risuai.app%2Fassets%2Fabc.png'

        test.each([['windows', WINDOWS_URL], ['posix', POSIX_URL]] as const)(
            'new behaviour: an asset key gives the asset-protocol URL of its path under AppData, the string the facade built from the same two calls (%s)',
            async (platform, expected) => {
                fakePaths.setPlatform(platform)
                const store = createTauriFilesStore({ platform })

                const url = await store.urlFor?.('assets/abc.png')

                expect(url).toBe(expected)
                expect(url).toBe(fakePaths.coreModule.convertFileSrc(await fakePaths.pathModule.join(await fakePaths.pathModule.appDataDir(), 'assets/abc.png')))
            },
        )

        test('the URL is made from the key alone: no file is read, listed or checked, and a missing file still has one', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })

            await store.urlFor?.('assets/never-written.png')

            expect(fakeFs.calls).toEqual([])
        })

        test('the data directory is asked for once and each key is joined once, however often it is asked for', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakePaths.reset()

            const first = await store.urlFor?.('assets/a.png')
            await store.urlFor?.('assets/b.png')
            const again = await store.urlFor?.('assets/a.png')

            expect(again).toBe(first)
            expect(fakePaths.calls.appDataDir).toBe(1)
            expect(fakePaths.calls.join).toBe(2)
        })

        test.each(['', '/abs/x.png', 'assets/../database/database.bin', '../x.png', 'assets//x.png', 'C:x.png'])(
            'a key outside the app data directory is refused before any path is built: %j',
            async (key) => {
                const store = createTauriFilesStore({ platform: 'posix' })
                fakePaths.reset()

                await expect(store.urlFor?.(key)).rejects.toBeInstanceOf(StoreInvalidKeyError)
                expect(fakePaths.calls.join).toBe(0)
            },
        )

        test('on Windows a colon and a backslash traversal are refused too', async () => {
            const store = createTauriFilesStore({ platform: 'windows' })

            await expect(store.urlFor?.('assets/a:b.png')).rejects.toBeInstanceOf(StoreInvalidKeyError)
            await expect(store.urlFor?.('assets\\..\\database\\database.bin')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        })
    })

    describe('listing', () => {
        test('never returns the temp files of an atomic write, or directories', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('database/database.bin', OLD)
            fakeFs.plant('database/dbbackup-1.bin', OLD)
            fakeFs.plant('database/risu-write-0123456789abcdef.tmp', OLD)
            fakeFs.directories.add('database/emptydir')

            expect((await store.list('database/')).sort()).toEqual(['database/database.bin', 'database/dbbackup-1.bin'])
            expect((await store.list('database/dbbackup-')).sort()).toEqual(['database/dbbackup-1.bin'])
        })

        test('returns keys without the ./ the plugin is given', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            await store.write('a/b', OLD, 'unconditional')
            await store.write('top', OLD, 'unconditional')

            expect(await store.list('a/')).toEqual(['a/b'])
            expect(await store.list('to')).toEqual(['top'])
        })

        test.each(PLATFORMS)('a directory that was never created lists as empty (%s)', async (platform) => {
            fakeFs.setPlatform(platform)
            const store = createTauriFilesStore({ platform })

            expect(await store.list('never/created/')).toEqual([])
            expect(await store.list('never/cre')).toEqual([])
        })

        test('a missing-directory error is not an empty listing when the directory exists', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.forceExists(true)
            await expect(store.list('never/created/')).rejects.toEqual(expect.stringContaining('os error 2'))
        })

        test('a listing error that is not a missing directory rejects even when the directory is missing', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.failReadDirs(OS_ERROR_ACCESS_DENIED)
            await expect(store.list('never/created/')).rejects.toEqual(expect.stringContaining('os error 5'))
        })
    })

    describe('writing', () => {
        test('a failed write leaves the old value readable and no temp file', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            await store.write('database/database.bin', OLD, 'unconditional')

            fakeFs.failWritesOf(() => true)
            await expect(store.write('database/database.bin', NEW, 'unconditional')).rejects.toEqual(expect.stringContaining('os error 112'))
            fakeFs.clearFaults()

            expect(Array.from((await store.read('database/database.bin')).bytes)).toEqual(Array.from(OLD))
            expect(fakeFs.listing('database')).toEqual(['database.bin'])
        })

        test('a failed rename leaves the old value readable and no temp file', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            await store.write('database/database.bin', OLD, 'unconditional')

            fakeFs.failRenames(OS_ERROR_DISK_FULL)
            await expect(store.write('database/database.bin', NEW, 'unconditional')).rejects.toEqual(expect.stringContaining('os error 112'))
            fakeFs.clearFaults()

            expect(Array.from((await store.read('database/database.bin')).bytes)).toEqual(Array.from(OLD))
            expect(fakeFs.listing('database')).toEqual(['database.bin'])
        })

        test('the first write under a missing nested directory works, and so does the second', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })

            await store.write('a/b/c', OLD, 'unconditional')
            await store.write('a/b/d', NEW, 'unconditional')
            await store.write('a/b/c', NEW, 'unconditional')

            expect(Array.from((await store.read('a/b/c')).bytes)).toEqual(Array.from(NEW))
            expect(Array.from((await store.read('a/b/d')).bytes)).toEqual(Array.from(NEW))
        })

        test('a write replaces the file through a temp file in its own directory, and never opens the key itself', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            await store.write('assets/x.png', OLD, 'unconditional')

            expect(fakeFs.writesTo('./assets/x.png')).toHaveLength(0)
            expect(fakeFs.renameLog.at(-1)?.to).toBe('./assets/x.png')
            expect(fakeFs.renameLog.at(-1)?.from).toMatch(/^\.\/assets\/risu-write-[0-9a-f]{16}\.tmp$/)
        })
    })

    describe('reading', () => {
        test.each([['posix', OS_ERROR_NO_SUCH_FILE], ['windows', OS_ERROR_PATH_NOT_FOUND]] as const)(
            'a missing file reads as null where the plugin reports it as (%s) %s',
            async (platform, expected) => {
                fakeFs.setPlatform(platform)
                const store = createTauriFilesStore({ platform })
                await expect(fakeFs.module.readFile('./gone/dir/file')).rejects.toContain(expected)

                expect((await store.read('gone/dir/file')).bytes).toBeNull()
                expect((await store.read('top-level-missing')).bytes).toBeNull()
            },
        )

        test('an error that is not a missing file rejects although the file does not exist', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.failReadFiles(OS_ERROR_ACCESS_DENIED)
            expect(await fakeFs.module.exists('./assets/x')).toBe(false)

            await expect(store.read('assets/x')).rejects.toEqual(expect.stringContaining('os error 5'))
        })

        test('a missing-file error rejects when the file exists', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('assets/x', OLD)
            fakeFs.failReadFiles(OS_ERROR_FILE_NOT_FOUND)

            await expect(store.read('assets/x')).rejects.toEqual(expect.stringContaining('os error 2'))
        })

        test('has is false for a directory and true for a file', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('assets/x', OLD)
            fakeFs.directories.add('empty')

            expect(await store.has('assets/x')).toBe(true)
            expect(await store.has('assets')).toBe(false)
            expect(await store.has('empty')).toBe(false)
        })
    })

    describe('deleting', () => {
        test.each(PLATFORMS)('a file that is already gone resolves (%s)', async (platform) => {
            fakeFs.setPlatform(platform)
            const store = createTauriFilesStore({ platform })

            await expect(store.delete('gone/dir/file', 'unconditional')).resolves.toBeUndefined()
            await expect(store.delete('top-level-missing', 'unconditional')).resolves.toBeUndefined()
        })

        test('an error that is not a missing file rejects although the file does not exist', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.failRemoves(OS_ERROR_ACCESS_DENIED)
            expect(await fakeFs.module.exists('./assets/x')).toBe(false)

            await expect(store.delete('assets/x', 'unconditional')).rejects.toEqual(expect.stringContaining('os error 5'))
        })

        test('a missing-file error rejects when the file exists', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('assets/x', OLD)
            fakeFs.failRemoves(OS_ERROR_FILE_NOT_FOUND)
            fakeFs.forceExists(true)

            await expect(store.delete('assets/x', 'unconditional')).rejects.toEqual(expect.stringContaining('os error 2'))
            fakeFs.clearFaults()
            expect(fakeFs.files.has('assets/x')).toBe(true)
        })
    })

    describe('paths given to the plugin', () => {
        test.each(['file:/home/u/Downloads/x', ' file:/home/u/Downloads/x', 'file:/x'])(
            'a key that parses as a URL stays inside AppData: %j',
            async (key) => {
                const store = createTauriFilesStore({ platform: 'posix' })

                expect((await store.read(key)).bytes).toBeNull()
                expect(await store.has(key)).toBe(false)
                await store.delete(key, 'unconditional')

                expect(fakeFs.calls.length).toBeGreaterThan(0)
                for (const call of fakeFs.calls) {
                    expect(call.path, `${call.op} ${call.path}`).toMatch(/^\.(\/|$)/)
                }
                expect(fakeFs.calls.map((call) => call.path)).toContain(`./${key}`)
            },
        )

        test('every path of a write and a listing is relative to AppData', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            await store.write('a/b/c', OLD, 'unconditional')
            await store.list('a/')
            await store.has('a/b/c')
            await store.delete('a/b/c', 'unconditional')

            for (const call of fakeFs.calls) {
                expect(call.path, `${call.op} ${call.path}`).toMatch(/^\.(\/|$)/)
            }
        })
    })

    describe('addressable keys per platform', () => {
        test('a colon and a backslash separator are refused on Windows only', async () => {
            const windows = createTauriFilesStore({ platform: 'windows' })
            const posix = createTauriFilesStore({ platform: 'posix' })
            fakeFs.setPlatform('windows')

            for (const key of ['x/a:b', 'a\\..\\b', '\\a', 'C:\\x', 'a:b']) {
                await expect(windows.read(key), key).rejects.toBeInstanceOf(StoreInvalidKeyError)
            }
            fakeFs.setPlatform('posix')
            expect((await posix.read('x/a:b')).bytes).toBeNull()
            expect((await posix.read('a\\..\\b')).bytes).toBeNull()
            await expect(posix.read('\\a')).rejects.toBeInstanceOf(StoreInvalidKeyError)
            await expect(posix.read('C:\\x')).rejects.toBeInstanceOf(StoreInvalidKeyError)
            await expect(posix.read('a:b')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        })

        test('a list prefix may end in the middle of a name, but its complete segments are checked', async () => {
            const store = createTauriFilesStore({ platform: 'posix' })
            fakeFs.plant('database/dbbackup-1.bin', OLD)

            expect(await store.list('database/dbbackup-')).toEqual(['database/dbbackup-1.bin'])
            await expect(store.list('data/../database/db')).rejects.toBeInstanceOf(StoreInvalidKeyError)
            await expect(store.list('database//db')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        })
    })
})
