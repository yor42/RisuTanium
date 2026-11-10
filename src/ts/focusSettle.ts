export interface FocusSettle {
    /** Requests one run in a microtask. Does nothing after `dispose`, or while a run is already requested. */
    schedule(): void
    /** Drops a requested run and refuses later requests. Safe to call more than once. */
    dispose(): void
}

/**
 * Coalesces reactive-state writes made from a focus listener into one microtask.
 *
 * Use it for a listener attached with `addEventListener`: the browser dispatches focusout synchronously while a Svelte
 * block removes or moves a focused node, so the listener runs on the stack of a block effect, where a `$state` or store
 * write throws. `run` executes after that stack has unwound and reads the focus as it is by then, so several focus
 * events in one task settle once, from the final focus. A `run` that throws does not block later requests, and a
 * request made inside `run` gets a fresh turn. A throwing `run` surfaces as a window error, like any microtask.
 *
 * Svelte template handlers (`onfocusout`, `onblur`) are run outside the reactive context and need no deferral.
 */
export function createFocusSettle(run: () => void): FocusSettle {
    let pending = false
    let disposed = false
    return {
        schedule() {
            if (disposed || pending) return
            pending = true
            queueMicrotask(() => {
                pending = false
                if (disposed) return
                run()
            })
        },
        dispose() {
            disposed = true
        },
    }
}
