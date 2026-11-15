// First-frame harness: a test observes the state a user would see at the first animation frame after an action.
// requestAnimationFrame is a manual queue, so no frame runs until `runFrame()`. A reader is queued before the
// action; the test then drains only microtasks, so a wait that needs a frame or a timer has not finished when the
// reader runs. Real timers only: the timer arm of a Svelte tick must not be advanced by a fake clock.
// This module does not import the app's flush helper, so a reproducer fails at its assertion on the unfixed code.

interface QueuedFrame {
    id: number
    callback: FrameRequestCallback
}

let queue: QueuedFrame[] = []
let nextId = 1
let saved: { request: typeof requestAnimationFrame, cancel: typeof cancelAnimationFrame } | null = null

/**
 * Replaces requestAnimationFrame and cancelAnimationFrame with a manual queue; undo with `uninstallFrameQueue`.
 * Only these two globals are touched, so a stub another part of the test installed survives the uninstall.
 */
export function installFrameQueue(): void {
    queue = []
    nextId = 1
    if (!saved) {
        saved = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame }
    }
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
        const id = nextId++
        queue.push({ id, callback })
        return id
    }
    globalThis.cancelAnimationFrame = (id: number): void => {
        queue = queue.filter((entry) => entry.id !== id)
    }
}

export function uninstallFrameQueue(): void {
    queue = []
    if (saved) {
        globalThis.requestAnimationFrame = saved.request
        globalThis.cancelAnimationFrame = saved.cancel
        saved = null
    }
}

/**
 * Queues `read` as the first frame callback and returns a promise for its result. It resolves only when
 * `runFrame()` runs, so the value is what the DOM holds at the first frame.
 */
export function readAtFirstFrame<T>(read: () => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        queue.push({
            id: nextId++,
            callback: () => {
                try {
                    resolve(read())
                } catch (error) {
                    reject(error)
                }
            },
        })
    })
}

/** Lets every microtask continuation settle without running a macrotask, a frame or a timer. */
export async function drainMicrotasks(count = 200): Promise<void> {
    for (let index = 0; index < count; index++) {
        await Promise.resolve()
    }
}

/** Runs every frame callback queued so far, in order. Callbacks queued while it runs wait for the next frame. */
export function runFrame(): void {
    const current = queue
    queue = []
    for (const entry of current) {
        entry.callback(performance.now())
    }
}
