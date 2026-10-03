/**
 * Cold-storage units on the web build go through the page's byte store: the
 * real `readColdStorageItem`, `setColdStorageItem`, `deleteColdStorageUnits`,
 * `listColdStorageItems` and the load-time listing run over the real IndexedDB
 * store (`fake-indexeddb`) with an in-memory OPFS root for the units that older
 * builds kept as `coldstorage_<key>.json` files. A pass here says nothing about
 * a real browser's IndexedDB or OPFS. `fake-indexeddb/auto` is imported first
 * because LocalForage captures `indexedDB` once when it loads.
 *
 * Every test is labelled in its title:
 * - "new behaviour": asserts what only units-through-the-store does (the store
 *   is read first, the legacy file only on absence, a delete removes both);
 * - "guard": holds before and after, and protects behaviour that must stay.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { compressSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { FakeOpfsRoot, hexName } from 'src/ts/storage/tests/fakeOpfsRoot'

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
type ListingModule = typeof import('src/ts/storage/loadTimeListing')

let cold: ColdModule
let app: AppStoreModule
let listing: ListingModule
let root: FakeOpfsRoot
let getDirectory: ReturnType<typeof vi.fn>

/** The `risuai` LocalForage database the IndexedDB store and upstream's own code share. */
const profile = localforage.createInstance({ name: 'risuai' })

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
const OTHER = '9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

function legacyName(key: string): string {
    return 'coldstorage_' + key + '.json'
}

/** Puts a unit in IndexedDB exactly where the store keeps it, bypassing the code under test. */
async function putInStore(key: string, value: unknown): Promise<void> {
    await profile.setItem('coldstorage/' + key, encodeUnit(value))
}

function putLegacy(key: string, value: unknown): void {
    root.files.set(legacyName(key), encodeUnit(value))
}

async function storeHas(key: string): Promise<boolean> {
    return (await profile.getItem('coldstorage/' + key)) !== null
}

function installOpfs(navigatorStorage: unknown): void {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: navigatorStorage })
}

