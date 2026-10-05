/**
 * The page's web store selection with an OPFS-main profile
 * (`src/ts/storage/store/appStore.ts` over `opfsCopyBack.ts`): a profile whose
 * flag and files say OPFS is copied back and the page gets the IndexedDB store;
 * a copy that cannot run leaves a page on a transitional OPFS store with a
 * notice; a page whose reload is under way gets no store at all; and the OPFS
 * leftovers of a copy back are deleted at a later start, not at the start that
 * copied. The decision rules themselves are in `opfsCopyBack.test.ts`.
 *
 * Runs over `fake-indexeddb`, an in-memory OPFS root and a simulated tab on a
 * fake Web Locks manager; a pass here says nothing about a real browser.
 * `fake-indexeddb/auto` is imported first because LocalForage captures
 * `indexedDB` once when it loads.
 *
 * Every test is labelled in its title: "new behaviour" asserts what only the
 * copy back does; "guard" holds before and after.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { COPYBACK_CLEANUP_KEY, OPFS_FLAG_KEY } from 'src/ts/storage/opfsCopyBack'
import { FakeLockManagerCore, makeSimulatedTab } from './fakeWebLocks'
import { FakeOpfsRoot, hexName } from './fakeOpfsRoot'

const MAIN = 'database/database.bin'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    forage: { Init: async (): Promise<void> => { }, realStorage: undefined as unknown },
    acquire: (async () => async () => { }) as () => Promise<(() => Promise<void>) | null>,
    reloadPending: false,
    alerts: [] as { type: string, msg: string }[],
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    get forageStorage() { return h.forage },
    acquireExclusiveStorageMigrationLock: () => h.acquire(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/reloadGuard'), () => ({
    isAppInitiatedReload: () => h.reloadPending,
}) as unknown as typeof import('src/ts/reloadGuard'))

vi.mock('src/lang', () => ({
    language: {
        setNodePassword: 'set password',
        inputNodePassword: 'input password',
        opfsCopyBackProgress: (done: number, total: number) => `copying ${done}/${total}`,
    },
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
    alertStore: { set: (value: { type: string, msg: string }) => { h.alerts.push(value) } },
}))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

type AppStoreModule = typeof import('src/ts/storage/store/appStore')

let app: AppStoreModule
let root: FakeOpfsRoot

/** The `risuai` LocalForage database the IndexedDB store and upstream's own code share. */
const profile = localforage.createInstance({ name: 'risuai' })

function bytes(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

function seedOpfsMain(): void {
    root.put(hexName(MAIN), bytes(9, 9, 9))
    root.put(hexName('database/dbbackup-5.bin'), bytes(5))
    localStorage.setItem(OPFS_FLAG_KEY, 'able')
}

async function freshModule(): Promise<void> {
    vi.resetModules()
    app = await import('src/ts/storage/store/appStore')
}

beforeEach(async () => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.forage.Init = async () => { }
    h.forage.realStorage = undefined
    h.acquire = async () => async () => { }
    h.reloadPending = false
    h.alerts.length = 0
    root = new FakeOpfsRoot()
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: async () => root } })
    vi.stubGlobal('FileSystemFileHandle', class { createWritable() { } })
    localStorage.clear()
    await profile.clear()
    await freshModule()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'storage')
    vi.restoreAllMocks()
})

