import { alertError, alertConfirm, alertNormal, alertNormalWait, alertSelect, alertStore, alertWait } from '../alert'
import { acquireExclusiveStorageMigrationLock, afterNextSaveCommit, dbWriteLock, isSaveClean, locksSupported, requestSaveNow, tabPresenceLockAcquired } from '../globalApi.svelte'
import { isAppInitiatedReload } from '../reloadGuard'
import { isTauri } from 'src/ts/platform'
import { language } from 'src/lang'
import { beginBusy, type BusyHandle } from '../process/memory/busyActions'
import { readColdStorageItem } from '../process/coldstorage.svelte'
import { refuseOnReadOnlyPage } from '../storage/readOnlyPage'
import { getAppStore } from '../storage/store/appStore'
import { getStore2BootSession } from '../storage/store2/bootActive'
import type { Store2Backend } from '../storage/store2/backend/types'
import type { Committer } from '../storage/store2/commit'
import { createLegacyStoreReader } from '../storage/store2/legacy/storeReader'
import { isSaveLoopParked, isSaveLoopStopped } from '../storage/store2/saveLoop'
import { listRestorePoints, restorePoint, type RestorePointRow } from '../storage/store2/restorePoints'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from './restoreLock'
import { listBackupTimes, NUMBERED_BACKUP_PREFIX } from './backupList'
import {
    announceStore2Import, commitStore2Import, confirmDatabaseSize, confirmLeftOut, decodeNumberedBackup, UnsavedGuard,
    type Store2ImportEnd,
} from './storeImport'
import { emptyImportFacts, numberedBackupTarget, type ImportFacts, type OperationCause, type OperationEnd, type OperationName, type OperationOutcome } from './operationEnd'

/**
 * The internal-backup load of a store2 page: the person picks one of the page's restore points, or one of the old
 * numbered backups the page still holds, and the commit key is pointed at it. A restore point is pointed at as it is
 * and no unit is written. An old numbered backup is imported as a whole new profile through the shared import
 * (`storeImport.ts`), which writes the units of the imported tree. Either way the previous state stays reachable as a
 * restore point because the commit keeps what was `current` in `retained`.
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
 * parked loop cannot commit anyway. A stopped loop (a body the server refuses as too large) cannot commit either and
 * would only run out the bound, so it is left alone too.
 */
