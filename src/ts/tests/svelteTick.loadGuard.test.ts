import { afterEach, expect, test, vi } from 'vitest'

// This file must not import the helper statically: the guard is evaluated at module load.
afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

test('T-A2-12: the tick helper refuses to load under fake timers', async () => {
  vi.resetModules()
  vi.useFakeTimers()
  await expect(import('./svelteTick.test-helpers')).rejects.toThrow(/fake timers/)
})

test('the tick helper loads under real timers', async () => {
  vi.resetModules()
  await expect(import('./svelteTick.test-helpers')).resolves.toHaveProperty('tickFake')
})
