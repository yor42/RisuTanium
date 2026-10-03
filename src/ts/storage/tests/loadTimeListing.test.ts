/**
 * `recordLoadTimeListing()` runs on every boot before plugins start. A boot
 * must never stall or fail because a storage backend cannot list its
 * contents, so the function resolves whatever the backend does; a failed
 * listing is recorded as "no listing", never as an empty one, which is the
 * clean-up suite's concern.
 *
 * Only platform boundaries are faked: the key listing behind the byte store
 * (assets on the web and on a Node server) and of `forageStorage` (units on a
 * Node server), the OPFS root directory (units on the web), and the plugin-fs
 * directory reads (assets and units on Tauri; the assets go through the real
 * desktop store). Nothing here proves native backend behaviour.
 *
 * Tests titled `guard` pin behaviour that holds before and after the assets
 * moved behind the byte store; `reproducer` tests fail against the listing that
 * read the asset directory itself; `new behaviour` tests assert what only the
 * store-based listing does.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'

//#region platform boundaries

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

interface FakeDirEntry {
    name: string
    isFile?: boolean
    isDirectory?: boolean
    isSymlink?: boolean
}

/** A plain file, as the plugin reports one. */
function file(name: string): FakeDirEntry {
    return { name, isFile: true, isDirectory: false, isSymlink: false }
}

/** A directory, as the plugin reports one. */
function directory(name: string): FakeDirEntry {
    return { name, isFile: false, isDirectory: true, isSymlink: false }
}

const boundary = vi.hoisted(() => ({
    forageKeys: vi.fn(async (): Promise<string[]> => []),
    readDir: vi.fn(async (_path: string, _options?: unknown): Promise<Array<{ name: string, isFile?: boolean, isDirectory?: boolean, isSymlink?: boolean }>> => []),
    exists: vi.fn(async (_path: string, _options?: unknown): Promise<boolean> => true),
    getDirectory: vi.fn(async () => ({
        entries: () => (async function* () {
            yield ['coldstorage_unit-1.json', {}] as [string, object]
        })(),
    })),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformState.isTauri },
    get isNodeServer() { return platformState.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: boundary.readDir,
    exists: boundary.exists,
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async () => { }),
    remove: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: boundary.forageKeys,
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        removeItem: vi.fn(async () => { }),
        Init: vi.fn(async () => { }),
    },
    getBasename: (p: string) => p.split('/').pop(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

// The page's store is the desktop store over the faked plugin on Tauri and a
// store over the faked key listing elsewhere; the selection itself, and the
// application graph it reaches, stay out of this suite.
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { createForageBackedStore, createSwitchedStore } = await import('src/ts/storage/tests/forageBackedStore')
    const { createTauriFilesStore } = await import('src/ts/storage/store/tauriFilesStore')
    const webStore = createForageBackedStore({
        getItem: async () => null,
        setItem: async () => { },
        keys: () => boundary.forageKeys(),
        removeItem: async () => { },
    })
    const tauriStore = createTauriFilesStore({ platform: 'posix' })
    const store = createSwitchedStore(() => platformState.isTauri ? tauriStore : webStore)
    return { getAppStore: async () => store } as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock('@tauri-apps/api/path', () => ({ appDataDir: vi.fn(async () => '/appdata'), join: vi.fn(async (...p: string[]) => p.join('/')) }))
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p) }))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    alertStore: writable({ type: 'none', msg: '' }),
    frozenSaveKeysStore: writable([]),
    savingStoppedReason: writable(''),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    alertToast: vi.fn(),
    alertWait: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

//#endregion

import { getLoadTimeListing, recordLoadTimeListing, resetLoadTimeListingForTests } from '../loadTimeListing'

type Backend = 'web' | 'node' | 'tauri'

const BACKENDS: Backend[] = ['web', 'node', 'tauri']

function useBackend(backend: Backend) {
    platformState.isTauri = backend === 'tauri'
    platformState.isNodeServer = backend === 'node'
}

