/**
 * What an Android Back press does to the alert on screen, driven through the REAL `dispatchBack`,
 * `alertBack.ts`, `alertPrompts.ts` and `alert.ts` over a real `writable` standing in for the raw
 * `alertStore`. Nothing about covering or closing is mocked.
 *
 * Every reproducer of a cancelled prompt shares one failure on the base: `dispatchBack` returned
 * false at once for a covered page and left the promise pending. Each case also asserts its own
 * type's answer or hold, which that shared base failure does not.
 *
 * Fake timers are on for every test, so the 400 ms answer guard is a clock the test moves. Every
 * outcome is read from a flag, never awaited, so a prompt that wrongly stays pending fails an
 * assertion instead of hanging the run.
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

import {
    alertAddCharacter,
    alertCardExport,
    alertChatOptions,
    alertConfirm,
    alertInput,
    alertModuleSelect,
    alertNormalWait,
    alertPluginConfirm,
    alertSelect,
    alertSelectChar,
    alertStaleAccountNotice,
    alertWait,
    alertClear,
} from './alert'
import { ALERT_BACK_ACTIONS } from './alertBack'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from './alertPrompts'
import { dispatchBack, resetBackHandlersForTests } from './backHandlers'
import { alertStore } from './stores.svelte'

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

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0)
}

function shown(): alertData {
    return get(alertStore)
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

describe('a prompt with a cancel button', () => {
    test('a confirm is answered no and the store closes', async () => {
        const out = track(alertConfirm('Proceed?'))
        expect(shown().type).toBe('ask')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out).toEqual({ settled: true, value: false })
        expect(shown().type).toBe('none')
    })

    test('Back inside the answer guard still answers, and Back never confirms', async () => {
        const out = track(alertPluginConfirm('Import?'))
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out).toEqual({ settled: true, value: false })
    })

    test('the character picker resolves with its cancel value', async () => {
        const out = track(alertSelectChar())
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out).toEqual({ settled: true, value: '' })
    })

    test('the module picker resolves with its X value', async () => {
        const out = track(alertModuleSelect())
        expect(shown().type).toBe('selectModule')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out).toEqual({ settled: true, value: '' })
    })

    test('the card export resolves with a cancel type and an empty second type', async () => {
        const out = track(alertCardExport())
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out).toEqual({ settled: true, value: { type: 'cancel', type2: '' } })
    })

    test('add character resolves with cancel', async () => {
        const out = track(alertAddCharacter())
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out).toEqual({ settled: true, value: 'cancel' })
    })

    test('chat options resolve as the Cancel button does, which its caller reads as no choice', async () => {
        const out = track(alertChatOptions())
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(out.settled).toBe(true)
        expect(Number.isNaN(out.value)).toBe(true)
    })
})

describe('queued and covered prompts', () => {
    test('Back answers the prompt on screen only; the next one is shown, pending, and a second Back inside its guard answers it', async () => {
        const first = track(alertConfirm('First?'))
        const second = track(alertSelectChar())
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(first).toEqual({ settled: true, value: false })
        expect(second.settled).toBe(false)
        expect(shown().type).toBe('selectChar')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(second).toEqual({ settled: true, value: '' })
        expect(shown().type).toBe('none')
    })

    test('a notice over a current prompt is closed alone: the prompt returns and stays pending', async () => {
        const prompt = track(alertConfirm('Proceed?'))
        const notice = track(alertNormalWait('Heads up'))
        expect(shown().type).toBe('normal')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(notice.settled).toBe(true)
        expect(prompt.settled).toBe(false)
        expect(shown().type).toBe('ask')
        await vi.advanceTimersByTimeAsync(ANSWER_GUARD_MS + 1)
        expect(prompt.settled).toBe(false)
    })
})

describe('an alert that is not the current prompt', () => {
    test('a prompt-typed alert written to the store by other code is left alone and the real prompt is not answered', async () => {
        const prompt = track(alertConfirm('Proceed?'))
        const foreign: alertData = { type: 'selectChar', msg: 'foreign' }
        alertStore.set(foreign)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(shown()).toBe(foreign)
        expect(prompt.settled).toBe(false)
    })
})

describe('an alert of the same type as the current prompt', () => {
    test('a different prompt object of the same type is left alone and the real prompt is not answered', async () => {
        const prompt = track(alertConfirm('Proceed?'))
        const foreign: alertData = { type: 'ask', msg: 'foreign' }
        alertStore.set(foreign)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(shown()).toBe(foreign)
        expect(prompt.settled).toBe(false)
    })
})

describe('notices and waits', () => {
    test('a notice closes and releases a waiter on it', async () => {
        const waiter = track(alertNormalWait('Done'))
        expect(shown().type).toBe('normal')
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(shown().type).toBe('none')
        expect(waiter.settled).toBe(true)
    })

    test('a wait with a cancel runs it once per press and leaves closing to the callback', async () => {
        const onCancel = vi.fn()
        alertWait('Working', onCancel)
        expect(dispatchBack()).toBe(true)
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(shown().type).toBe('wait')
        expect(dispatchBack()).toBe(true)
        expect(onCancel).toHaveBeenCalledTimes(2)
    })

    test('a wait whose cancel clears itself is gone after the press', async () => {
        alertWait('Working', () => alertClear())
        expect(dispatchBack()).toBe(true)
        expect(shown().type).toBe('none')
    })

    test('a throwing cancel is contained and the press is still consumed', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        alertWait('Working', () => {
            throw new Error('cancel failed')
        })
        expect(dispatchBack()).toBe(true)
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })
})

describe('alerts Back leaves on screen', () => {
    async function expectHeld(type: alertData['type'], outcome?: Outcome<unknown>): Promise<void> {
        const before = shown()
        expect(before.type).toBe(type)
        expect(dispatchBack()).toBe(true)
        await settle()
        expect(shown()).toBe(before)
        if (outcome !== undefined) {
            expect(outcome.settled).toBe(false)
        }
    }

    test('a select', async () => {
        const out = track(alertSelect(['a', 'b']))
        await expectHeld('select', out)
    })

    test('an input', async () => {
        const out = track(alertInput('Name?'))
        await expectHeld('input', out)
    })

    test('the terms prompt', async () => {
        alertStore.set({ type: 'tos', msg: 'tos' })
        await expectHeld('tos')
    })

    test('a progress notice', async () => {
        alertStore.set({ type: 'progress', msg: 'Saving', submsg: '40' })
        await expectHeld('progress')
    })

    test('a wait without a cancel', async () => {
        alertWait('Working')
        await expectHeld('wait')
    })

    // Last among the tests that touch the store: this notice re-posts itself whenever the store closes.
    test('the stale account notice', async () => {
        const out = track(alertStaleAccountNotice())
        await expectHeld('staleAccountNotice', out)
    })

    test('every type held in the table is one of the types above, or is not a covering alert (none, toast)', () => {
        const held = Object.entries(ALERT_BACK_ACTIONS)
            .filter(([, action]) => action.kind === 'hold')
            .map(([type]) => type)
            .sort()
        expect(held).toEqual(['input', 'none', 'progress', 'select', 'staleAccountNotice', 'toast', 'tos'])
    })
})
