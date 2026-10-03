/**
 * I6 (Agents/Reports/28-risuaccount-removal-plan.md) and I5 (Agents/Reports/
 * 31-removal-stage-plan.md): a Tauri boot never reads or removes `accountst`,
 * `dosync` or `fallbackRisuToken` -- the code that reads and removes those
 * keys (`AutoStorage.Init()`'s detection, and `loadData()`'s own
 * non-Tauri-branch cleanup in `src/ts/bootstrap.ts`) never runs from the
 * Tauri branch. The orphaned-LocalForage-instance and `risu_lastsaved`
 * cleanup (I5) is different: it runs on the Tauri boot branch too, since
 * nothing in this app reads or writes either on any platform.
 *
 * Split out from `bootstrap.staleAccountProfile.svelte.test.ts` (which covers
 * every non-Tauri scenario) because `bootstrap.ts` reads `isTauri` once, at
 * its own module top level, to build `appWindow` (`isTauri ?
 * getCurrentWebviewWindow() : null`). Exercising the Tauri branch needs a
 * module instance imported with `isTauri` already `true` at that moment.
 * This file keeps a single, fixed `isTauri: true` throughout, and (like the
 * sibling file) gives every test its own module graph via `vi.resetModules()`
 * and a fresh dynamic `import('src/ts/bootstrap')` in `beforeEach`, so no
 * test depends on another's held state.
 *
 * Mocked/real split mirrors the sibling file's: `risuSave.ts` and
 * `process/chatIds.ts` are real; everything else `bootstrap.ts` imports is
 * mocked, including the Tauri-specific `@tauri-apps/plugin-fs` calls this
 * branch makes that the sibling file's mock never exercises
 * (`exists`/`mkdir`/`writeFile`/`readFile`/`rename`) and `@tauri-apps/api/path`'s
 * `appDataDir`/`join`. The boot reads the database through the plugin's
 * `readFile`, so a flat map of files is all the model it needs.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable, get } from 'svelte/store'

const recordLoadTimeListingMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))
const loadPluginsMock = vi.hoisted(() => vi.fn(async (): Promise<void> => { }))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const sweepTauriAssetsMock = vi.hoisted(() => vi.fn(async (_deps: unknown) => { }))
const getRemoteSavePayloadNameMock = vi.hoisted(() => vi.fn((_fileName: string): string | null => null))
const readDirMock = vi.hoisted(() => vi.fn(async (_path: string, _options?: unknown): Promise<Array<{ name: string, isFile?: boolean, isDirectory?: boolean }>> => []))

/** Every instance `localforage.createInstance()` has ever handed back, by the name it was created with -- so a test can inspect which instances were cleared or dropped, and by what name. */
const localforageInstances = vi.hoisted(() => [] as Array<{ name: string, dropInstance: () => Promise<void> }>)
const localforageDropInstanceMock = vi.hoisted(() => vi.fn(async (_opts?: { name?: string }) => { }))

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn((opts: { name: string }) => {
            const dropInstance = vi.fn(async () => { })
            localforageInstances.push({ name: opts?.name, dropInstance })
            return {
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async () => { }),
                removeItem: vi.fn(async () => { }),
                keys: vi.fn(async () => []),
                dropInstance,
            }
        }),
        dropInstance: localforageDropInstanceMock,
    },
}))

/** Total drop calls targeting `name`, whichever mechanism performed them: a module-level `localforage.dropInstance({ name })` call, or `createInstance({ name }).dropInstance()` on the per-instance handle it returned. */
function dropsNamed(name: string): number {
    const moduleLevel = localforageDropInstanceMock.mock.calls.filter(
        ([opts]) => opts?.name === name
    ).length
    const perInstance = localforageInstances
        .filter((inst) => inst.name === name)
        .reduce((sum, inst) => sum + (inst.dropInstance as ReturnType<typeof vi.fn>).mock.calls.length, 0)
    return moduleLevel + perInstance
}

