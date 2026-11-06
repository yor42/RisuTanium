import { describe, expect, test, vi } from 'vitest'
import { createYieldToEventLoop, yieldToEventLoop, type YieldHost } from './yieldToEventLoop'

describe('yieldToEventLoop', () => {
    test('prefers scheduler.yield when present', async () => {
        const schedulerYield = vi.fn(async () => {})
        const setTimeoutSpy = vi.fn()
        const host: YieldHost = { scheduler: { yield: schedulerYield }, MessageChannel, setTimeout: setTimeoutSpy }
        await createYieldToEventLoop(host)()
        expect(schedulerYield).toHaveBeenCalledTimes(1)
        expect(setTimeoutSpy).not.toHaveBeenCalled()
    })

    test('uses a MessageChannel round trip when there is no scheduler.yield, after pending microtasks', async () => {
        const setTimeoutSpy = vi.fn()
        const order: string[] = []
        const pending = createYieldToEventLoop({ MessageChannel, setTimeout: setTimeoutSpy })().then(() => order.push('yielded'))
        await Promise.resolve().then(() => order.push('microtask'))
        await pending
        expect(order).toEqual(['microtask', 'yielded'])
        expect(setTimeoutSpy).not.toHaveBeenCalled()
    })

    test('falls back to setTimeout(0) without scheduler.yield and MessageChannel', async () => {
        const setTimeoutSpy = vi.fn((callback: () => void, _delay: number) => { callback() })
        await createYieldToEventLoop({ setTimeout: setTimeoutSpy })()
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
        expect(setTimeoutSpy.mock.calls[0][1]).toBe(0)
    })

    test('the default export settles in the test runtime', async () => {
        await expect(yieldToEventLoop()).resolves.toBeUndefined()
    })
})
