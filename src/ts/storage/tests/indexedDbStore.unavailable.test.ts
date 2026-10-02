/**
 * The IndexedDB adapter in a browser without IndexedDB. This file never imports
 * `fake-indexeddb`, and the default test environment has `localStorage`, which an
 * unpinned LocalForage would silently fall back to; the adapter pins the driver,
 * so every operation must reject instead.
 */
import { describe, expect, test } from 'vitest'
import { createIndexedDbStore } from 'src/ts/storage/store/indexedDbStore'

describe('IndexedDB store without IndexedDB', () => {
    test('the environment offers no IndexedDB and does offer localStorage', () => {
        expect(typeof indexedDB).toBe('undefined')
        expect(typeof localStorage).toBe('object')
    })

    test('every operation rejects and none falls back to another storage', async () => {
        const store = createIndexedDbStore()

        await expect(store.read('a/b')).rejects.toBeDefined()
        await expect(store.write('a/b', Uint8Array.from([1]), 'unconditional')).rejects.toBeDefined()
        await expect(store.has('a/b')).rejects.toBeDefined()
        await expect(store.list('a/')).rejects.toBeDefined()
        await expect(store.delete('a/b', 'unconditional')).rejects.toBeDefined()
        await expect(store.deleteMany([{ key: 'a/b', condition: 'unconditional' }])).rejects.toBeDefined()

        expect(localStorage.length).toBe(0)
    })
})
