// @vitest-environment node
/**
 * How the IndexedDB adapter (`src/ts/storage/store/indexedDbStore.ts`) settles
 * that one key holds no value: by a point lookup on its own connection, never by
 * enumerating every key, and never by creating or upgrading anything. Against
 * `fake-indexeddb`; a pass says nothing about a real browser's cost per miss.
 * `fake-indexeddb/auto` is imported before LocalForage is first evaluated, and
 * this file keeps its own module graph because one test upgrades the database
 * from a second connection.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { StoreNotBinaryError } from 'src/ts/storage/store/errors'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'

const upstream = localforage.createInstance({ name: 'risuai' })
const BYTES = Uint8Array.from([1, 2, 3])

/** Spies on every call that lists keys, however a driver spells it. */
function spyOnEnumeration() {
    return [
        vi.spyOn(IDBObjectStore.prototype, 'openKeyCursor'),
        vi.spyOn(IDBObjectStore.prototype, 'openCursor'),
        vi.spyOn(IDBObjectStore.prototype, 'getAllKeys'),
        vi.spyOn(IDBObjectStore.prototype, 'getAll'),
    ]
}

function enumerationCalls(spies: ReturnType<typeof spyOnEnumeration>): number {
    return spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)
}

/** Opens of the database that asked for no version: the adapter's own connection, not LocalForage's. */
function versionlessOpens(spy: { mock: { calls: unknown[][] } }): number {
    return spy.mock.calls.filter((call) => call.length === 1).length
}

async function databaseNames(): Promise<string[]> {
    return (await indexedDB.databases()).map((entry) => entry.name ?? '')
}

/** Makes the next `count` calls on an object store throw `error`; later calls run for real. */
function failCountTimes(times: number, error: DOMException) {
    const real = IDBObjectStore.prototype.count
    let remaining = times
    return vi.spyOn(IDBObjectStore.prototype, 'count').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['count']>) {
        if (remaining > 0) {
            remaining--
            throw error
        }
        return real.apply(this, args)
    })
}

