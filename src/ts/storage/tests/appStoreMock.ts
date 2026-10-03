/**
 * Test-only: the module shape a `vi.mock` of `src/ts/storage/store/appStore`
 * returns for a suite whose code under test only asks for the page's store
 * (`getAppStore`) and whose world is an in-memory model of the storage object.
 * Mocking the module keeps the real store selection, and the application graph
 * it reaches, out of a suite that mocks `globalApi.svelte` wholesale.
 *
 * Nothing here says anything about the real stores.
 */
import type { ByteStore } from 'src/ts/storage/store/contract'
import { createForageBackedStore, type ForageLike } from './forageBackedStore'

/** The part of the `appStore` module a code-under-test that only reads and writes blocks uses. */
export interface AppStoreModuleMock {
    getAppStore(): Promise<ByteStore>
}

/** A storage-object stand-in over a `Map`, for a suite that keeps a platform's files in one. */
export function forageOverMap(files: Map<string, Uint8Array>): ForageLike {
    return {
        getItem: async (key) => files.get(key) ?? null,
        setItem: async (key, value) => { files.set(key, value.slice()) },
        keys: async () => Array.from(files.keys()),
        removeItem: async (key) => { files.delete(key) },
    }
}

/** `getAppStore` answers a store over whatever `forage` names at the time of each call. */
export function appStoreModuleOver(forage: () => ForageLike): AppStoreModuleMock {
    const store = createForageBackedStore({
        getItem: (key) => forage().getItem(key),
        setItem: (key, value) => forage().setItem(key, value),
        keys: () => forage().keys(),
        removeItem: (key) => forage().removeItem(key),
    })
    return { getAppStore: async () => store }
}
