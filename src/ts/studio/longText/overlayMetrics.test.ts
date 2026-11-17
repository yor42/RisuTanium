import { afterEach, describe, expect, test, vi } from 'vitest'
import { heightsDiverge, LT_TEXT_LAYOUT, metricsAgree, overlayBoxStyle, supportsScrollbarGutter, type BoxComputed, type TextMetrics } from './overlayMetrics'

const box: BoxComputed = {
    paddingTop: '8px',
    paddingRight: '8px',
    paddingBottom: '8px',
    paddingLeft: '8px',
    borderTopWidth: '0.761905px',
    borderRightWidth: '0.761905px',
    borderBottomWidth: '0.761905px',
    borderLeftWidth: '0.761905px',
}

const metrics: TextMetrics = { fontSize: '17.6px', lineHeight: '26.4px', fontFamily: 'Inter', fontWeight: '400', letterSpacing: 'normal' }

afterEach(() => { vi.unstubAllGlobals() })

describe('U1 overlayBoxStyle', () => {
    test('never emits a font or spacing length, and no right with gutter support', () => {
        const rules = overlayBoxStyle(box, true, { offsetWidth: 323, clientWidth: 317 })
        const names = rules.map(([name]) => name)
        expect(names.filter((name) => /font|line-height|spacing|tab-size/.test(name))).toEqual([])
        expect(names).not.toContain('right')
        expect(rules).toContainEqual(['padding-top', '8px'])
        expect(rules).toContainEqual(['border-left-width', '0.761905px'])
    })

    test('emits the right offset from the integer widths only without gutter support', () => {
        const rules = overlayBoxStyle(box, false, { offsetWidth: 323, clientWidth: 317 })
        const right = rules.find(([name]) => name === 'right')
        expect(right?.[1]).toMatch(/px$/)
        expect(parseFloat(right?.[1] ?? '')).toBeCloseTo(323 - 317 - 2 * 0.761905, 4)
    })

    test('the fallback right offset is never negative and empty values are dropped', () => {
        const rules = overlayBoxStyle({ ...box, paddingTop: '' }, false, { offsetWidth: 300, clientWidth: 300 })
        expect(rules.find(([name]) => name === 'right')?.[1]).toBe('0px')
        expect(rules.map(([name]) => name)).not.toContain('padding-top')
    })
})

describe('U2 metricsAgree', () => {
    test('agrees on equal metrics and disagrees on each differing field', () => {
        expect(metricsAgree(metrics, { ...metrics })).toBe(true)
        for (const key of Object.keys(metrics) as (keyof TextMetrics)[]) expect(metricsAgree(metrics, { ...metrics, [key]: 'x' })).toBe(false)
    })
})

describe('U3 heightsDiverge', () => {
    test('trips at a line minus two px at line height 24 and never on equal heights', () => {
        expect(heightsDiverge(1000, 1000, 24)).toBe(false)
        expect(heightsDiverge(1000, 979, 24)).toBe(false)
        expect(heightsDiverge(1000, 978, 24)).toBe(true)
        expect(heightsDiverge(978, 1000, 24)).toBe(true)
    })

    test('a non-finite or tiny line height, or a non-finite height, never trips', () => {
        expect(heightsDiverge(1000, 0, 0)).toBe(false)
        expect(heightsDiverge(1000, 0, Number.NaN)).toBe(false)
        expect(heightsDiverge(1000, 0, parseFloat('normal'))).toBe(false)
        expect(heightsDiverge(1000, 0, 7)).toBe(false)
        expect(heightsDiverge(Number.NaN, 0, 24)).toBe(false)
        expect(heightsDiverge(1000, Number.POSITIVE_INFINITY, 24)).toBe(false)
    })
})

describe('supportsScrollbarGutter', () => {
    test('is false without a CSS global or CSS.supports, and follows CSS.supports otherwise', () => {
        vi.stubGlobal('CSS', undefined)
        expect(supportsScrollbarGutter()).toBe(false)
        vi.stubGlobal('CSS', {})
        expect(supportsScrollbarGutter()).toBe(false)
        vi.stubGlobal('CSS', { supports: () => false })
        expect(supportsScrollbarGutter()).toBe(false)
        const supports = vi.fn(() => true)
        vi.stubGlobal('CSS', { supports })
        expect(supportsScrollbarGutter()).toBe(true)
        expect(supports).toHaveBeenCalledWith('scrollbar-gutter', 'stable')
    })
})

describe('LT_TEXT_LAYOUT', () => {
    test('holds the ten layout tokens, each a literal class', () => {
        expect(LT_TEXT_LAYOUT.split(' ')).toHaveLength(10)
    })
})
