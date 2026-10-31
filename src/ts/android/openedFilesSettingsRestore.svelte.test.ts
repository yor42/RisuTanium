// @vitest-environment happy-dom

/**
 * A file another Android app opens while a Settings `.bin` restore (`restoreFromBinFile`) is under way. The native queue is
 * process-wide and outlives a page reload, so the only safe place for such a file is that queue until the restore ends:
 * - over one of the restore's own questions (a confirmation) the file is taken and refused at once with the busy pop-up;
 * - while no question is on screen (the system picker) or the restore works, the file is neither taken nor refused: the
 *   same page drains it when the restore ends live, and the next page takes it after a landed restore.
 *
 * Real: `openedFiles.ts`, `settingsRestore.ts`, `restoreInProgress.ts`, `backuplocal.ts` (`LoadLocalBackup`, with its real
 * file input) and the reload-mark module's contract (mocked as a flag). Faked: the host, whose `take()` empties one queue
 * shared by every module instance, the page's alert store and the confirmation dialog. A fresh module instance stands for
 * a fresh page. A mocked source and reload prove nothing about a content provider or a WebView; the device re-check does.
 *
 * Titles starting `guard:` pass before and after the change. Every other test is red against the base behaviour its
 * assertion names.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { get, writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { alertData } from 'src/ts/alert'

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
const reloadMark = vi.hoisted(() => ({ marked: false }))
const importedMock = vi.hoisted(() => vi.fn(async (_batch: unknown): Promise<void> => { }))
const noticeMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
const pageStoreBox = vi.hoisted(() => ({ store: null as null | { set: (value: unknown) => void, subscribe: (run: (value: unknown) => void) => () => void } }))

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
    importOpenedSources: importedMock,
    isOpenedSourceImportable: (name: string) => /\.(charx|risum|risup)$/i.test(name),
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
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

// Imported first: it settles the module cycle between the store, the save format and the global API.
import 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from 'src/ts/drive/tests/restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const settleFew = async () => { for (let i = 0; i < 8; i++) { await settle() } }

async function waitForCondition(condition: () => boolean): Promise<boolean> {
    for (let i = 0; i < 600; i++) {
        if (condition()) { return true }
        await settle()
    }
    return condition()
}

interface NativeFile {
    uri: string
    name: string
}
type NativeBatch = NativeFile[]

/** The process-wide native queue: it survives a fresh module instance, as it survives a page reload. */
let native: NativeBatch[] = []
const takes: { markedThen: boolean }[] = []
const fakeHost = {
    take: (): string => {
        takes.push({ markedThen: reloadMark.marked })
        const payload = JSON.stringify(native)
        native = []
        return payload
    },
}
const openedFile = (name: string): NativeBatch => [{ uri: 'content://p/' + name, name }]

const setShown = (type: alertData['type']) => pageStore.set({ type, msg: type })

/** Every distinct refusal pop-up object the page store took. */
const refusalObjects = new Set<alertData>()
let stopRefusalWatch: () => void = () => { }
const refusalsSeen = (): number => refusalObjects.size

function gateOf(): { gate: Promise<void>, open: () => void } {
    let open: () => void = () => { }
    const gate = new Promise<void>((resolve) => { open = resolve })
    return { gate, open }
}

async function loadOpenedFiles(): Promise<typeof import('src/ts/android/openedFiles')> {
    return await import('src/ts/android/openedFiles')
}

//#endregion

beforeEach(async () => {
    vi.resetModules()
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
    alertConfirmMock.mockReset().mockResolvedValue(true)
    noticeMock.mockClear()
    importedMock.mockClear()
    reloadMark.marked = false
    native = []
    takes.length = 0
    ;(await loadOpenedFiles()).resetOpenedFilesForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ didFirstSetup: true, characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    window.__risuTaniumOpenedFilesHost = fakeHost
    window.__risuTaniumOpenedFiles = undefined
    setShown('none')
    refusalObjects.clear()
    stopRefusalWatch = pageStore.subscribe((value) => {
        if (value.type === 'error' && value.msg === language.backupLoadWorkInProgress) { refusalObjects.add(value) }
    })
})

afterEach(() => {
    stopRefusalWatch()
    resetStartupCleanupForTests()
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

/**
 * The Settings `.bin` restore as the button runs it: `restoreFromBinFile` of the page instance under test, up to the
 * system picker. `choose` hands the picker a file and fires its change event; `cancel` fires the picker's cancel event.
 */
async function startSettingsRestore(): Promise<{ done: Promise<void>, choose: (bytes: Uint8Array) => Promise<void>, cancel: () => void }> {
    const { restoreFromBinFile } = await import('src/ts/drive/settingsRestore')
    let captured: HTMLInputElement | null = null
    const realCreateElement = document.createElement.bind(document)
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') { captured = el as HTMLInputElement }
        return el
    }) as typeof document.createElement)
    let done: Promise<void>
    try {
        done = restoreFromBinFile()
        await waitForCondition(() => captured !== null)
    } finally {
        spy.mockRestore()
    }
    const input = captured as HTMLInputElement | null
    if (!input) { throw new Error('the restore flow did not reach the file input') }
    return {
        done,
        choose: async (bytes) => {
            const file = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'backup.bin')
            Object.defineProperty(input, 'files', { value: [file], configurable: true })
            await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
        },
        cancel: () => { input.dispatchEvent(new Event('cancel')) },
    }
}

