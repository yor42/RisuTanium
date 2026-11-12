// SLICE1_SPEC §3.2: slop is px; arm distance is dp; velocities are px/ms.
export const SWIPE_SLOP_PX = 10
export const SWIPE_AXIS_RATIO = 1.5
export const SWIPE_COMMIT_FRACTION = 0.3
export const SWIPE_FLING_PX_MS = 0.5
// The release velocity runs from an anchor to the lift. The anchor is the newest sample at or before this window prior to the lift, so the span covers the window even when moves are sparse and the last one sits at the lift's position; a drag shorter than the window is anchored on its down sample. Samples are added only on a move, so a finger that rested longer than the window leaves an anchor at the lift's position and has velocity 0.
export const SWIPE_VELOCITY_WINDOW_MS = 80
const SWIPE_SAMPLE_LIMIT = 64
export const ARM_DISTANCE_DP = 160
export const ARM_HOLD_MS = 300
export const ARM_STILL_PX_MS = 0.15
export const WHEEL_DISTANCE_PX = 40
export const RUBBER_BAND_PX = 24
export const WHEEL_GAP_MS = 160
export const WHEEL_LOCK_MS = 450

export type SwipeEvent = 'none' | 'stepPrev' | 'stepNext' | 'arm' | 'generate'
export interface PointerSample { x: number; y: number; time: number }
export interface SwipeOptions { widthPx: number; dpPerPx: number; index: number; count: number; edge?: boolean; streaming?: boolean; firstMessage?: boolean; canGenerate?: boolean; enabled?: boolean; pointerType?: 'touch' | 'pen' | 'mouse' }
export interface SwipeResult { event: SwipeEvent; progress: number; locked: boolean; armed: boolean }

export function createSwipeGesture(options: SwipeOptions) {
    let start: PointerSample | null = null
    let previous: PointerSample | null = null
    let axis: 'pending' | 'horizontal' | 'vertical' = 'pending'
    let armed = false
    let holdStart: number | null = null
    let progress = 0
    let samples: PointerSample[] = []
    const scale = options.dpPerPx > 0 ? options.dpPerPx : 1
    const usable = options.enabled !== false && !options.edge && options.pointerType !== 'mouse'
    const result = (event: SwipeEvent = 'none'): SwipeResult => ({ event, progress, locked: axis === 'horizontal', armed })

    function clear(): void {
        start = null
        previous = null
        axis = 'pending'
        armed = false
        holdStart = null
        progress = 0
        samples = []
    }

    // A pull past the last alternative can only generate on a row that owns the newest reply.
    function reachesEnd(dx: number): boolean {
        return dx < 0 && options.index >= options.count - 1 && !options.firstMessage && !options.streaming && options.canGenerate !== false
    }

    // Only the newest sample at or before the window start, and everything after it, can reach a later release; the cap bounds a very dense stream.
    function record(sample: PointerSample): void {
        samples.push(sample)
        let drop = 0
        while (drop < samples.length - 1 && samples[drop + 1].time <= sample.time - SWIPE_VELOCITY_WINDOW_MS) drop++
        drop = Math.max(drop, samples.length - SWIPE_SAMPLE_LIMIT)
        if (drop > 0) samples.splice(0, drop)
    }

    function down(sample: PointerSample): SwipeResult {
        clear()
        if (usable) { start = previous = sample; samples = [sample] }
        return result()
    }

    function move(sample: PointerSample): SwipeResult {
        if (!start || !previous) return result()
        const dx = sample.x - start.x
        const dy = sample.y - start.y
        const elapsed = sample.time - previous.time
        const velocity = elapsed > 0 ? (sample.x - previous.x) / elapsed : 0
        previous = sample
        record(sample)
        if (axis === 'pending' && (Math.abs(dx) > SWIPE_SLOP_PX || Math.abs(dy) > SWIPE_SLOP_PX)) {
            axis = Math.abs(dx) > SWIPE_SLOP_PX && Math.abs(dx) > SWIPE_AXIS_RATIO * Math.abs(dy) ? 'horizontal' : 'vertical'
        }
        if (axis !== 'horizontal') return result()
        if (!reachesEnd(dx)) {
            armed = false
            holdStart = null
            progress = 0
            return result()
        }
        const distanceDp = -dx * scale
        if (distanceDp < ARM_DISTANCE_DP) {
            armed = false
            holdStart = null
            progress = Math.max(0, 0.7 * distanceDp / ARM_DISTANCE_DP)
            return result()
        }
        // Once armed, jitter of the finger cannot lower the cue: the release generates exactly as the armed cue says.
        if (armed) { progress = 1; return result() }
        if (Math.abs(velocity) >= ARM_STILL_PX_MS) holdStart = null
        else if (holdStart === null) holdStart = sample.time
        progress = 0.7 + (holdStart === null ? 0 : 0.3 * Math.min(1, (sample.time - holdStart) / ARM_HOLD_MS))
        if (!armed && holdStart !== null && sample.time - holdStart >= ARM_HOLD_MS) {
            armed = true
            progress = 1
            return result('arm')
        }
        return result()
    }

    // A finger that stays still sends no pointer events, so the host calls this from a timer: stillness is measured from the last sample.
    function tick(now: number): SwipeResult {
        if (!start || !previous || axis !== 'horizontal' || armed) return result()
        const dx = previous.x - start.x
        if (!reachesEnd(dx) || -dx * scale < ARM_DISTANCE_DP) return result()
        if (holdStart === null) holdStart = previous.time
        // A still finger sends no events, so the hold is recorded at its position: a release after the hold is measured from the hold, not averaged over it.
        if (now > samples[samples.length - 1].time) record({ x: previous.x, y: previous.y, time: now })
        progress = 0.7 + 0.3 * Math.min(1, Math.max(0, now - holdStart) / ARM_HOLD_MS)
        if (now - holdStart >= ARM_HOLD_MS) {
            armed = true
            progress = 1
            return result('arm')
        }
        return result()
    }
    function up(sample: PointerSample): SwipeResult {
        if (!start || axis !== 'horizontal') { clear(); return result() }
        const dx = sample.x - start.x
        // The fallback to the oldest retained sample (the down sample) applies only when none reaches back to the window start, which is a drag shorter than the window; a pause leaves an older sample, so it is never turned into a fling.
        let anchor = samples[0]
        for (const moved of samples) if (moved.time <= sample.time - SWIPE_VELOCITY_WINDOW_MS) anchor = moved
        const elapsed = sample.time - anchor.time
        const velocity = elapsed > 0 ? (sample.x - anchor.x) / elapsed : 0
        const canGenerate = armed && dx < 0 && -dx * scale >= ARM_DISTANCE_DP && Math.abs(velocity) <= SWIPE_FLING_PX_MS
        let event: SwipeEvent = 'none'
        if (canGenerate) event = 'generate'
        else if (!options.streaming && (Math.abs(dx) > options.widthPx * SWIPE_COMMIT_FRACTION || Math.abs(velocity) > SWIPE_FLING_PX_MS && Math.sign(velocity) === Math.sign(dx))) {
            if (dx > 0 && options.index > 0) event = 'stepPrev'
            if (dx < 0 && options.index < options.count - 1) event = 'stepNext'
        }
        clear()
        return result(event)
    }

    function cancel(): SwipeResult { clear(); return result() }
    return { down, move, tick, up, cancel }
}

