import { describe, expect, test } from 'vitest'
import { shouldAnchorBottom } from './bottomAnchor'

describe('T bottom anchor decision', () => {
    test('anchors the newest edge when a visible bottom reader gets a shorter viewport', () => {
        expect(shouldAnchorBottom({ wasAtBottom: true, surfaceHidden: false, previousHeight: 640, nextHeight: 380 })).toBe(true)
    })
    test('does not move a reader above the bottom or a hidden surface', () => {
        expect(shouldAnchorBottom({ wasAtBottom: false, surfaceHidden: false, previousHeight: 640, nextHeight: 380 })).toBe(false)
        expect(shouldAnchorBottom({ wasAtBottom: true, surfaceHidden: true, previousHeight: 640, nextHeight: 380 })).toBe(false)
        expect(shouldAnchorBottom({ wasAtBottom: true, surfaceHidden: false, previousHeight: 380, nextHeight: 640 })).toBe(false)
    })
})