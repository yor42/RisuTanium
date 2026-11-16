import { describe, expect, test } from 'vitest'
import { AUTOSCROLL_EDGE, AUTOSCROLL_MAX_STEP, autoscrollDelta, dropIndex, type CardRect } from './personaDrag'

/** Three stacked cards, 100 tall with a 10 gap: [0,100], [110,210], [220,320]. */
const column: CardRect[] = [0, 110, 220].map((top) => ({ left: 0, right: 300, top, bottom: top + 100 }))
/** Two columns of two rows: left cards at x 0-100, right cards at x 110-210. */
const grid: CardRect[] = [
    { left: 0, right: 100, top: 0, bottom: 100 },
    { left: 110, right: 210, top: 0, bottom: 100 },
    { left: 0, right: 100, top: 110, bottom: 210 },
    { left: 110, right: 210, top: 110, bottom: 210 },
]

describe('dropIndex (S3-1)', () => {
    test('the pointer over a card lands on that card, whatever the start index', () => {
        expect(dropIndex(50, column, 2)).toBe(0)
        expect(dropIndex(150, column, 0)).toBe(1)
        expect(dropIndex(300, column, 0)).toBe(2)
    })

    test('the gap between cards goes to the nearer card', () => {
        expect(dropIndex(103, column, 2)).toBe(0)
        expect(dropIndex(107, column, 0)).toBe(1)
    })

    test('a pointer above the first or below the last card clamps to the ends', () => {
        expect(dropIndex(-500, column, 2)).toBe(0)
        expect(dropIndex(900, column, 0)).toBe(2)
    })

    test('an empty list leaves the card in place', () => {
        expect(dropIndex(10, [], 4)).toBe(4)
    })

    test('a grid row is split by the pointer x', () => {
        expect(dropIndex(50, grid, 3, 20)).toBe(0)
        expect(dropIndex(50, grid, 0, 150)).toBe(1)
        expect(dropIndex(160, grid, 0, 20)).toBe(2)
        expect(dropIndex(160, grid, 0, 150)).toBe(3)
    })
})

describe('autoscrollDelta', () => {
    test('no step between the edge zones', () => {
        expect(autoscrollDelta(300, 0, 600)).toBe(0)
        expect(autoscrollDelta(AUTOSCROLL_EDGE, 0, 600)).toBe(0)
        expect(autoscrollDelta(600 - AUTOSCROLL_EDGE, 0, 600)).toBe(0)
    })

    test('negative near the top, positive near the bottom, and capped past the view edge', () => {
        expect(autoscrollDelta(AUTOSCROLL_EDGE / 2, 0, 600)).toBeLessThan(0)
        expect(autoscrollDelta(600 - AUTOSCROLL_EDGE / 2, 0, 600)).toBeGreaterThan(0)
        expect(autoscrollDelta(-400, 0, 600)).toBe(-AUTOSCROLL_MAX_STEP)
        expect(autoscrollDelta(1000, 0, 600)).toBe(AUTOSCROLL_MAX_STEP)
    })

    test('the step grows deeper into the zone', () => {
        const shallow = autoscrollDelta(600 - AUTOSCROLL_EDGE + 10, 0, 600)
        const deep = autoscrollDelta(600 - 5, 0, 600)
        expect(deep).toBeGreaterThan(shallow)
    })

    test('a view too short for two zones shrinks them and never scrolls both ways', () => {
        expect(autoscrollDelta(50, 0, 100)).toBe(0)
        expect(autoscrollDelta(0, 0, 0)).toBe(0)
    })

    test('the view offset is honoured', () => {
        expect(autoscrollDelta(110, 100, 700)).toBeLessThan(0)
        expect(autoscrollDelta(5, 100, 700)).toBe(-AUTOSCROLL_MAX_STEP)
    })
})
