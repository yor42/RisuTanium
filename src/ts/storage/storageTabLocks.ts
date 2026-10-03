/**
 * Real cross-tab mutual exclusion for an operation that must run with no other
 * tab alive (the copy back of an OPFS-main profile into IndexedDB at startup,
 * `opfsCopyBack.ts`, and the restores), built on the browser's Web Locks
 * API (`navigator.locks`) rather than a ping-and-wait heartbeat — a
 * timeout-based liveness check can never be a genuine guarantee (a
 * backgrounded/suspended tab may simply not get to run its event loop in
 * time, and nothing stops a brand new tab from opening in the gap between
 * "checked, looked clear" and "the switch actually finished").
 *
 * Every tab acquires this lock in SHARED mode for its entire lifetime — the
 * request's callback holds it open via a promise that only resolves on tab
 * unload/release, so the lock's continued existence itself is what
 * "announces this tab is alive" (no heartbeat, no timeout to miss).
 * `acquireExclusiveStorageMigrationLock()` acquires the SAME lock in
 * EXCLUSIVE mode; the browser guarantees that request cannot be granted
 * while any shared holder exists, and holding it for the whole switch (not
 * just a point-in-time check) also blocks any NEW tab's shared acquisition
 * from succeeding until the switch finishes and releases — closing both the
 * "suspended peer missed the ping" and "new tab opened mid-switch" gaps a
 * heartbeat approach cannot.
 *
 * This exclusion also covers the copy back from OPFS at startup, which takes
 * the same exclusive lock around its own copy so that a second tab opening
 * mid-copy waits for it and then reads the already-settled outcome instead of
 * racing a copy of its own.
 *
 * A page that only ever WAITS on this lock (queued for exclusive access, or
 * timed out) can still lose a race the lock itself cannot see: a queued
 * request that times out resumes this tab as a live writer even though a
 * DIFFERENT tab's exclusive operation may have completed and changed the
 * backend or the data out from under it in the meantime, and a request that
 * is eventually granted may have queued behind a stale view formed before
 * some other tab's own operation ran and finished. Both are closed by a
 * shared per-origin storage epoch (`STORAGE_EPOCH_KEY`): every successful
 * exclusive grant writes a fresh random token to it, and an attempt made by
 * a page that already has its own persisted reading of that epoch (see
 * `recordStorageEpoch()`) compares that reading against the token current
 * when it is granted, or when it regains its presence hold after failing to
 * be granted -- a plain counter cannot be
 * told apart from a false match after clearing site data mid-session, but a
 * random token can. A mismatch means some other tab's exclusive operation
 * ran during this attempt's own lifetime, so this attempt reloads instead
 * of proceeding or letting its caller's save loop resume. A page with no
 * persisted reading yet -- still inside its own first `AutoStorage.Init()`,
 * or one whose epoch store could not be read -- skips both comparisons instead of
 * reloading merely for losing an ordinary queued race for this same lock
 * against another such page; see `acquireExclusiveStorageMigrationLock()`'s
 * own doc comment for the full gating and exactly which holds a mismatch
 * keeps and which it releases.
 */

import { markAppInitiatedReload } from "../reloadGuard"

/** The name of the Web Lock shared by every tab's presence hold and by an exclusive storage-backend switch. */
export const STORAGE_TAB_LOCK_NAME = 'risu-storage-tab-presence'

/** The epoch store key `recordStorageEpoch()` reads, under whichever store (`localStorage` by default) `createStorageTabLocks()` was built against. */
export const STORAGE_EPOCH_KEY = 'risu-storage-epoch'

/** The minimal shape `createStorageTabLocks()` needs from a write mutex, matching `AsyncMutex` in `globalApi.svelte.ts`. */
export interface StorageTabWriteLock {
    acquire(): Promise<() => void>
}

