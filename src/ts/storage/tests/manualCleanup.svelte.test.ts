// @vitest-environment happy-dom

/**
 * The manual cold-storage clean-up (`cleanColdStorage`) is one exclusive,
 * strictly-read pass (Agents/Reports/49-memory-stage-1-plan.md, D11).
 *
 * A unit is deleted only when it was present in this page's load-time listing
 * AND in the listing taken when the run starts AND nothing reads it: not live
 * memory, not the committed main file freshly read from storage, not any
 * retained snapshot, not a blob reached from any of them, and not an archived
 * chat reached from any of them, directly or through a chain of archived chats
 * that name each other by pointer or legacy error text. An asset is
 * deleted only when it was present at load and at the start and nothing reads
 * it: live memory (read again just before each batch), the characters inside
 * the blobs the trees point at, and the characters stored in full in the
 * committed main file. A retained snapshot's own characters do not keep an
 * asset.
 * The run holds the storage exclusively, refuses while anything else is
 * writing or the main file moved, aborts on anything it cannot read, deletes in
 * bounded batches and reports every failure. An archived chat that is not
 * stored, or is stored but damaged, is the one thing it can read around: the
 * chat is kept by name and followed no further.
 *
 * The real `cleanColdStorage`, `globalApi.svelte.ts`, `RisuSaveEncoder`,
 * `NodeStorage`, `storageTabLocks` and `chatOrigin` are driven; only platform
 * boundaries are replaced: the `isTauri`/`isNodeServer` flags, an OPFS
 * directory (the legacy unit files), a `forageStorage` key/value store (the
 * web page store, which holds the units and the assets), the Tauri file system,
 * the Web Locks manager, `fetch` for the Node server, and the alert functions.
 * A mocked success here is not evidence of native backend behaviour.
 *
 * Each test builds its own module graph (`vi.resetModules()`), because
 * `globalApi.svelte.ts` reads `navigator.locks` once when it is evaluated.
 * Tests titled `guard:` pass with or without the behaviour they name and pin
 * what must be preserved; every other test is a regression reproducer.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'
import type { Database } from 'src/ts/storage/database.svelte'
import { FakeLockManagerCore, FakeTabLockManagerView, makeSimulatedTab } from './fakeWebLocks'
import { BLOCK, FakeNodeServer, composeSave, corruptBlockPayload, type SavePart } from './manualCleanupHarness'
import { createForageBackedStore, type ForageLike } from './forageBackedStore'

//#region shared platform state

type AlertRecord = { type: string, msg: string }

const h = vi.hoisted(() => {
    const subscribers = new Set<(value: AlertRecord) => void>()
    const hub = {
        current: { type: 'none', msg: '' } as AlertRecord,
        history: [] as AlertRecord[],
        confirmAnswer: true,
        set(value: AlertRecord) {
            hub.current = value
            hub.history.push(value)
            subscribers.forEach((fn) => fn(value))
        },
        update(fn: (value: AlertRecord) => AlertRecord) {
            hub.set(fn(hub.current))
        },
        subscribe(fn: (value: AlertRecord) => void) {
            subscribers.add(fn)
            fn(hub.current)
            return () => { subscribers.delete(fn) }
        },
        reset() {
            hub.current = { type: 'none', msg: '' }
            hub.history = []
            hub.confirmAnswer = true
            subscribers.clear()
        },
    }
    return {
        platform: { isTauri: false, isNodeServer: false },
        hub,
        /** The key/value store behind `forageStorage` on the web build. */
        forage: new Map<string, Uint8Array>(),
        forageHooks: {
            onGetItem: undefined as undefined | ((key: string) => void),
            onRemove: undefined as undefined | ((key: string) => void),
            afterRemove: undefined as undefined | ((key: string) => void),
            /** Called after the page store has listed the units (the coldstorage/ prefix). */
            afterUnitListing: undefined as undefined | (() => void),
        },
        forageFail: new Set<string>(),
        /** Keys whose read fails with an error that is not "absent". */
        forageReadFail: new Set<string>(),
        /** The units (coldstorage/ keys) the web page store was asked to read or remove, and how many reads overlapped. */
        unitLog: { reads: [] as string[], removed: [] as string[], inFlight: 0, peakInFlight: 0 },
        /** The legacy OPFS root directory: unit files from before units went through the byte store (web build). */
        opfs: new Map<string, Uint8Array>(),
        /** Legacy file names whose removal fails. */
        opfsRemoveFail: new Set<string>(),
        /** The Tauri app-data directory. */
        fs: new Map<string, Uint8Array>(),
        /** Every path `readFile` was asked for, in order. */
        fsReads: [] as string[],
        fsFail: new Set<string>(),
        /** Reads or removals of a path that reject with `message`; `removeFile` also takes the file out first. */
        fsReadError: new Map<string, { message: string, removeFile: boolean }>(),
        fsRemoveError: new Map<string, { message: string, removeFile: boolean }>(),
        /** Paths `exists()` reports as absent whatever the store holds. */
        fsHidden: new Set<string>(),
        /** Paths whose `exists()` rejects. */
        fsExistsError: new Set<string>(),
        /** The persistent block cache behind `risuSaveCache`. */
        risuCache: new Map<string, unknown>(),
        keyPair: undefined as undefined | CryptoKeyPair,
        dbHolder: { state: undefined as undefined | { db: unknown } },
    }
})

//#endregion

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => h.risuCache.get(key) ?? null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => {
        if (!h.dbHolder.state) {
            throw new Error('no live database in tests')
        }
        return h.dbHolder.state.db
    }),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
    appVer: 'test',
    appSubVer: 'test',
    getCurrentCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    h.dbHolder.state = state
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { state: -1 },
        alertStore: h.hub,
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(null),
        CharEmotion: writable({}),
        MobileGUIStack: writable([]),
        OpenRealmStore: writable(false),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock(import('src/ts/alert'), () => ({
    alertClear: vi.fn(() => { h.hub.set({ type: 'none', msg: '' }) }),
    alertConfirm: vi.fn(async (_msg: string) => h.hub.confirmAnswer),
    alertError: vi.fn((msg: string) => { h.hub.set({ type: 'error', msg: String(msg) }) }),
    alertWait: vi.fn((msg: string) => {
        const data = { type: 'wait', msg }
        h.hub.set(data)
        return data
    }),
    alertMd: vi.fn((msg: string) => { h.hub.set({ type: 'markdown', msg }) }),
    alertNormal: vi.fn((msg: string) => { h.hub.set({ type: 'normal', msg }) }),
    alertSelect: vi.fn(),
    alertToast: vi.fn((msg: string) => { h.hub.set({ type: 'toast', msg }) }),
    alertInput: vi.fn(),
    alertNormalWait: vi.fn(),
    alertAddCharacter: vi.fn(),
    alertStore: h.hub,
    waitAlert: vi.fn(async () => {}),
    doingAlert: vi.fn(() => false),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    changeFullscreen: vi.fn(),
    checkNullish: vi.fn((v: unknown) => v === null || v === undefined),
    sleep: vi.fn(async () => {}),
    sleepForever: vi.fn(async () => {}),
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/util'))

// `write_durable` puts the whole body at the key in one step, as the Rust command does when it succeeds.
vi.mock('@tauri-apps/api/core', async () => {
    const { createDurableInvoke } = await import('src/ts/storage/tests/tauriFsFake')
    return {
        convertFileSrc: vi.fn((p: string) => p),
        invoke: createDurableInvoke((key, data) => { h.fs.set(key, data) }),
    }
})

vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/appdata'),
    join: vi.fn(async (...p: string[]) => p.join('/')),
    basename: vi.fn(async (p: string) => p.split('/').pop()),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
    open: vi.fn(async () => {}),
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

vi.mock(import('src/ts/update'), () => ({
    checkRisuUpdate: vi.fn(async () => {}),
}))

vi.mock(import('src/ts/plugins/plugins.svelte'), () => ({
    loadPlugins: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/plugins/plugins.svelte'))

vi.mock(import('src/ts/parser/parser.svelte'), () => ({
    hasher: vi.fn((s: string) => s),
    parseMarkdownSafe: vi.fn((s: string) => s),
}) as unknown as typeof import('src/ts/parser/parser.svelte'))

vi.mock(import('src/ts/characterCards'), () => ({
    characterURLImport: vi.fn(),
    hubURL: 'https://example.invalid',
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    registerDbChangeEffects: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))

vi.mock(import('src/ts/storage/autoStorage'), () => ({
    AutoStorage: class {
        realStorage: {
            getItem(key: string): Promise<Uint8Array | null>
            setItem(key: string, value: Uint8Array): Promise<void>
            keys(): Promise<string[]>
            removeItem(key: string | string[]): Promise<void>
        } | undefined = undefined

        async Init() { }

        async getItem(key: string) {
            if (this.realStorage) {
                return await this.realStorage.getItem(key)
            }
            h.forageHooks.onGetItem?.(key)
            if (!key.startsWith('coldstorage/')) {
                return h.forage.get(key) ?? null
            }
            h.unitLog.reads.push(key)
            h.unitLog.inFlight++
            h.unitLog.peakInFlight = Math.max(h.unitLog.peakInFlight, h.unitLog.inFlight)
            try {
                await Promise.resolve()
                await Promise.resolve()
                if (h.forageReadFail.has(key)) {
                    throw new Error(`simulated storage read failure for ${key}`)
                }
                return h.forage.get(key) ?? null
            } finally {
                h.unitLog.inFlight--
            }
        }

        async setItem(key: string, value: Uint8Array) {
            if (this.realStorage) {
                return await this.realStorage.setItem(key, value)
            }
            h.forage.set(key, value)
        }

        async keys() {
            if (this.realStorage) {
                return await this.realStorage.keys()
            }
            return Array.from(h.forage.keys())
        }

        async removeItem(key: string) {
            if (this.realStorage) {
                return await this.realStorage.removeItem(key)
            }
            h.forageHooks.onRemove?.(key)
            if (key.startsWith('coldstorage/')) {
                h.unitLog.removed.push(key)
            }
            if (h.forageFail.has(key)) {
                throw new Error(`simulated storage removal failure for ${key}`)
            }
            h.forage.delete(key)
            h.forageHooks.afterRemove?.(key)
        }
    },
}) as unknown as typeof import('src/ts/storage/autoStorage'))

vi.mock(import('src/ts/gui/animation'), () => ({
    updateAnimationSpeed: vi.fn(),
}) as unknown as typeof import('src/ts/gui/animation'))

vi.mock(import('src/ts/gui/colorscheme'), () => ({
    updateColorScheme: vi.fn(),
    updateTextThemeAndCSS: vi.fn(),
}) as unknown as typeof import('src/ts/gui/colorscheme'))

vi.mock('@tauri-apps/plugin-dialog', () => ({
    save: vi.fn(async () => null),
}))

vi.mock('@tauri-apps/api/event', () => ({
    listen: vi.fn(async () => vi.fn()),
}))

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

vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn(async () => new Response(null, { status: 404 })),
}))

vi.mock(import('src/ts/process/modules'), () => ({
    moduleUpdate: vi.fn(async () => {}),
}) as unknown as typeof import('src/ts/process/modules'))

function normalizeFsPath(path: string): string {
    return path.replace(/^\.\//, '').replace(/\\/g, '/')
}

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: { AppData: 0 },
    readDir: vi.fn(async (dir: string) => {
        const prefix = normalizeFsPath(dir).replace(/\/$/, '') + '/'
        const names = new Set<string>()
        for (const key of h.fs.keys()) {
            if (key.startsWith(prefix)) {
                const rest = key.slice(prefix.length)
                if (!rest.includes('/')) {
                    names.add(rest)
                }
            }
        }
        return Array.from(names).map((name) => ({ name, isFile: true, isDirectory: false }))
    }),
    readFile: vi.fn(async (path: string) => {
        const p = normalizeFsPath(path)
        h.fsReads.push(p)
        const injected = h.fsReadError.get(p)
        if (injected) {
            if (injected.removeFile) {
                h.fs.delete(p)
            }
            throw new Error(injected.message)
        }
        const bytes = h.fs.get(p)
        if (!bytes) {
            throw new Error(`No such file: ${p} (os error 2)`)
        }
        return bytes
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array) => {
        h.fs.set(normalizeFsPath(path), data)
    }),
    rename: vi.fn(async (from: string, to: string) => {
        const source = normalizeFsPath(from)
        const bytes = h.fs.get(source)
        if (!bytes) {
            throw new Error(`No such file (os error 2): ${source}`)
        }
        h.fs.set(normalizeFsPath(to), bytes)
        h.fs.delete(source)
    }),
    remove: vi.fn(async (path: string) => {
        const p = normalizeFsPath(path)
        const injected = h.fsRemoveError.get(p)
        if (injected) {
            if (injected.removeFile) {
                h.fs.delete(p)
            }
            throw new Error(injected.message)
        }
        if (h.fsFail.has(p)) {
            throw new Error(`simulated file removal failure for ${p}`)
        }
        if (!h.fs.has(p)) {
            throw new Error(`No such file (os error 2): ${p}`)
        }
        h.fs.delete(p)
    }),
    // A directory exists while any file lies under it, as on a real file system where it is only created by its first file.
    exists: vi.fn(async (path: string) => {
        const p = normalizeFsPath(path)
        if (h.fsExistsError.has(p)) {
            throw new Error(`simulated exists failure for ${p}`)
        }
        return !h.fsHidden.has(p) && (h.fs.has(p) || Array.from(h.fs.keys()).some((key) => key.startsWith(p + '/')))
    }),
    mkdir: vi.fn(async () => {}),
}))

//#endregion

//#region legacy OPFS unit files (the web build's units from before units went through the byte store)

class FakeNotFoundError extends Error {
    name = 'NotFoundError'
}

function opfsName(key: string): string {
    return 'coldstorage_' + key + '.json'
}

const opfsDirectory = {
    async getFileHandle(name: string) {
        if (!h.opfs.has(name)) {
            throw new FakeNotFoundError(`not found: ${name}`)
        }
        return {
            async getFile() {
                return {
                    async arrayBuffer() {
                        const bytes = h.opfs.get(name)!
                        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
                    },
                }
            },
        }
    },
    async removeEntry(name: string) {
        if (h.opfsRemoveFail.has(name)) {
            throw new Error(`simulated OPFS removal failure for ${name}`)
        }
        if (!h.opfs.has(name)) {
            throw new FakeNotFoundError(`not found: ${name}`)
        }
        h.opfs.delete(name)
    },
    entries() {
        const iter = Array.from(h.opfs.keys())[Symbol.iterator]()
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        const r = iter.next()
                        if (r.done) {
                            return { done: true as const, value: undefined }
                        }
                        return { done: false as const, value: [r.value, {}] as [string, unknown] }
                    },
                }
            },
        }
    },
}

Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => opfsDirectory },
})