beforeEach(async () => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.forage.Init = async () => { }
    h.forage.realStorage = undefined
    root = new FakeOpfsRoot()
    getDirectory = vi.fn(async () => root)
    installOpfs({ getDirectory })
    await profile.clear()
    vi.resetModules()
    cold = await import('src/ts/process/coldstorage.svelte')
    app = await import('src/ts/storage/store/appStore')
    listing = await import('src/ts/storage/loadTimeListing')
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    localStorage.removeItem('opfs_flag!')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('reading a unit: the page store first, the legacy OPFS file only when the store holds none', () => {
    test('new behaviour: a unit in the store is read from the store even when a different legacy file exists', async () => {
        await putInStore(UUID, { message: [{ time: 1, data: 'store value', role: 'user' }] })
        putLegacy(UUID, { message: [{ time: 1, data: 'older legacy value', role: 'user' }] })

        const result = await cold.readColdStorageItem(UUID)

        expect(result).toEqual({ status: 'ok', value: { message: [{ time: 1, data: 'store value', role: 'user' }] } })
        expect(getDirectory).not.toHaveBeenCalled()
    })

    test('new behaviour: a unit absent from the store is read from the legacy OPFS file', async () => {
        putLegacy(UUID, { message: [{ time: 1, data: 'legacy value', role: 'user' }] })

        const result = await cold.readColdStorageItem(UUID)

        expect(result).toEqual({ status: 'ok', value: { message: [{ time: 1, data: 'legacy value', role: 'user' }] } })
    })

    test('guard: a unit absent from the store and from OPFS is missing', async () => {
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
        expect(await cold.getColdStorageItem(UUID)).toBeNull()
    })

    test('new behaviour: a failing store read is an error with no kind and the legacy file is not consulted', async () => {
        putLegacy(UUID, { message: [] })
        const real = await app.getAppStore()
        app.injectAppStore({ ...real, read: async () => { throw new Error('IndexedDB read failed') } })

        const result = await cold.readColdStorageItem(UUID)

        expect(result.status).toBe('error')
        expect((result as { kind?: unknown }).kind).toBeUndefined()
        expect(getDirectory).not.toHaveBeenCalled()
        expect(await cold.getColdStorageItem(UUID)).toBeNull()
    })

    test('guard: a getDirectory that rejects, with the unit absent from the store, is an error with no kind', async () => {
        getDirectory.mockRejectedValue(Object.assign(new Error('insecure'), { name: 'SecurityError' }))

        const result = await cold.readColdStorageItem(UUID)

        expect(result.status).toBe('error')
        expect((result as { kind?: unknown }).kind).toBeUndefined()
    })

    test('new behaviour: a zero-length unit in the store is a value that does not decode, so it is damaged and the legacy file is not consulted', async () => {
        await profile.setItem('coldstorage/' + UUID, new Uint8Array(0))
        putLegacy(UUID, { message: [] })

        const result = await cold.readColdStorageItem(UUID)

        expect(result.status).toBe('error')
        expect((result as { kind?: unknown }).kind).toBe('damaged')
    })
})

describe('writing a unit: the page store only, never OPFS', () => {
    test('new behaviour: a write lands in IndexedDB under coldstorage/<key> and leaves the OPFS root untouched', async () => {
        const callsBefore = root.calls

        expect(await cold.setColdStorageItem(UUID, { message: [{ time: 1, data: 'x', role: 'user' }] })).toBe(true)

        expect(await storeHas(UUID)).toBe(true)
        expect(root.files.size).toBe(0)
        expect(root.calls).toBe(callsBefore)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { message: [{ time: 1, data: 'x', role: 'user' }] } })
    })

    test('new behaviour: a plugin slot rewritten over a legacy file reads the new value, and no older value is ever readable again after the unit is deleted', async () => {
        putLegacy(UUID, { slot: 'old' })

        expect(await cold.setColdStorageItem(UUID, { slot: 'new' })).toBe(true)

        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { slot: 'new' } })
        expect(root.files.has(legacyName(UUID))).toBe(true)

        expect(await cold.deleteColdStorageUnits([UUID])).toEqual([])

        expect(root.files.has(legacyName(UUID))).toBe(false)
        expect(await storeHas(UUID)).toBe(false)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test.each([
        ['a UUID', UUID],
        ['a UUID with the _accessMeta suffix upstream wrote', UUID + '_accessMeta'],
    ])('new behaviour: %s round-trips through the store and is listed and deleted from it', async (_label, key) => {
        expect(await cold.setColdStorageItem(key, { message: [] })).toBe(true)

        expect(await cold.readColdStorageItem(key)).toEqual({ status: 'ok', value: { message: [] } })
        expect((await cold.listColdStorageItems()).items).toEqual([key])
        expect(await cold.deleteColdStorageUnits([key])).toEqual([])
        expect((await cold.listColdStorageItems()).items).toEqual([])
    })

    test('new behaviour: a key the cold-key rule accepts but the store refuses (a leading dot) reads damaged, writes false and touches neither store nor OPFS', async () => {
        const callsBefore = root.calls

        const read = await cold.readColdStorageItem('.hidden')
        const written = await cold.setColdStorageItem('.hidden', { message: [] })

        expect(read.status).toBe('error')
        expect((read as { kind?: unknown }).kind).toBe('damaged')
        expect(written).toBe(false)
        expect(await profile.keys()).toEqual([])
        expect(root.calls).toBe(callsBefore)
    })
})

describe('deleting units: the legacy file first, then the store entry', () => {
    test('new behaviour: a unit held by the store and by OPFS is removed from both, reads missing and is not listed', async () => {
        await putInStore(UUID, { message: [] })
        putLegacy(UUID, { message: [] })

        const failed = await cold.deleteColdStorageUnits([UUID])

        expect(failed).toEqual([])
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
        expect((await cold.listColdStorageItems()).items).toEqual([])
    })

    test('new behaviour: a legacy file that cannot be removed leaves the store entry, is reported not deleted, and the newer value stays readable', async () => {
        await putInStore(UUID, { slot: 'new' })
        putLegacy(UUID, { slot: 'old' })
        root.failRemoval.add(legacyName(UUID))

        const failed = await cold.deleteColdStorageUnits([UUID])

        expect(failed.map((entry) => entry.key)).toEqual([UUID])
        expect(await storeHas(UUID)).toBe(true)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { slot: 'new' } })
    })

    test('new behaviour: a failure of one unit does not stop the others and only that unit is reported', async () => {
        await putInStore(UUID, { n: 1 })
        await putInStore(OTHER, { n: 2 })
        putLegacy(UUID, { n: 0 })
        putLegacy(OTHER, { n: 0 })
        root.failRemoval.add(legacyName(UUID))

        const failed = await cold.deleteColdStorageUnits([UUID, OTHER])

        expect(failed.map((entry) => entry.key)).toEqual([UUID])
        expect(await storeHas(OTHER)).toBe(false)
        expect(root.files.has(legacyName(OTHER))).toBe(false)
    })

    test('new behaviour: a getDirectory that rejects reports every unit as not deleted and leaves the store alone', async () => {
        await putInStore(UUID, { n: 1 })
        getDirectory.mockRejectedValue(new Error('no root'))

        const failed = await cold.deleteColdStorageUnits([UUID])

        expect(failed.map((entry) => entry.key)).toEqual([UUID])
        expect(await storeHas(UUID)).toBe(true)
    })

    test('new behaviour: a unit that exists only in OPFS, in the upstream _accessMeta shape, is deleted', async () => {
        putLegacy(UUID + '_accessMeta', { meta: true })

        expect(await cold.deleteColdStorageUnits([UUID + '_accessMeta'])).toEqual([])
        expect(root.files.size).toBe(0)
    })
})

