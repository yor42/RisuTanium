/**
 * `loadData()` (`src/ts/bootstrap.ts`) with the store2 boot dispatch registered, driven the way the sibling bootstrap
 * test files drive it: the real `loadData()`, the real dispatch, the real block-owner and read-only seams, and a
 * recording page store that holds the legacy files (the main file and a numbered backup set of 21, so a listing that
 * prunes has something to delete). The "no store write" assertions (`storeEffects`) carry the rule that a read-only
 * boot writes and deletes nothing.
 *
 * Reproducer: a page that registered no dispatch reports the registration error and touches no store (T2-N1).
 */
import { describe, test, expect, vi, beforeAll, beforeEach, afterEach, onTestFinished } from 'vitest'
import { writable, get } from 'svelte/store'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type MemoryBackend } from 'src/ts/storage/store2/backend'
import type { GuardedOperations } from 'src/ts/storage/store/contract'
import { StoreNotBinaryError } from 'src/ts/storage/store/errors'
import type { AppStoreKind } from 'src/ts/storage/store/appStore'
import type { PageStorageMode } from 'src/ts/storage/pageStorageMode'
import type { Store2BootUi } from 'src/ts/storage/store2/bootDispatch'
import type { Store2BootEnv, Store2BootNotice } from 'src/ts/storage/store2/bootActive'
import { checkUnit, unitMapSource, type ListDerivation } from 'src/ts/storage/store2/codec'
import { FRAME_HEADER_BYTES, keyOfRef, UNIT_TYPE, type Shard } from 'src/ts/storage/store2/format'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { isModuleStub } from 'src/ts/storage/moduleStub'
import type { FlaggedItem } from 'src/ts/storage/store2/leafFallback'
import { buildSmall, fakeLists } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, seedTree, testEnv, createPeerDouble } from 'src/ts/storage/tests/store2SaveKit'
import type { Database } from 'src/ts/storage/database.svelte'
import { bootSteps, createLegacyBootTracker, type BootStep } from 'src/lib/Nexus/boot/bootProgress'
import { COLD_TRANSFORM_HOOK_MS } from 'src/ts/tests/coldTransform.test-helpers'
import { warmBootstrap, expectBootstrapTransformed } from 'src/ts/tests/bootstrapWarmup.test-helpers'

//#region hoisted mutable config, shared by every dynamically-imported module instance

const platformState = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))

const dbState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
    baseline: () => ({}) as Record<string, unknown>,
}))

/** The boot texts in the order written, with `dispatch` (the registered dispatch was entered) and `install` (setDatabase ran) between them. */
const bootText = vi.hoisted(() => ({ current: '', log: [] as string[] }))