//#endregion

//#region per-test world

type Character = Database['characters'][number]

interface Ctx {
    cold: typeof import('src/ts/process/coldstorage.svelte')
    listing: typeof import('src/ts/storage/loadTimeListing')
    mainRec: typeof import('src/ts/storage/mainFileRecord')
    stores: typeof import('src/ts/stores.svelte')
    globalApi: typeof import('src/ts/globalApi.svelte')
    chatOrigin: typeof import('src/ts/process/chatOrigin')
    busy: typeof import('src/ts/process/memory/busyActions')
    generation: typeof import('src/ts/process/generationOwnership.svelte')
    risuSave: typeof import('src/ts/storage/risuSave')
    nodeMod: typeof import('src/ts/storage/nodeStorage')
    alert: typeof import('src/ts/alert')
}

type Platform = 'web' | 'tauri' | 'node'

let ctx: Ctx
let core: FakeLockManagerCore
let server: FakeNodeServer
let platform: Platform = 'web'
const realFetch = globalThis.fetch

function resetWorld(): void {
    h.hub.reset()
    h.forage.clear()
    h.forageHooks.onGetItem = undefined
    h.forageHooks.onRemove = undefined
    h.forageHooks.afterRemove = undefined
    h.forageHooks.afterUnitListing = undefined
    h.forageFail.clear()
    h.forageReadFail.clear()
    h.unitLog.reads = []
    h.unitLog.removed = []
    h.unitLog.inFlight = 0
    h.unitLog.peakInFlight = 0
    h.opfs.clear()
    h.opfsRemoveFail.clear()
    h.fs.clear()
    h.fsReads = []
    h.fsFail.clear()
    h.fsReadError.clear()
    h.fsRemoveError.clear()
    h.fsHidden.clear()
    h.fsExistsError.clear()
    h.risuCache.clear()
}

/**
 * Boots a fresh module graph on `platform`. `locks: 'none'` models a browser
 * without Web Locks; otherwise this tab ('A') owns a shared fake lock manager
 * that a second simulated tab can join.
 */
async function setup(options: { platform?: Platform, locks?: 'single' | 'none' } = {}): Promise<Ctx> {
    resetWorld()
    platform = options.platform ?? 'web'
    h.platform.isTauri = platform === 'tauri'
    h.platform.isNodeServer = platform === 'node'
    core = new FakeLockManagerCore()
    server = new FakeNodeServer()
    vi.resetModules()
    Object.defineProperty(window.navigator, 'locks', {
        value: options.locks === 'none' ? undefined : new FakeTabLockManagerView(core, 'A'),
        configurable: true,
    })
    ctx = {
        globalApi: await import('src/ts/globalApi.svelte'),
        cold: await import('src/ts/process/coldstorage.svelte'),
        listing: await import('src/ts/storage/loadTimeListing'),
        mainRec: await import('src/ts/storage/mainFileRecord'),
        stores: await import('src/ts/stores.svelte'),
        chatOrigin: await import('src/ts/process/chatOrigin'),
        busy: await import('src/ts/process/memory/busyActions'),
        generation: await import('src/ts/process/generationOwnership.svelte'),
        risuSave: await import('src/ts/storage/risuSave'),
        nodeMod: await import('src/ts/storage/nodeStorage'),
        alert: await import('src/ts/alert'),
    }
    vi.clearAllMocks()
    ctx.listing.resetLoadTimeListingForTests()
    ctx.mainRec.resetMainFileRecordForTests()
    ctx.stores.frozenSaveKeysStore.set([])
    ctx.stores.savingStoppedReason.set(null)
    if (platform === 'node') {
        vi.stubGlobal('fetch', server.fetch)
        ctx.globalApi.forageStorage.realStorage = new ctx.nodeMod.NodeStorage()
    } else if (platform === 'web') {
        // The web build's byte store is the key/value model behind `forageStorage` here.
        const { injectAppStore } = await import('src/ts/storage/store/appStore')
        const base = createForageBackedStore(ctx.globalApi.forageStorage as unknown as ForageLike)
        injectAppStore({
            ...base,
            list: async (prefix) => {
                const keys = await base.list(prefix)
                if (prefix === 'coldstorage/') {
                    h.forageHooks.afterUnitListing?.()
                }
                return keys
            },
        })
    }
    return ctx
}

afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
})

//#endregion

//#region fixtures

const COLD_HEADER = 'COLDSTORAGE'

function coldChat(id: string, key: string) {
    return { id, message: [{ time: 1, data: COLD_HEADER + key, role: 'char' }], note: '', name: '', localLore: [] }
}

function errorTextChat(id: string, key: string) {
    return { id, message: [{ time: 1, data: `[Cold storage data could not be loaded. Key: ${key}]`, role: 'char' }], note: '', name: '', localLore: [] }
}

function fullCharacter(chaId: string, name: string, extra: Record<string, unknown> = {}): Character {
    return { chaId, name, type: 'character', chatPage: 0, chats: [], ...extra } as unknown as Character
}

function stubCharacter(chaId: string, name: string, blobKey: string): Character {
    return {
        chaId,
        name,
        type: 'character',
        chatPage: 0,
        coldstorage: blobKey,
        coldStoragedChats: [],
        chats: [{ message: [{ time: 1, data: '', role: 'char' }], note: '', name: '', localLore: [] }],
    } as unknown as Character
}

function makeDb(characters: Character[], extra: Record<string, unknown> = {}): Database {
    return {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: characters.map((c) => c.chaId),
        characters,
        coldstorage: false,
        ...extra,
    } as unknown as Database
}

function setLive(db: Database): void {
    ctx.stores.DBState.db = db
}

const CHAT_VALUE = {
    message: [{ time: 1, data: 'archived', role: 'user' }],
    hypaV2Data: { chunks: [], mainChunks: [], lastMainChunkID: 0 },
    hypaV3Data: { summaries: [] },
    scriptstate: {},
    localLore: [],
}

/** A unit whose content is never decoded: only its presence matters. */
function seedUnit(key: string): void {
    const bytes = new Uint8Array([1, 2, 3])
    if (platform === 'node') {
        server.seed('coldstorage/' + key, bytes)
    } else if (platform === 'tauri') {
        h.fs.set('coldstorage/' + key + '.json', bytes)
    } else {
        h.forage.set('coldstorage/' + key, bytes)
    }
}

/** A unit written through the real writer, so that it decodes. */
async function putUnit(key: string, value: unknown = CHAT_VALUE): Promise<void> {
    expect(await ctx.cold.setColdStorageItem(key, value)).toBe(true)
}

async function putBlob(blobKey: string, character: Character): Promise<void> {
    await putUnit(blobKey, { character })
}

async function units(): Promise<string[]> {
    return (await ctx.cold.listColdStorageItems()).items
}

function assetKeys(): string[] {
    const keys = platform === 'node'
        ? Array.from(server.files.keys())
        : platform === 'tauri' ? Array.from(h.fs.keys()) : Array.from(h.forage.keys())
    return keys.filter((k) => k.startsWith('assets/'))
}

function seedAsset(name: string): void {
    if (platform === 'node') {
        server.seed('assets/' + name, new Uint8Array([9, 9]))
    } else if (platform === 'tauri') {
        h.fs.set('assets/' + name, new Uint8Array([9, 9]))
    } else {
        h.forage.set('assets/' + name, new Uint8Array([9, 9]))
    }
}

async function encodeTree(db: Database): Promise<Uint8Array> {
    const encoder = new ctx.risuSave.RisuSaveEncoder()
    await encoder.init(db, {})
    return new Uint8Array(encoder.encode()!)
}

function storeMain(bytes: Uint8Array): void {
    if (platform === 'node') {
        server.seed('database/database.bin', bytes)
    } else if (platform === 'tauri') {
        h.fs.set('database/database.bin', bytes)
    } else {
        h.forage.set('database/database.bin', bytes)
    }
}

function snapshotKey(n: number): string {
    return `database/dbbackup-${n}.bin`
}

function storeSnapshot(n: number, bytes: Uint8Array): void {
    if (platform === 'node') {
        server.seed(snapshotKey(n), bytes)
    } else if (platform === 'tauri') {
        h.fs.set(snapshotKey(n), bytes)
    } else {
        h.forage.set(snapshotKey(n), bytes)
    }
}

/**
 * The state of a page that has just booted: the committed main file is in
 * storage, this tab has read it (and, on Node, holds its revision), and the
 * load-time listing has been taken. `main` is a tree to encode as the
 * committed file, or the exact bytes to commit; it defaults to the live tree.
 */
