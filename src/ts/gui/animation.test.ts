// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: { animationSpeed: 0.4 as number | undefined } }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.db }))

import { updateAnimationSpeed } from './animation'

const root = () => document.documentElement.style
function apply(speed: number | undefined) {
    state.db.animationSpeed = speed
    updateAnimationSpeed()
}

afterEach(() => {
    root().removeProperty('--risu-animation-speed')
    root().removeProperty('--chat-motion')
})

describe('updateAnimationSpeed sets the seconds value and the unitless motion factor', () => {
    test('the default speed 0.4 is factor 1', () => {
        apply(0.4)
        expect(root().getPropertyValue('--chat-motion')).toBe('1')
        expect(root().getPropertyValue('--risu-animation-speed')).toBe('0.4s')
    })
    test('half the default speed is factor 0.5 and the seconds value stays a time', () => {
        apply(0.2)
        expect(root().getPropertyValue('--chat-motion')).toBe('0.5')
        expect(root().getPropertyValue('--risu-animation-speed')).toBe('0.2s')
    })
    test('speed 0 is factor 0: no animation', () => {
        apply(0)
        expect(root().getPropertyValue('--chat-motion')).toBe('0')
        expect(root().getPropertyValue('--risu-animation-speed')).toBe('0s')
    })
    test('a non-finite or missing speed falls back to factor 1', () => {
        apply(NaN)
        expect(root().getPropertyValue('--chat-motion')).toBe('1')
        apply(undefined)
        expect(root().getPropertyValue('--chat-motion')).toBe('1')
    })
    test('the factor is clamped to the range 0 to 10', () => {
        apply(100)
        expect(root().getPropertyValue('--chat-motion')).toBe('10')
        apply(-1)
        expect(root().getPropertyValue('--chat-motion')).toBe('0')
    })
})
