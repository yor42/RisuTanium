// A load-older restore places the reader's row and then the browser resolves the estimated heights of the older rows over the next
// frames. Native scroll anchoring keeps one anchor row in place, which can leave the row at the top of the screen displaced. For a
// short window after the restore this module holds that top row at the offset it had when the window began, but only while the
// reader is still: it never writes against the reader.
//
// Reader motion and layout are told apart in the same synchronous check that would write. Only a scroll changes the scroll position:
// layout moves rows without moving it, unless native anchoring compensates, and then the anchor row keeps its offset. So a reading is
// still when the position did not move since the last reading, or when some visible row kept its offset. Otherwise the motion is the
// reader's (or unexplained) and the window ends without a write. For pure reader motion with no layout shift the effective threshold
// is STILL_EPSILON, because every row then moves by the scroll and keeps its place only within that tolerance.

// How long after the restore the top row is held.
export const REALIGN_WINDOW_MS = 300
// How long a jump holds the row it landed on: images and late layout in the first second move rows above the target.
export const JUMP_HOLD_MS = 1000
// Offsets that differ by no more than this are layout rounding, not a shift to correct.
export const WRITE_EPSILON = 0.5
// A visible row that moved by no more than this since the last reading counts as having kept its place.
export const STILL_EPSILON = 1
// A scroll position that moved by no more than this has not scrolled: it is far above float storage rounding and below one device pixel.
export const SCROLL_EPSILON = 0.1

// A row whose top is within this of the host top still counts as inside the viewport.
const EDGE_EPSILON = 0.5
const ROW_SELECTOR = '[data-part="chat-message-container"], [data-part="chat-first-message"]'
const HOST_INPUT_EVENTS = ['touchstart', 'pointerdown', 'wheel', 'keydown'] as const

export interface LoadRealignDeps {
    host: () => HTMLElement | undefined
    // The element that holds the rows (the transcript content).
    rows: () => HTMLElement | undefined
    // False while the chat surface is hidden.
    active: () => boolean
    // Counts reader-intent events; a changed count means the reader moved the view after the window began.
    intentSeq: () => number
    // True while a step hold owns the position.
    held: () => boolean
    // True while the reader follows the newest message.
    following: () => boolean
    setTimer: (callback: () => void, ms: number) => number
    clearTimer: (id: number) => void
    // Calls back after layout whenever the size of `target` changes; returns a function that stops observing.
    observe: (target: Element, callback: () => void) => () => void
    requestFrame: (callback: () => void) => number
    cancelFrame: (id: number) => void
}

export interface LoadRealign {
    // Begins a window that holds the row at the top of the screen where it is now; replaces any active window.
    // `row` names the row to hold instead of the top row, and `ms` replaces the window length; both are read at this call.
    start: (options?: { row?: Element, ms?: number }) => void
    // Ends the active window, if any.
    cancel: () => void
    isActive: () => boolean
}

interface RowReading {
    row: Element
    // Distances from the host top, so they do not depend on the scroll position.
    top: number
    bottom: number
}

// The visible rows, topmost first. The rows are laid out newest first, so the DOM is walked from its end. Rows above the host and
// rows with no height are skipped, and the walk stops at the first row below the host, so the cost follows the rows on screen.
function readRows(host: HTMLElement, rows: HTMLElement): RowReading[] {
    const hostRect = host.getBoundingClientRect()
    const readings: RowReading[] = []
    const children = rows.children
    for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index]
        if (!child.matches(ROW_SELECTOR)) continue
        const rect = child.getBoundingClientRect()
        if (rect.height <= 0) continue
        if (rect.bottom <= hostRect.top) continue
        if (rect.top >= hostRect.bottom) break
        readings.push({ row: child, top: rect.top - hostRect.top, bottom: rect.bottom - hostRect.top })
    }
    return readings
}

function readOffsets(host: HTMLElement, rows: HTMLElement): Map<Element, number> {
    const offsets = new Map<Element, number>()
    for (const reading of readRows(host, rows)) offsets.set(reading.row, reading.top)
    return offsets
}

function offsetOf(host: HTMLElement, row: Element): number {
    return row.getBoundingClientRect().top - host.getBoundingClientRect().top
}