async function prime(main?: Database | Uint8Array, options: { listing?: boolean, record?: boolean } = {}): Promise<Uint8Array> {
    const bytes = main instanceof Uint8Array ? main : await encodeTree(main ?? ctx.stores.DBState.db)
    storeMain(bytes)
    if (platform === 'node') {
        await (await import('src/ts/storage/store/appStore')).readMainFile()
    }
    if (options.record !== false) {
        ctx.mainRec.noteMainFileBytes(bytes.slice())
    }
    if (options.listing !== false) {
        await ctx.listing.recordLoadTimeListing()
    }
    return bytes
}

async function run(): Promise<void> {
    await ctx.cold.cleanColdStorage()
}

function errorMessages(): string[] {
    return vi.mocked(ctx.alert.alertError).mock.calls.map((call) => String(call[0]))
}

const NOTICE_TYPES = new Set(['error', 'normal', 'markdown', 'toast', 'wait2'])

/** Every non-wait message shown during the run, in order. */
function shownNotices(): string[] {
    return h.hub.history.filter((a) => NOTICE_TYPES.has(a.type)).map((a) => a.msg)
}

async function expectUntouched(keys: string[]): Promise<void> {
    expect(await units()).toEqual(expect.arrayContaining(keys))
}

//#endregion

//#region hand-composed save files

function rootPart(db: Database, directory?: string[]): SavePart {
    const root: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(db)) {
        if (key !== 'characters' && key !== 'botPresets' && key !== 'modules') {
            root[key] = value
        }
    }
    if (directory) {
        root.__directory = directory
    }
    return { name: 'root', type: BLOCK.ROOT, data: JSON.stringify(root) }
}

function characterPart(character: Character): SavePart {
    return { name: character.chaId, type: BLOCK.CHARACTER_WITH_CHAT, data: JSON.stringify(character) }
}

const CONFIG_PART: SavePart = { name: 'config', type: BLOCK.CONFIG, data: JSON.stringify({ version: 1 }) }

function scaffoldParts(db: Database, directory?: string[]): SavePart[] {
    return [
        rootPart(db, directory),
        { name: 'preset', type: BLOCK.BOTPRESET, data: JSON.stringify(db.botPresets) },
        { name: 'modules', type: BLOCK.MODULES, data: JSON.stringify(db.modules) },
        { name: 'loadouts', type: BLOCK.LOADOUTS, data: JSON.stringify(db.loadouts) },
        { name: 'plugins', type: BLOCK.PLUGINS, data: JSON.stringify(db.plugins) },
        { name: 'pluginStorage', type: BLOCK.PLUGIN_STORAGE, data: JSON.stringify(db.pluginCustomStorage) },
    ]
}

async function composeIntact(characters: Character[]): Promise<Uint8Array> {
    const db = makeDb([])
    const composed = await composeSave(new ctx.risuSave.RisuSaveEncoder(), [
        ...scaffoldParts(db),
        ...characters.map(characterPart),
        CONFIG_PART,
    ])
    return composed.bytes
}

const REMOTE_HASH = '00aa11bb22cc33dd'

function remoteFileKey(name: string): string {
    return `remotes/${name}.${REMOTE_HASH}.bin`
}

function remotePointerPart(name: string): SavePart {
    return {
        name,
        type: BLOCK.REMOTE,
        data: JSON.stringify({ v: 2, type: BLOCK.CHARACTER_WITH_CHAT, name, hash: REMOTE_HASH }),
    }
}

const DEFECTS = [
    'a missing remote file',
    'a checksum-corrupt block',
    'a block that fails to parse',
    'a directory entry absent from the file',
] as const
type Defect = typeof DEFECTS[number]

/** A save file with exactly one defect that the default decoder silently absorbs. */
async function defectiveSave(defect: Defect): Promise<Uint8Array> {
    const db = makeDb([])
    const encoder = new ctx.risuSave.RisuSaveEncoder()
    const victim = fullCharacter('victim-cha', 'Victim', { chats: [coldChat('victim-chat', 'defect-referenced-unit')] })
    switch (defect) {
        case 'a missing remote file':
            return (await composeSave(encoder, [...scaffoldParts(db), remotePointerPart('remote-cha'), CONFIG_PART])).bytes
        case 'a checksum-corrupt block': {
            const composed = await composeSave(encoder, [...scaffoldParts(db), characterPart(victim), CONFIG_PART])
            return corruptBlockPayload(composed, 'victim-cha')
        }
        case 'a block that fails to parse':
            return (await composeSave(encoder, [
                ...scaffoldParts(db),
                { name: 'broken-cha', type: BLOCK.CHARACTER_WITH_CHAT, data: '{"chaId": "broken-cha", "chats": [' },
                CONFIG_PART,
            ])).bytes
        case 'a directory entry absent from the file':
            h.risuCache.set('risuSaveBlock_ghost-cha', {
                type: BLOCK.CHARACTER_WITH_CHAT,
                name: 'ghost-cha',
                data: JSON.stringify(fullCharacter('ghost-cha', 'Ghost', { chats: [coldChat('ghost-chat', 'defect-referenced-unit')] })),
            })
            return (await composeSave(encoder, [...scaffoldParts(db, ['ghost-cha']), CONFIG_PART])).bytes
    }
}

//#endregion

describe('fixtures', () => {
    test('guard: a hand-composed intact save decodes to its characters', async () => {
        await setup()
        const bytes = await composeIntact([fullCharacter('fixture-cha', 'Fixture')])
        const decoded = await ctx.risuSave.decodeRisuSave(bytes)
        expect(decoded.characters.map((c) => c.chaId)).toEqual(['fixture-cha'])
    })

    test('guard: an encoded tree decodes with its stub and its plugin storage', async () => {
        await setup()
        const bytes = await encodeTree(makeDb([stubCharacter('stub-cha', 'Stubby', 'some-blob')], { pluginCustomStorage: { _coldplugin: { key: 'plugin-unit' } } }))
        const decoded = await ctx.risuSave.decodeRisuSave(bytes)
        expect(decoded.characters.map((c) => c.coldstorage)).toEqual(['some-blob'])
        expect(decoded.pluginCustomStorage).toEqual({ _coldplugin: { key: 'plugin-unit' } })
    })

    test('guard: a remote block whose file exists decodes to the remote character', async () => {
        await setup()
        h.forage.set(remoteFileKey('remote-cha'), new TextEncoder().encode(JSON.stringify(
            fullCharacter('remote-cha', 'Remote', { chats: [coldChat('remote-chat', 'remote-block-unit')] }),
        )))
        const composed = await composeSave(new ctx.risuSave.RisuSaveEncoder(), [
            ...scaffoldParts(makeDb([])), remotePointerPart('remote-cha'), CONFIG_PART,
        ])
        const decoded = await ctx.risuSave.decodeRisuSave(composed.bytes)
        expect(decoded.characters.map((c) => c.chaId)).toEqual(['remote-cha'])
    })

    test.each([...DEFECTS])('guard: the default decoder absorbs %s without raising', async (defect) => {
        await setup()
        const bytes = await defectiveSave(defect)
        const decoded = await ctx.risuSave.decodeRisuSave(bytes)
        const ids = (decoded.characters ?? []).map((c) => c.chaId)
        if (defect === 'a directory entry absent from the file') {
            expect(ids).toContain('ghost-cha')
        } else {
            expect(ids).not.toContain('victim-cha')
            expect(ids).not.toContain('remote-cha')
            expect(ids).not.toContain('broken-cha')
        }
    })
})

describe('units: what the clean-up keeps', () => {
    test('keeps a unit referenced only by the committed main file and deletes an unreferenced unit', async () => {
        await setup()
        await putUnit('main-only-unit')
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime(makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'main-only-unit')] })]))

        await run()

        const after = await units()
        expect(after).toContain('main-only-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('keeps a unit referenced only by the oldest retained snapshot', async () => {
        await setup()
        await putUnit('oldest-only-unit')
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'oldest-only-unit')] })])))
        storeSnapshot(17000000002, await encodeTree(makeDb([])))
        storeSnapshot(17000000003, await encodeTree(makeDb([])))

        await run()

        const after = await units()
        expect(after).toContain('oldest-only-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('keeps a unit referenced only by a character stored as a remote block in the committed main', async () => {
        await setup()
        await putUnit('remote-block-unit')
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        h.forage.set(remoteFileKey('remote-cha'), new TextEncoder().encode(JSON.stringify(
            fullCharacter('remote-cha', 'Remote', { chats: [coldChat('remote-chat', 'remote-block-unit')] }),
        )))
        const composed = await composeSave(new ctx.risuSave.RisuSaveEncoder(), [
            ...scaffoldParts(makeDb([])), remotePointerPart('remote-cha'), CONFIG_PART,
        ])
        await prime(composed.bytes)

        await run()

        const after = await units()
        expect(after).toContain('remote-block-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('keeps a legacy error-text key referenced only by the committed main file', async () => {
        await setup()
        await putUnit('error-text-unit')
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime(makeDb([fullCharacter('char-a', 'Alice', { chats: [errorTextChat('chat-1', 'error-text-unit')] })]))

        await run()

        const after = await units()
        expect(after).toContain('error-text-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test.each([
        ['a pointer', (key: string) => coldChat('inner-chat', key)],
        ['a legacy error text', (key: string) => errorTextChat('inner-chat', key)],
    ])('keeps a chat unit referenced only by %s inside a blob whose stub exists only in the committed main file', async (_label, makeInnerChat) => {
        await setup()
        await putUnit('inner-unit')
        await putBlob('main-stub-blob', fullCharacter('stub-cha', 'Stubby', { chats: [makeInnerChat('inner-unit')] }))
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime(makeDb([stubCharacter('stub-cha', 'Stubby', 'main-stub-blob')]))

        await run()

        const after = await units()
        expect(after).toContain('main-stub-blob')
        expect(after).toContain('inner-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('keeps a chat unit referenced only inside a blob whose stub exists only in a snapshot', async () => {
        await setup()
        await putUnit('inner-unit')
        await putBlob('snapshot-stub-blob', fullCharacter('stub-cha', 'Stubby', { chats: [coldChat('inner-chat', 'inner-unit')] }))
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([stubCharacter('stub-cha', 'Stubby', 'snapshot-stub-blob')])))

        await run()

        const after = await units()
        expect(after).toContain('snapshot-stub-blob')
        expect(after).toContain('inner-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('keeps a _coldplugin unit referenced only by a snapshot plugin storage', async () => {
        await setup()
        await putUnit('plugin-unit', { some: 'plugin value' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([], { pluginCustomStorage: { _coldplugin: { 'plugin-key': 'plugin-unit' } } })))

        await run()

        const after = await units()
        expect(after).toContain('plugin-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('guard: keeps a _coldplugin unit referenced by live memory', async () => {
        await setup()
        await putUnit('live-plugin-unit', { some: 'plugin value' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([], { pluginCustomStorage: { _coldplugin: { 'plugin-key': 'live-plugin-unit' } } }))
        await prime()

        await run()

        const after = await units()
        expect(after).toContain('live-plugin-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('reads each distinct blob exactly once and never two at a time', async () => {
        await setup()
        const cha = (n: number) => `blob-cha-${n}`
        const blob = (n: number) => `shared-blob-${n}`
        for (const n of [1, 2, 3]) {
            await putBlob(blob(n), fullCharacter(cha(n), `Blobby ${n}`))
        }
        // blob 1 is reached from the live tree, the committed main file and all three snapshots;
        // blob 2 only from the live tree; blob 3 only from the second snapshot.
        setLive(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1)), stubCharacter(cha(2), 'Blobby 2', blob(2))]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1))])))
        storeSnapshot(17000000002, await encodeTree(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1)), stubCharacter(cha(3), 'Blobby 3', blob(3))])))
        storeSnapshot(17000000003, await encodeTree(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1))])))
        h.unitLog.reads = []
        h.unitLog.peakInFlight = 0

        await run()

        const readsOf = (n: number) => h.unitLog.reads.filter((name) => name === 'coldstorage/' + blob(n)).length
        expect([readsOf(1), readsOf(2), readsOf(3)]).toEqual([1, 1, 1])
        expect(h.unitLog.peakInFlight).toBeLessThanOrEqual(1)
    })

    test('guard: does not prune the retained snapshots while listing them', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        const snapshotNumbers = Array.from({ length: 22 }, (_, i) => 17000000001 + i)
        const emptyTree = await encodeTree(makeDb([]))
        for (const n of snapshotNumbers) {
            storeSnapshot(n, emptyTree)
        }

        await run()

        for (const n of snapshotNumbers) {
            expect(h.forage.has(snapshotKey(n))).toBe(true)
        }
    })
})

