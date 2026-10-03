/**
 * The startup asset sweep that `loadData()` starts at boot (`cleanChunks` in
 * `src/ts/bootstrap.ts`), on Tauri and on the self-hosted Node server.
 *
 * The real `bootstrap.ts`, `assetSweep.ts` and `risuSave.ts` run. The Tauri file
 * system is the strict in-memory `createFakeTauriFs` at the plugin boundary and
 * the Node server is the `FakeNodeServer` stand-in at the `fetch` boundary behind
 * the real `NodeStorage`, so the sweep lists and deletes through the real byte
 * stores. Everything else `bootstrap.ts` imports is mocked, as in the sibling
 * bootstrap test files. The keep-set and the live references are test inputs;
 * the keys `saveAsset` and the restore record in the page-level set are a `Set`
 * here, and the facade tests (`assetFacade.test.ts`) pin that `saveAsset`
 * records its key before any I/O on the write path and on the has-skip path. A
 * pass here says nothing about the native Tauri file API or the real server.
 *
 * What the sweep does: a key is deleted only when it is in none of the keep-set
 * built before the listing, the keys this page load wrote (asked at each
 * delete), and the references live memory holds when the batch is decided. On
 * Tauri only a file directly under `assets/` is a candidate, names are compared
 * without regard to case, and a temp file of an atomic write is never listed.
 *
 * Tests titled `guard:` assert behaviour that holds before and after the sweep
 * moved behind the byte store; `reproducer:` tests fail against the sweep that
 * listed the asset directory itself and deleted what the keep-set did not name.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'

const MAIN_KEY = 'database/database.bin'

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))

/** What the mocked `globalApi.svelte` answers the sweep with. */
const world = vi.hoisted(() => ({
    storage: null as unknown,
    keyPair: null as CryptoKeyPair | null,
    /** The basenames in the keep-set `buildAssetKeepSet` builds. */
    keep: [] as string[],
    /** The basenames `getUncleanablesSync` reports when the sweep asks for the live references. */
    live: [] as string[],
    /** The keys `saveAsset` or a restore recorded in this page load. */
    written: new Set<string>(),
    /** Runs after the keep-set is built and before the sweep lists: where a save during the page load happens. */
    afterKeepSet: undefined as undefined | (() => Promise<void> | void),
    keepSetCalls: 0,
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

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: vi.fn(() => null),
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

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
        buildAssetKeepSet: vi.fn(async () => {
            world.keepSetCalls++
            const keepSet = { uncleanable: new Set<string>(world.keep), complete: true }
            await world.afterKeepSet?.()
            return keepSet
        }),
        getBasename: (p: string) => p.replace(/\\/g, '/').split('/').pop(),
        setUsingSw: vi.fn(),
        checkCharOrder: vi.fn(),
        getUncleanablesSync: vi.fn((): string[] => [...world.live]),
        wasAssetWrittenThisPage: (key: string) => world.written.has(key),
        listAssetsWrittenThisPage: () => Array.from(world.written),
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

function bytesOf(...values: number[]): Uint8Array {
    return new Uint8Array(values)
}

/** One backend that holds the profile: `put` stores a key, `has` tells whether it holds one, `keys` lists them. */
interface Backend {
    put(key: string, bytes: Uint8Array): void
    has(key: string): boolean
    keys(): string[]
    seedMain(bytes: Uint8Array): void
}

function tauriBackend(): Backend {
    return {
        put: (key, bytes) => fakeFs.plant(key, bytes),
        has: (key) => fakeFs.files.has(key),
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
        has: (key) => server.files.has(key),
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

beforeEach(async () => {
    localStorage.clear()
    world.keyPair = null
    world.keep = []
    world.live = []
    world.written = new Set()
    world.afterKeepSet = undefined
    world.keepSetCalls = 0
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

/** The sweep's cases that hold on every platform, run unchanged against each backend. */
function describeSweep(name: string, platform: 'tauri' | 'node', backend: () => Backend): void {
    describe(`startup asset sweep on ${name}`, () => {
        let store: Backend

        beforeEach(() => {
            platformState.isTauri = platform === 'tauri'
            platformState.isNodeServer = platform === 'node'
            store = backend()
            store.seedMain(encodeRisuSaveLegacy(baseDb()))
        })

        test('guard: deletes an unreferenced asset and keeps one the keep-set names', async () => {
            store.put('assets/orphan.png', bytesOf(1))
            store.put('assets/kept.png', bytesOf(2))
            world.keep = ['kept.png']
            const { boot } = await freshLoadData()

            const { loaded } = await boot()

            expect(loaded).toBe(true)
            expect(store.has('assets/orphan.png')).toBe(false)
            expect(store.has('assets/kept.png')).toBe(true)
            expect(alertErrorMock).not.toHaveBeenCalled()
        })

        test('reproducer: an asset written during the page load, after the keep-set was built, is kept', async () => {
            world.afterKeepSet = () => {
                // What `saveAsset` does for a new asset: records the key, then writes it.
                world.written.add('assets/just-saved.png')
                store.put('assets/just-saved.png', bytesOf(3))
            }
            store.put('assets/orphan.png', bytesOf(1))
            const { boot } = await freshLoadData()

            await boot()

            expect(store.has('assets/just-saved.png')).toBe(true)
            expect(store.has('assets/orphan.png')).toBe(false)
        })

        test('reproducer: an existing asset that a duplicate import recorded without writing it is kept', async () => {
            store.put('assets/imported-again.png', bytesOf(4))
            world.afterKeepSet = () => {
                // What `saveAsset` does when the file exists already: records the key and returns.
                world.written.add('assets/imported-again.png')
            }
            store.put('assets/orphan.png', bytesOf(1))
            const { boot } = await freshLoadData()

            await boot()

            expect(store.has('assets/imported-again.png')).toBe(true)
            expect(store.has('assets/orphan.png')).toBe(false)
        })

        test('reproducer: an asset that live memory references by the time the sweep decides is kept', async () => {
            world.afterKeepSet = () => {
                world.live = ['newly-referenced.png']
            }
            store.put('assets/newly-referenced.png', bytesOf(5))
            store.put('assets/orphan.png', bytesOf(1))
            const { boot } = await freshLoadData()

            await boot()

            expect(store.has('assets/newly-referenced.png')).toBe(true)
            expect(store.has('assets/orphan.png')).toBe(false)
        })

        test('guard: an incomplete keep-set deletes nothing', async () => {
            const { buildAssetKeepSet } = await import('src/ts/globalApi.svelte')
            vi.mocked(buildAssetKeepSet).mockResolvedValueOnce({ uncleanable: new Set(), complete: false })
            store.put('assets/orphan.png', bytesOf(1))
            const { boot } = await freshLoadData()

            await boot()

            expect(store.has('assets/orphan.png')).toBe(true)
        })
    })
}

describeSweep('Tauri', 'tauri', tauriBackend)
describeSweep('the Node server', 'node', nodeBackend)

describe('startup asset sweep on the Node server: the live references are walked per batch of candidates', () => {
    beforeEach(() => {
        platformState.isTauri = false
        platformState.isNodeServer = true
        nodeBackend().seedMain(encodeRisuSaveLegacy(baseDb()))
    })

    async function liveWalks(): Promise<number> {
        const { getUncleanablesSync } = await import('src/ts/globalApi.svelte')
        return vi.mocked(getUncleanablesSync).mock.calls.length
    }

    test('reproducer: when the keep-set protects every listed key the live references are never walked', async () => {
        const names = Array.from({ length: 250 }, (_, index) => `kept-${index}.png`)
        for (const name of names) {
            server.seed(`assets/${name}`, bytesOf(1))
        }
        world.keep = names
        const { boot } = await freshLoadData()
        const { getUncleanablesSync } = await import('src/ts/globalApi.svelte')
        vi.mocked(getUncleanablesSync).mockClear()

        await boot()

        expect(await liveWalks()).toBe(0)
        expect(Array.from(server.files.keys()).filter((key) => key.startsWith('assets/'))).toHaveLength(250)
    })

    test('reproducer: the live references are walked once per batch of 100 candidates, not per batch of listed keys', async () => {
        const kept = Array.from({ length: 300 }, (_, index) => `kept-${index}.png`)
        for (const name of kept) {
            server.seed(`assets/${name}`, bytesOf(1))
        }
        for (let index = 0; index < 150; index++) {
            server.seed(`assets/orphan-${index}.png`, bytesOf(2))
        }
        world.keep = kept
        const { boot } = await freshLoadData()
        const { getUncleanablesSync } = await import('src/ts/globalApi.svelte')
        vi.mocked(getUncleanablesSync).mockClear()

        await boot()

        expect(await liveWalks()).toBe(2)
        expect(Array.from(server.files.keys()).filter((key) => key.startsWith('assets/'))).toHaveLength(300)
    })
})

describe('startup asset sweep on Tauri: the desktop file system', () => {
    beforeEach(() => {
        platformState.isTauri = true
        platformState.isNodeServer = false
        tauriBackend().seedMain(encodeRisuSaveLegacy(baseDb()))
    })

    test('reproducer: the temp file of an atomic write that appears during the page load is not deleted', async () => {
        const temp = 'assets/risu-write-0123456789abcdef.tmp'
        world.afterKeepSet = () => {
            fakeFs.plant(temp, bytesOf(9, 9))
        }
        fakeFs.plant('assets/orphan.png', bytesOf(1))
        const { boot } = await freshLoadData()

        await boot()

        expect(Array.from(fakeFs.files.get(temp) ?? [])).toEqual([9, 9])
        expect(fakeFs.files.has('assets/orphan.png')).toBe(false)
        expect(fakeFs.removeLog.map((path) => path.replace(/^\.\//, ''))).not.toContain(temp)
    })

    test('reproducer: an asset whose name differs from the keep-set entry only in case is kept', async () => {
        world.keep = ['hero.png']
        fakeFs.plant('assets/Hero.PNG', bytesOf(6))
        fakeFs.plant('assets/orphan.png', bytesOf(1))
        const { boot } = await freshLoadData()

        await boot()

        expect(fakeFs.files.has('assets/Hero.PNG')).toBe(true)
        expect(fakeFs.files.has('assets/orphan.png')).toBe(false)
    })

    test('reproducer: an asset whose name differs from a live reference only in case is kept', async () => {
        world.afterKeepSet = () => {
            world.live = ['late.png']
        }
        fakeFs.plant('assets/LATE.PNG', bytesOf(6))
        const { boot } = await freshLoadData()

        await boot()

        expect(fakeFs.files.has('assets/LATE.PNG')).toBe(true)
    })

    test('reproducer: an existing asset that a same-bytes save under another case of the extension recorded is kept', async () => {
        fakeFs.plant('assets/abc123.png', bytesOf(8))
        world.afterKeepSet = () => {
            // What the has-skip of `saveAsset` records for the extension `PNG`.
            world.written.add('assets/abc123.PNG')
        }
        const { boot } = await freshLoadData()

        await boot()

        expect(fakeFs.files.has('assets/abc123.png')).toBe(true)
    })

    test('guard: a file in a nested directory of assets/ is not deleted', async () => {
        fakeFs.plant('assets/d/nested.png', bytesOf(7))
        fakeFs.plant('assets/orphan.png', bytesOf(1))
        const { boot } = await freshLoadData()

        await boot()

        expect(fakeFs.files.has('assets/d/nested.png')).toBe(true)
        expect(fakeFs.files.has('assets/orphan.png')).toBe(false)
    })

    test('guard: a deletion that fails is skipped, the other assets are still swept, and the boot is not failed', async () => {
        fakeFs.plant('assets/stuck.png', bytesOf(1))
        fakeFs.plant('assets/orphan.png', bytesOf(2))
        const fault = fakeFs.failRemoves('Access is denied. (os error 5)', (path) => path === 'assets/stuck.png')
        const { boot } = await freshLoadData()

        const { loaded } = await boot()

        expect(fault.fired).toBeGreaterThan(0)
        expect(loaded).toBe(true)
        expect(fakeFs.files.has('assets/stuck.png')).toBe(true)
        expect(fakeFs.files.has('assets/orphan.png')).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })
})
