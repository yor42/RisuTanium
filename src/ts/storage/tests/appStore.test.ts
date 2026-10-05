// @vitest-environment node
/**
 * The page's byte store (`src/ts/storage/store/appStore.ts`): which store each
 * platform gets, that an OPFS-main profile never reads or writes the IndexedDB
 * copy of its keys, that a browser without usable IndexedDB gets no store and
 * nothing is written, and how the main file reads on the Node server.
 *
 * The Node server is the `FakeNodeServer` stand-in at the `fetch` boundary, the
 * Tauri file system and the OPFS root are in-memory models, and IndexedDB is
 * `fake-indexeddb`; a pass is no evidence about a real server, desktop file
 * system or browser. `fake-indexeddb/auto` is imported first because LocalForage
 * captures `indexedDB` once when it loads. A failed IndexedDB open is in
 * `appStore.indexedDbOpenFailure.test.ts`: LocalForage remembers a failed open
 * for the life of its module, so it needs a module registry of its own.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FakeNodeServer } from './manualCleanupHarness'

const MAIN = 'database/database.bin'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    forage: { Init: async (): Promise<void> => { }, realStorage: undefined as unknown },
    keyPair: null as CryptoKeyPair | null,
}))

const fakeFs = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriFsFake')).createFakeTauriFs({ strict: true }))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    get forageStorage() { return h.forage },
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock('src/lang', () => ({
    language: { setNodePassword: 'set password', inputNodePassword: 'input password' },
}))

vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => {
        h.keyPair ??= await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
        return h.keyPair
    }),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

vi.mock('@tauri-apps/plugin-fs', () => fakeFs.module)

type AppStoreModule = typeof import('src/ts/storage/store/appStore')

let app: AppStoreModule

let server: FakeNodeServer

/** The `risuai` LocalForage database the IndexedDB store and upstream's own code share. */
const profile = localforage.createInstance({ name: 'risuai' })

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

function platform(which: 'tauri' | 'node' | 'web'): void {
    h.platform.isTauri = which === 'tauri'
    h.platform.isNodeServer = which === 'node'
}

async function nodeWorld(): Promise<void> {
    platform('node')
    server = new FakeNodeServer()
    vi.stubGlobal('fetch', server.fetch)
    const { NodeStorage } = await import('src/ts/storage/nodeStorage')
    h.forage.realStorage = new NodeStorage()
}

beforeEach(async () => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.forage.Init = async () => { }
    h.forage.realStorage = undefined
    fakeFs.reset()
    vi.resetModules()
    app = await import('src/ts/storage/store/appStore')
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('the store each platform gets', () => {
    test('Tauri: the desktop files store; the main file is read', async () => {
        platform('tauri')
        fakeFs.plant(MAIN, bytes(1, 2, 3))

        const store = await app.getAppStore()
        const read = await app.readMainFile()

        expect(store.capabilities.conditionalWrites).toBe(false)
        expect(Array.from(read.bytes ?? [])).toEqual([1, 2, 3])
        expect(read.version).toBeNull()
    })

    test('Node: the Node HTTP store, authenticated through the storage object\'s own Node client', async () => {
        await nodeWorld()
        server.seed(MAIN, bytes(7))

        const store = await app.getAppStore()

        expect(store.capabilities.conditionalWrites).toBe(true)
        const read = await app.readMainFile()
        expect(Array.from(read.bytes ?? [])).toEqual([7])
        expect(server.requestsTo('/api/read').length).toBe(1)
    })

    test('IndexedDB: the pinned IndexedDB store over the database upstream already uses', async () => {
        await profile.clear()
        await profile.setItem(MAIN, bytes(3, 3, 3))

        const store = await app.getAppStore()
        const read = await app.readMainFile()

        expect(store.capabilities.conditionalWrites).toBe(false)
        expect(Array.from(read.bytes ?? [])).toEqual([3, 3, 3])
    })

    test('the selected kind is readable: Tauri, Node and IndexedDB each report their own', async () => {
        platform('tauri')
        expect(await app.getAppStoreKind()).toBe('tauri')

        await nodeWorld()
        app.injectAppStore(null)
        expect(await app.getAppStoreKind()).toBe('node')

        platform('web')
        h.forage.realStorage = undefined
        app.injectAppStore(null)
        expect(await app.getAppStoreKind()).toBe('indexeddb')
    })

    test('the kind of a store injected without one is not guessed', async () => {
        const injected = { capabilities: { conditionalWrites: false } } as unknown as Awaited<ReturnType<AppStoreModule['getAppStore']>>
        app.injectAppStore(injected)
        await expect(app.getAppStoreKind()).rejects.toBeDefined()
        app.injectAppStore(injected, 'tauri')
        expect(await app.getAppStoreKind()).toBe('tauri')
    })

    test('a selection that failed because the storage object could not be initialised stands for the page: every call gets the same rejection and Init is not run again', async () => {
        let attempts = 0
        h.forage.Init = async () => {
            attempts++
            throw new Error('init failed')
        }

        await expect(app.getAppStore()).rejects.toThrow('init failed')
        await expect(app.getAppStore()).rejects.toThrow('init failed')
        await expect(app.readMainFile()).rejects.toThrow('init failed')

        expect(attempts).toBe(1)
    })

    test('an injected store is the page\'s store, and injecting nothing restores the real selection', async () => {
        const injected = { capabilities: { conditionalWrites: false } } as unknown as Awaited<ReturnType<AppStoreModule['getAppStore']>>

        app.injectAppStore(injected)
        expect(await app.getAppStore()).toBe(injected)

        platform('tauri')
        app.injectAppStore(null)
        expect(await app.getAppStore()).not.toBe(injected)
    })
})

describe('the main file on the Node server', () => {
    beforeEach(async () => {
        await nodeWorld()
    })

    test('an absent main file reads as absent at its create version', async () => {
        const read = await app.readMainFile()

        expect(read.bytes).toBeNull()
        expect(read.version).toBe(0)
    })

    test('a zero-length main file is a value, distinct from an absent one', async () => {
        server.seed(MAIN, new Uint8Array(0))

        const read = await app.readMainFile()

        expect(read.bytes).not.toBeNull()
        expect(read.bytes?.length).toBe(0)
    })
})

describe('a browser without usable IndexedDB', () => {
    test('LocalForage without IndexedDB support: no store, and nothing is read or written', async () => {
        await profile.clear()
        await profile.setItem(MAIN, bytes(1))
        vi.spyOn(localforage, 'supports').mockReturnValue(false)
        const idbWrite = vi.spyOn(IDBObjectStore.prototype, 'put')

        await expect(app.getAppStore()).rejects.toBeInstanceOf(app.AppStoreUnavailableError)
        await expect(app.readMainFile()).rejects.toBeInstanceOf(app.AppStoreUnavailableError)

        expect(idbWrite).not.toHaveBeenCalled()
    })

})
