/**
 * `loadData()` in a browser profile on LocalForage when IndexedDB cannot be
 * used: the boot stops with a message and writes nothing, instead of carrying
 * on with the silent fallback driver. The real `bootstrap.ts` runs; the
 * LocalForage module and the storage object are in-memory models, so a passing
 * test here says nothing about a real browser's IndexedDB. Everything else
 * `bootstrap.ts` imports is mocked, as in the sibling bootstrap test files.
 *
 * The first test is the stop itself. The others run with IndexedDB usable and
 * assert the boot's read path through the IndexedDB store: a first launch seeds
 * the main file once, a stored main file boots unwritten, and a zero-length or
 * non-binary value under the main key is never written over.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { language } from 'src/lang'

const MAIN_KEY = 'database/database.bin'

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    indexedDbUsable: true,
    /** What a call to the fallback storage object wrote. */
    fallbackWrites: [] as string[],
    /** What the pinned IndexedDB instance holds. */
    indexedDb: new Map<string, unknown>(),
    indexedDbWrites: [] as string[],
    /** What `getDbBackups` lists. */
    backups: [] as number[],
}))

const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

vi.mock('localforage', () => ({
    default: {
        INDEXEDDB: 'asyncStorage',
        supports: vi.fn(() => world.indexedDbUsable),
        createInstance: vi.fn(() => ({
            ready: vi.fn(async () => {
                if (!world.indexedDbUsable) {
                    throw new Error('No available storage method found.')
                }
            }),
            getItem: vi.fn(async (key: string) => world.indexedDb.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: Uint8Array) => {
                world.indexedDbWrites.push(key)
                world.indexedDb.set(key, value)
            }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => Array.from(world.indexedDb.keys())),
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

// The storage object a LocalForage profile boots on: whatever driver LocalForage
// picked, here an in-memory model that records every write.
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        staleAccountProfile: false,
        realStorage: {},
        Init: vi.fn(async () => { }),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async (key: string) => { world.fallbackWrites.push(key) }),
        keys: vi.fn(async (): Promise<string[]> => []),
        removeItem: vi.fn(async () => { }),
    },
    saveDb: vi.fn(async () => { }),
    getDbBackups: async (): Promise<number[]> => world.backups,
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

function baseDb(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        formatversion: 999,
        characters: [{ chaId: 'a', name: 'A', type: 'character', chats: [] }],
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
dbState.baseline = () => baseDb({ characters: [] })

async function freshLoadData() {
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore, loadedStore }
}

beforeEach(() => {
    localStorage.clear()
    world.indexedDbUsable = true
    world.fallbackWrites.length = 0
    world.indexedDb.clear()
    world.indexedDbWrites.length = 0
    world.backups = []
    dbState.current = baseDb({ characters: [] })
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('loadData() on LocalForage without a usable IndexedDB', () => {
    test('the boot stops with the browser-storage message and writes nothing anywhere', async () => {
        world.indexedDbUsable = false
        const { loadData, loadedStore, alertStore } = await freshLoadData()

        await loadData()

        expect(world.fallbackWrites).toEqual([])
        expect(world.indexedDbWrites).toEqual([])
        expect(get(loadedStore)).toBe(false)
        expect(get(alertStore).type).toBe('error')
        expect(get(alertStore).msg).toBe(language.browserStorageUnavailable)
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('with IndexedDB usable, a first launch seeds the main file once in IndexedDB and the boot proceeds', async () => {
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(world.indexedDbWrites).toEqual([MAIN_KEY])
        expect(world.indexedDb.get(MAIN_KEY)).toBeInstanceOf(Uint8Array)
        expect(get(loadedStore)).toBe(true)
    })

    test('with IndexedDB usable, a stored main file is read from IndexedDB and boots as the tree it holds, unwritten', async () => {
        world.indexedDb.set(MAIN_KEY, encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'stored', name: 'S', type: 'character', chats: [] }] })))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect((setDatabaseMock.mock.calls[0][0].characters as { chaId: string }[]).map((c) => c.chaId)).toEqual(['stored'])
        expect(world.indexedDbWrites).toEqual([])
    })

    test.each([
        ['a zero-length value', new Uint8Array(0)],
        ['a stored value that is not bytes', 'not a save file'],
    ])('%s under the main key is never written over: the newest decodable backup is installed', async (_title, value) => {
        world.indexedDb.set(MAIN_KEY, value)
        world.indexedDb.set('database/dbbackup-1.bin', encodeRisuSaveLegacy(baseDb({ characters: [{ chaId: 'old', name: 'O', type: 'character', chats: [] }] })))
        world.backups = [1]
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(world.indexedDbWrites).toEqual([])
        expect(world.indexedDb.get(MAIN_KEY)).toBe(value)
        expect(get(loadedStore)).toBe(true)
        expect((setDatabaseMock.mock.calls[0][0].characters as { chaId: string }[]).map((c) => c.chaId)).toEqual(['old'])
    })
})
