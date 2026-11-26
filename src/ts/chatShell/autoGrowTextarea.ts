/**
 * Fits a textarea's height to its content while preserving the enclosing transcript's scrollTop
 * across the transient zero-height measurement reset.
 */
export function fitTextareaHeight(field: HTMLTextAreaElement): void {
    if (!field.isConnected) return
    const scroller = field.closest<HTMLElement>('[data-part="chat-transcript"]')
    const savedScrollTop = scroller ? scroller.scrollTop : null
    const style = getComputedStyle(field)
    const borderY = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)

    field.style.height = '0px'
    const contentHeight = field.scrollHeight
    field.style.height = contentHeight > 0 ? `${contentHeight + borderY}px` : ''

    if (scroller && savedScrollTop !== null && scroller.scrollTop !== savedScrollTop) {
        scroller.scrollTop = savedScrollTop
    }
}

/**
 * Re-measures a textarea when its rendered width changes so wrapped lines stay fitted
 * without looping on height-only adjustments.
 */
export function observeTextareaWidth(field: HTMLTextAreaElement): () => void {
    if (typeof ResizeObserver === 'undefined') return () => {}
    let lastWidth = field.clientWidth
    const observer = new ResizeObserver(() => {
        const nextWidth = field.clientWidth
        if (nextWidth > 0 && nextWidth !== lastWidth) {
            lastWidth = nextWidth
            fitTextareaHeight(field)
        }
    })
    observer.observe(field)
    return () => observer.disconnect()
}
