// @vitest-environment happy-dom

/**
 * CHORE-42 (Agents/Reports/32-chore42-restore-other-tabs-plan.md rev 3.1,
 * section 3, invariant J8; MC-093, MC-011, MC-091). Once another tab's
 * exclusive storage operation has run, a page must never perform an
 * exclusive operation and must never resume saving: it must reload first.
 * `createStorageTabLocks()` (`../../storage/storageTabLocks`) closes this
 * with a shared per-origin storage epoch: every successful exclusive grant
 * writes a fresh random token to it. An attempt by a page that has a
 * persisted reading of that epoch compares the reading against the token
 * current when it is granted, or when it regains its presence hold after
 * failing to be granted; a page with no reading yet skips both comparisons.
 *
 * J8 runs at contract level, against the REAL, unmocked
 * `createStorageTabLocks()`, driving every scenario's epoch bump for real --
 * no test here writes to the epoch store by hand. Tab A's restore, where a
 * test needs the real restore, is the real `LoadLocalBackup()`, driven
 * through the REAL, unmocked `src/ts/globalApi.svelte.ts`, following
 * `backuplocalRestoreRace.svelte.test.ts`'s real-module pattern (its module
 * mock set is copied verbatim below) -- that file mocks `storage/autoStorage`,
 * so A's own epoch reading is taken by calling `recordStorageEpoch()`
 * directly, standing in for the `AutoStorage.runInit()` hook this harness
 * never runs. Every other tab is a bare `createStorageTabLocks()` instance
 * built directly against a shared `FakeLockManagerCore`
 * (`../../storage/tests/fakeWebLocks`), with its own injected reload spy and
 * the same real `localStorage` A's own default epoch store reads --
 * modelling a second, independent browser tab of the same origin, per
 * `globalApi.storageTabLocksIdentity.svelte.test.ts`'s "one instance per
 * simulated tab" precedent.
 *
 * A tab's own permanent shared presence hold blocks every other tab's
 * exclusive request for as long as it stays open -- exactly what makes the
 * lock meaningful -- so a scenario with two loaded tabs needs BOTH to reach
 * their own exclusive attempt (each releasing its own shared hold on the way
 * in) before either can ever be granted; a scenario with a tab arriving
 * mid-operation instead queues its own request behind the one already
 * granted, and only proceeds once that operation's tab closes or releases.
 * Every test below is sequenced around one of these two shapes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import {
    FakeLockManagerCore,
    FakeTabLockManagerView,
    FakeAsyncMutex,
} from '../../storage/tests/fakeWebLocks'
import { createStorageTabLocks } from '../../storage/storageTabLocks'
import type { Database } from '../../storage/database.svelte'

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

const setDatabaseMock = vi.hoisted(() => vi.fn())

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
    writeFile: vi.fn(async () => { }),
    readFile: vi.fn(async () => new Uint8Array()),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(async () => { }),
    readDir: vi.fn(async () => []),
    remove: vi.fn(async () => { }),
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

vi.mock(import('../../storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('../../storage/dbChangeEffects.svelte'))

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

function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function makeFakeFile(bytes: Uint8Array): File {
    return new File([asBlobPart(bytes)], 'backup.bin')
}

let capturedInput: HTMLInputElement | null = null

async function loadBackupBytes(loadFn: () => void, bytes: Uint8Array): Promise<void> {
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
        Object.defineProperty(input, 'files', { value: [makeFakeFile(bytes)], configurable: true })
        await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    } finally {
        createElementSpy.mockRestore()
    }
}

//#endregion

//#region per-test module graph, one real tab A per test

interface BootedTabA {
    globalApi: typeof import('../../globalApi.svelte')
    loadLocalBackup: () => void
    encodeRisuSaveLegacy: typeof import('../../storage/risuSave')['encodeRisuSaveLegacy']
    alertModule: typeof import('../../alert')
    reloadGuard: typeof import('../../reloadGuard')
}

/** `globalApi.svelte.ts` reads `navigator.locks` once, at module-evaluation time -- `locksValue` must be set before the dynamic import below, not after. */
async function bootTabA(locksValue: LockManager | undefined): Promise<BootedTabA> {
    vi.resetModules()
    setDatabaseMock.mockClear()
    Object.defineProperty(window.navigator, 'locks', {
        value: locksValue,
        configurable: true,
    })
    const globalApi = await import('../../globalApi.svelte')
    const backuplocal = await import('../backuplocal')
    const risuSave = await import('../../storage/risuSave')
    const alertModule = await import('../../alert')
    const reloadGuard = await import('../../reloadGuard')
    return {
        globalApi,
        loadLocalBackup: backuplocal.LoadLocalBackup,
        encodeRisuSaveLegacy: risuSave.encodeRisuSaveLegacy,
        alertModule,
        reloadGuard,
    }
}

