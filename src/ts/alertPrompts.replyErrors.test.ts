/**
 * A reply's error (`alertError` with `reply`) is an entry of the notice lane: it waits behind any alert
 * the person can close and any prompt, is shown again after a cover closes, and only the person's close
 * ends it. Drives the REAL `alert.ts` and `alertPrompts.ts` over a writable standing in for `alertStore`,
 * as `alertPrompts.test.ts` does; the person's close is the raw `{ type: 'none' }` write that AlertComp
 * and the key handlers make.
 *
 * Tests titled `guard:` pass with or without the lane and pin behaviour that must be preserved.
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

import { alertClear, alertConfirm, alertError, alertNormal, alertWait, alertStore as alertStoreWrapper } from './alert'
import { alertStore } from './stores.svelte'
import { alertIdle, noticesSettled, queueNotice, resetAlertPromptsForTests } from './alertPrompts'

const NONE: alertData = { type: 'none', msg: '' }
const GUARD_MS = 401
const ALPHA = { reply: { chat: 'Alpha: Chat 1' } }
const BETA = { reply: { chat: 'Beta: Chat 1' } }

function shown(): alertData {
    return get(alertStore) as alertData
}

/** What OK, Escape, Back and the link button write. */
function personCloses(): void {
    alertStore.set(NONE)
}

