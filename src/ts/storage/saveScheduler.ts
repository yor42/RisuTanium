/**
 * The save loop's debounce and its "save now" wake. The loop's own state
 * (`changed`, the dirty flag, the mark count) stays in the loop; the scheduler
 * reaches it only through the hooks.
 *
 * `requestNow` makes the pending change due at once and wakes the loop out of
 * one of the waits that go through `wait`. If the loop is not in such a wait
 * (it is mid-iteration, or in a wait that does not go through `wait`), the next
 * `wait` returns at once instead, exactly once. Waits that do not go through
 * `wait`, and a loop parked for good, are never touched.
 */

export interface SaveSchedulerHooks {
    /** A save was requested: count it and, when `markDirty`, mark the page dirty. */
    onMark(markDirty: boolean): void
    /** The debounce elapsed with nothing newer: the change is due. */
    onDue(): void
    /** A save was requested for now: count it, mark the page dirty, and make the change due. */
    onRequestNow(): void
}

export interface SaveSchedulerOptions {
    debounceMs: number
    sleep: (ms: number) => Promise<unknown>
    hooks: SaveSchedulerHooks
}

export interface SaveScheduler {
    /** Requests a save after the debounce; a newer request restarts it. */
    schedule(markDirty?: boolean): void
    /** Requests a save now and wakes the loop. */
    requestNow(): void
    /** A sleep that `requestNow` ends early, or skips once when it came before the sleep. */
    wait(ms: number): Promise<void>
    /** True while a debounce is running. */
    debouncePending(): boolean
}

export function createSaveScheduler(options: SaveSchedulerOptions): SaveScheduler {
    const { debounceMs, hooks } = options
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending = false
    let latch = false
    let wake: (() => void) | null = null

    return {
        schedule(markDirty = true) {
            hooks.onMark(markDirty)
            if (timer) {
                clearTimeout(timer)
            }
            pending = true
            timer = setTimeout(() => {
                pending = false
                hooks.onDue()
            }, debounceMs)
        },
        requestNow() {
            if (timer) {
                clearTimeout(timer)
                timer = null
            }
            pending = false
            hooks.onRequestNow()
            if (wake) {
                const resolve = wake
                wake = null
                resolve()
            } else {
                latch = true
            }
        },
        wait(ms) {
            if (latch) {
                latch = false
                return Promise.resolve()
            }
            return new Promise<void>((resolve) => {
                const thisWake = () => resolve()
                wake = thisWake
                void options.sleep(ms).then(() => {
                    if (wake === thisWake) {
                        wake = null
                    }
                    resolve()
                })
            })
        },
        debouncePending() {
            return pending
        },
    }
}
