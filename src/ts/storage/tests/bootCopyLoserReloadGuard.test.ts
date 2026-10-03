// @vitest-environment happy-dom

/**
 * `createStorageTabLocks()` (`../storageTabLocks`): a page with no persisted
 * storage-epoch reading of its own -- still inside its first
 * `AutoStorage.Init()`, or one whose epoch store could not be read -- never
 * reloads merely for losing the race for the exclusive lock. The failed-attempt
 * comparison is skipped for such a page. These are compatibility guards: if
 * that comparison ran for such a page, a loser that queued before the
 * winner's grant, and whose wait outlasts it, would request a reload it must
 * not request.
 *
 * Drives the REAL, unmocked `createStorageTabLocks()` against two simulated
 * tabs sharing one `FakeLockManagerCore` (`./fakeWebLocks`), neither of
 * which ever calls `recordStorageEpoch()`. `makeSimulatedTab()`'s own
 * `reload` option captures whether the loser ever asked to reload, without
 * it actually navigating.
 *
 * The loser's own failed-attempt flow does not even reach its epoch
 * comparison until its presence hold is back, and that hold cannot be
 * granted while the winner still holds the exclusive lock -- so the loser's
 * OWN internal wait timing out (its `AbortSignal` firing) and the loser's
 * outer `acquireExclusiveStorageMigrationLock()` call actually resolving
 * are two different moments here. Every test below lets the internal
 * timeout elapse first, then releases the winner, then awaits the loser's
 * outer call -- releasing the winner any earlier would let the loser's
 * still-queued exclusive request be granted instead of timing out at all.
 */
import { describe, expect, test, vi } from 'vitest'
import { FakeLockManagerCore, makeSimulatedTab } from './fakeWebLocks'

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('a lock loser with no persisted epoch reading never reloads for losing the race', () => {
    test('compatibility guard: a copy longer than the loser\'s own timeout leaves the loser un-reloaded', async () => {
        const core = new FakeLockManagerCore()
        const loserReload = vi.fn()
        const winner = makeSimulatedTab(core, 'winner')
        const loser = makeSimulatedTab(core, 'loser', { reload: loserReload })
        // Each tab's own presence hold must actually be granted first, or
        // releasing it before requesting exclusive access would be a no-op,
        // leaving that hold to deadlock this same tab's own exclusive request
        // against itself.
        await winner.locks.tabPresenceLockAcquired
        await loser.locks.tabPresenceLockAcquired

        // Both tabs attempt within the same synchronous tick, exactly as two
        // tabs racing for the copy back would: the winner's
        // own request queues first, so it is the one granted (and the one
        // whose grant bumps the shared epoch) once both tabs release their
        // permanent shared presence holds to queue for exclusive access.
        const winnerAttempt = winner.locks.acquireExclusiveStorageMigrationLock(5000) // "the copy" -- held well past the loser's own timeout below
        const loserAttempt = loser.locks.acquireExclusiveStorageMigrationLock(150)

        const releaseWinner = await winnerAttempt
        expect(releaseWinner).not.toBeNull()

        // The loser's own internal wait elapses while the winner is still
        // "copying" (holding the lock) -- the loser's outer call stays
        // pending regardless, re-requesting its presence hold behind the
        // winner's still-held exclusive lock.
        await tick(250)

        // The winner "finishes the copy" and releases -- only now can the
        // loser's presence hold (and its epoch comparison) proceed.
        await releaseWinner?.()

        expect(await loserAttempt).toBeNull()
        expect(loserReload).not.toHaveBeenCalled()
    }, 10000)

    test('compatibility guard: the winner closing its tab after the loser\'s own exclusive request already timed out leaves the loser un-reloaded', async () => {
        const core = new FakeLockManagerCore()
        const loserReload = vi.fn()
        const winner = makeSimulatedTab(core, 'winner')
        const loser = makeSimulatedTab(core, 'loser', { reload: loserReload })
        await winner.locks.tabPresenceLockAcquired
        await loser.locks.tabPresenceLockAcquired

        const winnerAttempt = winner.locks.acquireExclusiveStorageMigrationLock(5000)
        const loserAttempt = loser.locks.acquireExclusiveStorageMigrationLock(150)

        const releaseWinner = await winnerAttempt
        expect(releaseWinner).not.toBeNull()

        // The loser's own internal wait elapses first.
        await tick(250)

        // The winner's tab closes, rather than the winner calling its own
        // release(), which a closed tab never does.
        winner.close()

        expect(await loserAttempt).toBeNull()
        expect(loserReload).not.toHaveBeenCalled()
    }, 10000)
})
