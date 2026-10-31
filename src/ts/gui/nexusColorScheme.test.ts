import { describe, expect, test } from 'vitest'
import { nexusColorScheme } from './nexusColorScheme'

function luminance(hex: string): number {
    const channel = (offset: number) => {
        const c = parseInt(hex.slice(offset, offset + 2), 16) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
}

function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

describe('nexusColorScheme contrast', () => {
    test.each(['bgcolor', 'darkbg', 'selected'] as const)('guard: textcolor is at least 4.5:1 on %s', (surface) => {
        expect(contrast(nexusColorScheme.textcolor, nexusColorScheme[surface])).toBeGreaterThanOrEqual(4.5)
    })

    test.each(['bgcolor', 'darkbg', 'darkbutton'] as const)('guard: darkBorderc is at least 3:1 on %s', (surface) => {
        expect(contrast(nexusColorScheme.darkBorderc, nexusColorScheme[surface])).toBeGreaterThanOrEqual(3)
    })

    test('guard: the preset is a dark scheme', () => {
        expect(nexusColorScheme.type).toBe('dark')
    })
})
