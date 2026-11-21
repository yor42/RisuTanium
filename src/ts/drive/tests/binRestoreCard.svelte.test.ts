// @vitest-environment happy-dom

/**
 * The `.bin` file restore of Settings, the Data page and Welcome on the task card (`restoreFromBinFile` with `card: true`),
 * and the Cancel that is accepted only before the point of no return (the first asset or inlay write).
 *
 * Real: `settingsRestore.ts`, `backupRouter.ts`, `backuplocal.ts` (`LoadPickedLocalBackup`), the card seam, the card slot
 * (`alertTask.svelte.ts`) and the walk, scan and asset pipeline. Faked: the page's alert surfaces, the store2 commit
 * (`store2ShellMock`, the shell the legacy suites use), the Tauri file system and the Web Locks manager. A fresh module graph
 * stands for a fresh page, so the card slot is read through that graph's `alertTask.svelte`. A mocked commit proves the
 * restore reached the commit boundary in the right order and with the right inputs, nothing about what lands, and a mocked
 * success is not evidence of device behaviour.
 *
 * Labels: RR = regression reproducer (red on the base, where the restore shows wait dialogs and offers no Cancel);
 * CG = compatibility guard (passes before and after).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { BootImportResult, BootImportTarget } from 'src/ts/storage/store2/legacy/bootImport'
import { FakeLockManagerCore, FakeTabLockManagerView } from 'src/ts/storage/tests/fakeWebLocks'

//#region module mocks

const platformBox = vi.hoisted(() => {
    // globalApi.svelte.ts reads navigator.locks once, at module evaluation; a web test sets it before its imports.
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true, isNodeServer: false }
})
const osBox = vi.hoisted(() => ({ os: 'android' }))
type FakeFs = ReturnType<typeof import('src/ts/storage/tests/tauriFsFake').createFakeTauriFs>
type DesktopFake = ReturnType<typeof import('src/ts/storage/tests/tauriDesktopFake').createDesktopInvoke>
const harness = vi.hoisted(() => ({ made: {} as { fs: FakeFs, desktop: DesktopFake } }))

const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setDatabaseMock = vi.hoisted(() => vi.fn())
const shell = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<boolean> => true))
const alertWaitMock = vi.hoisted(() => vi.fn())
const noticeMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
const reloadMark = vi.hoisted(() => ({ marked: false }))
const pageStoreBox = vi.hoisted(() => ({ store: null as null | { set: (value: unknown) => void, subscribe: (run: (value: unknown) => void) => () => void } }))
/** Called by the page's clean check, which `saveFirst` makes once the card is open. */
const saveBox = vi.hoisted(() => ({ onCheck: null as (() => void) | null, dirtyFirst: false }))
/** Asset writes that reached the batch stand-in. */
const assetWrites = vi.hoisted(() => ({ count: 0 }))
/**
 * The scale question's double: when set it answers in place of the real `confirmImportScale`, whose threshold needs a
 * file of gigabytes. A test keeps the double's own record of the card it found there.
 */
const scaleBox = vi.hoisted(() => ({ ask: null as null | (() => Promise<boolean>) }))
/**
 * The asset pipeline's double. `outstanding` forces the pipeline's "writes still in flight" answer; `mode` forces the write
 * mode of a page that is not the Android or desktop app, which would otherwise have no pipeline at all.
 */
const pipelineBox = vi.hoisted(() => ({ outstanding: null as null | boolean, mode: null as null | 'raw' | 'b64' | 'none' }))

/** What the restore reported to the card seam, with the card as it was right after the call. */
interface SeamCall {
    kind: 'phase' | 'bytes' | 'lock' | 'cancelled' | 'leave'
    step: string
    text: string | null
    done: number
    /** The label of the step the card showed after the call, or null when no card was shown. */
    label: string | null
    offered: boolean
    cancelled: boolean
    state: string | null
}
const rec = vi.hoisted(() => ({
    calls: [] as SeamCall[],
    /** Runs right after each recorded call, on the call's own stack. */
    hook: null as ((call: SeamCall) => void) | null,
    /** The next `leave` throws, as a broken card host would. */
    leaveThrows: false,
}))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { reloadMark.marked = true },
    isAppInitiatedReload: () => reloadMark.marked,
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
            keys: vi.fn(async () => []),
        }),
    },
}))

vi.mock(import('src/ts/model/modellist'), () => ({
    getModelInfo: vi.fn(),
}) as unknown as typeof import('src/ts/model/modellist'))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return platformBox.isTauri },
    get isNodeServer() { return platformBox.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => osBox.os }))

