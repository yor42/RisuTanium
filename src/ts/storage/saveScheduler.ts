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
 *
 * `wakeIdle` is the same wake without the request: it ends a plain `wait` (or is kept once for the next plain `wait`)
 * and nothing else, so the idle net can start a slot at once without a mark, a dirty page or a cut pass.
 *
 * A measurement build notes each request before it changes anything; the note has no effect on the wake.
 */
import { MEASURE } from '../process/memory/measureFlag'
import { noteRequestNow } from './saveRequestProbe'

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
    /**
     * `wait` for a back-off after which no pass necessarily follows. A `requestNow` that ends it also sets the latch, so the
     * wait that follows the pass is not spent on a page timer; a latch already set ends it at once and stays set for that
     * following wait.
     */
    waitRearm(ms: number): Promise<void>
    /**
     * Ends a live plain `wait` early, or, when no wait is live, makes the next plain `wait` return at once, once. It is not
     * a save request: it counts no mark, marks nothing dirty, leaves `latch` alone and runs no `onRequest` listener, so a
     * running pass is never cut by it. A live `waitRearm` back-off is left to run out.
     */
    wakeIdle(): void
    /** True while a debounce is running. */
    debouncePending(): boolean
    /**
     * Registers a one-shot listener that the next `requestNow` calls, after its own wake and latch handling. Timer-free:
     * a frozen page runs it. Returns the release, which a listener that has run or been released makes a no-op.
     * Armed listeners mean the loop is inside a pass, where no scheduler wait is live, so any wake left over is stale:
     * the request is then kept as the latch, and the wait after the pass returns at once.
     */
    onRequest(listener: () => void): () => void
}

export function createSaveScheduler(options: SaveSchedulerOptions): SaveScheduler {
    const { debounceMs, hooks } = options
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending = false
    let latch = false
    let idleLatch = false
    let wake: (() => void) | null = null
    let wakeRearms = false
    const listeners = new Set<() => void>()

    function sleepWake(ms: number, rearms: boolean): Promise<void> {
        return new Promise<void>((resolve) => {
            const thisWake = () => resolve()
            wake = thisWake
            wakeRearms = rearms
            void options.sleep(ms).then(() => {
                if (wake === thisWake) {
                    wake = null
                }
                resolve()
            })
        })
    }

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
            if (MEASURE) {
                noteRequestNow(listeners.size > 0, wake !== null)
            }
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
                if (wakeRearms) {
                    latch = true
                }
            } else {
                latch = true
            }
            if (listeners.size > 0) {
                latch = true
                const armed = [...listeners]
                listeners.clear()
                for (const listener of armed) {
                    try {
                        listener()
                    } catch (error) {
                        console.error(error)
                    }
                }
            }
        },
        wait(ms) {
            if (latch) {
                latch = false
                return Promise.resolve()
            }
            if (idleLatch) {
                idleLatch = false
                return Promise.resolve()
            }
            return sleepWake(ms, false)
        },
        wakeIdle() {
            if (wake === null) {
                idleLatch = true
                return
            }
            if (wakeRearms) {
                return
            }
            const resolve = wake
            wake = null
            resolve()
        },
        waitRearm(ms) {
            if (latch) {
                return Promise.resolve()
            }
            return sleepWake(ms, true)
        },
        debouncePending() {
            return pending
        },
        onRequest(listener) {
            // Each registration is its own entry, so a release never removes another caller's listener.
            const entry = () => listener()
            listeners.add(entry)
            return () => {
                listeners.delete(entry)
            }
        },
    }
}
