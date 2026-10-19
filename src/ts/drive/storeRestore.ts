import { alertError, alertConfirm, alertNormal, alertNormalWait, alertSelect, alertStore, alertWait } from '../alert'
import { acquireExclusiveStorageMigrationLock, afterNextSaveCommit, dbWriteLock, isSaveClean, locksSupported, requestSaveNow, tabPresenceLockAcquired } from '../globalApi.svelte'
import { isAppInitiatedReload } from '../reloadGuard'
import { isTauri } from 'src/ts/platform'
import { language } from 'src/lang'
import { beginBusy, type BusyHandle } from '../process/memory/busyActions'
import { refuseOnReadOnlyPage } from '../storage/readOnlyPage'
import { getStore2BootSession } from '../storage/store2/bootActive'
import type { Store2Backend } from '../storage/store2/backend/types'
import type { Committer } from '../storage/store2/commit'
import { isSaveLoopParked } from '../storage/store2/saveLoop'
import { listRestorePoints, restorePoint, type RestorePointRow } from '../storage/store2/restorePoints'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from './backuplocal'

/**
 * The internal-backup load of a store2 page: the person picks one of the page's
 * restore points and the commit key is pointed at it. Nothing is read from or
 * written to the numbered-backup files, and no unit is written; the previous
 * state stays reachable as a restore point because the restore keeps what was
 * `current` in `retained`.
 *
 * Stub loads in flight are not refused by the busy guard. That is harmless
 * here: the restore ends in a reload, which rebuilds residency, stubs and the
 * identity tracker from the restored state.
 */

/** Releases the exclusive tab hold; `keepWriteLock` leaves `dbWriteLock` closed for the life of the page. */
export type ExclusiveHoldRelease = (keepWriteLock?: boolean) => Promise<void>

export interface StoreRestoreOptions {
    /** The shared tail of every restore that landed: releases the hold's Web Lock part and reloads the page. */
    reload: (releaseExclusiveHold: ExclusiveHoldRelease | null) => Promise<void>
    /** How long the save before the list may wait. */
    saveBoundMs?: number
}

/** The longest the save before the list may take; past it the restore goes on and asks about the edits left. */
export const SAVE_FIRST_BOUND_MS = 10_000

/** Requests made to save one tab's unsaved edits before the list; a second covers an edit made while the first ran. */
const SAVE_FIRST_REQUESTS = 2

/**
 * Saves what this tab has marked before the list is read, so the state the
 * restore keeps as a restore point includes it. A parked loop is left alone:
 * `requestSaveNow` would mark the tab dirty and raise the peer prompt, and a
 * parked loop cannot commit anyway.
 */
async function saveFirst(boundMs: number): Promise<void> {
    if (isSaveLoopParked() || isSaveClean()) {
        return
    }
    alertWait(language.store2RestoreSaving)
    const deadline = Date.now() + boundMs
    for (let request = 0; request < SAVE_FIRST_REQUESTS; request++) {
        const remaining = deadline - Date.now()
        if (isSaveClean() || isSaveLoopParked() || remaining <= 0) {
            return
        }
        await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, remaining)
            afterNextSaveCommit(() => {
                clearTimeout(timer)
                resolve()
            })
            requestSaveNow()
        })
    }
}

function rowLabel(row: RestorePointRow): string {
    const when = row.label === null ? language.store2RestoreDateUnknown : new Date(row.label).toLocaleString()
    return row.damaged ? language.store2RestoreRowDamaged(when) : when
}

/** A turn of the event loop: whatever a finished save still has to do after it released the write lock has been done. */
function nextTurn(): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/**
 * The restore-point picker and restore of a store2 page. Refused before anything
 * is asked while work is in progress, on a page that writes nothing, or without
 * a committer. The caller has already asked the two confirmations.
 *
 * Order: save this tab's edits, list, pick; then the busy entry, the exclusive
 * tab lock, a second look at whether the tab is saved (the one confirmation
 * after the pick, asked only when it is not), and the restore.
 *
 * A damaged row is listed and can be picked; the restore refuses it through its
 * tree check, so there is one authority on whether a point is whole.
 */
export async function loadStoreRestorePoint(options: StoreRestoreOptions): Promise<void> {
    if (refuseBackupLoadWhileBusy()) {
        return
    }
    if (await refuseOnReadOnlyPage()) {
        return
    }
    const session = getStore2BootSession()
    const committer = session === null ? null : session.committer
    const backend = session === null ? null : session.backend
    if (committer === null || backend === null) {
        alertError(language.store2Boot.readOnlyRefusal)
        return
    }

    let rows: RestorePointRow[]
    try {
        await saveFirst(options.saveBoundMs ?? SAVE_FIRST_BOUND_MS)
        const listed = await listRestorePoints(backend, await backend.readCommit())
        if (listed.status !== 'ok') {
            alertError(language.internalBackupListFailed)
            return
        }
        rows = listed.rows
    } catch (error) {
        console.error(error)
        alertError(language.internalBackupListFailed)
        return
    }
    if (rows.length === 0) {
        alertNormal(language.store2RestoreNone)
        return
    }

    const picked = parseInt(await alertSelect(['Cancel', ...rows.map(rowLabel)])) - 1
    const row = rows[picked]
    if (row === undefined) {
        return
    }

    // Registered once a point is chosen, and ended however the restore leaves.
    const busy = beginBusy('backupLoad')
    try {
        await restoreChosen(row, committer, backend, busy, options)
    } finally {
        busy.end()
    }
}