vi.mock('@tauri-apps/plugin-fs', async () => {
    const fsModule = await import('src/ts/storage/tests/tauriFsFake')
    const desktopModule = await import('src/ts/storage/tests/tauriDesktopFake')
    harness.made.fs = fsModule.createFakeTauriFs({ strict: true })
    harness.made.desktop = desktopModule.createDesktopInvoke(harness.made.fs, { cap: 4 * 1024 * 1024 })
    return { ...harness.made.fs.module }
})

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => 'backup-output.bin'),
}))

/** The batch commands as stand-ins that write through the page's store, as the native command does. */
vi.mock('src/ts/storage/tauriAssetBatch', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/tauriAssetBatch')>()
    const { getAppStore } = await import('src/ts/storage/store/appStore')
    async function run(entries: readonly { key: string, data: Uint8Array }[]) {
        const store = await getAppStore()
        const results: Awaited<ReturnType<typeof original.writeAssetBatch>> = []
        for (const entry of entries) {
            assetWrites.count += 1
            await store.write(entry.key, entry.data, 'unconditional')
            results.push({ k: 'ok' })
        }
        return results
    }
    return {
        ...original,
        assetBatchWriteMode: () => pipelineBox.mode ?? original.assetBatchWriteMode(),
        writeAssetBatch: (entries: readonly { key: string, data: Uint8Array }[]) => run(entries),
        writeAssetBatchB64: (entries: readonly { key: string, data: Uint8Array }[]) => run(entries),
    }
})

/** The commit the restore ends with: a landed one unless a test sets another end. */
vi.mock(import('src/ts/drive/storeImport'), async (importOriginal) => {
    const shelled = await store2ShellMock(shell)(importOriginal)
    return {
        ...shelled,
        confirmImportScale: (...args: Parameters<typeof shelled.confirmImportScale>) =>
            scaleBox.ask === null ? shelled.confirmImportScale(...args) : scaleBox.ask(),
    }
})

vi.mock(import('src/ts/storage/readOnlyPage'), () => ({
    refuseOnReadOnlyPage: async () => false,
}) as unknown as typeof import('src/ts/storage/readOnlyPage'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: getDatabaseMock,
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} as unknown as Database },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
    alertStore: (pageStoreBox.store = writable({ type: 'none', msg: '' }) as never),
    MobileGUI: writable(false),
    botMakerMode: writable(false),
    loadedStore: writable(false),
    LoadingStatusState: { text: '' },
    ReloadGUIPointer: writable(0),
    bodyIntercepterStore: writable(null),
    savingStoppedReason: writable(null),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: alertConfirmMock,
    alertError: alertErrorMock,
    alertWait: alertWaitMock,
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: noticeMock,
    waitUnreadNotice: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(),
    alertStore: { set: (data: unknown) => { pageStoreBox.store?.set(data) }, subscribe: (run: (value: unknown) => void) => pageStoreBox.store!.subscribe(run) },
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((value: unknown) => value === null || value === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => path),
    invoke: async (command: string, args?: unknown, options?: unknown) =>
        (harness.made.desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...parts: string[]) => parts.join('/')),
    basename: vi.fn(async (path: string) => path.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((value: string) => value),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async () => null)
        setItem = vi.fn(async () => { })
        keys = vi.fn(async () => [])
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

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
    updateLorebooks: vi.fn((value: unknown) => value),
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('src/ts/hotkey'))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/coldstorage.svelte'), async () => {
    const { getColdStorageBackupKey } = await import('src/ts/process/coldstorageData')
    return {
        collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
        readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
        confirmIncompleteColdStorageOperation: vi.fn(async () => true),
        getColdStorageBackupKey,
        getColdStorageItem: vi.fn(async () => null),
        isColdStorageBackupData: vi.fn(() => true),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

// The real card seam, recording each progress call with the card as it stands right after it; a test's hook runs on the
// call's own stack (to press Cancel at an exact point), and `leaveThrows` makes the next `leave` fail like a broken host.
// Registered with `doMock` after each `vi.resetModules()`: a static factory runs once for the whole file, so it would wrap
// the first page's card slot in every later page.
function mockSeamAndInlays(): void {
// The real module with one answer fixed: a clean page, so the restore's save-first step returns at its clean check. The
// check also runs the test's hook, which is where a test presses Cancel during the save step. Per page, so a landed restore
// that keeps its write lock closed does not close the next page's lock.
vi.doMock('src/ts/globalApi.svelte', async (importOriginal) => ({
    ...await importOriginal<typeof import('src/ts/globalApi.svelte')>(),
    isSaveClean: () => {
        saveBox.onCheck?.()
        if (saveBox.dirtyFirst) {
            saveBox.dirtyFirst = false
            return false
        }
        return true
    },
}))
vi.doMock('src/ts/drive/restoreProgress', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/drive/restoreProgress')>()
    const task = await import('src/ts/alertTask.svelte')
    const note = (kind: SeamCall['kind'], step: string, text: string | null, done: number): void => {
        const view = task.taskHostView()
        const call: SeamCall = {
            kind,
            step,
            text,
            done,
            label: view === null ? null : view.steps[view.stepIndex]?.label ?? null,
            offered: view?.cancelOffered ?? false,
            cancelled: view?.cancelled ?? false,
            state: view === null ? null : String(view.state),
        }
        rec.calls.push(call)
        rec.hook?.(call)
    }
    return {
        ...actual,
        cardRestoreProgress: (...args: Parameters<typeof actual.cardRestoreProgress>) => {
            const real = actual.cardRestoreProgress(...args)
            return {
                ...real,
                get cancelRequested() { return real.cancelRequested },
                phase(step: string, text: string | null) {
                    real.phase(step, text)
                    note('phase', step, text, -1)
                },
                bytes(step: string, done: number, total: number, text: string | null) {
                    real.bytes(step, done, total, text)
                    note('bytes', step, text, done)
                },
                lockCancel() {
                    const granted = real.lockCancel()
                    note('lock', granted ? 'granted' : 'refused', null, -1)
                    return granted
                },
                cancelled() {
                    real.cancelled()
                    note('cancelled', '', null, -1)
                },
                leave() {
                    if (rec.leaveThrows) {
                        rec.leaveThrows = false
                        throw new Error('the seam broke')
                    }
                    real.leave()
                    note('leave', '', null, -1)
                },
            }
        },
    }
})

// The real pipeline with its in-flight answer forced by a test; `drain` and the writes stay real.
vi.doMock('src/ts/drive/assetBatchPipeline', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/drive/assetBatchPipeline')>()
    const proto = actual.RestoreAssetPipeline.prototype
    const real = Object.getOwnPropertyDescriptor(proto, 'outstanding')?.get
    if (real === undefined) { throw new Error('RestoreAssetPipeline.outstanding is no longer a getter') }
    Object.defineProperty(proto, 'outstanding', {
        configurable: true,
        get(this: typeof proto): boolean { return pipelineBox.outstanding ?? real.call(this) },
    })
    return actual
})