describe('a profile that never used plugin storage', () => {
    test('REPRODUCER: proceeds when the committed main file and a snapshot hold an empty plugin storage block', async () => {
        await setup()
        await putUnit('main-only-unit')
        await putUnit('snapshot-only-unit')
        seedUnit('unreferenced-unit')
        seedAsset('orphan.png')
        setLive(makeDb([]))
        await prime(makeDb(
            [fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'main-only-unit')] })],
            { pluginCustomStorage: undefined },
        ))
        storeSnapshot(17000000001, await encodeTree(makeDb(
            [fullCharacter('char-b', 'Bob', { chats: [coldChat('chat-2', 'snapshot-only-unit')] })],
            { pluginCustomStorage: undefined },
        )))

        await run()

        const after = await units()
        expect(after).toContain('main-only-unit')
        expect(after).toContain('snapshot-only-unit')
        expect(after).not.toContain('unreferenced-unit')
        expect(assetKeys()).not.toContain('assets/orphan.png')
        expect(errorMessages()).toEqual([])
    })

    test('REPRODUCER: keeps a _coldplugin unit referenced only by a snapshot when another snapshot has an empty plugin storage block', async () => {
        await setup()
        await putUnit('plugin-unit', { some: 'plugin value' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([], { pluginCustomStorage: undefined })))
        storeSnapshot(17000000002, await encodeTree(makeDb([], { pluginCustomStorage: { _coldplugin: { 'plugin-key': 'plugin-unit' } } })))

        await run()

        const after = await units()
        expect(after).toContain('plugin-unit')
        expect(after).not.toContain('unreferenced-unit')
    })

    test('guard: aborts and deletes nothing when a snapshot plugin storage block holds content that is not valid JSON', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        seedAsset('orphan.png')
        setLive(makeDb([]))
        await prime()
        const parts = scaffoldParts(makeDb([])).map((part) =>
            part.name === 'pluginStorage' ? { ...part, data: '{"_coldplugin"' } : part,
        )
        const damaged = await composeSave(new ctx.risuSave.RisuSaveEncoder(), [...parts, CONFIG_PART])
        storeSnapshot(17000000001, damaged.bytes)

        await run()

        await expectUntouched(['unreferenced-unit'])
        expect(assetKeys()).toContain('assets/orphan.png')
        expect(errorMessages().length).toBeGreaterThan(0)
    })
})

describe('units: the load-time listing bounds what may be deleted', () => {
    test('keeps a unit written after the load-time listing and deletes one that was present at load', async () => {
        await setup()
        seedUnit('present-at-load')
        setLive(makeDb([]))
        await prime()
        seedUnit('written-after-load')

        await run()

        const after = await units()
        expect(after).toContain('written-after-load')
        expect(after).not.toContain('present-at-load')
    })

    test('deletes nothing when no load-time listing was recorded', async () => {
        await setup()
        seedUnit('present-at-load')
        setLive(makeDb([]))
        await prime(undefined, { listing: false })

        await run()

        expect(await units()).toContain('present-at-load')
    })

    test('guard: keeps a unit written while the run is in progress', async () => {
        await setup()
        seedUnit('present-at-load')
        setLive(makeDb([]))
        await prime()
        h.forageHooks.afterUnitListing = () => {
            h.forageHooks.afterUnitListing = undefined
            seedUnit('written-during-run')
        }

        await run()

        const after = await units()
        expect(after).toContain('written-during-run')
        expect(after).not.toContain('present-at-load')
    })
})

describe('strict reads: the run aborts and deletes nothing', () => {
    const PLACES = ['the committed main file', 'a retained snapshot'] as const

    for (const place of PLACES) {
        test.each([...DEFECTS])(`when ${place} has %s`, async (defect) => {
            await setup()
            seedUnit('unreferenced-unit')
            await putUnit('defect-referenced-unit')
            setLive(makeDb([]))
            const defective = await defectiveSave(defect)
            if (place === 'the committed main file') {
                await prime(defective)
            } else {
                await prime(makeDb([]))
                storeSnapshot(17000000001, defective)
            }

            await run()

            await expectUntouched(['unreferenced-unit', 'defect-referenced-unit'])
            expect(errorMessages().length).toBeGreaterThan(0)
        })
    }

    test('skips a snapshot that vanishes between listing and reading and still honours the others', async () => {
        await setup()
        await putUnit('surviving-snapshot-unit')
        await putUnit('vanishing-snapshot-unit')
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'surviving-snapshot-unit')] })])))
        storeSnapshot(17000000002, await encodeTree(makeDb([fullCharacter('char-b', 'Bob', { chats: [coldChat('chat-2', 'vanishing-snapshot-unit')] })])))
        h.forageHooks.onGetItem = (key) => {
            if (key.startsWith('database/dbbackup-')) {
                h.forage.delete(snapshotKey(17000000002))
            }
        }

        await run()

        const after = await units()
        expect(after).toContain('surviving-snapshot-unit')
        expect(after).not.toContain('unreferenced-unit')
        expect(errorMessages()).toEqual([])
    })
})

describe('Tauri: a failed read or removal counts as missing only when the file is really gone', () => {
    test('skips a snapshot whose read fails with os error 2 and which no longer exists, and still honours the others', async () => {
        await setup({ platform: 'tauri' })
        await putUnit('surviving-snapshot-unit')
        await putUnit('vanishing-snapshot-unit')
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'surviving-snapshot-unit')] })])))
        storeSnapshot(17000000002, await encodeTree(makeDb([fullCharacter('char-b', 'Bob', { chats: [coldChat('chat-2', 'vanishing-snapshot-unit')] })])))
        h.fsReadError.set(snapshotKey(17000000002), {
            message: `The system cannot find the file specified. (os error 2)`,
            removeFile: true,
        })

        await run()

        const after = await units()
        expect(after).toContain('surviving-snapshot-unit')
        expect(after).not.toContain('unreferenced-unit')
        expect(errorMessages()).toEqual([])
    })

    test('aborts and deletes nothing when a snapshot read fails with another error, even though the file is reported absent', async () => {
        await setup({ platform: 'tauri' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([])))
        h.fsReadError.set(snapshotKey(17000000001), { message: 'Access is denied. (os error 5)', removeFile: false })
        h.fsHidden.add(snapshotKey(17000000001))

        await run()

        expect(await units()).toContain('unreferenced-unit')
        expect(errorMessages().length).toBeGreaterThan(0)
    })

    test('counts a removal failure unless it is os error 2 on a file that no longer exists', async () => {
        await setup({ platform: 'tauri' })
        const keys = ['gone', 'denied-absent', 'os2-present', 'generic', 'plain-1', 'plain-2', 'plain-3', 'plain-4']
        keys.forEach(seedUnit)
        setLive(makeDb([]))
        await prime()
        const unitPath = (key: string) => `coldstorage/${key}.json`
        // Already deleted by someone else: os error 2 and absent -> not a failure.
        h.fsRemoveError.set(unitPath('gone'), { message: 'The system cannot find the file specified. (os error 2)', removeFile: true })
        // Another error code is a failure even when exists() reports the file absent.
        h.fsRemoveError.set(unitPath('denied-absent'), { message: 'Access is denied. (os error 5)', removeFile: false })
        h.fsHidden.add(unitPath('denied-absent'))
        // os error 2 while the file is still there is a failure.
        h.fsRemoveError.set(unitPath('os2-present'), { message: 'No such file or directory (os error 2)', removeFile: false })
        // An error with no code is a failure.
        h.fsFail.add(unitPath('generic'))

        await run()

        expect((await units()).sort()).toEqual(['denied-absent', 'generic', 'os2-present'])
        const shown = errorMessages().join('\n')
        expect(shown).toMatch(/\b3\b/)
        expect(shown).not.toMatch(/\b4\b/)
    })
})

describe('Tauri: a leftover temp file of an interrupted atomic write is not a snapshot', () => {
    test('guard: the clean-up neither reads nor removes a temp file in database/ and still completes', async () => {
        await setup({ platform: 'tauri' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17000000001, await encodeTree(makeDb([])))
        const leftover = 'database/risu-write-0123456789abcdef.tmp'
        h.fs.set(leftover, new Uint8Array([1, 2, 3]))

        await run()

        expect(await units()).not.toContain('unreferenced-unit')
        expect(errorMessages()).toEqual([])
        expect(h.fsReads).not.toContain(leftover)
        expect(h.fs.has(leftover)).toBe(true)
    })
})

describe('unreadable blobs stop the run with a notice that names the character and the source', () => {
    const BLOB_FAILURES = [
        ['is missing', async (_blobKey: string) => {}],
        ['cannot be decoded', async (blobKey: string) => { h.forage.set('coldstorage/' + blobKey, new Uint8Array([1, 2, 3, 4])) }],
        ['belongs to a different character', async (blobKey: string) => { await putBlob(blobKey, fullCharacter('someone-else', 'Someone Else')) }],
    ] as const

    test.each(BLOB_FAILURES)('aborts naming the character and the snapshot file when a blob referenced only by a snapshot %s', async (_label, breakBlob) => {
        await setup()
        seedUnit('unreferenced-unit')
        await breakBlob('snapshot-only-blob')
        setLive(makeDb([]))
        await prime()
        storeSnapshot(17654321, await encodeTree(makeDb([stubCharacter('zelda-cha', 'Zelda', 'snapshot-only-blob')])))

        await run()

        expect(await units()).toContain('unreferenced-unit')
        const messages = errorMessages()
        expect(messages.some((m) => m.includes('Zelda') && m.includes('dbbackup-17654321.bin'))).toBe(true)
    })

    test.each(BLOB_FAILURES)('aborts naming the character when a blob referenced only by the committed main file %s', async (_label, breakBlob) => {
        await setup()
        seedUnit('unreferenced-unit')
        await breakBlob('main-only-blob')
        setLive(makeDb([]))
        await prime(makeDb([stubCharacter('link-cha', 'Link', 'main-only-blob')]))

        await run()

        expect(await units()).toContain('unreferenced-unit')
        expect(errorMessages().some((m) => m.includes('Link'))).toBe(true)
    })
})

describe('a blob that cannot be read because the page store fails stops the run like any other unreadable blob', () => {
    test('guard: aborts naming the character and deletes nothing when the read of the blob fails after the load-time listing was taken', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        await putBlob('main-only-blob', fullCharacter('link-cha', 'Link'))
        setLive(makeDb([]))
        await prime(makeDb([stubCharacter('link-cha', 'Link', 'main-only-blob')]))
        h.forageReadFail.add('coldstorage/main-only-blob')

        await run()

        expect(await units()).toEqual(expect.arrayContaining(['unreferenced-unit', 'main-only-blob']))
        expect(errorMessages().some((m) => m.includes('Link'))).toBe(true)
        expect(h.unitLog.removed).toEqual([])
    })
})