const buildAssetKeepSetMock = vi.hoisted(() => vi.fn(async () => ({ uncleanable: new Set<string>(), complete: true })))
const getUncleanablesSyncMock = vi.hoisted(() => vi.fn((): string[] => []))
const loadPluginsMock = vi.hoisted(() => vi.fn(async () => { }))
const saveDbMock = vi.hoisted(() => vi.fn(async () => { }))
const moduleUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
const setDatabaseMock = vi.hoisted(() => vi.fn((_data: Record<string, unknown>): void => { }))
const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as Record<string, unknown>))
const sleepForeverMock = vi.hoisted(() => vi.fn(async () => { }))
const putBackMock = vi.hoisted(() => vi.fn())
const checkUpdateMock = vi.hoisted(() => vi.fn(async () => { }))
const readColdStorageItemMock = vi.hoisted(() => vi.fn(async (_key: string): Promise<{ status: 'missing' }> => ({ status: 'missing' })))

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
    checkRisuUpdate: checkUpdateMock,
}) as unknown as typeof import('src/ts/update'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    // The database the boot installed, so the id repair of the boot tail acts on the installed characters.
    DBState: { get db() { return dbState.current } },
    // Every assignment is logged, duplicates included, so the order of the boot texts is observable.
    LoadingStatusState: {
        get text() { return bootText.current },
        set text(value: string) {
            bootText.current = value
            bootText.log.push(`text:${value}`)
        },
    },
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    selectedCharID: writable(-1),
    loadedStore: writable(false),
    alertStore: writable({ type: 'none', msg: 'n' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: loadPluginsMock,
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
    moduleUpdate: moduleUpdateMock,
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/memory/characterPutBack'), () => ({
    startCharacterPutBack: putBackMock,
}) as unknown as typeof import('src/ts/process/memory/characterPutBack'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
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
    buildAssetKeepSet: buildAssetKeepSetMock,
    getBasename: (p: string) => p.split('/').pop(),
    checkCharOrder: vi.fn(),
    getUncleanablesSync: getUncleanablesSyncMock,
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

const BACKUP_TIMES = Array.from({ length: 21 }, (_, i) => 1_700_000_000_000 + i * 1000)

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

interface UiDouble extends Store2BootUi {
    notices: Store2BootNotice[]
    blockedWith: { reason: string, detail: string, mayHaveWritten: boolean }[]
    offered: (readonly number[])[]
    flaggedAsked: (readonly FlaggedItem[])[]
    flaggedAnswer: 'continue' | 'decline' | 'earlier'
    recoveries: number
    convertAsked: number
    convertAnswer: boolean
    declinedAsked: number
    incompleteAsked: number
    fromBackupAsked: number
}

function uiDouble(): UiDouble {
    const ui: UiDouble = {
        notices: [],
        blockedWith: [],
        offered: [],
        flaggedAsked: [],
        flaggedAnswer: 'continue',
        recoveries: 0,
        convertAsked: 0,
        convertAnswer: true,
        declinedAsked: 0,
        incompleteAsked: 0,
        fromBackupAsked: 0,
        peer: createPeerDouble(),
        notice(notice) { ui.notices.push(notice) },
        async blocked(blocked) { ui.blockedWith.push(blocked) },
        async offerRestoreOrImport(backups) { ui.offered.push(backups); return 'import' },
        async confirmConvert() {
            ui.convertAsked += 1
            return ui.convertAnswer
        },
        async declined() {
            ui.declinedAsked += 1
            return 'import'
        },
        async confirmConvertWithout() {
            return 'decline'
        },
        async confirmFromBackup() {
            ui.fromBackupAsked += 1
            return 'convert'
        },
        async confirmIncomplete() {
            ui.incompleteAsked += 1
            return true
        },
        async confirmFlaggedOpen(items) {
            ui.flaggedAsked.push(items)
            return ui.flaggedAnswer
        },
        async foreignMarker() { return 'wait' },
        async recovery() { ui.recoveries += 1 },
    }
    return ui
}

/** The numbered backups the page holds, and the main file: a legacy profile the boot can decode. */
function legacyStore(options: { mainFile?: boolean, database?: Record<string, unknown> /* the main file only */ } = {}): MemoryByteStore {
    const store = createMemoryByteStore()
    for (const time of BACKUP_TIMES) {
        store.files.set(`database/dbbackup-${time}.bin`, encodeRisuSaveLegacy(baseDb()))
    }
    if (options.mainFile !== false) {
        store.files.set('database/database.bin', encodeRisuSaveLegacy(options.database ?? baseDb()))
    }
    return store
}

function backupTimesOf(store: MemoryByteStore): number[] {
    return [...store.files.keys()]
        .map(key => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
        .filter((match): match is RegExpExecArray => match !== null)
        .map(match => Number(match[1]))
        .sort((a, b) => b - a)
}

function guardedOps(capable: boolean): GuardedOperations {
    const unused = async () => { throw new Error('not used') }
    return {
        probe: async () => ({ checkOnly: capable, retire: capable, pieces: false }),
        writeChecked: unused,
        removeChecked: unused,
        retireChecked: unused,
    }
}

interface Boot {
    loadData: () => Promise<void>
    loadedStore: ReturnType<typeof writable<boolean>>
    alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
    ui: UiDouble
    store: MemoryByteStore
    backend: MemoryBackend
}

interface BootOptions {
    kind: AppStoreKind
    store?: MemoryByteStore
    /** Register the real dispatch with a memory backend injected in place of the one the store kind builds. */
    injectBackend?: boolean
    /** Register no dispatch at all. */
    unregistered?: boolean
    tauri?: boolean
    /** The list derivation the dispatch is given; absent, `fakeLists`, which carries no module list versions and so mints no module stub. */
    lists?: ListDerivation
}

/** Imports a fresh `loadData` and the matching module pair, injects the page store, and registers the dispatch. */
async function boot(options: BootOptions): Promise<Boot> {
    platformState.isTauri = options.tauri === true
    const store = options.store ?? legacyStore()
    const { injectAppStore } = await import('src/ts/storage/store/appStore')
    injectAppStore(store, options.kind)
    const backend = createMemoryBackend()
    const ui = uiDouble()
    if (options.unregistered !== true) {
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        const { dispatchStore2Boot } = await import('src/ts/storage/store2/bootDispatch')
        registerStore2Boot(async (env) => {
            bootText.log.push('dispatch')
            const result = await dispatchStore2Boot(env, {
                ui,
                kind: options.kind,
                backend: options.injectBackend === true ? async () => backend : undefined,
                keyEnv: testEnv(createClock(), 9001),
                lists: options.lists ?? fakeLists,
            })
            bootText.log.push('dispatched')
            return result
        })
    }
    const { loadData } = await import('src/ts/bootstrap')
    const { alertStore, loadedStore } = await import('src/ts/stores.svelte') as unknown as {
        alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>
        loadedStore: ReturnType<typeof writable<boolean>>
    }
    loadedStore.set(false)
    alertStore.set({ type: 'none', msg: 'n' })
    return { loadData, loadedStore, alertStore, ui, store, backend }
}

/**
 * The test acknowledgers that are listening. The mocked alert store outlives `vi.resetModules()`, so a listener left
 * from one test would dismiss a later test's notices; `afterEach` stops them all.
 */
const acknowledgers: Array<() => void> = []

/** Acknowledges every notice the boot posts and returns their texts, in order. */
function acknowledgeNotices(alertStore: ReturnType<typeof writable<{ type: string, msg: string }>>): string[] {
    const seen: string[] = []
    acknowledgers.push(alertStore.subscribe((value) => {
        if (value.type === 'normal') {
            seen.push(value.msg)
            queueMicrotask(() => alertStore.set({ type: 'none', msg: '' }))
        }
    }))
    return seen
}

/** The texts the boot wrote, in order, duplicates included. */
function writtenTexts(): string[] {
    return bootText.log.filter(entry => entry.startsWith('text:')).map(entry => entry.slice('text:'.length))
}

/** The text that was current when the marker was logged (the last text written before it). */
function textAt(marker: 'dispatch' | 'install'): string | null {
    const at = bootText.log.indexOf(marker)
    if (at < 0) {
        return null
    }
    const before = bootText.log.slice(0, at).filter(entry => entry.startsWith('text:'))
    return before.length === 0 ? null : before[before.length - 1].slice('text:'.length)
}

/** The steps the real screen tracker reads from the texts, in order. */
function trackedSteps(texts: readonly string[]): BootStep[] {
    const tracker = createLegacyBootTracker()
    return texts.map(text => tracker.read(text).step)
}

function expectNeverDecreasing(steps: readonly BootStep[]): void {
    let previous = -1
    for (const step of steps) {
        const index = bootSteps.indexOf(step)
        expect(index).toBeGreaterThanOrEqual(previous)
        previous = index
    }
}

async function settle(): Promise<void> {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
}

beforeAll(warmBootstrap, COLD_TRANSFORM_HOOK_MS)
beforeEach(expectBootstrapTransformed)
beforeEach(() => {
    localStorage.clear()
    platformState.isTauri = false
    platformState.isNodeServer = true
    buildAssetKeepSetMock.mockReset().mockResolvedValue({ uncleanable: new Set(), complete: true })
    getUncleanablesSyncMock.mockReset().mockReturnValue([])
    loadPluginsMock.mockReset().mockResolvedValue(undefined)
    saveDbMock.mockReset().mockResolvedValue(undefined)
    moduleUpdateMock.mockReset().mockResolvedValue(undefined)
    sleepForeverMock.mockReset().mockResolvedValue(undefined)
    putBackMock.mockReset()
    checkUpdateMock.mockReset().mockResolvedValue(undefined)
    readColdStorageItemMock.mockClear()
    dbState.current = baseDb()
    setDatabaseMock.mockClear()
    bootText.current = ''
    bootText.log.length = 0
    setDatabaseMock.mockImplementation((data: Record<string, unknown>) => {
        bootText.log.push('install')
        dbState.current = { ...dbState.baseline(), ...data }
    })
    getDatabaseMock.mockClear()
    getDatabaseMock.mockImplementation(() => dbState.current)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window.location, 'reload').mockImplementation(() => { })
    vi.resetModules()
})

afterEach(async () => {
    for (const stop of acknowledgers.splice(0)) {
        stop()
    }
    // A boot that queued a notice nobody closed leaves it current in that graph's queue; on the shared alert store it
    // would be re-shown on a later test's alert.
    const { resetAlertPromptsForTests } = await import('src/ts/alertPrompts')
    resetAlertPromptsForTests()
    vi.unstubAllGlobals()
})

/**
 * Records the page mode at every read of the legacy main file that follows the dispatch's answer (the `dispatched`
 * marker of `boot`). Reads the dispatch made itself are counted apart and excluded. Call it after `boot()`, so the page
 * mode it consults is the one of the boot's own module graph.
 */
async function recordMainFileReads(store: MemoryByteStore): Promise<{ afterAnswer: PageStorageMode[], duringDispatch: number }> {
    const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
    const recorded = { afterAnswer: [] as PageStorageMode[], duringDispatch: 0 }
    const read = store.read.bind(store)
    store.read = async (key) => {
        if (key === 'database/database.bin') {
            if (bootText.log.includes('dispatched')) {
                recorded.afterAnswer.push(getPageStorageMode())
            } else if (bootText.log.includes('dispatch')) {
                recorded.duringDispatch += 1
            }
        }
        return read(key)
    }
    return recorded
}

/** The page reads the legacy main file only after the dispatch answered, and only as a read-only page: no read happens while the mode is anything else. */
function expectMainFileReadAsReadOnlyPage(recorded: { afterAnswer: PageStorageMode[], duringDispatch: number }): void {
    expect(recorded.duringDispatch, 'the dispatch decides from the main file\'s existence and reads none of its bytes').toBe(0)
    expect(recorded.afterAnswer.length, 'the main file is read after the dispatch answered').toBeGreaterThan(0)
    expect(recorded.afterAnswer.filter((mode) => mode.kind !== 'read-only')).toEqual([])
}

/** Everything the boot wrote or deleted in the page store, the Tauri owner id excepted. */
function storeEffects(store: MemoryByteStore): { writes: string[], deletes: string[] } {
    return { writes: store.writes.filter(key => key !== 'store2-owner'), deletes: [...store.deletes] }
}

describe('loadData(): a legacy profile on a page whose store2 backend is not available is opened read-only (reproducers)', () => {
    const notBinary = (store: MemoryByteStore) => store

    test('a Node server without the check-only route: the legacy profile loads, with no archive pass, no block owner, no write and no delete', async () => {
        const store = notBinary(legacyStore())
        store.guarded = guardedOps(false)
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'node', store })
        const reads = await recordMainFileReads(store)
        const { language } = await import('src/lang')
        const installedWhenPosted: number[] = []
        alertStore.subscribe((value) => {
            if (value.type === 'normal') {
                installedWhenPosted.push(setDatabaseMock.mock.calls.length)
            }
        })
        const shown = acknowledgeNotices(alertStore)

        await loadData()

        expectMainFileReadAsReadOnlyPage(reads)
        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(ui.notices).toEqual([expect.objectContaining({ name: 'server-capability' })])
        // The page, not the port, tells the person: exactly one notice, posted after the database (and its language) is installed.
        expect(shown).toEqual([language.store2Boot.noticeServerCapability])
        expect(installedWhenPosted).toEqual([1])
        expect(shown).not.toContain(language.opfsReadOnlyNotice)
        const { canBootArchive } = await import('src/ts/process/memory/bootArchiveState')
        expect(canBootArchive()).toBe(false)
        const { refuseOnReadOnlyPage } = await import('src/ts/storage/readOnlyPage')
        expect(await refuseOnReadOnlyPage()).toBe(true)
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only', reason: 'server-capability' })
        expect(saveDbMock).not.toHaveBeenCalled()
    })

    test('a Node page with no guarded operations at all: the same, with the other named notice', async () => {
        const store = legacyStore()
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'node', store })
        const reads = await recordMainFileReads(store)
        const { language } = await import('src/lang')
        const shown = acknowledgeNotices(alertStore)

        await loadData()

        expectMainFileReadAsReadOnlyPage(reads)
        expect(get(loadedStore)).toBe(true)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
        expect(shown).toEqual([language.store2Boot.noticeBackendUnavailable])
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only', reason: 'backend-unavailable' })
    })

    test.each([[false], [true]])('B4 guard: a legacy-readonly page never moves the boot step back (Tauri: %s)', async (tauri) => {
        const store = legacyStore()
        const { loadData } = await boot({ kind: tauri ? 'tauri' : 'node', store, tauri })

        await loadData()
        await settle()

        const texts = writtenTexts()
        expect(texts.length).toBeGreaterThan(2)
        expectNeverDecreasing(trackedSteps(texts))
    })

    test('a Tauri page whose store2 backend is unavailable: the legacy profile loads, the 21 numbered backups all stand, and nothing is written but the owner id', async () => {
        const store = legacyStore()
        const { loadData, loadedStore, ui } = await boot({ kind: 'tauri', store, tauri: true })
        const reads = await recordMainFileReads(store)

        await loadData()
        await settle()

        expectMainFileReadAsReadOnlyPage(reads)
        expect(get(loadedStore)).toBe(true)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(store.writes).toContain('store2-owner')
        expect(backupTimesOf(store)).toEqual([...BACKUP_TIMES].reverse())
        expect(ui.notices).toEqual([expect.objectContaining({ name: 'backend-unavailable' })])
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only', reason: 'backend-unavailable' })
    })

    test('a store2 profile on a store this page cannot write is never replaced by the legacy profile', async () => {
        const store = legacyStore()
        store.guarded = guardedOps(false)
        store.files.set('store2-commit', new Uint8Array([1]))
        const { loadData, loadedStore, ui } = await boot({ kind: 'node', store })

        await loadData()

        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalled()
        expect(ui.blockedWith).toEqual([expect.objectContaining({ reason: 'store2-profile-unwritable' })])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })
})

