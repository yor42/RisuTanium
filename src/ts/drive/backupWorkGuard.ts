import { alertError } from "../alert";
import { language } from "src/lang";
import { isWorkInProgress } from "../process/chatOrigin";
import { anyChokePointInFlight, isBusy, type BusyHandle } from "../process/memory/busyActions";

/**
 * Whether a backup load must not go ahead right now. A load replaces the whole
 * database under whatever is still writing into it, so it is refused while any
 * chat work is in progress, any registered action runs, or any write is in
 * flight at a choke point, and the user is told to wait for that work or stop
 * it. A caller that has registered its own entry passes it as `own`, so that
 * entry does not refuse the load it belongs to.
 * True when the caller must stop, with the message already shown; false, and
 * silent, when nothing is running.
 */
export function refuseBackupLoadWhileBusy(own?: BusyHandle): boolean {
    if(!isWorkInProgress() && !isBusy({ except: own }) && !anyChokePointInFlight()){
        return false
    }
    alertError(language.backupLoadWorkInProgress)
    return true
}
