/**
 * A page the service worker does not control yet reloads once to be controlled (`registerSw()` in `src/ts/bootstrap.ts`
 * answers a non-2xx `/sw/init` with `markAppInitiatedReload()` and `location.reload()`). The page life that reloads must
 * post no boot notice and consume no one-shot state, so each notice shows once, in the life that stays. Drives the REAL
 * `loadData()` the way `bootstrap.opfsFallbackNotice.svelte.test.ts` does; the storage fallback notice stands for every
 * boot notice because it is posted at the same place and is consumed by `takeStorageFallbackNotice()`.
 *
 * Labels: reproducer (the 5xx first visit posts a notice before the reload on the base), compatibility guard (a 2xx boot
 * posts its notice and does not reload). A mocked service worker and `location.reload` are not evidence about a browser.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import type { FallbackNotice } from 'src/ts/storage/opfsCopyBack'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const forageState = vi.hoisted(() => ({
    staleAccountProfile: false,
    fallbackNotice: null as FallbackNotice | null,
    items: new Map<string, Uint8Array | (() => Uint8Array)>(),
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const getUncleanablesSyncMock = vi.hoisted(() => vi.fn((): string[] => []))
const verifyAssetCacheEntryMock = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' as const })))
const loadPluginsMock = vi.hoisted(() => vi.fn(async () => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const moduleUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
const markAppInitiatedReloadMock = vi.hoisted(() => vi.fn())
const setUsingSwMock = vi.hoisted(() => vi.fn())
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))

//#endregion

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(() => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
            clear: vi.fn(async () => { }),
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
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: markAppInitiatedReloadMock,
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
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
    moduleUpdate: moduleUpdateMock,
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
    verifyAssetCacheEntry: verifyAssetCacheEntryMock,
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: vi.fn(() => null),
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: vi.fn(async () => { }),
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

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async (path: string) => { throw new Error(`ENOENT (mock): ${path}`) }),
    writeFile: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/storage/store/appStore'), async (importOriginal) => ({
    ...await importOriginal(),
    cleanUpCopiedBackOpfs: vi.fn(async () => { }),
    takeStorageFallbackNotice: () => {
        const notice = forageState.fallbackNotice
        forageState.fallbackNotice = null
        return notice
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        get staleAccountProfile() { return forageState.staleAccountProfile },
        set staleAccountProfile(v: boolean) { forageState.staleAccountProfile = v },
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async (key: string) => {
            const entry = forageState.items.get(key)
            if (entry === undefined) {
                return null
            }
            return typeof entry === 'function' ? entry() : entry
        }),
        setItem: vi.fn(async (key: string, value: Uint8Array) => { forageState.items.set(key, value) }),
        keys: vi.fn(async (): Promise<string[]> => Array.from(forageState.items.keys())),
        removeItem: vi.fn(async (key: string) => { forageState.items.delete(key) }),
    },
    saveDb: saveDbMock,
    getDbBackups: getDbBackupsMock,
    buildAssetKeepSet: buildAssetKeepSetMock,
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: setUsingSwMock,
    checkCharOrder: vi.fn(),
    getUncleanablesSync: getUncleanablesSyncMock,
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

function baseDb(): Record<string, unknown> {
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
        didFirstSetup: false,
        heightMode: 'auto',
    }
}
dbState.baseline = baseDb

async function freshLoadData() {
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
}

const registerMock = vi.fn(async () => { })
let swInitStatus = 200
let reloadSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    localStorage.clear()
    forageState.staleAccountProfile = false
    forageState.fallbackNotice = null
    forageState.items.clear()
    forageState.items.set('database/database.bin', encodeRisuSaveLegacy(baseDb()))
    dbState.current = baseDb()
    platformState.isTauri = false
    platformState.isNodeServer = false
    getDbBackupsMock.mockReset().mockResolvedValue([])
    buildAssetKeepSetMock.mockReset().mockResolvedValue({ uncleanable: new Set(), complete: true })
    getUncleanablesSyncMock.mockReset().mockReturnValue([])
    verifyAssetCacheEntryMock.mockReset().mockResolvedValue({ status: 'ok' })
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    saveDbMock.mockReset().mockResolvedValue(undefined)
    moduleUpdateMock.mockReset().mockResolvedValue(undefined)
    markAppInitiatedReloadMock.mockReset()
    setUsingSwMock.mockReset()
    registerMock.mockClear()
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => { dbState.current = { ...dbState.baseline(), ...data } })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    swInitStatus = 200
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: registerMock }, configurable: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(null, { status: url === '/sw/init' ? swInitStatus : 404 })))
    vi.stubGlobal('open', vi.fn())
    reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    reloadSpy.mockClear()
    vi.resetModules()
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    vi.unstubAllGlobals()
})

describe('loadData(): the page life that reloads for the service worker', () => {
    test('reproducer: a first visit whose /sw/init answers non-2xx posts no notice, consumes none and reads nothing before the reload', async () => {
        swInitStatus = 503
        forageState.fallbackNotice = { reason: 'space' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()
        const seenTypes: string[] = []
        // Every notice is acknowledged as it shows, so a life that wrongly posts one fails the assertion below
        // instead of waiting on a user forever.
        const unsubscribe = alertStore.subscribe((v) => {
            seenTypes.push(v.type)
            if (v.type !== 'none') {
                setTimeout(() => alertStore.set({ type: 'none', msg: '' }), 0)
            }
        })

        await loadData()
        unsubscribe()

        expect(registerMock).toHaveBeenCalled()
        expect(markAppInitiatedReloadMock).toHaveBeenCalledTimes(1)
        expect(reloadSpy).toHaveBeenCalledTimes(1)
        expect(seenTypes.filter((t) => t !== 'none')).toEqual([])
        // The one-shot notice is still there for the page life that stays.
        expect(forageState.fallbackNotice).toEqual({ reason: 'space' })
        // No profile was read or installed by the life that leaves.
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(get(loadedStore)).toBe(false)
    })

    test('guard: a boot whose /sw/init answers 2xx posts its notice, does not reload and finishes', async () => {
        forageState.fallbackNotice = { reason: 'space' }
        const { loadData, alertStore, loadedStore } = await freshLoadData()

        const loading = loadData()
        await vi.waitFor(() => {
            if (get(alertStore).type === 'none') {
                throw new Error('expected the fallback notice to be showing')
            }
        }, { timeout: 500, interval: 5 })
        alertStore.set({ type: 'none', msg: '' })
        await loading

        expect(reloadSpy).not.toHaveBeenCalled()
        expect(markAppInitiatedReloadMock).not.toHaveBeenCalled()
        expect(setUsingSwMock).toHaveBeenCalledWith(true)
        expect(get(loadedStore)).toBe(true)
    })

    test('guard: a stale account profile still never reaches the service worker', async () => {
        swInitStatus = 503
        forageState.staleAccountProfile = true
        const { loadData, alertStore } = await freshLoadData()

        const loading = loadData()
        await vi.waitFor(() => {
            if (get(alertStore).type === 'none') {
                throw new Error('expected the stale-account notice to be showing')
            }
        }, { timeout: 500, interval: 5 })

        expect(registerMock).not.toHaveBeenCalled()
        expect(setUsingSwMock).not.toHaveBeenCalled()
        alertStore.set({ type: 'none', msg: '' })
        await loading.catch(() => { })
    })
})
