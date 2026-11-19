import { alertError } from "../alert";
import { markAppInitiatedReload } from "../reloadGuard";
import { reloadAfterRestore } from "./restoreReload";
import { refuseBackupLoadWhileBusy } from "./backupWorkGuard";
import { refuseOnReadOnlyPage } from "../storage/readOnlyPage";
import { getPageStorageMode } from "../storage/pageStorageMode";
import { loadStoreRestorePoint, type ExclusiveHoldRelease } from "./storeRestore";
import { emptyImportFacts, type ImportFacts, type OperationCause, type OperationEnd, type OperationOutcome } from "./operationEnd";

/**
 * The tail every restore shares once the restored state has landed: the hold's
 * Web Lock part is released first so other tabs can proceed, and before the
 * reload is marked app-initiated, because the release can queue behind another
 * tab's exclusive request for longer than the mark lives, and an expired mark
 * lets the "Leave site?" guard stop the reload. The write lock part stays closed
 * (`keepWriteLock`): a save from this page's pre-restore state must never
 * overwrite the restored profile.
 */
export async function reloadOntoRestoredState(releaseExclusiveHold: ExclusiveHoldRelease | null): Promise<void> {
    if (releaseExclusiveHold) {
        await releaseExclusiveHold(true)
    }
    markAppInitiatedReload()
    await reloadAfterRestore()
}

/**
 * Loads one of the page's internal backups. Returns how the load ended as a value; the alerts are unchanged and no caller
 * needs the value. A store2 page restores one of its own restore points (or an old numbered backup); any other page is
 * refused with nothing read.
 */
export async function loadInternalBackup(): Promise<OperationEnd<ImportFacts>> {

    // A store2 page keeps no numbered backups: it restores one of its own restore
    // points, and never reads or rebuilds a numbered backup.
    const mode = getPageStorageMode()
    if (mode.kind === 'store2') {
        return await loadStoreRestorePoint({ reload: reloadOntoRestoredState })
    }

    const before = (outcome: OperationOutcome, cause: OperationCause | null = null): OperationEnd<ImportFacts> =>
        ({ operation: 'restore-numbered', target: null, outcome, cause, detail: emptyImportFacts() })

    // Refused before anything is asked, while chat work, a registered action or a choke-point write runs.
    if (refuseBackupLoadWhileBusy()) {
        return before('nothing-replaced', 'busy')
    }

    // A page that runs from OPFS this time writes nothing: the load is refused before anything is asked.
    if (await refuseOnReadOnlyPage()) {
        return before('nothing-replaced')
    }

    // Any other mode has no restore point to load: nothing is listed, asked or written.
    alertError(new Error(`An internal backup can only be loaded on a store2 page; this page runs in mode ${mode.kind}.`))
    return before('nothing-replaced')
}