// The real module with the order of its calls recorded, so a test can tell the inlay write from the step before it.
vi.doMock('src/ts/drive/inlayBackupImport', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/drive/inlayBackupImport')>()
    return {
        ...actual,
        restoreCollectedInlays: async (collector: Parameters<typeof actual.restoreCollectedInlays>[0]) => {
            rec.calls.push({ kind: 'phase', step: 'INLAYS-WRITTEN', text: null, done: -1, label: null, offered: false, cancelled: false, state: null })
            return actual.restoreCollectedInlays(collector)
        },
    }
})
}

//#endregion

// Imported first: it settles the module cycle between the store, the save format and the global API.
import { EMPTY_LANDED_END, resetStore2ShellBox, store2ShellMock, type Store2ShellBox } from 'src/ts/drive/tests/store2ShellStub'
import 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { alertStore as pageStore } from 'src/ts/stores.svelte'

//#region helpers

const encoder = new TextEncoder()

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = encoder.encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    out.set(u32le(nameBuf.length), 0)
    out.set(nameBuf, 4)
    out.set(u32le(data.length), 4 + nameBuf.length)
    out.set(data, 8 + nameBuf.length)
    return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

function databaseChunk(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    return buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression'))
}

/** A `.bin` of the given entries and the database entry, as the real container lays them out. */
function binOf(entries: [string, Uint8Array][]): Uint8Array {
    return concat([...entries.map(([name, data]) => buildChunk(name, data)), databaseChunk()])
}

/** A `.bin` with one asset and the database entry. */
const smallBin = (): Uint8Array => binOf([['small.png', new Uint8Array([1, 2, 3, 4])]])

/** A `.bin` of many small assets, so the walk and the copy loop pass many entries. */
const manyBin = (): Uint8Array => binOf(Array.from({ length: 12 }, (_, i): [string, Uint8Array] => [`a${i}.png`, new Uint8Array([i, 1, 2, 3])]))

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function waitForCondition(condition: () => boolean): Promise<boolean> {
    for (let i = 0; i < 600; i++) {
        if (condition()) { return true }
        await settle()
    }
    return condition()
}

/** What the page store held, in order. */
const pageSeen: { type: string, msg: string }[] = []
let stopWatch: () => void = () => { }

