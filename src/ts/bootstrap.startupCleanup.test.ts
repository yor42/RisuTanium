/**
 * The startup clean-up (`cleanChunks` in `src/ts/bootstrap.ts`) as `loadData()` starts it.
 *
 * Drives the REAL `loadData()`, non-Tauri branch, with the harness shape that
 * `bootstrap.upstreamAgreement.svelte.test.ts` uses: storage, the alert module's
 * `alertError`, the platform and every heavy import are mocked, and the real
 * `startupCleanupState` module is the state that a database load waits on.
 * `recordStartupCleanup` is wrapped by a spy that calls through, so a test can
 * see which promise boot recorded.
 *
 * Invariants:
 * - Boot records the promise that `cleanChunks()` itself returned, including
 *   when `cleanChunks` returns early on the root `coldstorage` flag, so a load
 *   waits for the real clean-up and never for a stand-in.
 * - A clean-up that rejects is reported to the user and the console. The state
 *   module attaches handlers to the promise it records, so the page's
 *   `unhandledrejection` handler never sees that rejection: boot must report it
 *   itself.
 *
 * Tests titled `guard:` pin behaviour that must be preserved and pass before
 * and after the change; every other test is a regression test for the
 * behaviour it names. A mocked clean-up is not evidence of the Tauri or Node
 * server clean-up.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const forageState = vi.hoisted(() => ({
    items: new Map<string, Uint8Array>(),
}))

const recorded = vi.hoisted(() => ({ promises: [] as Array<Promise<unknown>> }))

const keysMock = vi.hoisted(() => vi.fn(async (): Promise<string[]> => []))
const alertErrorMock = vi.hoisted(() => vi.fn())
const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const getUncleanablesSyncMock = vi.hoisted(() => vi.fn((): string[] => []))
const verifyAssetCacheEntryMock = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' as const })))
const loadPluginsMock = vi.hoisted(() => vi.fn(async () => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const moduleUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
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
    decryptBuffer: vi.fn(async (d: unknown) => d),
    isKnownUri: vi.fn(() => false),
    selectFileByDom: vi.fn(async () => null),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: vi.fn(),
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: setDatabaseMock,
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
    importPreset: vi.fn(async () => { }),
    setDatabaseLite: vi.fn(),
    appVer: 'test',
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
    SettingsMenuIndex: writable(0),
    ShowRealmFrameStore: writable(''),
    settingsOpen: writable(false),
}) as unknown as typeof import('src/ts/stores.svelte'))

// Only `alertError` is replaced, so the test can see what boot reports; every
// other export is the real alert module.
vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertError: alertErrorMock,
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/storage/startupCleanupState'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        recordStartupCleanup: (promise: Promise<unknown>) => {
            recorded.promises.push(promise)
            actual.recordStartupCleanup(promise)
        },
    }
})

// The load-time listing also lists storage keys; it is not the clean-up under
// test, and leaving it real would make `forageStorage.keys` ambiguous.
vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: loadPluginsMock,
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

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
    changeChar: vi.fn(async () => { }),
    characterFormatUpdate: vi.fn((c: unknown) => c),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: moduleUpdateMock,
    exportModuleLegacy: vi.fn(),
    readModule: vi.fn(),
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

vi.mock(import('src/ts/media'), () => ({
    compressImage: vi.fn(async (d: unknown) => d),
    getImageType: vi.fn(() => 'png'),
}) as unknown as typeof import('src/ts/media'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/process/files/inlays'), () => ({
    reencodeImage: vi.fn(async (d: unknown) => d),
}) as unknown as typeof import('src/ts/process/files/inlays'))

vi.mock(import('src/ts/pngChunk'), () => ({
    PngChunk: class { },
}) as unknown as typeof import('src/ts/pngChunk'))

vi.mock(import('src/ts/process/processzip'), () => ({
    CharXImporter: class { },
    CharXWriter: class { },
}) as unknown as typeof import('src/ts/process/processzip'))

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

vi.mock('@tauri-apps/plugin-deep-link', () => ({
    onOpenUrl: vi.fn(async () => vi.fn()),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async (key: string) => forageState.items.get(key) ?? null),
        setItem: vi.fn(async () => { }),
        keys: keysMock,
        removeItem: vi.fn(async () => { }),
    },
    saveDb: saveDbMock,
    getDbBackups: getDbBackupsMock,
    buildAssetKeepSet: buildAssetKeepSetMock,
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: vi.fn(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: getUncleanablesSyncMock,
    AppendableBuffer: class { },
    BlankWriter: class { },
    LocalWriter: class { },
    VirtualWriter: class { },
    downloadFile: vi.fn(async () => { }),
    loadAsset: vi.fn(async () => new Uint8Array()),
    readImage: vi.fn(async (d: unknown) => d),
    saveAsset: vi.fn(async () => ''),
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

/** Enough fields for `checkNewFormat()` to run without throwing, and no format-migration branch to trigger. */
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

