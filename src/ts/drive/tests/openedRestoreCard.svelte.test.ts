// @vitest-environment happy-dom

/**
 * `restoreOpenedBackup` on the task card (S6d-4, MC-2804/2805): the start-up clean-up wait is a card with Cancel, a Cancel
 * there or in the turn the clean-up settles ends on "Cancelled - Nothing was changed" with nothing opened, and the routed
 * restore opens its own card. Same harness as `restoreOpenedBackup.svelte.test.ts`; a mocked source is not evidence about a
 * content provider.
 *
 * Labels: a reproducer (red against the mutant its comment names) unless titled `guard:`.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

const platformBox = vi.hoisted(() => {
    Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    return { isTauri: true }
})
const osBox = vi.hoisted(() => ({ os: 'android' }))
type FakeFs = ReturnType<typeof import('src/ts/storage/tests/tauriFsFake').createFakeTauriFs>
type DesktopFake = ReturnType<typeof import('src/ts/storage/tests/tauriDesktopFake').createDesktopInvoke>
// Built inside the plugin-fs factory: a dynamic import in a hoisted call does not survive the transform of a
// `.svelte.test.ts` module, while one inside a mock factory runs lazily.
const harness = vi.hoisted(() => ({ made: {} as { fs: FakeFs, desktop: DesktopFake } }))

const getDatabaseMock = vi.hoisted(() => vi.fn(() => ({}) as unknown as Database))
const setDatabaseMock = vi.hoisted(() => vi.fn())
const alertErrorMock = vi.hoisted(() => vi.fn())
const alertConfirmMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<boolean> => true))
const alertWaitMock = vi.hoisted(() => vi.fn())
// Forwards to the real `requestSaveNow`; it only records whether the restore's save-first step asked for a save.
const requestSaveNowMock = vi.hoisted(() => vi.fn())
const openSourceMock = vi.hoisted(() => vi.fn())
const readOnlyBox = vi.hoisted(() => ({ readOnly: false }))
const reloadMark = vi.hoisted(() => ({ marked: false }))
// Called at every save-clean check of the restore's save-first step; a test presses Cancel from it.
const saveBox = vi.hoisted(() => ({ onCheck: null as null | (() => void) }))
const runRtbMock = vi.hoisted(() => vi.fn<(picked: import('src/ts/drive/rtbRestorePlan').PickedRtb, deps?: Partial<import('src/ts/drive/rtbRestoreEntry').RtbRestoreDeps>, run?: import('src/ts/drive/rtbRestoreEntry').RtbRunOptions) => Promise<{ outcome: import('src/ts/drive/operationEnd').OperationOutcome, cause: null }>>())

// The `.rtb` restore itself is replaced; the helper that builds its argument stays real.
vi.mock('src/ts/drive/rtbRestoreEntry', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/drive/rtbRestoreEntry')>()
    return { ...original, runRtbRestore: runRtbMock }
})

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
    isNodeServer: false,
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
            await store.write(entry.key, entry.data, 'unconditional')
            results.push({ k: 'ok' })
        }
        return results
    }
    return {
        ...original,
        writeAssetBatch: (entries: readonly { key: string, data: Uint8Array }[]) => run(entries),
        writeAssetBatchB64: (entries: readonly { key: string, data: Uint8Array }[]) => run(entries),
    }
})

vi.mock(import('src/ts/importSource'), async (importOriginal) => {
    const original = await importOriginal()
    return { ...original, openDesktopImportSource: openSourceMock } as unknown as typeof import('src/ts/importSource')
})

vi.mock(import('src/ts/storage/readOnlyPage'), () => ({
    refuseOnReadOnlyPage: async () => readOnlyBox.readOnly,
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
    alertStore: writable({ type: 'none', msg: '' }),
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
    alertNormalWait: vi.fn(async () => { }),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: async (command: string, args?: unknown, options?: unknown) =>
        (harness.made.desktop.invoke as (command: string, args?: unknown, options?: unknown) => Promise<unknown>)(command, args, options),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
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
    hasher: vi.fn((s: string) => s),
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
    updateLorebooks: vi.fn((v: unknown) => v),
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

const shell = vi.hoisted((): Store2ShellBox => ({ commits: [], events: [] }))

vi.mock(import('src/ts/drive/storeImport'), (importOriginal) => store2ShellMock(shell)(importOriginal))

// The real `globalApi.svelte` (the write lock stays real) with one answer fixed: a clean page, so the restore's
// save-first step returns at its clean check and the unsaved-edits question is not asked.
vi.mock(import('src/ts/globalApi.svelte'), async (importOriginal) => {
    const original = await importOriginal()
    requestSaveNowMock.mockImplementation(original.requestSaveNow)
    return {
        ...original,
        isSaveClean: () => {
        saveBox.onCheck?.()
        return true
    },
        requestSaveNow: requestSaveNowMock,
    }
})

//#endregion

import { resetStore2ShellBox, store2ShellMock, useStore2RestorePage, type Store2ShellBox } from './store2ShellStub'
import { restoreOpenedBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { requestTaskCancel, resetTaskHostForTests, taskHostView, taskResultShowing, taskShown } from 'src/ts/alertTask.svelte'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import type { OperationOutcome } from 'src/ts/drive/operationEnd'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import { recordStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { resetRestoreInProgressForTests, restorePhase } from 'src/ts/drive/restoreInProgress'

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

/** A `.bin` with one asset and the database entry. */
function smallBin(): Uint8Array {
    const database = { characters: [], personas: [], characterOrder: [], botPresets: [] } as unknown as Database
    const chunks = [
        buildChunk('small.png', new Uint8Array([1, 2, 3, 4])),
        buildChunk('database.risudat', encodeRisuSaveLegacy(database, 'noCompression')),
    ]
    const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        out.set(chunk, offset)
        offset += chunk.length
    }
    return out
}