describe('the main file must be what this tab last read or committed', () => {
    test.each([
        ['differs in one byte', 'aaaa', 'bbbb'],
        ['differs in length', 'aaaa', 'bbbbbbbb'],
    ])('refuses and deletes nothing when the stored main file %s from this tab\'s record', async (_label, recordedPrompt, storedPrompt) => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([], { mainPrompt: recordedPrompt }))
        const recorded = await encodeTree(makeDb([], { mainPrompt: recordedPrompt }))
        storeMain(await encodeTree(makeDb([], { mainPrompt: storedPrompt })))
        ctx.mainRec.noteMainFileBytes(recorded)
        await ctx.listing.recordLoadTimeListing()

        await run()

        expect(await units()).toContain('unreferenced-unit')
        expect(errorMessages().length).toBeGreaterThan(0)
    })

    test('refuses and deletes nothing when this tab has no record of the main file', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime(undefined, { record: false })

        await run()

        expect(await units()).toContain('unreferenced-unit')
        expect(errorMessages().length).toBeGreaterThan(0)
    })

    test('guard: proceeds when the stored main file equals a separate copy of the recorded bytes', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()

        await run()

        expect(await units()).not.toContain('unreferenced-unit')
        expect(errorMessages()).toEqual([])
    })
})

describe('exclusivity', () => {
    test('refuses and deletes nothing while another tab of this browser is open', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        const otherTab = makeSimulatedTab(core, 'B')
        await otherTab.locks.tabPresenceLockAcquired

        vi.useFakeTimers()
        const running = run()
        await vi.advanceTimersByTimeAsync(15000)
        await running
        vi.useRealTimers()

        expect(await units()).toContain('unreferenced-unit')
        expect(errorMessages().length).toBeGreaterThan(0)
    })

    test('holds the exclusive storage lock, parking this tab\'s saves, until the run ends', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        let saveAcquired = false
        let saveAcquiredAtFirstRemoval: boolean | undefined
        let parkedSave: Promise<void> = Promise.resolve()
        h.forageHooks.afterUnitListing = () => {
            h.forageHooks.afterUnitListing = undefined
            parkedSave = ctx.globalApi.dbWriteLock.acquire().then((release) => {
                saveAcquired = true
                release()
            })
        }
        h.forageHooks.onRemove = () => {
            saveAcquiredAtFirstRemoval ??= saveAcquired
        }

        await run()
        await parkedSave

        expect(saveAcquiredAtFirstRemoval).toBe(false)
        expect(saveAcquired).toBe(true)
    })

    test('guard: releases the write lock and the tab presence after a run that aborts', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime(makeDb([stubCharacter('lost-cha', 'Lost', 'missing-blob')]))

        await run()

        const settle = <T>(promise: Promise<T>) => Promise.race([
            promise.then(() => 'released'),
            new Promise<string>((resolve) => setTimeout(() => resolve('still held'), 300)),
        ])
        expect(await settle(ctx.globalApi.dbWriteLock.acquire())).toBe('released')
        expect(await settle(makeSimulatedTab(core, 'C').locks.tabPresenceLockAcquired)).toBe('released')
    })

    test('asks an extra confirmation without Web Locks and deletes nothing when it is declined', async () => {
        await setup({ locks: 'none' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        h.hub.confirmAnswer = false

        await run()

        expect(vi.mocked(ctx.alert.alertConfirm)).toHaveBeenCalled()
        expect(await units()).toContain('unreferenced-unit')
    })

    test('asks an extra confirmation without Web Locks and proceeds when it is accepted', async () => {
        await setup({ locks: 'none' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()

        await run()

        expect(vi.mocked(ctx.alert.alertConfirm)).toHaveBeenCalled()
        expect(await units()).not.toContain('unreferenced-unit')
    })

    test('asks a confirmation on a Node server and deletes nothing when it is declined', async () => {
        await setup({ platform: 'node' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        h.hub.confirmAnswer = false

        await run()

        expect(vi.mocked(ctx.alert.alertConfirm)).toHaveBeenCalled()
        expect(await units()).toContain('unreferenced-unit')
    })

    test('guard: on Tauri another open tab does not stop the run', async () => {
        await setup({ platform: 'tauri' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        const otherTab = makeSimulatedTab(core, 'B')
        await otherTab.locks.tabPresenceLockAcquired

        await run()

        expect(await units()).not.toContain('unreferenced-unit')
    })
})

describe('busy: the run refuses while anything else is working', () => {
    test.each([
        ['work is in progress', () => { ctx.chatOrigin.registerWork({ chaId: 'busy-cha', chatId: 'busy-chat' }) }],
        ['the composer window is open', () => { ctx.generation.setComposerWindow(true) }],
        ['an import is registered as busy', () => { ctx.busy.beginBusy('import') }],
        ['saving has been stopped', () => { ctx.stores.savingStoppedReason.set('stay') }],
    ])('refuses and deletes nothing while %s', async (_label, makeBusy) => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        makeBusy()

        await run()

        expect(await units()).toContain('unreferenced-unit')
        expect(errorMessages().length).toBeGreaterThan(0)
    })

    test('a run with only its own registry entry deletes its batches, and its entry ends with the run', async () => {
        await setup()
        for (let i = 0; i < 250; i++) {
            seedUnit(`unit-${i}`)
        }
        setLive(makeDb([]))
        await prime()
        let keptWhileDeleting: string[] = []
        h.forageHooks.afterRemove = () => {
            keptWhileDeleting = ctx.busy.busyKinds()
        }

        await run()

        expect(await units()).toEqual([])
        expect(keptWhileDeleting).toEqual(['cleanup'])
        expect(ctx.busy.isBusy()).toBe(false)
    })

    test('a run refused because an action is registered leaves no entry of its own behind', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        const other = ctx.busy.beginBusy('import')

        await run()

        expect(await units()).toContain('unreferenced-unit')
        expect(ctx.busy.busyKinds()).toEqual(['import'])
        other.end()
    })

    test('stops partway when an action is registered after the first deletions', async () => {
        await setup()
        for (let i = 0; i < 250; i++) {
            seedUnit(`unit-${i}`)
        }
        setLive(makeDb([]))
        await prime()
        let removed = 0
        h.forageHooks.afterRemove = () => {
            removed++
            if (removed === 100) {
                ctx.busy.beginBusy('import')
            }
        }

        await run()

        const left = (await units()).length
        expect(left).toBeGreaterThan(0)
        expect(left).toBeLessThan(250)
    })

    test('deletes nothing when work starts after the run began but before the first deletion', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        h.forageHooks.afterUnitListing = () => {
            h.forageHooks.afterUnitListing = undefined
            ctx.chatOrigin.registerWork({ chaId: 'busy-cha', chatId: 'busy-chat' })
        }

        await run()

        expect(await units()).toContain('unreferenced-unit')
    })

    test('guard: deletes nothing when a chaId becomes frozen after the run began but before the first deletion', async () => {
        await setup()
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        h.forageHooks.afterUnitListing = () => {
            h.forageHooks.afterUnitListing = undefined
            ctx.stores.frozenSaveKeysStore.set([{ chaId: 'dup-id', names: ['A', 'B'] }])
        }

        await run()

        expect(await units()).toContain('unreferenced-unit')
    })
})

describe('Node server: bounded batches, reported failures, revisions', () => {
    const NODE_UNIT_COUNT = 500

    function seedManyNodeUnits(count: number): string[] {
        const keys = Array.from({ length: count }, () => crypto.randomUUID())
        for (const key of keys) {
            seedUnit(key)
        }
        return keys
    }

    test('deletes 500 unused units in requests whose file-path header stays under 16384 bytes', async () => {
        await setup({ platform: 'node' })
        seedManyNodeUnits(NODE_UNIT_COUNT)
        setLive(makeDb([]))
        await prime()

        await run()

        const removeRequests = server.requestsTo('/api/remove')
        const longestHeader = Math.max(0, ...removeRequests.map((r) => (r.headers['file-path'] ?? '').length))
        expect(longestHeader).toBeLessThanOrEqual(12288)
        expect(removeRequests.length).toBeGreaterThanOrEqual(2)
        expect(server.keysWithPrefix('coldstorage/')).toEqual([])
    })

    test('guard: a unit this page wrote and the clean-up then deleted can be written again in the same page', async () => {
        await setup({ platform: 'node' })
        await putUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()

        await run()

        expect(await units()).not.toContain('unreferenced-unit')
        expect(await ctx.cold.setColdStorageItem('unreferenced-unit', CHAT_VALUE)).toBe(true)
        expect(await units()).toContain('unreferenced-unit')
    })

    test('deletes unused assets with long keys in requests whose file-path header stays within 12288 bytes', async () => {
        await setup({ platform: 'node' })
        const hex64 = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
        for (let i = 0; i < 300; i++) {
            seedAsset(`${hex64()}.png`)
        }
        setLive(makeDb([]))
        await prime()

        await run()

        const removeRequests = server.requestsTo('/api/remove')
        const longestHeader = Math.max(0, ...removeRequests.map((r) => (r.headers['file-path'] ?? '').length))
        expect(longestHeader).toBeLessThanOrEqual(12288)
        expect(assetKeys()).toEqual([])
        expect(removeRequests.length).toBeGreaterThanOrEqual(2)
    })

    test('guard: with one delete request failing, the other requests for assets are still attempted and the notice counts the keys per key', async () => {
        await setup({ platform: 'node' })
        const hex64 = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
        const TOTAL = 150
        for (let i = 0; i < TOTAL; i++) {
            seedAsset(`${hex64()}.png`)
        }
        setLive(makeDb([]))
        await prime()
        let requestNumber = 0
        let keysOfFailedRequest = 0
        server.removeOverride = (keys) => {
            requestNumber++
            if (requestNumber !== 2) {
                return undefined
            }
            keysOfFailedRequest = keys.length
            return new Response(JSON.stringify({ success: false, error: 'rejected' }), { status: 500 })
        }

        await run()

        const requests = server.requestsTo('/api/remove')
        expect(requests.length).toBeGreaterThanOrEqual(3)
        expect(requests).toHaveLength(requestNumber)
        expect(keysOfFailedRequest).toBeGreaterThan(0)
        expect(assetKeys()).toHaveLength(keysOfFailedRequest)
        expect(errorMessages().some((m) => m.includes(`${keysOfFailedRequest} item(s) could not be deleted`) && m.includes(`${TOTAL - keysOfFailedRequest} item(s) were deleted`))).toBe(true)
    })

    test.each([409, 431, 500])('ends with a notice counting the units when the server answers %i to a delete', async (status) => {
        await setup({ platform: 'node' })
        seedManyNodeUnits(7)
        setLive(makeDb([]))
        await prime()
        server.removeOverride = () => new Response(JSON.stringify({ success: false, error: 'rejected' }), { status })

        await run()

        expect(server.keysWithPrefix('coldstorage/').length).toBe(7)
        expect(errorMessages().some((m) => /\b7\b/.test(m))).toBe(true)
        expect(vi.mocked(ctx.alert.alertNormal)).not.toHaveBeenCalled()
    })

    test('shows the wait indicator during every delete request even when a toast was raised in between', async () => {
        await setup({ platform: 'node' })
        seedManyNodeUnits(250)
        setLive(makeDb([]))
        await prime()
        const seenDuringDelete: string[] = []
        server.beforeRequest = (path) => {
            if (path === '/api/remove') {
                seenDuringDelete.push(h.hub.current.type)
            }
        }
        server.afterRequest = () => {
            h.hub.set({ type: 'toast', msg: 'Failed to save data, retrying' })
        }

        await run()

        expect(new Set(seenDuringDelete)).toEqual(new Set(['wait']))
        expect(seenDuringDelete.length).toBeGreaterThanOrEqual(2)
    })

    test('guard: the next main-file save after a run that read the main file still carries the earlier revision, so a peer save is a conflict', async () => {
        await setup({ platform: 'node' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        const committed = await prime()
        expect(server.revisionOf('database/database.bin')).toBe(1)
        server.peerWrite('database/database.bin', committed)

        await run()

        expect(await units()).not.toContain('unreferenced-unit')
        const next = await encodeTree(makeDb([], { mainPrompt: 'edited after the clean-up' }))
        const app = await import('src/ts/storage/store/appStore')
        const errors = await import('src/ts/storage/store/errors')
        await expect(app.writeMainFile(next)).rejects.toBeInstanceOf(errors.StoreVersionConflictError)
        const lastWrite = server.requestsTo('/api/write').at(-1)
        expect(lastWrite?.headers['if-match-revision']).toBe('1')
    })

    test('guard: the next main-file save after a refused run still carries the earlier revision, so a peer save is a conflict', async () => {
        await setup({ platform: 'node' })
        seedUnit('unreferenced-unit')
        setLive(makeDb([]))
        await prime()
        server.peerWrite('database/database.bin', await encodeTree(makeDb([], { mainPrompt: 'saved by another device' })))

        await run()

        const next = await encodeTree(makeDb([], { mainPrompt: 'edited after the clean-up' }))
        const app = await import('src/ts/storage/store/appStore')
        const errors = await import('src/ts/storage/store/errors')
        await expect(app.writeMainFile(next)).rejects.toBeInstanceOf(errors.StoreVersionConflictError)
        expect(server.requestsTo('/api/write').at(-1)?.headers['if-match-revision']).toBe('1')
    })
})

describe('failed deletes and the completion notice on the other backends', () => {
    test('ends with a notice counting the units that could not be removed from the page store', async () => {
        await setup()
        const keys = ['unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-5', 'unit-6', 'unit-7']
        keys.forEach(seedUnit)
        setLive(makeDb([]))
        await prime()
        for (const key of ['unit-2', 'unit-4', 'unit-6']) {
            h.forageFail.add('coldstorage/' + key)
        }

        await run()

        expect((await units()).sort()).toEqual(['unit-2', 'unit-4', 'unit-6'])
        expect(errorMessages().some((m) => /\b3\b/.test(m))).toBe(true)
        expect(vi.mocked(ctx.alert.alertNormal)).not.toHaveBeenCalled()
    })

    test('ends with a notice counting the units that could not be removed on Tauri', async () => {
        await setup({ platform: 'tauri' })
        for (const key of ['unit-1', 'unit-2', 'unit-3', 'unit-4', 'unit-5', 'unit-6']) {
            seedUnit(key)
        }
        setLive(makeDb([]))
        await prime()
        h.fsFail.add('coldstorage/unit-2.json')
        h.fsFail.add('coldstorage/unit-5.json')

        await run()

        expect((await units()).sort()).toEqual(['unit-2', 'unit-5'])
        expect(errorMessages().some((m) => /\b2\b/.test(m))).toBe(true)
        expect(vi.mocked(ctx.alert.alertNormal)).not.toHaveBeenCalled()
    })

    test('ends with a completion notice and no error when everything was deleted', async () => {
        await setup()
        ;['unit-1', 'unit-2', 'unit-3'].forEach(seedUnit)
        setLive(makeDb([]))
        await prime()

        await run()

        expect(await units()).toEqual([])
        expect(errorMessages()).toEqual([])
        expect(shownNotices().length).toBeGreaterThan(0)
        expect(h.hub.current.type).not.toBe('wait')
    })

    test('guard: shows the wait indicator during every unit removal even when a toast was raised in between', async () => {
        await setup()
        ;['unit-1', 'unit-2', 'unit-3'].forEach(seedUnit)
        setLive(makeDb([]))
        await prime()
        const seenDuringDelete: string[] = []
        h.forageHooks.onRemove = () => {
            seenDuringDelete.push(h.hub.current.type)
        }
        h.forageHooks.afterRemove = () => {
            h.hub.set({ type: 'toast', msg: 'Failed to save data, retrying' })
        }

        await run()

        expect(seenDuringDelete).toEqual(['wait', 'wait', 'wait'])
    })
})

describe('legacy OPFS unit files on the web', () => {
    /** Moves a unit written through the page store into the legacy OPFS root, as an older build kept it. */
    async function makeLegacy(key: string, value: unknown = CHAT_VALUE): Promise<void> {
        await putUnit(key, value)
        h.opfs.set(opfsName(key), h.forage.get('coldstorage/' + key)!)
        h.forage.delete('coldstorage/' + key)
    }

    test('new behaviour: the clean-up deletes an unreferenced unit from the page store and from OPFS, whichever holds it, and neither is listed afterwards', async () => {
        await setup()
        await putUnit('store-only')
        await makeLegacy('legacy-only')
        await putUnit('both')
        h.opfs.set(opfsName('both'), new Uint8Array([1, 2, 3]))
        setLive(makeDb([]))
        await prime()

        await run()

        expect(await units()).toEqual([])
        expect(h.opfs.size).toBe(0)
        expect(h.forage.has('coldstorage/both')).toBe(false)
        expect(errorMessages()).toEqual([])
    })

    test('new behaviour: a legacy file that cannot be removed keeps its unit, which the notice counts as not deleted, and the newer value in the store stays readable', async () => {
        await setup()
        await putUnit('stuck', { ...CHAT_VALUE, message: [{ time: 1, data: 'newer', role: 'user' }] })
        h.opfs.set(opfsName('stuck'), new Uint8Array([1, 2, 3]))
        await putUnit('plain')
        setLive(makeDb([]))
        await prime()
        h.opfsRemoveFail.add(opfsName('stuck'))

        await run()

        expect(await units()).toEqual(['stuck'])
        expect(errorMessages().some((m) => /\b1\b/.test(m))).toBe(true)
        expect(await ctx.cold.readColdStorageItem('stuck')).toMatchObject({ status: 'ok', value: { message: [{ data: 'newer' }] } })
    })

    test('new behaviour: a unit that only a legacy file holds is read through, so the chain it names is kept', async () => {
        await setup()
        await putUnit('unit-v')
        await makeLegacy('unit-u', { ...CHAT_VALUE, message: [errorTextChat('inner', 'unit-v').message[0], ...CHAT_VALUE.message] })
        seedUnit('orphan-o')
        setLive(makeDb([]))
        await prime(makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'unit-u')] })]))

        await run()

        const after = await units()
        expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
        expect(after).not.toContain('orphan-o')
        expect(errorMessages()).toEqual([])
    })

    test('new behaviour: a listing of the legacy files that fails at the start of the run deletes nothing', async () => {
        await setup()
        await putUnit('present-at-load')
        setLive(makeDb([]))
        await prime()
        const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
        Object.defineProperty(navigator, 'storage', {
            configurable: true,
            value: { getDirectory: async () => { throw new Error('OPFS listing failed') } },
        })

        try {
            await run()
        } finally {
            if (original) {
                Object.defineProperty(navigator, 'storage', original)
            }
        }

        expect(h.forage.has('coldstorage/present-at-load')).toBe(true)
        expect(errorMessages().length).toBeGreaterThan(0)
    })
})

