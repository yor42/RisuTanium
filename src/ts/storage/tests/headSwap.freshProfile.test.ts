// @vitest-environment node
/**
 * The IndexedDB head swap on a profile whose `risuai` database does not exist
 * yet. Nothing here creates the database before the case under test: it must
 * read as an absent head, must not be created by the swap, and an open that
 * truly fails must still reject. Runs against `fake-indexeddb`;
 * `fake-indexeddb/auto` is imported before LocalForage is first evaluated
 * because LocalForage captures `indexedDB` when it loads.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HEAD_KEY } from 'src/ts/storage/blockKeys'
import { BlockStoreReadError } from 'src/ts/storage/blockStore'
import { encodeHead } from 'src/ts/storage/headSwap'
import { createIndexedDbHeadSwap, createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'
import { StoreError } from 'src/ts/storage/store/errors'
import { makeOwner, makeSet } from './blockStoreHarness'

const A = encodeHead({ current: '000000000001-0000000a' })

function dropDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('risuai')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
    })
}

async function databaseNames(): Promise<string[]> {
    return (await indexedDB.databases()).map((info) => info.name ?? '')
}

async function schemaOfDatabase(): Promise<{ version: number, stores: string[] }> {
    return await new Promise((resolve, reject) => {
        const request = indexedDB.open('risuai')
        request.onsuccess = () => {
            const schema = { version: request.result.version, stores: Array.from(request.result.objectStoreNames).sort() }
            request.result.close()
            resolve(schema)
        }
        request.onerror = () => reject(request.error)
    })
}

beforeEach(async () => {
    await dropDatabase()
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('a profile without the risuai database', () => {
    test('reads an absent head and creates nothing', async () => {
        const swap = createIndexedDbHeadSwap()
        expect(await swap.read()).toEqual({ bytes: null, version: null })
        expect(await databaseNames()).toEqual([])
    })

    test('a swap rejects as an unknown outcome and creates no database', async () => {
        const swap = createIndexedDbHeadSwap()
        await expect(swap.swap({ bytes: null, version: null }, A)).rejects.toBeInstanceOf(StoreError)
        expect(await databaseNames()).toEqual([])
    })

    test('a database that exists without the object store also reads as an absent head and is left as it is', async () => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.open('risuai', 1)
            request.onupgradeneeded = () => { request.result.createObjectStore('somethingElse') }
            request.onsuccess = () => { request.result.close(); resolve() }
            request.onerror = () => reject(request.error)
        })
        const swap = createIndexedDbHeadSwap()
        expect(await swap.read()).toEqual({ bytes: null, version: null })
        const names = await new Promise<string[]>((resolve, reject) => {
            const request = indexedDB.open('risuai')
            request.onsuccess = () => {
                const found = Array.from(request.result.objectStoreNames)
                request.result.close()
                resolve(found)
            }
            request.onerror = () => reject(request.error)
        })
        expect(names).toEqual(['somethingElse'])
    })

    test('a head read picks up the database once LocalForage has created it', async () => {
        const swap = createIndexedDbHeadSwap()
        expect((await swap.read()).bytes).toBeNull()
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem('unrelated', new Uint8Array([1]))
        expect(await swap.read()).toEqual({ bytes: null, version: null })
        expect(await swap.swap(await swap.read(), A)).toBe('won')
        expect((await swap.read()).bytes).toEqual(A)
    })

    test('an open that throws rejects the read and the swap instead of reading as absent', async () => {
        vi.spyOn(indexedDB, 'open').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError')
        })
        const swap = createIndexedDbHeadSwap()
        await expect(swap.read()).rejects.toBeInstanceOf(StoreError)
        await expect(swap.swap({ bytes: null, version: null }, A)).rejects.toBeInstanceOf(StoreError)
    })

    test('an open that fails with an error event rejects the read instead of reading as absent', async () => {
        vi.spyOn(indexedDB, 'open').mockImplementation(() => {
            const request: Partial<IDBOpenDBRequest> = {}
            setTimeout(() => {
                const handler = request.onerror
                handler?.call(request as IDBOpenDBRequest, new Event('error'))
            }, 0)
            return request as IDBOpenDBRequest
        })
        await expect(createIndexedDbHeadSwap().read()).rejects.toBeInstanceOf(StoreError)
    })

    test('the owner finds no head', async () => {
        const { owner } = makeOwner(createIndexedDbStore(), { headSwap: createIndexedDbHeadSwap() })
        expect((await owner.load()).kind).toBe('no-head')
        expect(owner.isLive()).toBe(false)
    })

    test('seeding an empty profile works end to end and leaves exactly the schema LocalForage creates', async () => {
        const store = createIndexedDbStore()
        const { owner } = makeOwner(store, { headSwap: createIndexedDbHeadSwap() })
        const seeded = await owner.seedEmptyProfile(makeSet({ characters: [{ chaId: 'alice' }] }))
        expect(seeded).toMatchObject({ kind: 'replaced', result: { kind: 'won' } })

        const reader = makeOwner(createIndexedDbStore(), { headSwap: createIndexedDbHeadSwap() })
        const loaded = await reader.owner.load()
        expect(loaded.kind === 'loaded' && loaded.loaded.directory.includes('alice')).toBe(true)

        const schema = await schemaOfDatabase()
        await dropDatabase()
        await localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB }).setItem('unrelated', new Uint8Array([1]))
        expect(schema).toEqual(await schemaOfDatabase())
        expect(schema.stores).toContain('keyvaluepairs')
    })

    test('an owner whose open keeps failing reports a read error, not no-head', async () => {
        vi.spyOn(indexedDB, 'open').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError')
        })
        const { owner } = makeOwner(createIndexedDbStore(), { headSwap: createIndexedDbHeadSwap() })
        await expect(owner.load()).rejects.toBeInstanceOf(BlockStoreReadError)
    })
})

describe('a head that is not binary data on IndexedDB', () => {
    test('is bad-head damage, not a permanent read error, and blocks seeding', async () => {
        const forage = localforage.createInstance({ name: 'risuai', driver: localforage.INDEXEDDB })
        await forage.setItem(HEAD_KEY, 'a string')
        const { owner } = makeOwner(createIndexedDbStore(), { headSwap: createIndexedDbHeadSwap() })
        const result = await owner.load()
        expect(result).toMatchObject({ kind: 'damaged', generation: null })
        expect(result.kind === 'damaged' && result.damage.map((item) => item.kind)).toEqual(['bad-head'])
        expect(await owner.findSeedBlockers()).toEqual([{ kind: 'head', keys: [HEAD_KEY] }])
        expect(await forage.getItem(HEAD_KEY)).toBe('a string')
    })
})