interface Probe {
    source: ImportSource
    closed: () => number
    reads: () => number
}

interface ProbeOptions {
    statThrows?: boolean
    modified?: number | null
    /** What the very first read does: reject, or return 10 bytes however many were asked; later reads are normal. */
    firstRead?: 'reject' | 'short'
    /** Called at the first read, before it is served. */
    onFirstRead?: () => void
}

function probeSource(bytes: Uint8Array, options: ProbeOptions = {}): Probe {
    const inner = importSourceOfBytes('backup.bin', bytes)
    let closes = 0
    let reads = 0
    let statCalls = 0
    const source: ImportSource = {
        ...inner,
        read: async (start, end) => {
            reads++
            if (reads === 1) {
                options.onFirstRead?.()
                if (options.firstRead === 'reject') {
                    throw new Error('scratch: first read failed')
                }
                if (options.firstRead === 'short') {
                    return await inner.read(start, start + 10)
                }
            }
            return await inner.read(start, end)
        },
        stat: async () => {
            // Only the first call fails: it is the one that asks for the modification time; the restore's own change checks
            // (which refuse a file whose stat fails) come later.
            if (options.statThrows && statCalls++ === 0) {
                throw new Error('scratch: stat failed')
            }
            return { size: bytes.length, modified: options.modified === undefined ? 1700000000000 : options.modified }
        },
        close: async () => { closes++ },
    }
    return { source, closed: () => closes, reads: () => reads }
}

const entry = { name: 'My Backup.bin', path: 'content://provider/document/primary%3ADownload%2Fzz-uri-tail.bin' }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function expectNothingInstalled(): void {
    expect(shell.commits).toEqual([])
    expect(setDatabaseMock).not.toHaveBeenCalled()
    expect(harness.made.fs.files.has('blocks/head')).toBe(false)
    expect([...harness.made.fs.files.keys()].some((key) => key.startsWith('assets/'))).toBe(false)
    expect(reloadMark.marked).toBe(false)
}

//#endregion