function recordWrites(): alertData[] {
    const writes: alertData[] = []
    let first = true
    alertStore.subscribe((value) => {
        if (first) {
            first = false
            return
        }
        writes.push(value as alertData)
    })
    return writes
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

beforeEach(() => {
    vi.useFakeTimers()
    resetAlertPromptsForTests()
    alertStore.set(NONE)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    resetAlertPromptsForTests()
    alertStore.set(NONE)
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('reply errors in the notice lane', () => {
    test('E1: two errors show one at a time in the order raised, each until the person closes it', () => {
        alertError('A failed', ALPHA)
        alertError('B failed', BETA)
        expect.soft(shown().msg, 'the first error stays').toBe('Alpha: Chat 1\nA failed')
        personCloses()
        expect.soft(shown().type, 'the second error shows after the first close').toBe('error')
        expect.soft(shown().msg).toBe('Beta: Chat 1\nB failed')
        personCloses()
        expect.soft(shown(), 'nothing after the last close').toEqual(NONE)
    })

    test('E2: an error waits behind a closable alert and does not replace it', () => {
        alertNormal('N')
        alertError('A failed', ALPHA)
        expect.soft(shown()).toMatchObject({ type: 'normal', msg: 'N' })
        personCloses()
        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
    })

    test('E3: an error waits behind a prompt, which takes only its own answer', async () => {
        const confirm = track(alertConfirm('Proceed?'))
        alertError('A failed', ALPHA)
        expect.soft(shown().type, 'the prompt stays up').toBe('ask')
        await vi.advanceTimersByTimeAsync(GUARD_MS)
        alertStore.set({ type: 'none', msg: 'yes' })
        await settle()
        expect.soft(confirm, 'the prompt got its own answer').toMatchObject({ settled: true, value: true })
        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
    })

    test.each([
        { name: 'nothing', put: () => {} },
        { name: 'a progress cover', put: () => { alertStore.set({ type: 'progress', msg: 'Working' }) } },
        { name: 'a wait without Cancel', put: () => { alertWait('Loading') } },
    ])('E4: over $name the error shows at once, labelled', (cover) => {
        cover.put()
        alertError('A failed', ALPHA)
        expect(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
    })

    test('E5: a cover over a shown error ends with the same error shown again as a fresh object', () => {
        alertError('A failed', ALPHA)
        const first = shown()
        alertWait('Loading')
        expect.soft(shown().type).toBe('wait')
        alertClear()
        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
        expect.soft(shown(), 'a fresh object').not.toBe(first)

        const second = shown()
        alertStore.set({ type: 'toast', msg: 'Saved' })
        personCloses()
        expect.soft(shown(), 'after a cover the person closed').toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
        expect.soft(shown()).not.toBe(second)
    })

    test('E6: code cannot close a shown error: alertClear and the wrapper write nothing', () => {
        alertError('A failed', ALPHA)
        const writes = recordWrites()
        alertClear()
        alertStoreWrapper.set(NONE)
        expect(writes).toEqual([])
        expect(shown().type).toBe('error')
    })

    test('E7: the person closing the first error shows the second', () => {
        alertError('A failed', ALPHA)
        alertError('B failed', BETA)
        alertClear()
        expect.soft(shown().msg).toBe('Alpha: Chat 1\nA failed')
        personCloses()
        expect.soft(shown().msg).toBe('Beta: Chat 1\nB failed')
    })

    test('E8: the link, stack and submsg of each error survive the queue; the link closes it and runs open', () => {
        const openA = vi.fn()
        const openB = vi.fn()
        const errorA = new Error('A failed')
        errorA.stack = 'stack A'
        alertError(errorA, { link: { label: 'Fix A', open: openA }, ...ALPHA })
        alertError('Failed to fetch', { link: { label: 'Fix B', open: openB }, ...BETA })

        const first = shown()
        expect.soft(first.type).toBe('error')
        expect.soft(first.stackTrace).toBe('stack A')
        // The link button writes the raw none and then calls open.
        personCloses()
        first.link?.open()
        expect.soft(openA).toHaveBeenCalledTimes(1)
        const second = shown()
        expect.soft(second).toMatchObject({ type: 'error', msg: 'Beta: Chat 1\nFailed to fetch' })
        expect.soft(second.link?.label).toBe('Fix B')
        expect.soft(second.submsg, 'the network hint').not.toBe('')
        expect.soft(openB).not.toHaveBeenCalled()
    })

    test('E9: the alert is not idle while an error is queued, across the first one closing', () => {
        alertNormal('N')
        alertError('A failed', ALPHA)
        const idle: boolean[] = []
        alertIdle.subscribe((value) => { idle.push(value) })
        personCloses()
        expect.soft(get(alertIdle), 'the error is current').toBe(false)
        personCloses()
        expect.soft(get(alertIdle), 'after the last close').toBe(true)
        expect.soft(idle.indexOf(true), 'idle only after the last close').toBe(idle.length - 1)
    })

    test('E10: a boot notice and an error share one first-in-first-out order', () => {
        queueNotice('N')
        alertError('A failed', ALPHA)
        expect.soft(shown()).toMatchObject({ type: 'normal', msg: 'N' })
        personCloses()
        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
    })

    test('E10b: a notice queued behind a closable alert stays ahead of an error raised after a cover replaced that alert', () => {
        alertNormal('N')
        queueNotice('Q')
        alertStore.set({ type: 'progress', msg: 'Working' })
        alertError('A failed', ALPHA)
        expect.soft(shown().type, 'the cover stays while the older notice waits').toBe('progress')
        alertClear()
        expect.soft(shown()).toMatchObject({ type: 'normal', msg: 'Q' })
        personCloses()
        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
    })

    test('E11: noticesSettled waits for a queued or shown error and resolves after the last close', async () => {
        alertError('A failed', ALPHA)
        const settled = track(noticesSettled())
        await settle()
        expect.soft(settled.settled, 'while the error is shown').toBe(false)
        personCloses()
        await settle()
        expect.soft(settled.settled, 'after its close').toBe(true)
    })

    test('E12 guard: with reply, an ignored message queues nothing, a network failure gets its hint, an Error keeps its stack, and console.error runs once per call', () => {
        alertError('{}', ALPHA)
        expect.soft(shown(), 'ignored').toEqual(NONE)
        personCloses()

        const error = new Error('boom')
        error.stack = 'the stack'
        alertError(error, ALPHA)
        expect.soft(shown().stackTrace).toBe('the stack')
        expect.soft(console.error).toHaveBeenCalledTimes(2)
        personCloses()

        alertError('Failed to fetch', ALPHA)
        expect.soft(shown().submsg).not.toBe('')
    })

    test('E13: the label is the first line; a null label gives the message alone', () => {
        alertError('A failed', ALPHA)
        personCloses()
        alertError('B failed', { reply: { chat: null } })
        expect.soft(shown().msg).toBe('B failed')
    })

    test('E13 first line equals the label and the second starts the message', () => {
        alertError('A failed', ALPHA)
        const lines = shown().msg.split('\n')
        expect.soft(lines[0]).toBe('Alpha: Chat 1')
        expect.soft(lines[1]).toBe('A failed')
    })

    test('E19: a cancellable wait is not replaced; once the runner clears it the error shows exactly once', () => {
        alertWait('Preview', () => {})
        alertError('A failed', ALPHA)
        const writes = recordWrites()
        expect.soft(shown().type, 'the wait stays').toBe('wait')
        alertClear()
        expect.soft(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nA failed' })
        expect.soft(writes.filter((value) => value.type === 'error'), 'error writes').toHaveLength(1)
    })

    test('E20: the same chat failing twice with the same text gives two dialogs', () => {
        alertError('same', ALPHA)
        alertError('same', ALPHA)
        personCloses()
        expect(shown()).toMatchObject({ type: 'error', msg: 'Alpha: Chat 1\nsame' })
        personCloses()
        expect(shown()).toEqual(NONE)
    })
})
