import { describe, expect, test } from 'vitest'
import { LIGHT_SURFACE_FONT_COLORS, LIGHT_SURFACE_STYLE } from './lightSurface'

// The surfaces are gray-100 (#f3f4f6) and gray-200 (#e5e7eb). Utility-class
// colours used on them that have no constant are written out here.
const SURFACES = ['#f3f4f6', '#e5e7eb']
const GRAY_600 = '#4b5563'
const GRAY_800 = '#1f2937'

function channel(v: number): number {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

describe('light surface palette', () => {
    test('the contrast computation matches a known pair', () => {
        expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
        expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
    })

    const cases: Array<[string, string]> = [
        ...Object.entries(LIGHT_SURFACE_FONT_COLORS),
        ['timestamp gray-600', GRAY_600],
        ['editor text gray-800', GRAY_800],
    ]

    for (const [name, color] of cases) {
        for (const surface of SURFACES) {
            test(`${name} (${color}) has at least 4.5:1 contrast on ${surface}`, () => {
                expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5)
            })
        }
    }

    // Feature test: the constants and the style string describe the same values.
    test('the style string applies every font colour variable and nothing else', () => {
        const el = document.createElement('div')
        el.setAttribute('style', LIGHT_SURFACE_STYLE)
        const names = Object.keys(LIGHT_SURFACE_FONT_COLORS)
        for (const [name, value] of Object.entries(LIGHT_SURFACE_FONT_COLORS)) {
            expect(el.style.getPropertyValue(name)).toBe(value)
        }
        expect(el.style.length).toBe(names.length)
        expect(names.every((n) => n.startsWith('--FontColor'))).toBe(true)
    })

    test('the theme text colour variables are not redefined', () => {
        expect(Object.keys(LIGHT_SURFACE_FONT_COLORS)).not.toContain('--color-textcolor')
        expect(Object.keys(LIGHT_SURFACE_FONT_COLORS)).not.toContain('--color-textcolor2')
    })
})
