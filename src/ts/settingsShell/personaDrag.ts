/** A card's bounding box in viewport coordinates, as `getBoundingClientRect` reports it. */
export interface CardRect {
    left: number
    right: number
    top: number
    bottom: number
}

/** The pointer must be this close (px) to the top or bottom of the scroll view for the list to scroll. */
export const AUTOSCROLL_EDGE = 56
/** The largest scroll step (px) per animation frame, reached with the pointer at or beyond the view edge. */
export const AUTOSCROLL_MAX_STEP = 18

function gap(value: number, low: number, high: number): number {
    if (value < low) return low - value
    if (value > high) return value - high
    return 0
}

/**
 * The list index the dragged card lands on: the index of the card nearest the pointer, which is the card
 * the pointer is over whenever it is over one. `rects` are the cards in list order; with a two-column grid
 * the optional `pointerX` separates the cards of one row. An empty list leaves the card where it is.
 */
export function dropIndex(pointerY: number, rects: readonly CardRect[], from: number, pointerX?: number): number {
    if (rects.length === 0) return from
    let best = 0
    let bestDistance = Infinity
    rects.forEach((rect, index) => {
        const dy = gap(pointerY, rect.top, rect.bottom)
        const dx = pointerX === undefined ? 0 : gap(pointerX, rect.left, rect.right)
        const distance = dx * dx + dy * dy
        if (distance < bestDistance) {
            best = index
            bestDistance = distance
        }
    })
    return best
}

/**
 * The scroll step for this frame: negative near the top edge, positive near the bottom edge, zero between
 * them, growing with how deep the pointer is into the edge zone.
 */
export function autoscrollDelta(pointerY: number, viewTop: number, viewBottom: number): number {
    const edge = Math.min(AUTOSCROLL_EDGE, Math.max(0, (viewBottom - viewTop) / 2))
    if (edge === 0) return 0
    const intoTop = viewTop + edge - pointerY
    if (intoTop > 0) return -Math.round(AUTOSCROLL_MAX_STEP * Math.min(1, intoTop / edge))
    const intoBottom = pointerY - (viewBottom - edge)
    if (intoBottom > 0) return Math.round(AUTOSCROLL_MAX_STEP * Math.min(1, intoBottom / edge))
    return 0
}
