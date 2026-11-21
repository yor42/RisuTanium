import { describe, expect, test } from 'vitest'
import { buildSlices } from '../../lib/SideBars/railWindow'
import { WINDOW_MIN_OVERSCAN_ROWS } from '../../lib/SideBars/railConstants'
import { overscanFor, pinsOnlyWindow, pruneHeights, sameKeys, segmentLayout, segmentSlices, segmentWindow, spacerElementPx } from './listWindow'

// New-module guards (compatibility class): the pure geometry of a windowed segment.

const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}`)

/** The height a flex column of the slices would render at, from the element heights alone. */
function renderedHeight(layout: ReturnType<typeof segmentLayout>, gap: number, pinned: readonly string[], localTop: number, band: number, overscan: number): number {
    const win = segmentWindow(layout, localTop, band, overscan, pinned)
    const slices = segmentSlices(layout, win)
    let sum = 0
    for (const slice of slices) {
        sum += slice.kind === 'spacer' ? spacerElementPx(slice.height, gap) : layout.heights[layout.indexByKey.get(slice.key) as number] - gap
    }
    return sum + Math.max(0, slices.length - 1) * gap
}

describe('segmentWindow (W1)', () => {
    const layout = segmentLayout(keys(20), new Map(), 100, 0)

    test('a band far above or below the segment mounts only the pins', () => {
        expect(segmentWindow(layout, -5000, 300, 100, [])).toEqual({ start: 0, end: 0, pins: [] })
        expect(segmentWindow(layout, 5000, 300, 100, [])).toEqual({ start: 0, end: 0, pins: [] })
        expect(segmentWindow(layout, -5000, 300, 100, ['k7', 'k2', 'gone'])).toEqual({ start: 0, end: 0, pins: [2, 7] })
        expect(segmentWindow(layout, 5000, 300, 100, ['k19'])).toEqual({ start: 0, end: 0, pins: [19] })
    })

    test('a band that hits the segment mounts one contiguous range', () => {
        expect(segmentWindow(layout, 500, 300, 100, [])).toEqual({ start: 4, end: 10, pins: [] })
    })

    test('a band that starts above the segment mounts no more than the band reaches into it', () => {
        // Band bottom at 50 px into the segment, overscan 100: rows touching [0, 150].
        expect(segmentWindow(layout, -250, 300, 100, [])).toEqual({ start: 0, end: 2, pins: [] })
    })

    test('far pins stay mounted outside the range and merge when they touch it', () => {
        const win = segmentWindow(layout, 500, 300, 100, ['k0', 'k19', 'k5'])
        expect(win.pins).toEqual([0, 19])
        const slices = buildSlices(layout, win).map((slice) => (slice.kind === 'spacer' ? 'spacer' : slice.key))
        expect(slices).toEqual(['k0', 'spacer', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'spacer', 'k19'])
    })

    test('an empty segment has an empty window even with pins', () => {
        const empty = segmentLayout([], new Map(), 100, 0)
        expect(segmentWindow(empty, 0, 300, 100, ['k0'])).toEqual({ start: 0, end: 0, pins: [] })
    })
})

describe('pinsOnlyWindow', () => {
    const layout = segmentLayout(keys(20), new Map(), 100, 0)

    test('mounts the pins of the segment in order and nothing else, and renders one spacer of the total without pins', () => {
        expect(pinsOnlyWindow(layout, ['k7', 'k2', 'gone'])).toEqual({ start: 0, end: 0, pins: [2, 7] })
        expect(segmentSlices(layout, pinsOnlyWindow(layout, []))).toEqual([{ kind: 'spacer', key: 'all', height: layout.total }])
    })
})

describe('rendered height (W2)', () => {
    test.each([0, 8])('spacers, items and gaps equal the full height at gap %i', (gap) => {
        const measured = new Map([['k3', 140], ['k4', 60]])
        const layout = segmentLayout(keys(30), measured, 100, gap)
        const full = layout.total - gap
        const cases: Array<[string, number, readonly string[]]> = [
            ['top', 0, []],
            ['middle', 1000, []],
            ['end', 100000, []],
            ['pins', 1000, ['k0', 'k29']],
            ['band far above', -9000, ['k12']],
        ]
        for (const [, localTop, pins] of cases) {
            expect(renderedHeight(layout, gap, pins, localTop, 300, 100)).toBe(full)
        }
    })

    test('a measured height replaces the fallback and a bad one does not', () => {
        const layout = segmentLayout(['a', 'b', 'c'], new Map([['a', 40], ['b', 0], ['c', Number.NaN]]), 100, 8)
        expect(Array.from(layout.heights)).toEqual([48, 108, 108])
    })

    test('a spacer element is the span less one gap and never negative', () => {
        expect(spacerElementPx(108, 8)).toBe(100)
        expect(spacerElementPx(8, 8)).toBe(0)
        expect(spacerElementPx(3, 8)).toBe(0)
    })
})

describe('overscanFor', () => {
    test('narrow is the floor of rows; wide is one band, never below narrow', () => {
        expect(overscanFor('narrow', 900, 86)).toBe(WINDOW_MIN_OVERSCAN_ROWS * 86)
        expect(overscanFor('wide', 900, 86)).toBe(900)
        expect(overscanFor('wide', 100, 86)).toBe(WINDOW_MIN_OVERSCAN_ROWS * 86)
    })
})

describe('pruneHeights and sameKeys', () => {
    test('pruneHeights drops only dead keys', () => {
        const heights = new Map([['a', 1], ['b', 2], ['c', 3]])
        pruneHeights(heights, ['a', 'c', 'zzz'])
        expect(Array.from(heights.keys())).toEqual(['a', 'c'])
    })

    test('sameKeys compares content and order', () => {
        expect(sameKeys(['a', 'b'], ['a', 'b'])).toBe(true)
        expect(sameKeys(['a', 'b'], ['b', 'a'])).toBe(false)
        expect(sameKeys(['a'], ['a', 'b'])).toBe(false)
    })
})
