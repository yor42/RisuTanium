// @vitest-environment happy-dom

/**
 * I10 (Agents/Reports/31-removal-stage-plan.md, section 4 item E). Drives the
 * REAL `src/ts/globalApi.svelte.ts` and the REAL `LoadLocalBackup()`
 * (`src/ts/drive/backuplocal.ts`) together, so both share the exact same
 * `dbWriteLock`/`forageStorage` objects production wires them through --
 * mirroring each in a separate mock, the way the other `backuplocal*.test.ts`
 * files do, would only prove something about two stand-ins agreeing with
 * each other, not about whether they share the one write mutex.
 *
 * `globalApi.svelte.ts`'s own module mocks are copied verbatim from
 * `globalApi.storageTabLocksIdentity.svelte.test.ts`, the established
 * precedent for loading this module for real, and extended only where
 * `backuplocal.ts` itself needs more (a fuller `process/coldstorage.svelte`
 * surface, `@tauri-apps/plugin-process`). `src/ts/storage/risuSave.ts` and
 * `src/ts/drive/backupContainer.ts` are left real and unmocked, matching
 * every sibling `backuplocal*.test.ts` file, so the backup bytes this file
 * builds and decodes are genuine.
 *
 * A "save cycle" is modeled directly here, not driven through the real (and
 * for this file, unrelated) `saveDb()` encoder pipeline: it acquires
 * `dbWriteLock`, writes through `forageStorage.setItem`, and releases,
 * exactly the shape `saveDb()`'s own write does. The race under test is
 * about which write commits last on the shared write mutex, not about the
 * encoder that produces the bytes, so a lighter stand-in for the write
 * itself keeps the test focused on I10 without pulling in the whole encoder.
 *
 * `forageStorage.setItem` (the real `AutoStorage` instance's mocked method,
 * from the `storage/autoStorage` mock below) is a single controllable seam:
 * a write whose bytes match the save cycle's own payload is held back until
 * the test explicitly releases it, and only commits into the in-memory
 * store at that point; every other write commits immediately. This models
 * an async storage write whose actual completion time -- not its call
 * order -- decides which write's bytes remain in the store afterward.
 *
 * `globalApi.svelte.ts` reads `navigator.locks` once, at module-evaluation
 * time, to build its `dbWriteLock` singleton, and I10's own successful-restore
 * scenarios deliberately never release that lock (the same way the production
 * write never does). Each test below therefore gets a completely fresh
 * module graph -- its own `FakeSingleTabLockManager`, and its own dynamically
 * re-imported `globalApi.svelte`/`backuplocal`/`risuSave` instances built on
 * top of it -- via `vi.resetModules()` and a re-import in `beforeEach`, the
 * same per-test isolation `bootstrap.staleAccountProfile.svelte.test.ts` uses
 * for the same reason. No test's held lock or mutated `setItem` mock can leak
 * into another, so nothing here depends on declaration or run order.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'
import { createForageBackedStore, type ForageLike } from '../../storage/tests/forageBackedStore'

//#region module mocks -- copied verbatim from globalApi.storageTabLocksIdentity.svelte.test.ts,
//#region extended where backuplocal.ts itself needs more

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
}))

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

// Extended beyond globalApi.svelte.ts's own `getColdStorageItem` need to also
// cover every export `backuplocal.ts`'s `LoadLocalBackup` uses.
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

/** Narrows a `Uint8Array<ArrayBufferLike>` to the `Uint8Array<ArrayBuffer>` shape `BlobPart` requires. */
function asBlobPart(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    return bytes as unknown as Uint8Array<ArrayBuffer>
}

function makeFakeFile(bytes: Uint8Array): File {
    return new File([asBlobPart(bytes)], 'backup.bin')
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false
        }
    }
    return true
}

let capturedInput: HTMLInputElement | null = null

/** Drives the real `LoadLocalBackup()` with `bytes` as the selected file's content, and awaits its onchange handler. */
async function loadBackupBytes(bytes: Uint8Array): Promise<void> {
    const realCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = realCreateElement(tag)
        if (tag === 'input') {
            capturedInput = el as HTMLInputElement
        }
        return el
    })
    try {
        loadLocalBackup()
        const input = capturedInput
        if (!input) {
            throw new Error('LoadLocalBackup did not create a file input')
        }
        const file = makeFakeFile(bytes)
        Object.defineProperty(input, 'files', { value: [file], configurable: true })
        await (input.onchange as unknown as (ev: Event) => Promise<void>).call(input, new Event('change'))
    } finally {
        createElementSpy.mockRestore()
    }
}

//#endregion

//#region a fake single-tab Web Locks manager, stubbed before each test's module import below,
//#region copied verbatim from globalApi.storageTabLocksIdentity.svelte.test.ts

type LockMode = 'shared' | 'exclusive'
interface QueuedRequest {
    mode: LockMode
    callback: (lock: { name: string, mode: LockMode }) => Promise<unknown>
    resolve: (value: unknown) => void
    reject: (reason: unknown) => void
}

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
//#endregion

let globalApi: typeof import('../../globalApi.svelte')
let loadLocalBackup: typeof import('../backuplocal')['LoadLocalBackup']
let encodeRisuSaveLegacy: typeof import('../../storage/risuSave')['encodeRisuSaveLegacy']

