// @vitest-environment jsdom

/**
 * A shown task covers the page like a legacy alert that covers it, without being an `alertStore` value: the covering
 * predicates, the unread-notice wait and Back all count it.
 *
 * Drives the REAL `alert.ts`, `alertPrompts.ts`, `alertBack.ts` and `alertTask.svelte.ts` over a real `writable`
 * standing in for `alertStore` from `stores.svelte`. Legacy state is built with the real producers (`alertConfirm`,
 * `alertToast`, `alertNormal`), never by writing hand-made store values.
 *
 * Tests whose title starts with `guard:` pass with or without the integration: they pin behaviour that must be kept.
 */
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

import { alertConfirm, alertNormal, alertToast, doingAlert, waitUnreadNotice } from './alert'
import { closeDialogForBack } from './alertBack'
import { pageCovered, promptWaiting, resetAlertPromptsForTests } from './alertPrompts'
import { alertTask, answerTask, resetTaskHostForTests, taskShown } from './alertTask.svelte'
import { alertStore } from './stores.svelte'
import type { TaskDef } from '../lib/Nexus/pattern/taskProgress'

const NONE = { type: 'none' as const, msg: '' }

const def: TaskDef = {
    title: 'Import',
    steps: [{ label: 'Read file' }, { label: 'Add items' }],
    onCancel: () => { },
}

beforeEach(() => {
    resetAlertPromptsForTests()
    resetTaskHostForTests()
    alertStore.set(NONE)
})

afterEach(() => {
    resetTaskHostForTests()
    resetAlertPromptsForTests()
    alertStore.set(NONE)
})

/** Whether a promise settled after a few microtask turns; the outcome is a flag so a hang fails an assertion. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false
    void promise.then(() => { done = true })
    for (let i = 0; i < 6; i++) await Promise.resolve()
    return done
}

describe('a shown task covers the page', () => {
    test('R1 pageCovered is true while a task is shown over an empty store', () => {
        expect(pageCovered()).toBe(false)
        alertTask(def)
        expect(get(alertStore).type).toBe('none')
        expect(pageCovered()).toBe(true)
    })

    test('R2 doingAlert is true while a task is shown', () => {
        expect(doingAlert()).toBe(false)
        alertTask(def)
        expect(doingAlert()).toBe(true)
    })

    test('R3 waitUnreadNotice waits for an unread task result and resolves when it is answered', async () => {
        const handle = alertTask(def)
        void handle.finish({ headline: 'Done' })
        const waiting = waitUnreadNotice()
        expect(await settled(waiting)).toBe(false)
        answerTask({ kind: 'ok' })
        expect(await settled(waiting)).toBe(true)
    })

    test('guard: R3b waitUnreadNotice pending on a task result resolves when a newer task replaces it or close clears it', async () => {
        const first = alertTask(def)
        void first.finish({ headline: 'Done' })
        const waiting = waitUnreadNotice()
        alertTask(def)
        expect(await settled(waiting)).toBe(true)

        const second = alertTask(def)
        void second.finish({ headline: 'Done' })
        const waitingAgain = waitUnreadNotice()
        second.close()
        expect(await settled(waitingAgain)).toBe(true)
    })

    test('R3c a task result under a legacy notice keeps the wait pending after the notice is read', async () => {
        const handle = alertTask(def)
        void handle.finish({ headline: 'Done' })
        alertNormal('notice')
        const waiting = waitUnreadNotice()
        alertStore.set(NONE)
        expect(await settled(waiting)).toBe(false)
        answerTask({ kind: 'ok' })
        expect(await settled(waiting)).toBe(true)
    })

    test('guard: R5 waitUnreadNotice returns at once while a task is only running', async () => {
        alertTask(def)
        expect(await settled(waitUnreadNotice())).toBe(true)
        expect(taskShown()).toBe(true)
    })
})

describe('Back and a task', () => {
    test('R4 Back cancels a task that offers Cancel, holds a locked one and dismisses a result', async () => {
        const onCancel = vi.fn()
        const handle = alertTask({ ...def, onCancel })
        closeDialogForBack()
        expect(onCancel).toHaveBeenCalledTimes(1)

        const locked = alertTask({ ...def, onCancel })
        expect(locked.lockCancel()).toBe(true)
        closeDialogForBack()
        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(taskShown()).toBe(true)

        const closed = locked.finish({ headline: 'Done' })
        closeDialogForBack()
        expect(await closed).toEqual({ kind: 'ok' })
        expect(taskShown()).toBe(false)
        expect(handle.detached).toBe(true)
    })

    test('guard: R4b a prompt held under a toast keeps Back; the task is untouched', () => {
        const onCancel = vi.fn()
        void alertConfirm('Sure?')
        alertToast('toast')
        expect(promptWaiting()).toBe(true)
        alertTask({ ...def, onCancel })
        closeDialogForBack()
        expect(onCancel).not.toHaveBeenCalled()
        expect(taskShown()).toBe(true)
        expect(promptWaiting()).toBe(true)
        expect(get(alertStore).type).toBe('toast')
    })
})