describe('an OPFS-main profile at startup', () => {
    test('new behaviour: the page gets the IndexedDB store holding the copied files, the flag is gone, nothing is written to OPFS, and no wait alert stays open', async () => {
        seedOpfsMain()
        await profile.setItem('migrated', true)
        await profile.setItem(MAIN, bytes(1))
        const before = new Map(root.files)
        const tab = makeSimulatedTab(new FakeLockManagerCore(), 'page')
        tab.locks.recordStorageEpoch()
        h.acquire = () => tab.locks.acquireExclusiveStorageMigrationLock(2000)

        const store = await app.getAppStore()
        const read = await app.readMainFile()

        expect(Array.from(read.bytes ?? [])).toEqual([9, 9, 9])
        expect(await app.pageStoreIsIndexedDb()).toBe(true)
        expect(Array.from((await store.read('database/dbbackup-5.bin')).bytes ?? [])).toEqual([5])
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBeNull()
        expect(root.files).toEqual(before)
        expect(app.takeStorageFallbackNotice()).toBeNull()
        expect(h.alerts.length).toBeGreaterThan(0)
        expect(h.alerts.at(-1)?.type).toBe('none')
    })

    test('new behaviour (replaces the OPFS main store selection): a copy that cannot take the lock leaves the page on OPFS with a notice, reading and writing OPFS only, and IndexedDB untouched', async () => {
        seedOpfsMain()
        await profile.setItem('migrated', true)
        await profile.setItem(MAIN, bytes(1))
        await profile.setItem('database/dbbackup-1.bin', bytes(1))
        h.acquire = async () => null

        const store = await app.getAppStore()
        expect(await app.pageStoreIsIndexedDb()).toBe(false)
        expect(await app.getAppStoreKind()).toBe('opfs-transitional')
        expect(app.takeStorageFallbackNotice()).toEqual({ reason: 'tab' })
        expect(app.takeStorageFallbackNotice()).toBeNull()
        const idbRead = vi.spyOn(IDBObjectStore.prototype, 'get')
        const idbWrite = vi.spyOn(IDBObjectStore.prototype, 'put')

        const read = await app.readMainFile()
        await app.writeMainFile(bytes(2, 2))
        await store.write('database/dbbackup-6.bin', bytes(6), 'unconditional')
        const backups = await store.list('database/dbbackup-')

        expect(Array.from(read.bytes ?? [])).toEqual([9, 9, 9])
        expect(Array.from(root.files.get(hexName(MAIN)) ?? [])).toEqual([2, 2])
        expect(backups.sort()).toEqual(['database/dbbackup-5.bin', 'database/dbbackup-6.bin'])
        expect(idbRead).not.toHaveBeenCalled()
        expect(idbWrite).not.toHaveBeenCalled()
        expect(Array.from((await profile.getItem<Uint8Array>(MAIN)) ?? [])).toEqual([1])
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })

    test('new behaviour: a page whose reload is already under way gets no store and reads and writes nothing', async () => {
        seedOpfsMain()
        h.acquire = async () => null
        h.reloadPending = true
        const idbWrite = vi.spyOn(IDBObjectStore.prototype, 'put')

        const outcome = await Promise.race([
            app.getAppStore().then(() => 'a store'),
            new Promise<string>((resolve) => setTimeout(() => resolve('no store'), 100)),
        ])

        expect(outcome).toBe('no store')
        expect(idbWrite).not.toHaveBeenCalled()
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })

    test('new behaviour: IndexedDB not supported by the browser: the page runs from OPFS with the no-IndexedDB notice', async () => {
        seedOpfsMain()
        vi.spyOn(localforage, 'supports').mockReturnValue(false)

        await app.getAppStore()

        expect(await app.pageStoreIsIndexedDb()).toBe(false)
        expect(app.takeStorageFallbackNotice()).toEqual({ reason: 'noIndexedDb' })
    })

    test('new behaviour: IndexedDB supported but not openable: the selection fails and the page never runs from OPFS', async () => {
        seedOpfsMain()
        const original = localforage.createInstance.bind(localforage)
        vi.spyOn(localforage, 'createInstance').mockImplementation((options) => {
            const instance = original(options)
            vi.spyOn(instance, 'ready').mockRejectedValue(new Error('open failed'))
            return instance
        })

        await expect(app.getAppStore()).rejects.toThrow('open failed')
        expect(app.takeStorageFallbackNotice()).toBeNull()
        expect(localStorage.getItem(OPFS_FLAG_KEY)).toBe('able')
    })

    test('new behaviour: the storage object\'s backend does not decide: with no flag the page gets the IndexedDB store even when the storage object holds an OPFS backend', async () => {
        const { OpfsStorage } = await import('src/ts/storage/opfsStorage')
        const opfs = new OpfsStorage()
        opfs.opfs = root as unknown as FileSystemDirectoryHandle
        h.forage.realStorage = opfs
        root.put(hexName(MAIN), bytes(9, 9))
        await profile.setItem(MAIN, bytes(3, 3, 3))

        const read = await app.readMainFile()

        expect(Array.from(read.bytes ?? [])).toEqual([3, 3, 3])
        expect(await app.pageStoreIsIndexedDb()).toBe(true)
    })

    test('guard: an injected store clears a pending notice and is not the IndexedDB store', async () => {
        seedOpfsMain()
        h.acquire = async () => null
        await app.getAppStore()

        app.injectAppStore({ capabilities: { conditionalWrites: false } } as unknown as Awaited<ReturnType<AppStoreModule['getAppStore']>>)

        expect(app.takeStorageFallbackNotice()).toBeNull()
        expect(await app.pageStoreIsIndexedDb()).toBe(false)
    })
})

describe('the clean-up of OPFS leftovers after a copy back', () => {
    test('new behaviour: the page that copied does not clean up; the next page, which loaded from IndexedDB, deletes the hex files and the marker', async () => {
        seedOpfsMain()
        const tab = makeSimulatedTab(new FakeLockManagerCore(), 'page')
        tab.locks.recordStorageEpoch()
        h.acquire = () => tab.locks.acquireExclusiveStorageMigrationLock(2000)
        await app.getAppStore()
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')

        await app.cleanUpCopiedBackOpfs()

        expect(root.files.size).toBe(2)
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')

        tab.close()
        await freshModule()
        await app.getAppStore()
        await app.cleanUpCopiedBackOpfs()

        expect(root.files.size).toBe(0)
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBeNull()
        expect(Array.from((await app.readMainFile()).bytes ?? [])).toEqual([9, 9, 9])
    })

    test('new behaviour: a page that fell back to OPFS, or runs on an injected store, never cleans up', async () => {
        root.put(hexName(MAIN), bytes(9))
        await profile.setItem(MAIN, bytes(9))
        await profile.setItem('migrated', true)
        localStorage.setItem(COPYBACK_CLEANUP_KEY, 'pending')
        localStorage.setItem(OPFS_FLAG_KEY, 'able')
        h.acquire = async () => null
        await app.getAppStore()

        await app.cleanUpCopiedBackOpfs()

        expect(root.files.has(hexName(MAIN))).toBe(true)
        expect(localStorage.getItem(COPYBACK_CLEANUP_KEY)).toBe('pending')
    })

    test('guard: with no marker pending a normal page leaves the OPFS root alone', async () => {
        root.put(hexName(MAIN), bytes(9))
        await profile.setItem(MAIN, bytes(9))
        await app.getAppStore()

        await app.cleanUpCopiedBackOpfs()

        expect(root.files.has(hexName(MAIN))).toBe(true)
    })
})
