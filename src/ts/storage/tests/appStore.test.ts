// @vitest-environment node
/**
 * The page's byte store (`src/ts/storage/store/appStore.ts`): which store each
 * platform gets, that a page served by neither Tauri nor the Node server gets no
 * store and nothing is initialised or written, and how the main file reads on the
 * Node server.
 *
 * The Node server is the `FakeNodeServer` stand-in at the `fetch` boundary and the
 * Tauri file system is an in-memory model; a pass is no evidence about a real
 * server, desktop file system or browser. `fake-indexeddb` stands in for the
 * browser database that the refusal case proves is never touched, and is imported
 * first because LocalForage captures `indexedDB` once when it loads.
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
const desktop = await vi.hoisted(async () => (await import('src/ts/storage/tests/tauriDesktopFake')).createDesktopInvoke(fakeFs))

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

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
    invoke: desktop.invoke,
}))

type AppStoreModule = typeof import('src/ts/storage/store/appStore')

let app: AppStoreModule

let server: FakeNodeServer

/** The `risuai` LocalForage database upstream's own code uses; the refusal case plants a value there. */
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

    test('the selected kind is readable: Tauri and Node each report their own', async () => {
        platform('tauri')
        expect(await app.getAppStoreKind()).toBe('tauri')

        await nodeWorld()
        app.injectAppStore(null)
        expect(await app.getAppStoreKind()).toBe('node')
    })

    test('the real selection reaches the asset limit registry: Tauri 1 GiB, Node 100 MiB until pieces are recorded then 1 GiB', async () => {
        const MiB = 1024 * 1024
        const limits = await import('src/ts/storage/assetLimit')
        expect(limits.selectedStoreIsNode()).toBe(false)

        platform('tauri')
        await app.getAppStore()
        expect(limits.selectedStoreIsNode()).toBe(false)
        expect(limits.storeAssetLimitBytes()).toBe(1024 * MiB)

        await nodeWorld()
        app.injectAppStore(null)
        const nodeStore = await app.getAppStore()
        expect(limits.selectedStoreIsNode()).toBe(true)
        expect(limits.storeAssetLimitBytes()).toBe(100 * MiB)
        Object.assign(nodeStore, { piecesRecorded: () => true })
        expect(limits.storeAssetLimitBytes()).toBe(1024 * MiB)
    })

    test('the kind of a store injected without one is not guessed', async () => {
        const injected = { capabilities: { conditionalWrites: false } } as unknown as Awaited<ReturnType<AppStoreModule['getAppStore']>>
        app.injectAppStore(injected)
        await expect(app.getAppStoreKind()).rejects.toBeDefined()
        app.injectAppStore(injected, 'tauri')
        expect(await app.getAppStoreKind()).toBe('tauri')
    })

    test('a selection that failed because the storage object could not be initialised stands for the page: every call gets the same rejection and Init is not run again', async () => {
        await nodeWorld()
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

describe('a page served by neither Tauri nor the Node server', () => {
    test('4c-R1: no store, the storage object is not initialised, and no LocalForage call or IndexedDB write happens', async () => {
        await profile.clear()
        await profile.setItem(MAIN, bytes(1))
        const init = vi.fn(async (): Promise<void> => { })
        h.forage.Init = init
        const supports = vi.spyOn(localforage, 'supports')
        const createInstance = vi.spyOn(localforage, 'createInstance')
        const idbWrite = vi.spyOn(IDBObjectStore.prototype, 'put')
        platform('web')

        await expect(app.getAppStore()).rejects.toBeInstanceOf(app.AppStoreUnavailableError)
        await expect(app.readMainFile()).rejects.toBeInstanceOf(app.AppStoreUnavailableError)

        expect(init).not.toHaveBeenCalled()
        expect(supports).not.toHaveBeenCalled()
        expect(createInstance).not.toHaveBeenCalled()
        expect(idbWrite).not.toHaveBeenCalled()
    })
})