async function restoreChosen(row: RestorePointRow, committer: Committer, backend: Store2Backend, busy: BusyHandle, options: StoreRestoreOptions): Promise<void> {
    // Work can start while the picker is open.
    if (refuseBackupLoadWhileBusy(busy)) {
        return
    }

    // Nothing else on this browser origin may write the profile while the commit
    // key is pointed at the chosen point (MC-093). Tauri is single-instance and
    // skips this check. Once granted, the hold already holds `dbWriteLock`
    // internally: it must NOT be acquired a second time, which would deadlock
    // against this same hold.
    let releaseExclusiveHold: ExclusiveHoldRelease | null = null
    if (!isTauri) {
        if (locksSupported === false) {
            if (!await alertConfirm(language.restoreNoLockWarningConfirm)) {
                return
            }
        } else {
            await tabPresenceLockAcquired
            alertWait(language.restoreCheckingOtherTabs)
            releaseExclusiveHold = await acquireExclusiveStorageMigrationLock(RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS)
            if (!releaseExclusiveHold) {
                // A reload already in flight needs no message: this page is
                // already on its way out. Otherwise another tab is open.
                if (!isAppInitiatedReload()) {
                    alertError(language.restoreOtherTabRefused)
                }
                return
            }
        }
    }

    // Every exit that never changes the commit key shows one message and then
    // releases what was taken above. An exit after the restore landed, or after
    // its outcome could not be confirmed, keeps the write lock closed: a save
    // from this page's pre-restore state must never overwrite the restored
    // profile.
    let releaseDbWriteLock: (() => void) | null = null
    let restoreStarted = false
    let restoreLanded = false
    let writeLockStaysClosed = false
    try {
        if (!releaseExclusiveHold) {
            releaseDbWriteLock = await dbWriteLock.acquire()
        }

        // The loop cannot commit from here on. The turn is a safeguard, not a
        // requirement: a save that was finishing when the lock came free ends its
        // last steps within a few microtasks, so after one turn what is not saved
        // is edits made since this tab's last save, which the restore would lose.
        await nextTurn()
        if (!isSaveClean()) {
            if (!await alertConfirm(language.store2RestoreUnsavedConfirm)) {
                return
            }
        }
        // The same busy check is asked again at the flip.
        if (refuseBackupLoadWhileBusy(busy)) {
            return
        }

        alertWait('Loading backup...')
        restoreStarted = true
        const outcome = await restorePoint(committer, backend, row.key)
        switch (outcome.status) {
            case 'restored':
                restoreLanded = true
                writeLockStaysClosed = true
                if (outcome.flushed === false) {
                    // The commit key is written but the device did not confirm it reached disk. The page
                    // reloads all the same: the start-up re-flush writes the commit key again before anything else.
                    await alertNormalWait(language.store2RestoreNotFlushed)
                } else {
                    alertWait(language.store2RestoreDone)
                }
                await options.reload(releaseExclusiveHold)
                return
            case 'already-current':
            case 'not-named':
                alertError(language.store2RestoreListChanged)
                return
            case 'bulk-marker':
                alertError(language.store2RestoreBulkMarker)
                return
            case 'tree-incomplete':
                alertError(language.store2RestoreIncomplete(outcome.missing.length))
                return
            case 'conflict':
            case 'unknown':
                // The restore may or may not have landed: nothing may save from
                // this page until a reload shows which state is current.
                writeLockStaysClosed = true
                alertStore.set({ type: 'wait', msg: language.store2RestoreUnconfirmed })
                if (releaseExclusiveHold) {
                    await releaseExclusiveHold(true)
                }
                return
            case 'stale-page':
                alertError(language.restoreNotHappenedNotice)
                return
            case 'failed':
                alertError(language.internalBackupWriteFailed)
                return
            case 'refused':
                alertError(language.internalBackupUnreadable)
                return
        }
    } catch (error) {
        console.error(error)
        if (restoreLanded) {
            alertWait(language.restoreSavedReloadOrRestart)
        } else if (restoreStarted) {
            // An error after the restore began leaves the outcome unknown, exactly like an unconfirmed write.
            writeLockStaysClosed = true
            alertStore.set({ type: 'wait', msg: language.store2RestoreUnconfirmed })
            if (releaseExclusiveHold) {
                await releaseExclusiveHold(true)
            }
        } else {
            alertError(language.internalBackupWriteFailed)
        }
    } finally {
        if (!writeLockStaysClosed) {
            if (releaseDbWriteLock) {
                releaseDbWriteLock()
            }
            if (releaseExclusiveHold) {
                await releaseExclusiveHold()
            }
        }
    }
}
