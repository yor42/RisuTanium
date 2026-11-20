/**
 * `loadData()` (`src/ts/bootstrap.ts`) fails closed before the page goes live: after the dispatch answered and the profile
 * was installed, the page storage mode and the active store2 save must agree (a `store2` page holds its active save, or the
 * page is `read-only`). A page in any other state reports an error, posts no boot notice, never sets `loadedStore` and
 * never starts the save loop. The disagreement is injected into the real dispatch's answer, the only shape of a dispatch
 * in the tree that is not production, and every row asserts failure.
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { writable, get } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { registerRealDispatch, stopAcknowledgingAlerts } from 'src/ts/tests/realDispatchBoot.test-helpers'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'

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

type AlertValue = { type: string, msg: string }

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

/** What the dispatch's answer is made to disagree about, applied after the real dispatch answered `store2`. */
type Fault = 'none' | 'no-active-save' | 'mode-unset'

interface Run {
    loadData: () => Promise<void>
    loadedStore: ReturnType<typeof writable<boolean>>
    /** Every non-`none` value written to the alert store, recorded at write time, so an alert a later alert covered is still in it. */
    alerts: AlertValue[]
    alertStore: ReturnType<typeof writable<AlertValue>>
    /** The `normal` notices the boot posted and the dispatch acknowledged while on screen; a notice a cover replaced first is not in it, so an absence check reads `alerts`. */
    notices: string[]
}

/** A legacy profile the real dispatch converts to a store2 profile; the fault is injected into its answer. */
async function boot(tauri: boolean, fault: Fault): Promise<Run> {
    platformState.isTauri = tauri
    const store: MemoryByteStore = createMemoryByteStore()
    // A module makes the profile one the archive notice is told to; an empty profile is switched on without it.
    store.files.set('database/database.bin', encodeRisuSaveLegacy({ ...baseDb(), modules: [{ id: 'ida', name: 'Module ida', description: '', lorebook: [], regex: [], trigger: [], assets: [] }] }))
    const kind = tauri ? 'tauri' : 'indexeddb'
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(store, kind)
    const dispatch = await registerRealDispatch({ kind, acknowledgeAlerts: true })
    const { getStore2Boot, registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
    const real = getStore2Boot()
    if (real === null) {
        throw new Error('the real dispatch was not registered')
    }
    registerStore2Boot(async (env) => {
        const result = await real(env)
        expect(result.kind, 'the real dispatch converts the legacy profile').toBe('store2')
        if (fault === 'no-active-save') {
            const { resetStore2SaveForTest } = await import('src/ts/storage/store2/saveActive')
            resetStore2SaveForTest()
        } else if (fault === 'mode-unset') {
            const { setPageStorageMode } = await import('src/ts/storage/pageStorageMode')
            setPageStorageMode({ kind: 'unset' })
        }
        return result
    })
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<AlertValue>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    const alerts: AlertValue[] = []
    alertStore.subscribe((value) => {
        if (value.type !== 'none') {
            alerts.push({ type: value.type, msg: value.msg })
        }
    })
    return { loadData, loadedStore, alerts, alertStore, notices: dispatch.shownAlerts }
}

async function settle(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    platformState.isTauri = false
    platformState.isNodeServer = false
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
    // A notice queued and then covered stays current in its graph's queue; on the shared alert store it would be
    // re-shown, and acknowledged, during a later test.
    const { resetAlertPromptsForTests } = await import('src/ts/alertPrompts')
    resetAlertPromptsForTests()
    vi.unstubAllGlobals()
})

describe('loadData(): the live gate (T2-LIVE)', () => {
    test.each([[false], [true]])('control: with no fault the converted profile goes live and posts its notice (Tauri: %s)', async (tauri) => {
        const run = await boot(tauri, 'none')

        await run.loadData()
        await settle()

        expect(get(run.loadedStore)).toBe(true)
        expect(run.alerts.filter(alert => alert.type === 'error')).toEqual([])
        expect(run.notices.length, 'a notice is posted on a page that goes live, so "no notice" below is not vacuous').toBeGreaterThan(0)
        expect(run.alerts.filter(alert => alert.type === 'normal').length, 'LG0: a notice is written on a page that goes live, so the write-time "no notice" below is not vacuous').toBeGreaterThan(0)
        expect(saveDbMock).toHaveBeenCalled()
    })

    test('LG2: the test acknowledger leaves a notice a cover replaced before its microtask, so `notices` lists only what it dismissed on screen', async () => {
        const run = await boot(false, 'none')

        run.alertStore.set({ type: 'normal', msg: 'covered notice' })
        run.alertStore.set({ type: 'error', msg: 'cover' })
        await settle()

        expect(get(run.alertStore).type).toBe('error')
        expect(run.notices).toEqual([])
        expect(run.alerts.filter(alert => alert.type === 'normal').map(alert => alert.msg)).toEqual(['covered notice'])

        run.alertStore.set({ type: 'normal', msg: 'shown notice' })
        await settle()

        expect(get(run.alertStore).type).toBe('none')
        expect(run.notices).toEqual(['shown notice'])
    })

    const faults = [
        ['(a) a store2 page with no active save', 'no-active-save', /'store2'.*no store2 save is active/],
        ['(b) a mode that disagrees with an active save', 'mode-unset', /'unset'.*a store2 save is active/],
    ] as const

    test.each(faults.flatMap(([label, fault, message]) => [[label, false, fault, message] as const, [label, true, fault, message] as const]))(
        'T2-LIVE reproducer: %s does not go live: the error is alerted, no notice is posted and the save loop never starts (Tauri: %s)',
        async (_label, tauri, fault, message) => {
            const run = await boot(tauri, fault)

            await run.loadData()
            await settle()

            const errors = run.alerts.filter(alert => alert.type === 'error')
            expect(errors).toHaveLength(1)
            expect(errors[0].msg).toMatch(message)
            expect(get(run.loadedStore)).toBe(false)
            expect(run.notices).toEqual([])
            // LG1: a notice written before the gate and then covered by the error alert is in no acknowledged list, so
            // the write-time record is what shows that no notice was posted.
            expect(run.alerts.filter(alert => alert.type === 'normal')).toEqual([])
            expect(saveDbMock).not.toHaveBeenCalled()
            expect(putBackMock).not.toHaveBeenCalled()
        },
    )
})
