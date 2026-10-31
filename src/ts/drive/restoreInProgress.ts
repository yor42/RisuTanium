/**
 * Whether a backup restore is under way on this page, as one signal for the code that must not take or import
 * anything meanwhile. A restore has up to three phases:
 * - `asking`: a flow started a run and has not yet registered its busy entry (the confirmations, a picker, the
 *   save-first wait, the list reads);
 * - `working`: a `backupLoad` busy entry is open, whether or not a flow registered a run (a boot `.bin` restore has none);
 * - `pageEnding`: a run ended in a way that leaves this page unable to save or take again (the restored data landed or
 *   the write is unconfirmed). Sticky until the page is replaced.
 * A run is never a busy entry: it would refuse the very restore it stands for.
 */
import { busyKinds } from '../process/memory/busyActions'
import type { OperationOutcome } from './operationEnd'

export type RestorePhase = 'none' | 'asking' | 'working' | 'pageEnding'

export interface RestoreRun {
    /** Idempotent: only the first call counts. */
    end(outcome: OperationOutcome): void
}

let openRuns = 0
let pageEnding = false
const liveEndListeners = new Set<() => void>()

/** Opens a run for a restore flow; the flow ends it with the outcome its loader reported. */
export function beginRestoreRun(): RestoreRun {
    openRuns += 1
    let ended = false
    return {
        end: (outcome) => {
            if (ended) {
                return
            }
            ended = true
            openRuns -= 1
            if (outcome === 'committed' || outcome === 'permitted-partial' || outcome === 'unknown') {
                pageEnding = true
            }
            if (openRuns === 0 && restorePhase() === 'none') {
                for (const listener of [...liveEndListeners]) {
                    try {
                        listener()
                    } catch (error) {
                        console.warn('A restore-end listener failed', error)
                    }
                }
            }
        },
    }
}

export function restorePhase(): RestorePhase {
    if (pageEnding) {
        return 'pageEnding'
    }
    if (busyKinds().includes('backupLoad')) {
        return 'working'
    }
    return openRuns > 0 ? 'asking' : 'none'
}

/** True in every phase but `none`. */
export function restoreInProgress(): boolean {
    return restorePhase() !== 'none'
}

/** Calls `listener` when the last open run ends and the page is live with no restore working. Returns its unsubscribe. */
export function onRestoreEndedLive(listener: () => void): () => void {
    liveEndListeners.add(listener)
    return () => {
        liveEndListeners.delete(listener)
    }
}

/** Clears runs and the page-ending mark a test leaves behind; registered listeners stay. */
export function resetRestoreInProgressForTests(): void {
    openRuns = 0
    pageEnding = false
}
