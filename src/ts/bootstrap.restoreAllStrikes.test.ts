/**
 * `loadData()`'s handling of the crash-loop count of the V2.1 restore of every
 * archived character (the raw `localStorage` key `v21RestoreAllStrikes`),
 * non-Tauri branch: the real `bootstrap.ts` with `loadPlugins` mocked at its
 * boundary. A plugin restore that was interrupted leaves the count behind; the
 * count only matters while a V2.1 plugin is enabled, so a boot whose installed
 * database has none clears it before `loadPlugins` runs. A boot whose installed
 * database still has an enabled V2.1 plugin leaves it alone, because the
 * breaker's switch-off reaches the main file only with a later save: the next
 * boot must still see the count and switch the plugin off again.
 *
 * `risuSave.ts` and `bootArchiveMemo.ts` are real and `localStorage` is the
 * happy-dom one. The mocked `loadPlugins` records the raw count at the moment
 * it is called. The boot archive pass module is mocked at its boundary, as in
 * `bootstrap.archiveMemo.test.ts`, and everything else `bootstrap.ts` imports is
 * mocked. The Tauri branch is not driven here.
 *
 * Tests titled `guard:` assert behaviour that must not change; they pass with
 * and without the clear. The others assert the clear itself.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import { createForageBackedStore, type ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const MAIN_KEY = 'database/database.bin'
const STRIKES_KEY = 'v21RestoreAllStrikes'

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const world = vi.hoisted(() => ({
    items: new Map<string, Uint8Array>(),
    /** The raw count at each call of `loadPlugins`. */
    countAtLoadPlugins: [] as (string | null)[],
}))

interface RunInput { tree: Record<string, unknown> }

