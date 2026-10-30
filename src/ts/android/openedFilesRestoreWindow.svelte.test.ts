// @vitest-environment happy-dom

/**
 * A file another Android app opens while an opened-file `.bin` restore is working. The native queue is process-wide and
 * outlives a page reload, so the only safe place for such a file is that queue until the restore ends:
 * - over one of the restore's own questions (the restore question, an inner question) the file is taken and refused at
 *   once with the busy pop-up, and the question comes back;
 * - after YES, over progress, a notice or a consent prompt, the file is neither taken nor refused. It stays queued: the
 *   same page drains it when the restore returns without ending the page, and the next page takes it after the reload;
 * - once a restore ended the page (a reload was requested or a write is unconfirmed) nothing is taken again.
 *
 * Real: `openedFiles.ts`, `restoreOpenedBackup`, `LoadLocalBackup` and the reload-mark module's contract (mocked as a flag).
 * Faked: the host, whose `take()` empties one queue shared by every module instance, and the page's alert store. A fresh
 * module instance stands for a fresh page. A mocked source and reload prove nothing about a content provider or a
 * WebView; the device re-check does.
 *
 * Titles starting `guard:` pass before and after the change. Every other test is red against the mutant or base behaviour
 * its assertion names.
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
const openSourceMock = vi.hoisted(() => vi.fn())
const readOnlyBox = vi.hoisted(() => ({ readOnly: false }))
const reloadMark = vi.hoisted(() => ({ marked: false, onMark: null as null | (() => void) }))
const importedMock = vi.hoisted(() => vi.fn(async (_batch: unknown): Promise<void> => { }))
const noticeMock = vi.hoisted(() => vi.fn(async (_message: string): Promise<void> => { }))
const pageStoreBox = vi.hoisted(() => ({ store: null as null | { set: (value: unknown) => void, subscribe: (run: (value: unknown) => void) => () => void } }))
const replaceBox = vi.hoisted(() => ({ unconfirmed: false }))

vi.mock(import('src/ts/reloadGuard'), () => ({
    markAppInitiatedReload: () => { reloadMark.marked = true; reloadMark.onMark?.() },
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

/** The write the restore ends with, replaced by an unconfirmed one when a test asks for it. */
vi.mock(import('src/ts/drive/restoreReplace'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        replaceWithRestoredSet: async (...args: Parameters<typeof original.replaceWithRestoredSet>) =>
            replaceBox.unconfirmed ? { kind: 'unconfirmed' as const } : await original.replaceWithRestoredSet(...args),
    }
})

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

import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from 'src/ts/drive/tests/restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import { resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'
import { alertStore as pageStore } from 'src/ts/stores.svelte'
import { createHostChannelFake, type HostChannelFake } from './hostChannelFake'

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

