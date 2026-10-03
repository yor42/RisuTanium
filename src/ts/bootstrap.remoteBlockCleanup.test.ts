/**
 * The remote-block clean-up that `loadData()` starts at boot (`cleanChunks` in
 * `src/ts/bootstrap.ts`) and the boot's removal of leftover temp files from
 * `remotes/`, on Tauri and on the self-hosted Node server.
 *
 * The real `bootstrap.ts` and `risuSave.ts` run. The Tauri file system is the
 * strict in-memory `createFakeTauriFs` at the plugin boundary and the Node server
 * is the `FakeNodeServer` stand-in at the `fetch` boundary behind the real
 * `NodeStorage`; every test therefore runs unchanged whichever client class the
 * clean-up reads and writes through. Everything else `bootstrap.ts` imports is
 * mocked, as in the sibling bootstrap test files, and the asset sweeps are
 * stubbed because assets are not what this file is about. A pass here says
 * nothing about the native Tauri file API or the real server.
 *
 * What the clean-up does: only legacy `<chaId>.local.bin` blocks are ever
 * candidates; one whose character is not in the save gets a `.meta` file on first
 * sight and is removed once the `.meta` is more than seven days old (the desktop
 * clean-up removes the `.meta` with it); a content-addressed `<chaId>.<hash>.bin`
 * block is never touched.
 *
 * Tests titled `guard:` assert behaviour that must be preserved and pass before
 * and after the remote blocks moved behind the byte store. The others assert
 * behaviour only the store-based boot has.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'

const MAIN_KEY = 'database/database.bin'
const DAY_MS = 24 * 60 * 60 * 1000

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))

const world = vi.hoisted(() => ({
    storage: null as unknown,
    keyPair: null as CryptoKeyPair | null,
}))

const alertErrorMock = vi.hoisted(() => vi.fn())
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
            dropInstance: vi.fn(async () => { }),
        })),
        dropInstance: vi.fn(async () => { }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformState.isTauri },
    get isNodeServer() { return platformState.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    getKeypairStore: vi.fn(async () => {
        world.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return world.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbState.current),
    setDatabase: setDatabaseMock,
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
    LoadingStatusState: { text: '' },
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

// Only `alertError` is replaced, so the test can see what boot reports.
vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertError: alertErrorMock,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/gui/animation'), () => ({ updateAnimationSpeed: vi.fn() }) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({ startObserveDom: vi.fn() }) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({ updateGuisize: vi.fn() }) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({ updateLorebooks: vi.fn((v: unknown) => v) }) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: vi.fn() }) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/storage/assetIntegrity'), () => ({
    verifyAssetCacheEntry: vi.fn(async () => ({ status: 'ok' as const })),
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: vi.fn(async () => { }),
    sweepForageAssetKey: vi.fn(async () => { }),
    ASSET_SWEEP_BATCH_SIZE: 100,
}) as unknown as typeof import('src/ts/storage/assetSweep'))

vi.mock(import('src/ts/storage/mainFileRecord'), () => ({
    noteMainFileBytes: vi.fn(),
}) as unknown as typeof import('src/ts/storage/mainFileRecord'))

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
    resetLoadTimeListingForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({ startAvatarThumbSweep: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({ registerModelDynamic: vi.fn() }) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: vi.fn((p: string) => p) }))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => { }) })),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

vi.mock(import('src/ts/globalApi.svelte'), () => {
    const storage = () => world.storage as {
        getItem(key: string): Promise<Uint8Array | null>
        setItem(key: string, value: Uint8Array): Promise<void>
        keys(): Promise<string[]>
        removeItem(key: string): Promise<void>
    }
    return {
        forageStorage: {
            staleAccountProfile: false,
            opfsSwitchNotice: null,
            get realStorage() { return world.storage },
            Init: vi.fn(async () => { }),
            getItem: (key: string) => storage().getItem(key),
            setItem: (key: string, value: Uint8Array) => storage().setItem(key, value),
            keys: () => storage().keys(),
            removeItem: (key: string) => storage().removeItem(key),
        },
        saveDb: vi.fn(async () => { }),
        getDbBackups: vi.fn(async (): Promise<number[]> => []),
        buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
        getBasename: (p: string) => p.split('/').pop(),
        setUsingSw: vi.fn(),
        checkCharOrder: vi.fn(),
        getUncleanablesSync: vi.fn((): string[] => []),
        wasAssetWrittenThisPage: vi.fn(() => false),
        listAssetsWrittenThisPage: vi.fn((): string[] => []),
        AppendableBuffer: class {
            chunks: Uint8Array[] = []
            append(chunk: Uint8Array) { this.chunks.push(chunk) }
            get buffer() { return new Uint8Array() }
        },
        requiresFullEncoderReload: { state: false },
        fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
    } as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: true,
        reloading: false,
        run: vi.fn(async (input: { tree: Record<string, unknown> }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] })),
        release: vi.fn(async () => { }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

function baseDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt: 'fixture-main-prompt',
        loreBookToken: 8000,
        hotkeys: [],
        botPresets: [],
        coldstorage: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI: false,
        didFirstSetup: true,
        heightMode: 'auto',
        ...extra,
    }
}
dbState.baseline = () => baseDb()

/** A save whose only character is `chaId`: the one the clean-up must keep the legacy block of. */
function mainFileOf(chaId: string): Uint8Array {
    return encodeRisuSaveLegacy(baseDb({ characters: [{ chaId, name: chaId, type: 'character', chats: [] }] }))
}

