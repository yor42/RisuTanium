// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import TaskHost from '../lib/Nexus/pattern/TaskHost.svelte'
import {
    alertTask,
    confirmTask,
    declineTask,
    requestTaskCancel,
    resetTaskHostForTests,
    setTaskClockForTests,
    taskBackPress,
    taskConfirmShowing,
    taskHostView,
    taskResultShowing,
    taskShown,
    type TaskHandle,
} from './alertTask.svelte'
import type { TaskClock, TaskConfirm, TaskDef } from '../lib/Nexus/pattern/taskProgress'

const confirm: TaskConfirm = { headline: 'Import 2 files', consequences: ['3.0 MiB in total'], cancelLabel: 'Cancel', primaryLabel: 'Import' }
const def = (over: Record<string, unknown> = {}): TaskDef => ({
    title: 'Import',
    steps: [{ label: 'Read file' }, { label: 'Add items' }],
    onCancel: () => { },
    confirm,
    ...over,
} as TaskDef)

async function settledValue<T>(promise: Promise<T>): Promise<{ done: boolean, value?: T }> {
    let result: { done: boolean, value?: T } = { done: false }
    void promise.then((value) => { result = { done: true, value } })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return result
}

const confirmationOf = (handle: TaskHandle) => handle.confirmation

beforeEach(() => {
    const clock: TaskClock = {
        now: () => 0,
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => { },
        hidden: () => false,
    }
    setTaskClockForTests(clock)
})

const hosts: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountHost(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    hosts.push({ target, app: mount(TaskHost, { target, props: {} }) })
    return target
}

afterEach(async () => {
    for (const { target, app } of hosts.splice(0)) {
        await unmount(app)
        target.remove()
    }
    vi.useRealTimers()
    resetTaskHostForTests()
    document.body.replaceChildren()
})

describe('the task host over a confirm', () => {
    // M3-13: a new dialog on the swap would drop focus and replay the entry motion.
    test('the primary confirms and the same dialog element becomes the running card; Cancel declines', async () => {
        vi.useFakeTimers()
        const host = mountHost()
        const handle = alertTask(def())
        flushSync()
        const dialog = host.querySelector('[data-part="pattern-dialog"]')!
        expect(dialog.getAttribute('role')).toBe('alertdialog')
        vi.advanceTimersByTime(300)
        host.querySelector<HTMLElement>('[data-part="pattern-warn-primary"]')!.click()
        flushSync()
        expect(taskHostView()?.state).toBe('running')
        expect(host.querySelector('[data-part="pattern-dialog"]')).toBe(dialog)
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(await confirmationOf(handle)).toBe('confirm')

        resetTaskHostForTests()
        setTaskClockForTests(null)
        const second = alertTask(def())
        flushSync()
        host.querySelector<HTMLElement>('[data-part="pattern-warn-cancel"]')!.click()
        flushSync()
        expect(taskShown()).toBe(false)
        expect(await confirmationOf(second)).toBe('declined')
    })
})

describe('the confirmation of a task card', () => {
    // R3-4
    test('a confirm def shows the confirm state; confirmTask settles confirm and keeps the view id', async () => {
        const handle = alertTask(def())
        const view = taskHostView()
        expect(view?.state).toBe('confirm')
        const id = view?.id
        expect(taskConfirmShowing()).toBe(true)
        confirmTask()
        expect(taskHostView()?.state).toBe('running')
        expect(taskHostView()?.id).toBe(id)
        expect(taskConfirmShowing()).toBe(false)
        expect(await confirmationOf(handle)).toBe('confirm')
    })

    // R3-5
    test('declineTask empties the slot and settles declined; a task Cancel press in confirm does nothing', async () => {
        const handle = alertTask(def())
        requestTaskCancel()
        expect(taskHostView()?.state).toBe('confirm')
        declineTask()
        expect(taskShown()).toBe(false)
        expect(taskResultShowing()).toBe(false)
        expect(await confirmationOf(handle)).toBe('declined')
        expect(await handle.finish({ headline: 'x' })).toEqual({ kind: 'closed' })
    })

    // R3-6
    test('a newer task replaces a shown confirm: replaced, and the older lockCancel never passes', async () => {
        const older = alertTask(def())
        const newer = alertTask(def({ confirm: undefined }))
        expect(await confirmationOf(older)).toBe('replaced')
        expect(older.lockCancel()).toBe(false)
        expect(await confirmationOf(newer)).toBe('confirm')
    })

    // R3-6 second part (compatibility guard, passes before and after)
    test('a handle replaced while running still passes lockCancel (a replaced import still writes)', () => {
        const older = alertTask(def({ confirm: undefined }))
        alertTask(def({ confirm: undefined }))
        expect(older.detached).toBe(true)
        expect(older.lockCancel()).toBe(true)
    })

    test('a handle confirmed and then replaced passes lockCancel', () => {
        const older = alertTask(def())
        confirmTask()
        alertTask(def({ confirm: undefined }))
        expect(older.lockCancel()).toBe(true)
    })

    // R3-7
    test('Back in confirm declines and is consumed', async () => {
        const handle = alertTask(def())
        expect(taskBackPress()).toBe(true)
        expect(taskShown()).toBe(false)
        expect(await confirmationOf(handle)).toBe('declined')
    })

    // R3-8 (compatibility guard: the field is absent before the change)
    test('a def without confirm resolves confirm at once and runs', async () => {
        const handle = alertTask(def({ confirm: undefined }))
        expect(taskHostView()?.state).toBe('running')
        expect(await confirmationOf(handle)).toBe('confirm')
    })

    // G1-E2: the closed answer
    test('handle.close in confirm settles closed and the test reset settles closed', async () => {
        const first = alertTask(def())
        first.close()
        expect(await confirmationOf(first)).toBe('closed')
        const second = alertTask(def())
        resetTaskHostForTests()
        expect(await confirmationOf(second)).toBe('closed')
    })

    test('confirmation stays pending until an answer and settles once', async () => {
        const handle = alertTask(def())
        expect((await settledValue(confirmationOf(handle))).done).toBe(false)
        confirmTask()
        declineTask()
        expect(await confirmationOf(handle)).toBe('confirm')
    })
})
