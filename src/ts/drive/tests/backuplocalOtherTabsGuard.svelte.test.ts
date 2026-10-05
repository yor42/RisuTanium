// @vitest-environment happy-dom

/**
 * CHORE-42 (Agents/Reports/32-chore42-restore-other-tabs-plan.md rev 3.1,
 * section 3, invariants J1-J6; MC-093, MC-011, MC-081, MC-070).
 * `LoadLocalBackup()` (`src/ts/drive/backuplocal.ts`) refuses or warns
 * before writing when another tab of this browser is open, never resumes a
 * write after losing that race, reloads on a successful restore instead of
 * showing "Success", and leaves no unhandled rejection or stuck in-memory
 * database on a failed write. Most tests below are regression reproducers:
 * each still fails against the pre-fix tree for its own behavioural reason
 * (nothing written, a message shown, a reload requested, no unhandled
 * rejection), and passes once the fix lands. A few are compatibility
 * guards, labelled as such where they appear.
 *
 * Drives the REAL, unmocked `src/ts/globalApi.svelte.ts` and the REAL
 * `LoadLocalBackup()` together, exactly as `backuplocalRestoreRace.svelte.test.ts`
 * does for the same reason (I10): mirroring each in a separate mock would
 * only prove two stand-ins agree with each other, not that they share the
 * one write mutex and the one storage tab locks instance. The module mock
 * set below is copied verbatim from that file. `src/ts/storage/risuSave.ts`
 * and `src/ts/reloadGuard.ts` are left real and unmocked.
 *
 * Multi-tab scenarios (J1, J3) share one `FakeLockManagerCore`
 * (`../../storage/tests/fakeWebLocks`) between tab A's real module graph
 * (`navigator.locks` stubbed to a `FakeTabLockManagerView` tagged `'A'`,
 * before the dynamic import, since `globalApi.svelte.ts` reads
 * `navigator.locks` once at module-evaluation time) and a bare simulated tab
 * B built with `makeSimulatedTab`. Every test gets its own fresh module
 * graph and its own fresh `FakeLockManagerCore` via `vi.resetModules()` and
 * a re-import in `beforeEach`, the same per-test isolation
 * `backuplocalRestoreRace.svelte.test.ts` uses, so no test's held lock can
 * leak into another.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import type { Database } from '../../storage/database.svelte'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from '../../storage/tests/fakeWebLocks'
import { createForageBackedStore, createSwitchedStore, type ForageLike } from '../../storage/tests/forageBackedStore'
import { createTauriFilesStore } from '../../storage/store/tauriFilesStore'

//#region module mocks -- copied verbatim from backuplocalRestoreRace.svelte.test.ts

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('../../storage/dbChangeEffects.svelte'))

/** Stable across every `vi.resetModules()` re-import in this file (`vi.hoisted()`'s whole point) -- J6 inspects this directly to tell "installed" from "not yet installed", instead of a real `DBState.db` this mock never touches. */
const setDatabaseMock = vi.hoisted(() => vi.fn())
/** The Tauri file system stand-in: written, renamed and removed files, keyed by AppData-relative path. */
const tauriFiles = vi.hoisted(() => new Map<string, Uint8Array>())

vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: setDatabaseMock,
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
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
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../../alert'), () => ({
    alertClear: vi.fn(),
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertWait: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
    alertToast: vi.fn(),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: writable({ type: 'none', msg: '' }),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('../../util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('../../util'))

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((p: string) => p),
    invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => { }),
}))

vi.mock('src/ts/vendor/streamSaver', () => ({
    default: {
        useBlobFallback: false,
        createWriteStream: () => ({
            ready: Promise.resolve(),
            writable: {
                getWriter: () => ({
                    write: async () => { },
                    close: async () => { },
                }),
            },
        }),
    },
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
    getCurrentWebviewWindow: vi.fn(() => ({
        listen: vi.fn(),
        setTitle: vi.fn(),
    })),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0, Download: 1 },
    writeFile: vi.fn(async (path: string, data: Uint8Array) => { tauriFiles.set(path, data.slice()) }),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async (path: string) => { tauriFiles.delete(path) }),
    rename: vi.fn(async (from: string, to: string) => {
        const found = tauriFiles.get(from)
        if (!found) {
            throw `no such file ${from} (os error 2)`
        }
        tauriFiles.set(to, found)
        tauriFiles.delete(from)
    }),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

vi.mock(import('../../update'), () => ({
    checkRisuUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('../../update'))

vi.mock(import('../../plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => { }),
}) as unknown as typeof import('../../plugins/plugins.svelte'))

vi.mock(import('../../parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
}) as unknown as typeof import('../../parser/parser.svelte'))

vi.mock(import('../../characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
}) as unknown as typeof import('../../characterCards'))

