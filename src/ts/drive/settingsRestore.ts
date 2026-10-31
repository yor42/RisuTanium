/**
 * The two Settings restore buttons (a `.bin` file, and the internal backup / store2 restore point) as flows. Each opens a
 * restore run before its first question and holds it across the loader, so the run spans the picker and the save-first
 * waits that come before the loader registers its busy entry. The run ends with the outcome the loader reports; a loader
 * that rejects ends it `failed` (every loader converts a throw after its write into an outcome, so a rejection means
 * nothing was replaced).
 */
import { language } from 'src/lang'
import { alertConfirm } from '../alert'
import { refuseBackupLoadWhileBusy } from './backupWorkGuard'
import { LoadLocalBackup } from './backuplocal'
import { loadInternalBackup } from './internalBackup'
import type { OperationOutcome } from './operationEnd'
import { beginRestoreRun } from './restoreInProgress'

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

/** Settings: restore the internal backup (legacy snapshot) or, on a store2 page, a restore point. */
export function restoreFromInternalBackup(): Promise<void> {
    return restoreFlow(() => loadInternalBackup())
}
