// @vitest-environment node
/**
 * The IndexedDB adapter (`src/ts/storage/store/indexedDbStore.ts`) against
 * `fake-indexeddb`: the shared conformance scenarios, then the compatibility
 * guards for the database upstream already uses (LocalForage database `risuai`,
 * object store `keyvaluepairs`). `fake-indexeddb/auto` is imported here and only
 * here, before LocalForage is first evaluated, because LocalForage captures
 * `indexedDB` once when its module loads. A pass is no evidence about a real
 * browser's IndexedDB limits.
 *
 * Schema facts about the database (its version and object stores) never come
 * from a LocalForage instance in the same process as the adapter. LocalForage
 * keeps one registry per database name and re-aligns every instance of that name
 * to the version any instance opened, so such an instance would report whatever
 * the adapter did. The schema guards read the database through a raw
 * `indexedDB.open` and compare against literals. Value-level guards may use the
 * `upstream` instance below: the bytes pass through IndexedDB, which is an honest
 * witness.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StoreInvalidKeyError, StoreNotBinaryError } from 'src/ts/storage/store/errors'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'
import { describeByteStoreConformance } from './byteStoreConformance'

/** The instance upstream's own code creates: unpinned driver order, default store name. */
const upstream = localforage.createInstance({ name: 'risuai' })

let backendCallCount = 0

beforeEach(() => {
    const realOpen = IDBFactory.prototype.open
    vi.spyOn(IDBFactory.prototype, 'open').mockImplementation(function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
        backendCallCount++
        return realOpen.apply(this, args)
    })
    const realTransaction = IDBDatabase.prototype.transaction
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
        backendCallCount++
        return realTransaction.apply(this, args)
    })
})

afterEach(() => {
    vi.restoreAllMocks()
})

describeByteStoreConformance({
    name: 'IndexedDB',
    conditionalWrites: false,
    async create() {
        await upstream.clear()
        return createIndexedDbStore()
    },
    async plant(key, bytes) {
        await upstream.setItem(key, bytes)
    },
    async peek(key) {
        const value = await upstream.getItem<Uint8Array>(key)
        return value === null ? null : new Uint8Array(value)
    },
    backendCalls: () => backendCallCount,
    offersBlobs: true,
    invalidEverywhere: [''],
    invalidPrefixes: [''],
    writeOnlyInvalid: [],
    oddKeys: ['assets/x.v2\\smile', 'assets/.hidden'],
    failDeleteOf(key) {
        const realDelete = IDBObjectStore.prototype.delete
        const spy = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
            if (query === key) {
                throw new DOMException('delete refused', 'DataError')
            }
            return realDelete.call(this, query)
        })
        return () => spy.mockRestore()
    },
})

interface DatabaseShape {
    version: number
    objectStores: string[]
}

/** The version and object stores of the `risuai` database as a plain connection without a version sees them. */
async function shapeOfDatabase(): Promise<DatabaseShape> {
    return await new Promise((resolve, reject) => {
        const request = indexedDB.open('risuai')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
            const database = request.result
            const shape = { version: database.version, objectStores: Array.from(database.objectStoreNames).sort() }
            database.close()
            resolve(shape)
        }
    })
}

/** Deletes the `risuai` database the way a browser profile that never ran the app has none. */
async function dropDatabase(): Promise<void> {
    await upstream.dropInstance({ name: 'risuai' })
}

/**
 * Creates the `risuai` database at exactly `version` with the object stores in
 * `stores`, seeds `database/database.bin` into `keyvaluepairs`, and closes the
 * connection, as a profile left by an earlier app run would be.
 */
async function createRawProfile(version: number, stores: string[], seed: Uint8Array): Promise<void> {
    await dropDatabase()
    await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('risuai', version)
        request.onerror = () => reject(request.error)
        request.onupgradeneeded = () => {
            for (const name of stores) {
                request.result.createObjectStore(name)
            }
            request.transaction.objectStore('keyvaluepairs').put(seed, 'database/database.bin')
        }
        request.onsuccess = () => {
            request.result.close()
            resolve()
        }
    })
}

/** What LocalForage 1.10.0 creates on a profile that has no `risuai` database: the value store and its Blob-support probe store, at version 2. */
const LOCALFORAGE_1_10_FRESH_SHAPE: DatabaseShape = {
    version: 2,
    objectStores: ['keyvaluepairs', 'local-forage-detect-blob-support'],
}

