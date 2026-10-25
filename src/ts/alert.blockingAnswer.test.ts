/**
 * A blocking alert returns the answer the user gave, whatever else is put in
 * the alert store after that answer and before the waiter looks again.
 *
 * Drives the REAL `alert.ts` against a real `writable` standing in for
 * `alertStore` from `stores.svelte`. The user's answer is the store write that
 * ends the alert, `{ type: 'none', msg: <answer> }`, which is what
 * `AlertComp.svelte` writes; a later alert is one of the module's own
 * functions, called in the same tick as the answer.
 *
 * Tests whose title starts with `guard:` pass with or without the fix: they
 * pin behaviour that must be preserved.
 */
import { get, writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { alertData } from './alert'

//#region module mocks

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

//#endregion

import {
    alertConfirm,
    alertModuleSelect,
    alertNormal,
    alertNormalWait,
    alertSelect,
    alertToast,
    alertWait,
    waitAlert,
} from './alert'
import { alertStore } from './stores.svelte'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from './alertPrompts'

//#region helpers

const NONE: alertData = { type: 'none', msg: '' }

/** What the user's answer writes: the alert ends and its `msg` is the answer. */
function answer(msg: string): void {
    alertStore.set({ type: 'none', msg })
}

function pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** Waits until the answer guard of a prompt that has just opened has passed, so that an answer is taken. */
function pastGuard(): Promise<void> {
    return pause(ANSWER_GUARD_MS + 20)
}

/** Rejects when `promise` has not settled within `ms`, so a blocked waiter fails a test instead of hanging it. */
function within<T>(promise: Promise<T>, ms = 1000): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms)),
    ])
}

/** Whether `promise` has settled by the time `ms` have passed. */
async function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let settled = false
    void promise.then(() => { settled = true }, () => { settled = true })
    await pause(ms)
    return settled
}

afterEach(() => {
    resetAlertPromptsForTests()
    alertStore.set(NONE)
})

//#endregion

describe('a blocking alert answered, then another alert put up in the same tick', () => {
    test('a confirm answered no returns false when the other alert is closed with yes', async () => {
        const answered = alertConfirm('Proceed?')

        await pastGuard()
        answer('no')
        alertNormal('an unrelated notice')
        await pause(40)
        // The unrelated notice is dismissed with Enter, which writes 'yes'.
        answer('yes')

        expect(await within(answered)).toBe(false)
    })

    test('a select answered with a choice returns the choice when the other alert is closed empty', async () => {
        const answered = alertSelect(['first', 'second'])

        await pastGuard()
        answer('1')
        alertNormal('an unrelated notice')
        await pause(40)
        answer('')

        expect(await within(answered)).toBe('1')
    })

    test('the module picker answered with a choice returns the choice when the other alert is closed empty', async () => {
        const answered = alertModuleSelect()

        await pastGuard()
        answer('["module-a"]')
        alertNormal('an unrelated notice')
        await pause(60)
        answer('')

        expect(await within(answered)).toBe('["module-a"]')
    })
})

describe('a blocking alert answered, then a toast put up in the same tick', () => {
    test('a confirm answered no resolves false at once, while the toast is still up', async () => {
        const answered = alertConfirm('Proceed?')

        await pastGuard()
        answer('no')
        alertToast('Alert Closed')

        expect(await within(answered, 200)).toBe(false)
        expect(get(alertStore).type).toBe('toast')
    })

    test('a confirm answered yes resolves true at once, while the toast is still up', async () => {
        const answered = alertConfirm('Proceed?')

        await pastGuard()
        answer('yes')
        alertToast('Alert Closed')

        expect(await within(answered, 200)).toBe(true)
        expect(get(alertStore).type).toBe('toast')
    })

    test('a select answered with a choice resolves with the choice at once, while the toast is still up', async () => {
        const answered = alertSelect(['first', 'second'])

        await pastGuard()
        answer('1')
        alertToast('Alert Closed')

        expect(await within(answered, 200)).toBe('1')
        expect(get(alertStore).type).toBe('toast')
    })

    test('the module picker answered with a choice resolves with the choice at once, while the toast is still up', async () => {
        const answered = alertModuleSelect()

        await pastGuard()
        answer('["module-a"]')
        alertToast('Alert Closed')

        expect(await within(answered, 200)).toBe('["module-a"]')
        expect(get(alertStore).type).toBe('toast')
    })
})

describe('blocking alerts without interference', () => {
    test('guard: a confirm answered yes returns true and one answered no returns false', async () => {
        const yes = alertConfirm('Proceed?')
        await pastGuard()
        answer('yes')
        expect(await within(yes)).toBe(true)

        const no = alertConfirm('Proceed?')
        await pastGuard()
        answer('no')
        expect(await within(no)).toBe(false)
    })

    test('guard: a select returns the choice written when it ends', async () => {
        const answered = alertSelect(['first', 'second'])

        await pastGuard()
        answer('0')

        expect(await within(answered)).toBe('0')
    })

    test('guard: the module picker returns the value written when it ends', async () => {
        const answered = alertModuleSelect()

        await pastGuard()
        answer('["module-b"]')

        expect(await within(answered)).toBe('["module-b"]')
    })
})

describe('waitAlert', () => {
    test('guard: a store that is already none resolves at once', async () => {
        alertStore.set(NONE)

        await within(waitAlert(), 200)
    })

    test('guard: a waiter resumes after the alert in front of it is closed, and not before', async () => {
        alertNormal('a notice')
        const waiting = waitAlert()

        expect(await settledWithin(waiting, 40)).toBe(false)
        answer('yes')

        await within(waiting)
        expect(get(alertStore).type).toBe('none')
    })

    test('guard: alertNormalWait resumes after its own notice is closed', async () => {
        const shown = alertNormalWait('a notice')

        expect(get(alertStore).type).toBe('normal')
        expect(await settledWithin(shown, 40)).toBe(false)
        answer('yes')

        await within(shown)
    })

    test('guard: a toast in front of a waiter holds it until the toast is gone', async () => {
        alertToast('a toast')
        const waiting = waitAlert()

        expect(await settledWithin(waiting, 40)).toBe(false)
        alertStore.set(NONE)

        await within(waiting)
    })
})

describe('alertWait', () => {
    test('it puts a wait notice in the store and returns that very object', () => {
        const notice = alertWait('Loading...')

        expect(get(alertStore)).toBe(notice)
        expect(notice).toMatchObject({ type: 'wait', msg: 'Loading...' })
    })

    test('a notice made without a cancel action carries none, and one made with it carries that action', () => {
        const plain = alertWait('Loading...')
        expect(plain.onCancel).toBeUndefined()

        const onCancel = vi.fn()
        const cancellable = alertWait('Loading...', onCancel)

        expect(get(alertStore)).toBe(cancellable)
        expect(cancellable.onCancel).toBe(onCancel)
        expect(onCancel).not.toHaveBeenCalled()
    })

    test('a later notice with the same text is a different object from the first', () => {
        const first = alertWait('Loading...')
        const second = alertWait('Loading...')

        expect(second).not.toBe(first)
        expect(get(alertStore)).toBe(second)
    })
})
