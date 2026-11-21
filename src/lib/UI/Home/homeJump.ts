/**
 * Scrolls a section to the top of the landing scroller and moves the focus into it. Only that scroller moves:
 * `scrollIntoView` would also scroll every ancestor, the hidden-overflow document included, and shift the
 * landing off its frame. `behavior` is `'instant'` when motion is reduced. The focus never scrolls on its own
 * (`preventScroll`), so the one scroll is the animated one. `focus` defaults to the target; returns false, and
 * does nothing, when there is no scroller or no target.
 */
export function jumpToSection({ scroller, target, focus = target, reduced }: {
    scroller: HTMLElement | null
    target: HTMLElement | null
    focus?: HTMLElement | null
    reduced: boolean
}): boolean {
    if (!scroller || !target) return false
    scroller.scrollTo({
        top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        behavior: reduced ? 'instant' : 'smooth',
    })
    ;(focus ?? target).focus({ preventScroll: true })
    return true
}