describe('IndexedDB store', () => {
    describe('values upstream stored under a key read back byte for byte', () => {
        test('a Uint8Array', async () => {
            await upstream.clear()
            await upstream.setItem('assets/plain', Uint8Array.from([1, 2, 3]))

            expect(Array.from((await createIndexedDbStore().read('assets/plain')).bytes)).toEqual([1, 2, 3])
        })

        test('a view with a byte offset over a larger buffer', async () => {
            await upstream.clear()
            const larger = Uint8Array.from({ length: 100 }, (_, index) => index)
            await upstream.setItem('assets/view', larger.subarray(10, 15))

            const { bytes } = await createIndexedDbStore().read('assets/view')

            expect(Array.from(bytes)).toEqual([10, 11, 12, 13, 14])
            expect(bytes.byteOffset).toBe(0)
            expect(bytes.buffer.byteLength).toBe(5)
        })

        test('an ArrayBuffer', async () => {
            await upstream.clear()
            await upstream.setItem('assets/buffer', Uint8Array.from([9, 8, 7]).buffer)

            expect(Array.from((await createIndexedDbStore().read('assets/buffer')).bytes)).toEqual([9, 8, 7])
        })

        test('a Blob', async () => {
            await upstream.clear()
            await upstream.setItem('assets/blob', new Blob([Uint8Array.from([5, 4, 3, 2])]))

            expect(Array.from((await createIndexedDbStore().read('assets/blob')).bytes)).toEqual([5, 4, 3, 2])
        })

        test('a zero-length Uint8Array reads as a zero-length array, not as absent', async () => {
            await upstream.clear()
            await upstream.setItem('assets/empty', new Uint8Array(0))
            const store = createIndexedDbStore()

            const { bytes } = await store.read('assets/empty')

            expect(bytes).not.toBeNull()
            expect(bytes.byteLength).toBe(0)
            expect(await store.has('assets/empty')).toBe(true)
        })
    })

    describe('entries that are not bytes', () => {
        test('a stored boolean rejects as not binary on read, but is held and listed', async () => {
            await upstream.clear()
            await upstream.setItem('migrated', true)
            const store = createIndexedDbStore()

            await expect(store.read('migrated')).rejects.toBeInstanceOf(StoreNotBinaryError)
            expect(await store.has('migrated')).toBe(true)
            expect(await store.list('migr')).toEqual(['migrated'])
        })

        test('no prefix the app uses lists a stored boolean', async () => {
            await upstream.clear()
            await upstream.setItem('migrated', true)
            await upstream.setItem('denied_opfs', true)
            const store = createIndexedDbStore()

            for (const prefix of ['database/', 'assets/', 'remotes/', 'coldstorage/']) {
                expect(await store.list(prefix), prefix).toEqual([])
            }
        })

        test('an entry stored as null or undefined is held and listed, and rejects as not binary on read', async () => {
            await upstream.clear()
            await upstream.setItem('assets/nothing', null)
            const store = createIndexedDbStore()

            expect(await upstream.getItem('assets/nothing')).toBeNull()
            expect(await store.has('assets/nothing')).toBe(true)
            expect(await store.list('assets/')).toEqual(['assets/nothing'])
            await expect(store.read('assets/nothing')).rejects.toBeInstanceOf(StoreNotBinaryError)
        })

        test('a plain write replaces a non-binary entry', async () => {
            await upstream.clear()
            await upstream.setItem('assets/flag', true)
            const store = createIndexedDbStore()

            await store.write('assets/flag', Uint8Array.from([1]), 'unconditional')

            expect(Array.from((await store.read('assets/flag')).bytes)).toEqual([1])
        })
    })

    describe('values the adapter writes read back through upstream\'s own LocalForage', () => {
        test('as a Uint8Array of exactly the value', async () => {
            await upstream.clear()
            await createIndexedDbStore().write('assets/out', Uint8Array.from([3, 1, 4, 1, 5]), 'unconditional')

            const stored = await upstream.getItem<Uint8Array>('assets/out')

            expect(stored).toBeInstanceOf(Uint8Array)
            expect(Array.from(stored)).toEqual([3, 1, 4, 1, 5])
            expect(stored.byteOffset).toBe(0)
            expect(stored.buffer.byteLength).toBe(5)
        })

        test('a view over a larger buffer is stored with only its own bytes', async () => {
            await upstream.clear()
            const larger = Uint8Array.from({ length: 1000 }, (_, index) => index % 251)

            await createIndexedDbStore().write('assets/view-out', larger.subarray(10, 15), 'unconditional')

            const stored = await upstream.getItem<Uint8Array>('assets/view-out')
            expect(Array.from(stored)).toEqual([10, 11, 12, 13, 14])
            expect(stored.buffer.byteLength).toBe(5)
        })
    })

    describe('the database', () => {
        // The expected shapes below are literals for localforage 1.10.0 on
        // fake-indexeddb. A library upgrade that changes what LocalForage creates
        // fails the pin test first, which says the literals must be re-derived.
        test('pin: a plain LocalForage creates version 2 with its value store and Blob-support probe store on a profile with no database', async () => {
            await dropDatabase()
            await localforage.createInstance({ name: 'risuai' }).setItem('x', Uint8Array.from([1]))

            expect(await shapeOfDatabase()).toEqual(LOCALFORAGE_1_10_FRESH_SHAPE)
        })

        test('on a profile with no database the adapter creates exactly the object stores and version LocalForage creates', async () => {
            await dropDatabase()
            await createIndexedDbStore().write('x', Uint8Array.from([1]), 'unconditional')

            expect(await shapeOfDatabase()).toEqual(LOCALFORAGE_1_10_FRESH_SHAPE)
        })

        test.each([
            ['version 7 with an unrelated extra store', 7, ['keyvaluepairs', 'unrelated-extra']],
            ['version 2 with the stores LocalForage creates', 2, ['keyvaluepairs', 'local-forage-detect-blob-support']],
        ])('an existing profile at %s keeps its version and object stores through every operation', async (_label, version, stores) => {
            const seed = Uint8Array.from([7, 7, 7])
            await createRawProfile(version, stores, seed)
            const before = await shapeOfDatabase()
            expect(before).toEqual({ version, objectStores: [...stores].sort() })

            const store = createIndexedDbStore()
            expect(Array.from((await store.read('database/database.bin')).bytes)).toEqual([7, 7, 7])
            expect(await store.has('database/database.bin')).toBe(true)
            expect(await store.list('database/')).toEqual(['database/database.bin'])
            await store.write('database/other', Uint8Array.from([2]), 'unconditional')
            await store.delete('database/other', 'unconditional')

            expect(await shapeOfDatabase()).toEqual(before)
            await dropDatabase()
        })

        test('creating a store opens nothing until the first operation', async () => {
            const before = backendCallCount

            const store = createIndexedDbStore()
            expect(backendCallCount).toBe(before)

            await store.has('anything')
            expect(backendCallCount).toBeGreaterThan(before)
        })
    })

    describe('a Blob under an inlay body key', () => {
        const BODY = 'inlays/b-clip.0123456789abcdef'

        test('IndexedDB holds a genuine Blob, which upstream\'s own LocalForage also reads', async () => {
            await upstream.clear()
            const store = createIndexedDbStore()
            await store.writeBlob!(BODY, new Blob([Uint8Array.from([1, 2, 3, 4])], { type: 'audio/mpeg' }), 'unconditional')

            const stored = await upstream.getItem<Blob>(BODY)
            expect(Object.prototype.toString.call(stored)).toBe('[object Blob]')
            expect(stored.type).toBe('audio/mpeg')
            expect(Array.from(new Uint8Array(await stored.arrayBuffer()))).toEqual([1, 2, 3, 4])
        })

        test('a File is stored as a plain Blob of the same bytes and type, so read returns its bytes', async () => {
            await upstream.clear()
            const store = createIndexedDbStore()
            await store.writeBlob!(BODY, new File([Uint8Array.from([5, 6, 7])], 'clip.mp4', { type: 'video/mp4' }), 'unconditional')

            expect(Array.from((await store.read(BODY)).bytes)).toEqual([5, 6, 7])
            const blob = await store.readBlob!(BODY)
            expect(Object.prototype.toString.call(blob)).toBe('[object Blob]')
            expect(blob.type).toBe('video/mp4')
        })

        test('a value that is not a Blob is refused and nothing is written', async () => {
            await upstream.clear()
            const store = createIndexedDbStore()

            await expect(store.writeBlob!(BODY, Uint8Array.from([1]) as unknown as Blob, 'unconditional')).rejects.toBeInstanceOf(TypeError)
            expect(await store.has(BODY)).toBe(false)
        })

        test('an entry in LocalForage\'s encoded form is not a Blob to readBlob, and read still returns its bytes', async () => {
            await upstream.clear()
            const store = createIndexedDbStore()
            await upstream.setItem(BODY, { __local_forage_encoded_blob: true, data: 'AQID', type: 'audio/mpeg' })

            expect(await store.readBlob!(BODY)).toBeNull()
            expect(Array.from((await store.read(BODY)).bytes)).toEqual([1, 2, 3])
        })

        test('readBlob creates nothing when the database does not exist', async () => {
            await dropDatabase()

            expect(await createIndexedDbStore().readBlob!(BODY)).toBeNull()
            expect((await indexedDB.databases()).map((entry) => entry.name)).not.toContain('risuai')
        })
    })

    describe('keys', () => {
        test('a lone surrogate in a key is addressable but cannot be created', async () => {
            await upstream.clear()
            const store = createIndexedDbStore()

            expect((await store.read('a\uD800b')).bytes).toBeNull()
            await expect(store.write('a\uD800b', Uint8Array.from([1]), 'unconditional')).rejects.toBeInstanceOf(StoreInvalidKeyError)
        })
    })
})
