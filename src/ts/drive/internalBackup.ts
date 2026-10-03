import { alertClear, alertConfirm, alertError, alertSelect, alertWait } from "../alert";
import { dbWriteLock, tabPresenceLockAcquired, acquireExclusiveStorageMigrationLock, locksSupported } from "../globalApi.svelte";
import { markAppInitiatedReload, isAppInitiatedReload } from "../reloadGuard";
import { isTauri } from "src/ts/platform"
import { decodeRisuSave } from "../storage/risuSave";
import { noteMainFileBytes } from "../storage/mainFileRecord";
import { getAppStore, writeMainFile } from "../storage/store/appStore";
import { getStartupCleanup } from "../storage/startupCleanupState";
import { relaunch } from "@tauri-apps/plugin-process";
import { language } from "src/lang";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { RESTORE_EXCLUSIVE_LOCK_TIMEOUT_MS } from "./backuplocal";

const SNAPSHOT_KEY_PREFIX = 'database/dbbackup-'

/**
 * Reads the snapshot and decodes it strictly, so a snapshot that the default
 * decode would load only in part (a missing remote block, a damaged block) is
 * refused whole instead of being written and then losing that part for good.
 * Returns the bytes exactly as stored; the decoded object is only a validity
 * check and is not kept.
 */
async function readValidatedSnapshot(snapshotKey: string): Promise<Uint8Array> {
    const { bytes: stored } = await (await getAppStore()).read(snapshotKey)
    if (!stored) {
        throw new Error(`The backup ${snapshotKey} is not in storage`)
    }
    // A store may hand back a Buffer (a Uint8Array subclass); the copy keeps
    // the same bytes and makes the value written a plain Uint8Array.
    const bytes: Uint8Array = Object.getPrototypeOf(stored) === Uint8Array.prototype ? stored : new Uint8Array(stored)

    const decoded = await decodeRisuSave(bytes, { strict: true })
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
        throw new Error(`The backup ${snapshotKey} does not hold a database`)
    }
    return bytes
}

export async function loadInternalBackup() {

    // Refused before anything is asked, again when the picker returns, and
    // again immediately before the write: work can start during any wait
    // between.
    if (refuseBackupLoadWhileBusy()) {
        return
    }

    let selectedBackup: string | undefined
    try {
        const internalBackups = await (await getAppStore()).list(SNAPSHOT_KEY_PREFIX)

        const selectOptions = [
            'Cancel',
            ...(internalBackups.map((a) => {
                return (new Date(parseInt(a.slice(SNAPSHOT_KEY_PREFIX.length)) * 100)).toLocaleString()
            }))
        ]

        const alertResult = parseInt(
            await alertSelect(selectOptions)
        ) - 1

        selectedBackup = internalBackups[alertResult]
    } catch (error) {
        console.error(error)
        alertError(language.internalBackupListFailed)
        return
    }

    if (selectedBackup === undefined) {
        return
    }

    if (refuseBackupLoadWhileBusy()) {
        return
    }

    // The startup clean-up can delete a remote block that the snapshot
    // references while this load runs, so nothing is read until it settles.
    // The cancelable wait is shown only while a recorded clean-up is pending,
    // and is replaced by a wait without Cancel as soon as it settles: from
    // there on the load takes locks and cannot be cancelled.
    const startupCleanup = getStartupCleanup()
    if (startupCleanup) {
        let cancelWait: () => void = () => { }
        const cancelled = new Promise<'cancelled'>((resolve) => {
            cancelWait = () => resolve('cancelled')
        })
        alertWait(language.internalBackupWaitingForCleanup, () => cancelWait())
        const outcome = await Promise.race([startupCleanup.then(() => 'settled' as const), cancelled])
        if (outcome === 'cancelled') {
            alertClear()
            return
        }
        alertWait('Loading backup...')
    }

    // Nothing else on this browser origin may write the database while the
    // snapshot is validated and written (MC-093). Tauri is single-instance and
    // skips this check. Once granted, `releaseExclusiveHold` already holds
    // `dbWriteLock` internally -- the write below must NOT acquire it a second
    // time, which would deadlock against this same hold.
    let releaseExclusiveHold: ((keepWriteLock?: boolean) => Promise<void>) | null = null
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

    // Every exit that never lands the write shows one message and then
    // releases what was taken above. An exit after the write landed keeps the
    // write lock closed: the main file now holds the snapshot, and a save from
    // this page's pre-load state must never overwrite it.
    let releaseDbWriteLock: (() => void) | null = null
    let writeAttempted = false
    let writeLanded = false
    try {
        if (!releaseExclusiveHold) {
            releaseDbWriteLock = await dbWriteLock.acquire()
        }

        alertWait('Loading backup...')
        const bytes = await readValidatedSnapshot(selectedBackup)

        // No await between this check and the write.
        if (refuseBackupLoadWhileBusy()) {
            return
        }

        writeAttempted = true
        await writeMainFile(bytes)
        writeLanded = true
        noteMainFileBytes(bytes)

        alertWait("Success, Refreshing your app.")
        // The hold's Web Lock part is released first so other tabs can
        // proceed, and before the reload is marked app-initiated: the release
        // can queue behind another tab's exclusive request for longer than the
        // mark lives, and an expired mark lets the "Leave site?" guard stop the
        // reload. The write lock part stays closed (`keepWriteLock`).
        if (releaseExclusiveHold) {
            await releaseExclusiveHold(true)
        }
        markAppInitiatedReload()
        if (isTauri) {
            await relaunch()
        } else {
            // replaceState drops any query string and keeps the fragment;
            // location.reload() always performs a full reload.
            history.replaceState(null, '', location.pathname + location.hash)
            location.reload()
        }
    } catch (error) {
        console.error(error)
        if (writeLanded) {
            alertWait(language.restoreSavedReloadOrRestart)
        } else if (writeAttempted) {
            alertError(language.internalBackupWriteFailed)
        } else {
            alertError(language.internalBackupUnreadable)
        }
    } finally {
        if (!writeLanded) {
            if (releaseDbWriteLock) {
                releaseDbWriteLock()
            }
            if (releaseExclusiveHold) {
                await releaseExclusiveHold()
            }
        }
    }
}