beforeEach(async () => {
    // See the file header: every test gets its own module graph, built on its
    // own fresh lock manager, so a lock one test's own successful-restore
    // scenario deliberately never releases can never block a later test.
    vi.resetModules()
    // globalApi.svelte.ts reads navigator.locks once, at module-evaluation
    // time -- this must be set before the dynamic import below, not after.
    Object.defineProperty(window.navigator, 'locks', {
        value: new FakeSingleTabLockManager(),
        configurable: true,
    })
    globalApi = await import('../../globalApi.svelte')
    // The restore writes the main file through the page's byte store; here it is the storage-object model.
    const { injectAppStore } = await import('../../storage/store/appStore')
    injectAppStore(createForageBackedStore(globalApi.forageStorage as unknown as ForageLike))
    const backuplocal = await import('../backuplocal')
    loadLocalBackup = backuplocal.LoadLocalBackup
    const risuSave = await import('../../storage/risuSave')
    encodeRisuSaveLegacy = risuSave.encodeRisuSaveLegacy
})

/**
 * Models "a save cycle": acquires the real `dbWriteLock`, writes through the
 * real `forageStorage.setItem`, and releases -- exactly the shape `saveDb()`'s
 * own write takes around the same key.
 */
async function runSaveCycle(payload: Uint8Array): Promise<void> {
    const release = await globalApi.dbWriteLock.acquire()
    try {
        await globalApi.forageStorage.setItem('database/database.bin', payload)
    } finally {
        release()
    }
}

/**
 * Routes `forageStorage.setItem` for `database/database.bin`: the call whose
 * bytes match `gatedBytes` resolves, and commits into `store`, only once the
 * returned `release()` is called; every other call commits immediately.
 */
function armGatedSetItem(gatedBytes: Uint8Array, store: Map<string, Uint8Array>): { release: () => void } {
    let resolveGate: () => void = () => { }
    const gate = new Promise<void>((resolve) => { resolveGate = resolve })
    vi.mocked(globalApi.forageStorage.setItem).mockImplementation(async (key: unknown, data: unknown) => {
        const bytes = data as Uint8Array
        if (key === 'database/database.bin' && bytesEqual(bytes, gatedBytes)) {
            await gate
            store.set(key as string, bytes)
            return null
        }
        store.set(key as string, bytes)
        return null
    })
    return { release: () => resolveGate() }
}

describe('LoadLocalBackup(): a failed restore write never leaves dbWriteLock held (guard)', () => {
    test('a later writer still acquires dbWriteLock after the restore write rejects', async () => {
        const restoreDb = { characters: [], mainPrompt: 'restored-marker-guard' } as unknown as Database
        const restoreBytes = encodeRisuSaveLegacy(restoreDb, 'noCompression')
        const fixtureBytes = buildChunk('database.risudat', restoreBytes)

        vi.mocked(globalApi.forageStorage.setItem).mockImplementation(async (key: unknown) => {
            if (key === 'database/database.bin') {
                throw new Error('scratch: restore write failed')
            }
            return null
        })

        await loadBackupBytes(fixtureBytes).catch(() => { })

        const release = await globalApi.dbWriteLock.acquire()
        expect(typeof release).toBe('function')
        release()
    })
})

describe('LoadLocalBackup() and a save cycle that already holds dbWriteLock race the same database.bin write (I10)', () => {
    test('a save cycle that already holds dbWriteLock, and completes its write late, never leaves its pre-restore payload as the last write', async () => {
        const store = new Map<string, Uint8Array>()
        const preRestoreDb = { characters: [], mainPrompt: 'pre-restore-marker' } as unknown as Database
        const restoreDb = { characters: [], mainPrompt: 'restored-marker' } as unknown as Database
        const preRestoreBytes = encodeRisuSaveLegacy(preRestoreDb, 'noCompression')
        const restoreBytes = encodeRisuSaveLegacy(restoreDb, 'noCompression')
        const fixtureBytes = buildChunk('database.risudat', restoreBytes)

        const gate = armGatedSetItem(preRestoreBytes, store)

        const saveCyclePromise = runSaveCycle(preRestoreBytes)
        const restorePromise = loadBackupBytes(fixtureBytes)

        // Gives the restore -- unlocked at HEAD -- room to attempt, and (at
        // HEAD) complete, its own write before the save cycle's held-back
        // write is allowed to land.
        await new Promise((resolve) => setTimeout(resolve, 50))

        gate.release()
        await saveCyclePromise
        await restorePromise

        const lastWritten = store.get('database/database.bin')
        expect(lastWritten).toBeDefined()
        expect(bytesEqual(lastWritten!, restoreBytes)).toBe(true)
    })
})

describe('LoadLocalBackup() and a save cycle that asks for dbWriteLock only after the restore write races the same database.bin write (I10)', () => {
    test('a save cycle carrying pre-restore bytes never lands once it asks for the lock after the restore has already written', async () => {
        const store = new Map<string, Uint8Array>()
        const preRestoreDb = { characters: [], mainPrompt: 'pre-restore-marker-late' } as unknown as Database
        const restoreDb = { characters: [], mainPrompt: 'restored-marker-late' } as unknown as Database
        const preRestoreBytes = encodeRisuSaveLegacy(preRestoreDb, 'noCompression')
        const restoreBytes = encodeRisuSaveLegacy(restoreDb, 'noCompression')
        const fixtureBytes = buildChunk('database.risudat', restoreBytes)

        vi.mocked(globalApi.forageStorage.setItem).mockImplementation(async (key: unknown, data: unknown) => {
            store.set(key as string, data as Uint8Array)
            return null
        })

        // The restore runs to completion, unblocked, before the save cycle
        // -- which had already encoded preRestoreBytes, the way saveDb()
        // encodes before it ever asks for the lock -- makes its own first
        // request for dbWriteLock.
        await loadBackupBytes(fixtureBytes)
        expect(bytesEqual(store.get('database/database.bin')!, restoreBytes)).toBe(true)

        let landed = false
        void runSaveCycle(preRestoreBytes).then(() => { landed = true })
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(landed).toBe(false)
        expect(bytesEqual(store.get('database/database.bin')!, restoreBytes)).toBe(true)
    })
})
