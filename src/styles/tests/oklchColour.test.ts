import { describe, expect, test } from 'vitest'
import { toHex } from '../../ts/themePack/colour'
import { oklchToRgba } from './oklchColour'

/**
 * The helper that turns Tailwind's oklch palette tokens into sRGB for contrast checks. The expected
 * hexes are the independently measured clipped sRGB values of the danger fills and the typography marker greys.
 */
describe('oklchToRgba', () => {
    test.each([
        ['oklch(63.7% 0.237 25.331)', '#fb2c36'],
        ['oklch(57.7% 0.245 27.325)', '#e7000b'],
        ['oklch(50.5% 0.213 27.518)', '#c10007'],
        ['oklch(44.4% 0.177 26.899)', '#9f0712'],
        ['oklch(87.2% 0.01 258.338)', '#d1d5dc'],
        ['oklch(44.6% 0.03 256.802)', '#4a5565'],
    ])('%s is %s', (token, hex) => {
        expect(toHex(oklchToRgba(token)!)).toBe(hex)
    })

    test('a token that is not oklch is null', () => {
        expect(oklchToRgba('#ffffff')).toBeNull()
        expect(oklchToRgba('red')).toBeNull()
    })
})
