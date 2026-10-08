import { describe, expect, test } from 'vitest'
import {
    AXIS_RATIO,
    DWELL_MS,
    EDGE_ZONE_PX,
    FLING_PX_PER_MS,
    inEdgeZone,
    INSET_MAX_CSS,
    INSET_PROBE_MAX_CSS,
    INTENT_SLOP_PX,
    PanelGesture,
    TRIGGER_PX,
    type PanelIntent,
} from './panelGesture'

function started(intent: PanelIntent, x = 100, y = 100, t = 0) {
    const g = new PanelGesture()
    g.start(x, y, t, intent)
    return g
}

describe('claim rule', () => {
    test('movement within the slop neither claims nor abandons', () => {
        const g = started('open')
        expect(g.move(100 + INTENT_SLOP_PX, 100, 10, true)).toBe('none')
        expect(g.move(100, 100 + INTENT_SLOP_PX, 20, true)).toBe('none')
    })

    test('the first move past the slop claims a rightward horizontal stroke for open', () => {
        const g = started('open')
        expect(g.move(100 + INTENT_SLOP_PX + 1, 100, 10, true)).toBe('claim')
    })

    test('the first move past the slop claims a leftward horizontal stroke for close', () => {
        const g = started('close')
        expect(g.move(100 - INTENT_SLOP_PX - 1, 100, 10, true)).toBe('claim')
    })

    test('the wrong direction abandons', () => {
        const open = started('open')
        expect(open.move(80, 100, 10, true)).toBe('abandon')
        const close = started('close')
        expect(close.move(120, 100, 10, true)).toBe('abandon')
    })

    test('the axis ratio boundary: exactly 1.5 claims, just under abandons', () => {
        const dy = 10
        const claims = started('open')
        expect(claims.move(100 + AXIS_RATIO * dy, 100 + dy, 10, true)).toBe('claim')
        const steep = started('open')
        expect(steep.move(100 + AXIS_RATIO * dy - 0.5, 100 + dy, 10, true)).toBe('abandon')
    })
})

describe('abandon is for the life of the stroke', () => {
    test('a vertical-first stroke never claims, even if it later turns horizontal', () => {
        const g = started('open')
        expect(g.move(102, 120, 10, true)).toBe('abandon')
        expect(g.move(200, 120, 20, true)).toBe('none')
        expect(g.move(300, 120, 30, true)).toBe('none')
    })

    test('an uncancelable first move past the slop abandons rather than claims', () => {
        const g = started('open')
        expect(g.move(120, 100, 10, false)).toBe('abandon')
        expect(g.move(200, 100, 20, true)).toBe('none')
    })
})

describe('trigger', () => {
    test('fires once at the trigger distance and never again', () => {
        const g = started('open')
        expect(g.move(110, 100, 10, true)).toBe('claim')
        expect(g.move(100 + TRIGGER_PX - 1, 100, 400, true)).toBe('none')
        expect(g.move(100 + TRIGGER_PX, 100, 410, true)).toBe('trigger')
        expect(g.move(100 + TRIGGER_PX + 30, 100, 420, true)).toBe('none')
    })

    test('close fires on leftward distance', () => {
        const g = started('close', 300)
        expect(g.move(290, 100, 10, true)).toBe('claim')
        expect(g.move(300 - TRIGGER_PX, 100, 500, true)).toBe('trigger')
    })

    test('a fast short stroke fires by speed before the distance', () => {
        const g = started('open')
        expect(g.move(110, 100, 10, true)).toBe('claim')
        const x = 125
        const v = (x - 100) / (20 - 0)
        expect(v).toBeGreaterThan(FLING_PX_PER_MS)
        expect(g.move(x, 100, 20, true)).toBe('trigger')
    })

    test('a slow stroke under the distance does not fire', () => {
        const g = started('open')
        expect(g.move(110, 100, 60, true)).toBe('claim')
        expect(g.move(120, 100, 120, true)).toBe('none')
        expect(g.move(130, 100, 180, true)).toBe('none')
    })

    test('speed alone needs enough samples: two samples in the window are not a fling', () => {
        const g = started('open')
        expect(g.move(110, 100, 150, true)).toBe('claim')
        expect(g.move(125, 100, 160, true)).toBe('none')
    })

    test('three samples in the window with speed do fire', () => {
        const g = started('open')
        expect(g.move(110, 100, 150, true)).toBe('claim')
        expect(g.move(114, 100, 155, true)).toBe('none')
        expect(g.move(125, 100, 160, true)).toBe('trigger')
    })

    test('a claimed stroke that reverses and ends without reaching the trigger fires nothing', () => {
        const g = started('open')
        expect(g.move(110, 100, 10, true)).toBe('claim')
        expect(g.move(90, 100, 300, true)).toBe('none')
        g.end()
        expect(g.move(200, 100, 310, true)).toBe('none')
    })
})

describe('dwell', () => {
    test('a stroke still unclaimed after the dwell is abandoned', () => {
        const g = started('open')
        expect(g.move(103, 100, DWELL_MS + 1, true)).toBe('abandon')
        expect(g.move(150, 100, DWELL_MS + 20, true)).toBe('none')
    })

    test('a claim inside the dwell is not abandoned by a later slow stroke', () => {
        const g = started('open')
        expect(g.move(110, 100, DWELL_MS - 10, true)).toBe('claim')
        expect(g.move(120, 100, DWELL_MS + 200, true)).toBe('none')
    })
})

describe('interruption', () => {
    test('cancel returns the machine to idle: later moves do nothing', () => {
        const g = started('open')
        expect(g.move(110, 100, 10, true)).toBe('claim')
        g.cancel()
        expect(g.move(200, 100, 20, true)).toBe('none')
    })

    test('a new start after a cancel begins a fresh stroke', () => {
        const g = started('open')
        g.cancel()
        g.start(10, 10, 100, 'open')
        expect(g.move(30, 10, 110, true)).toBe('claim')
    })
})

describe('inEdgeZone', () => {
    test('guard: with no inset the zone is the old strip from the edge', () => {
        expect(inEdgeZone(0, 0)).toBe(true)
        expect(inEdgeZone(EDGE_ZONE_PX, 0)).toBe(true)
        expect(inEdgeZone(EDGE_ZONE_PX + 1, 0)).toBe(false)
    })

    test('the zone starts at the inset and is EDGE_ZONE_PX wide, both ends inclusive', () => {
        expect(inEdgeZone(23, 24)).toBe(false)
        expect(inEdgeZone(24, 24)).toBe(true)
        expect(inEdgeZone(24 + EDGE_ZONE_PX, 24)).toBe(true)
        expect(inEdgeZone(24 + EDGE_ZONE_PX + 1, 24)).toBe(false)
    })

    test('the widest honoured inset keeps the whole zone inside the probe window', () => {
        expect(INSET_MAX_CSS + EDGE_ZONE_PX).toBe(INSET_PROBE_MAX_CSS)
        expect(inEdgeZone(INSET_MAX_CSS, INSET_MAX_CSS)).toBe(true)
        expect(inEdgeZone(INSET_PROBE_MAX_CSS - 1, INSET_MAX_CSS)).toBe(true)
    })
})
