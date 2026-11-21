/**
 * Scrolls a section to the top of its scroller and moves the focus into it. `behavior` is `'instant'` when
 * motion is reduced. The focus never scrolls on its own (`preventScroll`), so the one scroll is the animated one.
 * `focus` defaults to the scrolled element; returns false, and does nothing, when there is no scroll target.
 */
export function jumpToSection({ scroll, focus = scroll, reduced }: {
    scroll: HTMLElement | null
    focus?: HTMLElement | null
    reduced: boolean
}): boolean {
    if (!scroll) return false
    scroll.scrollIntoView({ block: 'start', behavior: reduced ? 'instant' : 'smooth' })
    ;(focus ?? scroll).focus({ preventScroll: true })
    return true
}
