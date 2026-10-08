/**
 * Swipe-trigger recognizer for the phone overlay sidebar. Pure: no DOM, no stores, no timers.
 * The caller feeds it one stroke at a time and performs the open or close itself; the
 * overlay does not follow the finger, so a stroke either triggers once or changes nothing.
 */

/**
 * Width of the strip, in CSS px, where a rightward stroke may open the overlay. It starts
 * past the OS back-gesture strip (reported by the host, zero without one). Wider would start
 * to steal strokes from chat content; narrower is hard to hit with a thumb.
 */
export const EDGE_ZONE_PX = 32

/**
 * Widest OS-reported gesture inset the zone honours, in CSS px. The caller reads the inset
 * only for touches left of `INSET_PROBE_MAX_CSS` and clamps it to
 * `INSET_PROBE_MAX_CSS - EDGE_ZONE_PX`, so the whole zone stays inside the probe window.
 */
export const INSET_PROBE_MAX_CSS = 128
export const INSET_MAX_CSS = INSET_PROBE_MAX_CSS - EDGE_ZONE_PX

/**
 * Whether a touch at `x` lies in the opening strip: `EDGE_ZONE_PX` wide, starting at `inset`,
 * the OS back-gesture strip's width. Both ends are inclusive. `inset` must already be sanitised.
 */
export function inEdgeZone(x: number, inset: number): boolean {
    return x >= inset && x <= inset + EDGE_ZONE_PX
}

/**
 * Movement below this is a tap or jitter, not a swipe. The stroke's direction is judged on
 * the first move past it and never re-judged, so a stroke that starts vertical (a scroll)
 * can never turn into a trigger.
 */
export const INTENT_SLOP_PX = 6

/** A horizontal claim needs |dx| at least this multiple of |dy|; anything steeper is a scroll. */
export const AXIS_RATIO = 1.5

/** Travel in the stroke's direction, from the touch start, that fires the trigger. */
export const TRIGGER_PX = 40

/**
 * Speed, over the last `FLING_WINDOW_MS`, that fires the trigger before `TRIGGER_PX` is
 * reached. A short fast flick should not need a long drag.
 */
export const FLING_PX_PER_MS = 0.4
export const FLING_WINDOW_MS = 100

/**
 * A fling needs at least this many samples (the touch start counts) in the window, so one
 * coalesced jump between two samples is not read as speed.
 */
export const MIN_FLING_SAMPLES = 3

/**
 * A stroke still unclaimed after this long is abandoned: a press and hold belongs to the
 * rail's long-press drag and to the page's own gestures, never to the overlay.
 */
export const DWELL_MS = 250

export type PanelIntent = 'open' | 'close'

/**
 * `claim`: the stroke is now this gesture's; the caller suppresses default scrolling from here.
 * `trigger`: fire the open or close now; the stroke is claimed and spent.
 * `abandon`: not this gesture's; the caller must never suppress anything for this stroke.
 */
export type PanelMove = 'claim' | 'trigger' | 'abandon' | 'none'

type Phase = 'idle' | 'pending' | 'claimed' | 'fired' | 'abandoned'

interface Sample {
    x: number
    y: number
    t: number
}

export class PanelGesture {
    private phase: Phase = 'idle'
    private dir = 1
    private startX = 0
    private startY = 0
    private startT = 0
    private samples: Sample[] = []

    start(x: number, y: number, t: number, intent: PanelIntent): void {
        this.phase = 'pending'
        this.dir = intent === 'open' ? 1 : -1
        this.startX = x
        this.startY = y
        this.startT = t
        this.samples = [{ x, y, t }]
    }

    move(x: number, y: number, t: number, cancelable: boolean): PanelMove {
        if (this.phase !== 'pending' && this.phase !== 'claimed') {
            return 'none'
        }
        this.samples.push({ x, y, t })
        while (this.samples.length > 1 && t - this.samples[0].t > FLING_WINDOW_MS) {
            this.samples.shift()
        }

        if (this.phase === 'pending') {
            if (t - this.startT > DWELL_MS) {
                this.phase = 'abandoned'
                return 'abandon'
            }
            const dx = x - this.startX
            const dy = y - this.startY
            if (Math.hypot(dx, dy) <= INTENT_SLOP_PX) {
                return 'none'
            }
            // An uncancelable move cannot be suppressed, so claiming it would scroll the page
            // while the overlay opens.
            if (Math.abs(dx) >= AXIS_RATIO * Math.abs(dy) && dx * this.dir > 0 && cancelable) {
                this.phase = 'claimed'
                return 'claim'
            }
            this.phase = 'abandoned'
            return 'abandon'
        }

        const travel = (x - this.startX) * this.dir
        if (travel >= TRIGGER_PX) {
            this.phase = 'fired'
            return 'trigger'
        }
        if (travel >= INTENT_SLOP_PX && this.samples.length >= MIN_FLING_SAMPLES) {
            const oldest = this.samples[0]
            const dt = t - oldest.t
            if (dt > 0 && ((x - oldest.x) * this.dir) / dt > FLING_PX_PER_MS) {
                this.phase = 'fired'
                return 'trigger'
            }
        }
        return 'none'
    }

    /** The finger lifted: a stroke that was claimed but never triggered changes nothing. */
    end(): void {
        this.phase = 'idle'
        this.samples = []
    }

    /** The stroke was interrupted (second touch, OS cancel, state change): it changes nothing. */
    cancel(): void {
        this.phase = 'idle'
        this.samples = []
    }
}
