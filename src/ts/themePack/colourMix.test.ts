/**
 * The color-mix() branch of parseConcrete: the arithmetic (T2a-7) and the forms it refuses (T2a-8). The expected channels were
 * computed by an independent route (CSS Color 4 XYZ matrices), not by the reader's own helpers.
 */
import { describe, expect, test } from 'vitest'
import { OKLAB_GAMUT_EPS, parseConcrete, type Rgba } from './colour'

const near = (actual: Rgba | null, expected: readonly number[], tolerance = 1): void => {
    expect(actual).not.toBeNull()
    const got = actual as Rgba
    for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - expected[i]), `channel ${i} of ${JSON.stringify(got)} against ${JSON.stringify(expected)}`).toBeLessThanOrEqual(tolerance)
    expect(got[3]).toBeCloseTo(expected[3], 9)
}

describe('color-mix arithmetic (T2a-7)', () => {
    test('srgb mixes the channels, 50/50 when no percentage is written', () => {
        near(parseConcrete('color-mix(in srgb, #ffffff, #000000)'), [127.5, 127.5, 127.5, 1], 0.001)
        near(parseConcrete('color-mix(in srgb, #ffffff 50%, #000000)'), [127.5, 127.5, 127.5, 1], 0.001)
    })
    test('one percentage gives the other the rest, before or after its colour', () => {
        near(parseConcrete('color-mix(in srgb, #ff0000 25%, #0000ff)'), [63.75, 0, 191.25, 1], 0.001)
        near(parseConcrete('color-mix(in srgb, 25% #ff0000, #0000ff)'), [63.75, 0, 191.25, 1], 0.001)
        near(parseConcrete('color-mix(in srgb, #ff0000, #0000ff 75%)'), [63.75, 0, 191.25, 1], 0.001)
    })
    test('percentages below 100 scale the alpha, above 100 only normalise', () => {
        near(parseConcrete('color-mix(in srgb, #ff0000 30%, #0000ff 30%)'), [127.5, 0, 127.5, 0.6], 0.001)
        near(parseConcrete('color-mix(in srgb, #ff0000 80%, #0000ff 80%)'), [127.5, 0, 127.5, 1], 0.001)
    })
    test('interpolation is premultiplied, so a transparent side does not darken the colour', () => {
        near(parseConcrete('color-mix(in srgb, #ff0000, transparent)'), [255, 0, 0, 0.5], 0.001)
        near(parseConcrete('color-mix(in srgb, transparent, transparent)'), [0, 0, 0, 0])
    })
    test('nesting is read to depth 3', () => {
        near(parseConcrete('color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, #ffffff, #000000), #000000), #000000)'), [31.875, 31.875, 31.875, 1], 0.001)
    })
    test('srgb-linear mixes in linear light', () => {
        near(parseConcrete('color-mix(in srgb-linear, #ffffff, #000000)'), [187.516, 187.516, 187.516, 1])
        near(parseConcrete('color-mix(in srgb-linear, #ff0000 25%, #ffff00)'), [255, 224.61, 0, 1])
    })
    test('oklab mixes in the perceptual space', () => {
        near(parseConcrete('color-mix(in oklab, #ffffff, #000000)'), [99.086, 99.086, 99.086, 1])
        near(parseConcrete('color-mix(in oklab, #ff0000, #0000ff)'), [140.362, 83.033, 162.308, 1])
    })
    test('the space and the colour names are case-insensitive and the arguments may carry extra whitespace', () => {
        near(parseConcrete('  COLOR-MIX( IN  SRGB ,  #FFFFFF  ,  #000000  ) '), [127.5, 127.5, 127.5, 1], 0.001)
    })
    test('hsl, named and rgb() colours are accepted as the two colours', () => {
        near(parseConcrete('color-mix(in srgb, red, rgb(0 0 255 / 50%))'), [170, 0, 85, 0.75], 0.001)
        near(parseConcrete('color-mix(in srgb, hsl(0 0% 100%) 50%, black)'), [127.5, 127.5, 127.5, 1], 0.001)
    })
})

describe('forms color-mix refuses (T2a-8, guard: null before and after)', () => {
    test.each([
        ['oklch', 'color-mix(in oklch, #ff0000, #0000ff)'],
        ['lab', 'color-mix(in lab, #ff0000, #0000ff)'],
        ['lch', 'color-mix(in lch, #ff0000, #0000ff)'],
        ['hsl', 'color-mix(in hsl, #ff0000, #0000ff)'],
        ['hwb', 'color-mix(in hwb, #ff0000, #0000ff)'],
        ['display-p3', 'color-mix(in display-p3, #ff0000, #0000ff)'],
        ['a hue method', 'color-mix(in oklab longer hue, #ff0000, #0000ff)'],
        ['no in', 'color-mix(srgb, #ff0000, #0000ff)'],
        ['one colour', 'color-mix(in srgb, #ff0000)'],
        ['three colours', 'color-mix(in srgb, #ff0000, #00ff00, #0000ff)'],
        ['a zero percentage sum', 'color-mix(in srgb, #ff0000 0%, #0000ff 0%)'],
        ['a percentage above 100', 'color-mix(in srgb, #ff0000 101%, #0000ff)'],
        ['a negative percentage', 'color-mix(in srgb, #ff0000 -5%, #0000ff)'],
        ['depth 4', 'color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, color-mix(in srgb, #fff, #000), #000), #000), #000)'],
        ['currentcolor', 'color-mix(in srgb, currentcolor, #000000)'],
        ['a leftover var()', 'color-mix(in srgb, var(--x), #000000)'],
        ['relative colour syntax', 'color-mix(in srgb, rgb(from #ff0000 r g b), #000000)'],
        ['light-dark()', 'color-mix(in srgb, light-dark(#fff, #000), #000000)'],
        ['unbalanced parentheses', 'color-mix(in srgb, #ff0000, rgb(0 0 255)'],
        ['text after the closing parenthesis', 'color-mix(in srgb, #ff0000, #0000ff) red'],
    ])('%s is null', (_name, text) => {
        expect(parseConcrete(text)).toBeNull()
    })

    test('an oklab mix outside sRGB is refused, never clipped', () => {
        // linear blue excess of about 8.4e-2
        expect(parseConcrete('color-mix(in oklab, #0000ff, #ffffff)')).toBeNull()
        // a linear red channel below zero: most real out-of-gamut oklab mixes fall below the bottom of the range
        expect(parseConcrete('color-mix(in oklab, #34c074 17%, #0429dd)')).toBeNull()
        expect(parseConcrete('color-mix(in oklab, #214ab6 22%, #05de57)')).toBeNull()
        // an oklab mix of two in-gamut colours that stays in gamut is read
        expect(parseConcrete('color-mix(in oklab, #ff0000, #0000ff)')).not.toBeNull()
    })

    test('the oklab tolerance is measured on linear-light channels, not gamma-encoded ones', () => {
        // The linear top-side excess of this mix is about 1.5e-4: outside the 1e-4 tolerance when measured linearly, inside it when measured after the transfer function (about 6.7e-5).
        expect(OKLAB_GAMUT_EPS).toBe(1e-4)
        expect(parseConcrete('color-mix(in oklab, #0000ff, #ffffff 99.96%)')).toBeNull()
    })
})
