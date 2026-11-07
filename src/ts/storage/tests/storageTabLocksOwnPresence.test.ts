// @vitest-environment node
/**
 * `holdsOwnPresence`: true only while this tab holds its own shared presence lock. A tab that does not hold it cannot
 * read a lock snapshot as proof about other tabs.
 */
import { describe, expect, test } from 'vitest'
import { createStorageTabLocks, type StorageEpochStore } from '../storageTabLocks'
import { FakeAsyncMutex, FakeLockManagerCore, FakeTabLockManagerView } from './fakeWebLocks'

function epochStore(): StorageEpochStore {
    const items = new Map<string, string>()
    return {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => { items.set(key, value) },
    }
}

function tabOf(core: FakeLockManagerCore, tabId: string) {
    const view = new FakeTabLockManagerView(core, tabId)
    return createStorageTabLocks(view as unknown as LockManager, new FakeAsyncMutex(), { epochStore: epochStore(), reload: () => {} })
}

async function until(condition: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 4000
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}.`)
        }
        await new Promise(resolve => setTimeout(resolve, 1))
    }
}

describe('holdsOwnPresence', () => {
    test('is true once the presence lock has been granted', async () => {
        const tab = tabOf(new FakeLockManagerCore(), 'a')
        await tab.tabPresenceLockAcquired
        expect(tab.holdsOwnPresence()).toBe(true)
    })

    test('is false after the presence request was rejected', async () => {
        const rejecting = { request: () => Promise.reject(new DOMException('denied', 'SecurityError')) }
        const tab = createStorageTabLocks(rejecting as unknown as LockManager, new FakeAsyncMutex(), { epochStore: epochStore(), reload: () => {} })
        await tab.tabPresenceLockAcquired
        expect(tab.holdsOwnPresence()).toBe(false)
    })

    test('is false while an exclusive attempt has released the hold, and true again once it gave up', async () => {
        const core = new FakeLockManagerCore()
        const a = tabOf(core, 'a')
        const b = tabOf(core, 'b')
        await Promise.all([a.tabPresenceLockAcquired, b.tabPresenceLockAcquired])
        const attempt = a.acquireExclusiveStorageMigrationLock(300)
        await until(() => !a.holdsOwnPresence(), 'the released hold')
        expect(await attempt).toBeNull()
        expect(a.holdsOwnPresence()).toBe(true)
    })

    test('is false without Web Locks', async () => {
        const tab = createStorageTabLocks(undefined, new FakeAsyncMutex(), { epochStore: epochStore() })
        await tab.tabPresenceLockAcquired
        expect(tab.holdsOwnPresence()).toBe(false)
    })
})