interface Page {
    task: typeof import('src/ts/alertTask.svelte')
    settings: typeof import('src/ts/drive/settingsRestore')
    globalApi: typeof import('src/ts/globalApi.svelte')
    /** The card slot's current view; the label of the step it shows, or null. */
    stepLabel(): string | null
}

/** A fresh page: its module graph, the page mode and the card clock (one second per read, so every report is published). */
async function bootPage(kind: 'tauri' | 'web', core?: FakeLockManagerCore): Promise<Page> {
    vi.resetModules()
    mockSeamAndInlays()
    platformBox.isTauri = kind === 'tauri'
    osBox.os = 'android'
    Object.defineProperty(window.navigator, 'locks', {
        value: core === undefined ? undefined : new FakeTabLockManagerView(core, 'A') as unknown as LockManager,
        configurable: true,
    })
    const globalApi = await import('src/ts/globalApi.svelte')
    const pageMode = await import('src/ts/storage/pageStorageMode')
    pageMode.setPageStorageMode({ kind: 'store2' })
    const task = await import('src/ts/alertTask.svelte')
    let tick = 0
    task.setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
    const settings = await import('src/ts/drive/settingsRestore')
    return {
        task,
        settings,
        globalApi,
        stepLabel() {
            const view = task.taskHostView()
            return view === null ? null : view.steps[view.stepIndex]?.label ?? null
        },
    }
}

/** The Settings restore as the button runs it: the picker is handed `bytes` and the restore runs to its end. */
async function runRestore(page: Page, bytes: Uint8Array, name = 'backup.bin'): Promise<void> {
    let captured: HTMLInputElement | null = null
    const realCreateElement = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') { captured = el as HTMLInputElement }
        return el
    }) as typeof document.createElement)
    let done: Promise<void>
    try {
        done = page.settings.restoreFromBinFile()
        await waitForCondition(() => captured !== null)
    } finally {
        spy.mockRestore()
    }
    const input = captured as HTMLInputElement | null
    if (!input) { throw new Error('the restore flow did not reach the file input') }
    const file = new File([bytes as unknown as Uint8Array<ArrayBuffer>], name)
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    await done
}

/** The labels of the steps the card showed, in order, from the recorded calls. */
function stepsShown(): string[] {
    const labels: string[] = []
    for (const call of rec.calls) {
        if (call.label !== null && labels.at(-1) !== call.label) { labels.push(call.label) }
    }
    return labels
}

const L = {
    check: () => language.importStepCheck,
    read: () => language.restoreStepRead,
    tabs: () => language.restoreStepTabs,
    copy: () => language.restoreStepCopy,
    files: () => language.restoreStepFinishFiles,
    load: () => language.restoreStepLoad,
}

/** The legacy wait texts of the page restore; none may be posted on the card route. */
function legacyWaitTexts(): string[] {
    return alertWaitMock.mock.calls.map((call) => String(call[0])).filter((text) =>
        text.startsWith('Checking local backup') || text.startsWith('Loading local Backup')
        || text === language.backupRestoreReadingDatabase || text === language.backupRestoreLoading
        || text === language.restoreCheckingOtherTabs || text === language.store2RestoreSaving
        || text === language.backupRestoreFinishingFiles)
}

//#endregion

