/**
 * `loadData()` on Tauri: how the boot reads the main file and the numbered
 * backups, and what it writes. The real `bootstrap.ts` runs against the
 * in-memory Tauri file system in `storage/tests/tauriFsFake.ts` at the plugin
 * boundary; a `fetch` stub serves the same files by URL, so the same assertions
 * run whichever route the boot reads through. `risuSave.ts` is real, everything
 * else `bootstrap.ts` imports is mocked, and the boot archive pass is mocked at
 * its boundary. `bootstrap.ts` reads `isTauri` once at module load, so this
 * file keeps `isTauri: true` throughout.
 *
 * Tests titled `guard:` assert behaviour that must not change. The others
 * assert behaviour the contract-based boot has. A passing test here says
 * nothing about the native Tauri file API.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'

const MAIN = 'database/database.bin'

const existsDenied = new Set<string>()

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))

// A plain function, not a spy: a spy attaches a handler to the promise it
// returns, which would hide a rejection nobody handles.
const dbBackups = vi.hoisted(() => ({ list: async (): Promise<number[]> => [] }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const convertFileSrcMock = vi.hoisted(() => vi.fn((p: string) => p))

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

vi.mock(import('src/ts/desktopLaunch'), () => ({
    desktopLaunchImport: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/desktopLaunch'))

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

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: convertFileSrcMock }))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({ maximize: vi.fn(async () => { }) })),
}))

// `exists` answers false for any path whose metadata lookup fails, so a test can
// make it deny one path while the file system still holds it.
vi.mock('@tauri-apps/plugin-fs', () => ({
    ...fakeFs.module,
    exists: async (path: string) => !existsDenied.has(path.replace(/^\.\//, '')) && await fakeFs.module.exists(path),
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
    getDbBackups: () => dbBackups.list(),
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

function dbWith(chaId: string): Record<string, unknown> {
    return baseDb({ characters: [{ chaId, name: chaId.toUpperCase(), type: 'character', chats: [] }] })
}

/** Puts the directories the boot checks in place; a main file is added by the test. */
function armDirectories(): void {
    fakeFs.directories.add('database')
    fakeFs.directories.add('assets')
}

function armMain(bytes: Uint8Array): Uint8Array {
    armDirectories()
    fakeFs.plant(MAIN, bytes)
    return bytes
}

function armBackup(n: number, db: Record<string, unknown>): void {
    fakeFs.plant(`database/dbbackup-${n}.bin`, encodeRisuSaveLegacy(db))
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

function hex(bytes: Uint8Array | undefined): string | undefined {
    return bytes ? Buffer.from(bytes).toString('hex') : undefined
}

const unhandled: unknown[] = []
function onUnhandled(reason: unknown): void {
    unhandled.push(reason)
}

beforeEach(() => {
    localStorage.clear()
    fakeFs.reset()
    existsDenied.clear()
    unhandled.length = 0
    dbState.current = baseDb({ characters: [] })
    dbBackups.list = async () => []
    convertFileSrcMock.mockClear()
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        const bytes = fakeFs.files.get(url.replace(/^\/appdata\//, ''))
        return bytes ? new Response(bytes.slice()) : new Response(null, { status: 404 })
    }))
    process.on('unhandledRejection', onUnhandled)
    vi.resetModules()
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.unstubAllGlobals()
})

describe('loadData() on Tauri: the main file and backup reads', () => {
    test('guard: a stored main file boots as the tree it holds and is not rewritten', async () => {
        const bytes = armMain(encodeRisuSaveLegacy(dbWith('stored')))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['stored'])
        expect(hex(fakeFs.files.get(MAIN))).toBe(hex(bytes))
        expect(fakeFs.renameLog).toEqual([])
    })

    test('the main file reaches the decoder without an asset-protocol URL', async () => {
        armMain(encodeRisuSaveLegacy(dbWith('stored')))
        const { loadData } = await freshLoadData()

        await loadData()

        expect(installedCharacterIds()[0]).toEqual(['stored'])
        expect(convertFileSrcMock).not.toHaveBeenCalled()
    })

    test('a backup read after an undecodable main file reaches the decoder without an asset-protocol URL', async () => {
        armMain(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
        armBackup(1, dbWith('old'))
        dbBackups.list = async () => [1]
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['old'])
        expect(convertFileSrcMock).not.toHaveBeenCalled()
    })

    test('guard: an absent main file is seeded once and the boot proceeds on the seed', async () => {
        armDirectories()
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(get(loadedStore)).toBe(true)
        expect(fakeFs.files.has(MAIN)).toBe(true)
        expect(fakeFs.renameLog.filter((entry) => entry.to.endsWith(MAIN))).toHaveLength(1)
    })

    test('guard: a zero-length main file is never written over: the newest decodable backup is installed', async () => {
        armMain(new Uint8Array(0))
        armBackup(1, dbWith('old'))
        dbBackups.list = async () => [1]
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(fakeFs.renameLog).toEqual([])
        expect(fakeFs.files.get(MAIN)?.length).toBe(0)
        expect(get(loadedStore)).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['old'])
    })

    test('a main file that cannot be read for a reason other than being absent is not replaced by a seed; the newest backup is installed', async () => {
        const bytes = armMain(encodeRisuSaveLegacy(dbWith('stored')))
        armBackup(1, dbWith('old'))
        dbBackups.list = async () => [1]
        // `exists` answers false for anything that stops the metadata lookup, and
        // the read is refused with an error that does not say "absent".
        fakeFs.failReadFiles('Access is denied. (os error 5)', (path) => path.endsWith(MAIN))
        existsDenied.add(MAIN)
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()

        expect(hex(fakeFs.files.get(MAIN))).toBe(hex(bytes))
        expect(fakeFs.renameLog.filter((entry) => entry.to.endsWith(MAIN))).toHaveLength(0)
        expect(get(loadedStore)).toBe(true)
        expect(installedCharacterIds()[0]).toEqual(['old'])
    })

    test('a numbered-backup listing that fails during the boot read does not become an unhandled rejection', async () => {
        armMain(encodeRisuSaveLegacy(dbWith('stored')))
        dbBackups.list = () => Promise.reject(new Error('listing failed'))
        const { loadData, loadedStore } = await freshLoadData()

        await loadData()
        await new Promise((resolve) => setTimeout(resolve, 20))

        expect(get(loadedStore)).toBe(true)
        expect(unhandled).toEqual([])
    })
})