beforeEach(async () => {
    await upstream.dropInstance({ name: 'risuai' })
    await upstream.setItem('seed', BYTES)
    for (let i = 0; i < 40; i++) {
        await upstream.setItem(`assets/${i}.png`, BYTES)
    }
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('IndexedDB read of a key that holds no value', () => {
    test('reproducer: an absent key resolves null without enumerating any key', async () => {
        const store = createIndexedDbStore()
        await store.read('assets/0.png')
        const spies = spyOnEnumeration()

        const result = await store.read('assets/absent.png')

        expect(result).toEqual({ bytes: null, version: null })
        expect(enumerationCalls(spies)).toBe(0)
    })

    test('reproducer: a stored null rejects as not binary, and no key is enumerated to find that out', async () => {
        await upstream.setItem('assets/nothing', null)
        const store = createIndexedDbStore()
        await store.read('assets/0.png')
        const spies = spyOnEnumeration()

        await expect(store.read('assets/nothing')).rejects.toBeInstanceOf(StoreNotBinaryError)

        expect(enumerationCalls(spies)).toBe(0)
    })

    test('guard: a present key still reads its bytes', async () => {
        const store = createIndexedDbStore()

        expect(Array.from((await store.read('assets/7.png')).bytes ?? [])).toEqual(Array.from(BYTES))
    })

    test('new behaviour: the connection is closed when another connection upgrades the database, so the upgrade is not blocked', async () => {
        const store = createIndexedDbStore()
        await store.read('assets/absent.png')
        const version = await new Promise<number>((resolve, reject) => {
            const probe = indexedDB.open('risuai')
            probe.onerror = () => reject(probe.error)
            probe.onsuccess = () => {
                const current = probe.result.version
                probe.result.close()
                resolve(current)
            }
        })

        let blocked = false
        const upgraded = await Promise.race([
            new Promise<boolean>((resolve, reject) => {
                const request = indexedDB.open('risuai', version + 1)
                request.onblocked = () => { blocked = true }
                request.onerror = () => reject(request.error)
                request.onsuccess = () => {
                    request.result.close()
                    resolve(true)
                }
            }),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
        ])

        expect(upgraded).toBe(true)
        expect(blocked).toBe(false)
    })

    test('reproducer: after the connection was closed by an upgrade the next absent key is still settled without enumerating', async () => {
        const store = createIndexedDbStore()
        await store.read('assets/absent.png')
        await new Promise<void>((resolve, reject) => {
            const upgrade = indexedDB.open('risuai', 50)
            upgrade.onerror = () => reject(upgrade.error)
            upgrade.onsuccess = () => {
                upgrade.result.close()
                resolve()
            }
        })
        const spies = spyOnEnumeration()

        expect((await store.read('assets/other-absent.png')).bytes).toBeNull()
        expect(enumerationCalls(spies)).toBe(0)
    })

    test('reproducer: a connection the browser closed is replaced once, and the lookup still avoids a listing', async () => {
        const store = createIndexedDbStore()
        await store.read('assets/0.png')
        const open = vi.spyOn(IDBFactory.prototype, 'open')
        const spies = spyOnEnumeration()
        failCountTimes(1, new DOMException('closed', 'InvalidStateError'))

        expect((await store.read('assets/absent.png')).bytes).toBeNull()

        expect(versionlessOpens(open)).toBe(2)
        expect(enumerationCalls(spies)).toBe(0)
    })

    test('reproducer: a connection that keeps failing with InvalidStateError is reopened once, then the key list decides', async () => {
        await upstream.setItem('assets/nothing', null)
        const store = createIndexedDbStore()
        await store.read('assets/0.png')
        const open = vi.spyOn(IDBFactory.prototype, 'open')
        failCountTimes(Infinity, new DOMException('closed', 'InvalidStateError'))

        await expect(store.read('assets/nothing')).rejects.toBeInstanceOf(StoreNotBinaryError)
        expect((await store.read('assets/absent.png')).bytes).toBeNull()

        // Two reads, each with one open and one reopen.
        expect(versionlessOpens(open)).toBe(4)
    })

    test('new behaviour: any other failure of the lookup falls back to the key list and is never read as absent', async () => {
        await upstream.setItem('assets/nothing', null)
        const store = createIndexedDbStore()
        await store.read('assets/0.png')
        failCountTimes(Infinity, new DOMException('denied', 'NotAllowedError'))
        const spies = spyOnEnumeration()

        await expect(store.read('assets/nothing')).rejects.toBeInstanceOf(StoreNotBinaryError)
        expect((await store.read('assets/absent.png')).bytes).toBeNull()

        expect(enumerationCalls(spies)).toBeGreaterThan(0)
    })

    test('new behaviour: when the database does not exist the lookup creates nothing and the key list answers', async () => {
        const instance = { getItem: vi.fn(async () => null), keys: vi.fn(async (): Promise<string[]> => []) }
        vi.spyOn(localforage, 'createInstance').mockReturnValue(instance as unknown as LocalForage)
        await upstream.dropInstance({ name: 'risuai' })
        expect(await databaseNames()).not.toContain('risuai')
        const store = createIndexedDbStore()

        const result = await store.read('assets/absent.png')

        expect(result.bytes).toBeNull()
        expect(instance.keys).toHaveBeenCalledTimes(1)
        expect(await databaseNames()).not.toContain('risuai')
    })

    test('new behaviour: when the object store is missing the lookup adds nothing and the key list answers', async () => {
        await upstream.dropInstance({ name: 'risuai' })
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('risuai', 1)
            request.onupgradeneeded = () => { request.result.createObjectStore('elsewhere') }
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                request.result.close()
                resolve()
            }
        })
        const instance = { getItem: vi.fn(async () => null), keys: vi.fn(async (): Promise<string[]> => []) }
        vi.spyOn(localforage, 'createInstance').mockReturnValue(instance as unknown as LocalForage)
        const store = createIndexedDbStore()

        expect((await store.read('assets/absent.png')).bytes).toBeNull()

        expect(instance.keys).toHaveBeenCalledTimes(1)
        const shape = await new Promise<{ version: number, stores: string[] }>((resolve, reject) => {
            const request = indexedDB.open('risuai')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
                const database = request.result
                const result = { version: database.version, stores: Array.from(database.objectStoreNames) }
                database.close()
                resolve(result)
            }
        })
        expect(shape).toEqual({ version: 1, stores: ['elsewhere'] })
    })

    test('guard: the adapter offers no URL for a key, so a caller reads the bytes', () => {
        expect(createIndexedDbStore().urlFor).toBeUndefined()
    })
})