beforeEach(() => {
    harness.made.desktop.reset()
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    resetStartupCleanupForTests()
    harness.made.fs.reset()
    harness.made.fs.directories.add('assets')
    resetStore2ShellBox(shell)
    setDatabaseMock.mockReset()
    alertErrorMock.mockReset()
    alertWaitMock.mockReset()
    noticeMock.mockClear()
    alertConfirmMock.mockReset().mockResolvedValue(true)
    reloadMark.marked = false
    rec.calls.length = 0
    rec.hook = null
    rec.leaveThrows = false
    saveBox.onCheck = null
    saveBox.dirtyFirst = false
    assetWrites.count = 0
    scaleBox.ask = null
    pipelineBox.outstanding = null
    pipelineBox.mode = null
    platformBox.isNodeServer = false
    pageSeen.length = 0
    stopWatch = pageStore.subscribe((value) => { pageSeen.push({ type: value.type, msg: value.msg }) })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    getDatabaseMock.mockImplementation(() => ({ didFirstSetup: true, characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
})

afterEach(() => {
    stopWatch()
    resetStartupCleanupForTests()
    vi.restoreAllMocks()
})

describe('a .bin restore on the task card', () => {
    // RR: base shows `Checking local backup...`, `Loading local Backup...` and the other legacy waits, with no card.
    test('BR-T1: the steps run in order with bytes on check and copy, Cancel offered through read and locked from copy, and no legacy wait', async () => {
        const page = await bootPage('tauri')

        await runRestore(page, smallBin())

        const labels = stepsShown()
        const order = [L.check(), L.read(), L.copy(), L.load()].map((label) => labels.indexOf(label))
        expect(order.every((index) => index >= 0), `steps shown: ${labels.join(' > ')}`).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
        const checkBytes = rec.calls.filter((call) => call.kind === 'bytes' && call.step === 'check')
        expect(checkBytes.length).toBeGreaterThan(0)
        expect(rec.calls.some((call) => call.kind === 'bytes' && call.step === 'copy')).toBe(true)
        const reports = rec.calls.filter((c) => c.kind === 'phase' || c.kind === 'bytes')
        for (const call of reports.filter((c) => c.label === L.check() || c.label === L.read())) {
            expect(call.offered, `Cancel offered at ${call.label}`).toBe(true)
        }
        for (const call of reports.filter((c) => c.label === L.copy() || c.label === L.files() || c.label === L.load())) {
            expect(call.offered, `Cancel locked at ${call.label}`).toBe(false)
        }
        expect(legacyWaitTexts()).toEqual([])
        expect(shell.commits).toHaveLength(1)
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
    })

    // RR: base opens no card, so the save step shows no card.
    test('the save step shows the card with Cancel offered, before the walk', async () => {
        const page = await bootPage('tauri')
        let seen: { label: string | null, offered: boolean } | null = null
        saveBox.onCheck = () => {
            if (seen !== null) { return }
            const view = page.task.taskHostView()
            seen = view === null ? null : { label: page.stepLabel(), offered: view.cancelOffered }
        }

        await runRestore(page, smallBin())

        expect(seen).toEqual({ label: language.restoreStepSave, offered: true })
    })

    // RR: base posts the save-first wait dialog when the page has unsaved edits; the card route shows its own step instead.
    test('a page with unsaved edits saves first without the legacy save wait dialog', async () => {
        const page = await bootPage('tauri')
        saveBox.dirtyFirst = true

        await runRestore(page, smallBin())

        expect(alertWaitMock).not.toHaveBeenCalledWith(language.store2RestoreSaving)
        expect(legacyWaitTexts()).toEqual([])
        expect(shell.commits).toHaveLength(1)
    })

    // RR: base opens no card, so there is no card to leave before the first notice.
    test('BR-T2: the card is gone before the first notice of a restore that skipped something', async () => {
        const page = await bootPage('tauri')
        const shownAtNotice: boolean[] = []
        noticeMock.mockImplementation(async () => { shownAtNotice.push(page.task.taskShown()) })
        shell.end = { ...EMPTY_LANDED_END, incomplete: [{ kind: 'x' } as unknown as (typeof EMPTY_LANDED_END)['incomplete'][number]] }

        await runRestore(page, binOf([['small.png', new Uint8Array([1, 2, 3])], [`risu-inlay-${'ab'.repeat(32)}-0.part`, new Uint8Array(8)]]))

        expect(shownAtNotice.length, 'a notice was posted').toBeGreaterThan(0)
        expect(shownAtNotice[0]).toBe(false)
    })

    // RR: base opens no card, so an unconfirmed ending has none to leave.
    test('BR-T3: an unconfirmed commit leaves the card and keeps the closeless unconfirmed wait', async () => {
        const page = await bootPage('tauri')
        shell.end = { kind: 'unconfirmed' }

        await runRestore(page, smallBin())

        expect(rec.calls.some((call) => call.kind === 'lock' && call.step === 'granted')).toBe(true)
        expect(rec.calls.at(-1)?.kind).toBe('leave')
        expect(page.task.taskShown()).toBe(false)
        expect(pageSeen).toContainEqual({ type: 'wait', msg: language.store2ImportUnconfirmed })
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    // RR: base opens no card, so nothing is left behind a refusal either way; the refusal and the absent card are both pinned.
    test('BR-T5: a truncated file ends with today\'s error and no card left behind', async () => {
        const page = await bootPage('tauri')
        const bytes = smallBin()

        await runRestore(page, bytes.slice(0, bytes.length - 3))

        expect(rec.calls.length, 'the card route ran').toBeGreaterThan(0)
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupFileEndsEarly)
        expect(rec.calls.some((call) => call.kind === 'cancelled')).toBe(false)
        expect(page.task.taskShown()).toBe(false)
        expect(shell.commits).toHaveLength(0)
    })

    // RR: base posts the card-less commit with a wait dialog; here the card is shown at `load` with Cancel locked.
    test('BR-T10: the commit runs while the card shows the load step with Cancel locked', async () => {
        const page = await bootPage('tauri')
        let atCommit: { label: string | null, offered: boolean, shown: boolean } | null = null
        shell.onCommit = () => {
            const view = page.task.taskHostView()
            atCommit = { label: page.stepLabel(), offered: view?.cancelOffered ?? false, shown: page.task.taskShown() }
        }

        await runRestore(page, smallBin())

        expect(atCommit).toEqual({ label: language.restoreStepLoad, offered: false, shown: true })
    })

    // RR: base has no seam; a seam whose leave throws on the landed path must not turn a landed restore into a failure.
    test('BR-T11: a leave that throws after the commit landed still ends committed, with the saved notice and never the failure error', async () => {
        const page = await bootPage('tauri')
        rec.hook = (call) => { if (call.kind === 'lock') { rec.leaveThrows = true } }

        await runRestore(page, smallBin())

        expect(shell.commits).toHaveLength(1)
        expect(pageSeen).toContainEqual({ type: 'wait', msg: language.restoreSavedReloadOrRestart })
        expect(alertErrorMock).not.toHaveBeenCalledWith(language.backupRestoreFailed)
    })

    // RR: base opens no card, so nothing is left behind a throw.
    test('BR-T12: a throw before the first write ends with the failure error and no card left behind', async () => {
        const page = await bootPage('tauri')
        saveBox.onCheck = () => { throw new Error('scratch: the page broke') }

        await runRestore(page, smallBin())

        expect(alertErrorMock).toHaveBeenCalledWith(language.backupRestoreFailed)
        expect(page.task.taskShown()).toBe(false)
        expect(shell.commits).toHaveLength(0)
    })

    // CG: passes before and after. The picked-file restore without the flag keeps today's waits and shows no card.
    test('BR-T8: LoadPickedLocalBackup without the card option posts the legacy waits and never a card', async () => {
        const page = await bootPage('tauri')
        const shownDuring: boolean[] = []
        alertWaitMock.mockImplementation(() => { shownDuring.push(page.task.taskShown()) })
        const { LoadPickedLocalBackup } = await import('src/ts/drive/backuplocal')

        await LoadPickedLocalBackup(new File([smallBin() as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'))

        expect(legacyWaitTexts().some((text) => text.startsWith('Checking local backup'))).toBe(true)
        expect(legacyWaitTexts()).toContain(language.backupRestoreLoading)
        expect(shownDuring.length).toBeGreaterThan(0)
        expect(shownDuring.every((shown) => !shown)).toBe(true)
        expect(rec.calls.filter((call) => call.step !== 'INLAYS-WRITTEN')).toEqual([])
        expect(shell.commits).toHaveLength(1)
    })

    // RR: base opens no card, so no files step precedes the inlay write.
    test('BR-T14: a backup with an inlay part shows the files step before the inlays are written, then load', async () => {
        const page = await bootPage('tauri')
        const inlayName = `risu-inlay-${'ab'.repeat(32)}-0.part`

        await runRestore(page, binOf([['small.png', new Uint8Array([1, 2, 3])], [inlayName, new Uint8Array(8)]]))

        const written = rec.calls.findIndex((call) => call.step === 'INLAYS-WRITTEN')
        const filesPhase = rec.calls.findIndex((call) => call.kind === 'phase' && call.step === 'files' && call.text === null)
        expect(written).toBeGreaterThanOrEqual(0)
        expect(filesPhase, 'the files step is reported before the inlay write').toBeGreaterThanOrEqual(0)
        expect(filesPhase).toBeLessThan(written)
        const loadAt = rec.calls.findIndex((call) => call.kind === 'phase' && call.step === 'load')
        expect(loadAt).toBeGreaterThan(written)
        expect(shell.commits).toHaveLength(1)
    })

    // RR: the files step for the inlay write exists only when the file held an inlay part; a plain backup has no such report.
    test('a backup with no inlay part reports no files step of its own for the inlay write', async () => {
        const page = await bootPage('tauri')

        await runRestore(page, smallBin())

        expect(rec.calls.some((call) => call.kind === 'phase' && call.step === 'files' && call.text === null)).toBe(false)
        expect(rec.calls.some((call) => call.step === 'INLAYS-WRITTEN')).toBe(true)
        expect(shell.commits).toHaveLength(1)
    })

    // CG: passes before and after. The start-up restore has no card host before the app is up, so it keeps today's waits.
    test('BR-T7: a .bin restored at boot shows no card and posts the legacy waits', async () => {
        const page = await bootPage('tauri')
        const shownDuring: boolean[] = []
        alertWaitMock.mockImplementation(() => { shownDuring.push(page.task.taskShown()) })
        const install = vi.fn(async (): Promise<BootImportResult> => ({ status: 'reclassify' }))
        const target: BootImportTarget = { readColdStorageItem: async () => ({ status: 'missing' }), install }
        const { loadPickedBackupAtBoot } = await import('src/ts/drive/backuplocal')

        const end = await loadPickedBackupAtBoot(new File([smallBin() as unknown as Uint8Array<ArrayBuffer>], 'backup.bin'), target)

        expect(end).toEqual({ kind: 'finished', result: { status: 'reclassify' } })
        expect(install).toHaveBeenCalledTimes(1)
        expect(legacyWaitTexts().some((text) => text.startsWith('Checking local backup'))).toBe(true)
        expect(legacyWaitTexts()).toContain(language.backupRestoreLoading)
        expect(shownDuring.length).toBeGreaterThan(0)
        expect(shownDuring.every((shown) => !shown)).toBe(true)
        expect(rec.calls.filter((call) => call.step !== 'INLAYS-WRITTEN')).toEqual([])
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    // RR: base opens no card, so there is no card under the scale question; the decline here ends silently on both routes.
    test('BR-T6: the scale question is asked with the card at the check step, and declining it leaves the card with nothing else shown', async () => {
        const page = await bootPage('tauri')
        let atAsk: { label: string | null, shown: boolean, offered: boolean } | null = null
        scaleBox.ask = async () => {
            atAsk = { label: page.stepLabel(), shown: page.task.taskShown(), offered: page.task.taskHostView()?.cancelOffered ?? false }
            return alertConfirmMock('the scale question')
        }
        // Every other question of the flow (the Settings button's own confirm) is accepted; only the scale question declines.
        alertConfirmMock.mockImplementation(async (message: string) => message !== 'the scale question')

        await runRestore(page, smallBin())

        expect(atAsk).toEqual({ label: L.check(), shown: true, offered: true })
        expect(alertConfirmMock).toHaveBeenCalledWith('the scale question')
        // Silent: no error, no result card, no cancelled report, no notice, and no later step ran.
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
        expect(rec.calls.some((call) => call.kind === 'cancelled')).toBe(false)
        expect(rec.calls.at(-1)?.kind).toBe('leave')
        expect(rec.calls.some((call) => call.kind === 'phase' && call.step === 'read')).toBe(false)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(noticeMock).not.toHaveBeenCalled()
        expect(pageSeen.every((seen) => seen.type === 'none')).toBe(true)
        expect(assetWrites.count).toBe(0)
        expect(shell.commits).toHaveLength(0)
    })

    // Mechanism guard: a real Node page has no asset pipeline (`createRestoreAssetPipeline` is null off Tauri),
    // so this forces one onto a Node platform to prove the card reaches the files step with Cancel locked.
    test('BR-T9: an asset pipeline still writing after the walk reaches the files step with Cancel locked', async () => {
        const page = await bootPage('tauri')
        await (await import('src/ts/storage/store/appStore')).getAppStore()
        platformBox.isTauri = false
        platformBox.isNodeServer = true
        pipelineBox.mode = 'b64'
        pipelineBox.outstanding = true

        await runRestore(page, smallBin())

        const filesAt = rec.calls.findIndex((call) => call.kind === 'phase' && call.step === 'files')
        expect(filesAt, 'the files step is reported').toBeGreaterThanOrEqual(0)
        expect(rec.calls[filesAt].label).toBe(L.files())
        expect(rec.calls[filesAt].text).toBe(language.backupRestoreFinishingFiles)
        expect(rec.calls[filesAt].offered).toBe(false)
        expect(rec.calls.findIndex((call) => call.kind === 'bytes' && call.step === 'copy')).toBeLessThan(filesAt)
        expect(legacyWaitTexts()).toEqual([])
    })

    // RR: base opens no card, so a Cancel pressed by the person has nothing to act on.
    test('BR-C1: a Cancel during the save step ends on the cancelled card with the walk never started', async () => {
        const page = await bootPage('tauri')
        saveBox.onCheck = () => { page.task.requestTaskCancel() }

        await runRestore(page, smallBin())

        expect(page.task.taskResultShowing()).toBe(true)
        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(rec.calls.some((call) => call.kind === 'bytes' && call.step === 'check')).toBe(false)
        expect(assetWrites.count).toBe(0)
        expect(shell.commits).toHaveLength(0)
        expect(alertErrorMock).not.toHaveBeenCalled()
        page.task.answerTask({ kind: 'ok' })
        expect(page.task.taskShown()).toBe(false)
    })

    test('BR-C1b: Back during the save step cancels like the button', async () => {
        const page = await bootPage('tauri')
        saveBox.onCheck = () => { page.task.taskBackPress() }

        await runRestore(page, smallBin())

        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(shell.commits).toHaveLength(0)
    })

    // RR: base: the press is a no-op and the restore lands.
    test('BR-C2: a Cancel during the walk ends on the cancelled card, with no unreadable-file error and nothing written', async () => {
        const page = await bootPage('tauri')
        rec.hook = (call) => { if (call.kind === 'bytes' && call.step === 'check') { page.task.requestTaskCancel(); rec.hook = null } }

        await runRestore(page, manyBin())

        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(rec.calls.some((call) => call.kind === 'phase' && call.step === 'read')).toBe(false)
        expect(assetWrites.count).toBe(0)
        expect(shell.commits).toHaveLength(0)
    })

    // RR: base: the press is a no-op and the restore lands.
    test('BR-C3: a Cancel during the database read ends on the cancelled card with nothing written', async () => {
        const page = await bootPage('tauri')
        rec.hook = (call) => { if (call.kind === 'phase' && call.step === 'read') { page.task.requestTaskCancel() } }

        await runRestore(page, smallBin())

        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(rec.calls.some((call) => call.kind === 'lock')).toBe(false)
        expect(assetWrites.count).toBe(0)
        expect(shell.commits).toHaveLength(0)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    // RR: base: the press is a no-op and the restore lands.
    test('BR-C6: Cancel and Back during the copy are refused and the restore lands with no result card', async () => {
        const page = await bootPage('tauri')
        let during: { offered: boolean, state: string | null, result: boolean, backHandled: boolean } | null = null
        rec.hook = (call) => {
            if (call.kind === 'bytes' && call.step === 'copy' && during === null) {
                page.task.requestTaskCancel()
                const backHandled = page.task.taskBackPress()
                const view = page.task.taskHostView()
                during = { offered: view?.cancelOffered ?? true, state: view === null ? null : String(view.state), result: page.task.taskResultShowing(), backHandled }
            }
        }

        await runRestore(page, manyBin())

        expect(during).toMatchObject({ offered: false, state: 'running', result: false })
        expect(rec.calls.some((call) => call.kind === 'cancelled')).toBe(false)
        expect(shell.commits).toHaveLength(1)
        expect(page.task.taskShown()).toBe(false)
        expect(page.task.taskResultShowing()).toBe(false)
    })
})

describe('a .bin restore on a web page with other-tab locks', () => {
    /** Another exclusive restore can start afterwards: the hold and the write lock were both given back. */
    async function expectPageStillUsable(page: Page): Promise<void> {
        const release = await page.globalApi.dbWriteLock.acquire()
        release()
        const migration = await page.globalApi.acquireExclusiveStorageMigrationLock(200)
        expect(migration).not.toBeNull()
        await migration?.()
    }

    const dbOnlyBin = (): Uint8Array => concat([databaseChunk()])

    // RR: base: the press is a no-op and the restore lands.
    test('BR-C4: a Cancel at the other-tabs step releases the hold and ends on the cancelled card', async () => {
        const page = await bootPage('web', new FakeLockManagerCore())
        let atTabs: { label: string | null, offered: boolean } | null = null
        rec.hook = (call) => {
            if (call.kind === 'phase' && call.step === 'tabs') {
                atTabs = { label: call.label, offered: call.offered }
                page.task.requestTaskCancel()
            }
        }

        await runRestore(page, dbOnlyBin())

        // The other-tabs step is a named card step with Cancel offered, and no legacy wait dialog is posted.
        expect(atTabs).toEqual({ label: L.tabs(), offered: true })
        expect(legacyWaitTexts()).toEqual([])
        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(rec.calls.some((call) => call.kind === 'lock')).toBe(false)
        expect(shell.commits).toHaveLength(0)
        expect(assetWrites.count).toBe(0)
        await expectPageStillUsable(page)
    })

    // RR: base: the press is a no-op and the restore lands.
    test('BR-C5: a Cancel pressed in the unsaved-edits turn is honoured at the lock: nothing is written and the hold is released', async () => {
        const page = await bootPage('web', new FakeLockManagerCore())
        const { UnsavedGuard } = await import('src/ts/drive/storeImport')
        vi.spyOn(UnsavedGuard.prototype, 'check').mockImplementation(async () => {
            page.task.requestTaskCancel()
            return true
        })

        await runRestore(page, concat([buildChunk('small.png', new Uint8Array([1, 2, 3, 4])), databaseChunk()]))

        expect(page.task.taskHostView()?.cancelled).toBe(true)
        expect(rec.calls.find((call) => call.kind === 'lock')).toMatchObject({ step: 'refused' })
        expect(assetWrites.count).toBe(0)
        expect(shell.commits).toHaveLength(0)
        await expectPageStillUsable(page)
    })
})