function buildValidFixture(mainPrompt: string, encodeRisuSaveLegacy: BootedTabA['encodeRisuSaveLegacy']): Uint8Array {
    const db = { characters: [], mainPrompt } as unknown as Database
    const dbBytes = encodeRisuSaveLegacy(db, 'noCompression')
    return buildChunk('database.risudat', dbBytes)
}

/** Builds a bare simulated tab directly (not through `makeSimulatedTab`, which takes no epoch-store option), so its reload seam is under this test's control. Its epoch store is left at its real-`localStorage` default -- the same global tab A's own default reads -- modelling one shared origin. */
function makeControllableTab(core: FakeLockManagerCore, tabId: string) {
    const view = new FakeTabLockManagerView(core, tabId)
    const writeLock = new FakeAsyncMutex()
    const reload = vi.fn()
    const locks = createStorageTabLocks(view as unknown as LockManager, writeLock, { reload })
    return { locks, writeLock, reload }
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

//#endregion

describe('J8: a page reloads instead of proceeding, or resuming its own pending write, once another tab\'s exclusive operation has run', () => {
    // The next three tests pin the epoch mechanism: each fails when the
    // grant no longer bumps the epoch, and the first also fails when the
    // failed-attempt comparison is removed, the other two when the grant
    // comparison is removed. The fourth is a compatibility guard: a
    // tab that only learns of another tab's already-finished operation
    // while booting must never mistake that for an overtake.
    test('a tab that times out behind another loaded tab\'s granted operation reloads and never resumes', async () => {
        const core = new FakeLockManagerCore()
        const tabA = makeControllableTab(core, 'A')
        const tabB = makeControllableTab(core, 'B')
        await tabA.locks.tabPresenceLockAcquired
        await tabB.locks.tabPresenceLockAcquired
        tabA.locks.recordStorageEpoch()
        tabB.locks.recordStorageEpoch()

        // A's own attempt is blocked by B's still-active presence hold,
        // until B's own attempt below releases it.
        const attemptA = tabA.locks.acquireExclusiveStorageMigrationLock(5000)
        // B queues behind A once granted; B's own simulated save loop is
        // pending behind B's write lock, which B's own in-flight attempt
        // already holds for its whole duration, win or lose the race.
        const attemptB = tabB.locks.acquireExclusiveStorageMigrationLock(150)
        let staleWriteLanded = false
        const saveLoopB = tabB.writeLock.acquire().then((release) => {
            staleWriteLanded = true
            release()
        })

        const releaseA = await attemptA
        expect(releaseA).not.toBeNull()

        // B's own internal wait elapses while A still holds -- B's outer
        // call stays pending regardless, re-requesting its presence hold
        // behind A's still-held exclusive lock.
        await tick(250)
        await releaseA?.()

        expect(await attemptB).toBeNull()
        await tick(20)

        expect(tabB.reload).toHaveBeenCalled()
        expect(staleWriteLanded).toBe(false)
        expect(tabA.reload).not.toHaveBeenCalled()

        // A mismatch keeps the write lock held until the page is gone
        // (MC-091), so `saveLoopB` above is expected to never settle at
        // all -- tracked with a flag rather than awaited, since awaiting it
        // here would hang the test on exactly the behaviour this
        // reproducer asserts.
        let saveLoopSettled = false
        saveLoopB.then(() => { saveLoopSettled = true }, () => { saveLoopSettled = true })
        await tick(20)
        expect(saveLoopSettled).toBe(false)
    })

    test('a restore queued behind another tab\'s granted operation reloads once granted, instead of writing on a stale epoch', async () => {
        const core = new FakeLockManagerCore()
        const tabA = await bootTabA(new FakeTabLockManagerView(core, 'A') as unknown as LockManager)
        tabA.globalApi.recordStorageEpoch()

        const tabB = makeControllableTab(core, 'B')
        await tabB.locks.tabPresenceLockAcquired

        // B's own attempt alone cannot be granted yet -- A's still-active
        // permanent shared presence hold blocks it, exactly as it would
        // block any exclusive request while this page stays open. It only
        // becomes grantable once A's own restore below reaches its own
        // attempt and releases that same hold to queue behind B's.
        const attemptB = tabB.locks.acquireExclusiveStorageMigrationLock(2000)

        const fixture = buildValidFixture('restore-queued-behind-b', tabA.encodeRisuSaveLegacy)
        const restorePromise = loadBackupBytes(tabA.loadLocalBackup, fixture)

        const releaseB = await attemptB
        expect(releaseB).not.toBeNull()

        // B is done -- exactly a closed browsing context's Web Locks
        // releasing, never an explicit release() -- freeing the lock for
        // A's already-queued attempt, which now sees a stale baseline.
        core.closeTab('B')

        await restorePromise

        expect(tabA.globalApi.forageStorage.setItem).not.toHaveBeenCalledWith('database/database.bin', expect.anything())
        expect(tabA.reloadGuard.isAppInitiatedReload()).toBe(true)
    })

    test('this page\'s own exclusive attempt, queued behind another tab\'s granted operation, reloads once granted instead of proceeding', async () => {
        const core = new FakeLockManagerCore()
        const tabA = makeControllableTab(core, 'A')
        await tabA.locks.tabPresenceLockAcquired
        tabA.locks.recordStorageEpoch()

        const tabB = makeControllableTab(core, 'B')
        await tabB.locks.tabPresenceLockAcquired

        const attemptB = tabB.locks.acquireExclusiveStorageMigrationLock(2000)
        const attemptA = tabA.locks.acquireExclusiveStorageMigrationLock(2000)

        const releaseB = await attemptB
        expect(releaseB).not.toBeNull()
        core.closeTab('B')

        const releaseA = await attemptA
        expect(releaseA).toBeNull()
        expect(tabA.reload).toHaveBeenCalled()
    })

    test('compatibility guard: a tab that finished booting only after another tab released the exclusive lock never reloads for that reason', async () => {
        const core = new FakeLockManagerCore()

        const tabB = makeControllableTab(core, 'B')
        await tabB.locks.tabPresenceLockAcquired
        const releaseB = await tabB.locks.acquireExclusiveStorageMigrationLock(1000)
        await releaseB?.()
        // B is done and gone -- exactly a closed browsing context's Web
        // Locks releasing -- so it does not count as "another open tab"
        // blocking C's own attempt below.
        core.closeTab('B')

        // Tab C boots only now, after B's operation is already reflected --
        // its own recorded reading (taken directly, standing in for the
        // mocked-away AutoStorage.Init() hook) already matches the current
        // epoch.
        const tabC = makeControllableTab(core, 'C')
        await tabC.locks.tabPresenceLockAcquired
        tabC.locks.recordStorageEpoch()

        const releaseC = await tabC.locks.acquireExclusiveStorageMigrationLock(1000)
        expect(releaseC).not.toBeNull()
        await releaseC?.()
        expect(tabC.reload).not.toHaveBeenCalled()
    })

    test('guard: a restore overtaken while queued shows no other-tab refusal message', async () => {
        const core = new FakeLockManagerCore()
        const tabA = await bootTabA(new FakeTabLockManagerView(core, 'A') as unknown as LockManager)
        tabA.globalApi.recordStorageEpoch()

        const tabB = makeControllableTab(core, 'B')
        await tabB.locks.tabPresenceLockAcquired
        const attemptB = tabB.locks.acquireExclusiveStorageMigrationLock(2000)

        const fixture = buildValidFixture('restore-overtaken-no-refusal', tabA.encodeRisuSaveLegacy)
        const restorePromise = loadBackupBytes(tabA.loadLocalBackup, fixture)

        const releaseB = await attemptB
        expect(releaseB).not.toBeNull()
        core.closeTab('B')

        await restorePromise

        // Once overtaken, this page is already on its way out -- showing
        // the ordinary "another tab is open" refusal here as well would be
        // a stale, misleading message for a restore that has already given
        // way, not merely one that was refused outright.
        expect(tabA.alertModule.alertError).not.toHaveBeenCalledWith(language.restoreOtherTabRefused)
    })

    test('the success path marks the reload as app-initiated only after the exclusive hold has actually released', async () => {
        const core = new FakeLockManagerCore()
        const tabA = await bootTabA(new FakeTabLockManagerView(core, 'A') as unknown as LockManager)
        tabA.globalApi.recordStorageEpoch()

        let resolveGate: () => void = () => { }
        const gate = new Promise<void>((resolve) => { resolveGate = resolve })
        vi.mocked(tabA.globalApi.forageStorage.setItem).mockImplementation(async (key: unknown) => {
            if (key === 'database/database.bin') {
                await gate
            }
            return null
        })

        const fixture = buildValidFixture('restore-mark-after-release', tabA.encodeRisuSaveLegacy)
        const restorePromise = loadBackupBytes(tabA.loadLocalBackup, fixture)
        restorePromise.catch(() => { })

        // Gives the restore room to be granted the exclusive lock and reach
        // its gated write.
        await tick(30)

        // B asks for the exclusive lock now, while A still holds it. Once A
        // has written, A's release re-requests its presence hold, which
        // queues behind B's pending request and stays unresolved for the rest
        // of this test. That window is where the app-initiated-reload mark
        // must still be unset.
        const tabB = makeControllableTab(core, 'B')
        void tabB.locks.acquireExclusiveStorageMigrationLock(5000)
        await tick(30)

        // Lets the write succeed.
        resolveGate()
        await tick(30)

        // The release triggered by the successful write is still pending,
        // blocked behind B's queued request -- the mark must not have
        // happened yet.
        expect(tabA.reloadGuard.isAppInitiatedReload()).toBe(false)
    })
})
