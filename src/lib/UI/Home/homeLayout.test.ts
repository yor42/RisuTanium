/**
 * `homeLayout.ts`: Home's width bands. New-code unit test (the module does not exist on base).
 */

import { describe, expect, test } from 'vitest'
import { HOME_MID_MIN, HOME_WIDE_MIN, homeBand } from './homeLayout'

describe('homeBand', () => {
    test('the thresholds are 768 and 1280', () => {
        expect(HOME_MID_MIN).toBe(768)
        expect(HOME_WIDE_MIN).toBe(1280)
    })

    test.each([
        [0, 'phone'],
        [360, 'phone'],
        [767, 'phone'],
        [768, 'mid'],
        [900, 'mid'],
        [1279, 'mid'],
        [1280, 'wide'],
        [1920, 'wide'],
    ])('width %i is %s', (width, band) => {
        expect(homeBand(width)).toBe(band)
    })
})
