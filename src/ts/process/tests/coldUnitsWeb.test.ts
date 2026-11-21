/**
 * Cold-storage units on the web build go through the page's byte store: the
 * real `readColdStorageItem`, `setColdStorageItem` and `deleteColdStorageUnits`
 * run over the real IndexedDB
 * store (`fake-indexeddb`) with a `navigator.storage.getDirectory` that fails if
 * it is ever called: the browser's private file system is neither read nor
 * written nor deleted. A pass here says nothing about a real browser's
 * IndexedDB. `fake-indexeddb/auto` is imported first
 * because LocalForage captures `indexedDB` once when it loads.
 *
 * Every test is labelled in its title:
 * - "new behaviour" and "4b-G1": assert what only units-through-the-store does
 *   (reads, writes and deletes reach the store and no getDirectory call is made);
 * - "guard": holds before and after, and protects behaviour that must stay.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { compressSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    forage: { Init: async (): Promise<void> => { }, realStorage: undefined as unknown, staleAccountProfile: false },
    keyPair: null as CryptoKeyPair | null,
}))

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    get forageStorage() { return h.forage },
    acquireExclusiveStorageMigrationLock: async () => null,
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
    alertConfirm: vi.fn(async () => true),
    waitAlert: vi.fn(async () => { }),
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/process/index.svelte'), () => ({
    doingChat: writable(false),
}) as unknown as typeof import('src/ts/process/index.svelte'))

vi.mock('@tauri-apps/plugin-os', () => ({ type: () => 'linux' }))

type ColdModule = typeof import('src/ts/process/coldstorage.svelte')
type AppStoreModule = typeof import('src/ts/storage/store/appStore')
type LocationModule = typeof import('src/ts/process/coldUnitLocation')

let cold: ColdModule
let app: AppStoreModule
let location: LocationModule
let getDirectory: ReturnType<typeof vi.fn>

/** The `risuai` LocalForage database the IndexedDB store and upstream's own code share. */
const profile = localforage.createInstance({ name: 'risuai' })

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
const OTHER = '9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

/** Puts a unit in IndexedDB exactly where the store keeps it, bypassing the code under test. */
async function putInStore(key: string, value: unknown): Promise<void> {
    await profile.setItem('coldstorage/' + key, encodeUnit(value))
}

async function storeHas(key: string): Promise<boolean> {
    return (await profile.getItem('coldstorage/' + key)) !== null
}

/** The unit keys the page's byte store lists under `coldstorage/`, named as the store layout names them. */
async function storeUnits(): Promise<string[]> {
    const keys: string[] = []
    for (const storeKey of await (await app.getAppStore()).list(location.COLD_UNIT_STORE_PREFIX)) {
        const key = location.coldUnitKeyOfStoreKey(storeKey)
        if (key !== null) {
            keys.push(key)
        }
    }
    return keys
}

function installNavigatorStorage(navigatorStorage: unknown): void {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: navigatorStorage })
}

beforeEach(async () => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.forage.Init = async () => { }
    h.forage.realStorage = undefined
    getDirectory = vi.fn(async () => { throw new Error('the browser private file system must not be touched') })
    installNavigatorStorage({ getDirectory })
    await profile.clear()
    vi.resetModules()
    cold = await import('src/ts/process/coldstorage.svelte')
    app = await import('src/ts/storage/store/appStore')
    location = await import('src/ts/process/coldUnitLocation')
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('reading a unit: the page store only', () => {
    test('new behaviour: a unit in the store is read from the store', async () => {
        await putInStore(UUID, { message: [{ time: 1, data: 'store value', role: 'user' }] })

        const result = await cold.readColdStorageItem(UUID)

        expect(result).toEqual({ status: 'ok', value: { message: [{ time: 1, data: 'store value', role: 'user' }] } })
        expect(getDirectory).not.toHaveBeenCalled()
    })

    test('4b-G1: a unit absent from the store is missing without any getDirectory call', async () => {
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
        expect(await cold.getColdStorageItem(UUID)).toBeNull()
        expect(getDirectory).not.toHaveBeenCalled()
    })

    test('new behaviour: a failing store read is an error with no kind and the private file system is not consulted', async () => {
        const real = await app.getAppStore()
        app.injectAppStore({ ...real, read: async () => { throw new Error('IndexedDB read failed') } })

        const result = await cold.readColdStorageItem(UUID)

        expect(result.status).toBe('error')
        expect((result as { kind?: unknown }).kind).toBeUndefined()
        expect(getDirectory).not.toHaveBeenCalled()
        expect(await cold.getColdStorageItem(UUID)).toBeNull()
    })

    test('new behaviour: a zero-length unit in the store is a value that does not decode, so it is damaged', async () => {
        await profile.setItem('coldstorage/' + UUID, new Uint8Array(0))

        const result = await cold.readColdStorageItem(UUID)

        expect(result.status).toBe('error')
        expect((result as { kind?: unknown }).kind).toBe('damaged')
    })
})

describe('writing a unit: the page store only, never the private file system', () => {
    test('new behaviour: a write lands in IndexedDB under coldstorage/<key> and never calls getDirectory', async () => {
        expect(await cold.setColdStorageItem(UUID, { message: [{ time: 1, data: 'x', role: 'user' }] })).toBe(true)

        expect(await storeHas(UUID)).toBe(true)
        expect(getDirectory).not.toHaveBeenCalled()
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { message: [{ time: 1, data: 'x', role: 'user' }] } })
    })

    test('new behaviour: a plugin slot rewritten reads the new value, and no older value is readable after the unit is deleted', async () => {
        expect(await cold.setColdStorageItem(UUID, { slot: 'old' })).toBe(true)
        expect(await cold.setColdStorageItem(UUID, { slot: 'new' })).toBe(true)

        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { slot: 'new' } })

        expect(await cold.deleteColdStorageUnits([UUID])).toEqual([])

        expect(await storeHas(UUID)).toBe(false)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test.each([
        ['a UUID', UUID],
        ['a UUID with the _accessMeta suffix upstream wrote', UUID + '_accessMeta'],
    ])('new behaviour: %s round-trips through the store and is listed and deleted from it', async (_label, key) => {
        expect(await cold.setColdStorageItem(key, { message: [] })).toBe(true)

        expect(await cold.readColdStorageItem(key)).toEqual({ status: 'ok', value: { message: [] } })
        expect(await storeUnits()).toEqual([key])
        expect(await cold.deleteColdStorageUnits([key])).toEqual([])
        expect(await storeUnits()).toEqual([])
    })

    test('new behaviour: a key the cold-key rule accepts but the store refuses (a leading dot) reads damaged, writes false and touches neither store nor getDirectory', async () => {
        const read = await cold.readColdStorageItem('.hidden')
        const written = await cold.setColdStorageItem('.hidden', { message: [] })

        expect(read.status).toBe('error')
        expect((read as { kind?: unknown }).kind).toBe('damaged')
        expect(written).toBe(false)
        expect(await profile.keys()).toEqual([])
        expect(getDirectory).not.toHaveBeenCalled()
    })
})

