// @vitest-environment happy-dom

/**
 * `loadInternalBackup()` (`src/ts/drive/internalBackup.ts`) writes the chosen
 * snapshot's bytes to the main database file and reloads; it never installs a
 * database into the running page.
 *
 * Drives the REAL `globalApi.svelte.ts` (its `dbWriteLock`, its storage tab
 * locks and the exclusive hold built on them), the real `risuSave` codec, the
 * real main-file record and the real `loadInternalBackup` together, so the
 * write mutex and the Web Locks the load takes are the ones production shares
 * with `saveDb()`. A fake Web Locks manager stands in for `navigator.locks`
 * (one browser origin, several simulated tabs). Storage, the Tauri file
 * system and process, the alert surface, the language table and the reload
 * primitives are mocked: a mocked success is not evidence of native (Tauri)
 * or Node-server backend behaviour.
 *
 * The language table is a proxy that returns a marker naming each key, so a
 * message assertion can never be satisfied by two missing keys comparing equal.
 *
 * A successful load keeps `dbWriteLock` closed for the life of its module
 * graph, so every test boots a fresh module graph (`vi.resetModules()` and a
 * re-import), a fresh lock manager and fresh storage.
 *
 * Tests titled `guard:` pin behaviour that must be preserved and pass before
 * and after the change; every other test is a regression test for the
 * behaviour it names.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../storage/database.svelte'
import { NodeStorageConflictError } from '../../storage/nodeStorage'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from '../../storage/tests/fakeWebLocks'

//#region shared observation state (hoisted so every mock factory and test sees the same objects)

interface AlertState {
    type: string
    msg: string
    onCancel?: () => void
}

interface FsEntry {
    name: string
    isFile: boolean
    isDirectory: boolean
    isSymlink: boolean
}

const alertBox = vi.hoisted(() => ({
    history: [] as AlertState[],
    selectAnswer: '1',
    selectCalls: [] as string[][],
    selectThrows: undefined as Error | undefined,
    onSelect: undefined as undefined | (() => Promise<void> | void),
    confirmAnswer: true,
    confirmCalls: [] as string[],
}))

const storage = vi.hoisted(() => ({
    items: new Map<string, Uint8Array>(),
    setLog: [] as Array<{ key: string, value: unknown }>,
    getLog: [] as string[],
    keysCalls: 0,
    failSet: undefined as undefined | ((key: string) => Error | undefined),
    keysError: undefined as Error | undefined,
    onGet: undefined as undefined | ((key: string) => Promise<void> | void),
}))

const tauriFs = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    writeLog: [] as Array<{ path: string, data: Uint8Array }>,
    readLog: [] as string[],
    renameLog: [] as Array<{ from: string, to: string }>,
    /** Writes whose body satisfies this reject after storing a partial body at the path they were given. */
    failPayload: undefined as undefined | ((data: Uint8Array) => boolean),
    /** How many writes `failPayload` made reject. */
    faultsFired: 0,
    readDirError: undefined as Error | undefined,
}))

const platformBox = vi.hoisted(() => ({ isTauri: false, isNodeServer: false }))
const guardBox = vi.hoisted(() => ({ appInitiatedReload: false }))
const workBox = vi.hoisted(() => ({ busy: false }))
const lockHooks = vi.hoisted(() => ({ onExclusiveRequest: undefined as undefined | (() => void) }))
const relaunchBox = vi.hoisted(() => ({ calls: 0, impl: undefined as undefined | (() => Promise<void> | void) }))
const navBox = vi.hoisted(() => ({ reloadImpl: undefined as undefined | (() => void) }))
const setDatabaseMock = vi.hoisted(() => vi.fn())
/** Chronological log of the events whose relative order an invariant fixes. */
const order = vi.hoisted(() => [] as string[])

//#endregion

//#region module mocks

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
    get isTauri() { return platformBox.isTauri },
    get isNodeServer() { return platformBox.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../../lang'), () => ({
    language: new Proxy({}, {
        get: (_target, key) => (typeof key === 'string' ? `[[${key}]]` : undefined),
    }),
    changeLanguage: vi.fn(),
}) as unknown as typeof import('../../../lang'))