describe('a run that stops partway', () => {
    test.each([
        ['work starts', () => { ctx.chatOrigin.registerWork({ chaId: 'busy-cha', chatId: 'busy-chat' }) }],
        ['saving is stopped', () => { ctx.stores.savingStoppedReason.set('stay') }],
        ['a chaId becomes frozen', () => { ctx.stores.frozenSaveKeysStore.set([{ chaId: 'dup-id', names: ['A', 'B'] }]) }],
    ])('states how many items were deleted, and not that nothing was, when %s after the first deletions', async (_label, interrupt) => {
        await setup()
        const total = 250
        for (let i = 0; i < total; i++) {
            seedUnit(`unit-${i}`)
        }
        setLive(makeDb([]))
        await prime()
        let removed = 0
        h.forageHooks.afterRemove = () => {
            removed++
            if (removed === 100) {
                interrupt()
            }
        }

        await run()

        const deleted = total - (await units()).length
        expect(deleted).toBeGreaterThan(0)
        expect(deleted).toBeLessThan(total)
        const shown = errorMessages().join('\n')
        expect(shown).toMatch(new RegExp(`\\b${deleted}\\b`))
        expect(shown).not.toMatch(/not started|was skipped|nothing was deleted/i)
        expect(vi.mocked(ctx.alert.alertNormal)).not.toHaveBeenCalled()
    })
})

