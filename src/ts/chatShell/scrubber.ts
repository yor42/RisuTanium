/**
 * Pure rules of the transcript position scrubber, DOM free. Timers are injected so tests and the component share one clock.
 *
 * The thumb and the release index come from message indices only, never from scrollTop or row heights: estimated row sizes in
 * the transcript cannot distort the mapping. Every mapping function returns a finite, clamped value, so a degenerate track
 * (a landscape phone, an open keyboard) can never hand `jumpTo` a NaN.
 */

export const SCRUB_LINGER_MS = 1500
export const HOVER_EDGE_PX = 120
export const DRAG_SLOP_PX = 6
export const DRAG_HOLD_MS = 260
export const PAGE_FRACTION = 0.9

const LINE_PX = 16

export type TimerHandle = number
export interface ScrubTimers {
    setTimer(callback: () => void, ms: number): TimerHandle
    clearTimer(handle: TimerHandle): void
}

function clamp01(value: number): number {
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/** The thumb position, 0..1. The bottom of the chat is always 1; the first message (index -1) and short chats are 0. */
export function thumbFraction(input: { topIndex: number, count: number, atBottom: boolean }): number {
    if (input.atBottom) return 1
    if (!(input.count >= 2) || !Number.isFinite(input.topIndex) || input.topIndex <= 0) return 0
    return clamp01(input.topIndex / (input.count - 1))
}

/** The thumb position that puts the thumb's grab point under the pointer, 0..1; a track with no travel gives 0. */
export function fractionAtPointer(input: { y: number, grab: number, trackTop: number, trackHeight: number, thumbHeight: number }): number {
    const { y, grab, trackTop, trackHeight, thumbHeight } = input
    const travel = trackHeight - thumbHeight
    if (![y, grab, trackTop, trackHeight, thumbHeight].every(Number.isFinite) || !(travel > 0)) return 0
    return clamp01((y - grab - trackTop) / travel)
}

export function indexAtFraction(fraction: number, count: number): number {
    if (!(count >= 1) || !Number.isFinite(count)) return 0
    const last = Math.floor(count) - 1
    const p = Number.isFinite(fraction) ? fraction : 0
    return Math.min(last, Math.max(0, Math.round(p * last)))
}

/** False when the thumb's travel is under one thumb height: such a track cannot address a long chat. */
export function scrubberFits(trackHeight: number, thumbHeight: number): boolean {
    return Number.isFinite(trackHeight) && Number.isFinite(thumbHeight) && thumbHeight > 0 && trackHeight - thumbHeight >= thumbHeight
}

/** True when the move crossed at least one 10 % mark; 1 counts as the tenth mark. */
export function tenthCrossed(prev: number, next: number): boolean {
    const tenth = (p: number) => Math.floor(clamp01(p) * 10)
    return tenth(prev) !== tenth(next)
}

export interface BubbleParts {
    /** `index + 1`, so the first scrubbed message reads 1. */
    position: string
    total: string
    /** Absent unless the message has a numeric time. */
    date: string | null
}

export function bubbleParts(index: number, count: number, time: number | undefined, format: Intl.DateTimeFormat): BubbleParts {
    return {
        position: (index + 1).toLocaleString(),
        total: count.toLocaleString(),
        date: typeof time === 'number' && Number.isFinite(time) ? format.format(time) : null,
    }
}

/** A wheel delta in pixels, the same line and page units the reader-intent reducer applies. */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
    return deltaY * (deltaMode === 1 ? LINE_PX : deltaMode === 2 ? pageHeight : 1)
}

export type GestureOutcome =
    | { kind: 'tap', x: number, y: number }
    | { kind: 'dragStart' }
    | { kind: 'drag', y: number }
    | { kind: 'release' }
    | { kind: 'aborted' }

export interface ScrubGesture {
    down(x: number, y: number): void
    move(x: number, y: number): GestureOutcome | null
    up(): GestureOutcome | null
    abort(): GestureOutcome | null
    readonly phase: 'idle' | 'pending' | 'dragging'
}

/**
 * Tells a tap on the thumb from a drag: a drag starts after DRAG_SLOP_PX of movement or a DRAG_HOLD_MS hold, and a hold start is
 * reported through `onHoldStart`. Anything shorter and smaller is a tap that the component passes through.
 */
export function createScrubGesture(options: ScrubTimers & { onHoldStart: () => void }): ScrubGesture {
    let phase: 'idle' | 'pending' | 'dragging' = 'idle'
    let originX = 0
    let originY = 0
    let timer: TimerHandle | null = null

    function stopTimer(): void {
        if (timer !== null) {
            options.clearTimer(timer)
            timer = null
        }
    }

    return {
        down(x, y) {
            stopTimer()
            phase = 'pending'
            originX = x
            originY = y
            timer = options.setTimer(() => {
                timer = null
                if (phase === 'pending') {
                    phase = 'dragging'
                    options.onHoldStart()
                }
            }, DRAG_HOLD_MS)
        },
        move(x, y) {
            if (phase === 'dragging') return { kind: 'drag', y }
            if (phase !== 'pending' || Math.hypot(x - originX, y - originY) < DRAG_SLOP_PX) return null
            stopTimer()
            phase = 'dragging'
            return { kind: 'dragStart' }
        },
        up() {
            stopTimer()
            const was = phase
            phase = 'idle'
            if (was === 'pending') return { kind: 'tap', x: originX, y: originY }
            return was === 'dragging' ? { kind: 'release' } : null
        },
        abort() {
            stopTimer()
            const was = phase
            phase = 'idle'
            return was === 'idle' ? null : { kind: 'aborted' }
        },
        get phase() { return phase },
    }
}

export interface ScrubVisibility {
    readerScrolled(): void
    hover(on: boolean): void
    dragging(on: boolean): void
    blocked(on: boolean): void
    destroy(): void
    readonly visible: boolean
    /** The track takes clicks only while a mouse hover revealed it. */
    readonly trackInteractive: boolean
}

/** When the scrubber shows: reader intent lingers, a mouse hover and a live drag hold it, and a blocker always wins. */
export function createScrubVisibility(options: ScrubTimers & { onChange: () => void }): ScrubVisibility {
    let lingering = false
    let hovering = false
    let isDragging = false
    let isBlocked = false
    let timer: TimerHandle | null = null
    let lastVisible = false
    let lastInteractive = false

    const visible = () => !isBlocked && (lingering || hovering || isDragging)
    const interactive = () => hovering && !isBlocked

    function notify(): void {
        const nextVisible = visible()
        const nextInteractive = interactive()
        if (nextVisible === lastVisible && nextInteractive === lastInteractive) return
        lastVisible = nextVisible
        lastInteractive = nextInteractive
        options.onChange()
    }

    function arm(): void {
        if (timer !== null) options.clearTimer(timer)
        lingering = true
        timer = options.setTimer(() => {
            timer = null
            lingering = false
            notify()
        }, SCRUB_LINGER_MS)
    }

    return {
        readerScrolled() { arm(); notify() },
        hover(on) { hovering = on; notify() },
        dragging(on) {
            isDragging = on
            // The linger restarts when a drag ends, so the thumb does not vanish under the finger that just released it.
            if (!on) arm()
            notify()
        },
        blocked(on) { isBlocked = on; notify() },
        destroy() {
            if (timer !== null) options.clearTimer(timer)
            timer = null
        },
        get visible() { return visible() },
        get trackInteractive() { return interactive() },
    }
}
