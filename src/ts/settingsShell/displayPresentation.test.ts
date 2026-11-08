import { describe, expect, test } from 'vitest'
import {
    CURLY_QUOTES,
    DEAD_DISPLAY_IDS,
    SEARCH_EXCLUDED_IDS,
    animationPositionOf,
    assetWidthFor,
    assetWidthModeOf,
    blockquoteDimmed,
    firstMessagePagesDimmed,
    sizeStepKeyOf,
    storedAnimationOf,
} from './displayPresentation'

describe('animationSpeed is shown inverted and stored as a duration', () => {
    test('every 0.05 step round trips exactly through the slider position', () => {
        for (let i = 0; i <= 20; i++) {
            const stored = Math.round(i * 5) / 100
            expect(storedAnimationOf(animationPositionOf(stored))).toBe(stored)
        }
    })

    test('the fast end is the instant 0 s duration and the slow end is 1 s', () => {
        expect(storedAnimationOf(1)).toBe(0)
        expect(storedAnimationOf(0)).toBe(1)
        expect(animationPositionOf(0)).toBe(1)
        expect(animationPositionOf(1)).toBe(0)
    })

    test('the stored default 0.4 sits at position 0.6 and 0.6 writes 0.4', () => {
        expect(animationPositionOf(0.4)).toBe(0.6)
        expect(storedAnimationOf(0.6)).toBe(0.4)
    })

    test('floating-point steps are rounded to two decimals', () => {
        expect(storedAnimationOf(0.35)).toBe(0.65)
        expect(storedAnimationOf(0.7)).toBe(0.3)
        expect(storedAnimationOf(1 / 3)).toBe(0.67)
    })

    test('off-step stored values are displayed without throwing and out-of-range values are clamped', () => {
        expect(animationPositionOf(0.37)).toBe(0.63)
        expect(animationPositionOf(2)).toBe(0)
        expect(animationPositionOf(-1)).toBe(1)
        expect(storedAnimationOf(2)).toBe(0)
        expect(storedAnimationOf(-1)).toBe(1)
    })

    test('a missing or non-finite stored value shows the default position', () => {
        expect(animationPositionOf(undefined)).toBe(0.6)
        expect(animationPositionOf(Number.NaN)).toBe(0.6)
    })
})

describe('assetWidth is one number shown as three modes', () => {
    test.each([
        [-1, 'unlimited'],
        [0, 'hidden'],
        [1, 'custom'],
        [12.5, 'custom'],
        [40, 'custom'],
    ] as const)('stored %s is the %s mode', (stored, mode) => {
        expect(assetWidthModeOf(stored)).toBe(mode)
    })

    test('a missing or non-finite stored value is unlimited', () => {
        expect(assetWidthModeOf(undefined)).toBe('unlimited')
        expect(assetWidthModeOf(Number.NaN)).toBe('unlimited')
    })

    test('the fixed modes store -1 and 0 whatever the last custom width was', () => {
        expect(assetWidthFor('unlimited', 12)).toBe(-1)
        expect(assetWidthFor('hidden', 12)).toBe(0)
    })

    test('the custom mode reuses a usable last custom width, else 20 rem', () => {
        expect(assetWidthFor('custom', 12.5)).toBe(12.5)
        expect(assetWidthFor('custom', 40)).toBe(40)
        expect(assetWidthFor('custom', undefined)).toBe(20)
        expect(assetWidthFor('custom', 0)).toBe(20)
        expect(assetWidthFor('custom', -1)).toBe(20)
        expect(assetWidthFor('custom', 41)).toBe(20)
        expect(assetWidthFor('custom', Number.NaN)).toBe(20)
    })

    test('a mode survives the round trip through its stored value', () => {
        for (const mode of ['unlimited', 'hidden', 'custom'] as const) {
            expect(assetWidthModeOf(assetWidthFor(mode, 7))).toBe(mode)
        }
    })
})

describe('dimming rules', () => {
    test('block-quote styling is dimmed exactly while quote styling is off', () => {
        expect(blockquoteDimmed(true)).toBe(true)
        expect(blockquoteDimmed(false)).toBe(false)
    })

    test('first-message pages are dimmed exactly while swipe is off', () => {
        expect(firstMessagePagesDimmed(false)).toBe(true)
        expect(firstMessagePagesDimmed(true)).toBe(false)
    })
})

describe('sizeStepKeyOf names every step from -5 to 5 once', () => {
    test('the eleven steps map to eleven distinct keys in order', () => {
        const keys = []
        for (let step = -5; step <= 5; step++) {
            keys.push(sizeStepKeyOf(step))
        }
        expect(keys).toEqual([
            'tiniest',
            'tinier',
            'tiny',
            'smaller',
            'small',
            'default',
            'big',
            'bigger',
            'huge',
            'huger',
            'hugest',
        ])
        expect(new Set(keys).size).toBe(11)
    })

    test('out-of-range and non-integer steps fall back to default', () => {
        expect(sizeStepKeyOf(6)).toBe('default')
        expect(sizeStepKeyOf(-6)).toBe('default')
        expect(sizeStepKeyOf(1.5)).toBe('default')
        expect(sizeStepKeyOf(Number.NaN)).toBe('default')
    })
})

describe('dead field sets', () => {
    test('the dead Display ids are the two memory-limit fields', () => {
        expect([...DEAD_DISPLAY_IDS].sort()).toEqual(['display.memoryLimitThickness', 'display.showMemoryLimit'])
    })

    test('search excludes every dead Display id and the dead Accessibility field', () => {
        for (const id of DEAD_DISPLAY_IDS) {
            expect(SEARCH_EXCLUDED_IDS.has(id)).toBe(true)
        }
        expect(SEARCH_EXCLUDED_IDS.has('acc.moveInsteadOfCopyOnCMPConvert')).toBe(true)
        expect(SEARCH_EXCLUDED_IDS.size).toBe(3)
    })

    test('live Display rows are not in either set', () => {
        for (const id of ['display.animationSpeed', 'display.assetWidth', 'display.unformatQuotes']) {
            expect(DEAD_DISPLAY_IDS.has(id)).toBe(false)
            expect(SEARCH_EXCLUDED_IDS.has(id)).toBe(false)
        }
    })
})

describe('CURLY_QUOTES', () => {
    test('is the stored curly default, double pair then single pair', () => {
        expect([...CURLY_QUOTES]).toEqual(['“', '”', '‘', '’'])
    })
})