let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    platformBox.isTauri = true
    osBox.os = 'android'
    harness.made.desktop.reset()
    resetByteTransportForTests()
    resetAssetBatchAvailabilityForTests()
    resetStartupCleanupForTests()
    harness.made.fs.reset()
    harness.made.fs.directories.add('assets')
    setDatabaseMock.mockReset()
    alertErrorMock.mockReset()
    alertWaitMock.mockReset()
    requestSaveNowMock.mockClear()
    saveBox.onCheck = null
    alertConfirmMock.mockReset().mockResolvedValue(true)
    openSourceMock.mockReset()
    runRtbMock.mockReset()
    readOnlyBox.readOnly = false
    reloadMark.marked = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    resetStore2ShellBox(shell)
    useStore2RestorePage(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    // The restore's save-first step returned at its clean check; it never asked for a save or waited out its bound.
    expect(requestSaveNowMock).not.toHaveBeenCalled()
    resetTaskHostForTests()
    resetBusyActionsForTest()
    resetRestoreInProgressForTests()
    resetStartupCleanupForTests()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

function expectNothingOpened(): void {
    expect(openSourceMock).not.toHaveBeenCalled()
    expectNothingInstalled()
}

/** A sealed `.rtb` header (`RTBX`, its line-ending guard bytes and a version): classified `rtb` whatever the file is named. */
function sealedRtb(): Uint8Array {
    return new Uint8Array([0x52, 0x54, 0x42, 0x58, 0x0D, 0x0A, 0x1A, 0x0A, 1, 0, 9, 9, 9, 9, 9, 9])
}

describe('restoreOpenedBackup on the task card', () => {
    // OC1. Reproducer: red against the legacy route, which posts the wait dialog and shows no card.
    test('OC1: a Cancel during the start-up clean-up ends on the cancelled card, opens nothing and returns pageLive', async () => {
        recordStartupCleanup(new Promise<void>(() => { }))
        const running = restoreOpenedBackup(entry)
        await settle()

        const view = taskHostView()
        expect(view?.steps[view.stepIndex]?.label).toBe(language.restoreStepCleanup)
        expect(view?.cancelOffered).toBe(true)
        expect(alertWaitMock).not.toHaveBeenCalledWith(language.internalBackupWaitingForCleanup, expect.any(Function))

        requestTaskCancel()
        await expect(running).resolves.toBe('pageLive')

        expect(taskResultShowing()).toBe(true)
        expect(taskHostView()?.cancelled).toBe(true)
        expectNothingOpened()
        expect(restorePhase()).toBe('none')
    })

    // OC2. Reproducer: red against an open-with that trusts the race winner over the token (M-C11): the clean-up settled
    // first, so only the token tells that Cancel was pressed.
    test('OC2: a Cancel in the turn the clean-up settles wins over the settled clean-up', async () => {
        let finish: () => void = () => { }
        recordStartupCleanup(new Promise<void>((resolve) => { finish = resolve }))
        openSourceMock.mockResolvedValue(probeSource(smallBin()).source)
        const running = restoreOpenedBackup(entry)
        await settle()
        expect(taskHostView()?.cancelOffered).toBe(true)

        finish()
        queueMicrotask(() => requestTaskCancel())
        await expect(running).resolves.toBe('pageLive')

        expect(taskHostView()?.cancelled).toBe(true)
        expectNothingOpened()
    })

    // OC3. Reproducer: red against the legacy route, which has no card at the save step and lands the restore.
    test('OC3: a Cancel at the routed card\'s save step ends cancelled, closes the source once and returns pageLive', async () => {
        const probe = probeSource(smallBin())
        openSourceMock.mockResolvedValue(probe.source)
        saveBox.onCheck = () => {
            if (taskShown()) {
                saveBox.onCheck = null
                requestTaskCancel()
            }
        }

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')

        expect(taskResultShowing()).toBe(true)
        expect(taskHostView()?.cancelled).toBe(true)
        expect(probe.closed()).toBe(1)
        expectNothingInstalled()
        expect(restorePhase()).toBe('none')
    })

    // OC4. Reproducer: red against a card route that still posts the loading wait after the clean-up (M-D30).
    test('OC4: a landed open-with restore after a clean-up posts no loading wait and ends the page', async () => {
        let finish: () => void = () => { }
        recordStartupCleanup(new Promise<void>((resolve) => { finish = resolve }))
        openSourceMock.mockResolvedValue(probeSource(smallBin()).source)
        const running = restoreOpenedBackup(entry)
        await settle()

        finish()
        await expect(running).resolves.toBe('pageEnding')

        expect(alertWaitMock).not.toHaveBeenCalledWith(language.backupRestoreLoading)
        expect(alertWaitMock).toHaveBeenCalledWith(language.store2ImportDone)
        expect(shell.commits).toHaveLength(1)
        expect(taskShown()).toBe(false)
        expect(taskResultShowing()).toBe(false)
    })
})

describe('routeOpenedBackup with no route', () => {
    // OC5. Compatibility guard: passes before and after; the card route is opt-in, so a caller that passes no route keeps
    // today's plain calls.
    test('OC5: the .bin restore opens no card and the .rtb restore is called with the file alone', async () => {
        const { routeOpenedBackup } = await import('src/ts/drive/backupRouter')
        const shownAtSave: boolean[] = []
        saveBox.onCheck = () => { shownAtSave.push(taskShown()) }
        const bin = probeSource(smallBin())
        await routeOpenedBackup({ source: bin.source, name: 'a.bin', lastModified: 0 })
        expect(shownAtSave.length).toBeGreaterThan(0)
        expect(shownAtSave.every((shown) => !shown)).toBe(true)
        expect(shell.commits).toHaveLength(1)

        runRtbMock.mockResolvedValue({ outcome: 'canceled', cause: null })
        const rtb = probeSource(sealedRtb())
        await routeOpenedBackup({ source: rtb.source, name: 'b.rtb', lastModified: 0 })
        expect(runRtbMock).toHaveBeenCalledTimes(1)
        expect(runRtbMock.mock.calls[0]).toHaveLength(1)
    })

    // Reproducer: red against a router that ignores the route (M-D13 for the opened route).
    test('with the card route the .rtb restore is called with the card option', async () => {
        const { routeOpenedBackup } = await import('src/ts/drive/backupRouter')
        runRtbMock.mockResolvedValue({ outcome: 'canceled', cause: null })
        const rtb = probeSource(sealedRtb())
        await routeOpenedBackup({ source: rtb.source, name: 'b.rtb', lastModified: 0 }, {}, { card: true })
        expect(runRtbMock.mock.calls[0].slice(1)).toEqual([{}, { card: true }])
    })
})