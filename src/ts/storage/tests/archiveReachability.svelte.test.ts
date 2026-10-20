/**
 * The legacy archive writers are unreachable on a store2 page. The real `loadData()` boots a store2
 * profile through the real dispatch (its characters open as stubs and a residency is registered), the
 * real put-back starts, the selection moves and the save loop reports a commit; through all of it the
 * boot archive session is never opened, the character archive never writes and the re-archive engine
 * never starts. The three are behavioural spies on the modules' exports, not source-text checks.
 *
 * The archive gate is asserted as well, with a database that would otherwise pass every other gate
 * (`archiveCharacters` on, a block-format version): the one thing that keeps `archiveMayRun()` closed
 * on this page is the boot's `noteBootArchiveSession(false)`.
 *
 * Label: compatibility guard (passes on the base commit and after, because the store2 boot already
 * starts none of the three). Mutants it catches: `noteBootArchiveSession(true)` in the store2 boot,
 * which opens the gate (only the gate assertion fails; the spies stay quiet since the re-archive engine
 * is not started on a store2 page either way, and the card import that the mutant would make reachable
 * is covered by `characterCards.store2Import.test.ts`); the store2 boot also opening a boot archive
 * session (the `openBootArchiveSession` spy); and the put-back starting the re-archive engine on a
 * store2 page (the `startCharacterRearchive` spy).
 *
 * The mocked page store and backend say nothing about a native one.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend } from 'src/ts/storage/store2/backend'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import type { Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import { buildSmall, fakeLists } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, seedTree, testEnv, createPeerDouble } from 'src/ts/storage/tests/store2SaveKit'
import type { Database } from 'src/ts/storage/database.svelte'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
}))

const spies = vi.hoisted(() => ({
    openBootArchiveSession: vi.fn(),
    archiveCharacterNow: vi.fn(),
    startCharacterRearchive: vi.fn(),
    putBackStarted: vi.fn(),
    commitCallbacks: [] as Array<() => void>,
}))

const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))

//#endregion

//#region module mocks, those of bootstrap.store2.svelte.test.ts except the put-back, which is real here

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
    getDatabase: getDatabaseMock,
    setDatabase: setDatabaseMock,
    defaultSdDataFunc: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { get db() { return dbState.current } },
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
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

vi.mock(import('src/ts/storage/startupCleanupState'), async (importOriginal) => ({
    ...await importOriginal(),
    recordStartupCleanup: vi.fn(),
}))

vi.mock(import('src/ts/storage/bootArchivePass'), () => ({
    openBootArchiveSession: spies.openBootArchiveSession,
    disabledBootArchiveSession: vi.fn(() => ({
        canArchive: false,
        run: async (input: { tree: unknown }) => ({ kind: 'install', tree: input.tree, noteBytes: null, notices: [] }),
        release: vi.fn(async () => { }),
    })),
    checkCommittedBlocks: vi.fn(async () => ({ ok: true })),
}) as unknown as typeof import('src/ts/storage/bootArchivePass'))

vi.mock(import('src/ts/process/coldCharacterArchive'), async (importOriginal) => ({
    ...await importOriginal(),
    archiveCharacterNow: spies.archiveCharacterNow,
}))

vi.mock(import('src/ts/process/memory/characterRearchive'), async (importOriginal) => ({
    ...await importOriginal(),
    startCharacterRearchive: spies.startCharacterRearchive,
}))

vi.mock(import('src/ts/process/memory/characterPutBack'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        startCharacterPutBack: (...args: Parameters<typeof original.startCharacterPutBack>) => {
            spies.putBackStarted()
            return original.startCharacterPutBack(...args)
        },
    }
})

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
    takeStorageFallbackNotice: () => null,
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
    saveDb: saveDbMock,
    getDbBackups: vi.fn(async (): Promise<number[]> => []),
    buildAssetKeepSet: vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })),
    getBasename: (p: string) => p.split('/').pop(),
    setUsingSw: vi.fn(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    // The save loop's commit is the callbacks run by `commit()` below.
    afterNextSaveCommit: (callback: () => void) => { spies.commitCallbacks.push(callback) },
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

function uiDouble(): Store2BootUi {
    const notices: Store2BootNotice[] = []
    return {
        peer: createPeerDouble(),
        notice(notice) { notices.push(notice) },
        async blocked() { },
        async offerRestoreOrImport() { return 'import' },
        async confirmConvert() { return true },
        async declined() { return 'import' },
        async confirmConvertWithout() { return 'decline' },
        async confirmFromBackup() { return 'convert' },
        async confirmIncomplete() { return true },
        async confirmFlaggedOpen() { return 'continue' },
        async foreignMarker() { return 'wait' },
        async recovery() { },
    }
}

function legacyStore(): MemoryByteStore {
    const store = createMemoryByteStore()
    store.files.set('database/database.bin', encodeRisuSaveLegacy(baseDb()))
    return store
}

async function bootStore2Page(kind: AppStoreKind): Promise<() => Promise<void>> {
    const store = legacyStore()
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(store, kind)
    const backend = createMemoryBackend()
    const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
    const { dispatchStore2Boot } = await import('src/ts/storage/store2/bootDispatch')
    registerStore2Boot((env) => dispatchStore2Boot(env, {
        ui: uiDouble(),
        kind,
        backend: async () => backend,
        keyEnv: testEnv(createClock(), 9001),
        lists: fakeLists,
    }))
    await seedTree(backend, JSON.parse(JSON.stringify(buildSmall(2))) as Database, testEnv(createClock(), 4242), fakeLists)
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.subscribe((value) => {
        if (value.type === 'normal') {
            queueMicrotask(() => alertStore.set({ type: 'none', msg: '' }))
        }
    })
    return loadData
}

beforeEach(() => {
    localStorage.clear()
    platformState.isTauri = false
    platformState.isNodeServer = false
    spies.openBootArchiveSession.mockReset()
    spies.archiveCharacterNow.mockReset()
    spies.startCharacterRearchive.mockReset()
    spies.putBackStarted.mockReset()
    spies.commitCallbacks.length = 0
    saveDbMock.mockReset().mockResolvedValue(undefined)
    dbState.current = baseDb()
    setDatabaseMock.mockClear()
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => {
        // A database that passes every archive gate but the session's: the setting on and a block-format version.
        dbState.current = { ...baseDb(), ...data, archiveCharacters: true, formatversion: 999, plugins: [] }
    })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

/** The save loop's commit: runs what the put-back registered for the next one. */
function commit(): void {
    const callbacks = spies.commitCallbacks.splice(0)
    for (const callback of callbacks) {
        callback()
    }
}

