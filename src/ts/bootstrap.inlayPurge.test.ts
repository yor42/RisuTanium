/**
 * The boot purge of characters that have been in the trash for more than three
 * days (`checkNewFormat` in `src/ts/bootstrap.ts`) queues the inlay cleanup for
 * the characters it removes, like Empty trash does.
 *
 * Covered: the real `loadData()` (the harness of `bootstrap.startupCleanup.test.ts`)
 * purges the old character and hands it to the real `inlayCleanup.ts`, which
 * deletes the inlay only that character used and keeps the one a remaining
 * character still shows.
 * Stubbed: the save loop. `isSaveClean` is true and `getSaveMarkCount` is 0 from
 * the start, `removeInlayAsset` records its calls, and the lock query answers
 * "this tab only". Nothing here drives a real save loop, so the claim that the
 * deletion waits for a commit that carries the purge rests on the general
 * `isSaveClean` gate, which `inlayCleanup.save.svelte.test.ts` exercises for the
 * other delete paths. Synthetic data only.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'
import { STORAGE_TAB_LOCK_NAME } from 'src/ts/storage/storageTabLocks'

//#region hoisted mutable config

const state = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
    items: new Map<string, Uint8Array>(),
    removed: [] as string[],
}))

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

vi.mock(import('src/ts/storage/loadTimeListing'), () => ({
    recordLoadTimeListing: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/storage/loadTimeListing'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
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
    moduleUpdate: vi.fn(async () => { }),
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
    verifyAssetCacheEntry: vi.fn(async () => ({ status: 'ok' as const })),
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
    removeInlayAsset: vi.fn(async (id: string) => { state.removed.push(id) }),
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
        getItem: vi.fn(async (key: string) => state.items.get(key) ?? null),
        setItem: vi.fn(async () => { }),
        keys: vi.fn(async () => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: vi.fn(async () => { }),
    getDbBackups: vi.fn(async () => []),
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: vi.fn(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
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
    // A page whose first save has committed and which has nothing left to save.
    isSaveClean: vi.fn(() => true),
    getSaveMarkCount: vi.fn(() => 0),
    afterNextSaveCommit: vi.fn(),
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

//#endregion

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

const DAY = 24 * 60 * 60 * 1000
const OLD = 'aaaaaaaa-0000-4000-8000-000000000001'
const RECENT = 'aaaaaaaa-0000-4000-8000-000000000002'

const token = (id: string) => `{{inlayed::${id}}}`

/** Each text is its own message and stays short: the legacy encoder of this suite's environment fails on longer strings. */
function trashedCharacter(chaId: string, ageMs: number, texts: string[]): Record<string, unknown> {
    return {
        chaId,
        name: chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: texts.map((data) => ({ role: 'user', data, time: 1 })), note: '', name: '', localLore: [] }],
        trashTime: Date.now() - ageMs,
    }
}

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
state.baseline = baseDb

async function freshBoot() {
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    injectAppStore(createForageBackedStore(forageStorage as unknown as ForageLike), 'tauri')
    const { loadData } = await import('src/ts/bootstrap')
    const { loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    return { loadData }
}

beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    state.items.clear()
    state.removed.length = 0
    state.db = baseDb()
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => { state.db = { ...state.baseline(), ...data } })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => state.db)
    Object.defineProperty(navigator, 'locks', {
        value: { query: async () => ({ held: [{ name: STORAGE_TAB_LOCK_NAME, mode: 'shared' }], pending: [] }), request: vi.fn() },
        configurable: true,
    })
    vi.spyOn(console, 'info').mockImplementation(() => { })
    vi.stubEnv('VITE_RISU_LEGAL_CONFIGURED', 'TRUE')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe('the boot purge of long-trashed characters', () => {
    test('queues the inlay cleanup of the characters it removes, and keeps what a remaining character still shows', async () => {
        state.items.set('database/database.bin', encodeRisuSaveLegacy({
            ...baseDb(),
            characters: [
                trashedCharacter('old', 4 * DAY, [token(OLD), token(RECENT)]),
                trashedCharacter('recent', DAY / 24, [token(RECENT)]),
            ],
        }))
        const { loadData } = await freshBoot()
        await loadData()

        await vi.waitFor(() => { expect(state.removed).toEqual([OLD]) }, { timeout: 4000, interval: 25 })
        const characters = state.db.characters as Array<{ chaId: string }>
        expect(characters.map((c) => c.chaId)).toEqual(['recent'])
    })
})