function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function ticks(n = 20): Promise<void> {
    for (let i = 0; i < n; i++) {
        await delay(0)
    }
}

/** Follows a promise from now on: its state after the macrotasks the test then waits. */
function track(promise: Promise<unknown>): { state: 'pending' | 'fulfilled' | 'rejected' } {
    const seen: { state: 'pending' | 'fulfilled' | 'rejected' } = { state: 'pending' }
    promise.then(
        () => { seen.state = 'fulfilled' },
        () => { seen.state = 'rejected' },
    )
    return seen
}

/** A fresh `loadData` and the real state module of the same module graph, after `vi.resetModules()`. */
async function freshBoot() {
    // The boot reads through the page's byte store; here it is the storage-object model above.
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike))
    const { loadData } = await import('src/ts/bootstrap')
    const startupCleanup = await import('src/ts/storage/startupCleanupState')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    // The mocked `stores.svelte` store outlives `vi.resetModules()`, and `loadData()` no-ops
    // once `loadedStore` is true.
    loadedStore.set(false)
    return { loadData, startupCleanup, loadedStore }
}

/** Arms the non-Tauri database read so `loadData()` installs `db` on its ordinary decode path. */
function arm(db: Record<string, unknown>) {
    forageState.items.set('database/database.bin', encodeRisuSaveLegacy(db))
}

/** The one promise boot recorded as the startup clean-up. */
function recordedCleanup(): Promise<unknown> {
    expect(recorded.promises.length, 'startup clean-ups recorded').toBe(1)
    return recorded.promises[0]
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    forageState.items.clear()
    recorded.promises.length = 0
    keysMock.mockReset().mockResolvedValue([])
    alertErrorMock.mockReset()
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
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => { dbState.current = { ...dbState.baseline(), ...data } })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('loadData records the startup clean-up it starts', () => {
    test('guard: a clean-up that is still running is the recorded one: pending while its storage listing is outstanding, settled once that returns', async () => {
        let releaseKeys: () => void = () => { }
        // Only the first listing is held; the clean-up lists storage again for the remote blocks.
        keysMock.mockImplementationOnce(() => new Promise<string[]>((resolve) => { releaseKeys = () => resolve([]) }))
        arm(baseDb())
        const { loadData, startupCleanup } = await freshBoot()

        await loadData()
        await ticks()

        expect.soft(keysMock, 'the clean-up listed storage').toHaveBeenCalled()
        const cleanup = recordedCleanup()
        const cleanupState = track(cleanup)
        const waited = startupCleanup.getStartupCleanup()
        expect(waited, 'a clean-up in progress is recorded for a database load to wait on').not.toBeNull()
        const waitedState = track(waited as Promise<void>)
        await ticks()
        expect.soft(cleanupState.state, 'the recorded promise while the clean-up runs').toBe('pending')
        expect.soft(waitedState.state, 'the promise a load waits on while the clean-up runs').toBe('pending')

        releaseKeys()
        await ticks()

        expect.soft(cleanupState.state, 'the recorded promise once the clean-up finished').toBe('fulfilled')
        expect.soft(waitedState.state, 'the promise a load waits on once the clean-up finished').toBe('fulfilled')
    })

    test('guard: a clean-up that returns early on the root coldstorage flag is recorded, settles without listing storage, and does not keep a load waiting', async () => {
        arm({ ...baseDb(), coldstorage: true })
        const { loadData, startupCleanup } = await freshBoot()

        await loadData()
        await ticks()

        expect.soft(dbState.current.coldstorage, 'the booted database has the root coldstorage flag').toBe(true)
        const cleanup = recordedCleanup()
        const cleanupState = track(cleanup)
        const waited = startupCleanup.getStartupCleanup()
        const waitedState = waited === null ? null : track(waited)
        await ticks()
        expect.soft(cleanupState.state, 'the recorded promise').toBe('fulfilled')
        expect.soft(keysMock, 'the early return lists no storage').not.toHaveBeenCalled()
        if (waitedState !== null) {
            expect.soft(waitedState.state, 'the promise a load waits on').toBe('fulfilled')
        }
    })
})

describe('loadData reports a startup clean-up that fails', () => {
    test('a clean-up whose storage listing rejects is reported with alertError and console.error', async () => {
        const failure = new Error('scratch: storage listing failed')
        keysMock.mockRejectedValue(failure)
        arm(baseDb())
        const { loadData, loadedStore } = await freshBoot()

        await loadData()
        await ticks()

        expect.soft(keysMock, 'the clean-up listed storage').toHaveBeenCalled()
        expect.soft(get(loadedStore), 'boot finished').toBe(true)
        expect.soft(alertErrorMock, 'alertError calls').toHaveBeenCalledWith(failure)
        expect.soft(consoleErrorSpy.mock.calls.some((args) => args.includes(failure)), 'console.error was given the failure').toBe(true)
    })
})