function jsonBytes(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value))
}

function metaBytes(lastUsed: number): Uint8Array {
    return jsonBytes({ lastUsed })
}

/** A world to a place where one backend holds the profile: `put` stores one key, `read` returns it or `null`, `keys` lists them. */
interface Backend {
    put(key: string, bytes: Uint8Array): void
    read(key: string): Uint8Array | null
    keys(): string[]
    seedMain(bytes: Uint8Array): void
}

function tauriBackend(): Backend {
    return {
        put: (key, bytes) => fakeFs.plant(key, bytes),
        read: (key) => fakeFs.files.get(key) ?? null,
        keys: () => Array.from(fakeFs.files.keys()),
        seedMain: (bytes) => {
            fakeFs.plant(MAIN_KEY, bytes)
            fakeFs.directories.add('assets')
        },
    }
}

let server: FakeNodeServer

function nodeBackend(): Backend {
    return {
        put: (key, bytes) => { server.seed(key, bytes) },
        read: (key) => server.files.get(key)?.bytes ?? null,
        keys: () => Array.from(server.files.keys()),
        seedMain: (bytes) => { server.seed(MAIN_KEY, bytes) },
    }
}

async function freshLoadData() {
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    const { getStartupCleanup } = await import('src/ts/storage/startupCleanupState')
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return {
        /** Boots, then waits for the start-up clean-up that boot started. */
        async boot(): Promise<{ loaded: boolean }> {
            await loadData()
            await (getStartupCleanup() ?? Promise.resolve())
            return { loaded: get(loadedStore) }
        },
    }
}

