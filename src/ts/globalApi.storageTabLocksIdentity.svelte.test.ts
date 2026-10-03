/**
 * N2 (Agents/Reports/30-chore39-opfs-migration-plan.md, section 3's
 * single-instance rule): production must build exactly one
 * `StorageTabLocks` instance per page, and its write mutex must be the same
 * `dbWriteLock` object `saveDb()` and `LoadLocalBackup()`'s restore write
 * take -- a second, differently-wired instance would let an autosave land in
 * the middle of an exclusive operation such as the copy back from OPFS.
 * Compatibility guard: the lock seam extraction wires this correctly on its
 * own, independent of `AutoStorage`, which this test is not evidence of.
 *
 * This drives the REAL, unmocked `src/ts/globalApi.svelte.ts` -- the
 * module-mock set below is copied verbatim from
 * `src/ts/globalApi.saveSequence.svelte.test.ts`, the established precedent
 * for loading this same huge module for real. `navigator.locks` is stubbed
 * with a fake single-tab `LockManager` *before* the module is imported
 * (dynamically, inside `beforeAll`), since `globalApi.svelte.ts` reads
 * `navigator.locks` once, at module-evaluation time.
 */
import { describe, test, expect, vi, beforeAll } from 'vitest'
import { writable } from 'svelte/store'

//#region module mocks -- copied verbatim from globalApi.saveSequence.svelte.test.ts

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        throw new Error('no live database in tests')
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
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
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/alert'), () => ({
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

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => { }),
    sleepForever: vi.fn(async () => { }),
}) as unknown as typeof import('src/ts/util'))

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

vi.mock('streamsaver', () => ({
    default: {},
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

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
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
        getItem = vi.fn(async (_key: string) => null as unknown)
        setItem = vi.fn(async () => null)
        keys = vi.fn(async () => [] as string[])
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

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    getColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

//#endregion

//#region a fake single-tab Web Locks manager, stubbed before the module import below

type LockMode = 'shared' | 'exclusive'
interface QueuedRequest {
    mode: LockMode
    callback: (lock: { name: string, mode: LockMode }) => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
}

/** Grants strictly in queue order and honours AbortSignal, exactly as the real per-origin Web Locks manager does -- only one simulated tab is needed here, since N2 is about object identity, not cross-tab ordering. */
class FakeSingleTabLockManager {
    private held: { mode: LockMode }[] = []
    private queue: QueuedRequest[] = []

    request(_name: string, options: { mode?: LockMode, signal?: AbortSignal }, callback: (lock: { name: string, mode: LockMode }) => Promise<unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const req: QueuedRequest = { mode: options.mode ?? 'exclusive', callback, resolve, reject }
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    const i = this.queue.indexOf(req)
                    if (i >= 0) {
                        this.queue.splice(i, 1)
                        reject(new DOMException('The request was aborted.', 'AbortError'))
                        this.pump()
                    }
                })
            }
            this.queue.push(req)
            this.pump()
        })
    }

    private grantable(req: QueuedRequest): boolean {
        if (this.queue[0] !== req) return false
        if (req.mode === 'exclusive') return this.held.length === 0
        return !this.held.some((h) => h.mode === 'exclusive')
    }

    private pump() {
        while (this.queue.length && this.grantable(this.queue[0])) {
            const req = this.queue.shift() as QueuedRequest
            const lock = { mode: req.mode }
            this.held.push(lock)
            Promise.resolve()
                .then(() => req.callback({ name: 'risu-storage-tab-presence', mode: req.mode }))
                .then((value) => {
                    const i = this.held.indexOf(lock)
                    if (i >= 0) this.held.splice(i, 1)
                    req.resolve(value)
                    this.pump()
                })
        }
    }
}

//#endregion

let globalApi: typeof import('src/ts/globalApi.svelte')

beforeAll(async () => {
    // globalApi.svelte.ts reads navigator.locks once, at module-evaluation
    // time -- this must be set before the dynamic import below, not after.
    Object.defineProperty(window.navigator, 'locks', {
        value: new FakeSingleTabLockManager(),
        configurable: true,
    })
    globalApi = await import('src/ts/globalApi.svelte')
})

describe('production storage tab locks single-instance rule (N2)', () => {
    test('compatibility guard: acquireExclusiveStorageMigrationLock() acquires dbWriteLock itself, not a separately-constructed mutex', async () => {
        const acquireSpy = vi.spyOn(globalApi.dbWriteLock, 'acquire')

        const release = await globalApi.acquireExclusiveStorageMigrationLock(1000)

        expect(acquireSpy).toHaveBeenCalledTimes(1)
        expect(release).not.toBeNull()
        await release?.()
        acquireSpy.mockRestore()
    })
})
