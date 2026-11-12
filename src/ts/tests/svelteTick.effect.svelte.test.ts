import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync, tick } from 'svelte'
import { tickFake } from './svelteTick.test-helpers'

const realSetTimeout = globalThis.setTimeout

function settledWithin(promise: Promise<unknown>, ms = 500): Promise<'resolved' | 'pending'> {
  return Promise.race([
    promise.then(() => 'resolved' as const),
    new Promise<'pending'>((resolve) => {
      realSetTimeout(() => resolve('pending'), ms)
    }),
  ])
}

describe('tickFake with an effect-driven nested tick', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('T-A2-7e: depth 2 runs a continuation of a tick requested by an effect', async () => {
    vi.useFakeTimers()
    let count = $state(0)
    let afterEffectTick = 0
    const stop = $effect.root(() => {
      $effect(() => {
        if (count === 0) return
        void tick().then(() => {
          afterEffectTick = count
        })
      })
    })
    flushSync()
    count = 2
    expect(await settledWithin(tickFake(2))).toBe('resolved')
    expect(afterEffectTick).toBe(2)
    stop()
  })
})