/** Holds the restore's working phase: the restore waits here for the write lock, with its backupLoad entry registered. */
async function holdWorkingPhase(options: { thenFail?: boolean } = {}): Promise<{ reached: () => boolean, open: () => void }> {
    // The lock of the module instance this test's restore will load.
    const { dbWriteLock: pageLock } = await import('src/ts/globalApi.svelte')
    const g = gateOf()
    let reached = false
    vi.spyOn(pageLock, 'acquire').mockImplementation(async () => {
        reached = true
        await g.gate
        if (options.thenFail) { throw new Error('the write lock was lost') }
        return () => { }
    })
    return { reached: () => reached, open: g.open }
}

describe('a card opened on Android during a Settings .bin restore', () => {
    test('guard: with no restore running, a card is taken and imported (positive control)', async () => {
        native = [openedFile('card1.charx')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })

    test('R-A: during the working phase the card is neither taken nor imported', async () => {
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        const { isBusy, busyKinds } = await import('src/ts/process/memory/busyActions')
        androidOpenedFilesImport()
        await settleFew()
        const hold = await holdWorkingPhase()
        const restore = await startSettingsRestore()
        const choosing = restore.choose(smallBin())
        await waitForCondition(hold.reached)
        // Precondition: the restore is in its working phase with its own busy entry.
        expect({ reached: hold.reached(), busy: busyKinds() }).toEqual({ reached: true, busy: ['backupLoad'] })
        expect(isBusy()).toBe(true)
        const baseline = takes.length
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        const during = { takes: takes.length - baseline, imported: importedMock.mock.calls.length, queued: native.length }
        hold.open()
        await choosing
        await restore.done
        // Positive pairing: the restore did land, so a "not imported" reading is not a restore that never ran.
        expect(setDatabaseMock, 'the restore installed its database').toHaveBeenCalled()
        expect(reloadMark.marked, 'the restore requested its reload').toBe(true)
        expect(during, 'what the hook did while the restore worked').toEqual({ takes: 0, imported: 0, queued: 1 })
    })

    test('R-A+: a restore that ends live imports the card that waited for it, once', async () => {
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await settleFew()
        const hold = await holdWorkingPhase({ thenFail: true })
        const restore = await startSettingsRestore()
        const choosing = restore.choose(smallBin())
        await waitForCondition(hold.reached)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(importedMock, 'nothing is imported while the restore works').not.toHaveBeenCalled()
        hold.open()
        await choosing
        await restore.done
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        await settleFew()
        expect(setDatabaseMock, 'the restore did not land').not.toHaveBeenCalled()
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })

    test('R-D: after a landed restore requested its reload, a card opened before the page dies is not taken', async () => {
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await settleFew()
        const restore = await startSettingsRestore()
        await restore.choose(smallBin())
        await restore.done
        expect(setDatabaseMock, 'the restore installed its database').toHaveBeenCalled()
        expect(reloadMark.marked, 'the reload was requested').toBe(true)
        const baseline = takes.length
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        const after = { takes: takes.length - baseline, takesMarked: takes.filter((t) => t.markedThen).length, imported: importedMock.mock.calls.length, queued: native.length }
        expect(after, 'what the hook did on the page that is ending').toEqual({ takes: 0, takesMarked: 0, imported: 0, queued: 1 })
    })

    test('R-W3: while the picker is open the card stays queued without a pop-up, and imports once when the picker is cancelled', async () => {
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await settleFew()
        const restore = await startSettingsRestore()
        // The picker is up and no question is on screen.
        const baseline = takes.length
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        const during = { takes: takes.length - baseline, imported: importedMock.mock.calls.length, queued: native.length, refusals: refusalsSeen() }
        restore.cancel()
        await restore.done
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        await settleFew()
        expect(during, 'what the hook did while the picker was open').toEqual({ takes: 0, imported: 0, queued: 1, refusals: 0 })
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })

    test('R-B: over the restore question the card is taken and refused with one pop-up, and never imported', async () => {
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await settleFew()
        const second = gateOf()
        let secondUp = false
        alertConfirmMock.mockReset()
            .mockImplementationOnce(async () => true)
            .mockImplementationOnce(async () => {
                secondUp = true
                setShown('ask')
                await second.gate
                setShown('none')
                return true
            })
        const { restoreFromBinFile } = await import('src/ts/drive/settingsRestore')
        const flow = restoreFromBinFile()
        await waitForCondition(() => secondUp)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await waitForCondition(() => refusalsSeen() >= 1)
        await settleFew()
        const during = { refusals: refusalsSeen(), imported: importedMock.mock.calls.length, queued: native.length }
        second.open()
        await settleFew()
        expect(during, 'what the hook did over the question').toEqual({ refusals: 1, imported: 0, queued: 0 })
        expect(importedMock).not.toHaveBeenCalled()
        // End the flow: the picker is up now.
        void flow
    })
})