describe('loadData(): the transitional OPFS page is read-only legacy (guard on the old behaviour, through the dispatch)', () => {
    test('it loads the legacy profile, posts the OPFS notice and the dispatch says nothing, and writes nothing', async () => {
        const store = legacyStore()
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'opfs-transitional', store })
        const reads = await recordMainFileReads(store)
        const { language } = await import('src/lang')
        const shown = acknowledgeNotices(alertStore)

        await loadData()

        expectMainFileReadAsReadOnlyPage(reads)
        expect(get(loadedStore)).toBe(true)
        expect(shown).toEqual([language.opfsReadOnlyNotice])
        expect(ui.notices).toEqual([])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'read-only', reason: 'opfs-transitional' })
    })
})

describe('loadData(): a normal store2 profile', () => {
    async function storeTwoRig(tauri: boolean) {
        const store = legacyStore()
        const run = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        await seedTree(run.backend, JSON.parse(JSON.stringify(buildSmall(2))) as Database, testEnv(createClock(), 4242), fakeLists)
        return run
    }

    test.each([[false], [true]])('opens: the database is installed, the save context is active, and no legacy writer runs (Tauri: %s)', async (tauri) => {
        const { loadData, alertStore, loadedStore, store } = await storeTwoRig(tauri)
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        const installed = setDatabaseMock.mock.calls[0][0] as { characters: { name: string }[] }
        expect(installed.characters.map(character => character.name)).toEqual(['Small 0', 'Small 1'])
        // The profile never chose archiving, so its characters open as stubs that name their units, and a residency is registered to load them.
        expect(installed.characters.every(character => typeof (character as { coldstorage?: unknown }).coldstorage === 'string')).toBe(true)
        const { getResidency } = await import('src/ts/storage/store2/residencyActive')
        expect(getResidency()).not.toBeNull()
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        const { canBootArchive } = await import('src/ts/process/memory/bootArchiveState')
        expect(canBootArchive()).toBe(false)
        // The profile has stubs, so the put-back that unloads a loaded character runs on this page.
        expect(putBackMock, 'the store2 put-back starts').toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(backupTimesOf(store)).toHaveLength(21)
        expect(saveDbMock, 'the save loop starts through saveDb after the install').toHaveBeenCalled()
    })

    test.each([[false], [true]])('B1 reproducer: the save text marks the dispatch entry, the library text marks the install, and the steps never go back (Tauri: %s)', async (tauri) => {
        const { loadData, alertStore } = await storeTwoRig(tauri)
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        const first = tauri ? ['Checking Files...'] : []
        const middle = tauri ? ['Checking Update...', 'Listing Stored Files...'] : ['Listing Stored Files...']
        expect(writtenTexts()).toEqual([
            ...first, 'Reading Save File...', 'Decoding Save File...', ...middle,
            'Loading Plugins...', 'Checking For Format Update...', 'Updating States...',
        ])
        expect(textAt('dispatch')).toBe('Reading Save File...')
        expect(textAt('install')).toBe('Decoding Save File...')
        const steps = trackedSteps(writtenTexts())
        expect(steps).toEqual(tauri
            ? ['storage', 'save', 'library', 'app', 'files', 'plugins', 'finish', 'finish']
            : ['save', 'library', 'files', 'plugins', 'finish', 'finish'])
        expectNeverDecreasing(steps)
    })
})

