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

describe('tickFake under the async scheduler (happy-dom)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('T-A2-1: bare fake timers, depth 1 resolves and runs an earlier continuation', async () => {
    vi.useFakeTimers()
    let ran = false
    void tick().then(() => {
      ran = true
    })
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-4: resolves when requestAnimationFrame never fires', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let ran = false
    void tick().then(() => {
      ran = true
    })
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-3: depth 1 does not move the clock, so a 1 ms timer stays pending', async () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    setTimeout(fired, 1)
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(fired).not.toHaveBeenCalled()
  })

  test('T-A2-10: depth 2 moves the clock at most 1 ms, so a 2 ms timer stays pending', async () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    setTimeout(fired, 2)
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(fired).not.toHaveBeenCalled()
  })

  test('T-A2-7: depth 2 runs a chained continuation', async () => {
    vi.useFakeTimers()
    let ran = false
    void tick()
      .then(() => tick())
      .then(() => {
        ran = true
      })
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-7: depth 2 runs a nested continuation', async () => {
    vi.useFakeTimers()
    let ran = false
    void (async () => {
      await tick()
      await tick()
      ran = true
    })()
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-7: depth 2 runs a continuation whose first tick was requested inside a timer callback', async () => {
    vi.useFakeTimers()
    let ran = false
    setTimeout(() => {
      void tick().then(() => {
        ran = true
      })
    }, 10)
    await vi.advanceTimersByTimeAsync(10)
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-7: a depth that is too low fails an assertion instead of hanging', async () => {
    vi.useFakeTimers()
    let ran = false
    void tick()
      .then(() => tick())
      .then(() => {
        ran = true
      })
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(ran).toBe(false)
    await tickFake(2)
    expect(ran).toBe(true)
  })

  test('T-A2-9: real timers resolve without touching a clock', async () => {
    expect(vi.isFakeTimers()).toBe(false)
    let ran = false
    void tick().then(() => {
      ran = true
    })
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('depth above the cap is refused', async () => {
    await expect(tickFake(5)).rejects.toThrow(/depth/)
    await expect(tickFake(0)).rejects.toThrow(/depth/)
  })
})