function binSource(): ImportSource {
    const bytes = smallBin()
    return {
        ...importSourceOfBytes('backup.bin', bytes),
        stat: async () => ({ size: bytes.length, modified: 1700000000000 }),
        close: async () => { },
    }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const settleFew = async () => { for (let i = 0; i < 8; i++) { await settle() } }
const settleLong = async () => { for (let i = 0; i < 4; i++) { await settleFew() } }

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

const shown = (): alertData => get(pageStore)
const setShown = (type: alertData['type']) => pageStore.set({ type, msg: type })

/** Every distinct refusal pop-up object the page store took. */
const refusalObjects = new Set<alertData>()
let stopRefusalWatch: () => void = () => { }
const refusalsSeen = (): number => refusalObjects.size

interface ConfirmStep {
    screen: alertData['type']
    gate?: Promise<void>
    answer: boolean
}
const confirmsAsked: string[] = []
/** The restore's confirmations in order: each puts its screen up, waits for its gate, then answers. */
function planConfirms(steps: ConfirmStep[]): void {
    alertConfirmMock.mockReset().mockImplementation(async (message: string) => {
        confirmsAsked.push(message)
        const step = steps.shift() ?? { screen: 'ask', answer: false }
        setShown(step.screen)
        if (step.gate) { await step.gate }
        setShown(step.answer ? 'wait' : 'none')
        return step.answer
    })
}
function gateOf(): { gate: Promise<void>, open: () => void } {
    let open: () => void = () => { }
    const gate = new Promise<void>((resolve) => { open = resolve })
    return { gate, open }
}

/** A source whose open is held until the test releases it. */
function heldSource(): { release: () => void } {
    const box = { release: () => { } }
    openSourceMock.mockImplementation(() => new Promise<ImportSource>((resolve) => { box.release = () => resolve(binSource()) }))
    return box
}

/** A source whose close is held until the test releases it: the window after the reload request. */
function heldClose(): { release: () => void, closeCalled: () => boolean } {
    let release: () => void = () => { }
    const gate = new Promise<void>((resolve) => { release = resolve })
    let called = false
    const source: ImportSource = { ...binSource(), close: async () => { called = true; await gate } }
    openSourceMock.mockImplementation(async () => source)
    return { release, closeCalled: () => called }
}

async function loadOpenedFiles(): Promise<typeof import('src/ts/android/openedFiles')> {
    return await import('src/ts/android/openedFiles')
}

//#endregion

let dbWriteLockSpy: ReturnType<typeof vi.spyOn>

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
    openSourceMock.mockReset()
    readOnlyBox.readOnly = false
    reloadMark.marked = false
    reloadMark.onMark = null
    replaceBox.unconfirmed = false
    native = []
    takes.length = 0
    confirmsAsked.length = 0
    const cold = await import('src/ts/process/coldstorage.svelte')
    vi.mocked(cold.confirmIncompleteColdStorageOperation).mockReset().mockResolvedValue(true)
    ;(await loadOpenedFiles()).resetOpenedFilesForTests()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ didFirstSetup: true, characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
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
    dbWriteLockSpy.mockRestore()
    delete window.__risuTaniumOpenedFilesHost
    delete window.__risuTaniumOpenedFiles
    vi.restoreAllMocks()
})

