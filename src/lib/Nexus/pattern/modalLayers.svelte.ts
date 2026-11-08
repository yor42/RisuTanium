/**
 * Counts the open focus-trapping overlays so the toast stack can hold its timers while any is open.
 *
 * Every pattern shell holds a layer through `registerShell`. An overlay that makes the page inert without a
 * shell (the shell-mode sidebar overlay) must hold one itself, in the same effect that makes the page inert and
 * released in that effect's teardown.
 *
 * The count is a plain mirror: holders run inside other components' effects, and reading a rune there would
 * subscribe those effects, so `open` is only ever written here.
 */

let held = 0
let open = $state(false)

/** Counts one open layer. The returned release is idempotent. */
export function holdModalLayer(): () => void {
    held += 1
    open = held > 0
    let released = false
    return () => {
        if (released) return
        released = true
        held -= 1
        open = held > 0
    }
}

/** Whether any layer is open. Reactive. */
export function modalLayerOpen(): boolean {
    return open
}

/** The number of open layers; a test seam. */
export function modalLayerCount(): number {
    return held
}
