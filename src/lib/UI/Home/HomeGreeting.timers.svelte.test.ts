// @vitest-environment jsdom

/**
 * `HomeGreeting.svelte` alone: its timer hygiene. One timeout is armed while it is mounted (no
 * interval) and none is left behind after it unmounts. The count is a delta against a baseline
 * taken before the mount, so timers armed by anything else do not count.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import HomeGreeting from './HomeGreeting.svelte'

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 10, 10, 0, 0))
})

afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
})

describe('HomeGreeting timers', () => {
    test('S1-U2: mounting arms exactly one timer and unmounting clears it', async () => {
        const before = vi.getTimerCount()
        const target = document.createElement('div')
        document.body.appendChild(target)
        const instance = mount(HomeGreeting, { target })
        flushSync()
        expect(vi.getTimerCount() - before).toBe(1)
        expect(target.querySelector('h1')!.textContent).toBeTruthy()

        await unmount(instance)
        expect(vi.getTimerCount()).toBe(before)
    })
})
