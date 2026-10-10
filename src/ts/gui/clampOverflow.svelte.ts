/**
 * A Svelte action that reports whether a clamped element is cutting its
 * content off, so a "Show more" control appears only when there is more to
 * show.
 *
 * `use:clampOverflow={{ text, onChange }}` calls `onChange(clamped)` after the
 * first measurement, after every resize of the element and after `text`
 * changes (the re-measure after a change waits one microtask, until the render has been applied to the element). A repeated result is not reported again, so the callback may set
 * state that re-renders the element without looping. Without an `onChange`
 * the action does nothing at all (no observer, no layout read): a caller
 * passes it only for elements that need the answer, such as the rows near the
 * viewport.
 *
 * Measurement is isolated in `measureClamp` (`scrollHeight` above
 * `clientHeight`, which is only true while a clamp hides content). Tests that
 * have no layout drive it with `options.measure`; the `ResizeObserver`
 * constructor is read from `globalThis` at use time, and without one the
 * element is measured at mount and on `text` changes only.
 */

export interface ClampOverflowOptions {
    /** What the element shows; a change re-measures and re-reports. */
    text: string
    onChange?: (clamped: boolean) => void
    /** Replaces the layout measurement; defaults to `measureClamp`. */
    measure?: (node: HTMLElement) => boolean
}

export function measureClamp(node: HTMLElement): boolean {
    return node.scrollHeight > node.clientHeight
}

export function clampOverflow(node: HTMLElement, options: ClampOverflowOptions) {
    let current = options
    let reported: boolean | undefined
    let observer: ResizeObserver | null = null
    let destroyed = false

    function check(): void {
        if (!current.onChange) {
            return
        }
        const clamped = (current.measure ?? measureClamp)(node)
        if (clamped === reported) {
            return
        }
        reported = clamped
        current.onChange(clamped)
    }

    function sync(): void {
        if (!current.onChange) {
            observer?.disconnect()
            observer = null
            reported = undefined
            return
        }
        if (!observer) {
            const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
            if (RO) {
                observer = new RO(check)
                observer.observe(node)
            }
        }
        check()
    }

    sync()

    return {
        update(newOptions: ClampOverflowOptions) {
            if (newOptions.text !== current.text) {
                reported = undefined
            }
            current = newOptions
            // An update runs before the same render's class and content changes reach the element, so the layout is read once they have.
            queueMicrotask(() => {
                if (!destroyed) {
                    sync()
                }
            })
        },
        destroy() {
            destroyed = true
            observer?.disconnect()
        },
    }
}
