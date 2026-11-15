/**
 * The edge autoscroll of a held drag: how far a scroller moves per frame for a pointer near its top or bottom.
 *
 * This module imports nothing, so a drag surface can use it without pulling in the sidebar's storage and alert modules.
 */

/** The most a held edge scrolls the list in one frame. */
export const AUTOSCROLL_MAX_PX = 12

/** The height of each edge band; it equals the sidebar's `ROW_HEIGHT`, and a test holds the two together. */
export const AUTOSCROLL_BAND_PX = 56

/** How far to scroll this frame for a pointer at `clientY` over a scroller spanning `top` to `bottom`: zero outside the edge bands. */
export function autoscrollDelta(clientY: number, top: number, bottom: number): number {
    const toTop = top + AUTOSCROLL_BAND_PX - clientY
    if (toTop > 0) {
        return -Math.min(AUTOSCROLL_MAX_PX, Math.ceil((AUTOSCROLL_MAX_PX * toTop) / AUTOSCROLL_BAND_PX))
    }
    const toBottom = clientY - (bottom - AUTOSCROLL_BAND_PX)
    if (toBottom > 0) {
        return Math.min(AUTOSCROLL_MAX_PX, Math.ceil((AUTOSCROLL_MAX_PX * toBottom) / AUTOSCROLL_BAND_PX))
    }
    return 0
}
