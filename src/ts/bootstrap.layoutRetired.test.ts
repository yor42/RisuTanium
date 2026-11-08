/**
 * `loadData()` leaves every layout store at its initial value whatever the saved `betaMobileGUI` key, the window width
 * and the Lite build flag say: the Beta Mobile GUI layout is retired, so a boot chooses no layout and installs no
 * touch-swipe handler. The kept `MobileGUI` store is read by the Settings-shell and Studio switches, so a boot that set
 * it would turn both off.
 *
 * Harness: the web `loadData()` of `bootstrap.archivePass.test.ts` (real `bootstrap.ts` and `risuSave.ts`, everything
 * else it imports mocked, the main file served from an in-memory storage object), with the archive pass reduced to
 * "install what was decoded". Each case ends on `loadedStore` true, so a boot that stopped early cannot pass by
 * leaving the layout untouched. A pass says nothing about Tauri, Node-hosted or Android boots.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get, type Writable } from 'svelte/store'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const MAIN_KEY = 'database/database.bin'

const world = vi.hoisted(() => ({
    items: new Map<string, Uint8Array>(),
    db: {} as Record<string, unknown>,
}))

const initMobileGestureMock = vi.hoisted(() => vi.fn())

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
    isTauri: false,
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

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => world.db),
    setDatabase: vi.fn((data: Record<string, unknown>) => { world.db = { ...data } }),
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

// Every layout store a boot could touch is listed, so a boot that writes one shows in the snapshot.
// `MobileGUI` is the kept store: always false, written by nothing.
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as Record<string, unknown> },
    LoadingStatusState: { text: '' },
    MobileGUI: writable(false),
    sideBarStore: writable(true),
    DynamicGUI: writable(false),
    settingsOpen: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

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

// The retired swipe handler's installer: a boot that still called it would count here.
vi.mock(import('src/ts/hotkey'), () => ({ initMobileGesture: initMobileGestureMock }) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({ moduleUpdate: vi.fn(async () => { }) }) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/storage/assetIntegrity'), () => ({
    verifyAssetCacheEntry: vi.fn(async () => ({ status: 'ok' as const })),
}) as unknown as typeof import('src/ts/storage/assetIntegrity'))

vi.mock(import('src/ts/storage/remoteSaveCleanup'), () => ({
    getRemoteSaveCleanupAction: vi.fn(() => 'create-meta'),
    getRemoteSavePayloadName: vi.fn(() => null),
}) as unknown as typeof import('src/ts/storage/remoteSaveCleanup'))

vi.mock(import('src/ts/storage/assetSweep'), () => ({
    sweepTauriAssets: vi.fn(async () => { }),
    sweepForageAssetKey: vi.fn(async () => { }),
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

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => { throw new Error('ENOENT (mock)') }),
    writeFile: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async (key: string) => world.items.get(key) ?? null),
        setItem: vi.fn(async () => { }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: vi.fn(async () => { }),
    getDbBackups: vi.fn(async (): Promise<number[]> => []),
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
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

interface LayoutStores {
    MobileGUI: Writable<boolean>
    sideBarStore: Writable<boolean>
    DynamicGUI: Writable<boolean>
    settingsOpen: Writable<boolean>
    loadedStore: Writable<boolean>
}

const INITIAL_LAYOUT = { MobileGUI: false, sideBarStore: true, DynamicGUI: false, settingsOpen: false }

function saveFor(betaMobileGUI: boolean): Uint8Array {
    return encodeRisuSaveLegacy({
        formatversion: 999,
        characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }],
        modules: [],
        personas: [{ name: 'User', personaPrompt: '', icon: '', note: '', largePortrait: false, id: 'p0' }],
        selectedPersona: 0,
        characterOrder: [],
        mainPrompt: 'fixture-main-prompt',
        loreBookToken: 8000,
        hotkeys: [],
        botPresets: [],
        coldstorage: false,
        checkCorruption: false,
        botSettingAtStart: false,
        betaMobileGUI,
        didFirstSetup: true,
        heightMode: 'auto',
    })
}

/** Boots the web `loadData()` over a main file holding `betaMobileGUI`, then reads every layout store. */
async function bootAndReadLayout(betaMobileGUI: boolean) {
    world.items.set(MAIN_KEY, saveFor(betaMobileGUI))
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    const { loadData } = await import('src/ts/bootstrap')
    const stores = await import('src/ts/stores.svelte') as unknown as LayoutStores
    // Module caching after `vi.resetModules` must not leak a value between cases.
    stores.MobileGUI.set(INITIAL_LAYOUT.MobileGUI)
    stores.sideBarStore.set(INITIAL_LAYOUT.sideBarStore)
    stores.DynamicGUI.set(INITIAL_LAYOUT.DynamicGUI)
    stores.settingsOpen.set(INITIAL_LAYOUT.settingsOpen)
    stores.loadedStore.set(false)

    await loadData()

    return {
        loaded: get(stores.loadedStore),
        layout: {
            MobileGUI: get(stores.MobileGUI),
            sideBarStore: get(stores.sideBarStore),
            DynamicGUI: get(stores.DynamicGUI),
            settingsOpen: get(stores.settingsOpen),
        },
    }
}

beforeEach(() => {
    localStorage.clear()
    world.items.clear()
    world.db = {}
    initMobileGestureMock.mockClear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

describe('loadData() chooses no layout', () => {
    test('T1: a saved betaMobileGUI key on a phone-width window leaves every layout store alone and installs no swipe handler', async () => {
        vi.stubGlobal('innerWidth', 400)

        const { loaded, layout } = await bootAndReadLayout(true)

        expect(loaded).toBe(true)
        expect(layout).toEqual(INITIAL_LAYOUT)
        expect(initMobileGestureMock).not.toHaveBeenCalled()
    })

    test('T2: a Lite build on a desktop-width window leaves every layout store alone and installs no swipe handler', async () => {
        vi.stubGlobal('innerWidth', 1280)
        vi.stubEnv('VITE_RISU_LITE', 'TRUE')

        const { loaded, layout } = await bootAndReadLayout(false)

        expect(loaded).toBe(true)
        expect(layout).toEqual(INITIAL_LAYOUT)
        expect(initMobileGestureMock).not.toHaveBeenCalled()
    })
})