// The row at the top of the screen: the first row whose top is inside the viewport, else the row that straddles the top edge.
export function viewportTopRow(host: HTMLElement, rows: HTMLElement): Element | null {
    const readings = readRows(host, rows)
    const inside = readings.find((reading) => reading.top >= -EDGE_EPSILON)
    return (inside ?? readings[0])?.row ?? null
}

// Applies only when the scroll position moved; a row that kept its offset then identifies native anchoring.
function keptPlace(before: Map<Element, number>, after: Map<Element, number>): boolean {
    for (const [row, offset] of after) {
        const earlier = before.get(row)
        if (earlier !== undefined && Math.abs(offset - earlier) <= STILL_EPSILON) return true
    }
    return false
}

interface RealignWindow {
    host: HTMLElement
    rows: HTMLElement
    top: Element
    offset: number
    // The offsets at the last reading; refreshed after every check so the module's own write is not compared next time.
    snapshot: Map<Element, number>
    // The host scroll position at the last reading, re-read after the module's own write because a write may be clamped or stored at float32.
    scroll: number
    intent: number
    disconnect: () => void
    frame: number | null
    timer: number
    onInput: () => void
}

// A start replaces the active window and captures the position as it is at that call. A caller that starts right after its own
// scroll write therefore holds the written position, and that write is never corrected back.
export function createLoadRealign(deps: LoadRealignDeps): LoadRealign {
    let current: RealignWindow | null = null

    function end(): void {
        const state = current
        if (!state) return
        current = null
        state.disconnect()
        if (state.frame !== null) deps.cancelFrame(state.frame)
        deps.clearTimer(state.timer)
        for (const type of HOST_INPUT_EVENTS) state.host.removeEventListener(type, state.onInput)
    }

    // The only place that writes. The write is decided and made in the same synchronous call that read the rows.
    function check(): void {
        const state = current
        if (!state) return
        if (
            deps.intentSeq() !== state.intent ||
            deps.held() ||
            deps.following() ||
            !deps.active() ||
            !state.top.isConnected ||
            deps.host() !== state.host ||
            deps.rows() !== state.rows
        ) {
            end()
            return
        }
        const now = readOffsets(state.host, state.rows)
        const scroll = state.host.scrollTop
        if (Math.abs(scroll - state.scroll) > SCROLL_EPSILON && !keptPlace(state.snapshot, now)) {
            end()
            return
        }
        const delta = offsetOf(state.host, state.top) - state.offset
        if (Math.abs(delta) > WRITE_EPSILON) {
            state.host.scrollTop += delta
            state.snapshot = readOffsets(state.host, state.rows)
            state.scroll = state.host.scrollTop
        } else {
            state.snapshot = now
            state.scroll = scroll
        }
    }

    function frameCheck(): void {
        const state = current
        if (!state) return
        state.frame = null
        check()
        if (current === state) state.frame = deps.requestFrame(frameCheck)
    }

    function start(options?: { row?: Element, ms?: number }): void {
        end()
        const host = deps.host()
        const rows = deps.rows()
        if (!host || !rows || !deps.active() || deps.held() || deps.following()) return
        const top = options?.row ?? viewportTopRow(host, rows)
        if (!top) return
        const onInput = (): void => end()
        const state: RealignWindow = {
            host,
            rows,
            top,
            offset: offsetOf(host, top),
            snapshot: readOffsets(host, rows),
            scroll: host.scrollTop,
            intent: deps.intentSeq(),
            disconnect: () => {},
            frame: null,
            timer: 0,
            onInput,
        }
        current = state
        const disconnect = deps.observe(rows, check)
        // An observer that ran its callback during observe may already have ended the window.
        if (current !== state) {
            disconnect()
            return
        }
        state.disconnect = disconnect
        state.frame = deps.requestFrame(frameCheck)
        for (const type of HOST_INPUT_EVENTS) host.addEventListener(type, onInput, { passive: true })
        state.timer = deps.setTimer(end, options?.ms ?? REALIGN_WINDOW_MS)
    }

    return { start, cancel: end, isActive: () => current !== null }
}
