import { describe, test, expect } from 'vitest'
import { DEFAULT_HEIGHTS } from './railConstants'
import { computeLayout, PLUS_KEY } from './railLayout'
import { buildSlices, computeWindow } from './railWindow'
import { charKey, railItems } from './railTestKit'

const ids = (count: number): string[] => Array.from({ length: count }, (_, i) => `c${i}`)
const layoutOf = (count: number) => computeLayout(railItems(ids(count)), new Map())
const ROW_PITCH = DEFAULT_HEIGHTS.char + DEFAULT_HEIGHTS.gap

describe('computeWindow', () => {
    test('at the top the range starts at the first item and ends past the viewport plus the overscan', () => {
        const layout = layoutOf(100)
        const win = computeWindow(layout, 0, 600, 100, [])
        expect(win.start).toBe(0)
        expect(layout.offsets[win.end - 1]).toBeLessThanOrEqual(700)
        expect(layout.offsets[win.end]).toBeGreaterThan(700)
        expect(win.pins).toEqual([])
    })

    test('in the middle both edges move with the scroll position and the overscan', () => {
        const layout = layoutOf(100)
        const win = computeWindow(layout, 3000, 600, 200, [])
        expect(layout.offsets[win.start]).toBeLessThanOrEqual(2800)
        expect(layout.offsets[win.start + 1]).toBeGreaterThan(2800)
        expect(layout.offsets[win.end - 1]).toBeLessThanOrEqual(3800)
        expect(layout.offsets[win.end]).toBeGreaterThan(3800)
    })

    test('at and beyond the end the range is clamped to the last item', () => {
        const layout = layoutOf(100)
        const n = layout.items.length
        expect(computeWindow(layout, layout.total, 600, 100, []).end).toBe(n)
        const far = computeWindow(layout, layout.total + 100000, 600, 100, [])
        expect(far.end).toBe(n)
        expect(far.start).toBe(n - 1)
        expect(computeWindow(layout, layout.total - 600, 600, 100, []).end).toBe(n)
    })

    test('a negative scroll position and an overscan larger than the list give the whole list, never more', () => {
        const layout = layoutOf(3)
        const win = computeWindow(layout, -50, 600, 100000, [])
        expect(win).toEqual({ start: 0, end: layout.items.length, pins: [] })
    })

    test('an empty layout has an empty window and no spacers', () => {
        const empty = computeLayout([], new Map())
        const win = computeWindow(empty, 0, 600, 100, [charKey('c0')])
        expect(win).toEqual({ start: 0, end: 0, pins: [] })
        expect(buildSlices(empty, win)).toEqual([])
    })

    test('a pinned key inside the range adds no pin, one above and one below are listed in order, an unknown key is ignored', () => {
        const layout = layoutOf(100)
        const inside = charKey('c1')
        const above = charKey('c1')
        const below = charKey('c99')
        const inRange = computeWindow(layout, 0, 600, 100, [inside])
        expect(inRange.pins).toEqual([])

        const middle = computeWindow(layout, 3000, 600, 100, [below, above, 'not a key', above])
        expect(middle.pins).toEqual([layout.indexByKey.get(above), layout.indexByKey.get(below)])
        expect(middle.pins[0]).toBeLessThan(middle.start)
        expect(middle.pins[1]).toBeGreaterThanOrEqual(middle.end)
    })

    test('with a viewport of 0 the range is still bounded by the overscan', () => {
        const layout = layoutOf(500)
        const win = computeWindow(layout, 0, 0, 2 * DEFAULT_HEIGHTS.char, [])
        expect(win.end - win.start).toBeLessThan(10)
        expect(win.end).toBeGreaterThan(0)
    })
})

describe('buildSlices', () => {
    function heightOf(slices: ReturnType<typeof buildSlices>, layout = layoutOf(100)): number {
        return slices.reduce((sum, s) => sum + (s.kind === 'spacer' ? s.height : layout.heights[layout.indexByKey.get(s.key)!]), 0)
    }

    test('spacers and mounted items add up to the model total, with the top spacer at the first mounted offset', () => {
        const layout = layoutOf(100)
        const win = computeWindow(layout, 3000, 600, 200, [])
        const slices = buildSlices(layout, win)
        expect(slices[0]).toEqual({ kind: 'spacer', key: 'top', height: layout.offsets[win.start] })
        expect(slices.at(-1)).toEqual({ kind: 'spacer', key: 'bottom', height: layout.total - layout.offsets[win.end] })
        expect(heightOf(slices, layout)).toBeCloseTo(layout.total, 6)
        expect(slices.filter((s) => s.kind === 'item').length).toBe(win.end - win.start)
    })

    test('no top spacer at the start and no bottom spacer at the end', () => {
        const layout = layoutOf(100)
        expect(buildSlices(layout, computeWindow(layout, 0, 600, 100, [])).some((s) => s.kind === 'spacer' && s.key === 'top')).toBe(false)
        const atEnd = buildSlices(layout, computeWindow(layout, layout.total, 600, 100, []))
        expect(atEnd.some((s) => s.kind === 'spacer' && s.key === 'bottom')).toBe(false)
        expect(atEnd.at(-1)).toMatchObject({ kind: 'item', key: PLUS_KEY })
    })

    test('a pinned item far from the range is a run of its own between spacers of the exact skipped height', () => {
        const layout = layoutOf(100)
        const pin = charKey('c90')
        const win = computeWindow(layout, 0, 600, 100, [pin])
        const slices = buildSlices(layout, win)
        const at = slices.findIndex((s) => s.kind === 'item' && s.key === pin)
        expect(at).toBeGreaterThan(0)
        const before = slices[at - 1]
        const after = slices[at + 1]
        expect(before.kind).toBe('spacer')
        expect(before.kind === 'spacer' && before.height).toBeCloseTo(layout.offsets[layout.indexByKey.get(pin)!] - layout.offsets[win.end], 6)
        expect(after.kind === 'spacer' && after.key).toBe('bottom')
        expect(heightOf(slices, layout)).toBeCloseTo(layout.total, 6)
    })

    test('a pin that touches the range joins it without a spacer between', () => {
        const layout = layoutOf(100)
        const win = computeWindow(layout, 0, 600, 100, [])
        const next = layout.items[win.end]
        const slices = buildSlices(layout, computeWindow(layout, 0, 600, 100, [next.key]))
        expect(slices.filter((s) => s.kind === 'spacer').map((s) => s.key)).toEqual(['bottom'])
        expect(slices.filter((s) => s.kind === 'item').length).toBe(win.end - win.start + 1)
    })

    test('the number of mounted items does not depend on the length of the list', () => {
        const counts = [500, 1000, 2000].map((n) => {
            const layout = layoutOf(n)
            return buildSlices(layout, computeWindow(layout, 5 * ROW_PITCH, 600, 600, [])).filter((s) => s.kind === 'item').length
        })
        expect(counts[1]).toBe(counts[0])
        expect(counts[2]).toBe(counts[0])
    })
})
