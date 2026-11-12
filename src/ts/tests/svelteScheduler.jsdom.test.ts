// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { tick } from 'svelte'

// Real time captured before any fake clock exists: under the async scheduler tick() waits for an animation frame
// the fake clock never delivers, so a bare tick() stays pending while the sync scheduler resolves it at once.
const realSetTimeout = globalThis.setTimeout

async function tickStateUnderFakeTimers(tickFunction: () => Promise<void>): Promise<'resolved' | 'pending'> {
  vi.useFakeTimers()
  try {
    let state: 'resolved' | 'pending' = 'pending'
    void tickFunction().then(() => {
      state = 'resolved'
    })
    await new Promise<void>((resolve) => realSetTimeout(resolve, 100))
    return state
  } finally {
    vi.useRealTimers()
  }
}

// This file imports no component and no flag helper: the scheduler must already be the async one.
test('T-A1-3: under jsdom a module-only file, and an instance re-created by vi.resetModules, run the async scheduler', async () => {
  expect(await tickStateUnderFakeTimers(tick)).toBe('pending')
  vi.resetModules()
  const fresh = await import('svelte')
  expect(fresh.tick).not.toBe(tick)
  expect(await tickStateUnderFakeTimers(fresh.tick)).toBe('pending')
})
