// @vitest-environment node
/**
 * Which head swap and commit lock each kind of store gets, and that a page
 * builds at most one owner. The factories are real functions wrapped in spies,
 * so a test sees which ones a kind reaches and with what; the stores are
 * in-memory stand-ins.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    kind: 'tauri' as 'tauri' | 'node' | 'opfs-transitional' | 'indexeddb',
    store: null as unknown,
    storeCalls: 0,
    storeFailure: null as Error | null,
}))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => {
        h.storeCalls++
        if (h.storeFailure !== null) {
            throw h.storeFailure
        }
        return h.store
    },
    getAppStoreKind: async () => {
        if (h.storeFailure !== null) {
            throw h.storeFailure
        }
        return h.kind
    },
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/storage/headSwap'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        createMutexHeadSwap: vi.fn(original.createMutexHeadSwap),
        createNodeHeadSwap: vi.fn(original.createNodeHeadSwap),
    }
})

vi.mock(import('src/ts/storage/store/indexedDbStore'), async (importOriginal) => {
    const original = await importOriginal()
    return { ...original, createIndexedDbHeadSwap: vi.fn(original.createIndexedDbHeadSwap) }
})

vi.mock(import('src/ts/storage/blockStore'), async (importOriginal) => {
    const original = await importOriginal()
    return {
        ...original,
        createProcessCommitLock: vi.fn(original.createProcessCommitLock),
        createWebCommitLock: vi.fn(original.createWebCommitLock),
    }
})

import { BlockStoreOwner, createProcessCommitLock, createWebCommitLock } from 'src/ts/storage/blockStore'
import { createMutexHeadSwap, createNodeHeadSwap } from 'src/ts/storage/headSwap'
import { createIndexedDbHeadSwap } from 'src/ts/storage/store/indexedDbStore'
import { getPageBlockOwner, resetPageBlockOwnerForTests } from 'src/ts/storage/pageBlockOwner'
import { createFakeStore, makeSet } from './blockStoreHarness'

const fakeLocks = { request: async <T>(_name: string, _options: unknown, callback: (lock: unknown) => Promise<T>) => await callback({}) }

beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    resetPageBlockOwnerForTests()
    h.kind = 'tauri'
    h.store = createFakeStore({ versioned: false })
    h.storeCalls = 0
    h.storeFailure = null
})

function withNavigator(locks: unknown): void {
    vi.stubGlobal('navigator', locks === undefined ? {} : { locks })
}

describe('the owner each store kind gets', () => {
    test('Tauri: the in-process head swap and the in-process commit lock, whether or not Web Locks exist', async () => {
        for (const locks of [undefined, fakeLocks]) {
            resetPageBlockOwnerForTests()
            vi.clearAllMocks()
            withNavigator(locks)
            h.kind = 'tauri'
            expect(await getPageBlockOwner()).toBeInstanceOf(BlockStoreOwner)
            expect(createMutexHeadSwap).toHaveBeenCalledTimes(1)
            expect(createMutexHeadSwap).toHaveBeenCalledWith(h.store)
            expect(createProcessCommitLock).toHaveBeenCalledTimes(1)
            expect(createProcessCommitLock).toHaveBeenCalledWith(h.store)
            expect(createNodeHeadSwap).not.toHaveBeenCalled()
            expect(createIndexedDbHeadSwap).not.toHaveBeenCalled()
            expect(createWebCommitLock).not.toHaveBeenCalled()
        }
    })

    test('Node: the revision head swap and the Web Locks commit lock', async () => {
        withNavigator(fakeLocks)
        h.kind = 'node'
        h.store = createFakeStore({ versioned: true })
        expect(await getPageBlockOwner()).toBeInstanceOf(BlockStoreOwner)
        expect(createNodeHeadSwap).toHaveBeenCalledTimes(1)
        expect(createNodeHeadSwap).toHaveBeenCalledWith(h.store)
        expect(createWebCommitLock).toHaveBeenCalledTimes(1)
        expect(createWebCommitLock).toHaveBeenCalledWith(fakeLocks)
        expect(createMutexHeadSwap).not.toHaveBeenCalled()
        expect(createProcessCommitLock).not.toHaveBeenCalled()
    })

    test('Node on a page without Web Locks: the same swap and a commit lock that is not available', async () => {
        withNavigator(undefined)
        h.kind = 'node'
        h.store = createFakeStore({ versioned: true })
        await getPageBlockOwner()
        expect(createNodeHeadSwap).toHaveBeenCalledTimes(1)
        expect(createWebCommitLock).toHaveBeenCalledWith(undefined)
        const lock = vi.mocked(createWebCommitLock).mock.results[0].value as { available: boolean }
        expect(lock.available).toBe(false)
    })

    test('IndexedDB: the transaction head swap and the Web Locks commit lock', async () => {
        withNavigator(fakeLocks)
        h.kind = 'indexeddb'
        expect(await getPageBlockOwner()).toBeInstanceOf(BlockStoreOwner)
        expect(createIndexedDbHeadSwap).toHaveBeenCalledTimes(1)
        expect(createWebCommitLock).toHaveBeenCalledTimes(1)
        expect(createWebCommitLock).toHaveBeenCalledWith(fakeLocks)
        expect(createMutexHeadSwap).not.toHaveBeenCalled()
        expect(createNodeHeadSwap).not.toHaveBeenCalled()
        expect(createProcessCommitLock).not.toHaveBeenCalled()
    })

    test('IndexedDB without Web Locks: the same swap and a commit lock that is not available', async () => {
        withNavigator(undefined)
        h.kind = 'indexeddb'
        await getPageBlockOwner()
        expect(createIndexedDbHeadSwap).toHaveBeenCalledTimes(1)
        expect(createWebCommitLock).toHaveBeenCalledWith(undefined)
        expect((vi.mocked(createWebCommitLock).mock.results[0].value as { available: boolean }).available).toBe(false)
    })

    test('the transitional OPFS page gets no owner and no factory runs', async () => {
        h.kind = 'opfs-transitional'
        expect(await getPageBlockOwner()).toBeNull()
        for (const factory of [createMutexHeadSwap, createNodeHeadSwap, createIndexedDbHeadSwap, createProcessCommitLock, createWebCommitLock]) {
            expect(factory).not.toHaveBeenCalled()
        }
    })
})

describe('one owner per page', () => {
    test('every call, including concurrent ones, gets the same owner and builds it once', async () => {
        h.kind = 'tauri'
        const [a, b, c] = await Promise.all([getPageBlockOwner(), getPageBlockOwner(), getPageBlockOwner()])
        expect(a).toBeInstanceOf(BlockStoreOwner)
        expect(b).toBe(a)
        expect(c).toBe(a)
        expect(await getPageBlockOwner()).toBe(a)
        expect(createMutexHeadSwap).toHaveBeenCalledTimes(1)
        expect(createProcessCommitLock).toHaveBeenCalledTimes(1)
    })

    test('the page without an owner stays without one and does not ask again', async () => {
        h.kind = 'opfs-transitional'
        expect(await getPageBlockOwner()).toBeNull()
        const calls = h.storeCalls
        expect(await getPageBlockOwner()).toBeNull()
        expect(h.storeCalls).toBe(calls)
    })

    test('a store selection that failed fails every call the same way and builds nothing', async () => {
        h.storeFailure = new Error('selection failed')
        await expect(getPageBlockOwner()).rejects.toThrow('selection failed')
        await expect(getPageBlockOwner()).rejects.toThrow('selection failed')
        expect(createMutexHeadSwap).not.toHaveBeenCalled()
        expect(createProcessCommitLock).not.toHaveBeenCalled()
    })

    test('the owner it builds works on the store: it seeds an empty profile', async () => {
        h.kind = 'tauri'
        const owner = await getPageBlockOwner()
        const result = await owner?.seedEmptyProfile(makeSet({ characters: [{ chaId: 'alice' }] }))
        expect(result).toMatchObject({ kind: 'replaced', result: { kind: 'won' } })
        expect(owner?.isLive()).toBe(true)
    })
})
