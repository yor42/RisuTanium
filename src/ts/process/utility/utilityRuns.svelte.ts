/**
 * Run bookkeeping for Utility requests. A Utility run has its own id and its own AbortController and is tracked here
 * only: it shares no state with a chat send, so stopping one never stops the other, in either direction.
 */

export interface UtilityRun {
    id: string
    signal: AbortSignal
    /** Releases the run's conversation. Safe to call more than once. */
    end: () => void
}

interface LiveRun {
    conversationId: string
    controller: AbortController
}

const liveRuns = new Map<string, LiveRun>()
let nextRunNumber = 0

/**
 * Starts a run for `conversationId`, or returns null while that conversation already has a live run. An aborted run
 * no longer holds its conversation, so a new run may start while the aborted one is still unwinding.
 */
export function startUtilityRun(conversationId: string): UtilityRun | null {
    if (utilityRunLive(conversationId)) {
        return null
    }
    nextRunNumber += 1
    const id = `utility-run-${nextRunNumber}`
    const controller = new AbortController()
    liveRuns.set(id, { conversationId, controller })
    return {
        id,
        signal: controller.signal,
        end: () => {
            liveRuns.delete(id)
        },
    }
}

/** Aborts the run `id` only. False when no such run is live. */
export function abortUtilityRun(id: string): boolean {
    const live = liveRuns.get(id)
    if (!live) {
        return false
    }
    live.controller.abort()
    return true
}

/** Whether `conversationId` has a run that has not ended or been aborted. */
export function utilityRunLive(conversationId: string): boolean {
    for (const live of liveRuns.values()) {
        if (live.conversationId === conversationId && !live.controller.signal.aborted) {
            return true
        }
    }
    return false
}
