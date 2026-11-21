/**
 * No non-Tauri page life registers a service worker, asks `/sw/init`, or reloads to be controlled, whether or not the
 * browser exposes `navigator.serviceWorker`. Drives the REAL `loadData()` on a Node-served page.
 *
 * Labels: regression reproducers (a page with `navigator.serviceWorker` and a failing `/sw/init` registers and reloads
 * on a boot that still carries the service worker), compatibility
 * guard (a stale account profile shows its notice and never registers; passes before and after). A stubbed `navigator.serviceWorker` and `location.reload` are not evidence about a browser.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import { registerRealDispatch } from 'src/ts/tests/realDispatchBoot.test-helpers'
//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const forageState = vi.hoisted(() => ({
    staleAccountProfile: false,
    items: new Map<string, Uint8Array | (() => Uint8Array)>(),
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const getUncleanablesSyncMock = vi.hoisted(() => vi.fn((): string[] => []))
const loadPluginsMock = vi.hoisted(() => vi.fn(async () => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const moduleUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
const markAppInitiatedReloadMock = vi.hoisted(() => vi.fn())
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
        // Archiving stated, so the conversion raises no archive-enabled notice and the fallback notice is the only one a boot posts.
        archiveCharacters: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI: false,
        didFirstSetup: false,
        heightMode: 'auto',
    }
}
dbState.baseline = baseDb

/** How many times the registered dispatch was entered in this test. */
const dispatchEntered = { count: 0 }

async function freshLoadData() {
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    // The legacy main file is converted to a store2 profile by the real dispatch. The test answers the boot's notices itself.
    await registerRealDispatch({ kind: 'tauri', onEnter: () => { dispatchEntered.count += 1 } })
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
const fetchedUrls: string[] = []
let reloadSpy: ReturnType<typeof vi.spyOn>

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    forageState.staleAccountProfile = false
    forageState.items.clear()
    forageState.items.set('database/database.bin', encodeRisuSaveLegacy(baseDb()))
    dbState.current = baseDb()
    platformState.isTauri = false
    platformState.isNodeServer = true
    getDbBackupsMock.mockReset().mockResolvedValue([])
    buildAssetKeepSetMock.mockReset().mockResolvedValue({ uncleanable: new Set(), complete: true })
    getUncleanablesSyncMock.mockReset().mockReturnValue([])
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    saveDbMock.mockReset().mockResolvedValue(undefined)
    moduleUpdateMock.mockReset().mockResolvedValue(undefined)
    markAppInitiatedReloadMock.mockReset()
    registerMock.mockClear()
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => { dbState.current = { ...dbState.baseline(), ...data } })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    fetchedUrls.length = 0
    dispatchEntered.count = 0
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: registerMock }, configurable: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchedUrls.push(String(url))
        return new Response(null, { status: String(url).startsWith('/sw/') ? 503 : 404 })
    }))
    vi.stubGlobal('open', vi.fn())
    reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    reloadSpy.mockClear()
    vi.resetModules()
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    vi.unstubAllGlobals()
})

describe('loadData(): no page life touches a service worker', () => {
    test('reproducer: a Node-hosted page with a failing /sw/init registers nothing, fetches no /sw/ URL, does not reload and finishes', async () => {
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(registerMock).not.toHaveBeenCalled()
        expect(fetchedUrls.filter((u) => u.startsWith('/sw/'))).toEqual([])
        expect(markAppInitiatedReloadMock).not.toHaveBeenCalled()
        expect(reloadSpy).not.toHaveBeenCalled()
        expect(dispatchEntered.count).toBe(1)
        expect(get(loadedStore)).toBe(true)
    })

    test('guard: a stale account profile still shows its notice and never registers', async () => {
        forageState.staleAccountProfile = true
        const { loadData, alertStore } = await freshLoadData()

        const loading = loadData()
        await vi.waitFor(() => {
            if (get(alertStore).type === 'none') {
                throw new Error('expected the stale-account notice to be showing')
            }
        }, { timeout: 500, interval: 5 })

        expect(registerMock).not.toHaveBeenCalled()
        expect(fetchedUrls.filter((u) => u.startsWith('/sw/'))).toEqual([])
        alertStore.set({ type: 'none', msg: '' })
        await loading.catch(() => { })
    })
})