describe('loadData(): the module mint precedes the plugin loader (M)', () => {
    const moduleBody = (id: string) => ({ id, name: `Module ${id}`, description: '', lorebook: [], regex: [], trigger: [], assets: [] })

    /** What the plugin loader finds when it runs: each module slot's stub state and whether the module loader is registered. */
    async function atPluginLoad(lists: ListDerivation | undefined): Promise<{ stubs: boolean[], loader: boolean, calls: number }> {
        const run = await boot({ kind: 'indexeddb', store: legacyStore(), injectBackend: true, lists })
        const source = { ...JSON.parse(JSON.stringify(buildSmall(2))) as Record<string, unknown>, archiveCharacters: true, enabledModules: [], moduleIntergration: '', modules: [moduleBody('ida'), moduleBody('idb')] }
        await seedTree(run.backend, source as unknown as Database, testEnv(createClock(), 4242), createListDerivation())
        const { getModuleLoader } = await import('src/ts/storage/store2/saveActive')
        const seen = { stubs: [] as boolean[], loader: false, calls: 0 }
        loadPluginsMock.mockImplementation(async () => {
            seen.calls += 1
            const modules = dbState.current.modules as Record<string, unknown>[]
            seen.stubs = modules.map(module => isModuleStub(module as never))
            seen.loader = getModuleLoader() !== null
        })
        acknowledgeNotices(run.alertStore)
        await run.loadData()
        await settle()
        return seen
    }

    test('mint-precedes-plugins: with the real derivation every module is already a stub and the loader is registered when the plugin loader runs', async () => {
        const seen = await atPluginLoad(createListDerivation())
        expect(seen.calls).toBe(1)
        expect(seen.stubs).toEqual([true, true])
        expect(seen.loader).toBe(true)
    })

    test('mint-precedes-plugins is not vacuous: a boot under fakeLists mints no stub, while the loader is still registered', async () => {
        const seen = await atPluginLoad(undefined)
        expect(seen.calls).toBe(1)
        expect(seen.stubs).toEqual([false, false])
        expect(seen.loader).toBe(true)
    })
})

