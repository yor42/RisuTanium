import { get } from "svelte/store";
import { alertError } from "../alert";
import { isConsentType, isPromptType } from "../alertPrompts";
import { language } from "src/lang";
import { isWorkInProgress } from "../process/chatOrigin";
import { anyChokePointInFlight, busyRefusalLine, isBusy, type BusyHandle } from "../process/memory/busyActions";
import { alertStore } from "../stores.svelte";
import { noteRefusalLineSet, restoreInProgress } from "./restoreInProgress";

/**
 * Whether a backup load must not go ahead right now. A load replaces the whole
 * database under whatever is still writing into it, so it is refused while any
 * chat work is in progress, any registered action runs, or any write is in
 * flight at a choke point, and the user is told to wait for that work or stop
 * it. A caller that has registered its own entry passes it as `own`, so that
 * entry does not refuse the load it belongs to.
 * True when the caller must stop, with the message already shown; false, and
 * silent, when nothing is running.
 * When another registered action runs, its next wait or progress alert replaces
 * the message, so the refusal also sets a line those alerts show until the last
 * entry ends. Chat work and choke-point writes set no line: no entry would end it.
 */
export function refuseBackupLoadWhileBusy(own?: BusyHandle): boolean {
    if(!isWorkInProgress() && !isBusy({ except: own }) && !anyChokePointInFlight()){
        return false
    }
    alertError(language.backupLoadWorkInProgress)
    if(isBusy({ except: own })){
        busyRefusalLine.set(language.backupLoadRefusedLine)
    }
    return true
}

/**
 * Whether a dropped file or a PWA launch must be refused because a backup restore is under way. A restore replaces the
 * whole database, so an import running into it would be lost or would corrupt it. True when the caller must stop;
 * false, and silent, when no restore is open (see `restoreInProgress`).
 * The refusal never hides what the restore shows. The existing line is always set, and it shows under a wait or
 * progress. The pop-up is posted only when nothing is on screen, a toast is, or a restore question is: the question
 * comes back after OK. Over a restore notice, an error, a wait2, a wait, a progress or a consent prompt, the line is
 * the whole refusal, and it may go unseen once the restore ends. Nothing is consumed from the app's side.
 */
export function refuseImportWhileRestoring(): boolean {
    if(!restoreInProgress()){
        return false
    }
    busyRefusalLine.set(language.backupLoadRefusedLine)
    noteRefusalLineSet()
    const shown = get(alertStore).type
    if(shown === 'none' || shown === 'toast' || (isPromptType(shown) && !isConsentType(shown))){
        alertError(language.backupLoadWorkInProgress)
    }
    return true
}
