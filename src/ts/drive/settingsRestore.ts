/**
 * The restore buttons as flows: the two Settings buttons (a `.bin` file, and the internal backup / store2 restore point)
 * and the Welcome restore of a `.bin` file. Each opens a restore run before its first question and holds it across the
 * loader, so the run spans the picker and the save-first waits that come before the loader registers its busy entry.
 * The run ends with the outcome the loader reports; a loader that rejects ends it `failed` (every loader converts a
 * throw after its write into an outcome, so a rejection means nothing was replaced).
 * A file picker that fires neither `change` nor `cancel` when dismissed leaves its loader pending for good, and the run
 * with it. Only the Welcome entry stops waiting on such a picker (see `watchPickerReturn`); the run itself is unchanged.
 */
import { language } from 'src/lang'
import { alertConfirm } from '../alert'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { LoadLocalBackup } from './backuplocal'
import { loadInternalBackup } from './internalBackup'
import type { OperationOutcome } from './operationEnd'
import { beginRestoreRun, restorePhase } from './restoreInProgress'

/**
 * How long the window may be back, with no restore working, before the Welcome entry stops waiting for a picker that
 * fired neither `change` nor `cancel`.
 */
export const PICKER_RETURN_GRACE_MS = 2000

async function restoreFlow(loader: () => Promise<{ outcome: OperationOutcome }>): Promise<void> {
    if (refuseBackupLoadWhileBusy()) {
        return
    }
    const run = beginRestoreRun()
    let outcome: OperationOutcome = 'failed'
    try {
        if (!(await alertConfirm(language.backupLoadConfirm)) || !(await alertConfirm(language.backupLoadConfirm2))) {
            outcome = 'canceled'
            return
        }
        outcome = (await loader()).outcome
    } catch (error) {
        console.error(error)
    } finally {
        run.end(outcome)
    }
}

/** Settings: restore from a `.bin` file the person picks. */
export function restoreFromBinFile(): Promise<void> {
    return restoreFlow(() => LoadLocalBackup())
}

/**
 * Calls `stop` once the window has been back for `PICKER_RETURN_GRACE_MS` while the restore is still `asking`: no
 * `change` was dispatched within `PICKER_RETURN_GRACE_MS` of the last return. A return while a restore is working never
 * calls `stop`. There is no timeout without a return: a slow person still inside the picker must not be unlocked.
 * Returns the cleanup, which is safe to repeat.
 */
function watchPickerReturn(stop: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    function cleanup(): void {
        clearTimeout(timer)
        window.removeEventListener('focus', onReturn)
        document.removeEventListener('visibilitychange', onVisibility)
    }
    function onReturn(): void {
        clearTimeout(timer)
        timer = setTimeout(() => {
            if (restorePhase() === 'asking') {
                cleanup()
                stop()
            }
        }, PICKER_RETURN_GRACE_MS)
    }
    function onVisibility(): void {
        if (document.visibilityState === 'visible') {
            onReturn()
        }
    }
    window.addEventListener('focus', onReturn)
    document.addEventListener('visibilitychange', onVisibility)
    return cleanup
}

/**
 * Welcome: the same restore and confirmations as Settings, and the restored database persists `didFirstSetup = true`.
 * The returned promise resolves with the restore flow, or earlier when a dismissed picker fires no event and the window
 * comes back (`watchPickerReturn`). In that early case the restore run stays open until its loader settles. A flow that
 * rejects (a failing busy guard or run end) removes the listeners and rejects the returned promise with the same error,
 * so the caller decides how it is reported; after an early resolve the error is rethrown unhandled instead.
 */
export function restoreFromBinFileAtFirstRun(): Promise<void> {
    let resolveReturned: () => void = () => { }
    let rejectReturned: (error: unknown) => void = () => { }
    let returnedSettled = false
    const returned = new Promise<void>((resolve, reject) => {
        resolveReturned = () => {
            returnedSettled = true
            resolve()
        }
        rejectReturned = (error) => {
            returnedSettled = true
            reject(error)
        }
    })
    let stopWatching: () => void = () => { }
    const settle = (): void => {
        stopWatching()
        resolveReturned()
    }
    restoreFlow(() => {
        // The picker opens synchronously inside this call, so the watcher is armed only after both confirmations.
        const loaded = LoadLocalBackup(undefined, undefined, { completeFirstSetup: true })
        stopWatching = watchPickerReturn(resolveReturned)
        return loaded
    }).then(settle, (error: unknown) => {
        // A flow that rejects (a failing busy guard or run end) removes the listeners and surfaces the same error.
        stopWatching()
        if (returnedSettled) {
            throw error
        }
        rejectReturned(error)
    })
    return returned
}

/** Settings: restore the internal backup (legacy snapshot) or, on a store2 page, a restore point. */
export function restoreFromInternalBackup(): Promise<void> {
    return restoreFlow(() => loadInternalBackup())
}
