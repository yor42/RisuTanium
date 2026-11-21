/**
 * A prompt asked with an AbortSignal is withdrawn when the signal aborts, in each state it can be in:
 * queued behind another prompt, shown, or covered by another alert. It resolves with its cancel
 * answer, other prompts are untouched, and the 400 ms answer guard is skipped for the withdrawal only.
 *
 * Drives the REAL `alert.ts` and `alertPrompts.ts` over a real `writable` standing in for
 * `alertStore`, as `alertPrompts.test.ts` does. Fake timers are on, so the guard is a clock the test moves.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from './alert'

vi.mock(import('./stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('./stores.svelte'))

vi.mock(import('./storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
}) as unknown as typeof import('./storage/database.svelte'))

vi.mock(import('./platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('./platform'))

import { alertConfirm, alertWait } from './alert'
import { alertStore } from './stores.svelte'
import { askToolApproval } from './process/mcp/toolApproval'
import { alertIdle, askPrompt, promptWaiting, resetAlertPromptsForTests } from './alertPrompts'

const GUARD_MS = 401

function shown(): alertData {
    return get(alertStore) as alertData
}

function answer(msg: string): void {
    alertStore.set({ type: 'none', msg })
}

interface Outcome<T> {
    settled: boolean
    value?: T
}

function track<T>(promise: Promise<T>): Outcome<T> {
    const outcome: Outcome<T> = { settled: false }
    void promise.then((value) => { outcome.settled = true; outcome.value = value })
    return outcome
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
}

async function passGuard(): Promise<void> {
    await vi.advanceTimersByTimeAsync(GUARD_MS)
}

beforeEach(() => {
    vi.useFakeTimers()
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetAlertPromptsForTests()
    vi.useRealTimers()
})

describe('prompt withdrawal on abort', () => {
    test('a shown prompt is closed at once, inside the answer guard, and resolves not-allowed', async () => {
        const controller = new AbortController()
        const confirm = track(alertConfirm('Run it?', { signal: controller.signal }))
        await settle()
        expect(shown().type).toBe('ask')
        controller.abort()
        await settle()
        expect(shown().type).toBe('none')
        expect(confirm).toEqual({ settled: true, value: false })
        expect(promptWaiting()).toBe(false)
    })

    test('a queued prompt is removed and the prompt in front is untouched', async () => {
        const controller = new AbortController()
        const first = track(alertConfirm('First?'))
        const queued = track(alertConfirm('Second?', { signal: controller.signal }))
        const third = track(alertConfirm('Third?'))
        await settle()
        controller.abort()
        await settle()
        expect(queued).toEqual({ settled: true, value: false })
        expect(first.settled).toBe(false)
        expect(shown().msg).toBe('First?')
        await passGuard()
        answer('yes')
        await settle()
        expect(first).toEqual({ settled: true, value: true })
        expect(shown().msg).toBe('Third?')
        expect(third.settled).toBe(false)
    })

    test('a covered prompt is withdrawn, and the cover closing moves on to the next prompt', async () => {
        const controller = new AbortController()
        const covered = track(alertConfirm('Run it?', { signal: controller.signal }))
        const next = track(alertConfirm('Next?'))
        await settle()
        alertStore.set({ type: 'wait', msg: 'Working' })
        await settle()
        expect(shown().type).toBe('wait')
        controller.abort()
        await settle()
        expect(covered).toEqual({ settled: true, value: false })
        expect(shown().type).toBe('wait')
        answer('')
        await settle()
        expect(shown().msg).toBe('Next?')
        expect(next.settled).toBe(false)
    })

    test('a signal already aborted resolves not-allowed and shows nothing', async () => {
        const controller = new AbortController()
        controller.abort()
        const confirm = track(alertConfirm('Run it?', { signal: controller.signal }))
        await settle()
        expect(confirm).toEqual({ settled: true, value: false })
        expect(shown().type).toBe('none')
        expect(promptWaiting()).toBe(false)
    })

    test('a prompt answered before the abort keeps its answer and the late abort does nothing', async () => {
        const controller = new AbortController()
        const confirm = track(alertConfirm('Run it?', { signal: controller.signal }))
        const next = track(alertConfirm('Next?'))
        await settle()
        await passGuard()
        answer('yes')
        await settle()
        expect(confirm).toEqual({ settled: true, value: true })
        controller.abort()
        await settle()
        expect(shown().msg).toBe('Next?')
        expect(next.settled).toBe(false)
    })

    test('a withdrawn prompt resolves with its own cancel answer when it has one', async () => {
        const controller = new AbortController()
        const out = track(askPrompt({ type: 'select', msg: 'a||b', cancelAnswer: '-1' }, { signal: controller.signal }))
        await settle()
        controller.abort()
        await settle()
        expect(out).toEqual({ settled: true, value: '-1' })
    })

    test('guard: the 400 ms guard still discards an early answer to a prompt that has a signal', async () => {
        const controller = new AbortController()
        const confirm = track(alertConfirm('Run it?', { signal: controller.signal }))
        await settle()
        answer('yes')
        await settle()
        expect(confirm.settled).toBe(false)
        expect(shown().type).toBe('ask')
        await passGuard()
        answer('yes')
        await settle()
        expect(confirm).toEqual({ settled: true, value: true })
    })

    test('idle is reported again once the withdrawn prompt is gone', async () => {
        const controller = new AbortController()
        void alertConfirm('Run it?', { signal: controller.signal })
        await settle()
        controller.abort()
        await settle()
        expect(get(alertIdle)).toBe(true)
    })

    test('guard: a wait cover used by other code is not disturbed by an abort of an unrelated signal', async () => {
        const controller = new AbortController()
        void alertWait('Busy')
        await settle()
        controller.abort()
        await settle()
        expect(shown().type).toBe('wait')
    })

    test('a pending tool approval denies when the run is stopped, and the prompt leaves the screen', async () => {
        const controller = new AbortController()
        const decision = track(askToolApproval({ tool: 'fs_write_file', url: 'internal:fs', kind: 'mutating', summary: 'x' }, { signal: controller.signal }))
        await settle()
        expect(shown().type).toBe('ask')
        controller.abort()
        await settle()
        expect(decision).toEqual({ settled: true, value: 'deny' })
        expect(shown().type).toBe('none')
    })
})