vi.mock(import('../../storage/autoStorage'), () => ({
    AutoStorage: class {
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
        removeItem = vi.fn(async () => { })
    },
}) as unknown as typeof import('../../storage/autoStorage'))

vi.mock(import('../../gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('../../gui/animation'))

vi.mock(import('../../gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('../../gui/colorscheme'))

vi.mock(import('../../observer.svelte'), () => ({
    startObserveDom: vi.fn(),
}) as unknown as typeof import('../../observer.svelte'))

vi.mock(import('../../gui/guisize'), () => ({
    updateGuisize: vi.fn(),
}) as unknown as typeof import('../../gui/guisize'))

vi.mock(import('../../characters'), () => ({
    updateLorebooks: vi.fn((v: unknown) => v),
}) as unknown as typeof import('../../characters'))

vi.mock(import('../../hotkey'), () => ({
    initMobileGesture: vi.fn(),
}) as unknown as typeof import('../../hotkey'))

vi.mock(import('../../process/modules'), () => ({
    moduleUpdate: vi.fn(async () => { }),
}) as unknown as typeof import('../../process/modules'))

vi.mock(import('../../process/coldstorage.svelte'), () => ({
    collectColdStorageBackupPayloads: vi.fn(async () => ({ payloads: [], missingKeys: [], invalidKeys: [] })),
    readColdStorageItem: vi.fn(async () => ({ status: 'missing' })),
    confirmIncompleteColdStorageOperation: vi.fn(async () => true),
    getColdStorageBackupKey: vi.fn(() => null),
    getColdStorageItem: vi.fn(async () => null),
    isColdStorageBackupData: vi.fn(() => false),
    listColdDataKeys: vi.fn(async () => []),
    setColdStorageItem: vi.fn(async () => true),
}) as unknown as typeof import('../../process/coldstorage.svelte'))

//#endregion

//#region byte-layout and File harness, matching backuplocalIdRepair.test.ts's own pattern

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** One `[nameLength][name][dataLength][data]` chunk, matching LoadLocalBackup's reader. */
function buildChunk(name: string, data: Uint8Array): Uint8Array {
    const nameBuf = new TextEncoder().encode(name)
    const out = new Uint8Array(4 + nameBuf.length + 4 + data.length)
    let offset = 0
    out.set(u32le(nameBuf.length), offset); offset += 4
    out.set(nameBuf, offset); offset += nameBuf.length
    out.set(u32le(data.length), offset); offset += 4
    out.set(data, offset)
    return out
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((a, c) => a + c.length, 0)
    const out = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    return out
}

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function makeFakeFile(bytes: Uint8Array): File {
    return new File([asBlobPart(bytes)], 'backup.bin')
}

/** A real File whose `slice()` reads `walkBytes` for its first `walkSliceCalls` calls (the pre-read walk) and `restoreBytes` afterwards (the restore pass) -- models a file that changes between the two, matching `backuplocalEncryptedRefusal.test.ts`'s own harness for the same reason. */
function fileWithTimeDivergentSlice(walkBytes: Uint8Array, restoreBytes: Uint8Array, walkSliceCalls: number, name = 'backup.bin'): File {
    const base = new File([asBlobPart(walkBytes)], name)
    let sliceCalls = 0
    return new Proxy(base, {
        get(target, prop, receiver) {
            if (prop === 'slice') {
                return (start = 0, end = walkBytes.length) => {
                    const source = sliceCalls < walkSliceCalls ? walkBytes : restoreBytes
                    sliceCalls += 1
                    return new Blob([asBlobPart(source.slice(start, end))])
                }
            }
            return Reflect.get(target, prop, receiver)
        },
    })
}

let capturedInput: HTMLInputElement | null = null

/** Drives `loadFn` with `file` as the selected file's content, and awaits its onchange handler to completion. */
async function loadBackupFile(loadFn: () => void, file: File): Promise<void> {
    const realCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
    try {
        loadFn()
        const input = capturedInput
        if (!input) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        Object.defineProperty(input, 'files', { value: [file], configurable: true })
        await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    } finally {
        createElementSpy.mockRestore()
    }
}

async function loadBackupBytes(loadFn: () => void, bytes: Uint8Array): Promise<void> {
    await loadBackupFile(loadFn, makeFakeFile(bytes))
}

/**
 * Sets up the input and fires `onchange`, but deliberately does NOT await
 * (or otherwise attach a handler to) its returned promise -- the caller
 * decides separately whether and how to observe completion. A test that
 * needs to know whether a rejection ever gets its own handler (J6) must
 * never await this call directly, since doing so would itself count as
 * "handling" the rejection.
 */
function triggerBackupBytesWithoutAwaiting(loadFn: () => void, bytes: Uint8Array): void {
    const realCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
    loadFn()
    const input = capturedInput
    createElementSpy.mockRestore()
    if (!input) {
        throw new Error('LoadLocalBackup did not create a file input')
    }
    Object.defineProperty(input, 'files', { value: [makeFakeFile(bytes)], configurable: true })
    ;(input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
}

//#endregion

//#region per-test module graph, one real tab A per test

interface BootedTabA {
    globalApi: typeof import('../../globalApi.svelte')
    loadLocalBackup: () => void
    encodeRisuSaveLegacy: typeof import('../../storage/risuSave')['encodeRisuSaveLegacy']
    alertModule: typeof import('../../alert')
    reloadGuard: typeof import('../../reloadGuard')
    coldstorage: typeof import('../../process/coldstorage.svelte')
}

/**
 * Builds a fresh module graph for tab A: `globalApi.svelte.ts` reads
 * `navigator.locks` once, at module-evaluation time, so `locksValue` must be
 * set before the dynamic import below, not after (same requirement
 * `backuplocalRestoreRace.svelte.test.ts` and
 * `globalApi.storageTabLocksIdentity.svelte.test.ts` document).
 */
async function bootTabA(locksValue: LockManager | undefined): Promise<BootedTabA> {
    vi.resetModules()
    Object.defineProperty(window.navigator, 'locks', {
        value: locksValue,
        configurable: true,
    })
    const globalApi = await import('../../globalApi.svelte')
    // The restore writes the main file through the page's byte store: the
    // storage-object model on the web, the desktop store on Tauri.
    const platform = await import('../../platform')
    const { injectAppStore } = await import('../../storage/store/appStore')
    const webStore = createForageBackedStore(globalApi.forageStorage as unknown as ForageLike)
    const tauriStore = createTauriFilesStore({ platform: 'posix' })
    injectAppStore(createSwitchedStore(() => platform.isTauri ? tauriStore : webStore))
    const backuplocal = await import('../backuplocal')
    const risuSave = await import('../../storage/risuSave')
    const alertModule = await import('../../alert')
    const reloadGuard = await import('../../reloadGuard')
    const coldstorage = await import('../../process/coldstorage.svelte')
    return {
        globalApi,
        loadLocalBackup: backuplocal.LoadLocalBackup,
        encodeRisuSaveLegacy: risuSave.encodeRisuSaveLegacy,
        alertModule,
        reloadGuard,
        coldstorage,
    }
}

function buildValidFixture(mainPrompt: string, encodeRisuSaveLegacy: BootedTabA['encodeRisuSaveLegacy']): Uint8Array {
    const db = { characters: [], mainPrompt } as unknown as Database
    const dbBytes = encodeRisuSaveLegacy(db, 'noCompression')
    return buildChunk('database.risudat', dbBytes)
}

let core: FakeLockManagerCore
let tabA: BootedTabA

beforeEach(async () => {
    setDatabaseMock.mockClear()
    core = new FakeLockManagerCore()
    tabA = await bootTabA(new FakeTabLockManagerView(core, 'A') as unknown as LockManager)
    // A static `vi.mock(...)` factory (unlike a `vi.hoisted()` binding) runs
    // once for the whole file, not once per `vi.resetModules()` re-import --
    // every test's own dynamic re-import of `alert` above returns the SAME
    // `vi.fn()` instances every other test already called, so call history
    // accumulates across tests unless cleared here. Every alert mock this
    // file asserts an exact call count or a `not.toHaveBeenCalled()` against
    // is cleared; `alertStore` is exempt, since every test that inspects it
    // takes its own fresh `vi.spyOn()`.
    vi.mocked(tabA.alertModule.alertError).mockClear()
    vi.mocked(tabA.alertModule.alertConfirm).mockClear()
    vi.mocked(tabA.alertModule.alertNormal).mockClear()
})

afterEach(() => {
    vi.doUnmock(import('../../platform'))
})

//#endregion

describe('J1: another tab holding presence blocks the restore from writing', () => {
    test('regression reproducer: a second open tab of this browser leaves the restore refused and nothing written', async () => {
        vi.useFakeTimers()
        try {
            const tabB = makeSimulatedTab(core, 'B')
            await tabB.locks.tabPresenceLockAcquired

            const fixture = buildValidFixture('restored-while-tab-b-open', tabA.encodeRisuSaveLegacy)
            const restorePromise = loadBackupBytes(tabA.loadLocalBackup, fixture)
            // Fast-forwards past the restore's own exclusive-lock wait
            // (`RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS` in `backuplocal.ts`)
            // instead of genuinely waiting it out in real time.
            await vi.advanceTimersByTimeAsync(2100)
            await restorePromise

            expect(tabA.globalApi.forageStorage.setItem).not.toHaveBeenCalled()
            expect(tabA.alertModule.alertError).toHaveBeenCalledWith(language.restoreOtherTabRefused)
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('J2: no Web Locks on a web build', () => {
    test('regression reproducer: cancelling the no-Web-Locks warning writes nothing', async () => {
        tabA = await bootTabA(undefined)
        vi.mocked(tabA.alertModule.alertConfirm).mockResolvedValueOnce(false)

        const fixture = buildValidFixture('restored-no-locks-cancelled', tabA.encodeRisuSaveLegacy)
        await loadBackupBytes(tabA.loadLocalBackup, fixture)

        expect(tabA.globalApi.forageStorage.setItem).not.toHaveBeenCalled()
    })

    test('compatibility guard: continuing past the no-Web-Locks warning still restores', async () => {
        tabA = await bootTabA(undefined)
        vi.mocked(tabA.alertModule.alertConfirm).mockResolvedValue(true)

        const fixture = buildValidFixture('restored-no-locks-continue', tabA.encodeRisuSaveLegacy)
        await loadBackupBytes(tabA.loadLocalBackup, fixture)

        expect(tabA.globalApi.forageStorage.setItem).toHaveBeenCalledWith('database/database.bin', expect.any(Uint8Array))
    })

    test('compatibility guard: Tauri never shows the no-Web-Locks warning', async () => {
        vi.doMock(import('../../platform'), () => ({
            isTauri: true,
            isNodeServer: false,
            isIOS: () => false,
        }) as unknown as typeof import('../../platform'))
        tabA = await bootTabA(undefined)

        const fixture = buildValidFixture('restored-tauri-no-locks', tabA.encodeRisuSaveLegacy)
        await loadBackupBytes(tabA.loadLocalBackup, fixture)

        expect(tabA.alertModule.alertConfirm).not.toHaveBeenCalled()
    })
})

describe('J3: a mid-restore blocks a new tab from booting until it releases', () => {
    test('a new tab\'s presence lock stays ungranted while a restore is mid-way, and grants once it releases', async () => {
        let resolveGate: () => void = () => { }
        const gate = new Promise<void>((resolve) => { resolveGate = resolve })
        vi.mocked(tabA.globalApi.forageStorage.setItem).mockImplementation(async (key: unknown) => {
            if (key === 'database/database.bin') {
                await gate
            }
            return null
        })

        const fixture = buildValidFixture('restore-mid-way', tabA.encodeRisuSaveLegacy)
        const restorePromise = loadBackupBytes(tabA.loadLocalBackup, fixture)

        try {
            // Gives the restore room to reach its gated write -- mid-restore.
            await new Promise((resolve) => setTimeout(resolve, 30))

            const tabC = makeSimulatedTab(core, 'C')
            let cGranted = false
            tabC.locks.tabPresenceLockAcquired.then(() => { cGranted = true })
            await new Promise((resolve) => setTimeout(resolve, 30))

            expect(cGranted).toBe(false)

            resolveGate()
            await restorePromise
            await tabC.locks.tabPresenceLockAcquired
            expect(cGranted).toBe(true)
        } finally {
            // Unblocks the gated write regardless of how the assertions
            // above land, so a failing assertion here can never leave this
            // test's restore permanently suspended (and its `document.createElement`
            // spy never restored) for every test that runs after it.
            resolveGate()
            await restorePromise.catch(() => { })
        }
    })
})

describe('J4: a successful restore reloads instead of showing Success', () => {
    test('regression reproducer: success marks the reload as app-initiated and shows no Success alert', async () => {
        const fixture = buildValidFixture('restore-success-reload', tabA.encodeRisuSaveLegacy)

        await loadBackupBytes(tabA.loadLocalBackup, fixture)

        expect(tabA.reloadGuard.isAppInitiatedReload()).toBe(true)
        expect(tabA.alertModule.alertNormal).not.toHaveBeenCalledWith('Success')
    })

    test('guard: a granted, uncontended restore completes without hanging', async () => {
        const fixture = buildValidFixture('restore-completes', tabA.encodeRisuSaveLegacy)
        await expect(loadBackupBytes(tabA.loadLocalBackup, fixture)).resolves.toBeUndefined()
    })
})

describe('J5: every early exit leaves this page, and the origin, still usable (guard, mutation-checked)', () => {
    /**
     * Checks the three properties J5 requires after any restore exit that
     * never wrote the database: this page's own write mutex is free, this
     * page can take the exclusive storage lock again (catching a lock left
     * held, or released twice), and a later tab can still boot (catching a
     * presence hold left stuck).
     */
    async function expectPageStillUsable(booted: BootedTabA, sharedCore: FakeLockManagerCore, laterTabId: string): Promise<void> {
        const release = await booted.globalApi.dbWriteLock.acquire()
        release()

        const migrationRelease = await booted.globalApi.acquireExclusiveStorageMigrationLock(200)
        expect(migrationRelease).not.toBeNull()
        await migrationRelease?.()

        const laterTab = makeSimulatedTab(sharedCore, laterTabId)
        await laterTab.locks.tabPresenceLockAcquired
    }

    test('guard: a cancelled cold-storage prompt leaves this page usable', async () => {
        vi.mocked(tabA.coldstorage.confirmIncompleteColdStorageOperation).mockResolvedValueOnce(false)
        const fixture = buildValidFixture('cold-storage-cancelled', tabA.encodeRisuSaveLegacy)

        await loadBackupBytes(tabA.loadLocalBackup, fixture)

        await expectPageStillUsable(tabA, core, 'B-after-cold-cancel')
    })

    test('guard: a marker caught by the import loop\'s own independent guard leaves this page usable', async () => {
        const db = { characters: [] } as unknown as Database
        const dbBytes = tabA.encodeRisuSaveLegacy(db, 'noCompression')
        // The upfront walk (its first three slice() calls) sees no marker; the
        // restore pass then reads a marker at the second entry's offset, so
        // only the restore pass's own independent guard (I3, defense in depth)
        // can catch it here.
        const walkBytes = concatChunks([
            buildChunk('asset.png', new Uint8Array(16)),
            buildChunk('asset2.png', new Uint8Array(16)),
            buildChunk('database.risudat', dbBytes),
        ])
        const restoreBytes = concatChunks([
            buildChunk('asset.png', new Uint8Array(16)),
            buildChunk('encryption.risudat', new TextEncoder().encode(JSON.stringify({ type: 'account', time: Date.now() }))),
        ])
        const file = fileWithTimeDivergentSlice(walkBytes, restoreBytes, 3)

        await loadBackupFile(tabA.loadLocalBackup, file)

        await expectPageStillUsable(tabA, core, 'B-after-marker')
    })

    test('guard: a database entry that fails to decode leaves this page usable', async () => {
        const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        const fixture = buildChunk('database.risudat', garbage)

        await loadBackupBytes(tabA.loadLocalBackup, fixture).catch(() => { })

        await expectPageStillUsable(tabA, core, 'B-after-decode-throw')
    })

    test('guard: a rejecting database write leaves this page usable', async () => {
        vi.mocked(tabA.globalApi.forageStorage.setItem).mockImplementation(async (key: unknown) => {
            if (key === 'database/database.bin') {
                throw new Error('scratch: restore write failed')
            }
            return null
        })
        const fixture = buildValidFixture('write-failed-j5', tabA.encodeRisuSaveLegacy)

        await loadBackupBytes(tabA.loadLocalBackup, fixture).catch(() => { })

        await expectPageStillUsable(tabA, core, 'B-after-write-failure')
    })
})

describe('J6: exactly one message on failure, never an unhandled rejection', () => {
    test('regression reproducer: a rejecting database write shows one error, never becomes an unhandled rejection, and leaves the pre-restore database installed', async () => {
        // A plain rejecting function, not vi.fn() -- a vi.fn()-produced
        // rejection already looks handled to Node's unhandledRejection
        // detector regardless of what the code under test does with it.
        tabA.globalApi.forageStorage.setItem = ((key: string) => {
            if (key === 'database/database.bin') {
                return Promise.reject(new Error('scratch: restore write failed'))
            }
            return Promise.resolve(null)
        }) as typeof tabA.globalApi.forageStorage.setItem

        const fixture = buildValidFixture('write-failed-unhandled', tabA.encodeRisuSaveLegacy)

        const unhandled: unknown[] = []
        const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandledRejection)
        try {
            triggerBackupBytesWithoutAwaiting(tabA.loadLocalBackup, fixture)
            // An unhandled rejection is reported asynchronously, not
            // synchronously with the rejection itself -- give that a turn.
            await new Promise((resolve) => setTimeout(resolve, 50))
        } finally {
            process.off('unhandledRejection', onUnhandledRejection)
        }

        expect(unhandled).toEqual([])
        expect(tabA.alertModule.alertError).toHaveBeenCalledTimes(1)
        // The restored database must never reach setDatabase() until its
        // write has actually succeeded -- a failed write must leave this
        // page on its pre-restore database.
        expect(setDatabaseMock).not.toHaveBeenCalled()
    })

    test('regression reproducer: a rejecting Tauri relaunch() after a successful write reports the restore as saved, not as a plain failure', async () => {
        vi.doMock(import('../../platform'), () => ({
            isTauri: true,
            isNodeServer: false,
            isIOS: () => false,
        }) as unknown as typeof import('../../platform'))
        tabA = await bootTabA(new FakeTabLockManagerView(core, 'A') as unknown as LockManager)
        const tauriProcess = await import('@tauri-apps/plugin-process') as { relaunch: () => Promise<void> }
        // A plain rejecting function, not vi.fn() -- see the file header.
        tauriProcess.relaunch = () => Promise.reject(new Error('scratch: relaunch failed'))
        const alertStoreSetSpy = vi.spyOn(tabA.alertModule.alertStore, 'set')

        const unhandled: unknown[] = []
        const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandledRejection)
        try {
            const fixture = buildValidFixture('tauri-relaunch-failed', tabA.encodeRisuSaveLegacy)
            triggerBackupBytesWithoutAwaiting(tabA.loadLocalBackup, fixture)
            await new Promise((resolve) => setTimeout(resolve, 50))
        } finally {
            process.off('unhandledRejection', onUnhandledRejection)
        }

        expect(unhandled).toEqual([])
        expect(alertStoreSetSpy.mock.calls.some((call) => {
            const arg = call[0] as { msg?: unknown } | undefined
            return typeof arg?.msg === 'string' && /saved|restart/i.test(arg.msg)
        })).toBe(true)
    })
})
