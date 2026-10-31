import { describe, expect, test } from 'vitest'
import { bootFraction, bootSteps, bootStateWithNotice, type BootNotice, type BootProgress } from './bootProgress'

describe('bootFraction', () => {
    test('is non-decreasing over the step order, with and without counts', () => {
        let previous = -1
        for (const step of bootSteps) {
            const start = bootFraction({ step, state: 'running' })
            const half = bootFraction({ step, state: 'running', count: { done: 1, total: 2 } })
            const full = bootFraction({ step, state: 'running', count: { done: 2, total: 2 } })
            expect(start).toBeGreaterThanOrEqual(previous)
            expect(half).toBeGreaterThan(start)
            expect(full).toBeGreaterThanOrEqual(half)
            previous = full
        }
        expect(previous).toBeLessThanOrEqual(1)
        expect(bootFraction({ step: 'finish', state: 'ready' })).toBe(1)
    })

    test('a later step never reads lower than an earlier step at its fullest', () => {
        for (let i = 1; i < bootSteps.length; i++) {
            const earlier: BootProgress = { step: bootSteps[i - 1], state: 'running', count: { done: 5, total: 5 } }
            const later: BootProgress = { step: bootSteps[i], state: 'running' }
            expect(bootFraction(later)).toBeGreaterThanOrEqual(bootFraction(earlier))
        }
    })

    test('out-of-range and empty counts stay inside the step share', () => {
        const base = bootFraction({ step: 'library', state: 'running' })
        const next = bootFraction({ step: 'app', state: 'running' })
        expect(bootFraction({ step: 'library', state: 'running', count: { done: 99, total: 3 } })).toBeCloseTo(next)
        expect(bootFraction({ step: 'library', state: 'running', count: { done: -4, total: 3 } })).toBe(base)
        expect(bootFraction({ step: 'library', state: 'running', count: { done: 1, total: 0 } })).toBe(base)
    })
})

describe('bootStateWithNotice', () => {
    const normal: BootNotice = { kind: 'normal', message: 'm' }
    const error: BootNotice = { kind: 'error', message: 'm' }
    const wait: BootNotice = { kind: 'wait', message: 'm' }

    test('failed and ready always win over a notice', () => {
        expect(bootStateWithNotice('failed', normal)).toBe('failed')
        expect(bootStateWithNotice('failed', error)).toBe('failed')
        expect(bootStateWithNotice('ready', error)).toBe('ready')
    })

    test('a normal or error notice pauses boot, a wait notice or none keeps the state', () => {
        expect(bootStateWithNotice('running', normal)).toBe('waiting')
        expect(bootStateWithNotice('running', error)).toBe('waiting')
        expect(bootStateWithNotice('running', wait)).toBe('running')
        expect(bootStateWithNotice('running')).toBe('running')
    })
})
