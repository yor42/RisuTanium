// When the list starts loading older rows while the reader moves toward the top of the window. The mount of a page stalls the main
// thread, so the load has to start while the reader is still far enough from the top that the measured load ends before the current
// upward speed reaches it. All distances are css px and all times ms.

// The distance at which a load started before any speed or load time was known; also the only trigger while a realign window holds the position.
export const NEAR_TOP_PX = 100
// The assumed load time until the first load of the list has been measured.
export const DEFAULT_LOAD_MS = 600
export const MAX_LOAD_MS = 1500
export const MAX_SPEED_PX_PER_MS = 25
// One interval is noisy and a single programmatic write must not read as a fling, so a speed needs at least two intervals.
export const SPEED_MIN_SAMPLES = 3
export const SPEED_MAX_SAMPLES = 5
// Samples closer together than this are not frame-paced; their speed is not trusted.
export const SPEED_MIN_SPAN_MS = 8
// A longer gap is a pause or a stalled main thread, after which older samples no longer describe the motion.
export const SPEED_IDLE_GAP_MS = 300
// A move toward newer rows by more than this ends the run; float storage jitter does not.
export const TOWARD_NEWER_EPSILON = 0.5

function finite(value: number): number {
    return Number.isFinite(value) ? value : 0
}
function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value))
}

// The reader is close enough to the top that older rows load when scrollTop is strictly below this distance.
export function olderPrefetchDistance({ clientHeight, speed, loadMs, held }: { clientHeight: number, speed: number, loadMs: number | null, held: boolean }): number {
    if (held) return NEAR_TOP_PX
    const base = Math.max(NEAR_TOP_PX, finite(clientHeight))
    const lead = clamp(finite(speed), 0, MAX_SPEED_PX_PER_MS) * clamp(loadMs === null ? DEFAULT_LOAD_MS : finite(loadMs), 0, MAX_LOAD_MS)
    return base + lead
}

// A costly load counts at once and a cheap one only halves the estimate, so one cheap page does not shorten the lead for the next fling.
export function nextLoadEstimate(previous: number | null, measured: number): number {
    const current = clamp(finite(measured), 0, MAX_LOAD_MS)
    if (previous === null) return current
    return clamp(Math.max(current, (previous + current) / 2), 0, MAX_LOAD_MS)
}

export interface UpwardSpeed {
    sample(top: number, at: number): void
    // Px per ms toward the top of the window over the recent samples; 0 when there is no trustworthy run.
    speed(): number
}

export function createUpwardSpeed(): UpwardSpeed {
    const samples: { top: number, at: number }[] = []
    return {
        sample(top, at) {
            if (!Number.isFinite(top) || !Number.isFinite(at)) { samples.length = 0; return }
            const last = samples[samples.length - 1]
            if (last && (top - last.top > TOWARD_NEWER_EPSILON || at - last.at > SPEED_IDLE_GAP_MS || at < last.at)) samples.length = 0
            samples.push({ top, at })
            if (samples.length > SPEED_MAX_SAMPLES) samples.shift()
        },
        speed() {
            if (samples.length < SPEED_MIN_SAMPLES) return 0
            const oldest = samples[0]
            const newest = samples[samples.length - 1]
            const span = newest.at - oldest.at
            if (span < SPEED_MIN_SPAN_MS) return 0
            return Math.max(0, (oldest.top - newest.top) / span)
        },
    }
}