/** The minimal shape `createStorageTabLocks()` needs from a per-origin epoch store, matching the subset of the `Storage` interface (e.g. `localStorage`) it actually calls. Injectable so tests can use an isolated store, or one that throws to model a read/write failure, instead of the shared jsdom/happy-dom `localStorage`. */
export interface StorageEpochStore {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

/** Options accepted by `createStorageTabLocks()`, each independently injectable for tests; every option defaults to the real browser primitive it wraps. */
export interface StorageTabLocksOptions {
    /** Backing store for this tab's recorded storage epoch (see `recordStorageEpoch()`). Defaults to `localStorage`. */
    epochStore?: StorageEpochStore
    /**
     * Reloads this page. Defaults to marking the reload as app-initiated
     * (`markAppInitiatedReload()`, `../reloadGuard.ts`) before calling
     * `location.reload()`, so the app's own "Leave site?" guard lets it
     * through. Called by `acquireExclusiveStorageMigrationLock()` itself,
     * never by a caller, whenever it finds the storage epoch has moved past
     * this attempt's own baseline -- injectable so tests can observe that a
     * reload was requested without this page actually navigating.
     */
    reload?: () => void
}

/** One per-tab instance of the storage tab locks: the acquired shared-presence promise and the exclusive-acquire function. */
export interface StorageTabLocks {
    /** Resolves once this tab's own shared presence lock has actually been granted. */
    tabPresenceLockAcquired: Promise<void>
    /**
     * Whether this instance was built against a defined lock manager, i.e.
     * whether Web Locks are actually available in this browser. Lets a
     * caller of `acquireExclusiveStorageMigrationLock()` tell "Web Locks
     * unsupported" apart from "another tab is alive, or the wait timed
     * out" -- both of which that method's own `null` return conflates.
     * Callers MUST compare this with `=== false`, never with a falsy check:
     * an old mock of this contract built before this member existed reads
     * it as `undefined`, and `undefined` must never be treated the same as
     * `false`.
     */
    locksSupported: boolean
    /**
     * Attempts to acquire the same lock in EXCLUSIVE mode, for a storage-backend
     * migration. Resolves to a release function once granted, or
     * `null` if it couldn't be granted within `timeoutMs`
     * (meaning at least one other tab is currently alive), Web Locks isn't
     * supported in this browser at all, or the storage epoch check below
     * caught this attempt overtaken by another tab's exclusive operation
     * (in which case a reload was also requested — see below; a caller
     * cannot tell this apart from an ordinary refusal from the return value
     * alone, and does not need to: both mean "stop, nothing was granted").
     * Internally also acquires the write lock passed to
     * `createStorageTabLocks()` — callers must NOT separately acquire it
     * themselves. A caller that reloads right after its operation may leave
     * the lock unreleased; one that carries on in this page (the copy back
     * from OPFS at startup) must call the release function once its
     * operation is fully done.
     *
     * **The storage epoch.** Every successful grant writes a fresh random
     * token to the shared per-origin epoch store before returning it to the
     * caller, so a later attempt (by this page or another) can tell whether
     * some exclusive operation ran in between. This attempt's own baseline
     * is whichever of these is available: this instance's persisted
     * reading (see `recordStorageEpoch()` -- a page still inside
     * `AutoStorage.Init()`, or one whose epoch store could not be read, has
     * none) if it has one, or else a
     * fresh reading taken right now, before this attempt even queues. Two
     * points compare the current token against that baseline, both gated
     * the same way -- **only when this instance already has a persisted
     * reading**:
     * - **On grant,** before writing the fresh token: a mismatch means some
     *   other tab's exclusive operation ran between this attempt starting
     *   and being granted. This attempt reloads instead of proceeding,
     *   keeping both the exclusive hold just granted and the write lock —
     *   nothing else may act on either before this page is gone.
     * - **On a failed attempt,** once this tab's own presence hold is back:
     *   a mismatch means some other tab's exclusive operation ran while
     *   this attempt waited or timed out. This attempt reloads instead of
     *   letting its caller's own pending save resume, keeping the write
     *   lock — releasing it for even one tick would let a write already
     *   queued behind it land with stale bytes.
     *
     * Both checks are skipped entirely for an instance with no persisted
     * reading yet: two pages that both boot with none, and both attempt
     * this same lock at nearly the same moment, can otherwise race either
     * comparison against each other's own concurrent grant+bump with no
     * third party involved, spuriously reloading whichever one merely lost
     * (or timed out waiting behind) the ordinary queued race for the lock
     * itself. A persisted reading, once this
     * instance has one, was always taken at a distinct, already-settled
     * earlier point (a prior grant of this instance's own, or an explicit
     * `recordStorageEpoch()` call), so comparing against it never races
     * this attempt's own start this way.
     *
     * A successful grant also updates this instance's own persisted
     * reading to the fresh token it just wrote, so a later attempt by the
     * same page needs no separate `recordStorageEpoch()` call to notice its
     * own prior operation. A page's persisted reading is otherwise only
     * ever taken by an explicit `recordStorageEpoch()` call, never
     * re-taken here on an ordinary (non-mismatched) re-acquire of presence.
     * If the epoch store throws while reading this attempt's own baseline,
     * or on the grant path, the attempt is refused (as "not granted") and
     * nothing is written. On the failed-attempt path, a throw while an
     * instance WITH a persisted reading checks for a mismatch is instead
     * treated as a mismatch: reloading with the write lock still held is
     * the only safe response once this instance's own reading exists but
     * the check that would confirm or rule out a mismatch cannot run at
     * all -- resuming writes without ever having verified it is exactly
     * the risk this check exists to close.
     *
     * **The returned release function** runs its effects exactly once, even
     * if called more than once (including with a different argument on a
     * later call — the first call's argument wins). Called with no
     * argument (or `false`), it releases the write lock too, exactly as
     * the copy back from OPFS at startup expects. Called with `true`, it releases only the cross-tab
     * exclusive Web Lock and restores this tab's own shared presence,
     * leaving the write lock closed forever — for a caller whose own write
     * has already landed and who will never write this key again from
     * this page (`LoadLocalBackup()`'s restore, once it is reloading), so
     * that OTHER tabs stop waiting on this one without reopening this
     * page's own ability to write.
     *
     * Ordering here is load-bearing:
     *
     * 1. The write lock is acquired FIRST, before this tab even attempts the
     *    cross-tab exclusive lock. A tab that has only QUEUED for the exclusive
     *    lock (not yet been granted it) is otherwise still a fully active writer
     *    for however long it waits — if a DIFFERENT tab wins that race and starts
     *    migrating, the still-queued tab's autosave loop could write the old
     *    backend concurrently with that migration, silently losing data. Every
     *    tab that even attempts a migration must stop writing immediately, win or
     *    lose the race for the exclusive lock.
     * 2. The exclusive request is queued (the `navigator.locks.request()` call
     *    made) BEFORE releasing this tab's own shared presence hold, not after —
     *    releasing first would leave a window where this tab holds no shared lock
     *    AND has no exclusive request queued yet (invisible to the lock
     *    entirely), during which a concurrent attempt from another tab could slip
     *    in unaccounted-for. Queuing first means this request's position
     *    correctly reflects every other tab's shared hold that exists at the
     *    moment it's queued.
     * 3. Web Locks aren't reentrant and have no shared→exclusive upgrade, so this
     *    tab's own permanent shared hold must be released at all — otherwise step
     *    2's request would deadlock against itself even with zero other tabs
     *    open.
     */
    acquireExclusiveStorageMigrationLock(timeoutMs?: number): Promise<((keepWriteLock?: boolean) => Promise<void>) | null>