describe('a file opened during an opened-file restore', () => {
    test('R1: two batches over the restore question are taken and refused with one pop-up; YES restores the first backup and nobody asks about the others', async () => {
        const question = gateOf()
        planConfirms([{ screen: 'ask', gate: question.gate, answer: true }, { screen: 'ask', answer: false }])
        openSourceMock.mockImplementation(async () => binSource())
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => confirmsAsked.length >= 1)
        native.push(openedFile('bin1.bin'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        const first = { takes: takes.length, queued: native.length, refusals: refusalsSeen(), shown: shown().type }
        native.push(openedFile('bin3.bin'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        const second = { takes: takes.length, queued: native.length, refusals: refusalsSeen(), shown: shown().type }
        setShown('none')
        question.open()
        await waitForCondition(() => reloadMark.marked)
        await settleFew()
        expect(first, 'bin1 is taken and refused at once').toEqual({ takes: 2, queued: 0, refusals: 1, shown: 'error' })
        expect(second, 'bin3 is taken and joins the one pop-up').toEqual({ takes: 3, queued: 0, refusals: 1, shown: 'error' })
        expect(confirmsAsked, 'bin1 and bin3 are never asked about').toEqual([language.restoreOpenedBackupConfirm('bin2.bin')])
        expect(takes.filter((take) => take.markedThen), 'no take after the reload request').toEqual([])
    })

    test('empty take: a hook over the restore question that finds the queue empty shows nothing', async () => {
        const question = gateOf()
        planConfirms([{ screen: 'ask', gate: question.gate, answer: false }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => confirmsAsked.length >= 1)
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect(takes.length, 'the hook took').toBe(2)
        expect(refusalsSeen()).toBe(0)
        expect(shown().type).toBe('ask')
        question.open()
        await settleFew()
    })

    test('consent: a consent prompt on screen during the restore is not a restore question, so the file is not taken', async () => {
        const question = gateOf()
        planConfirms([{ screen: 'tos', gate: question.gate, answer: false }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => confirmsAsked.length >= 1)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect({ takes: takes.length, queued: native.length, refusals: refusalsSeen() }).toEqual({ takes: 1, queued: 1, refusals: 0 })
        question.open()
        await settleFew()
    })

    test('R4: a backup opened during the held source open after YES is not taken, before or after the reload request', async () => {
        const source = heldSource()
        planConfirms([{ screen: 'ask', answer: true }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => openSourceMock.mock.calls.length >= 1)
        native.push(openedFile('bin1.bin'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect({ takes: takes.length, queued: native.length }).toEqual({ takes: 1, queued: 1 })
        source.release()
        await waitForCondition(() => reloadMark.marked)
        await settleLong()
        expect(native.length, 'bin1 stays queued for the next page').toBe(1)
        expect(takes.filter((take) => take.markedThen), 'no take after the reload request').toEqual([])
    })

    test('R6: a hook after the reload request, before the restore returns, takes nothing, and the next page takes the file', async () => {
        const close = heldClose()
        planConfirms([{ screen: 'ask', answer: true }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(close.closeCalled)
        expect(reloadMark.marked, 'the reload was requested').toBe(true)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        close.release()
        await settleLong()
        expect(takes.filter((take) => take.markedThen), 'no take after the reload request').toEqual([])
        expect(importedMock, 'the card is not imported into the dying page').not.toHaveBeenCalled()
        expect(native.length, 'the card stays queued for the next page').toBe(1)
        vi.resetModules()
        reloadMark.marked = false
        const fresh = await loadOpenedFiles()
        fresh.androidOpenedFilesImport()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })

    test('R6f: a prompt from outside the restore on screen after the reload request: the card is deferred, not taken into the reloading page', async () => {
        const close = heldClose()
        planConfirms([{ screen: 'ask', answer: true }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(close.closeCalled)
        expect(reloadMark.marked, 'the reload was requested').toBe(true)
        setShown('pluginconfirm')
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        close.release()
        await settleLong()
        expect(takes.filter((take) => take.markedThen), 'no take after the reload request').toEqual([])
        expect(native.length, 'the card stays queued for the next page').toBe(1)
    })

    test('S1: an unconfirmed write ends the page: a card that arrived after YES is not taken or imported, and the closeless message stays', async () => {
        const source = heldSource()
        planConfirms([{ screen: 'ask', answer: true }])
        replaceBox.unconfirmed = true
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => openSourceMock.mock.calls.length >= 1)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        source.release()
        await waitForCondition(() => shown().msg === language.saveDamagedUnconfirmed)
        await settleLong()
        expect(setDatabaseMock).not.toHaveBeenCalled()
        expect(reloadMark.marked).toBe(false)
        expect(shown().type + ':' + shown().msg, 'the dead page keeps its closeless message').toBe('wait:' + language.saveDamagedUnconfirmed)
        expect(importedMock, 'the card is not imported into the dead page').not.toHaveBeenCalled()
        expect(native.length, 'the card stays in the native queue').toBe(1)
    })

    test('S1w: a card chained before the restore starts, then an unconfirmed ending: the dead page does not take it', async () => {
        // The hook fires in the turn the first drain starts, while it still awaits its dynamic import: the hook chains a
        // second drain behind it before the restore state is set.
        const source = heldSource()
        planConfirms([{ screen: 'ask', answer: true }])
        replaceBox.unconfirmed = true
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await Promise.resolve()
        await Promise.resolve()
        expect(confirmsAsked.length, 'the hook ran before the restore question').toBe(0)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await waitForCondition(() => openSourceMock.mock.calls.length >= 1)
        source.release()
        await waitForCondition(() => shown().msg === language.saveDamagedUnconfirmed)
        await settleLong()
        expect(shown().type + ':' + shown().msg).toBe('wait:' + language.saveDamagedUnconfirmed)
        expect(importedMock, 'the card is not imported into the dead page').not.toHaveBeenCalled()
        expect(native.length, 'the card stays in the native queue').toBe(1)
    })

    test('S1t: the restore lands and the reload request throws; a card that arrived after YES is not taken', async () => {
        // The throw goes through the mocked reload mark and stands in for any throw after the install.
        const source = heldSource()
        planConfirms([{ screen: 'ask', answer: true }])
        reloadMark.onMark = () => { throw new Error('scratch: mark failed after install') }
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => openSourceMock.mock.calls.length >= 1)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        source.release()
        await waitForCondition(() => setDatabaseMock.mock.calls.length >= 1)
        await settleLong()
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(shown().type + ':' + shown().msg).toBe('wait:' + language.restoreSavedReloadOrRestart)
        expect(importedMock, 'the card is not imported into the stale page').not.toHaveBeenCalled()
        expect(native.length, 'the card stays in the native queue').toBe(1)
    })

    test('S1t-drain: after that ending a later hook takes nothing', async () => {
        openSourceMock.mockImplementation(async () => binSource())
        planConfirms([{ screen: 'ask', answer: true }])
        reloadMark.onMark = () => { throw new Error('scratch: mark failed after install') }
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => setDatabaseMock.mock.calls.length >= 1)
        await settleLong()
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleLong()
        expect(importedMock).not.toHaveBeenCalled()
        expect(native.length, 'the card stays in the native queue').toBe(1)
    })

    test('R7: an inner question after YES: a card is refused at once, the refusal line is set while busy, and nothing is taken after the reload request', async () => {
        const cold = await import('src/ts/process/coldstorage.svelte')
        // The restore's busy entries live in the fresh module instance this page loads.
        const { busyRefusalLine, isBusy } = await import('src/ts/process/memory/busyActions')
        const inner = gateOf()
        let innerAsked = false
        vi.mocked(cold.confirmIncompleteColdStorageOperation).mockImplementation(async () => {
            innerAsked = true
            setShown('ask')
            await inner.gate
            setShown('wait')
            return true
        })
        openSourceMock.mockImplementation(async () => binSource())
        planConfirms([{ screen: 'ask', answer: true }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => innerAsked)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        const during = { takes: takes.length, queued: native.length, refusals: refusalsSeen(), line: get(busyRefusalLine), busy: isBusy() }
        setShown('none')
        inner.open()
        await waitForCondition(() => reloadMark.marked)
        await settleFew()
        expect(during).toEqual({ takes: 2, queued: 0, refusals: 1, line: language.backupLoadRefusedLine, busy: true })
        expect(importedMock).not.toHaveBeenCalled()
        expect(takes.filter((take) => take.markedThen), 'no take after the reload request').toEqual([])
    })

    test('guard: a card deferred after YES, then the inner question is declined: the same page imports it', async () => {
        const cold = await import('src/ts/process/coldstorage.svelte')
        const source = heldSource()
        vi.mocked(cold.confirmIncompleteColdStorageOperation).mockImplementation(async () => false)
        planConfirms([{ screen: 'ask', answer: true }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => openSourceMock.mock.calls.length >= 1)
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect({ takes: takes.length, queued: native.length }).toEqual({ takes: 1, queued: 1 })
        source.release()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        await settleFew()
        expect(reloadMark.marked).toBe(false)
        expect(importedMock, 'imported in the same page').toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })

    test('guard: after NO the restore state is cleared: a later hook drains at once and imports the card', async () => {
        planConfirms([{ screen: 'ask', answer: false }])
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => confirmsAsked.length >= 1)
        await settleFew()
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        expect(importedMock).toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })

    test('U1: a reload mark set for an unrelated reason while the restore question is on screen: the card is deferred; after NO the same page imports it once', async () => {
        const question = gateOf()
        planConfirms([{ screen: 'ask', gate: question.gate, answer: false }])
        openSourceMock.mockImplementation(async () => binSource())
        native = [openedFile('bin2.bin')]
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => confirmsAsked.length >= 1)
        reloadMark.marked = true
        native.push(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await settleFew()
        expect({ takes: takes.length, queued: native.length, refusals: refusalsSeen(), shown: shown().type }, 'deferred while the mark is set').toEqual({ takes: 1, queued: 1, refusals: 0, shown: 'ask' })
        question.open()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        await settleFew()
        expect(importedMock, 'imported once after NO').toHaveBeenCalledTimes(1)
        expect(native.length).toBe(0)
    })
})

/**
 * The same window over the host channel. The host keeps what a take handed over until the page confirms it, so a reply that
 * arrives after the restore moved on replaces nothing and the files are offered again; the replies here are sent by the test
 * so it controls when each one lands.
 */
describe('a file opened during an opened-file restore, over the host channel', () => {
    let fake: HostChannelFake
    let queue: { seq: number, batch: NativeBatch }[]
    let lastSeq: number
    let answered: number

    const enqueue = (batch: NativeBatch) => { queue.push({ seq: ++lastSeq, batch }) }
    const takesAsked = () => fake.postedTo('openedFiles', 'take').length
    const confirmsSent = () => fake.postedTo('openedFiles', 'confirm').map((message) => (message.args as number[])[0])
    /** The host answers the oldest unanswered take with everything it still holds. */
    const answerNextTake = async () => {
        expect(takesAsked(), 'the take the host answers was sent').toBeGreaterThan(answered)
        const id = fake.postedTo('openedFiles', 'take')[answered++].id
        fake.deliver(JSON.stringify({ id, result: queue.map((item) => item.batch), through: queue.length > 0 ? queue[queue.length - 1].seq : 0 }))
        await settleFew()
    }

    beforeEach(() => {
        delete window.__risuTaniumOpenedFilesHost
        queue = []
        lastSeq = 0
        answered = 0
        fake = createHostChannelFake()
        fake.channel.postMessage.mockImplementation((message: string) => {
            const parsed = JSON.parse(message) as { method: string, args: number[] }
            if (parsed.method === 'confirm') {
                queue = queue.filter((item) => item.seq > parsed.args[0])
            }
        })
        window.__risuTaniumHost = fake.channel
    })

    afterEach(() => {
        delete window.__risuTaniumHost
    })

    /** A restore question is up and a card has arrived over it, so a take for the refusal is waiting for its reply. */
    async function cardArrivesOverTheQuestion() {
        const question = gateOf()
        planConfirms([{ screen: 'ask', gate: question.gate, answer: false }])
        enqueue(openedFile('bin2.bin'))
        const { androidOpenedFilesImport } = await loadOpenedFiles()
        androidOpenedFilesImport()
        await waitForCondition(() => takesAsked() >= 1)
        await answerNextTake()
        await waitForCondition(() => confirmsAsked.length >= 1)
        enqueue(openedFile('card1.charx'))
        window.__risuTaniumOpenedFiles?.()
        await waitForCondition(() => takesAsked() >= 2)
        return question
    }

    test('a reply that lands after a consent prompt replaced the question confirms nothing and refuses nothing; the card is taken again after the restore', async () => {
        const question = await cardArrivesOverTheQuestion()
        setShown('tos')
        await answerNextTake()
        expect({ confirms: confirmsSent(), refusals: refusalsSeen(), shown: shown().type }, 'the late reply replaces nothing').toEqual({ confirms: [1], refusals: 0, shown: 'tos' })
        expect(importedMock).not.toHaveBeenCalled()

        question.open()
        await waitForCondition(() => takesAsked() >= 3)
        await answerNextTake()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        expect(importedMock).toHaveBeenCalledWith([{ name: 'card1.charx', path: 'content://p/card1.charx' }])
        expect(confirmsSent(), 'the card is confirmed by the take after the restore').toEqual([1, 2])
    })

    test('a reply that lands after the restore ended confirms nothing yet; the card is taken again and imported in the same page', async () => {
        const question = await cardArrivesOverTheQuestion()
        question.open()
        await settleFew()
        await answerNextTake()
        expect(confirmsSent(), 'the late reply confirms nothing').toEqual([1])
        expect(refusalsSeen()).toBe(0)

        await waitForCondition(() => takesAsked() >= 3)
        await answerNextTake()
        await waitForCondition(() => importedMock.mock.calls.length >= 1)
        expect(importedMock).toHaveBeenCalledWith([{ name: 'card1.charx', path: 'content://p/card1.charx' }])
        expect(confirmsSent()).toEqual([1, 2])
    })

    test('a reply that lands with the question still up refuses the card with one pop-up and confirms it', async () => {
        const question = await cardArrivesOverTheQuestion()
        await answerNextTake()
        expect({ confirms: confirmsSent(), refusals: refusalsSeen(), shown: shown().type }).toEqual({ confirms: [1, 2], refusals: 1, shown: 'error' })
        expect(importedMock).not.toHaveBeenCalled()
        setShown('none')
        question.open()
        await settleFew()
        expect(takesAsked(), 'a confirmed card is not taken again').toBe(2)
    })
})
