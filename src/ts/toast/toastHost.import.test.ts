// @vitest-environment node

/**
 * The host module imports and runs with no `window` or `document`: the singleton posts, expires and dismisses
 * under plain Node.
 */
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
    vi.useRealTimers()
})

test('TH17 the module imports under Node and the singleton posts, expires and dismisses', async () => {
    expect(typeof window).toBe('undefined')
    expect(typeof document).toBe('undefined')
    const { postToast, dismissToast, toastHost, resetToastHostForTests } = await import('./toastHost.svelte')
    vi.useFakeTimers()
    const first = postToast({ text: 'first' })
    expect(toastHost.visible.map((toast) => toast.id)).toEqual([first])
    vi.advanceTimersByTime(5000)
    expect(toastHost.visible).toHaveLength(0)
    const second = postToast({ kind: 'error', text: 'second' })
    dismissToast(second)
    expect(toastHost.visible).toHaveLength(0)
    resetToastHostForTests()
})