describe('assets', () => {
    test('deletes an unreferenced asset present at load and keeps every asset a live source references', async () => {
        await setup()
        seedAsset('orphan.png')
        for (const name of ['character.png', 'emotion.png', 'extra.png', 'background.png', 'user-icon.png', 'module-asset.png', 'module-icon.png', 'persona-icon.png']) {
            seedAsset(name)
        }
        h.forage.set('remotes/some-remote.bin', new Uint8Array([7]))
        setLive(makeDb([
            fullCharacter('asset-cha', 'Assets', {
                image: 'assets/character.png',
                emotionImages: [['happy', 'assets/emotion.png']],
                additionalAssets: [['bg', 'assets/extra.png', '']],
            }),
        ], {
            customBackground: 'assets/background.png',
            userIcon: 'assets/user-icon.png',
            modules: [{ id: 'm1', name: 'Module', assets: [['a', 'assets/module-asset.png', '']], icon: 'assets/module-icon.png' }],
            personas: [{ name: 'Persona', icon: 'assets/persona-icon.png' }],
        }))
        await prime()

        await run()

        expect(assetKeys()).toEqual(expect.arrayContaining([
            'assets/character.png', 'assets/emotion.png', 'assets/extra.png', 'assets/background.png',
            'assets/user-icon.png', 'assets/module-asset.png', 'assets/module-icon.png', 'assets/persona-icon.png',
        ]))
        expect(assetKeys()).not.toContain('assets/orphan.png')
        expect(h.forage.has('database/database.bin')).toBe(true)
        expect(h.forage.has('remotes/some-remote.bin')).toBe(true)
    })

    test('keeps an asset referenced only inside a blob', async () => {
        await setup()
        seedAsset('orphan.png')
        seedAsset('blob-only.png')
        await putBlob('asset-blob', fullCharacter('blobby-cha', 'Blobby', { additionalAssets: [['bg', 'assets/blob-only.png', '']] }))
        setLive(makeDb([stubCharacter('blobby-cha', 'Blobby', 'asset-blob')]))
        await prime()

        await run()

        expect(assetKeys()).not.toContain('assets/orphan.png')
        expect(assetKeys()).toContain('assets/blob-only.png')
    })

    test('keeps an asset referenced only by a full character in the committed main file', async () => {
        await setup()
        seedAsset('orphan.png')
        seedAsset('committed-avatar.png')
        seedAsset('live-avatar.png')
        setLive(makeDb([fullCharacter('avatar-cha', 'Avatar', { image: 'assets/live-avatar.png' })]))
        await prime(makeDb([fullCharacter('avatar-cha', 'Avatar', { image: 'assets/committed-avatar.png' })]))

        await run()

        expect(assetKeys()).not.toContain('assets/orphan.png')
        expect(assetKeys()).toContain('assets/committed-avatar.png')
        expect(assetKeys()).toContain('assets/live-avatar.png')
    })

    test('keeps an asset written after the load-time listing', async () => {
        await setup()
        seedAsset('present-at-load.png')
        setLive(makeDb([]))
        await prime()
        seedAsset('written-after-load.png')

        await run()

        expect(assetKeys()).not.toContain('assets/present-at-load.png')
        expect(assetKeys()).toContain('assets/written-after-load.png')
    })

    test('keeps an asset that a loaded character starts referencing after the keep-set was computed and before its deletion', async () => {
        await setup()
        for (let i = 0; i < 250; i++) {
            seedAsset(`filler-${String(i).padStart(3, '0')}.png`)
        }
        seedAsset('late-reference.png')
        setLive(makeDb([fullCharacter('late-cha', 'Late')]))
        await prime()
        h.forageHooks.onRemove = (key) => {
            if (key.startsWith('assets/')) {
                h.forageHooks.onRemove = undefined
                ctx.stores.DBState.db.characters[0].image = 'assets/late-reference.png'
            }
        }

        await run()

        expect(assetKeys()).not.toContain('assets/filler-000.png')
        expect(assetKeys()).toContain('assets/late-reference.png')
    })

    test('guard: Tauri: deletes an unreferenced asset and keeps a referenced one through the desktop store', async () => {
        await setup({ platform: 'tauri' })
        seedAsset('orphan.png')
        seedAsset('hero.png')
        setLive(makeDb([fullCharacter('hero-cha', 'Hero', { image: 'assets/hero.png' })]))
        await prime()

        await run()

        expect(assetKeys()).toEqual(['assets/hero.png'])
    })

    test('reproducer: Tauri: an asset whose name differs from the reference only in case is kept, as the file system sees one file', async () => {
        await setup({ platform: 'tauri' })
        seedAsset('orphan.png')
        seedAsset('Hero.PNG')
        setLive(makeDb([fullCharacter('hero-cha', 'Hero', { image: 'assets/hero.png' })]))
        await prime()

        await run()

        expect(assetKeys()).toEqual(['assets/Hero.PNG'])
    })

    test('guard: Tauri: when deletes fail inside two groups of a batch, the counts are per key and every other group is still attempted', async () => {
        await setup({ platform: 'tauri' })
        const names = Array.from({ length: 60 }, (_, index) => `asset-${String(index).padStart(2, '0')}.png`)
        for (const name of names) {
            seedAsset(name)
        }
        const stuck = [names[2], names[45], names[46]]
        for (const name of stuck) {
            h.fsFail.add(`assets/${name}`)
        }
        setLive(makeDb([]))
        await prime()

        await run()

        expect(assetKeys().sort()).toEqual(stuck.map((name) => `assets/${name}`).sort())
        expect(errorMessages().some((m) => m.includes('3 item(s) could not be deleted') && m.includes('57 item(s) were deleted'))).toBe(true)
    })

    test('guard: web: names that differ only in case are different assets, so the unreferenced one goes', async () => {
        await setup()
        seedAsset('Hero.PNG')
        seedAsset('hero.png')
        setLive(makeDb([fullCharacter('hero-cha', 'Hero', { image: 'assets/hero.png' })]))
        await prime()

        await run()

        expect(assetKeys()).toEqual(['assets/hero.png'])
    })

    test('reproducer: Tauri: a case-only reference that live memory gains before the deletion keeps the file', async () => {
        await setup({ platform: 'tauri' })
        for (let i = 0; i < 250; i++) {
            seedAsset(`filler-${String(i).padStart(3, '0')}.png`)
        }
        seedAsset('Late-Reference.PNG')
        setLive(makeDb([fullCharacter('late-cha', 'Late')]))
        await prime()
        const { remove } = await import('@tauri-apps/plugin-fs')
        const realRemove = vi.mocked(remove).getMockImplementation()
        vi.mocked(remove).mockImplementation(async (path, options) => {
            vi.mocked(remove).mockImplementation(realRemove!)
            ctx.stores.DBState.db.characters[0].image = 'assets/late-reference.png'
            await realRemove!(path, options)
        })

        await run()

        expect(assetKeys()).not.toContain('assets/filler-000.png')
        expect(assetKeys()).toContain('assets/Late-Reference.PNG')
    })

    test('guard: deletes no asset when no load-time listing was recorded', async () => {
        await setup()
        seedAsset('present-at-load.png')
        setLive(makeDb([]))
        await prime(undefined, { listing: false })

        await run()

        expect(assetKeys()).toContain('assets/present-at-load.png')
    })
})

describe('unit names the key rule rejects', () => {
    const PLATFORMS: Platform[] = ['web', 'tauri', 'node']
    const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
    /** Stored names that cannot be unit keys, none containing a path separator so every fake directory can list them. */
    const REJECTED_NAMES = ['a:b', 'a<b', 'k'.repeat(101)]

    describe.each(PLATFORMS)('on %s', (which) => {
        test('guard: deletes a listed, unreferenced <uuid>_accessMeta unit', async () => {
            await setup({ platform: which })
            seedUnit(UUID + '_accessMeta')
            seedUnit('unreferenced-unit')
            setLive(makeDb([]))
            await prime()

            await run()

            const after = await units()
            expect(after).not.toContain(UUID + '_accessMeta')
            expect(after).not.toContain('unreferenced-unit')
            expect(errorMessages()).toEqual([])
        })

        test('the load-time listing and the start listing leave out a stored name the rule rejects', async () => {
            await setup({ platform: which })
            for (const name of REJECTED_NAMES) {
                seedUnit(name)
            }
            seedUnit('plain-unit')
            setLive(makeDb([]))
            await prime()

            expect([...ctx.listing.getLoadTimeListing()!.units]).toEqual(['plain-unit'])
            expect([...(await ctx.listing.takeStorageListing()).units]).toEqual(['plain-unit'])
        })

        test('a run neither deletes nor reports a stored name the rule rejects, and still deletes the unreferenced unit beside it', async () => {
            await setup({ platform: which })
            for (const name of REJECTED_NAMES) {
                seedUnit(name)
            }
            seedUnit('unreferenced-unit')
            setLive(makeDb([]))
            await prime()

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(REJECTED_NAMES))
            expect(after).not.toContain('unreferenced-unit')
            expect(errorMessages()).toEqual([])
        })

        test('removeUnitBatch counts a rejected key as failed and removes nothing at the path it would splice to', async () => {
            await setup({ platform: which })
            // A file exists at the path the rejected key `a:b` would splice to; the key must not reach it.
            seedUnit('a:b')
            seedUnit('plain-unit')
            const { removeUnitBatch } = await import('src/ts/storage/manualCleanup')

            const failed = await removeUnitBatch(['a:b', 'plain-unit', 'a<b', ''], 0, 4)

            expect(failed).toBe(3)
            const after = await units()
            expect(after).toContain('a:b')
            expect(after).not.toContain('plain-unit')
        })

        test('removeUnitBatch makes no backend call when every key is rejected', async () => {
            await setup({ platform: which })
            seedUnit('a:b')
            const { removeUnitBatch } = await import('src/ts/storage/manualCleanup')
            h.unitLog.removed = []
            server.requests = []

            expect(await removeUnitBatch(['a:b', 'c:d'], 0, 2)).toBe(2)

            expect(h.unitLog.removed).toEqual([])
            expect(server.requestsTo('/api/remove')).toEqual([])
            expect(await units()).toContain('a:b')
        })
    })
})

