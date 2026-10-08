/**
 * Thresholds, timings and default sizes of the sidebar rail's pointer drag and drop. Code
 * and tests both import them; nothing else holds a copy of these numbers.
 */

/** Touch or pen press time before a row lifts. */
export const LONG_PRESS_MS = 500
/** Touch or pen movement that turns a pending long-press into a native scroll. */
export const TOUCH_SLOP_PX = 10
/** Mouse movement that starts a drag. */
export const MOUSE_DRAG_THRESHOLD_PX = 5
/** The centre zone of a row is this fraction of its height, centred. */
export const CENTRE_ZONE_FRACTION = 0.5
/** Time the pointer rests in a character's centre zone before dropping merges. */
export const MERGE_DWELL_MS = 400
/** Time the pointer rests in a closed folder's centre zone before the folder opens. */
export const SPRING_OPEN_MS = 700
export const EDGE_BAND_MAX_PX = 48
export const EDGE_BAND_FRACTION = 0.15
export const AUTO_SCROLL_MAX_PX_PER_S = 900
/** A longer gap between frames (a throttled tab) is treated as this long. */
export const AUTO_SCROLL_MAX_DT_MS = 50
/** The click that follows a drag or long-press is swallowed for at most this long. */
export const CLICK_SUPPRESS_MS = 500
/** Horizontal distance outside the column at which the target is lost. */
export const OUTSIDE_MARGIN_PX = 32
/** A `contextmenu` this soon after a touch gesture is treated as touch-originated. */
export const TOUCH_CONTEXTMENU_WINDOW_MS = 800
/** Share of the viewport height PageUp and PageDown scroll by during a drag. */
export const PAGE_SCROLL_FRACTION = 0.9

/** Margin above the open-folder background that is not part of it. */
export const FOLDER_BLOCK_MARGIN_PX = 4

/**
 * Heights used for an item that is not mounted or has not been measured. Each kind's markup
 * has a fixed px height and must not shrink in the flex column, because the window's offsets
 * assume these values: a 56 px avatar, a 2 px border on a folder, a 12 px gap, the `mt-1` and
 * `p-1` of an open folder and the 56 px "+" button.
 */
export const DEFAULT_HEIGHTS = {
    gap: 12,
    char: 56,
    folder: 58,
    member: 56,
    folderHead: 8,
    folderTail: 4,
    plus: 56,
} as const

/**
 * The rail mounts the rows inside the scroll viewport plus this many viewport heights above
 * and below it. It is the one knob for how far ahead rows are ready before a fling reaches
 * them: larger means fewer blank frames and more mounted rows.
 */
export const WINDOW_OVERSCAN_VIEWPORTS = 1
/** Floor of the overscan per side, in default character rows, so a tiny viewport still has a band. */
export const WINDOW_MIN_OVERSCAN_ROWS = 2
/** Longest a reveal pin may outlive its scroll when neither arrival nor focus releases it. */
export const REVEAL_PIN_TIMEOUT_MS = 1000
/** Viewport height assumed until the scroll container has reported a real one and the window has none. */
export const UNMEASURED_VIEWPORT_PX = 800
/** Scroll-to-active animates when the target is at most this many viewport heights away, and jumps beyond. */
export const SCROLL_SMOOTH_MAX_VIEWPORTS = 2

export function edgeBandPx(containerHeight: number): number {
    return Math.min(EDGE_BAND_MAX_PX, EDGE_BAND_FRACTION * containerHeight)
}
