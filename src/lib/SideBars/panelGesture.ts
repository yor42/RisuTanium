/**
 * Swipe-trigger recognizer for the phone overlay sidebar. Pure: no DOM, no stores, no timers.
 * The caller feeds it one stroke at a time and performs the open or close itself; the
 * overlay does not follow the finger, so a stroke either triggers once or changes nothing.
 */

import { classifyEdge, type EdgeZoneInput } from '../../ts/chatShell/edgeZones'

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

/*
 * Follow-the-finger mode. Active only while the new chat shell is the surface; the recognizer
 * above and its thresholds stay exactly as they are for every other surface. Here the panel
 * position is a progress in [0, 1] that tracks the finger, and the release picks open or close
 * from that progress or from a fling.
 */

/** Open on release when the panel is more than this far open (a drag that started closed). */
export const FOLLOW_OPEN_RELEASE = 0.4

/** Close on release when the panel is less than this far open (a drag that started open). */
export const FOLLOW_CLOSE_RELEASE = 0.6

/** The overlay panel is `min(85vw, 360px)` wide, rail included. */
export const FOLLOW_PANEL_VW = 0.85
export const FOLLOW_PANEL_MAX_PX = 360

/** The wide layout starts here; the panel is docked and no gesture exists above it. */
export const WIDE_LAYOUT_MIN_PX = 900

export function followPanelWidth(viewportWidthPx: number): number {
    return Math.min(viewportWidthPx * FOLLOW_PANEL_VW, FOLLOW_PANEL_MAX_PX)
}

/**
 * Whether a touch at `xPx` starts the open drag: inside the edge strip of the side the panel
 * opens from, and not inside the OS back-gesture strip (`hostInsetDp`) that owns the outermost
 * pixels. The side mirrors in RTL. `hostInsetDp` must already be sanitised.
 */
export function inFollowOpenZone(input: EdgeZoneInput): boolean {
    if (classifyEdge(input) !== 'edge') {
        return false
    }
    const scale = input.dpPerPx > 0 ? input.dpPerPx : 1
    const xDp = input.xPx * scale
    const widthDp = input.viewportWidthPx * scale
    const inset = Math.max(0, input.hostInsetDp ?? 0)
    if (input.rtl) {
        return xDp > widthDp / 2 && xDp <= widthDp - inset
    }
    return xDp < widthDp / 2 && xDp >= inset
}

export type FollowIntent = 'open' | 'close'
export type FollowRelease = 'open' | 'close'

/**
 * `claim`: the stroke is now this gesture's (progress has its first value).
 * `drag`: progress changed. `abandon`: not this gesture's. `none`: nothing to do yet.
 */
export type FollowMove = 'claim' | 'drag' | 'abandon' | 'none'

type FollowPhase = 'idle' | 'pending' | 'dragging' | 'abandoned'

function clampProgress(value: number): number {
    return Math.min(Math.max(value, 0), 1)
}

export class PanelFollow {
    private phase: FollowPhase = 'idle'
    private intent: FollowIntent = 'open'
    /** +1 when opening moves the finger rightward (LTR), -1 in RTL. */
    private openDir = 1
    private width = FOLLOW_PANEL_MAX_PX
    private startX = 0
    private startY = 0
    private startT = 0
    private startProgress = 0
    private samples: Sample[] = []
    private current = 0

    start(x: number, y: number, t: number, intent: FollowIntent, panelWidthPx: number, rtl = false): void {
        this.phase = 'pending'
        this.intent = intent
        this.openDir = rtl ? -1 : 1
        this.width = panelWidthPx > 0 ? panelWidthPx : FOLLOW_PANEL_MAX_PX
        this.startX = x
        this.startY = y
        this.startT = t
        this.startProgress = intent === 'open' ? 0 : 1
        this.current = this.startProgress
        this.samples = [{ x, y, t }]
    }

    get progress(): number {
        return this.current
    }

    move(x: number, y: number, t: number, cancelable: boolean): FollowMove {
        if (this.phase !== 'pending' && this.phase !== 'dragging') {
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
            const toward = this.intent === 'open' ? 1 : -1
            // An uncancelable move cannot be suppressed, so claiming it would scroll the page
            // while the panel moves.
            if (Math.abs(dx) >= AXIS_RATIO * Math.abs(dy) && dx * this.openDir * toward > 0 && cancelable) {
                this.phase = 'dragging'
                this.current = this.progressAt(x)
                return 'claim'
            }
            this.phase = 'abandoned'
            return 'abandon'
        }

        const next = this.progressAt(x)
        if (next === this.current) {
            return 'none'
        }
        this.current = next
        return 'drag'
    }

    private progressAt(x: number): number {
        return clampProgress(this.startProgress + ((x - this.startX) * this.openDir) / this.width)
    }

    /**
     * Speed toward open over the last `FLING_WINDOW_MS` before `t`, in px/ms; negative toward
     * closed. Zero when too few samples are recent, so a finger that rested before lifting has
     * no fling, and one coalesced jump is not read as speed.
     */
    private velocityAt(t: number): number {
        const recent = this.samples.filter((sample) => t - sample.t <= FLING_WINDOW_MS)
        if (recent.length < MIN_FLING_SAMPLES) {
            return 0
        }
        const oldest = recent[0]
        const newest = recent[recent.length - 1]
        const dt = newest.t - oldest.t
        if (dt <= 0) {
            return 0
        }
        return ((newest.x - oldest.x) * this.openDir) / dt
    }

    /**
     * The finger lifted at time `t`. A claimed stroke resolves to open or close by fling first,
     * then by progress; an unclaimed one resolves to `none` and changes nothing.
     */
    end(t: number): FollowRelease | 'none' {
        const claimed = this.phase === 'dragging'
        this.phase = 'idle'
        if (!claimed) {
            this.samples = []
            return 'none'
        }
        const velocity = this.velocityAt(t)
        this.samples = []
        if (velocity > FLING_PX_PER_MS) {
            return 'open'
        }
        if (velocity < -FLING_PX_PER_MS) {
            return 'close'
        }
        if (this.intent === 'open') {
            return this.current > FOLLOW_OPEN_RELEASE ? 'open' : 'close'
        }
        return this.current < FOLLOW_CLOSE_RELEASE ? 'close' : 'open'
    }

    /** The stroke was interrupted (second touch, OS cancel, state change). */
    cancel(): void {
        this.phase = 'idle'
        this.samples = []
    }
}