describe('loadData(): a store2 profile whose chats have damaged cores', () => {
    function flipPayload(bytes: Uint8Array): Uint8Array {
        const out = new Uint8Array(bytes)
        out[FRAME_HEADER_BYTES + 1] ^= 0xff
        return out
    }

    /** One character with a stable-id chat and a chat with no id (positional handle), both cores damaged. */
    async function damagedRig(answer: 'continue' | 'decline' | 'earlier') {
        const store = legacyStore()
        const run = await boot({ kind: 'indexeddb', store, injectBackend: true })
        run.ui.flaggedAnswer = answer
        // Archiving is off so that the character is resident: only a resident character's leaves are read and flagged.
        const db = JSON.parse(JSON.stringify({ ...buildSmall(1), archiveCharacters: false })) as { characters: { chats: { id: string }[] }[] }
        const stableId = db.characters[0].chats[0].id
        db.characters[0].chats[1].id = ''
        const seeded = await seedTree(run.backend, db as unknown as Database, testEnv(createClock(), 4242), fakeLists)
        const source = unitMapSource(seeded.tree.units)
        const entries = seeded.tree.manifest.shards.flatMap((ref) => {
            const checked = checkUnit(source, ref, UNIT_TYPE.shard)
            return checked.status === 'ok' ? (checked.body as Shard).entries : []
        })
        const entry = entries[0]
        expect(entry.chats.map(chat => chat.cid)).toEqual([stableId, '~1'])
        for (const chat of entry.chats) {
            const key = keyOfRef(chat.core)
            run.backend.poke(key, flipPayload(run.backend.snapshot().get(key) as Uint8Array))
        }
        return { ...run, store, stableId }
    }

    test('continue: the profile opens, the stable chat keeps its id, and the positional chat is given a fresh one', async () => {
        const { loadData, alertStore, loadedStore, ui, store, stableId } = await damagedRig('continue')
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(ui.flaggedAsked).toHaveLength(1)
        expect(ui.flaggedAsked[0].map(item => item.name)).toEqual(['Small 0', 'Small 0'])
        const installed = setDatabaseMock.mock.calls[0][0] as { characters: { chats: { id: string, message: { data: string }[] }[] }[] }
        const [stable, positional] = installed.characters[0].chats
        expect(stable.id).toBe(stableId)
        expect(positional.id).toEqual(expect.any(String))
        expect(positional.id).not.toBe('')
        expect(positional.id.startsWith('~')).toBe(false)
        expect(stable.message[0].data.startsWith('[Cold storage data could not be loaded. Key: ')).toBe(true)
        expect(positional.message[0].data.startsWith('[Cold storage data could not be loaded. Key: ')).toBe(true)
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        expect(saveDbMock).toHaveBeenCalled()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('decline: the page waits, nothing is installed, nothing is written and the save loop never starts', async () => {
        const { loadData, loadedStore, ui, store } = await damagedRig('decline')

        await loadData()
        await settle()

        expect(ui.flaggedAsked).toHaveLength(1)
        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(saveDbMock).not.toHaveBeenCalled()
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).toBeNull()
    })

    test('earlier: the recovery screen is shown, the page waits, and nothing is installed or written', async () => {
        const { loadData, loadedStore, ui, store } = await damagedRig('earlier')

        await loadData()
        await settle()

        expect(ui.recoveries).toBe(1)
        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(saveDbMock).not.toHaveBeenCalled()
    })
})
describe('loadData(): a boot the dispatch stops', () => {
    test.each([[false], [true]])('the profile is not installed, loadedStore stays unset, the page waits, and nothing is written (Tauri: %s)', async (tauri) => {
        // A legacy main file with no store2 profile whose conversion the user declines: the dispatch stops.
        const store = legacyStore()
        const { loadData, loadedStore, ui } = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        ui.convertAnswer = false

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(false)
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(ui.convertAsked).toBe(1)
        expect(ui.declinedAsked).toBe(1)
        expect(ui.notices).toEqual([])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(backupTimesOf(store)).toHaveLength(21)
        expect(saveDbMock).not.toHaveBeenCalled()
    })
})

describe('loadData(): the boot step texts when the dispatch does not hand a profile back', () => {
    test.each([[false], [true]])('B2 reproducer: a dispatch that stops stays at the save step, and the library text is never written (Tauri: %s)', async (tauri) => {
        const store = legacyStore()
        const { loadData, ui } = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        ui.convertAnswer = false

        await loadData()
        await settle()

        const texts = writtenTexts()
        expect(texts[texts.length - 1]).toBe('Reading Save File...')
        expect(texts).not.toContain('Decoding Save File...')
        expect(textAt('dispatch')).toBe('Reading Save File...')
        expect(bootText.log).not.toContain('install')
        expect(setDatabaseMock).not.toHaveBeenCalled()
        const steps = trackedSteps(texts)
        expect(steps[steps.length - 1]).toBe('save')
        expectNeverDecreasing(steps)
    })

    test('a dispatch that rejects stays at the save step, writes no library text, and reports the error through the unchanged path (guard)', async () => {
        const { loadData, loadedStore, alertStore } = await boot({ kind: 'indexeddb', unregistered: true })
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        const { getBootScreen } = await import('src/ts/storage/store2/ui/bootScreen.svelte')
        registerStore2Boot(async () => {
            throw new Error('the dispatch rejected')
        })
        const shown: string[] = []
        acknowledgers.push(alertStore.subscribe((value) => {
            if (value.type !== 'none') {
                shown.push(value.msg)
                queueMicrotask(() => alertStore.set({ type: 'none', msg: '' }))
            }
        }))

        await loadData().catch(() => { })
        await settle()

        const texts = writtenTexts()
        expect(texts[texts.length - 1]).toBe('Reading Save File...')
        expect(texts).not.toContain('Decoding Save File...')
        expect(get(loadedStore)).toBe(false)
        expect(shown.join('\n')).toContain('the dispatch rejected')
        expect(getBootScreen()).toBeNull()
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })
})

describe('loadData(): a boot that throws after the person answered (reproducer)', () => {
    test('the answered "Working" screen does not stay up: the error is reported and no boot screen is left', async () => {
        const { loadData, loadedStore, alertStore } = await boot({ kind: 'indexeddb', unregistered: true })
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        const { askBootScreen, getBootScreen, pressBootButton } = await import('src/ts/storage/store2/ui/bootScreen.svelte')
        const { ANSWER_GUARD_MS } = await import('src/ts/alertPrompts')
        registerStore2Boot(async () => {
            const answered = askBootScreen({ title: 'Q', paragraphs: [], lists: [], details: null, buttons: [{ key: 'yes', label: 'Yes' }], focus: null })
            await new Promise<void>(resolve => setTimeout(resolve, ANSWER_GUARD_MS + 20))
            pressBootButton('yes', performance.now())
            await answered
            expect(getBootScreen()?.answered).toBe(true)
            throw new Error('the dispatch threw after the answer')
        })
        const shown: string[] = []
        acknowledgers.push(alertStore.subscribe((value) => {
            if (value.type !== 'none') {
                shown.push(value.msg)
                queueMicrotask(() => alertStore.set({ type: 'none', msg: '' }))
            }
        }))

        await loadData().catch(() => { })
        await settle()

        expect(get(loadedStore)).toBe(false)
        expect(shown.join('\n')).toContain('the dispatch threw after the answer')
        expect(getBootScreen()).toBeNull()
    })
})

describe('loadData(): the main file predicate the dispatch is given', () => {
    test('a main file that exists is a legacy profile to convert, never a store to seed', async () => {
        const { loadData, ui, backend } = await boot({ kind: 'indexeddb', injectBackend: true })
        ui.convertAnswer = false
        await loadData()
        expect(ui.convertAsked).toBe(1)
        expect(ui.notices).toEqual([])
        expect((await backend.readCommit()).bytes).toBeNull()
    })

    test('a main file the store holds but cannot hand out as bytes is still a legacy profile: it is never seeded over', async () => {
        const store = legacyStore()
        const read = store.read.bind(store)
        store.read = async (key) => {
            if (key === 'database/database.bin') {
                throw new StoreNotBinaryError(key)
            }
            return read(key)
        }
        const { loadData, ui, backend } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        ui.convertAnswer = false
        await loadData()
        expect(ui.convertAsked).toBe(1)
        expect(ui.notices).toEqual([])
        expect(ui.blockedWith).toEqual([])
        expect((await backend.readCommit()).bytes).toBeNull()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('no main file and no numbered backup seeds an empty store2 profile and opens it', async () => {
        const store = createMemoryByteStore()
        const { loadData, alertStore, loadedStore, ui, backend } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        acknowledgeNotices(alertStore)
        await loadData()
        // An empty profile has nothing to move to cold storage, so archiving is switched on without the archive notice.
        expect(ui.notices).toEqual([{ name: 'seeded' }])
        expect(get(loadedStore)).toBe(true)
        expect((await backend.readCommit()).bytes).not.toBeNull()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('numbered backups and no main file are offered, never seeded over, and listing them prunes nothing (21 stand)', async () => {
        const store = legacyStore({ mainFile: false })
        const { loadData, ui, backend, loadedStore } = await boot({ kind: 'indexeddb', store, injectBackend: true })

        await loadData()
        await settle()

        expect(ui.offered).toEqual([[...BACKUP_TIMES].reverse()])
        expect(get(loadedStore)).toBe(false)
        expect((await backend.readCommit()).bytes).toBeNull()
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(backupTimesOf(store)).toHaveLength(21)
    })

    test('a main file check that fails stops the boot with a named block, never read as absent', async () => {
        const store = legacyStore()
        store.has = async () => { throw new Error('cannot tell') }
        const { loadData, ui, backend, loadedStore } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        await loadData()
        expect(ui.blockedWith).toEqual([expect.objectContaining({ reason: 'main-file-unknown' })])
        expect(get(loadedStore)).toBe(false)
        expect((await backend.readCommit()).bytes).toBeNull()
    })
})

describe('loadData(): a legacy profile is converted through the real decoders', () => {
    test.each([[false], [true]])('the strict decode of the main file converts it: the profile opens as store2, the old files and 21 backups stand untouched (Tauri: %s)', async (tauri) => {
        const store = legacyStore()
        const before = new Map(store.files)
        const { loadData, alertStore, loadedStore, ui, backend } = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, injectBackend: true, tauri })
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(ui.convertAsked).toBe(1)
        expect(ui.incompleteAsked).toBe(0)
        expect(get(loadedStore)).toBe(true)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect((await backend.readCommit()).bytes).not.toBeNull()
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'store2' })
        const { getActiveStore2Save } = await import('src/ts/storage/store2/saveActive')
        expect(getActiveStore2Save()).not.toBeNull()
        // The memory backend never confirms a flush, so a Tauri page's re-flush is unconfirmed here; that is the only notice.
        expect(ui.notices).toEqual(tauri ? [{ name: 'flush-unconfirmed' }] : [])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(new Map(store.files).size).toBe(before.size + (tauri ? 1 : 0))
        for (const [key, bytes] of before) {
            expect(store.files.get(key)).toEqual(bytes)
        }
        expect(putBackMock, 'the store2 put-back starts on a converted profile too').toHaveBeenCalledTimes(1)
    })

    test('a main file that does not decode is converted from the newest numbered backup that does, and the notice names it', async () => {
        const store = legacyStore()
        store.files.set('database/database.bin', new Uint8Array([0, 1, 2, 3, 4, 5]))
        const { loadData, alertStore, loadedStore, ui } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        acknowledgeNotices(alertStore)

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(true)
        expect(ui.notices).toEqual([{ name: 'converted-from-backup', backup: BACKUP_TIMES[BACKUP_TIMES.length - 1] }])
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect(store.files.get('database/database.bin')).toEqual(new Uint8Array([0, 1, 2, 3, 4, 5]))
    })

    test('the environment hands the dispatch the page\'s own cold-unit reader', async () => {
        const store = legacyStore()
        const unit = '00000000-0000-4000-8000-0000000000d1'
        const { loadData } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        const { registerStore2Boot } = await import('src/ts/storage/store2/bootActive')
        const handed: { env: Store2BootEnv | null } = { env: null }
        registerStore2Boot(async (env) => {
            handed.env = env
            return { kind: 'stopped' }
        })

        await loadData()

        expect(handed.env).not.toBeNull()
        expect(await handed.env?.readColdStorageItem(unit)).toEqual({ status: 'missing' })
        expect(readColdStorageItemMock).toHaveBeenCalledWith(unit)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
    })

    test('when nothing decodes the page stops with a named block and nothing is written', async () => {
        const store = createMemoryByteStore()
        store.files.set('database/database.bin', new Uint8Array([0, 1, 2, 3, 4, 5]))
        store.files.set('database/dbbackup-1700000000000.bin', new Uint8Array([9, 9, 9]))
        const { loadData, loadedStore, ui, backend } = await boot({ kind: 'indexeddb', store, injectBackend: true })

        await loadData()
        await settle()

        expect(get(loadedStore)).toBe(false)
        expect(ui.blockedWith).toEqual([expect.objectContaining({ reason: 'convert-lenient-failed' })])
        expect(sleepForeverMock).toHaveBeenCalledTimes(1)
        expect(storeEffects(store)).toEqual({ writes: [], deletes: [] })
        expect((await backend.readCommit()).bytes).toBeNull()
    })
})

describe('loadData(): the informational boot notices queue and do not hold the boot (R1w, R4)', () => {
    /** The notice queue of the boot's own module graph; it is reset when the test ends, so a notice left current is not re-shown on a later test's alert. */
    async function noticeQueue() {
        const queue = await import('src/ts/alertPrompts')
        onTestFinished(() => queue.resetAlertPromptsForTests())
        return queue
    }

    test('R1w reproducer (web): with the archive-enabled notice unacknowledged the page goes live and the save loop starts', async () => {
        // A profile with a module is one the archive notice is told to; an empty profile is switched on without it.
        const store = legacyStore({ database: { ...baseDb(), modules: [{ id: 'ida', name: 'Module ida', description: '', lorebook: [], regex: [], trigger: [], assets: [] }] } })
        const { loadData, loadedStore, ui } = await boot({ kind: 'indexeddb', store, injectBackend: true })
        const queue = await noticeQueue()

        const loading = loadData()
        await vi.waitFor(() => {
            expect(get(loadedStore)).toBe(true)
            expect(saveDbMock).toHaveBeenCalled()
            expect(putBackMock).toHaveBeenCalledTimes(1)
        })
        await loading

        expect(ui.notices.map((notice) => notice.name)).toContain('archive-enabled')
        let settled = false
        void queue.noticesSettled().then(() => { settled = true })
        await settle()
        expect(settled, 'nothing has pressed OK').toBe(false)
    })

    test('R4: an update question asked while a notice is unacknowledged shows over it, and the notice comes back after the answer', async () => {
        const { loadData, loadedStore, alertStore } = await boot({ kind: 'tauri', tauri: true, injectBackend: true })
        const queue = await noticeQueue()
        checkUpdateMock.mockImplementation(async () => {
            const { alertConfirm } = await import('src/ts/alert')
            await alertConfirm('Update available?')
        })

        const loading = loadData()
        await vi.waitFor(() => {
            expect(get(alertStore).type).toBe('ask')
        })
        expect(queue.noticeShowing(), 'the prompt covers the notice').toBe(false)
        expect(get(loadedStore), 'the boot is at the update question').toBe(false)

        expect(queue.answerShownPrompt('no')).toBe(true)
        await loading
        expect(get(loadedStore)).toBe(true)
        // The boot's repair toast may sit over the notice; its end is a `none` the notice survives, as in the app.
        if (get(alertStore).type === 'toast') {
            alertStore.set({ type: 'none', msg: '' })
        }
        expect(get(alertStore).type).toBe('normal')
        expect(queue.noticeShowing(), 'the notice returns after the answer').toBe(true)

        let settled = false
        void queue.noticesSettled().then(() => { settled = true })
        await settle()
        expect(settled).toBe(false)
        // The person closes each queued notice in turn; the Tauri conversion raises more than one.
        while (get(alertStore).type === 'normal') {
            alertStore.set({ type: 'none', msg: '' })
        }
        await vi.waitFor(() => {
            expect(settled).toBe(true)
        })
    })
})

describe('loadData(): a page that registered no dispatch fails closed before it touches a store (T2-N1, reproducers)', () => {
    test.each([[false], [true]])('the registration error is alerted, nothing is read, listed, written or created, and the page stays unloaded (Tauri: %s)', async (tauri) => {
        const store = legacyStore()
        const { loadData, loadedStore, alertStore } = await boot({ kind: tauri ? 'tauri' : 'indexeddb', store, tauri, unregistered: true })
        const { mkdir, readDir } = await import('@tauri-apps/plugin-fs')
        vi.mocked(mkdir).mockClear()
        vi.mocked(readDir).mockClear()
        const seen: { type: string, msg: string }[] = []
        alertStore.subscribe((value) => { seen.push({ type: value.type, msg: value.msg }) })

        await loadData()
        await settle()

        expect(seen.filter(alert => alert.type === 'error')).toEqual([expect.objectContaining({ msg: expect.stringContaining('No store2 boot dispatch is registered') })])
        expect(get(loadedStore)).toBe(false)
        const { getPageStorageMode } = await import('src/ts/storage/pageStorageMode')
        expect(getPageStorageMode()).toEqual({ kind: 'unset' })
        expect(store.reads).toEqual([])
        expect(store.lists).toEqual([])
        expect(store.writes).toEqual([])
        expect(store.deletes).toEqual([])
        expect(mkdir, 'no Tauri directory is created').not.toHaveBeenCalled()
        expect(readDir, 'no Tauri temp sweep runs').not.toHaveBeenCalled()
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(saveDbMock).not.toHaveBeenCalled()
        expect(bootText.log).not.toContain('dispatch')
    })
})
