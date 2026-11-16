// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createPauseScheduler } from './pauseScheduler'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createPauseScheduler', () => {
    test('B2-U5 one run, delayMs after the last touch; touching again restarts the wait', () => {
        const run = vi.fn()
        const scheduler = createPauseScheduler(250, run)
        scheduler.touch()
        vi.advanceTimersByTime(200)
        scheduler.touch()
        vi.advanceTimersByTime(200)
        expect(run).not.toHaveBeenCalled()
        vi.advanceTimersByTime(50)
        expect(run).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1000)
        expect(run).toHaveBeenCalledTimes(1)
    })

    test('B2-U5 no run while composing; one run delayMs after the composition ends', () => {
        const run = vi.fn()
        const scheduler = createPauseScheduler(250, run)
        scheduler.touch()
        scheduler.compositionStart()
        vi.advanceTimersByTime(1000)
        scheduler.touch()
        vi.advanceTimersByTime(1000)
        expect(run).not.toHaveBeenCalled()
        scheduler.compositionEnd()
        vi.advanceTimersByTime(249)
        expect(run).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(run).toHaveBeenCalledTimes(1)
    })

    test('B2-U5 cancel stops a pending run and every later one', () => {
        const run = vi.fn()
        const scheduler = createPauseScheduler(250, run)
        scheduler.touch()
        scheduler.cancel()
        vi.advanceTimersByTime(1000)
        scheduler.touch()
        scheduler.compositionEnd()
        vi.advanceTimersByTime(1000)
        expect(run).not.toHaveBeenCalled()
    })

    test('an injected timer pair is used instead of the global one', () => {
        const pending: (() => void)[] = []
        const run = vi.fn()
        const scheduler = createPauseScheduler(10, run, { set: (fn) => { pending.push(fn); return setTimeout(() => undefined, 0) }, clear: () => { pending.length = 0 } })
        scheduler.touch()
        expect(pending).toHaveLength(1)
        pending[0]()
        expect(run).toHaveBeenCalledTimes(1)
    })
})
