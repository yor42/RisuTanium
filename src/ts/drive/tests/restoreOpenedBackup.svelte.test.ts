// @vitest-environment happy-dom

/**
 * `restoreOpenedBackup`: the entry for a `.bin` another Android app opened. It asks once, naming the file, before it
 * opens or writes anything; a busy app, a read-only page and a decline each end it first. The restore itself is
 * `LoadLocalBackup(undefined, opened)` under that call's own busy entry, so this entry must not hold one (it would refuse
 * the very restore it starts). Same harness as `backuplocalOpenedSource.test.ts`; a mocked source is not evidence about a
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
const openSourceMock = vi.hoisted(() => vi.fn())
const readOnlyBox = vi.hoisted(() => ({ readOnly: false }))
const reloadMark = vi.hoisted(() => ({ marked: false }))

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
        listColdDataKeys: vi.fn(async () => []),
        setColdStorageItem: vi.fn(async () => true),
    } as unknown as typeof import('src/ts/process/coldstorage.svelte')
})

//#endregion

import { restoreOpenedBackup } from 'src/ts/drive/backuplocal'
import { dbWriteLock } from 'src/ts/globalApi.svelte'
import { language } from 'src/lang'
import { encodeRisuSaveLegacy } from 'src/ts/storage/risuSave'
import { injectRestoreStore } from './restoreSupport'
import { createTauriFilesStore } from 'src/ts/storage/store/tauriFilesStore'
import { resetByteTransportForTests } from 'src/ts/storage/tauriByteTransport'
import { resetAssetBatchAvailabilityForTests } from 'src/ts/storage/tauriAssetBatch'
import { beginBusy, resetBusyActionsForTest } from 'src/ts/process/memory/busyActions'
import { importSourceOfBytes, type ImportSource } from 'src/ts/importSource'
import { recordStartupCleanup, resetStartupCleanupForTests } from 'src/ts/storage/startupCleanupState'

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

function probeSource(bytes: Uint8Array, options: { statThrows?: boolean, modified?: number | null } = {}): Probe {
    const inner = importSourceOfBytes('backup.bin', bytes)
    let closes = 0
    let reads = 0
    let statCalls = 0
    const source: ImportSource = {
        ...inner,
        read: async (start, end) => {
            reads++
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
    alertConfirmMock.mockReset().mockResolvedValue(true)
    openSourceMock.mockReset()
    readOnlyBox.readOnly = false
    reloadMark.marked = false
    vi.spyOn(console, 'error').mockImplementation(() => { })
    injectRestoreStore(createTauriFilesStore({ platform: 'posix' }))
    getDatabaseMock.mockImplementation(() => ({ characters: [], personas: [], characterOrder: [], botPresets: [] }) as unknown as Database)
    dbWriteLockSpy = vi.spyOn(dbWriteLock, 'acquire').mockResolvedValue(() => { })
})

afterEach(() => {
    resetBusyActionsForTest()
    resetStartupCleanupForTests()
    dbWriteLockSpy.mockRestore()
    vi.restoreAllMocks()
})

describe('restoreOpenedBackup', () => {
    // Reproducer: red against the mutant that takes a busy entry before calling LoadLocalBackup, which then
    // refuses its own caller with the busy message.
    test('with nothing busy the restore reaches the walk and the install, and is not refused as busy', async () => {
        const probe = probeSource(smallBin())
        openSourceMock.mockResolvedValue(probe.source)

        await restoreOpenedBackup(entry)

        expect(alertErrorMock).not.toHaveBeenCalledWith(language.backupLoadWorkInProgress)
        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(probe.reads()).toBeGreaterThan(0)
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(reloadMark.marked).toBe(true)
        expect(probe.closed()).toBe(1)
    })

    test('the confirmation names the file by its display name, not the URI tail', async () => {
        openSourceMock.mockResolvedValue(probeSource(smallBin()).source)

        await restoreOpenedBackup(entry)

        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        const asked = alertConfirmMock.mock.calls[0][0]
        expect(asked).toBe(language.restoreOpenedBackupConfirm('My Backup.bin'))
        expect(asked).toContain('My Backup.bin')
        expect(asked).not.toContain('zz-uri-tail')
    })

    test('a stat that fails does not stop the restore (the modification time is then 0)', async () => {
        const probe = probeSource(smallBin(), { statThrows: true })
        openSourceMock.mockResolvedValue(probe.source)

        await restoreOpenedBackup(entry)

        expect(alertErrorMock).not.toHaveBeenCalled()
        expect(setDatabaseMock).toHaveBeenCalled()
        expect(probe.closed()).toBe(1)
    })

    // Reproducer: red against the mutant that checks busy only after the confirmation, or not at all.
    test('while work is in progress it says so, asks nothing and opens nothing', async () => {
        const busy = beginBusy('backupSave')

        await restoreOpenedBackup(entry)

        busy.end()
        expect(alertErrorMock).toHaveBeenCalledWith(language.backupLoadWorkInProgress)
        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(openSourceMock).not.toHaveBeenCalled()
        expectNothingInstalled()
    })

    // Reproducer: red against the mutant that asks the confirmation before the read-only refusal.
    test('on a read-only page it is refused before the confirmation and opens nothing', async () => {
        readOnlyBox.readOnly = true

        await restoreOpenedBackup(entry)

        expect(alertConfirmMock).not.toHaveBeenCalled()
        expect(openSourceMock).not.toHaveBeenCalled()
        expectNothingInstalled()
    })

    // Reproducer: red against the mutant that opens the source before the confirmation.
    test('a decline opens nothing and writes nothing', async () => {
        alertConfirmMock.mockResolvedValue(false)

        await restoreOpenedBackup(entry)

        expect(openSourceMock).not.toHaveBeenCalled()
        expectNothingInstalled()
    })

    // Reproducer: red against the mutant that opens the source without waiting for the recorded clean-up.
    test('a pending start-up clean-up is awaited before the source is opened', async () => {
        let finish: () => void = () => { }
        recordStartupCleanup(new Promise<void>((resolve) => { finish = resolve }))
        const probe = probeSource(smallBin())
        openSourceMock.mockResolvedValue(probe.source)

        const running = restoreOpenedBackup(entry)
        await settle()
        expect(alertConfirmMock).toHaveBeenCalledTimes(1)
        expect(alertWaitMock).toHaveBeenCalledWith(language.internalBackupWaitingForCleanup, expect.any(Function))
        expect(openSourceMock).not.toHaveBeenCalled()

        finish()
        await running
        expect(openSourceMock).toHaveBeenCalledTimes(1)
        expect(setDatabaseMock).toHaveBeenCalled()
        // Once the clean-up settles the restore can no longer be cancelled, so the wait is replaced by one without Cancel
        // before the source is opened. Red against the mutants that drop that wait, move it after the open, or keep Cancel.
        const cleanupWait = alertWaitMock.mock.calls.findIndex((call) => call[0] === language.internalBackupWaitingForCleanup)
        const loadingWait = alertWaitMock.mock.calls.findIndex((call) => call[0] === 'Loading backup...' && call[1] === undefined)
        expect(loadingWait).toBeGreaterThan(cleanupWait)
        expect(alertWaitMock.mock.invocationCallOrder[loadingWait]).toBeLessThan(openSourceMock.mock.invocationCallOrder[0])
    })

    test('a person who stops waiting for the clean-up opens and writes nothing', async () => {
        recordStartupCleanup(new Promise<void>(() => { }))
        const running = restoreOpenedBackup(entry)
        await settle()
        const cancel = alertWaitMock.mock.calls.find((call) => call[0] === language.internalBackupWaitingForCleanup)?.[1] as (() => void) | undefined
        expect(cancel).toBeTypeOf('function')
        cancel?.()
        await running

        expect(openSourceMock).not.toHaveBeenCalled()
        expectNothingInstalled()
    })

    test('a source that cannot be opened gives an error alert and writes nothing', async () => {
        openSourceMock.mockRejectedValue(new Error('scratch: no such document'))

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expectNothingInstalled()
    })

    test('a file that is not a backup is refused, nothing is written, and the source is closed once', async () => {
        const probe = probeSource(new Uint8Array(64).fill(7))
        openSourceMock.mockResolvedValue(probe.source)

        await restoreOpenedBackup(entry)

        expect(alertErrorMock).toHaveBeenCalled()
        expect(alertErrorMock).not.toHaveBeenCalledWith(language.backupLoadWorkInProgress)
        expectNothingInstalled()
        expect(probe.closed()).toBe(1)
    })

    test('a source whose close fails does not make it reject', async () => {
        const probe = probeSource(smallBin())
        const failing: ImportSource = { ...probe.source, close: async () => { throw new Error('scratch: close failed') } }
        openSourceMock.mockResolvedValue(failing)

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageEnding')
        expect(setDatabaseMock).toHaveBeenCalled()
    })

    // Reproducers for the page-ending mapping: red against a mapping that reports 'pageLive' for a committed restore, and
    // against one that reports 'pageEnding' for a decline of the opened-file question, a refusal or a cancelled wait. The
    // outcomes `LoadLocalBackup` itself ends with before anything is installed (`canceled`, `failed`) have their own tests below.
    test('a committed restore reports that the page is ending', async () => {
        openSourceMock.mockResolvedValue(probeSource(smallBin()).source)

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageEnding')
        expect(reloadMark.marked).toBe(true)
    })

    test('a decline, a busy refusal, a read-only refusal and a stopped clean-up wait report that the page is live', async () => {
        alertConfirmMock.mockResolvedValue(false)
        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')

        alertConfirmMock.mockResolvedValue(true)
        const busy = beginBusy('backupSave')
        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')
        busy.end()

        readOnlyBox.readOnly = true
        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')
        readOnlyBox.readOnly = false

        recordStartupCleanup(new Promise<void>(() => { }))
        const running = restoreOpenedBackup(entry)
        await settle()
        const cancel = alertWaitMock.mock.calls.find((call) => call[0] === language.internalBackupWaitingForCleanup)?.[1] as (() => void) | undefined
        cancel?.()
        await expect(running).resolves.toBe('pageLive')
    })

    test('a file that is not a backup is refused before anything is installed and reports that the page is live', async () => {
        openSourceMock.mockResolvedValue(probeSource(new Uint8Array(64).fill(7)).source)

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')
        expectNothingInstalled()
    })

    // Reproducer: red against a mapping that reports 'pageEnding' for the `canceled` end of `LoadLocalBackup`; the page is
    // live after a decline, so a later opened file must still be taken.
    test('a decline of a question inside the restore, before any write, reports that the page is live', async () => {
        // Without Tauri and without the Web Locks API the restore asks the no-lock warning before it writes anything.
        platformBox.isTauri = false
        openSourceMock.mockResolvedValue(probeSource(smallBin()).source)
        alertConfirmMock.mockResolvedValueOnce(true).mockResolvedValue(false)

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')

        expect(alertConfirmMock).toHaveBeenCalledWith(language.restoreNoLockWarningConfirm)
        expectNothingInstalled()
    })

    // Reproducer: red against a mapping that reports 'pageEnding' for the `failed` end of `LoadLocalBackup`; a backup whose
    // database entry cannot be decoded throws before anything is installed and leaves the page live.
    test('a backup whose database entry cannot be decoded fails before anything is installed and reports that the page is live', async () => {
        // No asset entry: assets are written before the database entry is decoded, and this test asserts nothing was installed.
        openSourceMock.mockResolvedValue(probeSource(buildChunk('database.risudat', new Uint8Array(64).fill(7))).source)

        await expect(restoreOpenedBackup(entry)).resolves.toBe('pageLive')

        expect(alertErrorMock).toHaveBeenCalledWith('Failed, Is file corrupted?')
        expectNothingInstalled()
    })
})
