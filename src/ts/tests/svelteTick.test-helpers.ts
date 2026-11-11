import { tick } from 'svelte'
import { vi } from 'vitest'

// Level k of the helper's chain settles no earlier than the code's level k when the code's first tick was
// requested outside a fake-timer callback. Otherwise the author rule's +1 applies.
// Under the async scheduler Svelte's tick waits on a frame or a timer, so a fake-timer test must advance the
// fake clock for it. Under the sync scheduler the chain settles in microtasks and the clock never passes 0.
//
// Author rule: depth is the number of tick levels between the test's last clock move and the asserted
// continuation. Add 1 if the first tick was requested inside a fake-timer callback, for example after
// vi.advanceTimersByTime. tick().then(tick) needs 2, and so does a continuation whose state write runs an
// effect that calls tick(). A depth that is too low fails an assertion; it does not hang.
//
// The helper moves the fake clock at most depth - 1 ms, and only while its own chain is unsettled. Every step
// also runs timers that are already due at the current fake time, including zero-delay timers requested
// outside a fake tick.

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout

// The real-time guard below captures setTimeout at load. Loaded under fake timers it would capture the fake
// one, so a wrong depth would hang instead of throwing.
if (vi.isFakeTimers()) {
  throw new Error('svelteTick: loaded while fake timers are installed; import it statically before vi.useFakeTimers')
}

const MAX_DEPTH = 4
const GUARD_MS = 1000

async function tickChain(depth: number): Promise<void> {
  await tick()
  if (depth > 1) await tickChain(depth - 1)
}

/**
 * Awaits `depth` nested Svelte ticks. Under fake timers it advances the fake clock for them; under real
 * timers it only awaits the chain.
 */
export async function tickFake(depth = 1): Promise<void> {
  if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) {
    throw new Error('tickFake: depth must be an integer from 1 to ' + MAX_DEPTH)
  }
  let settled = false
  const chain = tickChain(depth).then(() => {
    settled = true
  })
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0)
    for (let step = 1; step < depth && !settled; step++) {
      await vi.advanceTimersByTimeAsync(1)
    }
  }
  let guardId: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    guardId = realSetTimeout(() => {
      reject(new Error('tickFake: ' + depth + '-level tick chain still pending'))
    }, GUARD_MS)
  })
  try {
    await Promise.race([chain, guard])
  } finally {
    realClearTimeout(guardId)
  }
}
