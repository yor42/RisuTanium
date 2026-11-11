// @vitest-environment jsdom
import './asyncScheduler.test-helpers'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { tick } from 'svelte'
import { tickFake } from './svelteTick.test-helpers'

// Real time captured before any fake clock exists, so a wrong helper shows up as 'pending' rather than a 20 s hang.
const realSetTimeout = globalThis.setTimeout

function settledWithin(promise: Promise<unknown>, ms = 500): Promise<'resolved' | 'pending'> {
  return Promise.race([
    promise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => {
      realSetTimeout(() => resolve('pending'), ms)
    }),
  ])
}

describe('tickFake under the async scheduler (jsdom)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('T-A2-2: bare fake timers, depth 1 resolves and runs an earlier continuation', async () => {
    vi.useFakeTimers()
    let ran = false
    void tick().then(() => {
      ran = true
    })
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-2: depth 2 runs chained, nested and timer-origin continuations', async () => {
    vi.useFakeTimers()
    const ran = { chained: false, nested: false, timer: false }
    void tick()
      .then(() => tick())
      .then(() => {
        ran.chained = true
      })
    void (async () => {
      await tick()
      await tick()
      ran.nested = true
    })()
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(ran.chained).toBe(true)
    expect(ran.nested).toBe(true)
    setTimeout(() => {
      void tick().then(() => {
        ran.timer = true
      })
    }, 10)
    await vi.advanceTimersByTimeAsync(10)
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(ran.timer).toBe(true)
  })

  test('T-A2-3: depth 1 does not move the clock, so a 1 ms timer stays pending', async () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    setTimeout(fired, 1)
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(fired).not.toHaveBeenCalled()
  })

  test('T-A2-9: real timers resolve without touching a clock', async () => {
    expect(vi.isFakeTimers()).toBe(false)
    expect(await settledWithin(tickFake(1))).toBe('resolved')
  })
})
