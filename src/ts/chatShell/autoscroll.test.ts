/**
 * The edge autoscroll geometry, standalone.
 *
 * Invariants:
 * - The edge band equals the sidebar's row height, so the sidebar and the sheet autoscroll alike.
 * - Zero outside the bands, signed toward the near edge inside them, capped at the per-frame maximum.
 */
import { describe, expect, test } from 'vitest'
import { AUTOSCROLL_BAND_PX, AUTOSCROLL_MAX_PX, autoscrollDelta } from './autoscroll'
import { ROW_HEIGHT } from './chatListModel'

describe('autoscroll', () => {
    test('the band equals the sidebar row height', () => {
        expect(AUTOSCROLL_BAND_PX).toBe(ROW_HEIGHT)
    })

    test('deltas at the band edges and beyond in a 0..400 box', () => {
        expect(autoscrollDelta(0, 0, 400)).toBe(-AUTOSCROLL_MAX_PX)
        expect(autoscrollDelta(56, 0, 400)).toBe(0)
        expect(autoscrollDelta(344, 0, 400)).toBe(0)
        expect(autoscrollDelta(400, 0, 400)).toBe(AUTOSCROLL_MAX_PX)
        expect(autoscrollDelta(395, 0, 400)).toBe(11)
    })
})
