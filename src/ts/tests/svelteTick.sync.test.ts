import { afterEach, describe, expect, test, vi } from 'vitest'
import { tick } from 'svelte'
import { tickFake } from './svelteTick.test-helpers'

// This file does not import the flag helper, so Svelte runs its sync scheduler here until the default flips.
const realSetTimeout = globalThis.setTimeout

function settledWithin(promise: Promise<unknown>, ms = 500): Promise<'resolved' | 'pending'> {
  return Promise.race([
    promise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => {
      realSetTimeout(() => resolve('pending'), ms)
    }),
  ])
}

describe('tickFake under the sync scheduler', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('depth 1 resolves under fake timers and runs an earlier continuation', async () => {
    vi.useFakeTimers()
    let ran = false
    void tick().then(() => {
      ran = true
    })
    expect(await settledWithin(tickFake(1))).toBe('resolved')
    expect(ran).toBe(true)
  })

  test('T-A2-3s: depth 2 never fires a 1 ms timer', async () => {
    vi.useFakeTimers()
    // A bare tick resolves under fake timers only on the sync scheduler. Under the async scheduler depth 2 may
    // move the clock 1 ms by design (covered by the async files), so the sync-only rule does not apply.
    if ((await settledWithin(tick(), 50)) === 'pending') return
    const fired = vi.fn()
    setTimeout(fired, 1)
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(fired).not.toHaveBeenCalled()
  })
})