beforeEach(() => {
    resetLoadTimeListingForTests()
    platformState.isTauri = false
    platformState.isNodeServer = false
    boundary.forageKeys.mockReset().mockResolvedValue(['assets/a.png', 'coldstorage/unit-1'])
    boundary.readDir.mockReset().mockImplementation(async (path: string) =>
        path.includes('coldstorage') ? [file('unit-1.json')] : [file('a.png')],
    )
    boundary.exists.mockReset().mockResolvedValue(true)
    boundary.getDirectory.mockReset().mockImplementation(async () => ({
        entries: () => (async function* () {
            yield ['coldstorage_unit-1.json', {}] as [string, object]
        })(),
    }))
    Object.defineProperty(navigator, 'storage', {
        value: { getDirectory: boundary.getDirectory },
        configurable: true,
    })
})

/** Makes the read of the assets listing throw on `backend`, leaving the units listing healthy. */
function breakAssetsListing(backend: Backend) {
    const failure = new Error('asset listing failed')
    if (backend === 'tauri') {
        boundary.readDir.mockImplementation(async (path: string) => {
            if (path.includes('assets')) {
                throw failure
            }
            return [file('unit-1.json')]
        })
    } else {
        boundary.forageKeys.mockRejectedValue(failure)
    }
}

/**
 * Makes the read of the units listing throw on `backend`, leaving the assets
 * listing healthy. A Node server has no separate units listing: one key
 * listing serves units and assets alike.
 */
function breakUnitsListing(backend: 'web' | 'tauri') {
    const failure = new Error('unit listing failed')
    if (backend === 'tauri') {
        boundary.readDir.mockImplementation(async (path: string) => {
            if (path.includes('coldstorage')) {
                throw failure
            }
            return [file('a.png')]
        })
    } else {
        boundary.getDirectory.mockRejectedValue(failure)
    }
}

describe('recordLoadTimeListing reads the storage backend', () => {
    test('web: lists the store keys for assets and the OPFS root for units', async () => {
        useBackend('web')

        await recordLoadTimeListing()

        expect(boundary.forageKeys).toHaveBeenCalled()
        expect(boundary.getDirectory).toHaveBeenCalled()
    })

    test('node server: lists the server keys', async () => {
        useBackend('node')

        await recordLoadTimeListing()

        expect(boundary.forageKeys).toHaveBeenCalled()
    })

    test('tauri: reads the assets directory and the coldstorage directory', async () => {
        useBackend('tauri')

        await recordLoadTimeListing()

        const paths = boundary.readDir.mock.calls.map((call) => String(call[0]))
        expect(paths.some((path) => path.includes('assets'))).toBe(true)
        expect(paths.some((path) => path.includes('coldstorage'))).toBe(true)
    })
})

describe('recordLoadTimeListing never rejects', () => {
    for (const backend of BACKENDS) {
        test(`guard: ${backend}: resolves when every listing call throws`, async () => {
            useBackend(backend)
            const failure = new Error('storage unavailable')
            boundary.forageKeys.mockRejectedValue(failure)
            boundary.readDir.mockRejectedValue(failure)
            boundary.getDirectory.mockRejectedValue(failure)

            await expect(recordLoadTimeListing()).resolves.toBeUndefined()
        })

        test(`guard: ${backend}: resolves when only the assets listing throws`, async () => {
            useBackend(backend)
            breakAssetsListing(backend)

            await expect(recordLoadTimeListing()).resolves.toBeUndefined()
        })

    }

    for (const backend of ['web', 'tauri'] as const) {
        test(`guard: ${backend}: resolves when only the units listing throws`, async () => {
            useBackend(backend)
            breakUnitsListing(backend)

            await expect(recordLoadTimeListing()).resolves.toBeUndefined()
        })
    }

    test('guard: web: resolves when the browser exposes no storage directory at all', async () => {
        useBackend('web')
        Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })

        await expect(recordLoadTimeListing()).resolves.toBeUndefined()
    })
})