describe('a store2 page never reaches the legacy archive writers', () => {
    test.each([['indexeddb'], ['tauri']] as const)('boot, selection and commit open no archive session, archive no character and start no re-archive engine (%s)', async (kind) => {
        platformState.isTauri = kind === 'tauri'
        const loadData = await bootStore2Page(kind)

        await loadData()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))

        const { loadedStore, selectedCharID } = await import('src/ts/stores.svelte') as unknown as {
            loadedStore: ReturnType<typeof writable<boolean>>
            selectedCharID: ReturnType<typeof writable<number>>
        }
        expect(get(loadedStore)).toBe(true)
        const { getResidency } = await import('src/ts/storage/store2/residencyActive')
        expect(getResidency(), 'positive control: this is a store2 page').not.toBeNull()
        expect(spies.putBackStarted, 'positive control: the boot started the real put-back').toHaveBeenCalledTimes(1)

        selectedCharID.set(0)
        commit()
        selectedCharID.set(1)
        commit()
        selectedCharID.set(-1)
        commit()

        expect(spies.openBootArchiveSession).not.toHaveBeenCalled()
        expect(spies.archiveCharacterNow).not.toHaveBeenCalled()
        expect(spies.startCharacterRearchive).not.toHaveBeenCalled()
        const { archiveMayRun } = await import('src/ts/process/archiveGate')
        expect(archiveMayRun(), 'the boot leaves the archive gate closed').toBe('unavailable')
    })
})
