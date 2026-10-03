// @vitest-environment node
/**
 * The page's byte store and the main file's version cell
 * (`src/ts/storage/store/appStore.ts`): which store each platform gets, that an
 * OPFS-main profile never reads or writes the IndexedDB copy of its keys, that a
 * browser without usable IndexedDB gets no store and nothing is written, and
 * that on the Node server every main-file write is conditional on the version
 * this page last read or wrote.
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
import { FakeOpfsRoot, hexName } from './fakeOpfsRoot'

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
/** The conflict class of the module graph `app` was loaded in: each test loads a fresh graph. */
let StoreVersionConflictError: typeof import('src/ts/storage/store/errors').StoreVersionConflictError
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
    StoreVersionConflictError = (await import('src/ts/storage/store/errors')).StoreVersionConflictError
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('the store each platform gets', () => {
    test('Tauri: the desktop files store; the main file is read, then replaced without a condition', async () => {
        platform('tauri')
        fakeFs.plant(MAIN, bytes(1, 2, 3))

        const store = await app.getAppStore()
        const read = await app.readMainFile()
        await app.writeMainFile(bytes(4, 5))

        expect(store.capabilities.conditionalWrites).toBe(false)
        expect(Array.from(read.bytes ?? [])).toEqual([1, 2, 3])
        expect(read.version).toBeNull()
        expect(Array.from(fakeFs.files.get(MAIN) ?? [])).toEqual([4, 5])
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

    test('OPFS main store: the main file and the backups are read and written in OPFS and the IndexedDB copy is never touched', async () => {
        const { OpfsStorage } = await import('src/ts/storage/opfsStorage')
        const root = new FakeOpfsRoot()
        const opfs = new OpfsStorage()
        opfs.opfs = root as unknown as FileSystemDirectoryHandle
        h.forage.realStorage = opfs
        root.files.set(hexName(MAIN), bytes(9, 9))
        root.files.set(hexName('database/dbbackup-5.bin'), bytes(5))
        // The stale copy that stays in IndexedDB after a profile moved to OPFS.
        await profile.clear()
        await profile.setItem(MAIN, bytes(1))
        await profile.setItem('database/dbbackup-1.bin', bytes(1))
        const idbRead = vi.spyOn(IDBObjectStore.prototype, 'get')
        const idbWrite = vi.spyOn(IDBObjectStore.prototype, 'put')

        const read = await app.readMainFile()
        await app.writeMainFile(bytes(2, 2))
        const store = await app.getAppStore()
        await store.write('database/dbbackup-6.bin', bytes(6), 'unconditional')
        const backups = await store.list('database/dbbackup-')

        expect(Array.from(read.bytes ?? [])).toEqual([9, 9])
        expect(Array.from(root.files.get(hexName(MAIN)) ?? [])).toEqual([2, 2])
        expect(backups.sort()).toEqual(['database/dbbackup-5.bin', 'database/dbbackup-6.bin'])
        expect(idbRead).not.toHaveBeenCalled()
        expect(idbWrite).not.toHaveBeenCalled()
        expect(Array.from((await profile.getItem<Uint8Array>(MAIN)) ?? [])).toEqual([1])
        expect(Array.from((await profile.getItem<Uint8Array>('database/dbbackup-1.bin')) ?? [])).toEqual([1])
    })

    test('IndexedDB: the pinned IndexedDB store over the database upstream already uses', async () => {
        await profile.clear()
        await profile.setItem(MAIN, bytes(3, 3, 3))

        const store = await app.getAppStore()
        const read = await app.readMainFile()
        await app.writeMainFile(bytes(4))

        expect(store.capabilities.conditionalWrites).toBe(false)
        expect(Array.from(read.bytes ?? [])).toEqual([3, 3, 3])
        expect(Array.from((await profile.getItem<Uint8Array>(MAIN)) ?? [])).toEqual([4])
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

    test('a write with no version is refused and sends nothing: a conditional store never gets an unconditional main-file write', async () => {
        server.seed(MAIN, bytes(1))

        await expect(app.writeMainFile(bytes(2))).rejects.toBeDefined()

        expect(server.requestsTo('/api/write')).toHaveLength(0)
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([1])
    })

    test('a write presents the version of the last read, and each successful write advances it', async () => {
        server.seed(MAIN, bytes(1))
        const read = await app.readMainFile()

        await app.writeMainFile(bytes(2))
        await app.writeMainFile(bytes(3))

        const writes = server.requestsTo('/api/write')
        expect(writes.map((request) => request.headers['if-match-revision'])).toEqual([String(read.version), String((read.version ?? 0) + 1)])
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([3])
    })

    test('an absent main file reads at its create version and takes the seed once', async () => {
        const read = await app.readMainFile()
        await app.writeMainFile(bytes(1))

        expect(read.bytes).toBeNull()
        expect(read.version).toBe(0)
        expect(server.requestsTo('/api/write')[0].headers['if-match-revision']).toBe('0')
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([1])
    })

    test('a zero-length main file is a value, distinct from an absent one', async () => {
        server.seed(MAIN, new Uint8Array(0))

        const read = await app.readMainFile()

        expect(read.bytes).not.toBeNull()
        expect(read.bytes?.length).toBe(0)
    })

    test('another writer\'s save refuses the next write with the store\'s conflict, and the refusal does not move the version: only a fresh read does', async () => {
        server.seed(MAIN, bytes(1))
        await app.readMainFile()
        server.peerWrite(MAIN, bytes(9))

        await expect(app.writeMainFile(bytes(2))).rejects.toBeInstanceOf(StoreVersionConflictError)
        await expect(app.writeMainFile(bytes(2))).rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([9])

        await app.readMainFile()
        await app.writeMainFile(bytes(2))
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([2])
    })

    test('a read made through the store itself, as the manual clean-up makes it, leaves the version alone', async () => {
        server.seed(MAIN, bytes(1))
        await app.readMainFile()
        server.peerWrite(MAIN, bytes(9))

        const store = await app.getAppStore()
        const peeked = await store.read(MAIN)

        expect(Array.from(peeked.bytes ?? [])).toEqual([9])
        await expect(app.writeMainFile(bytes(2))).rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([9])
    })

    test('after a refused commit the re-read\'s version is the one the next write presents: no spurious conflict, and a later peer save is still caught', async () => {
        server.seed(MAIN, bytes(1))
        await app.readMainFile()
        server.peerWrite(MAIN, bytes(5))
        await expect(app.writeMainFile(bytes(2))).rejects.toBeInstanceOf(StoreVersionConflictError)

        const reread = await app.readMainFile()
        expect(Array.from(reread.bytes ?? [])).toEqual([5])
        await app.writeMainFile(bytes(6))
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([6])

        server.peerWrite(MAIN, bytes(8))
        await expect(app.writeMainFile(bytes(7))).rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([8])
    })

    test('two first-launch pages: the second page\'s seed is refused', async () => {
        const first = await app.readMainFile()
        const second = await app.readMainFile()
        expect(first.version).toBe(0)
        expect(second.version).toBe(0)
        server.peerWrite(MAIN, bytes(1))

        await expect(app.writeMainFile(bytes(2))).rejects.toBeInstanceOf(StoreVersionConflictError)
        expect(Array.from(server.files.get(MAIN)?.bytes ?? [])).toEqual([1])
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
        await expect(app.writeMainFile(bytes(2))).rejects.toBeInstanceOf(app.AppStoreUnavailableError)

        expect(idbWrite).not.toHaveBeenCalled()
    })

})