vi.mock(import('src/ts/platform'), () => ({
    isTauri: true,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

const dbState = { current: {} as Record<string, unknown> }

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbState.current),
    setDatabase: vi.fn((data: Record<string, unknown>) => { dbState.current = data }),
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    LoadingStatusState: { text: '' },
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: loadPluginsMock,
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    handlePendingRealmLink: vi.fn(async () => { }),
    hubURL: 'https://realm.risuai.net',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock(import('src/ts/observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('src/ts/observer.svelte'))

vi.mock(import('src/ts/gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('src/ts/gui/guisize'))

vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: false,
        run: vi.fn(async (input: { tree: unknown }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] })),
        release: vi.fn(async () => { }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

vi.mock(import('src/ts/storage/assetIntegrity'), () => ({
    verifyAssetCacheEntry: vi.fn(async () => ({ status: 'ok' as const, expectedHash: '', actualHash: '' })),
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: getRemoteSavePayloadNameMock,
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: recordLoadTimeListingMock,
    resetLoadTimeListingForTests: vi.fn(),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: sweepTauriAssetsMock,
    sweepForageAssetKey: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/storage/assetSweep'))

vi.mock(import('src/ts/media/avatarThumb'), () => ({
    startAvatarThumbSweep: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/media/avatarThumb'))

vi.mock(import('src/ts/model/modellist'), () => ({
    registerModelDynamic: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        maximize: vi.fn(async () => { }),
    })),
}))

const fsStore = new Map<string, Uint8Array>()

/** A path relative to AppData: the byte store addresses every key with a leading `./`. */
const bare = (path: string): string => path.replace(/^\.\//, '')

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async (path: string) => fsStore.has(bare(path))),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async (path: string) => {
        if (!fsStore.has(bare(path))) {
            throw new Error(`ENOENT (mock): ${path}`)
        }
        return fsStore.get(bare(path))!
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => { fsStore.set(bare(path), data) }),
    rename: vi.fn(async (from: string, to: string) => {
        const found = fsStore.get(bare(from))
        if (!found) {
            throw `no such file ${from} (os error 2)`
        }
        fsStore.set(bare(to), found)
        fsStore.delete(bare(from))
    }),
    readDir: readDirMock,
    remove: vi.fn(async (path: string) => { fsStore.delete(bare(path)) }),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: vi.fn(async () => { }),
    getDbBackups: vi.fn(async (): Promise<number[]> => []),
    buildAssetKeepSet: buildAssetKeepSetMock,
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: vi.fn(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

/** A database fixture with enough fields for `checkNewFormat()` to run without throwing. */
function baseDbBytes(mainPrompt: string) {
    return encodeRisuSaveLegacy({
        formatversion: 999,
        characters: [],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt,
        loreBookToken: 8000,
    })
}

/** Imports a fresh `loadData` and the matching `stores.svelte` pair, after `vi.resetModules()`. */
async function freshLoadData() {
    const { loadData } = await import('src/ts/bootstrap')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    return { loadData, loadedStore }
}

beforeEach(() => {
    localStorage.clear()
    fsStore.clear()
    localforageInstances.length = 0
    localforageDropInstanceMock.mockClear()
    dbState.current = {}
    recordLoadTimeListingMock.mockReset().mockResolvedValue(undefined)
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    buildAssetKeepSetMock.mockReset().mockResolvedValue({ uncleanable: new Set<string>(), complete: true })
    sweepTauriAssetsMock.mockReset().mockResolvedValue(undefined)
    getRemoteSavePayloadNameMock.mockReset().mockReturnValue(null)
    readDirMock.mockReset().mockResolvedValue([])
    vi.stubGlobal('open', vi.fn())
    vi.resetModules()
})

describe('loadData(): Tauri boot pins (I6, I5)', () => {
    test('a Tauri boot never reads or removes accountst, dosync or fallbackRisuToken', async () => {
        localStorage.setItem('accountst', 'able')
        localStorage.setItem('dosync', 'sync')
        localStorage.setItem('fallbackRisuToken', JSON.stringify({ token: 'x' }))
        fsStore.set('', new Uint8Array()) // exists('', ...) -> true, skips the mkdir branches
        fsStore.set('database', new Uint8Array())
        fsStore.set('assets', new Uint8Array())
        const dbBytes = baseDbBytes('tauri-fixture')
        fsStore.set('database/database.bin', dbBytes)

        const { loadData, loadedStore } = await freshLoadData()

        // On the `localStorage` instance: once any code has called `getItem` on
        // it, a spy on `Storage.prototype` no longer sees its calls.
        const getItemSpy = vi.spyOn(localStorage, 'getItem')
        let readKeys: unknown[]
        try {
            await loadData()
            readKeys = getItemSpy.mock.calls.map((call) => call[0])
        } finally {
            getItemSpy.mockRestore()
        }

        // The title's "never reads" half: none of the three keys is ever read,
        // not just left unremoved. The boot does read other keys, so an empty
        // list would mean the spy is not in the call path.
        expect(readKeys.length).toBeGreaterThan(0)
        expect(readKeys).not.toContain('accountst')
        expect(readKeys).not.toContain('dosync')
        expect(readKeys).not.toContain('fallbackRisuToken')

        expect(localStorage.getItem('accountst')).toBe('able')
        expect(localStorage.getItem('dosync')).toBe('sync')
        expect(localStorage.getItem('fallbackRisuToken')).not.toBeNull()
        expect(get(loadedStore)).toBe(true)
    })

    test('an ordinary Tauri boot drops risuaiAccountCached exactly once, removes risu_lastsaved and the Drive backup flag, and leaves accountst, dosync and fallbackRisuToken untouched', async () => {
        localStorage.setItem('risu_lastsaved', '123456')
        localStorage.setItem('backup', 'save')
        // Present but irrelevant to a Tauri boot (I6): these three keys are
        // only ever read or removed by the non-Tauri stale-profile machinery,
        // so this shared cleanup must leave them exactly as it found them.
        localStorage.setItem('accountst', 'able')
        localStorage.setItem('dosync', 'sync')
        localStorage.setItem('fallbackRisuToken', JSON.stringify({ token: 'unrelated' }))
        fsStore.set('', new Uint8Array())
        fsStore.set('database', new Uint8Array())
        fsStore.set('assets', new Uint8Array())
        const dbBytes = baseDbBytes('tauri-ordinary-boot')
        fsStore.set('database/database.bin', dbBytes)

        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(dropsNamed('risuaiAccountCached')).toBe(1)
        // The default `localforage` database must not be created: the drop
        // is only ever valid through the named per-instance handle, never
        // the module-level `localforage.dropInstance(...)` form.
        expect(localforageDropInstanceMock).not.toHaveBeenCalled()
        expect(localStorage.getItem('risu_lastsaved')).toBeNull()
        expect(localStorage.getItem('backup')).toBeNull()
        expect(localStorage.getItem('accountst')).toBe('able')
        expect(localStorage.getItem('dosync')).toBe('sync')
        expect(localStorage.getItem('fallbackRisuToken')).not.toBeNull()
        expect(get(loadedStore)).toBe(true)
    })

    test('the per-instance dropInstance() call names risuaiAccountCached and carries no storeName (guard)', async () => {
        fsStore.set('', new Uint8Array())
        fsStore.set('database', new Uint8Array())
        fsStore.set('assets', new Uint8Array())
        const dbBytes = baseDbBytes('tauri-dropinstance-args')
        fsStore.set('database/database.bin', dbBytes)

        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        // localforage 1.10.0's IndexedDB driver deletes the whole named
        // database only when dropInstance() is given a name with no
        // storeName. Called with no options, it fills in storeName from the
        // instance's config, and any storeName makes it delete just that
        // object store, leaving an empty database behind (localforage
        // 1.10.0, dist/localforage.js, the IndexedDB dropInstance()).
        const instance = localforageInstances.find((inst) => inst.name === 'risuaiAccountCached')
        expect(instance).toBeDefined()
        const dropCalls = (instance!.dropInstance as ReturnType<typeof vi.fn>).mock.calls
        expect(dropCalls.length).toBe(1)
        expect(dropCalls[0][0]).toEqual({ name: 'risuaiAccountCached' })
        expect(get(loadedStore)).toBe(true)
    })
})

/** Arms the Tauri database read with `db` as the file's content. */
function armTauriBoot(db: Record<string, unknown>) {
    fsStore.set('', new Uint8Array())
    fsStore.set('database', new Uint8Array())
    fsStore.set('assets', new Uint8Array())
    const dbBytes = encodeRisuSaveLegacy(db)
    fsStore.set('database/database.bin', dbBytes)
}

function tauriBaseDb(): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [],
        modules: [],
        personas: [],
        characterOrder: [],
        mainPrompt: 'tauri-fixture',
        loreBookToken: 8000,
        coldstorage: false,
    }
}

describe('loadData(): the load-time listing is recorded before plugins start (Tauri)', () => {
    test('the listing is recorded and has settled before loadPlugins is called', async () => {
        armTauriBoot(tauriBaseDb())
        const order: string[] = []
        recordLoadTimeListingMock.mockImplementation(async () => {
            order.push('listing:start')
            await new Promise((resolve) => setTimeout(resolve, 15))
            order.push('listing:settled')
        })
        loadPluginsMock.mockImplementation(async () => {
            order.push('loadPlugins')
        })

        const { loadData } = await freshLoadData()

        await loadData()

        expect(recordLoadTimeListingMock).toHaveBeenCalledTimes(1)
        expect(loadPluginsMock).toHaveBeenCalledTimes(1)
        expect(order).toEqual(['listing:start', 'listing:settled', 'loadPlugins'])
    })
})

describe('cleanChunks(): the startup asset sweep does not run once a cold-storage stub exists (Tauri)', () => {
    const REMOTE_META_PATH = 'remotes/orphan-char.local.bin.meta'

    function stubCharacter() {
        return { chaId: 'stub-char', type: 'character', name: 'Stub', chats: [], coldstorage: 'unit-of-stub-char' }
    }

    function plainCharacter() {
        return { chaId: 'plain-char', type: 'character', name: 'Plain', chats: [] }
    }

    /** Boots the Tauri branch with one orphan asset and one orphan legacy remote file on disk, and waits for the remote-file pass when the profile is one that reaches it. */
    async function bootProfile(profile: { coldstorage: boolean, stub: boolean }) {
        const db = tauriBaseDb()
        db.coldstorage = profile.coldstorage
        db.characters = [profile.stub ? stubCharacter() : plainCharacter()]
        armTauriBoot(db)
        readDirMock.mockImplementation(async (path: string) => {
            if (bare(path) === 'remotes') {
                return [{ name: 'orphan-char.local.bin', isFile: true, isDirectory: false }]
            }
            return [{ name: 'orphan.png' }]
        })
        getRemoteSavePayloadNameMock.mockReturnValue('orphan-char')

        const { loadData } = await freshLoadData()
        await loadData()

        if (profile.coldstorage) {
            // The early return leaves nothing to wait for.
            await new Promise((resolve) => setTimeout(resolve, 30))
            return
        }
        await vi.waitFor(() => {
            expect(fsStore.has(REMOTE_META_PATH)).toBe(true)
        }, { timeout: 500, interval: 5 })
    }

    test('flag off with a stub in the loaded tree: the asset keep-set is not built', async () => {
        await bootProfile({ coldstorage: false, stub: true })
        expect(buildAssetKeepSetMock).not.toHaveBeenCalled()
    })

    test('flag off with a stub in the loaded tree: the asset directory is not swept', async () => {
        await bootProfile({ coldstorage: false, stub: true })
        expect(sweepTauriAssetsMock).not.toHaveBeenCalled()
    })

    test('guard: flag off with a stub in the loaded tree: the remote-file pass still runs', async () => {
        await bootProfile({ coldstorage: false, stub: true })
        expect(fsStore.has(REMOTE_META_PATH)).toBe(true)
    })

    test('guard: flag off with no stub: the asset keep-set is built and the asset directory is swept', async () => {
        await bootProfile({ coldstorage: false, stub: false })
        expect(buildAssetKeepSetMock).toHaveBeenCalledTimes(1)
        expect(sweepTauriAssetsMock).toHaveBeenCalledTimes(1)
    })

    for (const stub of [true, false]) {
        test(`guard: flag on ${stub ? 'with' : 'without'} a stub: startup returns before the keep-set, the sweep and the remote-file pass`, async () => {
            await bootProfile({ coldstorage: true, stub })
            expect(buildAssetKeepSetMock).not.toHaveBeenCalled()
            expect(sweepTauriAssetsMock).not.toHaveBeenCalled()
            expect(fsStore.has(REMOTE_META_PATH)).toBe(false)
        })
    }
})

describe('loadData(): a load-time listing that rejects does not stop boot (Tauri)', () => {
    test('guard: loadPlugins is still called and the app still opens', async () => {
        armTauriBoot(tauriBaseDb())
        recordLoadTimeListingMock.mockRejectedValue(new Error('listing failed'))

        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(loadPluginsMock).toHaveBeenCalledTimes(1)
        expect(get(loadedStore)).toBe(true)
    })
})
