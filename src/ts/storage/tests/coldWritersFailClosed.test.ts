/**
 * The legacy cold-unit writers on a store2 page fail closed: with a residency registered,
 * `writeColdStorageUnit` answers `'failed'` (and `setColdStorageItem` `false`) and
 * `deleteColdStorageUnits` reports every key as not deleted, each with a console error, and neither
 * reaches the page's store or the legacy OPFS directory. Without a residency both behave as before.
 *
 * Runs the real writers over the real IndexedDB store (`fake-indexeddb`) with an in-memory OPFS
 * root; a pass here says nothing about a real browser's IndexedDB or OPFS.
 *
 * Labels: "fail closed" tests are regression reproducers (they fail on the writers that ignore the
 * residency); "legacy page" tests are compatibility guards that pass before and after.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { compressSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { FakeOpfsRoot } from 'src/ts/storage/tests/fakeOpfsRoot'
import type { Residency } from 'src/ts/storage/store2/residency'

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

let cold: ColdModule
let root: FakeOpfsRoot
let getDirectory: ReturnType<typeof vi.fn>
let errors: ReturnType<typeof vi.spyOn>

/** The `risuai` LocalForage database the IndexedDB store and upstream's own code share. */
const profile = localforage.createInstance({ name: 'risuai' })

const UUID = '3f2b8c1e-5a47-4d9e-8b61-0c7a9d2e4f10'
const OTHER = '9a1d7c20-2b3e-4f5a-8c6d-1e2f3a4b5c6d'

function encodeUnit(value: unknown): Uint8Array {
    return compressSync(new TextEncoder().encode(JSON.stringify(value)))
}

async function putInStore(key: string, value: unknown): Promise<void> {
    await profile.setItem('coldstorage/' + key, encodeUnit(value))
}

async function storeHas(key: string): Promise<boolean> {
    return (await profile.getItem('coldstorage/' + key)) !== null
}

async function registerStore2Page(): Promise<void> {
    const { registerResidency } = await import('src/ts/storage/store2/residencyActive')
    registerResidency({} as unknown as Residency)
}

beforeEach(async () => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    root = new FakeOpfsRoot()
    getDirectory = vi.fn(async () => root)
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory } })
    await profile.clear()
    vi.resetModules()
    cold = await import('src/ts/process/coldstorage.svelte')
    errors = vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'log').mockImplementation(() => { })
})

afterEach(() => {
    Reflect.deleteProperty(navigator, 'storage')
    vi.restoreAllMocks()
})

describe('on a store2 page the legacy cold-unit writers fail closed', () => {
    test('writeColdStorageUnit answers failed, writes nothing and says why', async () => {
        await registerStore2Page()

        expect(await cold.writeColdStorageUnit(UUID, { a: 1 })).toBe('failed')

        expect(await storeHas(UUID)).toBe(false)
        expect(root.files.size).toBe(0)
        expect(errors).toHaveBeenCalled()
    })

    test('setColdStorageItem, which follows writeColdStorageUnit, answers false', async () => {
        await registerStore2Page()

        expect(await cold.setColdStorageItem(UUID, { a: 1 })).toBe(false)

        expect(await storeHas(UUID)).toBe(false)
    })

    test('deleteColdStorageUnits reports every key as not deleted and removes nothing', async () => {
        await putInStore(UUID, { a: 1 })
        await putInStore(OTHER, { b: 2 })
        await registerStore2Page()

        const failed = await cold.deleteColdStorageUnits([UUID, OTHER])

        expect(failed.map((entry) => entry.key)).toEqual([UUID, OTHER])
        expect(failed.every((entry) => entry.error instanceof Error)).toBe(true)
        expect(await storeHas(UUID)).toBe(true)
        expect(await storeHas(OTHER)).toBe(true)
        expect(getDirectory).not.toHaveBeenCalled()
        expect(errors).toHaveBeenCalled()
    })
})

describe('on a legacy page the writers are unchanged', () => {
    // Compatibility guard: passes before and after.
    test('writeColdStorageUnit writes the unit and deleteColdStorageUnits removes it', async () => {
        expect(await cold.writeColdStorageUnit(UUID, { a: 1 })).toBe('written')
        expect(await storeHas(UUID)).toBe(true)
        expect(await cold.setColdStorageItem(OTHER, { b: 2 })).toBe(true)

        expect(await cold.deleteColdStorageUnits([UUID, OTHER])).toEqual([])

        expect(await storeHas(UUID)).toBe(false)
        expect(await storeHas(OTHER)).toBe(false)
    })
})
