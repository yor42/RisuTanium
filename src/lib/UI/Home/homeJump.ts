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
 *
 * `onLayout` adjusts something inside the target that the landing offset does not cover (an inner list's own
 * scroll position). It runs once right after the focus and again on every observer callback of the window,
 * whether or not the landing offset moved, and stops with the re-aim. `observe` adds elements whose size
 * changes matter to `onLayout` but need not resize the scroller or the target (a list capped by its section).
 */
export function jumpToSection({ scroller, target, focus = target, reduced, signal, onLayout, observe = [] }: {
    scroller: HTMLElement | null
    target: HTMLElement | null
    focus?: HTMLElement | null
    reduced: boolean
    signal?: AbortSignal
    onLayout?: () => void
    observe?: readonly HTMLElement[]
}): boolean {
    if (!scroller || !target) return false
    const offset = (): number => scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const behavior = reduced ? 'instant' : 'smooth'
    let aimed = offset()
    scroller.scrollTo({ top: aimed, behavior })
    ;(focus ?? target).focus({ preventScroll: true })
    onLayout?.()
    if (typeof ResizeObserver !== 'undefined' && !signal?.aborted) {
        const observer = new ResizeObserver(() => {
            const top = offset()
            if (Math.abs(top - aimed) >= 0.5) {
                aimed = top
                scroller.scrollTo({ top, behavior })
            }
            onLayout?.()
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
        for (const node of observe) observer.observe(node)
        for (const node of inputTargets) {
            for (const type of USER_INPUT_EVENTS) node.addEventListener(type, stop, { passive: true })
        }
        timer = setTimeout(stop, REAIM_WINDOW_MS)
        signal?.addEventListener('abort', stop)
    }
    return true
}

/**
 * The nearest ancestor from `control` up to `section` (the section itself only when it scrolls) whose computed
 * `overflow-y` is `auto` or `scroll`; null when there is none inside `section`.
 */
export function scrollContainerOf(control: HTMLElement, section: HTMLElement): HTMLElement | null {
    let container: HTMLElement | null = control.parentElement
    while (container) {
        const overflowY = getComputedStyle(container).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') break
        if (container === section) return null
        container = container.parentElement
    }
    return container && section.contains(container) ? container : null
}

/**
 * Brings a focused control into view inside the list that scrolls it. The library section is bounded to the
 * landing's height and its list scrolls inside it, and `jumpToSection` focuses with `preventScroll`, so a control
 * deep in that list stays below the visible area. The container is the nearest ancestor from the control up to
 * `section` (the section itself only when it scrolls) whose computed `overflow-y` is `auto` or `scroll`. Rects are
 * measured relative to the container, so the result is independent of the landing scroll, and the move is the
 * minimal one ('nearest'): nothing when the control is already visible. Only that container's `scrollTop`
 * changes, instantly; the landing scroller and the document never move, and `scrollIntoView` is never used.
 * Does nothing when no such container exists.
 */
export function revealInScrollContainer(control: HTMLElement, section: HTMLElement): void {
    const container = scrollContainerOf(control, section)
    if (!container) return
    const box = container.getBoundingClientRect()
    const rect = control.getBoundingClientRect()
    const above = rect.top - box.top
    const overflow = rect.bottom - box.top - container.clientHeight
    if (overflow > 0) container.scrollTop += overflow
    else if (above < 0) container.scrollTop += above
}