const getDbBackupsMock = vi.hoisted(() => vi.fn(async (): Promise<number[]> => []))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))

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
    loadPlugins: vi.fn(async () => { world.countAtLoadPlugins.push(localStorage.getItem('v21RestoreAllStrikes')) }),
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
    noteMainFileBytes: vi.fn((_bytes: Uint8Array): void => { }),
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
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: vi.fn(async () => ({
        canArchive: true,
        reloading: false,
        run: vi.fn(async (input: RunInput) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] })),
        release: vi.fn(async () => { }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

const { encodeRisuSaveLegacy } = await import('src/ts/storage/risuSave')

function plugin(name: string, version: string | number, enabled: boolean): Record<string, unknown> {
    return { name, script: '', version, enabled, arguments: {}, realArg: {}, customLink: [], argMeta: {} }
}

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
const defaultBaseline = () => baseDb({ characters: [] })
dbState.baseline = defaultBaseline

function armLegacy(db: Record<string, unknown> = baseDb()): void {
    world.items.set(MAIN_KEY, encodeRisuSaveLegacy(db))
}

async function bootOnce(): Promise<void> {
    vi.resetModules()
    // The boot reads through the page's byte store; here it is the storage-object model above.
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
    await loadData()
}

const PASS_KEYS = {
    archivePassStrikes: '1',
    archivePassSkipped: '["x"]',
    archivePassTooLarge: '1',
    archivePassPausedTold: '1',
} as const

function seedPassAndUnrelatedKeys(): void {
    for (const [key, value] of Object.entries(PASS_KEYS)) {
        localStorage.setItem(key, value)
    }
    localStorage.setItem('unrelated-key', 'kept')
}

function passAndUnrelatedKeys(): Record<string, string | null> {
    return Object.fromEntries([...Object.keys(PASS_KEYS), 'unrelated-key'].map((key) => [key, localStorage.getItem(key)]))
}

beforeEach(() => {
    localStorage.clear()
    world.items.clear()
    world.countAtLoadPlugins.length = 0
    dbState.baseline = defaultBaseline
    dbState.current = defaultBaseline()
    getDbBackupsMock.mockReset().mockResolvedValue([])
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('loadData() web: the restore-all count is cleared before loadPlugins when the installed database has no enabled V2.1 plugin', () => {
    test.each([
        ['has no plugin list', {}],
        ['has an empty plugin list', { plugins: [] }],
        ['has only a disabled V2.1 plugin', { plugins: [plugin('Idle Relay', '2.1', false)] }],
        ['has only enabled V2.0 and V3 plugins', { plugins: [plugin('removed-v2', 2, true), plugin('Modern Add-on', '3.0', true)] }],
    ] as const)('a database that %s: a count of 2 is 0 when loadPlugins is called, and the archive pass records and unrelated keys are untouched', async (_label, extra) => {
        armLegacy(baseDb(extra))
        seedPassAndUnrelatedKeys()
        localStorage.setItem(STRIKES_KEY, '2')

        await bootOnce()

        expect(world.countAtLoadPlugins).toEqual(['0'])
        expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
        expect(passAndUnrelatedKeys()).toEqual({ ...PASS_KEYS, 'unrelated-key': 'kept' })
    })

    test('a count of 1 is cleared the same way', async () => {
        armLegacy(baseDb({ plugins: [plugin('Idle Relay', '2.1', false)] }))
        localStorage.setItem(STRIKES_KEY, '1')

        await bootOnce()

        expect(world.countAtLoadPlugins).toEqual(['0'])
    })

    test('the decision reads the installed database, not the database that was there before the install', async () => {
        dbState.baseline = () => baseDb({ characters: [], plugins: [plugin('Quill Bridge', '2.1', true)] })
        dbState.current = dbState.baseline()
        armLegacy(baseDb({ plugins: [plugin('Quill Bridge', '2.1', false)] }))
        localStorage.setItem(STRIKES_KEY, '2')

        await bootOnce()

        expect(world.countAtLoadPlugins).toEqual(['0'])
    })

    test('guard: a profile that never had the key does not get it written, and a stored 0 is not rewritten', async () => {
        armLegacy(baseDb())
        const writes: string[] = []
        const realSet = localStorage.setItem.bind(localStorage)
        const realRemove = localStorage.removeItem.bind(localStorage)
        const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
            if (key === STRIKES_KEY) { writes.push(`set ${value}`) }
            realSet(key, value)
        })
        const removeSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation((key: string) => {
            if (key === STRIKES_KEY) { writes.push('remove') }
            realRemove(key)
        })
        try {
            await bootOnce()
            expect(world.countAtLoadPlugins).toEqual([null])
            expect(localStorage.getItem(STRIKES_KEY)).toBeNull()

            realSet(STRIKES_KEY, '0')
            await bootOnce()
            expect(world.countAtLoadPlugins).toEqual([null, '0'])
            expect(localStorage.getItem(STRIKES_KEY)).toBe('0')
            expect(writes).toEqual([])
        } finally {
            // An instance spy outlives `vi.restoreAllMocks()`, so it is restored here.
            setSpy.mockRestore()
            removeSpy.mockRestore()
        }
    })
})

describe('loadData() web: the restore-all count is kept while an enabled V2.1 plugin is in the installed database', () => {
    test.each(['1', '2'])('guard: a count of %s is the same when loadPlugins is called, so a switch-off that was never saved trips again', async (stored) => {
        armLegacy(baseDb({ plugins: [plugin('Quill Bridge', '2.1', true), plugin('Modern Add-on', '3.0', true)] }))
        localStorage.setItem(STRIKES_KEY, stored)

        await bootOnce()

        expect(world.countAtLoadPlugins).toEqual([stored])
        expect(localStorage.getItem(STRIKES_KEY)).toBe(stored)
    })

    test('guard: turning "Archive characters at startup" off clears the archive pass records and leaves the count of an enabled V2.1 plugin', async () => {
        armLegacy(baseDb({ archiveCharacters: false, plugins: [plugin('Quill Bridge', '2.1', true)] }))
        seedPassAndUnrelatedKeys()
        localStorage.setItem(STRIKES_KEY, '2')

        await bootOnce()

        expect(world.countAtLoadPlugins).toEqual(['2'])
        expect(localStorage.getItem(STRIKES_KEY)).toBe('2')
        expect(passAndUnrelatedKeys()).toEqual({
            archivePassStrikes: null,
            archivePassSkipped: null,
            archivePassTooLarge: null,
            archivePassPausedTold: null,
            'unrelated-key': 'kept',
        })
    })
})
