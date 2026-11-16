/**
 * One debounced job of a long-text field (colouring, checking, counting): it never runs while the field is
 * composing, and runs once, `delayMs` after the last `touch` or composition end. `cancel` is final: a cancelled
 * scheduler ignores every later call, so nothing runs after the field is gone.
 */

type TimerHandle = ReturnType<typeof setTimeout>

export type SchedulerTimers = {
    set(fn: () => void, ms: number): TimerHandle
    clear(handle: TimerHandle): void
}

export type PauseScheduler = {
    touch(): void
    compositionStart(): void
    compositionEnd(): void
    cancel(): void
}

// The global timers are read at call time, so a test that fakes them after import is honoured.
const globalTimers: SchedulerTimers = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle),
}

export function createPauseScheduler(delayMs: number, run: () => void, timers: SchedulerTimers = globalTimers): PauseScheduler {
    let handle: TimerHandle | null = null
    let composing = false
    let cancelled = false

    function stop(): void {
        if (handle !== null) timers.clear(handle)
        handle = null
    }

    function arm(): void {
        stop()
        handle = timers.set(() => {
            handle = null
            if (!cancelled && !composing) run()
        }, delayMs)
    }

    return {
        touch() {
            if (cancelled || composing) return
            arm()
        },
        compositionStart() {
            if (cancelled) return
            composing = true
            stop()
        },
        compositionEnd() {
            if (cancelled) return
            composing = false
            arm()
        },
        cancel() {
            cancelled = true
            stop()
        },
    }
}