describe('listing: the store united with the legacy OPFS files', () => {
    test('new behaviour: the union lists a unit once whether the store, OPFS or both hold it', async () => {
        await putInStore(UUID, { n: 1 })
        putLegacy(UUID, { n: 0 })
        await putInStore(OTHER, { n: 2 })
        putLegacy('legacy-only', { n: 3 })
        root.files.set(hexName('assets/not-a-unit.png'), new Uint8Array([1]))
        await profile.setItem('assets/other.png', new Uint8Array([1]))

        expect((await cold.listColdStorageItems()).items.sort()).toEqual([OTHER, UUID, 'legacy-only'].sort())
    })

    test('new behaviour: an OPFS listing that fails fails the whole listing: no listing is recorded', async () => {
        await putInStore(UUID, { n: 1 })
        root.failEntries = new Error('listing failed')

        await listing.recordLoadTimeListing()

        expect(listing.getLoadTimeListing()).toBeNull()
        await expect(listing.takeStorageListing()).rejects.toThrow('listing failed')
    })

    test('new behaviour: a stored name the key rule rejects is never a listed unit', async () => {
        await profile.setItem('coldstorage/a:b', new Uint8Array([1]))
        await putInStore(UUID, { n: 1 })

        const taken = await listing.takeStorageListing()

        expect([...taken.units]).toEqual([UUID])
    })
})

describe('the backup carries units from both places', () => {
    test('new behaviour: the collector carries a unit that only the store holds and one that only a legacy file holds, as the same JSON text either way', async () => {
        await putInStore(UUID, { slot: 'store' })
        putLegacy(OTHER, { slot: 'legacy' })
        const db = { characters: [], pluginCustomStorage: { _coldplugin: { a: UUID, b: OTHER } } } as unknown as Parameters<ColdModule['collectColdStorageBackupPayloads']>[0]

        const collected = await cold.collectColdStorageBackupPayloads(db)

        expect(collected.missingKeys).toEqual([])
        expect(collected.invalidKeys).toEqual([])
        const texts = new Map(collected.payloads.map((payload) => [payload.key, new TextDecoder().decode(payload.encoded)]))
        expect(texts.get(UUID)).toBe(JSON.stringify({ slot: 'store' }))
        expect(texts.get(OTHER)).toBe(JSON.stringify({ slot: 'legacy' }))
    })

    test('new behaviour: a unit restored from a backup is written to the store only', async () => {
        const callsBefore = root.calls

        expect(await cold.setColdStorageItem(UUID, { slot: 'restored' })).toBe(true)

        expect(await storeHas(UUID)).toBe(true)
        expect(root.files.size).toBe(0)
        expect(root.calls).toBe(callsBefore)
    })
})

describe('a browser without OPFS', () => {
    beforeEach(() => {
        Reflect.deleteProperty(navigator, 'storage')
    })

    test('new behaviour: an absent unit is missing, not unavailable', async () => {
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'missing' })
    })

    test('new behaviour: the listing is the store\'s only and a delete touches only the store', async () => {
        await putInStore(UUID, { n: 1 })

        expect((await cold.listColdStorageItems()).items).toEqual([UUID])
        expect(await cold.deleteColdStorageUnits([UUID])).toEqual([])
        expect(await storeHas(UUID)).toBe(false)
        expect((await listing.takeStorageListing()).units.size).toBe(0)
    })
})

describe('a page that fell back to the OPFS main store keeps its units in that store', () => {
    test('new behaviour: a unit written by such a page is stored as the hex file of coldstorage/<key>, is read and listed back, and no coldstorage_ file is written', async () => {
        // An OPFS-main profile whose copy back is refused the exclusive lock runs from OPFS.
        root.files.set(hexName('database/database.bin'), new Uint8Array([1]))
        localStorage.setItem('opfs_flag!', 'able')
        vi.stubGlobal('FileSystemFileHandle', class { createWritable() { } })

        expect(await cold.setColdStorageItem(UUID, { message: [] })).toBe(true)

        expect(root.files.has(hexName('coldstorage/' + UUID))).toBe(true)
        expect(root.files.has(legacyName(UUID))).toBe(false)
        expect(await cold.readColdStorageItem(UUID)).toEqual({ status: 'ok', value: { message: [] } })
        expect((await cold.listColdStorageItems()).items).toEqual([UUID])
        expect(await profile.keys()).toEqual([])
    })
})