export interface WheelSample { dx: number; dy: number; time: number; shiftKey?: boolean }
export interface WheelSteps {
    (sample: WheelSample): SwipeEvent
    // Moves the position the next step is measured from; the gesture and the lock are not touched, so they survive an index or count change.
    set(index: number, count: number): void
}
export function createWheelSteps(initialIndex: number, initialCount: number): WheelSteps {
    let index = initialIndex
    let count = initialCount
    let dx = 0
    let dy = 0
    let last = -Infinity
    let lock = -Infinity
    let done = false
    const step = (sample: WheelSample): SwipeEvent => {
        if (sample.time - last > WHEEL_GAP_MS) { dx = 0; dy = 0; done = false }
        last = sample.time
        dx += sample.shiftKey && sample.dx === 0 ? sample.dy : sample.dx
        dy += sample.shiftKey && sample.dx === 0 ? 0 : sample.dy
        if (done || sample.time < lock || Math.abs(dx) < WHEEL_DISTANCE_PX || Math.abs(dx) <= 2 * Math.abs(dy)) return 'none'
        done = true
        lock = sample.time + WHEEL_LOCK_MS
        if (dx > 0 && index > 0) { index--; return 'stepPrev' }
        if (dx < 0 && index < count - 1) { index++; return 'stepNext' }
        return 'none'
    }
    return Object.assign(step, { set(nextIndex: number, nextCount: number): void { index = nextIndex; count = nextCount } })
}

// SLICE1_SPEC §3.2 feedback. The meter fills with the pull; where motion is reduced or power is low it is a static
// ring that fills in quarter steps. An armed meter is full.
export function meterFill(progress: number, armed: boolean, stepped: boolean): number {
    if (armed) return 1
    const fill = Math.max(0, Math.min(1, progress))
    return stepped ? Math.floor(fill * 4) / 4 : fill
}

/** The alternative a horizontal drag reveals, as its 1-based position, or null where none can come in. */
export function peekNeighbour(dx: number, index: number, count: number, streaming: boolean): number | null {
    if (streaming || dx === 0) return null
    if (dx > 0) return index > 1 ? index - 1 : null
    return index < count ? index + 1 : null
}

const PEEK_TEXT_MAX = 200

/**
 * A raw message reduced to plain text for the peek: macros (innermost first, so nested ones go too), tags and
 * markdown marks removed, whitespace collapsed. It is shown as text only; nothing here is parsed or rendered.
 */
export function peekText(raw: string): string {
    // Only the start can be shown, so only the start is cleaned; this bounds the macro loop on a long or deeply nested message.
    let text = raw.slice(0, PEEK_TEXT_MAX * 4)
    for (let previous = ''; previous !== text;) {
        previous = text
        text = text.replace(/\{\{[^{}]*\}\}/g, ' ')
    }
    return text.replace(/<[^>]*>?/g, ' ').replace(/[*_`#>~|]/g, '').replace(/\s+/g, ' ').trim().slice(0, PEEK_TEXT_MAX)
}
