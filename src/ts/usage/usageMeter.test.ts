/**
 * Labels: (G) compatibility guard over a new module; backed by scratch mutants.
 */
import { describe, test, expect } from 'vitest'
import { createUsageMeter } from './usageMeter'

describe('createUsageMeter (G)', () => {
    test('a fresh meter holds no usage and is not failed', () => {
        const meter = createUsageMeter()
        expect(meter.reported()).toBeNull()
        expect(meter.failed()).toBe(false)
    })

    test('reports are summed field by field', () => {
        const meter = createUsageMeter()
        meter.report({ input: 10, output: 2, cacheRead: 1, cacheWrite: 0 })
        meter.report({ input: 5, output: 3, cacheRead: 0, cacheWrite: 4 })
        expect(meter.reported()).toEqual({ input: 15, output: 5, cacheRead: 1, cacheWrite: 4 })
    })

    test('the returned usage is a copy: changing it does not change the meter', () => {
        const meter = createUsageMeter()
        meter.report({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })
        const first = meter.reported()
        if (first === null) {
            throw new Error('expected usage')
        }
        first.input = 999
        expect(meter.reported()).toEqual({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })
    })

    test('markFailed sets the failed flag and keeps what was reported', () => {
        const meter = createUsageMeter()
        meter.report({ input: 7, output: 0, cacheRead: 0, cacheWrite: 0 })
        meter.markFailed()
        expect(meter.failed()).toBe(true)
        expect(meter.reported()).toEqual({ input: 7, output: 0, cacheRead: 0, cacheWrite: 0 })
    })

    test('two meters are independent', () => {
        const a = createUsageMeter()
        const b = createUsageMeter()
        a.report({ input: 3, output: 3, cacheRead: 0, cacheWrite: 0 })
        a.markFailed()
        expect(b.reported()).toBeNull()
        expect(b.failed()).toBe(false)
    })
})
