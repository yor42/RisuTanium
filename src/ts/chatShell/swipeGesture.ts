// SLICE1_SPEC §3.2: slop is px; arm distance is dp; velocities are px/ms.
export const SWIPE_SLOP_PX = 10
export const SWIPE_AXIS_RATIO = 1.5
export const SWIPE_COMMIT_FRACTION = 0.3
export const SWIPE_FLING_PX_MS = 0.5
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
    let lastVelocity = 0
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
        lastVelocity = 0
    }

    // A pull past the last alternative can only generate on a row that owns the newest reply.
    function reachesEnd(dx: number): boolean {
        return dx < 0 && options.index >= options.count - 1 && !options.firstMessage && !options.streaming && options.canGenerate !== false
    }

    function down(sample: PointerSample): SwipeResult {
        clear()
        if (usable) start = previous = sample
        return result()
    }

    function move(sample: PointerSample): SwipeResult {
        if (!start || !previous) return result()
        const dx = sample.x - start.x
        const dy = sample.y - start.y
        const elapsed = sample.time - previous.time
        const velocity = elapsed > 0 ? (sample.x - previous.x) / elapsed : 0
        previous = sample
        lastVelocity = velocity
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
        const elapsed = previous ? sample.time - previous.time : 0
        const velocity = elapsed > 0 && previous ? (sample.x - previous.x) / elapsed : sample.time - (previous?.time ?? 0) <= 80 ? lastVelocity : 0
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
