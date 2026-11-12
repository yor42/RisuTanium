// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: { animationSpeed: 0.4 as number | undefined } }))
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => state.db }))

import { effectiveAnimationSpeed, updateAnimationSpeed } from './animation'
import { setLowPower, setReducedMotion } from '../chatShell/motionPrefs.svelte'

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

describe('the animation speed under low power and reduced motion (5c1-16)', () => {
    afterEach(() => {
        setLowPower(false)
        setReducedMotion('system')
        state.db.animationSpeed = 0.4
    })

    test('the chosen speed applies only while neither is on; otherwise the nominal speed does', () => {
        expect(effectiveAnimationSpeed(1, { lowPower: false, reducedMotion: 'off', systemReduced: true })).toBe(1)
        expect(effectiveAnimationSpeed(1, { lowPower: true, reducedMotion: 'off', systemReduced: false })).toBe(0.4)
        expect(effectiveAnimationSpeed(0, { lowPower: false, reducedMotion: 'on', systemReduced: false })).toBe(0.4)
        expect(effectiveAnimationSpeed(1, { lowPower: false, reducedMotion: 'system', systemReduced: true })).toBe(0.4)
    })

    test('changing a device choice rewrites the root speed at once', () => {
        setReducedMotion('off')
        apply(1)
        expect(root().getPropertyValue('--risu-animation-speed')).toBe('1s')
        expect(root().getPropertyValue('--chat-motion')).toBe('2.5')
        setLowPower(true)
        expect(root().getPropertyValue('--risu-animation-speed')).toBe('0.4s')
        expect(root().getPropertyValue('--chat-motion')).toBe('1')
        setLowPower(false)
        expect(root().getPropertyValue('--chat-motion')).toBe('2.5')
    })

    test('a device change before the profile has a speed leaves the root alone', () => {
        state.db.animationSpeed = undefined
        setLowPower(true)
        expect(root().getPropertyValue('--risu-animation-speed')).toBe('')
    })
})
