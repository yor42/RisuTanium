/**
 * The boot's production prompt surface (`src/ts/storage/bootLoadUi.ts`) over the REAL `alert.ts`,
 * `alertPrompts.ts` and `backHandlers.ts`, with a real `writable` standing in for `alertStore`.
 * `choose` must hand its cancel to the select it posts, so Back answers the option that writes nothing.
 * Fake timers are on, so every outcome is read from a flag and a prompt that stays pending fails an assertion.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../stores.svelte'))

vi.mock(import('../database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('../database.svelte'))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

import { resetAlertPromptsForTests } from '../../alertPrompts'
import { dispatchBack, resetBackHandlersForTests } from '../../backHandlers'
import { alertStore } from '../../stores.svelte'
import { bootLoadUi } from '../bootLoadUi'

interface Outcome<T> {
    settled: boolean
    value?: T
}

function track<T>(promise: Promise<T>): Outcome<T> {
    const outcome: Outcome<T> = { settled: false }
    void promise.then((value) => {
        outcome.settled = true
        outcome.value = value
    })
    return outcome
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetBackHandlersForTests()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
    vi.useRealTimers()
})

describe('bootLoadUi.choose', () => {
    test('posts a select that carries the cancel index, and Back resolves that index', async () => {
        const out = track(bootLoadUi.choose('Damaged', ['Load backup', 'Stop'], 1))

        const shown = get(alertStore)
        expect(shown.type).toBe('select')
        expect(shown.cancelAnswer).toBe('1')
        expect(dispatchBack()).toBe(true)
        await vi.advanceTimersByTimeAsync(0)

        expect(out).toEqual({ settled: true, value: 1 })
    })

    test('a cancel that names the first option is honoured too', async () => {
        const out = track(bootLoadUi.choose('Other tab', ['Retry', 'Stop'], 0))

        expect(dispatchBack()).toBe(true)
        await vi.advanceTimersByTimeAsync(0)

        expect(out).toEqual({ settled: true, value: 0 })
    })
})
