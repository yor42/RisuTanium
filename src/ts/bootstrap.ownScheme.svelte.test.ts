/**
 * The parked-reply question that `loadData()` (`src/ts/bootstrap.ts`) installs on an Android page carries
 * `ownScheme: 'saveGuard'`: the page asks it through `askPrompt` once the reconcile finds a parked reply. The harness
 * is the one of `bootstrap.liveGate.svelte.test.ts` (a real dispatch over an in-memory store, a mocked
 * `globalApi.svelte`), with the Android transport switched on and the native reply modules replaced by recorders, so
 * the installed asker can be called. Compatibility guard: the flag is new, so nothing here fails for a defect that
 * existed before it.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { registerRealDispatch, stopAcknowledgingAlerts } from 'src/ts/tests/realDispatchBoot.test-helpers'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'
import type { alertData } from 'src/ts/alert'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const sleepForeverMock = vi.hoisted(() => vi.fn(async () => { }))
const putBackMock = vi.hoisted(() => vi.fn())
/** The asker `startNativeReply` installs, as the parked-reply module received it. */
const parkedAsker = vi.hoisted(() => ({ current: null as null | ((reply: { name: string, text: string }) => Promise<'discard' | 'later'>) }))

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

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => true,
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))

vi.mock(import('src/ts/nativeReply/parkedDialog'), () => ({
    setParkedReplyAsker: (asker: typeof parkedAsker.current) => { parkedAsker.current = asker },
    showParkedReplies: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/nativeReply/parkedDialog'))

vi.mock(import('src/ts/nativeReply/pageState'), () => ({
    configurePageState: vi.fn(),
    requestReconcile: vi.fn(),
    setReconcileTrigger: vi.fn(),
}) as unknown as typeof import('src/ts/nativeReply/pageState'))

vi.mock(import('src/ts/nativeReply/reconcile'), () => ({
    createReconciler: vi.fn(() => ({ reportUnreadable: vi.fn(), request: vi.fn(async () => { }) })),
    recoveredText: vi.fn(),
}) as unknown as typeof import('src/ts/nativeReply/reconcile'))

vi.mock(import('src/ts/nativeReply/store'), () => ({
    createReplyStore: vi.fn(() => ({ discard: vi.fn() })),
}) as unknown as typeof import('src/ts/nativeReply/store'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(async () => { }),
    checkNullish: (v: unknown) => v === null || v === undefined,
    sleep: vi.fn(async () => { }),
    sleepForever: sleepForeverMock,
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

vi.mock(import('src/ts/gui/colorschemeCore'), async (importOriginal) => ({
    ...(await importOriginal()),
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorschemeCore'))

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

vi.mock(import('src/ts/process/memory/characterPutBack'), () => ({
    startCharacterPutBack: putBackMock,
}) as unknown as typeof import('src/ts/process/memory/characterPutBack'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' as const })),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

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
    checkCharOrder: vi.fn(),
    getUncleanablesSync: vi.fn((): string[] => []),
    AppendableBuffer: class {
        chunks: Uint8Array[] = []
        append(chunk: Uint8Array) { this.chunks.push(chunk) }
        get buffer() { return new Uint8Array() }
    },
    requiresFullEncoderReload: { state: false },
    fetchNative: vi.fn(async () => new Response(null, { status: 404 })),
    getCommittedSaveMarkCount: vi.fn(() => 0),
    getSaveMarkCount: vi.fn(() => 0),
    characterCommitVerdict: vi.fn(),
    afterNextSaveCommit: vi.fn(),
    markCharacterForSave: vi.fn(),
    requestSaveNow: vi.fn(),
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
dbState.baseline = baseDb

/** Boots a converted store2 profile on a page whose transport is Android, and returns the shared alert store. */
async function bootAndroid() {
    platformState.isTauri = false
    const store: MemoryByteStore = createMemoryByteStore()
    store.files.set('database/database.bin', encodeRisuSaveLegacy({ ...baseDb(), modules: [{ id: 'ida', name: 'Module ida', description: '', lorebook: [], regex: [], trigger: [], assets: [] }] }))
    const unused = async () => { throw new Error('not used') }
    store.guarded = { probe: async () => ({ checkOnly: true, retire: true, pieces: false }), writeChecked: unused, removeChecked: unused, retireChecked: unused }
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(store, 'node')
    await registerRealDispatch({ kind: 'node', acknowledgeAlerts: true })
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<alertData>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, alertStore }
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
afterEach(async () => {
    const { resetToastHostForTests } = await import('src/ts/toast/toastHost.svelte')
    resetToastHostForTests()
})

beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    platformState.isTauri = false
    platformState.isNodeServer = true
    parkedAsker.current = null
    saveDbMock.mockReset().mockResolvedValue(undefined)
    sleepForeverMock.mockReset().mockResolvedValue(undefined)
    putBackMock.mockReset()
    dbState.current = baseDb()
    setDatabaseMock.mockReset().mockImplementation((data: Record<string, unknown>) => {
        dbState.current = { ...dbState.baseline(), ...data }
    })
    getDatabaseMock.mockReset().mockImplementation(() => dbState.current)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(async () => {
    stopAcknowledgingAlerts()
    const { resetAlertPromptsForTests } = await import('src/ts/alertPrompts')
    resetAlertPromptsForTests()
    vi.unstubAllGlobals()
})

describe('loadData(): the parked-reply question', () => {
    test('the installed asker raises a parkedReply alert with the save-guard flag, and Discard answers discard', async () => {
        const run = await bootAndroid()
        await run.loadData()
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        const asker = parkedAsker.current
        expect(asker, 'an Android page installs the parked-reply asker').not.toBeNull()

        const answered = asker!({ name: 'Mira', text: 'a reply the page never saw' })
        await vi.waitFor(() => expect(get(run.alertStore).type).toBe('parkedReply'))
        const shown = get(run.alertStore)
        expect(shown.ownScheme).toBe('saveGuard')
        expect(shown.parkedReply).toEqual({ name: 'Mira', text: 'a reply the page never saw' })

        const { ANSWER_GUARD_MS } = await import('src/ts/alertPrompts')
        await new Promise<void>((resolve) => setTimeout(resolve, ANSWER_GUARD_MS + 40))
        run.alertStore.set({ type: 'none', msg: 'discard' })
        expect(await answered).toBe('discard')
    })
})