vi.mock(import('../../storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('../../storage/dbChangeEffects.svelte'))

vi.mock(import('../../storage/database.svelte'), async () => {
    const stores = await import('../../stores.svelte')
    return {
        getDatabase: vi.fn(() => stores.DBState.db),
        setDatabase: setDatabaseMock,
        presetTemplate: { name: 'test-preset' },
        defaultSdDataFunc: vi.fn(() => ({})),
        appVer: 'test',
        appSubVer: 'test',
        getCurrentCharacter: vi.fn(),
    } as unknown as typeof import('../../storage/database.svelte')
})

vi.mock(import('../../stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as unknown as Database })
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

vi.mock(import('../../alert'), async () => {
    const { writable } = await import('svelte/store')
    const alertStore = writable<AlertState>({ type: 'none', msg: '' })
    alertStore.subscribe((value) => { alertBox.history.push(value) })
    const show = (type: string, msg: string, onCancel?: () => void) => {
        const state: AlertState = { type, msg }
        if (onCancel) {
            state.onCancel = onCancel
        }
        alertStore.set(state)
        return state
    }
    return {
        alertStore,
        alertError: (msg: string) => { show('error', msg) },
        alertWait: (msg: string, onCancel?: () => void) => show('wait', msg, onCancel),
        alertNormal: (msg: string) => { show('normal', msg) },
        alertMd: (msg: string) => { show('markdown', msg) },
        alertClear: () => { show('none', '') },
        alertSelect: async (options: string[]) => {
            alertBox.selectCalls.push(options)
            await alertBox.onSelect?.()
            if (alertBox.selectThrows) {
                throw alertBox.selectThrows
            }
            return alertBox.selectAnswer
        },
        alertConfirm: async (msg: string) => {
            alertBox.confirmCalls.push(msg)
            return alertBox.confirmAnswer
        },
        alertToast: vi.fn(),
        alertInput: vi.fn(async () => ''),
        alertNormalWait: vi.fn(),
        alertAddCharacter: vi.fn(),
        waitAlert: vi.fn(async () => { }),
    } as unknown as typeof import('../../alert')
})

vi.mock(import('../backupWorkGuard'), async () => {
    const alert = await import('../../alert')
    const lang = await import('../../../lang')
    return {
        refuseBackupLoadWhileBusy: () => {
            if (!workBox.busy) {
                return false
            }
            alert.alertError(lang.language.backupLoadWorkInProgress)
            return true
        },
    }
})

vi.mock(import('../../reloadGuard'), () => ({
    markAppInitiatedReload: () => {
        order.push('mark')
        guardBox.appInitiatedReload = true
    },
    isAppInitiatedReload: () => guardBox.appInitiatedReload,
    allowNextBeforeUnload: vi.fn(),
    consumeExternalHandoffAllowance: vi.fn(() => false),
}) as unknown as typeof import('../../reloadGuard'))

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
    writeFile: async (path: string, data: Uint8Array) => {
        if (tauriFs.failPayload?.(data)) {
            tauriFs.faultsFired++
            tauriFs.files.set(path, data.slice(0, Math.max(1, Math.floor(data.length / 2))))
            throw `scratch: write failed (os error 112)`
        }
        tauriFs.writeLog.push({ path, data })
        tauriFs.files.set(path, data)
    },
    rename: async (from: string, to: string, options?: { oldPathBaseDir?: number, newPathBaseDir?: number }) => {
        if (options?.oldPathBaseDir === undefined || options?.newPathBaseDir === undefined) {
            throw `forbidden path: ${from}`
        }
        const found = tauriFs.files.get(from)
        if (!found) {
            throw `scratch: no such file ${from} (os error 2)`
        }
        tauriFs.renameLog.push({ from, to })
        tauriFs.files.set(to, found)
        tauriFs.files.delete(from)
    },
    readFile: async (path: string) => {
        tauriFs.readLog.push(path)
        const found = tauriFs.files.get(path)
        if (!found) {
            throw new Error(`scratch: no such file ${path}`)
        }
        return found
    },
    exists: async (path: string) => tauriFs.files.has(path)
        || (path === 'remotes' && Array.from(tauriFs.files.keys()).some((key) => key.startsWith('remotes/'))),
    mkdir: async () => { },
    readDir: async (dir: string) => {
        if (tauriFs.readDirError) {
            throw tauriFs.readDirError
        }
        const prefix = `${dir}/`
        return Array.from(tauriFs.files.keys())
            .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
            .map((key): FsEntry => ({ name: key.slice(prefix.length), isFile: true, isDirectory: false, isSymlink: false }))
    },
    remove: async (path: string) => { tauriFs.files.delete(path) },
}))

vi.mock('@tauri-apps/plugin-process', () => ({
    relaunch: async () => {
        order.push('relaunch')
        relaunchBox.calls++
        await relaunchBox.impl?.()
    },
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
        async getItem(key: string) {
            storage.getLog.push(key)
            await storage.onGet?.(key)
            return storage.items.get(key) ?? null
        }
        async setItem(key: string, value: Uint8Array) {
            const failure = storage.failSet?.(key)
            if (failure) {
                throw failure
            }
            storage.setLog.push({ key, value })
            storage.items.set(key, value)
            return null
        }
        async keys() {
            storage.keysCalls++
            if (storage.keysError) {
                throw storage.keysError
            }
            return Array.from(storage.items.keys())
        }
        async removeItem(key: string) {
            storage.items.delete(key)
        }
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

//#region world: one fresh module graph, lock manager and live database per test

const MAIN = 'database/database.bin'
const LIVE_MAIN_BYTES = new TextEncoder().encode('live-main-file-bytes')
/** Delay after which a lock acquisition that has not resolved counts as "never resolves". */
const PROBE_MS = 40

/** Logs every lock the page requests and grants, so order and mode are observable. */
class LoggingTabView extends FakeTabLockManagerView {
    request(name: string, options: { mode?: 'shared' | 'exclusive', signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown>) {
        const mode = options.mode ?? 'exclusive'
        order.push(`lock:${mode}-requested`)
        if (mode === 'exclusive') {
            lockHooks.onExclusiveRequest?.()
        }
        return super.request(name, options, (lock) => {
            order.push(`lock:${mode}-granted`)
            return callback(lock)
        })
    }
}

type Platform = 'web' | 'node' | 'tauri'

interface BootOptions {
    platform?: Platform
    webLocks?: boolean
}

interface World {
    platform: Platform
    api: typeof import('../../globalApi.svelte')
    load: () => Promise<void>
    risuSave: typeof import('../../storage/risuSave')
    mainFileRecord: typeof import('../../storage/mainFileRecord')
    startupCleanup: typeof import('../../storage/startupCleanupState')
    stores: typeof import('../../stores.svelte')
    core: FakeLockManagerCore
    liveDb: Database
    /** The live database as the page holds it when the world was built. */
    liveBefore: Database
}

async function boot(options: BootOptions = {}): Promise<World> {
    vi.resetModules()
    const platform = options.platform ?? 'web'
    platformBox.isTauri = platform === 'tauri'
    platformBox.isNodeServer = platform === 'node'
    const core = new FakeLockManagerCore()
    Object.defineProperty(window.navigator, 'locks', {
        value: options.webLocks === false ? undefined : new LoggingTabView(core, 'A'),
        configurable: true,
    })
    const api = await import('../../globalApi.svelte')
    const internal = await import('../internalBackup')
    const risuSave = await import('../../storage/risuSave')
    const mainFileRecord = await import('../../storage/mainFileRecord')
    const startupCleanup = await import('../../storage/startupCleanupState')
    const stores = await import('../../stores.svelte')
    startupCleanup.resetStartupCleanupForTests()
    await api.tabPresenceLockAcquired

    const liveDb = {
        formatversion: 5,
        enableRemoteSaving: platform !== 'web',
        characters: [fixtureCharacter('live-char', 'Live character')],
    } as unknown as Database
    stores.DBState.db = liveDb
    const liveBefore = stores.DBState.db
    return { platform, api, load: internal.loadInternalBackup, risuSave, mainFileRecord, startupCleanup, stores, core, liveDb, liveBefore }
}

//#endregion

//#region fixtures

function fixtureCharacter(chaId: string, name: string): Database['characters'][number] {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat-0`, message: [], note: '', name: '', localLore: [] }],
    } as unknown as Database['characters'][number]
}

function snapshotDb(characters: Database['characters'], extra: Record<string, unknown> = {}): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
        ...extra,
    } as unknown as Database
}

async function encodeSnapshot(world: World, characters: Database['characters']): Promise<Uint8Array> {
    const encoder = new world.risuSave.RisuSaveEncoder()
    await encoder.init(snapshotDb(characters), { compression: false, skipRemoteSavingOnCharacters: false })
    return new Uint8Array(encoder.encode()!)
}

function snapshotKey(n = 17000000000): string {
    return `database/dbbackup-${n}.bin`
}

/** Stores `bytes` as a numbered snapshot where this world's platform lists its backups. */
function putSnapshot(world: World, bytes: Uint8Array, n = 17000000000): string {
    const key = snapshotKey(n)
    if (world.platform === 'tauri') {
        tauriFs.files.set(key, bytes)
    } else {
        storage.items.set(key, bytes)
    }
    return key
}

function removeSnapshot(world: World, key: string): void {
    if (world.platform === 'tauri') {
        tauriFs.files.delete(key)
    } else {
        storage.items.delete(key)
    }
}

function putMain(world: World): void {
    if (world.platform === 'tauri') {
        tauriFs.files.set(MAIN, LIVE_MAIN_BYTES)
    } else {
        storage.items.set(MAIN, LIVE_MAIN_BYTES)
    }
}

function mainBytes(world: World): Uint8Array | undefined {
    return world.platform === 'tauri' ? tauriFs.files.get(MAIN) : storage.items.get(MAIN)
}

/**
 * Every value written to the main file key, in write order. On Tauri a value
 * counts when it was written to the main path directly or to a file that was
 * then renamed over it.
 */
function mainWrites(world: World): Uint8Array[] {
    if (world.platform === 'tauri') {
        const renamedSources = new Set(tauriFs.renameLog.filter((entry) => entry.to === MAIN).map((entry) => entry.from))
        return tauriFs.writeLog.filter((entry) => entry.path === MAIN || renamedSources.has(entry.path)).map((entry) => entry.data)
    }
    return storage.setLog.filter((entry) => entry.key === MAIN).map((entry) => entry.value as Uint8Array)
}

/** The names in `database/` that are neither the main file nor a numbered snapshot. */
function strayDatabaseFiles(): string[] {
    return Array.from(tauriFs.files.keys())
        .filter((key) => key.startsWith('database/') && key !== MAIN && !key.startsWith('database/dbbackup-'))
}

function snapshotWasRead(world: World, key: string): boolean {
    return world.platform === 'tauri' ? tauriFs.readLog.includes(key) : storage.getLog.includes(key)
}

function remoteKeys(world: World): string[] {
    const keys = world.platform === 'tauri' ? Array.from(tauriFs.files.keys()) : Array.from(storage.items.keys())
    return keys.filter((key) => key.startsWith('remotes/'))
}

function dropRemoteBlocks(world: World): void {
    for (const key of remoteKeys(world)) {
        if (world.platform === 'tauri') {
            tauriFs.files.delete(key)
        } else {
            storage.items.delete(key)
        }
    }
}

/** Forgets what seeding did, so the load's own effects are all that the logs hold. */
function clearObservations(): void {
    alertBox.history.length = 0
    alertBox.selectCalls.length = 0
    alertBox.confirmCalls.length = 0
    storage.setLog.length = 0
    storage.getLog.length = 0
    storage.keysCalls = 0
    tauriFs.writeLog.length = 0
    tauriFs.readLog.length = 0
    tauriFs.renameLog.length = 0
    relaunchBox.calls = 0
    setDatabaseMock.mockClear()
    reloadSpy.mockClear()
    replaceStateSpy.mockClear()
    order.length = 0
}

/** A world holding the live main file and one valid snapshot of `char-A`. */
async function worldWithSnapshot(options: BootOptions = {}): Promise<{ world: World, bytes: Uint8Array, key: string }> {
    const world = await boot(options)
    putMain(world)
    const bytes = await encodeSnapshot(world, [fixtureCharacter('char-A', 'A from snapshot')])
    const key = putSnapshot(world, bytes)
    clearObservations()
    return { world, bytes, key }
}

/** A world whose single snapshot references a remote block that is then removed from storage. */
async function worldWithMissingRemoteBlock(platform: 'node' | 'tauri'): Promise<{ world: World, key: string }> {
    const world = await boot({ platform })
    putMain(world)
    const bytes = await encodeSnapshot(world, [fixtureCharacter('char-R', 'Remote character')])
    expect(remoteKeys(world).length, 'seeding wrote a remote block').toBeGreaterThan(0)
    dropRemoteBlocks(world)
    const key = putSnapshot(world, bytes)
    clearObservations()
    return { world, key }
}

function u32le(n: number): Uint8Array {
    const buf = new Uint8Array(4)
    new DataView(buf.buffer).setUint32(0, n, true)
    return buf
}

/** A RisuSave version-0 file in the upstream encoder's block framing: no block checksums. */
function buildVersion0Snapshot(): Uint8Array {
    const text = (value: string) => new TextEncoder().encode(value)
    const blocks = [
        { type: 1, name: 'root', payload: text(JSON.stringify({ formatversion: 5, botPresetsId: 0, __directory: ['upstream-cha', 'pluginStorage'] })) },
        { type: 2, name: 'upstream-cha', payload: text(JSON.stringify({ chaId: 'upstream-cha', type: 'character', name: 'Upstream', chats: [] })) },
        { type: 11, name: 'pluginStorage', payload: text('{"a":1}') },
    ]
    const parts = blocks.map((block) => {
        const nameBytes = text(block.name)
        const out = new Uint8Array(3 + nameBytes.length + 4 + block.payload.length)
        out.set([block.type, 0, nameBytes.length], 0)
        out.set(nameBytes, 3)
        out.set(u32le(block.payload.length), 3 + nameBytes.length)
        out.set(block.payload, 3 + nameBytes.length + 4)
        return out
    })
    const header = new Uint8Array([...text('RISUSAVE'), 0])
    const out = new Uint8Array(header.length + parts.reduce((sum, part) => sum + part.length, 0))
    out.set(header, 0)
    let offset = header.length
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

//#endregion

//#region observation helpers

const msg = (key: string): string => `[[${key}]]`

function delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function ticks(n = 10): Promise<void> {
    for (let i = 0; i < n; i++) {
        await delay(0)
    }
}

/** Runs the load and captures a rejection as a value instead of failing the test with it. */
function runLoad(world: World): Promise<Error | undefined> {
    return world.load().then(
        () => undefined,
        (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
    )
}

/** Runs the load on fake timers, advancing the clock past every wait, until it settles. */
async function runLoadOnFakeClock(world: World): Promise<Error | undefined> {
    const done = runLoad(world)
    let settled = false
    void done.then(() => { settled = true })
    for (let i = 0; i < 12 && !settled; i++) {
        await vi.advanceTimersByTimeAsync(500)
    }
    return await done
}

function errorMessages(): string[] {
    return alertBox.history.filter((state) => state.type === 'error').map((state) => state.msg)
}

function finalAlert(): AlertState | undefined {
    return alertBox.history[alertBox.history.length - 1]
}

/** The alert state when the call settled is `expected`, and no other error was shown on the way. */
function expectOneError(expected: string): void {
    expect.soft(errorMessages(), 'every error message shown').toEqual([expected])
    expect.soft(finalAlert(), 'the alert state when the call settled').toMatchObject({ type: 'error', msg: expected })
}

function expectNoError(): void {
    expect.soft(errorMessages(), 'every error message shown').toEqual([])
}

function expectNoRejection(outcome: Error | undefined): void {
    expect.soft(outcome?.message, 'the load rejected').toBeUndefined()
}

/** True when a `dbWriteLock` acquisition resolves; a pending one is left queued. */
async function writeLockIsFree(world: World): Promise<boolean> {
    let release: (() => void) | undefined
    const acquired = world.api.dbWriteLock.acquire().then((r) => { release = r; return true })
    const free = await Promise.race([acquired, delay(PROBE_MS).then(() => false)])
    release?.()
    return free
}

/** Whether this page can take the exclusive hold again: 'granted', 'refused' or 'blocked' (never settles). */
async function exclusiveHoldState(world: World): Promise<'granted' | 'refused' | 'blocked'> {
    const attempt = world.api.acquireExclusiveStorageMigrationLock(200).then((release) => release)
    const result = await Promise.race([attempt, delay(400).then(() => 'blocked' as const)])
    if (result === 'blocked') {
        return 'blocked'
    }
    if (result === null) {
        return 'refused'
    }
    await result()
    return 'granted'
}

function expectNothingChanged(world: World): void {
    expect.soft(mainBytes(world), 'the main file').toEqual(LIVE_MAIN_BYTES)
    expect.soft(mainWrites(world).length, 'writes to the main file').toBe(0)
    expect.soft(reloadSpy, 'location.reload calls').not.toHaveBeenCalled()
    expect.soft(relaunchBox.calls, 'relaunch calls').toBe(0)
    expect.soft(setDatabaseMock, 'setDatabase calls').not.toHaveBeenCalled()
    expect.soft(world.stores.DBState.db === world.liveBefore, 'DBState.db is the same object').toBe(true)
}

/** Every lock and hold this call took is released: the next save can write, and the hold can be taken again. */
async function expectLocksReleased(world: World): Promise<void> {
    expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired again').toBe(true)
    if (world.platform !== 'tauri') {
        expect.soft(await exclusiveHoldState(world), 'the exclusive hold can be taken again').toBe('granted')
    }
}

function exclusiveRequests(): number {
    return order.filter((entry) => entry === 'lock:exclusive-requested').length
}

//#endregion

//#region per-test stubs

let reloadSpy: ReturnType<typeof vi.spyOn>
let replaceStateSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    alertBox.history.length = 0
    alertBox.selectAnswer = '1'
    alertBox.selectCalls.length = 0
    alertBox.selectThrows = undefined
    alertBox.onSelect = undefined
    alertBox.confirmAnswer = true
    alertBox.confirmCalls.length = 0
    storage.items.clear()
    storage.setLog.length = 0
    storage.getLog.length = 0
    storage.keysCalls = 0
    storage.failSet = undefined
    storage.keysError = undefined
    storage.onGet = undefined
    tauriFs.files.clear()
    tauriFs.writeLog.length = 0
    tauriFs.readLog.length = 0
    tauriFs.renameLog.length = 0
    tauriFs.failPayload = undefined
    tauriFs.faultsFired = 0
    tauriFs.readDirError = undefined
    guardBox.appInitiatedReload = false
    workBox.busy = false
    lockHooks.onExclusiveRequest = undefined
    relaunchBox.calls = 0
    relaunchBox.impl = undefined
    navBox.reloadImpl = undefined
    setDatabaseMock.mockClear()
    order.length = 0
    reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {
        order.push('reload')
        navBox.reloadImpl?.()
    })
    replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {
        order.push('replaceState')
    })
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

//#endregion

describe('loadInternalBackup writes the chosen snapshot', () => {
    test('writes the snapshot bytes verbatim to the main file, records them, reloads, and leaves the live database object untouched', async () => {
        const { world, bytes } = await worldWithSnapshot()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        const writes = mainWrites(world)
        expect.soft(writes.length, 'writes to database/database.bin').toBe(1)
        expect.soft(writes[0], 'the bytes written').toEqual(bytes)
        expect.soft(await world.mainFileRecord.compareWithMainFileRecord(bytes), 'the main-file record compared with the snapshot bytes').toBe('same')
        expect.soft(reloadSpy, 'location.reload calls').toHaveBeenCalledTimes(1)
        expect.soft(setDatabaseMock, 'setDatabase calls').not.toHaveBeenCalled()
        expect.soft(world.stores.DBState.db === world.liveBefore, 'DBState.db is the same object').toBe(true)
        expect.soft(errorMessages(), 'every error message shown').toEqual([])
    })

    test('keeps the write lock closed after a successful load, so a later save never writes over it', async () => {
        const { world, bytes } = await worldWithSnapshot()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainWrites(world)[0], 'the snapshot was written').toEqual(bytes)
        expect.soft(await writeLockIsFree(world), 'a dbWriteLock acquirer queued after the load resolves').toBe(false)
    })

    test('a save already holding the write lock lands first, and the snapshot is the last write and the recorded one', async () => {
        const { world, bytes } = await worldWithSnapshot()
        const saveBytes = new TextEncoder().encode('bytes-of-a-save-in-flight')
        const releaseSave = await world.api.dbWriteLock.acquire()

        const loading = runLoad(world)
        await ticks(20)
        await world.api.forageStorage.setItem(MAIN, saveBytes)
        releaseSave()
        world.mainFileRecord.noteMainFileBytes(saveBytes)
        const outcome = await loading

        expectNoRejection(outcome)
        const writes = mainWrites(world)
        expect.soft(writes.map((w) => Array.from(w)), 'every write to the main file, in order').toEqual([Array.from(saveBytes), Array.from(bytes)])
        expect.soft(mainBytes(world), 'the main file at the end').toEqual(bytes)
        expect.soft(await world.mainFileRecord.compareWithMainFileRecord(bytes), 'the main-file record compared with the snapshot bytes').toBe('same')
    })

    test('writes the snapshot that was chosen in the picker, not another one', async () => {
        const world = await boot()
        putMain(world)
        const first = await encodeSnapshot(world, [fixtureCharacter('char-first', 'First')])
        const second = await encodeSnapshot(world, [fixtureCharacter('char-second', 'Second')])
        putSnapshot(world, first, 17000000000)
        putSnapshot(world, second, 17000000001)
        alertBox.selectAnswer = '2'
        clearObservations()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainWrites(world).length, 'writes to the main file').toBe(1)
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(second)
    })

    test.each([
        ['a compressed legacy snapshot', () => {
            return (world: World) => world.risuSave.encodeRisuSaveLegacy(snapshotDb([fixtureCharacter('legacy-c', 'Legacy')]), 'compression')
        }],
        ['a raw legacy snapshot', () => {
            return (world: World) => world.risuSave.encodeRisuSaveLegacy(snapshotDb([fixtureCharacter('legacy-r', 'Legacy')]), 'noCompression')
        }],
        ['a RisuSave version-0 snapshot written by an upstream build', () => {
            return () => buildVersion0Snapshot()
        }],
    ])('loads %s: its bytes are written verbatim and the page reloads', async (_title, makeBuilder) => {
        const world = await boot()
        putMain(world)
        const bytes = makeBuilder()(world)
        putSnapshot(world, bytes)
        clearObservations()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainWrites(world).length, 'writes to the main file').toBe(1)
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(bytes)
        expect.soft(reloadSpy, 'location.reload calls').toHaveBeenCalledTimes(1)
        expectNoError()
    })

    test('reloads in order: the exclusive hold is released, the reload is marked app-initiated, the URL is cleaned, then the page reloads', async () => {
        const { world, bytes } = await worldWithSnapshot()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(storage.setLog.map((entry) => entry.key).filter((key) => key === MAIN), 'keys written to the main file').toEqual([MAIN])
        const value = mainWrites(world)[0]
        expect.soft(value === undefined ? undefined : Object.getPrototypeOf(value), 'the written value is a plain Uint8Array').toBe(Uint8Array.prototype)
        expect.soft(value, 'the bytes written').toEqual(bytes)
        const exclusiveGranted = order.lastIndexOf('lock:exclusive-granted')
        const presenceRestored = order.indexOf('lock:shared-granted', exclusiveGranted)
        const marked = order.indexOf('mark')
        const cleaned = order.indexOf('replaceState')
        const reloaded = order.indexOf('reload')
        expect.soft(exclusiveGranted, 'the exclusive hold was granted').toBeGreaterThanOrEqual(0)
        expect.soft(presenceRestored, 'the presence lock is restored after the hold').toBeGreaterThan(exclusiveGranted)
        expect.soft(marked, 'the reload is marked after the hold is released').toBeGreaterThan(presenceRestored)
        expect.soft(cleaned, 'the URL is cleaned after the mark').toBeGreaterThan(marked)
        expect.soft(reloaded, 'the reload follows the URL cleaning').toBeGreaterThan(cleaned)
        expect.soft(replaceStateSpy, 'history.replaceState arguments').toHaveBeenCalledWith(null, '', window.location.pathname + window.location.hash)
    })

    test('guard: does not acquire the write lock a second time inside the exclusive hold, so the call settles', async () => {
        // The exclusive hold already holds `dbWriteLock`: a second acquire
        // inside the hold waits on the lock the hold itself holds, so the load
        // would never settle.
        const { world } = await worldWithSnapshot()

        const settled = await Promise.race([runLoad(world).then(() => 'settled' as const), delay(1500).then(() => 'hung' as const)])

        expect(settled, 'the call settles').toBe('settled')
    })

    test('a snapshot that storage hands back as a Node Buffer is written as a plain Uint8Array with the same bytes', async () => {
        const world = await boot()
        putMain(world)
        const bytes = await encodeSnapshot(world, [fixtureCharacter('char-A', 'A from snapshot')])
        const stored = Buffer.from(bytes)
        expect(Object.getPrototypeOf(stored), 'the stored snapshot is a Buffer').toBe(Buffer.prototype)
        putSnapshot(world, stored)
        clearObservations()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        const writes = mainWrites(world)
        expect.soft(writes.length, 'writes to the main file').toBe(1)
        const value = writes[0]
        expect.soft(value !== undefined && Object.getPrototypeOf(value) === Uint8Array.prototype, 'the written value is a plain Uint8Array').toBe(true)
        expect.soft(value === undefined ? undefined : Array.from(value), 'the bytes written').toEqual(Array.from(bytes))
    })
})

describe('loadInternalBackup refuses while another tab is open', () => {
    test('another tab holding presence: shows the other-tab message, writes nothing and reloads nothing', async () => {
        const { world } = await worldWithSnapshot()
        vi.useFakeTimers()
        const tabB = makeSimulatedTab(world.core, 'B')
        await tabB.locks.tabPresenceLockAcquired

        const outcome = await runLoadOnFakeClock(world)
        vi.useRealTimers()

        expectNoRejection(outcome)
        expectOneError(msg('restoreOtherTabRefused'))
        expectNothingChanged(world)
        expect.soft(alertBox.history.some((state) => state.type === 'wait' && state.msg === msg('restoreCheckingOtherTabs')), 'the checking-other-tabs wait was shown').toBe(true)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired again').toBe(true)
    })

    test('another tab holding presence while an app-initiated reload is already in flight: shows no message and writes nothing', async () => {
        const { world } = await worldWithSnapshot()
        guardBox.appInitiatedReload = true
        vi.useFakeTimers()
        const tabB = makeSimulatedTab(world.core, 'B')
        await tabB.locks.tabPresenceLockAcquired

        const outcome = await runLoadOnFakeClock(world)
        vi.useRealTimers()

        expectNoRejection(outcome)
        expectNoError()
        expectNothingChanged(world)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired again').toBe(true)
    })

    test('without Web Locks: asks the no-lock confirm, and a "no" writes nothing and reloads nothing', async () => {
        const { world } = await worldWithSnapshot({ webLocks: false })
        alertBox.confirmAnswer = false

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(alertBox.confirmCalls, 'confirms asked').toEqual([msg('restoreNoLockWarningConfirm')])
        expectNothingChanged(world)
        expectNoError()
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired again').toBe(true)
    })

    test('without Web Locks: a "yes" writes the snapshot, reloads, and keeps the write lock closed', async () => {
        const { world, bytes } = await worldWithSnapshot({ webLocks: false })

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(alertBox.confirmCalls, 'confirms asked').toEqual([msg('restoreNoLockWarningConfirm')])
        expect.soft(mainWrites(world).length, 'writes to the main file').toBe(1)
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(bytes)
        expect.soft(reloadSpy, 'location.reload calls').toHaveBeenCalledTimes(1)
        expect.soft(await writeLockIsFree(world), 'a dbWriteLock acquirer queued after the load resolves').toBe(false)
    })
})

describe('the snapshot fixtures decode under the strict decoder as the tests assume', () => {
    test('guard: a snapshot of one character, a legacy snapshot and a version-0 snapshot each decode strictly to a database object', async () => {
        const world = await boot()
        const current = await encodeSnapshot(world, [fixtureCharacter('char-A', 'A')])
        const fixtures = [
            current,
            world.risuSave.encodeRisuSaveLegacy(snapshotDb([fixtureCharacter('legacy-c', 'Legacy')]), 'compression'),
            world.risuSave.encodeRisuSaveLegacy(snapshotDb([fixtureCharacter('legacy-r', 'Legacy')]), 'noCompression'),
            buildVersion0Snapshot(),
        ]

        for (const bytes of fixtures) {
            const decoded = await world.risuSave.decodeRisuSave(bytes, { strict: true })
            expect(typeof decoded).toBe('object')
            expect(decoded).not.toBeNull()
        }
    })

    test('guard: strict decoding rejects a snapshot with a damaged block and a snapshot whose remote block is absent', async () => {
        const world = await boot()
        const good = await encodeSnapshot(world, [fixtureCharacter('char-A', 'A')])
        const damaged = new Uint8Array(good)
        damaged[damaged.length - 1] ^= 0xff
        await expect(world.risuSave.decodeRisuSave(damaged, { strict: true })).rejects.toThrow()

        for (const platform of ['node', 'tauri'] as const) {
            const { world: remoteWorld, key } = await worldWithMissingRemoteBlock(platform)
            const stored = (platform === 'tauri' ? tauriFs.files.get(key) : storage.items.get(key)) as Uint8Array
            await expect(remoteWorld.risuSave.decodeRisuSave(stored, { strict: true }), `${platform}: a missing remote block`).rejects.toThrow()
        }
    })

    test('guard: strict decoding resolves to a non-object for a snapshot whose payload is a number, null or an array', async () => {
        const world = await boot()

        for (const value of [42, null, [1, 2, 3]]) {
            const decoded = await world.risuSave.decodeRisuSave(world.risuSave.encodeRisuSaveLegacy(value, 'noCompression'), { strict: true })
            expect(decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)).toBe(true)
        }
    })
})

describe('loadInternalBackup refuses a snapshot that cannot be read completely', () => {
    test('a remote block that is not stored (Node server): shows the unreadable message, writes nothing, and releases every lock', async () => {
        const { world } = await worldWithMissingRemoteBlock('node')

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupUnreadable'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('a remote block file that is absent (Tauri): shows the unreadable message, writes nothing, and releases the write lock', async () => {
        const { world } = await worldWithMissingRemoteBlock('tauri')

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupUnreadable'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('a block with a damaged checksum: shows the unreadable message and writes nothing', async () => {
        const world = await boot()
        putMain(world)
        const good = await encodeSnapshot(world, [fixtureCharacter('char-A', 'A from snapshot')])
        const damaged = new Uint8Array(good)
        damaged[damaged.length - 1] ^= 0xff
        putSnapshot(world, damaged)
        clearObservations()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupUnreadable'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test.each([
        ['a number', 42],
        ['null', null],
        ['an array', [1, 2, 3]],
    ])('a snapshot that decodes to %s rather than a database object: shows the unreadable message and writes nothing', async (_title, value) => {
        const world = await boot()
        putMain(world)
        putSnapshot(world, world.risuSave.encodeRisuSaveLegacy(value, 'noCompression'))
        clearObservations()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupUnreadable'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('the chosen key is gone when it is read (web): shows the unreadable message, writes nothing, and releases every lock', async () => {
        const { world, key } = await worldWithSnapshot()
        alertBox.onSelect = () => { removeSnapshot(world, key) }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupUnreadable'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('the chosen file is gone when it is read (Tauri): shows the unreadable message, writes nothing, and releases the write lock', async () => {
        const { world, key } = await worldWithSnapshot({ platform: 'tauri' })
        alertBox.onSelect = () => { removeSnapshot(world, key) }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupUnreadable'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })
})

describe('loadInternalBackup reports a failed write or reload', () => {
    test('the main-file write rejects: shows the write-failed message, keeps the live database, and releases every lock', async () => {
        const { world } = await worldWithSnapshot()
        storage.failSet = (key) => (key === MAIN ? new Error('scratch: write failed') : undefined)

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupWriteFailed'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('the Node server rejects the write with a revision conflict: shows the write-failed message and releases every lock', async () => {
        const { world } = await worldWithSnapshot({ platform: 'node' })
        storage.failSet = (key) => (key === MAIN ? new NodeStorageConflictError(7) : undefined)

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupWriteFailed'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('the Tauri main-file write rejects part-way: shows the write-failed message, leaves the main file as it was, and releases the write lock', async () => {
        const { world } = await worldWithSnapshot({ platform: 'tauri' })
        tauriFs.failPayload = () => true

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(tauriFs.faultsFired, 'writes the injected fault rejected').toBe(1)
        expectOneError(msg('internalBackupWriteFailed'))
        expectNothingChanged(world)
        expect.soft(strayDatabaseFiles(), 'files left in database/').toEqual([])
        await expectLocksReleased(world)
    })

    test('the reload throws after the write landed: tells the user the backup is saved, and keeps the write lock closed', async () => {
        const { world, bytes } = await worldWithSnapshot()
        navBox.reloadImpl = () => { throw new Error('scratch: reload failed') }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainBytes(world), 'the main file').toEqual(bytes)
        expect.soft(finalAlert(), 'the alert state when the call settled').toMatchObject({ type: 'wait', msg: msg('restoreSavedReloadOrRestart') })
        expectNoError()
        expect.soft(await writeLockIsFree(world), 'a dbWriteLock acquirer queued after the load resolves').toBe(false)
    })

    test('the Tauri relaunch rejects after the write landed: tells the user the backup is saved, and keeps the write lock closed', async () => {
        const { world, bytes } = await worldWithSnapshot({ platform: 'tauri' })
        relaunchBox.impl = () => { throw new Error('scratch: relaunch failed') }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainBytes(world), 'the main file').toEqual(bytes)
        expect.soft(finalAlert(), 'the alert state when the call settled').toMatchObject({ type: 'wait', msg: msg('restoreSavedReloadOrRestart') })
        expectNoError()
        expect.soft(await writeLockIsFree(world), 'a dbWriteLock acquirer queued after the load resolves').toBe(false)
    })
})

describe('loadInternalBackup on Tauri', () => {
    test('writes the snapshot to a temp file and renames it over the main file, relaunches, takes no exclusive hold, and keeps the write lock it acquired closed', async () => {
        const { world, bytes } = await worldWithSnapshot({ platform: 'tauri' })

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(tauriFs.writeLog.filter((entry) => entry.path === MAIN), 'writes that name the main path').toEqual([])
        expect.soft(tauriFs.renameLog.map((entry) => entry.to), 'rename targets').toEqual([MAIN])
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(bytes)
        expect.soft(mainBytes(world), 'the main file').toEqual(bytes)
        expect.soft(strayDatabaseFiles(), 'files left in database/').toEqual([])
        expect.soft(relaunchBox.calls, 'relaunch calls').toBe(1)
        expect.soft(reloadSpy, 'location.reload calls').not.toHaveBeenCalled()
        expect.soft(exclusiveRequests(), 'exclusive Web Lock requests').toBe(0)
        expect.soft(await writeLockIsFree(world), 'a dbWriteLock acquirer queued after the load resolves').toBe(false)
        expectNoError()
    })

    test('guard: a leftover temp file in database/ is not offered by the picker', async () => {
        const { world } = await worldWithSnapshot({ platform: 'tauri' })
        tauriFs.files.set('database/risu-write-0123456789abcdef.tmp', new Uint8Array([1, 2, 3]))
        alertBox.selectAnswer = '0'

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(alertBox.selectCalls.length, 'the picker was shown').toBe(1)
        expect.soft(alertBox.selectCalls[0].length, 'picker entries: Cancel and the one snapshot').toBe(2)
    })
})

describe('loadInternalBackup waits for the startup clean-up', () => {
    test('a pending startup clean-up: the snapshot is not read until it settles, behind a cancelable wait, and then the load completes', async () => {
        const { world, bytes, key } = await worldWithSnapshot()
        let finishCleanup: () => void = () => { }
        world.startupCleanup.recordStartupCleanup(new Promise<void>((resolve) => { finishCleanup = resolve }))

        const loading = runLoad(world)
        await ticks(20)
        const readWhilePending = snapshotWasRead(world, key)
        const cancelable = alertBox.history.find((state) => state.type === 'wait' && state.msg === msg('internalBackupWaitingForCleanup'))
        finishCleanup()
        const outcome = await loading

        expectNoRejection(outcome)
        expect.soft(readWhilePending, 'the snapshot was read while the clean-up was pending').toBe(false)
        expect.soft(typeof cancelable?.onCancel, 'the wait message offers a cancel').toBe('function')
        expect.soft(mainWrites(world)[0], 'the bytes written after the clean-up settled').toEqual(bytes)
    })

    test('a startup clean-up that rejected: the load proceeds and writes the snapshot', async () => {
        const { world, bytes } = await worldWithSnapshot()
        world.startupCleanup.recordStartupCleanup(Promise.reject(new Error('scratch: clean-up failed')))

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(bytes)
        expect.soft(reloadSpy, 'location.reload calls').toHaveBeenCalledTimes(1)
        expectNoError()
    })

    test('a startup clean-up that was recorded and has already settled: the load proceeds and never shows the clean-up wait', async () => {
        const { world, bytes } = await worldWithSnapshot()
        world.startupCleanup.recordStartupCleanup((async () => { })())
        await ticks()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(alertBox.history.some((state) => state.msg === msg('internalBackupWaitingForCleanup')), 'the clean-up wait was shown').toBe(false)
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(bytes)
        expect.soft(reloadSpy, 'location.reload calls').toHaveBeenCalledTimes(1)
        expectNoError()
    })

    test('the recorded start-up clean-up is a promise only while it is pending: null before anything is recorded and once it has settled, whether it resolved or rejected', async () => {
        const world = await boot()
        expect.soft(world.startupCleanup.getStartupCleanup(), 'nothing recorded').toBeNull()

        let finishResolved: () => void = () => { }
        world.startupCleanup.recordStartupCleanup(new Promise<void>((resolve) => { finishResolved = resolve }))
        expect.soft(world.startupCleanup.getStartupCleanup(), 'a recorded clean-up that is pending').not.toBeNull()
        finishResolved()
        await ticks()
        expect.soft(world.startupCleanup.getStartupCleanup(), 'the clean-up resolved').toBeNull()

        let finishRejected: (reason: Error) => void = () => { }
        world.startupCleanup.recordStartupCleanup(new Promise<void>((_resolve, reject) => { finishRejected = reject }))
        expect.soft(world.startupCleanup.getStartupCleanup(), 'a second recorded clean-up that is pending').not.toBeNull()
        finishRejected(new Error('scratch: clean-up failed'))
        await ticks()
        expect.soft(world.startupCleanup.getStartupCleanup(), 'the clean-up rejected').toBeNull()
    })

    test('no startup clean-up was ever recorded: the load proceeds and shows no clean-up wait', async () => {
        const { world, bytes } = await worldWithSnapshot()
        expect(world.startupCleanup.getStartupCleanup(), 'nothing recorded').toBeNull()

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(mainWrites(world)[0], 'the bytes written').toEqual(bytes)
        expect.soft(alertBox.history.some((state) => state.msg === msg('internalBackupWaitingForCleanup')), 'the clean-up wait was shown').toBe(false)
    })

    test('cancelling the clean-up wait ends the load: nothing is read or written, no hold or lock is taken, and no message is shown', async () => {
        const { world, key } = await worldWithSnapshot()
        let finishCleanup: () => void = () => { }
        world.startupCleanup.recordStartupCleanup(new Promise<void>((resolve) => { finishCleanup = resolve }))

        const loading = runLoad(world)
        await ticks(20)
        const cancelable = alertBox.history.find((state) => state.type === 'wait' && state.msg === msg('internalBackupWaitingForCleanup'))
        expect.soft(typeof cancelable?.onCancel, 'the wait message offers a cancel').toBe('function')
        cancelable?.onCancel?.()
        // The clean-up is still pending: only the cancel can end the wait.
        const endedByCancel = await Promise.race([loading.then(() => true), delay(200).then(() => false)])
        finishCleanup()
        const outcome = await loading

        expectNoRejection(outcome)
        expect.soft(endedByCancel, 'the load ended while the clean-up was still pending').toBe(true)
        expect.soft(snapshotWasRead(world, key), 'the snapshot was read').toBe(false)
        expectNothingChanged(world)
        expectNoError()
        expect.soft(exclusiveRequests(), 'exclusive Web Lock requests').toBe(0)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired').toBe(true)
    })

    test('Tauri: once the clean-up settles while a save holds the write lock, the cancelable clean-up wait is replaced, so no Cancel button stays up while the load waits for the lock', async () => {
        const { world, bytes } = await worldWithSnapshot({ platform: 'tauri' })
        const releaseSave = await world.api.dbWriteLock.acquire()
        let finishCleanup: () => void = () => { }
        world.startupCleanup.recordStartupCleanup(new Promise<void>((resolve) => { finishCleanup = resolve }))

        const loading = runLoad(world)
        await ticks(20)
        const whilePending = finalAlert()
        expect.soft(whilePending, 'the alert while the clean-up is pending').toMatchObject({ type: 'wait', msg: msg('internalBackupWaitingForCleanup') })
        expect.soft(typeof whilePending?.onCancel, 'the wait offers a cancel while the clean-up is pending').toBe('function')

        finishCleanup()
        await ticks(20)
        const whileWaitingForLock = finalAlert()
        const writtenBeforeLock = mainWrites(world).length
        releaseSave()
        const outcome = await loading

        expectNoRejection(outcome)
        expect.soft(writtenBeforeLock, 'writes to the main file while the lock is still held').toBe(0)
        expect.soft(whileWaitingForLock?.msg, 'the alert on screen while the load waits for the lock').not.toBe(msg('internalBackupWaitingForCleanup'))
        expect.soft(whileWaitingForLock?.onCancel, 'a cancel on the alert on screen while the load waits for the lock').toBeUndefined()
        expect.soft(mainWrites(world)[0], 'the bytes written once the lock was released').toEqual(bytes)
    })
})

describe('loadInternalBackup shows exactly one message when listing or picking fails', () => {
    test('the key listing throws (web): ends on the list-failed message with nothing changed', async () => {
        const { world } = await worldWithSnapshot()
        storage.keysError = new Error('scratch: listing failed')

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupListFailed'))
        expectNothingChanged(world)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired').toBe(true)
    })

    test('the directory listing throws (Tauri): ends on the list-failed message with nothing changed', async () => {
        const { world } = await worldWithSnapshot({ platform: 'tauri' })
        tauriFs.readDirError = new Error('scratch: listing failed')

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupListFailed'))
        expectNothingChanged(world)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired').toBe(true)
    })

    test('the picker throws: ends on the list-failed message with nothing changed', async () => {
        const { world } = await worldWithSnapshot()
        alertBox.selectThrows = new Error('scratch: picker failed')

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('internalBackupListFailed'))
        expectNothingChanged(world)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired').toBe(true)
    })
})

describe('loadInternalBackup never installs a database into the running page', () => {
    type Scenario = (world: World) => Promise<void>

    const scenarios: Array<[string, BootOptions, Scenario]> = [
        ['a successful load (web)', {}, async () => { }],
        ['a successful load (Tauri)', { platform: 'tauri' }, async () => { }],
        ['a write failure', {}, async () => { storage.failSet = (key) => (key === MAIN ? new Error('scratch: write failed') : undefined) }],
        ['a refused confirm without Web Locks', { webLocks: false }, async () => { alertBox.confirmAnswer = false }],
        ['a missing selected key', {}, async (world) => {
            alertBox.onSelect = () => { removeSnapshot(world, snapshotKey()) }
        }],
    ]

    test.each(scenarios)('%s leaves DBState.db the same object and never calls setDatabase', async (_title, options, arrange) => {
        const { world } = await worldWithSnapshot(options)
        await arrange(world)

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(setDatabaseMock, 'setDatabase calls').not.toHaveBeenCalled()
        expect.soft(world.stores.DBState.db === world.liveBefore, 'DBState.db is the same object').toBe(true)
    })
})

describe('loadInternalBackup is refused while work is in progress', () => {
    test('guard: work in progress when the load starts: refuses before the picker opens and touches nothing', async () => {
        const { world } = await worldWithSnapshot()
        workBox.busy = true

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('backupLoadWorkInProgress'))
        expect.soft(alertBox.selectCalls.length, 'the picker was shown').toBe(0)
        expect.soft(storage.keysCalls, 'storage key listings').toBe(0)
        expectNothingChanged(world)
    })

    test('guard: cancelling at the picker changes nothing, shows no message and takes no lock', async () => {
        const { world } = await worldWithSnapshot()
        alertBox.selectAnswer = '0'

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expect.soft(alertBox.selectCalls.length, 'the picker was shown').toBe(1)
        expectNoError()
        expectNothingChanged(world)
        expect.soft(exclusiveRequests(), 'exclusive Web Lock requests').toBe(0)
        expect.soft(await writeLockIsFree(world), 'dbWriteLock can be acquired').toBe(true)
    })

    test('guard: work starting while the picker is open is refused with nothing written and every lock released', async () => {
        const { world } = await worldWithSnapshot()
        alertBox.onSelect = () => { workBox.busy = true }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('backupLoadWorkInProgress'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('guard: work starting while the snapshot is read is refused with nothing written and every lock released', async () => {
        const { world, key } = await worldWithSnapshot()
        storage.onGet = (read) => { if (read === key) { workBox.busy = true } }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('backupLoadWorkInProgress'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('guard: work starting while the snapshot is decoded is refused with nothing written and every lock released', async () => {
        const world = await boot({ platform: 'node' })
        putMain(world)
        const bytes = await encodeSnapshot(world, [fixtureCharacter('char-R', 'Remote character')])
        const key = putSnapshot(world, bytes)
        const remote = remoteKeys(world)
        expect(remote.length, 'seeding wrote a remote block').toBeGreaterThan(0)
        clearObservations()
        // Decoding reads each remote block from storage, so work starting there starts during the decode.
        storage.onGet = (read) => { if (remote.includes(read)) { workBox.busy = true } }

        const outcome = await runLoad(world)

        expect.soft(snapshotWasRead(world, key), 'the snapshot was read').toBe(true)
        expectNoRejection(outcome)
        expectOneError(msg('backupLoadWorkInProgress'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })

    test('work starting while the exclusive hold is being taken is refused with nothing written and every lock released', async () => {
        const { world } = await worldWithSnapshot()
        lockHooks.onExclusiveRequest = () => { workBox.busy = true }

        const outcome = await runLoad(world)

        expectNoRejection(outcome)
        expectOneError(msg('backupLoadWorkInProgress'))
        expectNothingChanged(world)
        await expectLocksReleased(world)
    })
})
