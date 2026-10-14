// @vitest-environment node
/**
 * The IndexedDB adapter's `list`, `has` and `countPrefix` read only the key
 * range they ask about: `[prefix, prefix with its last code unit incremented)`,
 * never every key in the store. Against `fake-indexeddb`; a pass shows which
 * ranges are requested and what comes back, and says nothing about a real
 * browser's cost. `fake-indexeddb/auto` is imported before LocalForage is first
 * evaluated.
 */
import 'fake-indexeddb/auto'
import localforage from 'localforage'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createIndexedDbStore, prefixUpperBound } from 'src/ts/storage/store/indexedDbStore'

const upstream = localforage.createInstance({ name: 'risuai' })
const BYTES = Uint8Array.from([1])

const SIBLINGS = ['store2', 'store2-commit', 'store2-sweep', 'store2-fence', 'store2/', 'store2/a', 'store2/b/c', 'store20', 'store20/x', 'store3', 'store1/z']

async function seed(keys: readonly string[]): Promise<void> {
    await upstream.dropInstance({ name: 'risuai' })
    for (const key of keys) {
        await upstream.setItem(key, BYTES)
    }
}

/** Every way a driver can enumerate keys, spied, with the range each call was given. */
function spyOnEnumeration() {
    const openKeyCursor = vi.spyOn(IDBObjectStore.prototype, 'openKeyCursor')
    const openCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    const getAllKeys = vi.spyOn(IDBObjectStore.prototype, 'getAllKeys')
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    const count = vi.spyOn(IDBObjectStore.prototype, 'count')
    return {
        /** Enumerations that visit keys without a range. */
        unranged: () => [openKeyCursor, openCursor, getAllKeys, getAll].reduce((sum, spy) => sum + spy.mock.calls.filter((call) => !(call[0] instanceof IDBKeyRange)).length, 0),
        ranges: () => getAllKeys.mock.calls.map((call) => call[0]).filter((range): range is IDBKeyRange => range instanceof IDBKeyRange),
        counts: () => count.mock.calls.map((call) => call[0]),
    }
}

function expectedList(keys: readonly string[], prefix: string): string[] {
    return keys.filter((key) => key.startsWith(prefix)).sort()
}