describe('deleting units: the store entry only', () => {
    test('4b-G1: a unit held by the store is removed through the store without any getDirectory call, reads missing and is not listed', async () => {
        await putInStore(UUID, { message: [] })

        const failed = await cold.deleteColdStorageUnits([UUID])

        expect(failed).toEqual([])
        expect(await storeHas(UUID)).toBe(false)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
        expect(await storeUnits()).toEqual([])
        expect(getDirectory).not.toHaveBeenCalled()
    })

    test('new behaviour: a store delete that throws reports every unit as not deleted and leaves them in the store', async () => {
        await putInStore(UUID, { n: 1 })
        await putInStore(OTHER, { n: 2 })
        const real = await app.getAppStore()
        app.injectAppStore({ ...real, deleteMany: async () => { throw new Error('delete refused') } })

        const failed = await cold.deleteColdStorageUnits([UUID, OTHER])

        expect(failed.map((entry) => entry.key)).toEqual([UUID, OTHER])
        expect(await storeHas(UUID)).toBe(true)
        expect(await storeHas(OTHER)).toBe(true)
    })

    test('new behaviour: a unit in the upstream _accessMeta shape is deleted from the store', async () => {
        await putInStore(UUID + '_accessMeta', { meta: true })

        expect(await cold.deleteColdStorageUnits([UUID + '_accessMeta'])).toEqual([])
        expect(await storeHas(UUID + '_accessMeta')).toBe(false)
    })
})

describe('the backup carries the units the store holds', () => {
    test('new behaviour: the collector carries a unit the store holds as JSON text and reports one it does not hold as missing', async () => {
        await putInStore(UUID, { slot: 'store' })
        const db = { characters: [], pluginCustomStorage: { _coldplugin: { a: UUID, b: OTHER } } } as unknown as Parameters<ColdModule['collectColdStorageBackupPayloads']>[0]

        const collected = await cold.collectColdStorageBackupPayloads(db)

        expect(collected.missingKeys).toEqual([OTHER])
        expect(collected.invalidKeys).toEqual([])
        const texts = new Map(collected.payloads.map((payload) => [payload.key, new TextDecoder().decode(payload.encoded)]))
        expect(texts.get(UUID)).toBe(JSON.stringify({ slot: 'store' }))
        expect(getDirectory).not.toHaveBeenCalled()
    })

    test('new behaviour: a unit restored from a backup is written to the store only', async () => {
        expect(await cold.setColdStorageItem(UUID, { slot: 'restored' })).toBe(true)

        expect(await storeHas(UUID)).toBe(true)
        expect(getDirectory).not.toHaveBeenCalled()
    })
})

describe('a browser without a private file system', () => {
    beforeEach(() => {
        Reflect.deleteProperty(navigator, 'storage')
    })

    test('new behaviour: an absent unit is missing, not unavailable', async () => {
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test('new behaviour: the listing is the store\'s only and a delete touches only the store', async () => {
        await putInStore(UUID, { n: 1 })

        expect(await storeUnits()).toEqual([UUID])
        expect(await cold.deleteColdStorageUnits([UUID])).toEqual([])
        expect(await storeHas(UUID)).toBe(false)
        expect(await storeUnits()).toEqual([])
    })
})
