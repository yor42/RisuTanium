/**
 * When a large loaded character may be judged and turned back into a stub: never in the foreground, because the
 * verdict re-encodes the whole character. It waits for a quiet page, which is either of
 *
 * - the tab is hidden and its save has committed, or
 * - `IDLE_MS` without input, an idle callback (a zero timer where the browser has none), and a save that has committed.
 *
 * The trigger only says "now is a good time"; the callback repeats every check of the put-back and judges the character
 * in the same synchronous task that swaps it. Stopping the trigger removes its `document` listeners.
 */

import { afterNextSaveCommit, isSaveClean } from '../../globalApi.svelte'

/** Without input for this long the page counts as idle. */
export const IDLE_MS = 30_000

/** How long an idle callback may be postponed by a busy browser before it runs anyway. */
const IDLE_CALLBACK_TIMEOUT_MS = 2000

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

export interface QuietTrigger {
    /** Asks for the callback once, when the page is quiet. Does nothing while a request is already waiting. */
    arm(): void
    /** Drops a waiting request and removes the listeners. */
    stop(): void
}

/** Runs `callback` when the browser is idle, or from a zero timer where it has no idle callback. */
function whenIdle(callback: () => void): void {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => callback(), { timeout: IDLE_CALLBACK_TIMEOUT_MS })
    } else {
        setTimeout(callback, 0)
    }
}

export function startQuietTrigger(run: () => void): QuietTrigger {
    let lastInputAt = performance.now()
    let armed = false
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const onInput = (): void => {
        lastInputAt = performance.now()
    }
    const onVisibility = (): void => {
        if (armed && document.visibilityState === 'hidden') {
            clearTimer()
            runWhenSaved()
        }
    }
    for (const name of INPUT_EVENTS) {
        document.addEventListener(name, onInput, { capture: true, passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)

    function clearTimer(): void {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
    }

    /** Waits for the quiet condition: the page is hidden now, or the idle time is up. */
    function evaluate(): void {
        if (!armed || stopped) {
            return
        }
        clearTimer()
        if (document.visibilityState === 'hidden') {
            runWhenSaved()
            return
        }
        timer = setTimeout(onTimer, Math.max(0, IDLE_MS - (performance.now() - lastInputAt)))
    }

    function onTimer(): void {
        timer = null
        if (!armed || stopped) {
            return
        }
        if (performance.now() - lastInputAt < IDLE_MS) {
            evaluate()
            return
        }
        runWhenSaved()
    }

    /** Runs the callback from an idle slot once the save has committed; a save still in progress postpones it to the next commit. */
    function runWhenSaved(): void {
        whenIdle(() => {
            if (!armed || stopped) {
                return
            }
            if (document.visibilityState !== 'hidden' && performance.now() - lastInputAt < IDLE_MS) {
                // Input arrived after the request was queued: wait for a new quiet period.
                evaluate()
                return
            }
            if (!isSaveClean()) {
                afterNextSaveCommit(evaluate)
                return
            }
            armed = false
            run()
        })
    }

    return {
        arm() {
            if (armed || stopped) {
                return
            }
            armed = true
            evaluate()
        },
        stop() {
            stopped = true
            armed = false
            clearTimer()
            for (const name of INPUT_EVENTS) {
                document.removeEventListener(name, onInput, { capture: true })
            }
            document.removeEventListener('visibilitychange', onVisibility)
        },
    }
}