export async function saveFirst(boundMs: number): Promise<void> {
    if (isSaveLoopParked() || isSaveLoopStopped() || isSaveClean()) {
        return
    }
    alertWait(language.store2RestoreSaving)
    const deadline = Date.now() + boundMs
    for (let request = 0; request < SAVE_FIRST_REQUESTS; request++) {
        const remaining = deadline - Date.now()
        if (isSaveClean() || isSaveLoopParked() || isSaveLoopStopped() || remaining <= 0) {
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

/** An old numbered backup is named by `n`, the time it was made in tenths of a second. */
function oldRowLabel(time: number): string {
    return language.store2RestoreOldRow(new Date(time * 100).toLocaleString())
}

/** What the person picked: a restore point of the page, or an old numbered backup. */
type Picked =
    | { kind: 'point', row: RestorePointRow }
    | { kind: 'old', time: number }

/** What a restore came to, before the shell names the operation and target: how it ended, why, and the facts it knows. */
interface RunEnd {
    outcome: OperationOutcome
    cause: OperationCause | null
    facts?: Partial<ImportFacts>
}

const nothingReplaced = (cause: OperationCause | null = null): RunEnd => ({ outcome: 'nothing-replaced', cause })

/** A restore before anything is picked has no target and no source. */
function endBeforePick(outcome: OperationOutcome, cause: OperationCause | null = null): OperationEnd<ImportFacts> {
    return { operation: 'restore-point', target: null, outcome, cause, detail: emptyImportFacts() }
}

function endOfRun(operation: OperationName, target: string, picked: Picked, run: RunEnd): OperationEnd<ImportFacts> {
    const source: ImportFacts['source'] = picked.kind === 'point' ? { kind: 'restore-point', label: target } : { kind: 'numbered', time: picked.time }
    return { operation, target, outcome: run.outcome, cause: run.cause, detail: { ...emptyImportFacts(source), ...run.facts } }
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
 * The list is the restore points, newest first, then the old numbered backups,
 * newest first, each labelled `Old:`. The old ones are listed without pruning
 * and are never written by this page.
 *
 * A damaged row is listed and can be picked; the restore refuses it through its
 * tree check, so there is one authority on whether a point is whole.
 */
export async function loadStoreRestorePoint(options: StoreRestoreOptions): Promise<OperationEnd<ImportFacts>> {
    if (refuseBackupLoadWhileBusy()) {
        return endBeforePick('nothing-replaced', 'busy')
    }
    if (await refuseOnReadOnlyPage()) {
        return endBeforePick('nothing-replaced')
    }
    const session = getStore2BootSession()
    const committer = session === null ? null : session.committer
    const backend = session === null ? null : session.backend
    if (committer === null || backend === null) {
        alertError(language.store2Boot.readOnlyRefusal)
        return endBeforePick('nothing-replaced', 'no-writable-session')
    }

    let rows: RestorePointRow[]
    let oldTimes: number[]
    try {
        await saveFirst(options.saveBoundMs ?? SAVE_FIRST_BOUND_MS)
        const listed = await listRestorePoints(backend, await backend.readCommit())
        if (listed.status !== 'ok') {
            alertError(language.internalBackupListFailed)
            return endBeforePick('nothing-replaced')
        }
        rows = listed.rows
        oldTimes = await listBackupTimes()
    } catch (error) {
        console.error(error)
        alertError(language.internalBackupListFailed)
        return endBeforePick('nothing-replaced')
    }
    if (rows.length === 0 && oldTimes.length === 0) {
        alertNormal(language.store2RestoreNone)
        return endBeforePick('nothing-replaced')
    }

    const picked = parseInt(await alertSelect(['Cancel', ...rows.map(rowLabel), ...oldTimes.map(oldRowLabel)])) - 1
    let target: Picked
    if (picked >= 0 && picked < rows.length) {
        target = { kind: 'point', row: rows[picked] }
    } else if (picked >= rows.length && picked - rows.length < oldTimes.length) {
        target = { kind: 'old', time: oldTimes[picked - rows.length] }
    } else {
        return endBeforePick('canceled')
    }

    // Registered once a point is chosen, and ended however the restore leaves.
    const busy = beginBusy('backupLoad')
    try {
        if (target.kind === 'point') {
            const label = rowLabel(target.row)
            return endOfRun('restore-point', label, target, await restoreChosen(target.row, committer, backend, busy, options))
        }
        return endOfRun('restore-numbered', numberedBackupTarget(target.time), target, await restoreOldChosen(target.time, committer, backend, busy, options))
    } finally {
        busy.end()
    }
}

/** What a restore that holds the tab exclusively reports to its shell: how far it got decides what the exits release. */
interface ExclusiveRun {
    /** The hold's Web Lock part, when this page took one. */
    releaseExclusiveHold: ExclusiveHoldRelease | null
    /** The restore began writing, so a throw leaves its outcome unknown. */
    started: boolean
    /** The restored state is the page's profile. */
    landed: boolean
    /** An exit that landed, or could not tell whether it landed, keeps the write lock closed. */
    staysClosed: boolean
}

/**
 * Takes the exclusive tab hold (or `dbWriteLock` where there is none), asks the one confirmation about edits this tab
 * could not save, asks the busy guard again at the flip, and runs `perform` under that.
 *
 * Every exit that never changes the commit key shows one message and then
 * releases what was taken. An exit after the restore landed, or after
 * its outcome could not be confirmed, keeps the write lock closed: a save
 * from this page's pre-restore state must never overwrite the restored
 * profile.
 */
async function runExclusively(busy: BusyHandle, perform: (run: ExclusiveRun) => Promise<RunEnd>): Promise<RunEnd> {
    // Work can start while the picker is open.
    if (refuseBackupLoadWhileBusy(busy)) {
        return nothingReplaced('busy')
    }

    // Nothing else on this browser origin may write the profile while the commit
    // key is pointed at the chosen point (MC-093). Tauri is single-instance and
    // skips this check. Once granted, the hold already holds `dbWriteLock`
    // internally: it must NOT be acquired a second time, which would deadlock
    // against this same hold.
    const run: ExclusiveRun = { releaseExclusiveHold: null, started: false, landed: false, staysClosed: false }
    if (!isTauri) {
        if (locksSupported === false) {
            if (!await alertConfirm(language.restoreNoLockWarningConfirm)) {
                return { outcome: 'canceled', cause: null }
            }
        } else {
            await tabPresenceLockAcquired
            alertWait(language.restoreCheckingOtherTabs)
            run.releaseExclusiveHold = await acquireExclusiveStorageMigrationLock(RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS)
            if (!run.releaseExclusiveHold) {
                // A reload already in flight needs no message: this page is
                // already on its way out. Otherwise another tab is open.
                if (!isAppInitiatedReload()) {
                    alertError(language.restoreOtherTabRefused)
                }
                return nothingReplaced()
            }
        }
    }

    let releaseDbWriteLock: (() => void) | null = null
    try {
        if (!run.releaseExclusiveHold) {
            releaseDbWriteLock = await dbWriteLock.acquire()
        }

        // The loop cannot commit from here on. The turn inside the guard is a safeguard, not a
        // requirement: a save that was finishing when the lock came free ends its
        // last steps within a few microtasks, so after one turn what is not saved
        // is edits made since this tab's last save, which the restore would lose.
        if (!await new UnsavedGuard().check()) {
            return { outcome: 'canceled', cause: null }
        }
        // The same busy check is asked again at the flip.
        if (refuseBackupLoadWhileBusy(busy)) {
            return nothingReplaced('busy')
        }

        return await perform(run)
    } catch (error) {
        console.error(error)
        if (run.landed) {
            alertWait(language.restoreSavedReloadOrRestart)
            return { outcome: 'committed', cause: null }
        } else if (run.started) {
            // An error after the restore began leaves the outcome unknown, exactly like an unconfirmed write.
            run.staysClosed = true
            alertStore.set({ type: 'wait', msg: language.store2RestoreUnconfirmed })
            if (run.releaseExclusiveHold) {
                await run.releaseExclusiveHold(true)
            }
            return { outcome: 'unknown', cause: null }
        } else {
            alertError(language.internalBackupWriteFailed)
            return { outcome: 'failed', cause: null }
        }
    } finally {
        if (!run.staysClosed) {
            if (releaseDbWriteLock) {
                releaseDbWriteLock()
            }
            if (run.releaseExclusiveHold) {
                await run.releaseExclusiveHold()
            }
        }
    }
}

async function restoreChosen(row: RestorePointRow, committer: Committer, backend: Store2Backend, busy: BusyHandle, options: StoreRestoreOptions): Promise<RunEnd> {
    return await runExclusively(busy, async (run) => {
        alertWait('Loading backup...')
        run.started = true
        const outcome = await restorePoint(committer, backend, row.key)
        switch (outcome.status) {
            case 'restored':
                run.landed = true
                run.staysClosed = true
                if (outcome.flushed === false) {
                    // The commit key is written but the device did not confirm it reached disk. The page
                    // reloads all the same: the start-up re-flush writes the commit key again before anything else.
                    await alertNormalWait(language.store2RestoreNotFlushed)
                } else {
                    alertWait(language.store2RestoreDone)
                }
                await options.reload(run.releaseExclusiveHold)
                return { outcome: 'committed', cause: null, facts: { flushed: outcome.flushed } }
            case 'already-current':
            case 'not-named':
                alertError(language.store2RestoreListChanged)
                return nothingReplaced()
            case 'bulk-marker':
                alertError(language.store2RestoreBulkMarker)
                return nothingReplaced('marker-standing')
            case 'tree-incomplete':
                alertError(language.store2RestoreIncomplete(outcome.missing.length))
                return nothingReplaced()
            case 'conflict':
            case 'unknown':
                // The restore may or may not have landed: nothing may save from
                // this page until a reload shows which state is current.
                run.staysClosed = true
                alertStore.set({ type: 'wait', msg: language.store2RestoreUnconfirmed })
                if (run.releaseExclusiveHold) {
                    await run.releaseExclusiveHold(true)
                }
                return { outcome: 'unknown', cause: null }
            case 'stale-page':
                alertError(language.restoreNotHappenedNotice)
                return nothingReplaced('stale-page')
            case 'failed':
                alertError(language.internalBackupWriteFailed)
                return { outcome: 'failed', cause: 'write-failed' }
            case 'refused':
                alertError(language.internalBackupUnreadable)
                return nothingReplaced()
        }
    })
}

/** An old numbered backup's bytes, or null with the message shown when it is gone or cannot be read. */
async function readOldBackup(time: number): Promise<Uint8Array | null> {
    try {
        const stored = (await (await getAppStore()).read(`${NUMBERED_BACKUP_PREFIX}${time}.bin`)).bytes
        if (!stored) {
            alertError(language.store2RestoreListChanged)
            return null
        }
        // A store may hand back a Buffer (a Uint8Array subclass); the copy makes the value decoded a plain Uint8Array.
        return Object.getPrototypeOf(stored) === Uint8Array.prototype ? stored : new Uint8Array(stored)
    } catch (error) {
        console.error(error)
        alertError(language.store2ImportReadFailed)
        return null
    }
}

/**
 * Restores an old numbered backup as the page's profile. Everything that can refuse comes before the tab lock and
 * before any write: the bytes are read, a large one is announced, the decode is strict and then salvaging (framing or
 * root damage refuses it whole), and what a salvage leaves out is named and confirmed. The archived units it points at
 * are the page's own legacy units. A failed write, a decline or a refusal leaves the page as it was.
 */
async function restoreOldChosen(time: number, committer: Committer, backend: Store2Backend, busy: BusyHandle, options: StoreRestoreOptions): Promise<RunEnd> {
    if (refuseBackupLoadWhileBusy(busy)) {
        return nothingReplaced('busy')
    }
    const bytes = await readOldBackup(time)
    if (bytes === null) {
        return nothingReplaced()
    }
    if (!await confirmDatabaseSize(bytes.length)) {
        return { outcome: 'canceled', cause: null }
    }
    // The salvage map of the file, kept after the person confirmed what it leaves out.
    let omitted: ImportFacts['omitted']
    try {
        const decoded = await decodeNumberedBackup(bytes)
        if (!await confirmLeftOut(decoded.omitted)) {
            return { outcome: 'canceled', cause: null }
        }
        omitted = decoded.omitted
    } catch (error) {
        console.error(error)
        alertError(language.internalBackupUnreadable)
        return nothingReplaced()
    }

    return await runExclusively(busy, async (run) => {
        alertWait('Loading backup...')
        run.started = true
        const end: Store2ImportEnd = await commitStore2Import({
            target: { committer, backend },
            busy,
            decode: async () => (await decodeNumberedBackup(bytes)).tree,
            reader: createLegacyStoreReader(readColdStorageItem),
        })
        switch (end.kind) {
            case 'refused':
                return nothingReplaced(end.cause)
            case 'unconfirmed':
                run.staysClosed = true
                if (run.releaseExclusiveHold) {
                    await run.releaseExclusiveHold(true)
                }
                return { outcome: 'unknown', cause: null }
            case 'landed':
                run.landed = true
                run.staysClosed = true
                await announceStore2Import(end, [], () => options.reload(run.releaseExclusiveHold))
                return { outcome: 'committed', cause: null, facts: { flushed: end.flushed, repair: end.repair, incomplete: end.incomplete, omitted } }
        }
    })
}