/** A path as the plugin was given it, relative to AppData: the byte store passes `./`-prefixed paths. */
function relative(path: string): string {
    return path.replace(/^\.\//, '')
}

function remoteWrites(): { op: string, path: string }[] {
    return fakeFs.calls.filter((call) => call.op === 'writeFile' && relative(call.path).startsWith('remotes/'))
}

beforeEach(async () => {
    localStorage.clear()
    world.keyPair = null
    fakeFs.reset()
    fakeFs.setPlatform('posix')
    dbState.current = baseDb()
    alertErrorMock.mockReset()
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    world.storage = new NodeStorage()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

/** The clean-up's own cases, run unchanged against each backend. */
function describeCleanup(name: string, platform: 'tauri' | 'node', backend: () => Backend): void {
    describe(`remote-block clean-up on ${name}`, () => {
        let store: Backend

        beforeEach(() => {
            platformState.isTauri = platform === 'tauri'
            platformState.isNodeServer = platform === 'node'
            store = backend()
            store.seedMain(mainFileOf('kept'))
        })

        test('guard: a legacy block of a character that is not in the save gets a .meta stamped now and is kept on first sight', async () => {
            store.put('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
            const { boot } = await freshLoadData()

            const before = Date.now()
            await boot()

            expect(Array.from(store.read('remotes/gone.local.bin') ?? [])).toEqual([1, 2, 3])
            const meta = store.read('remotes/gone.local.bin.meta')
            expect(meta).not.toBeNull()
            const lastUsed = JSON.parse(new TextDecoder().decode(meta as Uint8Array)).lastUsed as number
            expect(lastUsed).toBeGreaterThanOrEqual(before)
            expect(lastUsed).toBeLessThanOrEqual(Date.now())
        })

        test('guard: an orphan whose .meta is more than seven days old is removed', async () => {
            store.put('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
            store.put('remotes/gone.local.bin.meta', metaBytes(Date.now() - 8 * DAY_MS))
            const { boot } = await freshLoadData()

            await boot()

            expect(store.read('remotes/gone.local.bin')).toBeNull()
        })

        test('guard: an orphan whose .meta is less than seven days old is kept with its .meta unchanged', async () => {
            const stamp = metaBytes(Date.now() - 1 * DAY_MS)
            store.put('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
            store.put('remotes/gone.local.bin.meta', stamp)
            const { boot } = await freshLoadData()

            await boot()

            expect(Array.from(store.read('remotes/gone.local.bin') ?? [])).toEqual([1, 2, 3])
            expect(Array.from(store.read('remotes/gone.local.bin.meta') ?? [])).toEqual(Array.from(stamp))
        })

        test('guard: a legacy block of a character that still exists is kept and gets no .meta, however old a .meta of it is', async () => {
            const stale = metaBytes(Date.now() - 30 * DAY_MS)
            store.put('remotes/kept.local.bin', new Uint8Array([4, 5]))
            store.put('remotes/kept.local.bin.meta', stale)
            const { boot } = await freshLoadData()

            await boot()

            expect(Array.from(store.read('remotes/kept.local.bin') ?? [])).toEqual([4, 5])
            expect(Array.from(store.read('remotes/kept.local.bin.meta') ?? [])).toEqual(Array.from(stale))
        })

        test('guard: a content-addressed block is never removed and never gets a .meta, whatever character it names', async () => {
            store.put('remotes/gone.0123456789abcdef.bin', new Uint8Array([6]))
            store.put('remotes/kept.fedcba9876543210.bin', new Uint8Array([7]))
            const { boot } = await freshLoadData()

            await boot()

            expect(Array.from(store.read('remotes/gone.0123456789abcdef.bin') ?? [])).toEqual([6])
            expect(Array.from(store.read('remotes/kept.fedcba9876543210.bin') ?? [])).toEqual([7])
            expect(store.keys().filter((key) => key.endsWith('.meta'))).toEqual([])
        })

        test('guard: a .meta that does not parse leaves the block and its .meta alone', async () => {
            store.put('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
            store.put('remotes/gone.local.bin.meta', new Uint8Array([123, 125, 0]))
            const { boot } = await freshLoadData()

            await boot()

            expect(Array.from(store.read('remotes/gone.local.bin') ?? [])).toEqual([1, 2, 3])
            expect(Array.from(store.read('remotes/gone.local.bin.meta') ?? [])).toEqual([123, 125, 0])
        })
    })
}

describeCleanup('Tauri', 'tauri', tauriBackend)
describeCleanup('the Node server', 'node', nodeBackend)

describe('remote-block clean-up on Tauri: failures', () => {
    beforeEach(() => {
        platformState.isTauri = true
        platformState.isNodeServer = false
        const store = tauriBackend()
        store.seedMain(mainFileOf('kept'))
    })

    test('guard: a block that cannot be removed is skipped without failing the boot or reporting an error', async () => {
        fakeFs.plant('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        fakeFs.plant('remotes/gone.local.bin.meta', metaBytes(Date.now() - 8 * DAY_MS))
        const fault = fakeFs.failRemoves('Access is denied. (os error 5)', (path) => path === 'remotes/gone.local.bin')
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(fault.fired).toBeGreaterThan(0)
        expect(loaded).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(fakeFs.files.has('remotes/gone.local.bin')).toBe(true)
    })

    test('guard: a .meta that cannot be read leaves the block and the .meta alone', async () => {
        const stamp = metaBytes(Date.now() - 8 * DAY_MS)
        fakeFs.plant('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        fakeFs.plant('remotes/gone.local.bin.meta', stamp)
        const fault = fakeFs.failReadFiles('Access is denied. (os error 5)', (path) => path.endsWith('.meta'))
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(fault.fired).toBeGreaterThan(0)
        expect(loaded).toBe(true)
        expect(Array.from(fakeFs.files.get('remotes/gone.local.bin') ?? [])).toEqual([1, 2, 3])
        expect(Array.from(fakeFs.files.get('remotes/gone.local.bin.meta') ?? [])).toEqual(Array.from(stamp))
    })

    test('guard: a block with no .meta gets one however the plugin words a read of a missing file', async () => {
        fakeFs.plant('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        fakeFs.failReadFiles('the file could not be opened', (path) => path.endsWith('.meta'))
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(fakeFs.files.has('remotes/gone.local.bin.meta')).toBe(true)
        expect(Array.from(fakeFs.files.get('remotes/gone.local.bin') ?? [])).toEqual([1, 2, 3])
    })

    test('guard: a directory listing that fails is reported and does not stop the boot', async () => {
        fakeFs.plant('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        const fault = fakeFs.failReadDirs('Access is denied. (os error 5)')
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(fault.fired).toBeGreaterThan(0)
        expect(loaded).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
    })

    test('guard: a temp file the boot could not remove is never taken for a block: it is left alone and gets no .meta', async () => {
        const stray = 'remotes/risu-write-0123456789abcdef.tmp'
        fakeFs.plant(stray, new Uint8Array([9, 9]))
        fakeFs.plant('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        fakeFs.failRemoves('Access is denied. (os error 5)', (path) => path === stray)
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(Array.from(fakeFs.files.get(stray) ?? [])).toEqual([9, 9])
        expect(Array.from(fakeFs.files.keys()).filter((key) => key.endsWith('.meta'))).toEqual(['remotes/gone.local.bin.meta'])
    })
})

describe('remote-block clean-up on the Node server: failures', () => {
    beforeEach(() => {
        platformState.isTauri = false
        platformState.isNodeServer = true
        nodeBackend().seedMain(mainFileOf('kept'))
    })

    test('guard: a removal the server refuses is reported and does not stop the boot', async () => {
        server.seed('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        server.seed('remotes/gone.local.bin.meta', metaBytes(Date.now() - 8 * DAY_MS))
        server.removeOverride = () => new Response('Internal Server Error', { status: 500 })
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(server.files.has('remotes/gone.local.bin')).toBe(true)
    })

    test('guard: a listing that fails rejects the clean-up before anything is removed, is reported, and does not stop the boot', async () => {
        server.seed('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        server.seed('remotes/gone.local.bin.meta', metaBytes(Date.now() - 8 * DAY_MS))
        server.beforeRequest = (path) => {
            if (path === '/api/list') {
                throw new Error('the network is down')
            }
        }
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(server.files.has('remotes/gone.local.bin')).toBe(true)
        expect(server.requestsTo('/api/remove')).toEqual([])
    })

    test('the remote blocks are listed by the store: a listing of them that fails rejects the clean-up and removes nothing', async () => {
        server.seed('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        server.seed('remotes/gone.local.bin.meta', metaBytes(Date.now() - 8 * DAY_MS))
        // The first listing of the clean-up is the asset sweep's; every later one is for the remote blocks.
        let listings = 0
        server.beforeRequest = (path) => {
            if (path === '/api/list' && ++listings > 1) {
                throw new Error('the network is down')
            }
        }
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(server.files.has('remotes/gone.local.bin')).toBe(true)
        expect(server.requestsTo('/api/remove')).toEqual([])
    })

    test('guard: a .meta the server cannot read leaves the block alone and writes nothing', async () => {
        server.seed('remotes/gone.local.bin', new Uint8Array([1, 2, 3]))
        server.seed('remotes/gone.local.bin.meta', metaBytes(Date.now() - 8 * DAY_MS))
        server.readFailures.add('remotes/gone.local.bin.meta')
        const { boot } = await freshLoadData()
        const writesBefore = server.requestsTo('/api/write').length

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(server.files.has('remotes/gone.local.bin')).toBe(true)
        expect(server.requestsTo('/api/write').length).toBe(writesBefore)
    })
})

describe('the Tauri boot removes the leftover temp files of interrupted writes from remotes/', () => {
    const LEFTOVER = 'remotes/risu-write-0123456789abcdef.tmp'
    const OTHER_LEFTOVER = 'remotes/risu-write-fedcba9876543210.tmp'

    beforeEach(() => {
        platformState.isTauri = true
        platformState.isNodeServer = false
        tauriBackend().seedMain(mainFileOf('kept'))
    })

    test('removes only the files whose name is a temp name, before the first write to remotes/', async () => {
        fakeFs.plant(LEFTOVER, new Uint8Array([1, 2, 3]))
        fakeFs.plant(OTHER_LEFTOVER, new Uint8Array([4, 5, 6]))
        fakeFs.plant('remotes/kept.fedcba9876543210.bin', new Uint8Array([7]))
        fakeFs.plant('remotes/risu-write-not-a-temp.tmp', new Uint8Array([8]))
        fakeFs.plant('remotes/.risu-write-0123456789abcdef.tmp', new Uint8Array([9]))
        // An orphan with no .meta makes the clean-up write into remotes/ at boot.
        fakeFs.plant('remotes/gone.local.bin', new Uint8Array([10]))
        const { boot } = await freshLoadData()

        await boot()

        expect(fakeFs.listing('remotes')).toEqual([
            '.risu-write-0123456789abcdef.tmp',
            'gone.local.bin',
            'gone.local.bin.meta',
            'kept.fedcba9876543210.bin',
            'risu-write-not-a-temp.tmp',
        ])
        const firstWrite = fakeFs.calls.findIndex((call) => call.op === 'writeFile' && relative(call.path).startsWith('remotes/'))
        const removed = [LEFTOVER, OTHER_LEFTOVER].map((path) => fakeFs.calls.findIndex((call) => call.op === 'remove' && relative(call.path) === path))
        expect(firstWrite).toBeGreaterThan(-1)
        expect(Math.max(...removed)).toBeLessThan(firstWrite)
    })

    test('guard: a boot with no remotes/ directory yet loads, reports nothing and writes nothing into remotes/', async () => {
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(loaded).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(remoteWrites()).toEqual([])
    })

    test('a temp file that cannot be removed does not stop the boot', async () => {
        fakeFs.plant(LEFTOVER, new Uint8Array([1, 2, 3]))
        const fault = fakeFs.failRemoves('Access is denied. (os error 5)', (path) => path === LEFTOVER)
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(fault.fired).toBeGreaterThan(0)
        expect(loaded).toBe(true)
        expect(fakeFs.files.has(LEFTOVER)).toBe(true)
    })
})
