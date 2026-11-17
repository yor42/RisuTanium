// The first mount of a long asset list, chunked. The first rows mount at once; the rest wait in a queue that is fixed
// when the list starts and mount a few at a time, each slice in a task of its own so input runs in between. After the
// queue is done every row of the list is mounted and the list hides rows instead of unmounting them, so this gate
// never runs again. It holds no effect: its writes happen in the scheduled task and in `release`.
import { untrack } from 'svelte'

/** Rows mounted by the first flush. Above the largest list the existing suites mount at once, so those lists never wait. */
export const FIRST_ROWS = 32
/** Rows one slice mounts. */
export const SLICE_ROWS = 8

export interface SliceScheduler {
    /** Runs `run` in a task of its own; the returned function cancels it. */
    schedule(run: () => void): () => void
}

const timerScheduler: SliceScheduler = {
    schedule(run) {
        const timer = setTimeout(run, 0)
        return () => clearTimeout(timer)
    },
}

let sliceScheduler: SliceScheduler = timerScheduler

/** Tests: replaces the scheduler of every gate that schedules from now on (undefined restores the timer). */
export function setRowSliceSchedulerForTests(scheduler: SliceScheduler | undefined): void {
    sliceScheduler = scheduler ?? timerScheduler
}

export interface RowMountOptions {
    /** The row keys when the list starts, in display order. Read once. */
    initialKeys: readonly string[]
    /** The keys shown now, in display order. Read when a slice runs, never tracked. */
    shownKeys: () => readonly string[]
}

export interface RowMount {
    /** Whether the row of this key is mounted. Reactive per key. A key that was not in the initial set always is. */
    mounted(key: string): boolean
    /** True once every row of the initial set is mounted. Reactive. */
    readonly done: boolean
    /** Mounts the named keys now, ahead of their slice. */
    release(keys: readonly string[]): void
    /** Cancels the scheduled slice; a slice that still runs writes nothing. */
    dispose(): void
}

export function createRowMount(options: RowMountOptions): RowMount {
    const queue = options.initialKeys.slice(FIRST_ROWS)
    const waiting: Record<string, true> = {}
    for (const key of queue) waiting[key] = true
    let deferred = $state<Record<string, true>>(waiting)
    let done = $state(queue.length === 0)
    let cursor = 0
    let alive = true
    let cancel: (() => void) | null = null

    function slice(): void {
        cancel = null
        if (!alive) return
        // The rows the person can see come first, then the queue in its own order.
        const taken: string[] = []
        for (const key of untrack(options.shownKeys)) {
            if (taken.length >= SLICE_ROWS) break
            if (deferred[key] === true) taken.push(key)
        }
        while (taken.length < SLICE_ROWS && cursor < queue.length) {
            const key = queue[cursor]
            cursor += 1
            if (deferred[key] === true && !taken.includes(key)) taken.push(key)
        }
        for (const key of taken) delete deferred[key]
        while (cursor < queue.length && deferred[queue[cursor]] !== true) cursor += 1
        if (cursor >= queue.length) {
            // No stale key outlives the window: a key that waited is mounted from here on.
            deferred = {}
            done = true
            return
        }
        cancel = sliceScheduler.schedule(slice)
    }

    if (queue.length > 0) cancel = sliceScheduler.schedule(slice)

    return {
        mounted: (key) => deferred[key] !== true,
        get done() { return done },
        release(keys) {
            for (const key of keys) delete deferred[key]
        },
        dispose() {
            alive = false
            cancel?.()
            cancel = null
        },
    }
}
