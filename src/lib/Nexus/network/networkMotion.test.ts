import { describe, expect, test } from 'vitest'
import { networkFrozen } from './networkMotion'

const base = { still: false, lowPower: false, reducedMotion: 'system', systemReduced: false } as const

describe('networkFrozen', () => {
    test('a still request freezes whatever the preferences say', () => {
        expect(networkFrozen({ ...base, still: true, reducedMotion: 'off' })).toBe(true)
    })

    test('the app Low power choice freezes', () => {
        expect(networkFrozen({ ...base, lowPower: true })).toBe(true)
    })

    test('Reduce motion on freezes regardless of the OS', () => {
        expect(networkFrozen({ ...base, reducedMotion: 'on', systemReduced: false })).toBe(true)
        expect(networkFrozen({ ...base, reducedMotion: 'on', systemReduced: true })).toBe(true)
    })

    test('Reduce motion off animates regardless of the OS', () => {
        expect(networkFrozen({ ...base, reducedMotion: 'off', systemReduced: true })).toBe(false)
        expect(networkFrozen({ ...base, reducedMotion: 'off', systemReduced: false })).toBe(false)
    })

    test('Reduce motion following the system takes the OS value', () => {
        expect(networkFrozen({ ...base, reducedMotion: 'system', systemReduced: true })).toBe(true)
        expect(networkFrozen({ ...base, reducedMotion: 'system', systemReduced: false })).toBe(false)
    })
})
