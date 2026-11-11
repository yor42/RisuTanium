import { QUIT_WINDOW_MS } from './backHandlers'

/** How long the pill fades out at the end of the quit window. */
export const QUIT_PILL_LEAVE_MS = 200

export type QuitPillPhase = 'hidden' | 'shown' | 'leaving'

/**
 * The Back-quit pill's state. It is visible only while the quit guard is armed and for at most
 * QUIT_WINDOW_MS: it shows on the warning press, starts leaving QUIT_PILL_LEAVE_MS before the window
 * ends and is hidden when the window ends or the guard disarms. `seq` changes on every warning, so
 * each one renders a fresh node. The window never pauses, so the pill does not join the toast
 * host's suspend or pause.
 */
export const quitPill = $state<{ phase: QuitPillPhase; seq: number }>({ phase: 'hidden', seq: 0 })

let leaveTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function cancelTimers(): void {
    if (leaveTimer !== null) {
        globalThis.clearTimeout(leaveTimer)
        leaveTimer = null
    }
    if (hideTimer !== null) {
        globalThis.clearTimeout(hideTimer)
        hideTimer = null
    }
}

/** Shows the pill for the quit window; a second call restarts it as a new node. */
export function showQuitPill(): void {
    cancelTimers()
    quitPill.seq += 1
    quitPill.phase = 'shown'
    // The timers are resolved at call time so a fake clock governs them.
    leaveTimer = globalThis.setTimeout(() => {
        leaveTimer = null
        quitPill.phase = 'leaving'
    }, QUIT_WINDOW_MS - QUIT_PILL_LEAVE_MS)
    hideTimer = globalThis.setTimeout(() => {
        hideTimer = null
        quitPill.phase = 'hidden'
    }, QUIT_WINDOW_MS)
}

/** Hides the pill at once and cancels its timers. */
export function hideQuitPill(): void {
    cancelTimers()
    quitPill.phase = 'hidden'
}

/** Returns the pill to its initial state between tests. */
export function resetQuitPillForTests(): void {
    cancelTimers()
    quitPill.phase = 'hidden'
    quitPill.seq = 0
}
