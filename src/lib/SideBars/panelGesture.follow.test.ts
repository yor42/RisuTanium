import { describe, expect, test } from 'vitest'
import {
    DWELL_MS,
    FLING_PX_PER_MS,
    FOLLOW_CLOSE_RELEASE,
    FOLLOW_OPEN_RELEASE,
    followPanelWidth,
    inFollowOpenZone,
    INTENT_SLOP_PX,
    PanelFollow,
    TRIGGER_PX,
    type FollowIntent,
} from './panelGesture'

/**
 * The follow-the-finger progress model: the panel position is a progress in [0, 1] that tracks
 * the finger, and the release picks open or close from progress or a fling. Pure, no DOM.
 * The trigger-only recognizer keeps its own tests in `panelGesture.test.ts`.
 */

const WIDTH = 300

function started(intent: FollowIntent, x = 20, rtl = false, y = 100, t = 0) {
    const g = new PanelFollow()
    g.start(x, y, t, intent, WIDTH, rtl)
    return g
}

/** A slow drag: one sample per 150 ms, so no fling is ever read from it. */
function slowDragTo(g: PanelFollow, fromX: number, toX: number) {
    let t = 0
    const steps = 4
    for (let i = 1; i <= steps; i++) {
        t += 150
        g.move(fromX + ((toX - fromX) * i) / steps, 100, t, true)
    }
    return t
}

describe('open zone: edge strip, host inset and RTL mirror', () => {
    const base = { viewportWidthPx: 400, dpPerPx: 1 }

    test('the left edge strip opens; just past it is content', () => {
        expect(inFollowOpenZone({ ...base, xPx: 10 })).toBe(true)
        expect(inFollowOpenZone({ ...base, xPx: 24 })).toBe(true)
        expect(inFollowOpenZone({ ...base, xPx: 25 })).toBe(false)
    })

    test('the host back-gesture inset owns the outermost pixels and shifts the strip inward', () => {
        const input = { ...base, hostInsetDp: 20 }
        expect(inFollowOpenZone({ ...input, xPx: 10 })).toBe(false)
        expect(inFollowOpenZone({ ...input, xPx: 30 })).toBe(true)
        expect(inFollowOpenZone({ ...input, xPx: 44 })).toBe(true)
        expect(inFollowOpenZone({ ...input, xPx: 45 })).toBe(false)
    })

    test('the right edge never opens the panel in a left-to-right layout', () => {
        expect(inFollowOpenZone({ ...base, xPx: 390 })).toBe(false)
    })

    test('RTL mirrors the strip and the inset to the right edge', () => {
        const rtl = { ...base, rtl: true }
        expect(inFollowOpenZone({ ...rtl, xPx: 390 })).toBe(true)
        expect(inFollowOpenZone({ ...rtl, xPx: 376 })).toBe(true)
        expect(inFollowOpenZone({ ...rtl, xPx: 375 })).toBe(false)
        expect(inFollowOpenZone({ ...rtl, xPx: 10 })).toBe(false)
        expect(inFollowOpenZone({ ...rtl, xPx: 390, hostInsetDp: 20 })).toBe(false)
        expect(inFollowOpenZone({ ...rtl, xPx: 370, hostInsetDp: 20 })).toBe(true)
    })
})

describe('follow: progress tracks the finger', () => {
    test('the first move past the slop claims an open stroke, and progress is the travel over the width', () => {
        const g = started('open')
        expect(g.move(20 + INTENT_SLOP_PX, 100, 10, true)).toBe('none')
        expect(g.move(30, 100, 20, true)).toBe('claim')
        expect(g.progress).toBeCloseTo(10 / WIDTH, 5)
        expect(g.move(170, 100, 60, true)).toBe('drag')
        expect(g.progress).toBeCloseTo(150 / WIDTH, 5)
        expect(g.move(80, 100, 90, true)).toBe('drag')
        expect(g.progress).toBeCloseTo(60 / WIDTH, 5)
    })

    test('progress is clamped to the open and closed ends', () => {
        const g = started('open')
        g.move(40, 100, 10, true)
        g.move(900, 100, 20, true)
        expect(g.progress).toBe(1)
        g.move(-500, 100, 30, true)
        expect(g.progress).toBe(0)
    })

    test('a close stroke starts fully open and falls as the finger moves toward closed', () => {
        const g = started('close', 300)
        expect(g.progress).toBe(1)
        expect(g.move(270, 100, 10, true)).toBe('claim')
        expect(g.progress).toBeCloseTo(1 - 30 / WIDTH, 5)
    })

    test('RTL mirrors the direction: opening moves the finger left', () => {
        const g = started('open', 380, true)
        expect(g.move(350, 100, 10, true)).toBe('claim')
        expect(g.progress).toBeCloseTo(30 / WIDTH, 5)
        const closing = started('close', 100, true)
        expect(closing.move(130, 100, 10, true)).toBe('claim')
        expect(closing.progress).toBeCloseTo(1 - 30 / WIDTH, 5)
    })
})

