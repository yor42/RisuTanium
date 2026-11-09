// The window width as of the current task. Reading `window.innerWidth` forces a layout when an earlier change in the
// same task dirtied it, so rows mounted in one burst share a single read. The cached value is dropped at the end of
// the task, so a width change between tasks is always seen. The read is not reactive.
let cachedWidth: number | null = null

export function viewportWidthThisTask(): number {
    if (cachedWidth === null) {
        cachedWidth = window.innerWidth
        queueMicrotask(() => {
            cachedWidth = null
        })
    }
    return cachedWidth
}
