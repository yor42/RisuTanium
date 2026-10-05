import { describe, test, expect, vi, afterEach } from 'vitest'

import { createYieldBudget, yieldToEventLoop } from '../saveYield'

// `RisuSaveEncoder` holds one budget per instance and awaits `maybeYield()`
// after every block it encodes. These tests exercise `createYieldBudget` on its own, with a fake clock and a spy
// yield function, independent of `RisuSaveEncoder`.
describe('createYieldBudget', () => {
    function makeClock(start = 0) {
        let value = start
        return {
            now: () => value,
            advance: (ms: number) => {
                value += ms
            },
        }
    }

    test('maybeYield does not yield before the budget has passed', async () => {
        const clock = makeClock()
        const yieldFn = vi.fn(async () => {})
        const budget = createYieldBudget({ budgetMs: 8, now: clock.now, yieldFn })

        clock.advance(5)
        await budget.maybeYield()

        expect(yieldFn).not.toHaveBeenCalled()
    })

    test('maybeYield yields once the budget has passed', async () => {
        const clock = makeClock()
        const yieldFn = vi.fn(async () => {})
        const budget = createYieldBudget({ budgetMs: 8, now: clock.now, yieldFn })

        clock.advance(9)
        await budget.maybeYield()

        expect(yieldFn).toHaveBeenCalledTimes(1)
    })

    test('maybeYield resets the budget after yielding', async () => {
        const clock = makeClock()
        const yieldFn = vi.fn(async () => {})
        const budget = createYieldBudget({ budgetMs: 8, now: clock.now, yieldFn })

        clock.advance(9)
        await budget.maybeYield()
        expect(yieldFn).toHaveBeenCalledTimes(1)

        clock.advance(3) // under budget, measured from the reset above
        await budget.maybeYield()
        expect(yieldFn).toHaveBeenCalledTimes(1) // no second yield yet
    })

    test('noteYielded resets the budget', async () => {
        const clock = makeClock()
        const yieldFn = vi.fn(async () => {})
        const budget = createYieldBudget({ budgetMs: 8, now: clock.now, yieldFn })

        clock.advance(9)
        budget.noteYielded()

        clock.advance(3) // under budget, measured from noteYielded's reset
        await budget.maybeYield()

        expect(yieldFn).not.toHaveBeenCalled()
    })
})

// CHORE-17: `yieldToEventLoop`'s own fallback chain
// -- scheduler.yield() where available, else a MessageChannel message, else
// setTimeout(0) as a last resort -- is covered directly here; `createYieldBudget`
// (above) takes a `yieldFn` and never calls the real one. Each globalThis
// stub here is removed in the matching `afterEach` (or restored inline where a
// test also stubs a plain function like `setTimeout`), so no test leaks a stub
// into the next.
describe('yieldToEventLoop', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    test('uses scheduler.yield() when it is present', async () => {
        const schedulerYield = vi.fn(async () => {})
        vi.stubGlobal('scheduler', { yield: schedulerYield })
        // A MessageChannel that throws if constructed -- proves the
        // scheduler path short-circuits instead of merely running first.
        vi.stubGlobal(
            'MessageChannel',
            class {
                constructor() {
                    throw new Error('MessageChannel should not be constructed when scheduler.yield() is present')
                }
            },
        )

        await yieldToEventLoop()

        expect(schedulerYield).toHaveBeenCalledTimes(1)
    })

    test('uses MessageChannel when scheduler.yield is absent', async () => {
        vi.stubGlobal('scheduler', undefined)
        let posted = false
        class FakeMessageChannel {
            port1: { onmessage: (() => void) | null; close: () => void }
            port2: { postMessage: (v: unknown) => void; close: () => void }
            constructor() {
                this.port1 = { onmessage: null, close: () => {} }
                this.port2 = {
                    postMessage: () => {
                        posted = true
                        queueMicrotask(() => this.port1.onmessage?.())
                    },
                    close: () => {},
                }
            }
        }
        vi.stubGlobal('MessageChannel', FakeMessageChannel)
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

        await yieldToEventLoop()

        expect(posted).toBe(true)
        expect(setTimeoutSpy).not.toHaveBeenCalled()
        setTimeoutSpy.mockRestore()
    })

    test('falls back to setTimeout when both scheduler.yield and MessageChannel are absent', async () => {
        vi.stubGlobal('scheduler', undefined)
        vi.stubGlobal('MessageChannel', undefined)
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

        await yieldToEventLoop()

        expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
        expect(setTimeoutSpy.mock.calls[0][1]).toBe(0)
        setTimeoutSpy.mockRestore()
    })
})
