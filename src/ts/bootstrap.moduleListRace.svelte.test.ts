/**
 * The module step of the boot format check (`checkNewFormat` in `src/ts/bootstrap.ts`) as `loadData()` runs it.
 *
 * Drives the REAL `loadData()`, non-Tauri branch, with the harness shape of `bootstrap.upstreamAgreement.svelte.test.ts`:
 * storage, the platform and every heavy import are mocked, and the real `moduleLorebookRepair` module repairs the
 * lorebooks. The person's answers are the alert functions: the first `waitAlert` after a test arms the gate is held
 * until the test releases it, which stands for a lorebook question left open while the rest of the application runs.
 * A loader install and a plugin write made during that wait are simulated by direct writes to the live module list.
 *
 * Invariants:
 * - A module list written during the wait is the list the application keeps: the step never reassigns over it.
 * - A body installed into a slot the loop has already passed stays in that slot.
 * - A list without null elements is not assigned at all.
 * - A module whose lorebook was migrated at boot is the body that stays in the live list, so it is saved.
 *
 * Tests titled `guard:` pin behaviour that must be preserved and pass before and after the change; every other test is
 * a regression test for the behaviour it names. The save loop is not part of this harness: a mocked `saveDb` shows that
 * boot saves, not what the store writes.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
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

const gate = vi.hoisted(() => ({
    hold: null as Promise<void> | null,
    arrived: null as (() => void) | null,
}))

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

// The lorebook question is answered by these three functions. The first `waitAlert` after the gate is armed is held
// until the test releases it; every other prompt resolves at once, and the report and reset questions answer "no".
vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...(await importOriginal()),
    alertError: alertErrorMock,
    waitAlert: async () => {
        const held = gate.hold
        gate.hold = null
        gate.arrived?.()
        if (held) { await held }
    },
    alertConfirm: async () => false,
}) as unknown as typeof import('src/ts/alert'))

// The load-time listing also lists storage keys; it is not the step under test, and leaving it real would make
// `forageStorage.keys` ambiguous.
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

// A recording copy of the lorebook migration: an entry below book version 2 is migrated in place.
vi.mock(import('src/ts/characters'), () => ({
    updateLorebooks: vi.fn((book: Array<{ bookVersion?: number }>) => book.map((entry) => ({ ...entry, bookVersion: 2 }))),
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
    ASSET_SWEEP_BATCH_SIZE: 100,
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

vi.mock(import('src/ts/process/files/inlayCopy'), () => ({
    startInlayCopy: vi.fn(),
}) as unknown as typeof import('src/ts/process/files/inlayCopy'))

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
    wasAssetWrittenThisPage: vi.fn(() => false),
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

/** A fresh `loadData` of the same module graph, after `vi.resetModules()`. */
async function freshBoot() {
    // The boot reads through the page's byte store; here it is the storage-object model above.
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    const { loadData } = await import('src/ts/bootstrap')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    // The mocked `stores.svelte` store outlives `vi.resetModules()`, and `loadData()` no-ops
    // once `loadedStore` is true.
    loadedStore.set(false)
    return { loadData }
}

/** Arms the non-Tauri database read so `loadData()` installs `db` on its ordinary decode path. */
function arm(db: Record<string, unknown>) {
    forageState.items.set('database/database.bin', encodeRisuSaveLegacy(db))
}

/** The decoded database gets `modules` as its module list when the boot installs it. */
function injectModules(modules: unknown) {
    let first = true
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => {
        if (first) { first = false; data.modules = modules }
        dbState.current = { ...dbState.baseline(), ...data }
    })
}

type Body = Record<string, unknown>

function moduleBody(name: string, lorebook: unknown = []): Body {
    return { id: `id-${name}`, name, description: 'd', trigger: [], regex: [], lorebook, assets: [] }
}

/** A lorebook the repair asks about: not a list. */
function corruptedBody(name: string): Body {
    return moduleBody(name, 'not a list')
}

function liveModules(): unknown {
    return dbState.current.modules
}

/**
 * Boots with `modules`, runs `during` while the lorebook question of the first corrupted module is open, then answers
 * the question and lets the boot finish.
 */
async function bootHeldAtQuestion(modules: unknown, during: () => void): Promise<void> {
    let release: () => void = () => { }
    gate.hold = new Promise<void>((resolve) => { release = resolve })
    const arrived = new Promise<void>((resolve) => { gate.arrived = resolve })
    injectModules(modules)
    arm(baseDb())
    const { loadData } = await freshBoot()
    const booting = loadData()
    await arrived
    during()
    release()
    await booting
    await ticks()
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    forageState.items.clear()
    gate.hold = null
    gate.arrived = null
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
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    consoleErrorSpy.mockRestore()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('loadData(): the module step of the format check while a lorebook question is open', () => {
    test('a module list a plugin wrote during the wait is the list the application keeps, with its added module', async () => {
        const original = [moduleBody('a'), corruptedBody('b')]
        const replacement = [moduleBody('a'), moduleBody('b'), moduleBody('plugin-added')]
        await bootHeldAtQuestion(original, () => {
            dbState.current.modules = replacement
        })
        expect(liveModules()).toBe(replacement)
        expect((liveModules() as Body[]).map((m) => m.name)).toEqual(['a', 'b', 'plugin-added'])
    })

    test('a body installed into a slot the loop already passed stays in that slot', async () => {
        const list = [moduleBody('a-stub-stand-in'), corruptedBody('b')]
        const installed = moduleBody('a-installed')
        await bootHeldAtQuestion(list, () => {
            ;(dbState.current.modules as Body[])[0] = installed
        })
        expect(liveModules()).toBe(list)
        expect((liveModules() as Body[])[0]).toBe(installed)
    })

    test('a non-list a plugin wrote during the wait is left as written', async () => {
        const written = { notAList: true }
        await bootHeldAtQuestion([corruptedBody('b')], () => {
            dbState.current.modules = written
        })
        expect(liveModules()).toBe(written)
    })

    test('a list without null elements is not assigned after the wait', async () => {
        const list = [moduleBody('a'), corruptedBody('b')]
        let writes = 0
        await bootHeldAtQuestion(list, () => {
            Object.defineProperty(dbState.current, 'modules', {
                configurable: true,
                enumerable: true,
                get: () => list,
                set: () => { writes++ },
            })
        })
        expect(writes).toBe(0)
    })

    test('guard: a module whose lorebook was migrated at boot stays in the live list as the migrated body, and boot saves', async () => {
        const old = moduleBody('old', [{ comment: 'c', content: 'x', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal', bookVersion: 1 }])
        injectModules([old])
        arm(baseDb())
        const { loadData } = await freshBoot()
        await loadData()
        await ticks()
        const live = liveModules() as Body[]
        expect(live).toHaveLength(1)
        expect(live[0]).toBe(old)
        expect((live[0].lorebook as Array<{ bookVersion: number }>)[0].bookVersion).toBe(2)
        expect(saveDbMock).toHaveBeenCalled()
    })

    test('guard: null elements are removed at boot', async () => {
        const kept = moduleBody('kept')
        injectModules([null, kept, undefined])
        arm(baseDb())
        const { loadData } = await freshBoot()
        await loadData()
        await ticks()
        expect(liveModules()).toEqual([kept])
    })
})