describe('follow: what is not this gesture\'s', () => {
    test('a stroke toward the wrong side abandons', () => {
        expect(started('open').move(0, 100, 10, true)).toBe('abandon')
        expect(started('close', 200).move(260, 100, 10, true)).toBe('abandon')
        expect(started('open', 380, true).move(420, 100, 10, true)).toBe('abandon')
    })

    test('a vertical stroke (a scroll) abandons and never turns into a drag', () => {
        const g = started('open')
        expect(g.move(24, 140, 10, true)).toBe('abandon')
        expect(g.move(200, 140, 20, true)).toBe('none')
        expect(g.end(30)).toBe('none')
    })

    test('an uncancelable move cannot be claimed', () => {
        expect(started('open').move(60, 100, 10, false)).toBe('abandon')
    })

    test('a press and hold abandons before it claims', () => {
        const g = started('open')
        expect(g.move(60, 100, DWELL_MS + 1, true)).toBe('abandon')
    })

    test('an unclaimed stroke resolves to nothing on release', () => {
        const g = started('open')
        g.move(22, 100, 10, true)
        expect(g.end(20)).toBe('none')
    })
})

describe('follow: release rules', () => {
    test('a slow release opens above 40 percent and closes at or below it', () => {
        const above = started('open')
        const tAbove = slowDragTo(above, 20, 20 + 0.45 * WIDTH)
        expect(above.end(tAbove + 300)).toBe('open')

        const below = started('open')
        const tBelow = slowDragTo(below, 20, 20 + 0.35 * WIDTH)
        expect(below.end(tBelow + 300)).toBe('close')

        const exact = started('open')
        const tExact = slowDragTo(exact, 20, 20 + FOLLOW_OPEN_RELEASE * WIDTH)
        expect(exact.end(tExact + 300)).toBe('close')
    })

    test('a close stroke releases closed below 60 percent open and back open at or above it', () => {
        const below = started('close', 300)
        const tBelow = slowDragTo(below, 300, 300 - 0.45 * WIDTH)
        expect(below.end(tBelow + 300)).toBe('close')

        const above = started('close', 300)
        const tAbove = slowDragTo(above, 300, 300 - 0.35 * WIDTH)
        expect(above.end(tAbove + 300)).toBe('open')

        const exact = started('close', 300)
        const tExact = slowDragTo(exact, 300, 300 - (1 - FOLLOW_CLOSE_RELEASE) * WIDTH)
        expect(exact.end(tExact + 300)).toBe('open')
    })

    test('a fast flick toward open opens although progress is far below 40 percent', () => {
        const g = started('open')
        g.move(30, 100, 10, true)
        g.move(60, 100, 20, true)
        g.move(90, 100, 30, true)
        expect(g.progress).toBeLessThan(FOLLOW_OPEN_RELEASE)
        expect(g.end(35)).toBe('open')
    })

    test('a fast flick toward closed closes although progress is above 60 percent', () => {
        const g = started('close', 300)
        g.move(280, 100, 10, true)
        g.move(250, 100, 20, true)
        g.move(220, 100, 30, true)
        expect(g.progress).toBeGreaterThan(FOLLOW_CLOSE_RELEASE)
        expect(g.end(35)).toBe('close')
    })

    test('a fast flick against the stroke direction wins over progress', () => {
        const g = started('open')
        g.move(40, 100, 10, true)
        g.move(260, 100, 200, true)
        g.move(230, 100, 210, true)
        g.move(190, 100, 220, true)
        expect(g.progress).toBeGreaterThan(FOLLOW_OPEN_RELEASE)
        expect(g.end(225)).toBe('close')
    })

    test('a finger that rests before lifting has no fling, so progress decides', () => {
        const g = started('open')
        g.move(30, 100, 10, true)
        g.move(60, 100, 20, true)
        g.move(90, 100, 30, true)
        expect(g.end(400)).toBe('close')
    })

    test('the fling speed is the old 0.4 px/ms; slower than that is a drag', () => {
        expect(FLING_PX_PER_MS).toBe(0.4)
        const slow = started('open')
        // 0.3 px/ms over 90 ms: three samples in the window, below the fling speed.
        slow.move(30, 100, 30, true)
        slow.move(40, 100, 60, true)
        slow.move(47, 100, 90, true)
        expect(slow.end(95)).toBe('close')
    })

    test('the old 40 px trigger does not open the panel in this mode', () => {
        expect(TRIGGER_PX).toBe(40)
        const g = started('open')
        const t = slowDragTo(g, 20, 20 + TRIGGER_PX + 10)
        expect(g.progress).toBeLessThan(FOLLOW_OPEN_RELEASE)
        expect(g.end(t + 300)).toBe('close')
    })
})

describe('follow: panel width', () => {
    test('the panel is min(85vw, 360px)', () => {
        expect(followPanelWidth(400)).toBeCloseTo(340, 5)
        expect(followPanelWidth(600)).toBe(360)
        expect(followPanelWidth(320)).toBeCloseTo(272, 5)
    })
})