describe('the load-time listing of a Tauri profile whose units directory does not exist yet', () => {
    /** The units directory is created by the first unit write, so a fresh profile has none. */
    function withoutUnitsDirectory(message: string) {
        boundary.readDir.mockImplementation(async (path: string) => {
            if (path.includes('coldstorage')) {
                throw new Error(message)
            }
            return [file('a.png')]
        })
        boundary.exists.mockImplementation(async (path: string) => !path.includes('coldstorage'))
    }

    async function expectValidListingWithoutUnits(message: string) {
        useBackend('tauri')
        withoutUnitsDirectory(message)

        await recordLoadTimeListing()

        const listing = getLoadTimeListing()
        expect(listing).not.toBeNull()
        expect([...listing!.units]).toEqual([])
        expect([...listing!.assets]).toEqual(['assets/a.png'])
    }

    test('a missing units directory reported as os error 3 (as on Windows) is a valid listing with no units', async () => {
        await expectValidListingWithoutUnits('The system cannot find the path specified. (os error 3)')
    })

    test('guard: a missing units directory reported as os error 2 (as on Unix) is a valid listing with no units', async () => {
        await expectValidListingWithoutUnits('No such file or directory (os error 2)')
    })

    test('guard: a units directory that exists but cannot be read records no listing', async () => {
        useBackend('tauri')
        boundary.readDir.mockImplementation(async (path: string) => {
            if (path.includes('coldstorage')) {
                throw new Error('Access is denied. (os error 5)')
            }
            return [file('a.png')]
        })

        await recordLoadTimeListing()

        expect(getLoadTimeListing()).toBeNull()
    })

    test('guard: a read that fails with a "not found" code while the directory exists records no listing', async () => {
        useBackend('tauri')
        boundary.readDir.mockImplementation(async (path: string) => {
            if (path.includes('coldstorage')) {
                throw new Error('No such file or directory (os error 2)')
            }
            return [file('a.png')]
        })
        boundary.exists.mockResolvedValue(true)

        await recordLoadTimeListing()

        expect(getLoadTimeListing()).toBeNull()
    })
})

describe('the asset part of the load-time listing', () => {
    const TEMP = 'risu-write-0123456789abcdef.tmp'

    test('reproducer: Tauri lists no atomic-write temp file of assets/, so the clean-up never takes one for an asset', async () => {
        useBackend('tauri')
        boundary.readDir.mockImplementation(async (path: string) =>
            path.includes('coldstorage') ? [file('unit-1.json')] : [file('a.png'), file(TEMP)],
        )

        await recordLoadTimeListing()

        expect([...(getLoadTimeListing()?.assets ?? [])]).toEqual(['assets/a.png'])
    })

    test('guard: Tauri lists only the files directly under assets/, never a nested key', async () => {
        useBackend('tauri')
        boundary.readDir.mockImplementation(async (path: string) => {
            if (path.includes('coldstorage')) {
                return [file('unit-1.json')]
            }
            return path.replace(/^\.\//, '') === 'assets' ? [file('a.png'), directory('d')] : [file('x.png')]
        })

        await recordLoadTimeListing()

        expect([...(getLoadTimeListing()?.assets ?? [])]).toEqual(['assets/a.png'])
    })

    test('guard: Tauri lists a symbolic link that resolves to a file', async () => {
        useBackend('tauri')
        boundary.readDir.mockImplementation(async (path: string) =>
            path.includes('coldstorage') ? [file('unit-1.json')] : [file('a.png'), { name: 'link.png', isFile: false, isDirectory: false, isSymlink: true }],
        )

        await recordLoadTimeListing()

        expect([...(getLoadTimeListing()?.assets ?? [])].sort()).toEqual(['assets/a.png', 'assets/link.png'])
    })

    for (const backend of ['web', 'node'] as const) {
        test(`guard: ${backend}: only the keys that start with assets/ are assets`, async () => {
            useBackend(backend)
            boundary.forageKeys.mockResolvedValue(['assets/a.png', 'assets/b.mp3', 'coldstorage/unit-1', 'database/database.bin', 'remotes/x.bin'])

            await recordLoadTimeListing()

            expect([...(getLoadTimeListing()?.assets ?? [])].sort()).toEqual(['assets/a.png', 'assets/b.mp3'])
        })
    }
})