    /**
     * Takes a fresh reading of the storage epoch under this instance's
     * epoch store, replacing whatever reading this instance held before.
     * This is the only thing it does: it never compares the new reading
     * against the old one, and it never reloads -- the reading it takes
     * becomes this instance's own baseline for every later
     * `acquireExclusiveStorageMigrationLock()` comparison, until either a
     * later call to this method or that method's own successful grant
     * replaces it. A read failure leaves any existing reading (or the
     * not-yet-recorded state) untouched. Safe to call any number of times.
     */
    recordStorageEpoch(): void
}

/**
 * Builds one `StorageTabLocks` instance against the given lock manager (or
 * `undefined` when Web Locks isn't supported in this browser at all) and
 * write mutex. Production (`globalApi.svelte.ts`) builds exactly one instance
 * per page, passing `navigator.locks` and the same `dbWriteLock` object that
 * `saveDb()` and `LoadLocalBackup()`'s restore write take — a second production instance would let
 * an autosave land in the middle of an exclusive operation, and would give the tab a second shared hold that blocks
 * its own exclusive request. Tests build one instance per simulated tab
 * against a fake lock manager instead. `options` lets a test inject the
 * epoch store `recordStorageEpoch()` reads from, and/or the reload function;
 * both default to the real browser primitive they wrap.
 */
export function createStorageTabLocks(locks: LockManager | undefined, writeLock: StorageTabWriteLock, options: StorageTabLocksOptions = {}): StorageTabLocks {
    const epochStore: StorageEpochStore = options.epochStore ?? localStorage
    const reloadPage: () => void = options.reload ?? (() => {
        markAppInitiatedReload()
        location.reload()
    })

    // The most recent reading recordStorageEpoch() took, or this instance's
    // own last successful exclusive-grant token, whichever happened more
    // recently -- or null if neither has ever happened. hasRecordedEpoch
    // distinguishes that "never recorded" state from "recorded, but the
    // store had no token yet", since both read as null.
    let recordedEpoch: string | null = null
    let hasRecordedEpoch = false

    // Release function for THIS tab's own shared presence hold, or null while
    // none is currently held (e.g. mid-migration-attempt — see
    // acquireExclusiveStorageMigrationLock below).
    let releaseOwnSharedPresenceLock: (() => void) | null = null

    function acquireOwnSharedPresenceLock(): Promise<void> {
        if (!locks) {
            return Promise.resolve()
        }
        return new Promise<void>((resolveAcquired) => {
            locks.request(STORAGE_TAB_LOCK_NAME, { mode: 'shared' }, () => {
                return new Promise<void>((resolveHeld) => {
                    // Deliberately not resolved here — this callback (and therefore the
                    // shared lock) stays held until releaseOwnSharedPresenceLock() is
                    // called, which normally only happens right before requesting the
                    // exclusive lock below (never on ordinary tab lifetime — the lock is
                    // released implicitly when the tab/document goes away).
                    releaseOwnSharedPresenceLock = () => {
                        releaseOwnSharedPresenceLock = null
                        resolveHeld()
                    }
                    resolveAcquired()
                })
            }).catch(() => resolveAcquired())
        })
    }

    /** Resolves once this tab's own shared presence lock has actually been granted. */
    const tabPresenceLockAcquired: Promise<void> = acquireOwnSharedPresenceLock()

    async function acquireExclusiveStorageMigrationLock(timeoutMs = 5000): Promise<((keepWriteLock?: boolean) => Promise<void>) | null> {
        if (!locks) {
            return null
        }

        const releaseWriteLock = await writeLock.acquire()

        // This attempt's own baseline: this instance's persisted reading if
        // it has one, or else a fresh reading taken right now, before this
        // attempt even queues -- see acquireExclusiveStorageMigrationLock's
        // own doc comment for what each comparison against it means. A
        // throw here means the epoch can't be trusted at all, so this
        // attempt never even queues.
        let epochAtAttemptStart: string | null
        try {
            epochAtAttemptStart = hasRecordedEpoch ? recordedEpoch : epochStore.getItem(STORAGE_EPOCH_KEY)
        } catch (error) {
            releaseWriteLock()
            return null
        }

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const exclusiveRequest = new Promise<() => void>((resolveOuter, rejectOuter) => {
            locks.request(STORAGE_TAB_LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, () => {
                return new Promise<void>((resolveHeld) => {
                    resolveOuter(() => resolveHeld())
                })
            }).catch(rejectOuter)
        })
        // Queued above; only now release our own shared hold — see doc comment.
        releaseOwnSharedPresenceLock?.()

        let granted: (() => void) | null = null
        try {
            granted = await exclusiveRequest
        } catch (error) {
            granted = null
        } finally {
            clearTimeout(timer)
        }

        if (!granted) {
            // Didn't get it (another tab is alive, or the wait timed out) — resume
            // correctly announcing this tab as present first, before deciding
            // whether it's safe to let it write again.
            await acquireOwnSharedPresenceLock()
            // Gated on this instance actually having a persisted reading,
            // exactly like the grant path below and for the identical
            // reason: a page still inside its own first-ever
            // `AutoStorage.Init()` has no baseline that means anything yet,
            // so it skips this check entirely instead of reloading merely
            // for losing this race.
            if (hasRecordedEpoch) {
                let epochNow: string | null
                let epochReadFailed = false
                try {
                    epochNow = epochStore.getItem(STORAGE_EPOCH_KEY)
                } catch (error) {
                    epochReadFailed = true
                    epochNow = null
                }
                if (epochReadFailed || epochNow !== epochAtAttemptStart) {
                    // Another tab's exclusive operation ran while this
                    // attempt waited or timed out, or the check itself
                    // could not even run -- treated the same way, since a
                    // page with a persisted reading resuming without
                    // having verified it is exactly the risk this check
                    // exists to rule out. The caller's own pending write
                    // (if any) may be stale bytes that must never land.
                    // Reload instead of resuming; keep the write lock
                    // held, since releasing it for even one tick would let
                    // a write already queued behind it through.
                    reloadPage()
                    return null
                }
            }
            releaseWriteLock()
            return null
        }

        // Gated on this instance actually having a persisted reading: two
        // pages with neither ever recording one (both still inside their own
        // first-ever `AutoStorage.Init()`) can race this exact comparison
        // against EACH OTHER'S own concurrent grant+bump, with no third
        // party involved at all -- the loser's own "fresh reading taken
        // right now" baseline can legitimately be captured a tick before or
        // after the winner's bump, so comparing it here would spuriously
        // reload the loser for nothing more than losing an ordinary queued
        // race for the very same lock. A page with a persisted reading has
        // no such ambiguity: that reading was taken at a distinct, already
        // fully-settled earlier point (a prior grant of its own, or an
        // explicit `recordStorageEpoch()` call), never racing this attempt's
        // own start.
        if (hasRecordedEpoch) {
            let epochOnGrant: string | null
            try {
                epochOnGrant = epochStore.getItem(STORAGE_EPOCH_KEY)
            } catch (error) {
                granted()
                await acquireOwnSharedPresenceLock()
                releaseWriteLock()
                return null
            }
            if (epochOnGrant !== epochAtAttemptStart) {
                // Another tab's exclusive operation ran between this
                // attempt starting and being granted. Reload instead of
                // proceeding on a stale view; keep both this exclusive hold
                // and the write lock until this page is gone.
                reloadPage()
                return null
            }
        }

        try {
            const freshToken = crypto.randomUUID()
            epochStore.setItem(STORAGE_EPOCH_KEY, freshToken)
            recordedEpoch = freshToken
            hasRecordedEpoch = true
        } catch (error) {
            granted()
            await acquireOwnSharedPresenceLock()
            releaseWriteLock()
            return null
        }

        let released = false
        return async (keepWriteLock = false) => {
            if (released) {
                return
            }
            released = true
            granted()
            // Restores this tab's shared presence hold, freeing a new tab
            // (or this same tab's own next attempt) to proceed against an
            // exclusive hold that has nothing left to do. It matters for
            // the copy back from OPFS at startup, whose success path never
            // reloads.
            await acquireOwnSharedPresenceLock()
            if (!keepWriteLock) {
                // Gives back the write lock so saveDb() can write again. A
                // caller whose own write already landed, and who will never
                // write this key again from this page (LoadLocalBackup()'s
                // restore, once reloading), passes keepWriteLock instead --
                // the write lock then stays closed until this page is gone,
                // even though other tabs are free to proceed once the Web
                // Lock above has released.
                releaseWriteLock()
            }
        }
    }

    return {
        tabPresenceLockAcquired,
        locksSupported: locks !== undefined,
        acquireExclusiveStorageMigrationLock,
        recordStorageEpoch() {
            try {
                recordedEpoch = epochStore.getItem(STORAGE_EPOCH_KEY)
                hasRecordedEpoch = true
            } catch (error) {
                // Leave any existing reading (or the not-yet-recorded state)
                // untouched -- a transient read failure here must never
                // manufacture a reading for a later comparison to trust.
            }
        },
    }
}
