/**
 * `loadData()` on the self-hosted Node server: how the boot reads the main
 * file and what it writes. The real `bootstrap.ts` runs over the real
 * `NodeStorage` or Node store, whichever the boot uses, against the
 * `FakeNodeServer` stand-in at the `fetch` boundary, so the same assertions run
 * whichever client class the boot reads through. `risuSave.ts` is real;
 * everything else `bootstrap.ts` imports is mocked, as in the sibling bootstrap
 * test files, and the boot archive pass is mocked at its boundary.
 *
 * Tests titled `guard:` assert behaviour that must not change. The others
 * assert behaviour the contract-based boot has. A passing test here is about the
 * request sequence the boot makes; it says nothing about the real server.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { FakeNodeServer } from 'src/ts/storage/tests/manualCleanupHarness'

const MAIN_KEY = 'database/database.bin'

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    storage: null as unknown,
}))

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
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
    isTauri: false,
    isNodeServer: true,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
    getKeypairStore: vi.fn(async () => {
        keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
    base64url: (b: Uint8Array) => Buffer.from(b).toString('base64url'),
    asBuffer: (v: Uint8Array) => Buffer.from(v),
}) as unknown as typeof import('src/ts/util'))

let keyPair: CryptoKeyPair | null = null

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
            get realStorage() { return world.storage },
            Init: vi.fn(async () => { }),
            getItem: (key: string) => storage().getItem(key),
            setItem: (key: string, value: Uint8Array) => storage().setItem(key, value),
            keys: () => storage().keys(),
            removeItem: (key: string) => storage().removeItem(key),
        },
        saveDb: vi.fn(async () => { }),
        getDbBackups: getDbBackupsMock,
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

let server: FakeNodeServer

function dbWith(chaId: string): Record<string, unknown> {
    return baseDb({ characters: [{ chaId, name: chaId.toUpperCase(), type: 'character', chats: [] }] })
}

function mainWrites() {
    return server.requestsTo('/api/write').filter((request) => Buffer.from(request.headers['file-path'] ?? '', 'hex').toString('utf-8') === MAIN_KEY)
}

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

function installedCharacterIds(): string[][] {
    return setDatabaseMock.mock.calls.map((call) => (call[0].characters as { chaId: string }[]).map((c) => c.chaId))
}

beforeEach(async () => {
    localStorage.clear()
    keyPair = null
    dbState.current = baseDb({ characters: [] })
    getDbBackupsMock.mockReset().mockResolvedValue([])
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

describe('loadData() on the Node server: the main file read', () => {
    test('guard: a stored main file boots as the tree it holds and is not written', async () => {
        server.seed(MAIN_KEY, encodeRisuSaveLegacy(dbWith('stored')))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['stored'])
        expect(mainWrites()).toHaveLength(0)
    })

    test('guard: an absent main file is seeded once, conditional on the revision the read reported, and the boot proceeds', async () => {
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        const writes = mainWrites()
        expect(writes).toHaveLength(1)
        expect(writes[0].headers['if-match-revision']).toBe('0')
        expect(server.files.has(MAIN_KEY)).toBe(true)
    })

    test('guard: when another tab seeds first, the second tab\'s seed is refused and its boot fails with the error shown', async () => {
        const peerFile = encodeRisuSaveLegacy(dbWith('peer'))
        server.beforeRequest = (path, headers) => {
            if (path === '/api/write' && Buffer.from(headers['file-path'] ?? '', 'hex').toString('utf-8') === MAIN_KEY) {
                server.beforeRequest = undefined
                server.peerWrite(MAIN_KEY, peerFile)
            }
        }
        const { loadData, loadedStore, alertStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(false)
        expect(get(alertStore).type).toBe('error')
        expect(Array.from(server.files.get(MAIN_KEY)?.bytes ?? [])).toEqual(Array.from(peerFile))
    })

    test('a zero-length main file is never written over: the newest decodable backup is installed', async () => {
        server.seed(MAIN_KEY, new Uint8Array(0))
        server.seed('database/dbbackup-1.bin', encodeRisuSaveLegacy(dbWith('old')))
        getDbBackupsMock.mockResolvedValue([1])
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(mainWrites()).toHaveLength(0)
        expect(server.files.get(MAIN_KEY)?.bytes.length).toBe(0)
        expect(get(loadedStore)).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['old'])
    })

    test('a zero-length main file with no decodable backup fails the boot with the error shown and writes nothing', async () => {
        server.seed(MAIN_KEY, new Uint8Array(0))
        const { loadData, loadedStore, alertStore } = await freshLoadData()

        await loadData()

        expect(mainWrites()).toHaveLength(0)
        expect(server.files.get(MAIN_KEY)?.bytes.length).toBe(0)
        expect(get(loadedStore)).toBe(false)
        expect(get(alertStore).type).toBe('error')
        expect(installedCharacterIds()).toEqual([])
    })

    test('guard: a main-file read that fails is never answered by a seed; the boot fails with the error shown', async () => {
        server.seed(MAIN_KEY, encodeRisuSaveLegacy(dbWith('stored')))
        server.readFailures.add(MAIN_KEY)
        const { loadData, loadedStore, alertStore } = await freshLoadData()

        await loadData()

        expect(mainWrites()).toHaveLength(0)
        expect(get(loadedStore)).toBe(false)
        expect(get(alertStore).type).toBe('error')
    })
})
