// @vitest-environment jsdom
/**
 * A page restored from the back/forward cache voids its own presence claim for good, keeps the write lock and the
 * shared hold, and asks for a reload. A `pageshow` that is not a persisted restore does nothing.
 */
import { describe, expect, test, vi } from 'vitest'
import { createStorageTabLocks, type StorageEpochStore } from '../storageTabLocks'
import { FakeAsyncMutex, FakeLockManagerCore, FakeTabLockManagerView } from './fakeWebLocks'

function epochStore(): StorageEpochStore {
    const items = new Map<string, string>()
    return {
        getItem: (key) => items.get(key) ?? null,
        setItem: (key, value) => { items.set(key, value) },
    }
}

function restore(target: EventTarget) {
    target.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
}

function tabOf(core: FakeLockManagerCore, tabId: string, win: EventTarget | null, mutex = new FakeAsyncMutex()) {
    const reload = vi.fn()
    const view = new FakeTabLockManagerView(core, tabId)
    const tab = createStorageTabLocks(view as unknown as LockManager, mutex, { epochStore: epochStore(), reload, win })
    return { tab, reload, mutex }
}

function settledWithin<T>(promise: Promise<T>, ms: number): Promise<'settled' | 'pending'> {
    return Promise.race([
        promise.then(() => 'settled' as const, () => 'settled' as const),
        new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), ms)),
    ])
}

describe('back/forward-cache restore', () => {
    test('S0-T1: a restored page requests a reload once and voids its presence claim', async () => {
        const win = new EventTarget()
        const { tab, reload } = tabOf(new FakeLockManagerCore(), 'a', win)
        await tab.tabPresenceLockAcquired
        expect(tab.holdsOwnPresence()).toBe(true)
        restore(win)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(tab.holdsOwnPresence()).toBe(false)
    })

    test('S0-T2: a pageshow that is not a persisted restore does nothing', async () => {
        const win = new EventTarget()
        const { tab, reload } = tabOf(new FakeLockManagerCore(), 'a', win)
        await tab.tabPresenceLockAcquired
        win.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))
        win.dispatchEvent(new Event('pageshow'))
        expect(reload).not.toHaveBeenCalled()
        expect(tab.holdsOwnPresence()).toBe(true)
    })

    test('S0-T3: after a restore the page write lock stays closed', async () => {
        const win = new EventTarget()
        const { tab, mutex } = tabOf(new FakeLockManagerCore(), 'a', win)
        await tab.tabPresenceLockAcquired
        restore(win)
        const next = mutex.acquire()
        expect(await settledWithin(next, 50)).toBe('pending')
    })

    test('S0-T4: an exclusive attempt in flight at the restore cannot revive the presence claim, and no new attempt starts', async () => {
        const core = new FakeLockManagerCore()
        const win = new EventTarget()
        const a = tabOf(core, 'a', win)
        const b = tabOf(core, 'b', null)
        await Promise.all([a.tab.tabPresenceLockAcquired, b.tab.tabPresenceLockAcquired])
        const attempt = a.tab.acquireExclusiveStorageMigrationLock(300)
        await vi.waitFor(() => expect(a.tab.holdsOwnPresence()).toBe(false))
        restore(win)
        expect(await attempt).toBeNull()
        expect(a.tab.holdsOwnPresence()).toBe(false)
        expect(a.reload).toHaveBeenCalledTimes(1)
        const later = a.tab.acquireExclusiveStorageMigrationLock(100)
        expect(await settledWithin(later, 300)).toBe('pending')
    })

    test('S0-T5: a page built with no win ignores a restore on the global window', async () => {
        const { tab, reload } = tabOf(new FakeLockManagerCore(), 'a', null)
        await tab.tabPresenceLockAcquired
        restore(window)
        expect(reload).not.toHaveBeenCalled()
        expect(tab.holdsOwnPresence()).toBe(true)
    })

    test('S0-T7: a restored page keeps its shared hold, so another tab exclusive attempt is still refused (compatibility guard)', async () => {
        const core = new FakeLockManagerCore()
        const win = new EventTarget()
        const a = tabOf(core, 'a', win)
        const b = tabOf(core, 'b', null)
        await Promise.all([a.tab.tabPresenceLockAcquired, b.tab.tabPresenceLockAcquired])
        restore(win)
        expect(await b.tab.acquireExclusiveStorageMigrationLock(100)).toBeNull()
        expect(b.tab.holdsOwnPresence()).toBe(true)
    })

    // Last in the file: it is the only test that installs a listener on the jsdom global window; S0-T5
    // dispatches there earlier and must find none.
    test('S0-T1w: with no win option the listener is installed on the global window', async () => {
        const reload = vi.fn()
        const view = new FakeTabLockManagerView(new FakeLockManagerCore(), 'w')
        const tab = createStorageTabLocks(view as unknown as LockManager, new FakeAsyncMutex(), { epochStore: epochStore(), reload })
        await tab.tabPresenceLockAcquired
        restore(window)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(tab.holdsOwnPresence()).toBe(false)
    })
})
