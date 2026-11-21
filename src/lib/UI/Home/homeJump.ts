/** How long a jump keeps re-aiming at its target while the layout settles. */
const REAIM_WINDOW_MS = 1000
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

/**
 * Scrolls a section to the top of the landing scroller and moves the focus into it. Only that scroller moves:
 * `scrollIntoView` would also scroll every ancestor, the hidden-overflow document included, and shift the
 * landing off its frame. `behavior` is `'instant'` when motion is reduced. The focus never scrolls on its own
 * (`preventScroll`), so the one scroll is the animated one. `focus` defaults to the target; returns false, and
 * does nothing, when there is no scroller or no target.
 *
 * The offset is measured once, so a layout change while the smooth scroll is in flight (the sidebar column
 * returning after Studio) would leave the target off its edge. For a short window the scroller and the target
 * are observed and the scroll is re-issued with the target's current offset, only when that offset moved by half a pixel or more. The
 * re-aim ends at the end of the window, at the first user input, when `signal` aborts, and where
 * `ResizeObserver` is missing it never starts. It never moves the focus again.
 */
export function jumpToSection({ scroller, target, focus = target, reduced, signal }: {
    scroller: HTMLElement | null
    target: HTMLElement | null
    focus?: HTMLElement | null
    reduced: boolean
    signal?: AbortSignal
}): boolean {
    if (!scroller || !target) return false
    const offset = (): number => scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const behavior = reduced ? 'instant' : 'smooth'
    let aimed = offset()
    scroller.scrollTo({ top: aimed, behavior })
    ;(focus ?? target).focus({ preventScroll: true })
    if (typeof ResizeObserver !== 'undefined' && !signal?.aborted) {
        const observer = new ResizeObserver(() => {
            const top = offset()
            if (Math.abs(top - aimed) < 0.5) return
            aimed = top
            scroller.scrollTo({ top, behavior })
        })
        const inputTargets: EventTarget[] = [scroller, document]
        let timer: ReturnType<typeof setTimeout> | undefined
        const stop = (): void => {
            observer.disconnect()
            clearTimeout(timer)
            for (const node of inputTargets) {
                for (const type of USER_INPUT_EVENTS) node.removeEventListener(type, stop)
            }
            signal?.removeEventListener('abort', stop)
        }
        observer.observe(scroller)
        observer.observe(target)
        for (const node of inputTargets) {
            for (const type of USER_INPUT_EVENTS) node.addEventListener(type, stop, { passive: true })
        }
        timer = setTimeout(stop, REAIM_WINDOW_MS)
        signal?.addEventListener('abort', stop)
    }
    return true
}