beforeEach(async () => {
    const filler = Array.from({ length: 200 }, (_, i) => `assets/${i}.png`)
    await seed([...SIBLINGS, ...filler])
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('prefixUpperBound', () => {
    test('increments the last code unit', () => {
        expect(prefixUpperBound('store2/')).toBe('store20')
        expect(prefixUpperBound('a')).toBe('b')
    })

    test('drops trailing U+FFFF units before incrementing, and has no bound when only they remain', () => {
        expect(prefixUpperBound('ab\uFFFF')).toBe('ac')
        expect(prefixUpperBound('ab\uFFFF\uFFFF')).toBe('ac')
        expect(prefixUpperBound('\uFFFF')).toBeNull()
        expect(prefixUpperBound('')).toBeNull()
    })
})

describe('IndexedDB ranged list', () => {
    test('reproducer: list visits only keys inside the prefix range, never the whole store', async () => {
        const store = createIndexedDbStore()
        const spies = spyOnEnumeration()
        const listed = await store.list('store2/')
        expect(listed).toEqual(['store2/', 'store2/a', 'store2/b/c'])
        expect(spies.unranged()).toBe(0)
        const ranges = spies.ranges()
        expect(ranges).toHaveLength(1)
        expect(ranges[0].lower).toBe('store2/')
        expect(ranges[0].upper).toBe('store20')
        expect(ranges[0].lowerOpen).toBe(false)
        expect(ranges[0].upperOpen).toBe(true)
    })

    const prefixes = ['store2/', 'store2', 'store2-', 'store20', 'store3', 'store2/a', 'store2/b/c', 'nothing', 'assets/1', 'assets/', 's']

    test.each(prefixes)('list(%j) equals the filtered key list', async (prefix) => {
        const keys = await upstream.keys()
        expect(await createIndexedDbStore().list(prefix)).toEqual(expectedList(keys, prefix))
    })

    test('a key equal to the prefix is listed', async () => {
        expect(await createIndexedDbStore().list('store2')).toContain('store2')
    })

    test('keys under a prefix ending in U+FFFF are bounded by the unit before it', async () => {
        await seed(['ab', 'ab\uFFFF', 'ab\uFFFFx', 'ab\uFFFF\uFFFF', 'ac', 'ab\uFFFE'])
        const store = createIndexedDbStore()
        expect(await store.list('ab\uFFFF')).toEqual(['ab\uFFFF', 'ab\uFFFF\uFFFF', 'ab\uFFFFx'].sort())
        expect(await store.countPrefix?.('ab\uFFFF')).toBe(3)
    })

    test('a prefix of only U+FFFF units has no upper end', async () => {
        await seed(['\uFFFE', '\uFFFF', '\uFFFFa', 'b'])
        const store = createIndexedDbStore()
        expect(await store.list('\uFFFF')).toEqual(['\uFFFF', '\uFFFFa'])
        expect(await store.countPrefix?.('\uFFFF')).toBe(2)
    })

    test('a lone surrogate prefix is bounded as one code unit', async () => {
        await seed(['\uD83D', '\uD83Dx', '\uD83E', 'a'])
        const store = createIndexedDbStore()
        expect(await store.list('\uD83D')).toEqual(['\uD83D', '\uD83Dx'])
    })

    test('a store with no database yet lists nothing and leaves the database created', async () => {
        await upstream.dropInstance({ name: 'risuai' })
        expect(await createIndexedDbStore().list('store2/')).toEqual([])
        expect((await indexedDB.databases()).map((entry) => entry.name)).toContain('risuai')
    })

    test('an empty prefix is still refused by list', async () => {
        await expect(createIndexedDbStore().list('')).rejects.toThrow()
    })
})

describe('IndexedDB has', () => {
    test('reproducer: has answers by a point lookup without enumerating keys', async () => {
        const store = createIndexedDbStore()
        const spies = spyOnEnumeration()
        expect(await store.has('store2/a')).toBe(true)
        expect(await store.has('store2/missing')).toBe(false)
        expect(spies.unranged()).toBe(0)
        expect(spies.ranges()).toHaveLength(0)
    })

    test('has is false for a key that only shares a prefix and true for the exact key', async () => {
        const store = createIndexedDbStore()
        expect(await store.has('store2/b/c')).toBe(true)
        expect(await store.has('store2/b')).toBe(false)
        expect(await store.has('store')).toBe(false)
    })
})

describe('IndexedDB countPrefix', () => {
    const prefixes = ['', 'store2/', 'store2', 'store2-', 'store20', 'nothing', 'assets/', 'assets/1']

    test.each(prefixes)('countPrefix(%j) equals the filtered key count', async (prefix) => {
        const keys = await upstream.keys()
        const store = createIndexedDbStore()
        expect(await store.countPrefix?.(prefix)).toBe(expectedList(keys, prefix).length)
        if (prefix !== '') {
            expect(await store.countPrefix?.(prefix)).toBe((await store.list(prefix)).length)
        }
    })

    test('reproducer: the count is taken over the prefix range, not the whole store', async () => {
        const store = createIndexedDbStore()
        const spies = spyOnEnumeration()
        expect(await store.countPrefix?.('store2/')).toBe(3)
        const ranges = spies.counts().filter((range): range is IDBKeyRange => range instanceof IDBKeyRange)
        expect(ranges).toHaveLength(1)
        expect(ranges[0].lower).toBe('store2/')
        expect(ranges[0].upper).toBe('store20')
        expect(spies.unranged()).toBe(0)
    })

    test('an empty prefix counts the whole store without enumerating', async () => {
        const store = createIndexedDbStore()
        const total = (await upstream.keys()).length
        const spies = spyOnEnumeration()
        expect(await store.countPrefix?.('')).toBe(total)
        expect(spies.unranged()).toBe(0)
    })

    test('a database that does not exist yet is unknown, not zero', async () => {
        await upstream.dropInstance({ name: 'risuai' })
        expect(await createIndexedDbStore().countPrefix?.('store2/')).toBeNull()
    })
})

describe('IndexedDB fallback when the plain connection cannot be opened', () => {
    /** Refuses every open that asks for no version, which is the adapter's own connection; LocalForage's opens still work. */
    function failPlainOpens(): void {
        const real = indexedDB.open.bind(indexedDB)
        vi.spyOn(indexedDB, 'open').mockImplementation(((name: string, version?: number) => {
            if (version === undefined) {
                throw new Error('plain open refused')
            }
            return real(name, version)
        }) as typeof indexedDB.open)
    }

    test('list still answers the full set while keys exist', async () => {
        const store = createIndexedDbStore()
        failPlainOpens()
        expect(await store.list('store2/')).toEqual(['store2/', 'store2/a', 'store2/b/c'])
    })

    test('has still answers true for an existing key and false for an absent one', async () => {
        const store = createIndexedDbStore()
        failPlainOpens()
        expect(await store.has('store2/a')).toBe(true)
        expect(await store.has('store2/missing')).toBe(false)
    })

    test('countPrefix is null, never zero', async () => {
        const store = createIndexedDbStore()
        failPlainOpens()
        expect(await store.countPrefix?.('store2/')).toBeNull()
    })
})