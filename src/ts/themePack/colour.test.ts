/**
 * The pure colour helpers. Unit specs for a new module: the contrast arithmetic is pinned to WCAG values, so a swapped
 * extreme or a different gamma changes a number below.
 */
import { describe, expect, test } from 'vitest'
import { bestExtreme, cr, lum, mixSrgb, over, parseHexColour, toHex } from './colour'

describe('contrast arithmetic', () => {
    test('black on white is 21:1 and the ratio is symmetric', () => {
        expect(cr([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 9)
        expect(cr([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 9)
        expect(cr([10, 20, 30], [10, 20, 30])).toBeCloseTo(1, 9)
    })

    test('mid grey on white uses the sRGB transfer curve, not gamma 2.2', () => {
        // #777777 on white is 4.4776:1 by WCAG; a plain 2.2 power curve would give about 4.00.
        expect(cr([0x77, 0x77, 0x77], [255, 255, 255])).toBeCloseTo(4.4776, 3)
        expect(lum([255, 255, 255])).toBeCloseTo(1, 9)
        expect(lum([0, 0, 0])).toBe(0)
    })

    test('over composites a translucent colour onto an opaque one', () => {
        expect(over([255, 0, 0, 0.5], [0, 0, 255, 1])).toEqual([127.5, 0, 127.5, 1])
        expect(over([10, 20, 30, 1], [200, 200, 200, 1])).toEqual([10, 20, 30, 1])
    })
})

describe('hex helpers', () => {
    test('parseHexColour reads 3 and 6 digit hex in any case and nothing else', () => {
        expect(parseHexColour('#3366FF')).toEqual([51, 102, 255, 1])
        expect(parseHexColour('#36f')).toEqual([51, 102, 255, 1])
        for (const bad of ['3366ff', '#3366ff80', '#36', 'rgb(1,2,3)', 'red', '']) {
            expect(parseHexColour(bad)).toBeNull()
        }
    })

    test('toHex rounds each channel, clamps and writes lower case', () => {
        expect(toHex([0.4, 0.5, 254.5, 1])).toBe('#0001ff')
        expect(toHex([255, 171, 16])).toBe('#ffab10')
        expect(toHex([-5, 300, 0])).toBe('#00ff00')
    })

    test('mixSrgb returns each endpoint and the midpoint', () => {
        const a: [number, number, number, number] = [0, 100, 200, 1]
        const b: [number, number, number, number] = [100, 200, 0, 1]
        expect(mixSrgb(a, b, 0)).toEqual(a)
        expect(mixSrgb(a, b, 1)).toEqual(b)
        expect(mixSrgb(a, b, 0.5)).toEqual([50, 150, 100, 1])
    })

    test('bestExtreme picks the more contrasting of black and white', () => {
        expect(bestExtreme([250, 250, 250, 1])).toEqual([0, 0, 0, 1])
        expect(bestExtreme([10, 10, 10, 1])).toEqual([255, 255, 255, 1])
    })
})
