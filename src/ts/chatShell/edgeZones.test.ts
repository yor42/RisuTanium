import { describe, expect, it } from 'vitest'
import { classifyEdge } from './edgeZones'

describe('T10 edge ownership', () => {
    it.each([0, 24, 376, 400])('reserves boundary x=%i without changing the hit target', x => {
        expect(classifyEdge({ xPx: x, viewportWidthPx: 400, dpPerPx: 1 })).toBe('edge')
    })
    it('reserves host insets in dp and mirrors the one-sided inset for RTL', () => {
        expect(classifyEdge({ xPx: 30, viewportWidthPx: 400, dpPerPx: 1, hostInsetDp: 16 })).toBe('edge')
        expect(classifyEdge({ xPx: 50, viewportWidthPx: 400, dpPerPx: 1, hostInsetDp: 16 })).toBe('content')
        expect(classifyEdge({ xPx: 370, viewportWidthPx: 400, dpPerPx: 1, hostInsetDp: 16, rightHostInsetDp: 0, rtl: true })).toBe('edge')
        expect(classifyEdge({ xPx: 12, viewportWidthPx: 400, dpPerPx: 0.5 })).toBe('edge')
    })
})
