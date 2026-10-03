/**
 * Which web pages may run the boot archive pass (`openBootArchiveSession` with
 * the production bindings of `src/ts/storage/bootArchiveHost.ts`): a page whose
 * byte store is the IndexedDB store, wherever IndexedDB works, whether or not
 * the browser can write OPFS files; and never a page that fell back to the OPFS
 * main store, because the pass writes new units into the page's store.
 *
 * The page store is selected by the real `appStore` over `fake-indexeddb`, with
 * an in-memory OPFS root for the fallback page; the exclusive hold is a stand-in
 * that is always granted. A pass here says nothing about a real browser.
 *
 * Every test is labelled in its title: "regression reproducer" fails against
 * the gate that asked whether the browser could write OPFS files; "guard"
 * holds before and after.
 */
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FakeOpfsRoot, hexName } from './fakeOpfsRoot'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    forage: { Init: async (): Promise<void> => { }, realStorage: undefined as unknown, staleAccountProfile: false },
    acquire: (async (_timeoutMs?: number) => async () => { }) as (timeoutMs?: number) => Promise<(() => Promise<void>) | null>,
    acquireCalls: 0,
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isMobile: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    acquireExclusiveStorageMigrationLock: (timeoutMs?: number) => {
        h.acquireCalls++
        return h.acquire(timeoutMs)
    },
    get forageStorage() { return h.forage },
    locksSupported: true,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: vi.fn(),
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

// The pass module imports the character archiving helpers, which reach the whole
// application; this suite only opens a session and never runs a pass.
vi.mock(import('src/ts/process/coldCharacter'), () => ({
    buildColdStub: vi.fn(),
    enrichLegacyStub: vi.fn(),
    isLegacyStub: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldCharacter'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    setDatabase: vi.fn(),
    presetTemplate: { name: 'test-preset' },
    defaultSdDataFunc: vi.fn(() => ({})),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    isAppInitiatedReload: vi.fn(() => false),
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock(import('src/ts/stores.svelte'), () => ({
    LoadingStatusState: { text: '' },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

vi.mock('src/lang', () => ({
    language: { setNodePassword: 'set password', inputNodePassword: 'input password' },
}))

vi.mock('src/ts/util', () => ({
    asBuffer: (value: Uint8Array) => value,
    base64url: (source: Uint8Array | ArrayBuffer) => Buffer.from(source as Uint8Array).toString('base64url'),
    getKeypairStore: vi.fn(async () => null),
    saveKeypairStore: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertInput: vi.fn(),
    waitAlert: vi.fn(async () => { }),
}))

type Pass = typeof import('src/ts/storage/bootArchivePass')

let pass: Pass
let app: typeof import('src/ts/storage/store/appStore')

/** Gives the browser `createWritable` on OPFS file handles, as every current browser but older Safari does. */
function browserCanWriteOpfs(can: boolean): void {
    if (can) {
        vi.stubGlobal('FileSystemFileHandle', class { createWritable() { } })
    } else {
        vi.stubGlobal('FileSystemFileHandle', undefined)
    }
}

/** Makes the page an OPFS-main profile whose copy back cannot take the exclusive lock, so it runs from OPFS. */
function fallBackToOpfs(): void {
    const root = new FakeOpfsRoot()
    root.files.set(hexName('database/database.bin'), new Uint8Array([1, 2, 3]))
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => root } })
    browserCanWriteOpfs(true)
    localStorage.setItem('opfs_flag!', 'able')
    h.acquire = async () => null
}
beforeEach(async () => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.forage.Init = async () => { }
    h.forage.realStorage = undefined
    h.acquire = async () => async () => { }
    h.acquireCalls = 0
    localStorage.clear()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {} })
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => new FakeOpfsRoot() } })
    vi.resetModules()
    pass = await import('src/ts/storage/bootArchivePass')
    app = await import('src/ts/storage/store/appStore')
})

afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'locks')
    Reflect.deleteProperty(navigator, 'storage')
    vi.restoreAllMocks()
})

describe('the web archive pass is gated on the page store, not on OPFS file writing', () => {
    test('regression reproducer: a page on the IndexedDB store archives in a browser that cannot write OPFS files', async () => {
        browserCanWriteOpfs(false)

        const session = await pass.openBootArchiveSession('web')

        expect(session.canArchive).toBe(true)
        expect(h.acquireCalls).toBe(1)
        await session.release()
    })

    test('regression reproducer: a page that fell back to the OPFS main store does not archive, even in a browser that can write OPFS files', async () => {
        fallBackToOpfs()
        await app.getAppStore()
        h.acquireCalls = 0

        const session = await pass.openBootArchiveSession('web')

        expect(session.canArchive).toBe(false)
        expect(h.acquireCalls).toBe(0)
    })

    test('guard: a page on the IndexedDB store archives in a browser that can write OPFS files', async () => {
        browserCanWriteOpfs(true)

        const session = await pass.openBootArchiveSession('web')

        expect(session.canArchive).toBe(true)
        await session.release()
    })

    test('guard: the Node server archives whatever the browser can write', async () => {
        h.platform.isNodeServer = true
        browserCanWriteOpfs(false)

        const session = await pass.openBootArchiveSession('web')

        expect(session.canArchive).toBe(true)
        await session.release()
    })

    test('guard: without Web Locks the page does not archive and takes no hold', async () => {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })

        const session = await pass.openBootArchiveSession('web')

        expect(session.canArchive).toBe(false)
        expect(h.acquireCalls).toBe(0)
    })
})

describe('the page store query', () => {
    test('new behaviour: it is true for the IndexedDB store and false for the OPFS fallback store', async () => {
        expect(await app.pageStoreIsIndexedDb()).toBe(true)

        vi.resetModules()
        app = await import('src/ts/storage/store/appStore')
        fallBackToOpfs()

        expect(await app.pageStoreIsIndexedDb()).toBe(false)
    })

    test('new behaviour: an injected store is not the IndexedDB store', async () => {
        const real = await app.getAppStore()
        app.injectAppStore({ ...real })

        expect(await app.pageStoreIsIndexedDb()).toBe(false)
    })
})