describe('archived chats: the clean-up follows what they refer to', () => {
    const ALL_PLATFORMS: Platform[] = ['web', 'tauri', 'node']

    const pointerMessage = (key: string) => coldChat('inner', key).message[0]
    const errorTextMessage = (key: string) => errorTextChat('inner', key).message[0]
    const REFERENCES = [
        ['a pointer', pointerMessage],
        ['legacy error text', errorTextMessage],
    ] as const

    /** A chat unit whose first message is `firstMessage`. */
    function chatUnitWith(firstMessage: unknown) {
        return { ...CHAT_VALUE, message: [firstMessage, ...CHAT_VALUE.message] }
    }

    /** Bytes that are stored but do not decode, so a read of the unit is `damaged`. */
    function seedUndecodableUnit(key: string): void {
        const bytes = new Uint8Array([1, 2, 3, 4])
        if (platform === 'node') {
            server.seed('coldstorage/' + key, bytes)
        } else if (platform === 'tauri') {
            h.fs.set('coldstorage/' + key + '.json', bytes)
        } else {
            h.forage.set('coldstorage/' + key, bytes)
        }
    }

    /** Makes every read of the unit fail with an error that is neither "missing" nor "damaged". */
    function breakRead(key: string): void {
        if (platform === 'node') {
            server.readFailures.add('coldstorage/' + key)
        } else if (platform === 'tauri') {
            h.fsReadError.set('coldstorage/' + key + '.json', { message: 'Access is denied. (os error 5)', removeFile: false })
        } else {
            h.forageReadFail.add('coldstorage/' + key)
        }
    }

    function readsOf(key: string): number {
        if (platform === 'node') {
            const hex = Buffer.from('coldstorage/' + key, 'utf-8').toString('hex')
            return server.requestsTo('/api/read').filter((r) => r.headers['file-path'] === hex).length
        }
        if (platform === 'tauri') {
            return h.fsReads.filter((path) => path === 'coldstorage/' + key + '.json').length
        }
        return h.unitLog.reads.filter((name) => name === 'coldstorage/' + key).length
    }

    const aliceHolding = (key: string) => makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', key)] })])

    describe.each(ALL_PLATFORMS)('on %s', (which) => {
        test.each(REFERENCES)('keeps the unit that an archived chat in the committed main file names by %s', async (_label, reference) => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(reference('unit-v')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            const after = await units()
            expect(after).toContain('unit-u')
            expect(after).toContain('unit-v')
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('follows a chain that starts at a chat of the committed main file whose first message is legacy error text', async () => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(makeDb([fullCharacter('char-a', 'Alice', { chats: [errorTextChat('chat-1', 'unit-u')] })]))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('keeps the unit that an archived chat names when the chat is reached through a stub blob', async () => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            await putBlob('blob-b', fullCharacter('stub-cha', 'Stubby', { chats: [coldChat('inner-chat', 'unit-u')] }))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(makeDb([stubCharacter('stub-cha', 'Stubby', 'blob-b')]))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['blob-b', 'unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('keeps the unit that an archived chat names when only a retained snapshot reaches the chat', async () => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(makeDb([]))
            storeSnapshot(17000000001, await encodeTree(aliceHolding('unit-u')))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('keeps the unit that an archived chat names when only live memory reaches the chat', async () => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            seedUnit('orphan-o')
            setLive(aliceHolding('unit-u'))
            await prime(makeDb([]))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('keeps the unit that an archived chat names when the chat unit is a legacy bare message array', async () => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', [errorTextMessage('unit-v')])
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
        })

        test.each(REFERENCES)('keeps every unit of a chain of archived chats linked by %s', async (_label, reference) => {
            await setup({ platform: which })
            await putUnit('unit-w')
            await putUnit('unit-v', chatUnitWith(reference('unit-w')))
            await putUnit('unit-u', chatUnitWith(reference('unit-v')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v', 'unit-w']))
            expect(after).not.toContain('orphan-o')
        })

        test('terminates on archived chats that name each other, keeps both and reads each once', async () => {
            await setup({ platform: which })
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            await putUnit('unit-v', chatUnitWith(pointerMessage('unit-u')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
            expect([readsOf('unit-u'), readsOf('unit-v')]).toEqual([1, 1])
        })

        test.each([
            ['the plugin slot is in an earlier tree than the chat link', 'plugin first'],
            ['the plugin slot is in a later tree than the chat link', 'link first'],
        ] as const)('reads and follows a unit that is both a plugin slot and a chat link when %s', async (_label, order) => {
            await setup({ platform: which })
            await putUnit('unit-w')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-w')))
            seedUnit('orphan-o')
            const pluginTree = makeDb([], { pluginCustomStorage: { _coldplugin: { slot: 'unit-u' } } })
            const linkTree = aliceHolding('unit-u')
            if (order === 'plugin first') {
                setLive(linkTree)
                await prime(pluginTree)
            } else {
                setLive(pluginTree)
                await prime(linkTree)
            }

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-w']))
            expect(after).not.toContain('orphan-o')
        })

        test('guard: does not read the content of a plugin unit for references', async () => {
            await setup({ platform: which })
            await putUnit('unit-w')
            await putUnit('plugin-unit', { message: [pointerMessage('unit-w')] })
            seedUnit('orphan-o')
            setLive(makeDb([], { pluginCustomStorage: { _coldplugin: { slot: 'plugin-unit' } } }))
            await prime()

            await run()

            const after = await units()
            expect(after).toContain('plugin-unit')
            expect(after).not.toContain('unit-w')
            expect(after).not.toContain('orphan-o')
            expect(readsOf('plugin-unit')).toBe(0)
        })

        test('guard: a plugin unit that cannot be read does not stop the run', async () => {
            await setup({ platform: which })
            await putUnit('plugin-unit', { some: 'plugin value' })
            seedUnit('orphan-o')
            breakRead('plugin-unit')
            setLive(makeDb([], { pluginCustomStorage: { _coldplugin: { slot: 'plugin-unit' } } }))
            await prime()

            await run()

            const after = await units()
            expect(after).toContain('plugin-unit')
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('guard: an archived chat that is not on disk is kept by name and the run carries on', async () => {
            await setup({ platform: which })
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            expect(await units()).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('guard: a damaged archived chat is kept, nothing is followed from it and the run carries on', async () => {
            await setup({ platform: which })
            seedUndecodableUnit('unit-u')
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))
            expect(await ctx.cold.readColdStorageItem('unit-u')).toMatchObject({ status: 'error', kind: 'damaged' })

            await run()

            const after = await units()
            expect(after).toContain('unit-u')
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('keeps a damaged archived chat that a chain reaches, follows nothing from it and carries on', async () => {
            await setup({ platform: which })
            seedUndecodableUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            const after = await units()
            expect(after).toEqual(expect.arrayContaining(['unit-u', 'unit-v']))
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test.each([
            ['a plain string', 'just a string'],
            ['a number', 42],
            ['null', null],
            ['an object of another shape', { unrelated: true }],
        ])('guard: a reachable unit holding %s is kept and the run carries on', async (_label, value) => {
            await setup({ platform: which })
            await putUnit('unit-u', value)
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            const after = await units()
            expect(after).toContain('unit-u')
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test.each([
            ['a chat in the committed main file', 'main'],
            ['a chat unit', 'unit'],
        ] as const)('guard: error text in %s naming a key that cannot be a storage name does not stop the run', async (_label, where) => {
            await setup({ platform: which })
            seedUnit('orphan-o')
            setLive(makeDb([]))
            if (where === 'main') {
                await prime(makeDb([fullCharacter('char-a', 'Alice', { chats: [errorTextChat('chat-1', 'a/b')] })]))
            } else {
                await putUnit('unit-u', chatUnitWith(errorTextMessage('a/b')))
                await prime(aliceHolding('unit-u'))
            }

            await run()

            const after = await units()
            expect(after).not.toContain('orphan-o')
            expect(errorMessages()).toEqual([])
        })

        test('guard: a stub whose blob key cannot be a storage name stops the run before any deletion', async () => {
            await setup({ platform: which })
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(makeDb([stubCharacter('stub-cha', 'Stubby', 'a/b')]))

            await run()

            expect(await units()).toContain('orphan-o')
            expect(errorMessages().some((m) => m.includes('Stubby'))).toBe(true)
        })

        const SOURCES = [
            ['the committed main file', 'main', () => language.errors.coldStorageCleanupSourceMain],
            ['live memory', 'live', () => language.errors.coldStorageCleanupSourceLive],
            ['a retained snapshot', 'snapshot', () => 'dbbackup-17654321.bin'],
        ] as const

        test.each(SOURCES)('stops before any deletion, naming the character and the source, when an archived chat reached from %s cannot be read', async (_label, where, sourceText) => {
            await setup({ platform: which })
            await putUnit('unit-u')
            await putUnit('unit-v')
            seedUnit('orphan-o')
            breakRead('unit-u')
            if (where === 'main') {
                setLive(makeDb([]))
                await prime(aliceHolding('unit-u'))
            } else if (where === 'live') {
                setLive(aliceHolding('unit-u'))
                await prime(makeDb([]))
            } else {
                setLive(makeDb([]))
                await prime(makeDb([]))
                storeSnapshot(17654321, await encodeTree(aliceHolding('unit-u')))
            }

            await run()

            expect(await units()).toEqual(expect.arrayContaining(['orphan-o', 'unit-u', 'unit-v']))
            expect(errorMessages().some((m) => m.includes('Alice') && m.includes(sourceText()))).toBe(true)
            expect(vi.mocked(ctx.alert.alertNormal)).not.toHaveBeenCalled()
        })

        test('stops before any deletion, naming the character the chain started from, when an archived chat deeper in a chain cannot be read', async () => {
            await setup({ platform: which })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            seedUnit('orphan-o')
            breakRead('unit-v')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))

            await run()

            expect(await units()).toEqual(expect.arrayContaining(['orphan-o', 'unit-u', 'unit-v']))
            expect(errorMessages().some((m) => m.includes('Alice'))).toBe(true)
        })
    })

    test('new behaviour: a browser without OPFS still reads, keeps and deletes units in the page store', async () => {
        await setup()
        await putUnit('unit-u')
        seedUnit('orphan-o')
        setLive(makeDb([]))
        await prime(aliceHolding('unit-u'))
        const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
        Object.defineProperty(navigator, 'storage', { configurable: true, value: {} })

        try {
            await run()
        } finally {
            if (original) {
                Object.defineProperty(navigator, 'storage', original)
            }
        }

        const after = await units()
        expect(after).toContain('unit-u')
        expect(after).not.toContain('orphan-o')
        expect(errorMessages()).toEqual([])
    })

    describe('Tauri: a read that fails inside a units folder that does not exist', () => {
        const UNIT_PATH = 'coldstorage/unit-u.json'
        const ORPHAN_ASSET = 'assets/orphan.png'

        async function arrange(): Promise<void> {
            await setup({ platform: 'tauri' })
            h.fs.set(ORPHAN_ASSET, new Uint8Array([9, 9]))
            h.fsReadError.set(UNIT_PATH, { message: 'The system cannot find the path specified. (os error 3)', removeFile: false })
            setLive(makeDb([]))
            await prime(makeDb([fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'unit-u')] })]))
        }

        test('treats an archived chat as missing and carries on while the units folder does not exist', async () => {
            await arrange()
            expect(Array.from(h.fs.keys()).some((key) => key.startsWith('coldstorage/'))).toBe(false)

            await run()

            expect(h.fs.has(ORPHAN_ASSET)).toBe(false)
            expect(errorMessages()).toEqual([])
        })

        test('guard: stops, naming the character, when the unit file is present but its read fails with the path-not-found code', async () => {
            await arrange()
            seedUnit('unit-u')

            await run()

            expect(h.fs.has(ORPHAN_ASSET)).toBe(true)
            expect(errorMessages().some((m) => m.includes('Alice'))).toBe(true)
        })

        test('new behaviour: treats the archived chat as missing and carries on when the same read fails while the units folder exists and the file is absent', async () => {
            await arrange()
            seedUnit('other-unit')

            await run()

            expect(h.fs.has(ORPHAN_ASSET)).toBe(false)
            expect(errorMessages()).toEqual([])
        })

        test('stops, naming the character, when the units folder is reported absent but units were listed at load', async () => {
            await setup({ platform: 'tauri' })
            await putUnit('unit-v')
            await putUnit('unit-u', chatUnitWith(errorTextMessage('unit-v')))
            seedUnit('orphan-o')
            setLive(makeDb([]))
            await prime(aliceHolding('unit-u'))
            // `exists()` is also false when a present folder's metadata cannot be read; `readDir` still lists it.
            h.fsHidden.add('coldstorage')
            h.fsReadError.set(UNIT_PATH, { message: 'The network path was not found. (os error 64)', removeFile: false })

            await run()

            h.fsHidden.delete('coldstorage')
            expect(await units()).toEqual(expect.arrayContaining(['unit-u', 'unit-v', 'orphan-o']))
            expect(errorMessages().some((m) => m.includes('Alice'))).toBe(true)
        })

        test('guard: stops when it cannot be told whether the unit file exists', async () => {
            await arrange()
            h.fsExistsError.add(UNIT_PATH)

            await run()

            expect(h.fs.has(ORPHAN_ASSET)).toBe(true)
            expect(errorMessages().some((m) => m.includes('Alice'))).toBe(true)
        })

        test('guard: a blob read that fails while the units folder does not exist still stops the run', async () => {
            await setup({ platform: 'tauri' })
            h.fs.set(ORPHAN_ASSET, new Uint8Array([9, 9]))
            h.fsReadError.set('coldstorage/blob-b.json', { message: 'The system cannot find the path specified. (os error 3)', removeFile: false })
            setLive(makeDb([]))
            await prime(makeDb([stubCharacter('stub-cha', 'Stubby', 'blob-b')]))

            await run()

            expect(h.fs.has(ORPHAN_ASSET)).toBe(true)
            expect(errorMessages().some((m) => m.includes('Stubby'))).toBe(true)
        })
    })

    test('reads every archived chat and blob exactly once, one at a time, and finishes reading before the listing and the first deletion', async () => {
        await setup()
        const cha = (n: number) => `blob-cha-${n}`
        const blob = (n: number) => `shared-blob-${n}`
        await putUnit('unit-v', chatUnitWith(pointerMessage('unit-u1')))
        await putUnit('unit-u1', chatUnitWith(errorTextMessage('unit-v')))
        await putUnit('unit-u2')
        await putBlob(blob(1), fullCharacter(cha(1), 'Blobby 1', { chats: [coldChat('inner-1', 'unit-u1')] }))
        await putBlob(blob(2), fullCharacter(cha(2), 'Blobby 2', { chats: [coldChat('inner-2', 'unit-u1'), coldChat('inner-3', 'unit-u2')] }))
        seedUnit('orphan-o')
        // Blob 1 and unit-u1 are reached from the live tree, the committed main file and two snapshots;
        // blob 2 and unit-u2 only from the live tree.
        setLive(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1)), stubCharacter(cha(2), 'Blobby 2', blob(2)), fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'unit-u1')] })]))
        await prime(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1)), fullCharacter('char-a', 'Alice', { chats: [coldChat('chat-1', 'unit-u1')] })]))
        storeSnapshot(17000000001, await encodeTree(makeDb([stubCharacter(cha(1), 'Blobby 1', blob(1))])))
        storeSnapshot(17000000002, await encodeTree(aliceHolding('unit-u1')))
        h.unitLog.reads = []
        h.unitLog.peakInFlight = 0
        let readsAtListing: number | undefined
        let readsAtFirstRemoval: number | undefined
        h.forageHooks.afterUnitListing = () => {
            readsAtListing ??= h.unitLog.reads.length
        }
        h.forageHooks.onRemove = () => {
            readsAtFirstRemoval ??= h.unitLog.reads.length
        }

        await run()

        expect([blob(1), blob(2), 'unit-u1', 'unit-u2', 'unit-v'].map(readsOf)).toEqual([1, 1, 1, 1, 1])
        expect(h.unitLog.peakInFlight).toBeLessThanOrEqual(1)
        expect(readsAtListing).toBe(5)
        expect(readsAtFirstRemoval).toBe(5)
        const after = await units()
        expect(after).toEqual(expect.arrayContaining(['unit-u1', 'unit-u2', 'unit-v']))
        expect(after).not.toContain('orphan-o')
    })
})
