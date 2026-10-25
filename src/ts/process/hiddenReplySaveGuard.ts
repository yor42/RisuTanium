/**
 * Keeps the process alive from a hidden reply's end until its save has landed. A hidden page's save
 * pass can stall (its reads wait on a frozen page), and the keep-alive service ends shortly after the
 * chat work does; while a 'save' token is in flight the service stays up, so the app is not killed
 * with the reply only in memory.
 *
 * The token ends through `release()` only, so the guard never holds a dead token. It ends when:
 * - a commit covers the reply's marks (`committed >= target`, the mark counts, not the dirty flag:
 *   unrelated edits made after the commit's snapshot must not pin the token);
 * - saving stops (nothing more will commit);
 * - the page has been continuously visible for the bound (its timers run then, so the stalled pass
 *   has had its chance). Becoming visible does not release; hiding again cancels the bound.
 *
 * There is deliberately no age limit and no timer while hidden: a frozen page runs none. Limits:
 * a commit in which the reply's character could not be saved still counts as covering it, so the
 * token ends while the reply exists in memory only; a failed save while hidden holds the token until
 * the page is visible long enough.
 */
import { afterNextSaveCommit, getCommittedSaveMarkCount, getSaveMarkCount, isSavingStopped, onSavingStopped } from '../globalApi.svelte'
import { beginInFlight } from './inFlightWork'

/** Continuous visibility after which a still-pending token is released. */
export const HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS = 120000

export interface HiddenReplySaveGuardDeps {
    /** Marks counted so far, read after the reply's marks and request were made. */
    getMarkCount: () => number
    /** The mark count the latest commit covered. */
    getCommittedMarkCount: () => number
    /** Calls the callback once at the next commit; the same function registered twice is one registration. */
    afterNextCommit: (callback: () => void) => void
    /** Begins the in-flight token and returns its end. */
    begin: () => () => void
    isHidden: () => boolean
    /** Calls the callback at every visibility change; the returned function unsubscribes. */
    onVisibility: (callback: () => void) => () => void
    /** True when saving has stopped (a truthy reason; '' means running). */
    isStopped: () => boolean
    /** Calls the callback whenever saving is stopped, possibly at once; the returned function unsubscribes. */
    onStopped: (callback: () => void) => () => void
    /** Runs `callback` after `ms` of the page's own timers; the returned function cancels it. */
    schedule: (callback: () => void, ms: number) => () => void
    boundMs?: number
}

export interface HiddenReplySaveGuard {
    /** Holds the service until a commit covers every mark counted now. Call after the marks and the save request. */
    hold(): void
    /** Ends the token if held; idempotent. */
    release(): void
    held(): boolean
}

export function createHiddenReplySaveGuard(deps: HiddenReplySaveGuardDeps): HiddenReplySaveGuard {
    const boundMs = deps.boundMs ?? HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS
    let token: (() => void) | null = null
    let target = 0
    let offVisibility: (() => void) | null = null
    let offStopped: (() => void) | null = null
    let cancelBound: (() => void) | null = null

    const stopBound = (): void => {
        cancelBound?.()
        cancelBound = null
    }

    const release = (): void => {
        if (token === null) {
            return
        }
        const end = token
        token = null
        target = 0
        stopBound()
        offVisibility?.()
        offVisibility = null
        offStopped?.()
        offStopped = null
        end()
    }

    // One stable function: the registry's Set dedupes it, so release/begin cycles never stack callbacks.
    const check = (): void => {
        if (token === null) {
            return
        }
        let covered = false
        try {
            covered = deps.getCommittedMarkCount() >= target
        } finally {
            if (!covered) {
                deps.afterNextCommit(check)
            }
        }
        if (covered) {
            release()
        }
    }

    const armBoundIfVisible = (): void => {
        if (token === null || deps.isHidden()) {
            stopBound()
            return
        }
        if (cancelBound === null) {
            cancelBound = deps.schedule(release, boundMs)
        }
    }

    const hold = (): void => {
        const marks = deps.getMarkCount()
        if (deps.getCommittedMarkCount() >= marks) {
            return
        }
        if (deps.isStopped()) {
            return
        }
        if (token !== null) {
            target = Math.max(target, marks)
            return
        }
        target = marks
        // Assigned before subscribing: a subscription may call back at once.
        token = deps.begin()
        const offVisible = deps.onVisibility(armBoundIfVisible)
        if (token === null) {
            offVisible()
            return
        }
        offVisibility = offVisible
        const offStop = deps.onStopped(release)
        if (token === null) {
            offStop()
            return
        }
        offStopped = offStop
        armBoundIfVisible()
        deps.afterNextCommit(check)
    }

    return { hold, release, held: () => token !== null }
}

function pageIsHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

let pageGuard: HiddenReplySaveGuard | null = null

// Built when first used, not at module load: the send path imports this module through saveOnHide,
// and a suite that replaces the persistence module must not have to provide every export.
function getPageGuard(): HiddenReplySaveGuard {
    pageGuard ??= createHiddenReplySaveGuard({
        getMarkCount: getSaveMarkCount,
        getCommittedMarkCount: getCommittedSaveMarkCount,
        afterNextCommit: afterNextSaveCommit,
        begin: () => beginInFlight('save'),
        isHidden: pageIsHidden,
        onVisibility: (callback) => {
            document.addEventListener('visibilitychange', callback)
            return () => document.removeEventListener('visibilitychange', callback)
        },
        isStopped: isSavingStopped,
        onStopped: onSavingStopped,
        schedule: (callback, ms) => {
            const timer = setTimeout(callback, ms)
            return () => clearTimeout(timer)
        },
    })
    return pageGuard
}

/** Holds the keep-alive service until the page's save covers the reply just flushed while hidden. */
export function holdHiddenReplySave(): void {
    getPageGuard().hold()
}

export function resetHiddenReplySaveGuardForTest(): void {
    pageGuard?.release()
    pageGuard = null
}
