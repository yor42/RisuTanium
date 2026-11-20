// @vitest-environment jsdom

/**
 * Run in the background through the real TaskHost, ToastHost and inert scope (`TaskToastHarness.svelte`): the press,
 * the toast that follows the task, the holds on its hide, and the reopen from the toast. The task clock and the toast
 * clock are fake; `alertStore` is a plain writable because only the inert scope reads it.
 */
import { writable } from 'svelte/store'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('../../../ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('../../../ts/stores.svelte'))
vi.mock('../../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { language } from '../../../lang'
import {
    alertTask,
    backgroundTask,
    registerDetachedModulesRound,
    resetTaskHostForTests,
    setTaskClockForTests,
    taskHostView,
    type TaskCloseAnswer,
    type TaskHandle,
} from '../../../ts/alertTask.svelte'
import { createToastHost, type ToastClock, type ToastHost } from '../../../ts/toast/toastHost.svelte'
import { holdModalLayer } from './modalLayers.svelte'
import TaskToastHarness from './TaskToastHarness.svelte'
import type { TaskClock, TaskDef } from './taskProgress'

function fakeToastClock(): ToastClock & { advance(ms: number): void } {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => { timers.delete(key) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) next = entry
                }
                if (next === null) break
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

function manualTaskClock(): { clock: TaskClock, advance(ms: number): void } {
    let now = 0
    let nextId = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        clock: {
            now: () => now,
            setTimeout: (run, ms) => {
                const id = nextId++
                timers.set(id, { at: now + ms, run })
                return id as unknown as ReturnType<typeof setTimeout>
            },
            clearTimeout: (id) => { timers.delete(id as unknown as number) },
            hidden: () => false,
        },
        advance(ms) {
            const target = now + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | undefined
                for (const entry of timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry
                if (!next) break
                timers.delete(next[0])
                now = Math.max(now, next[1].at)
                next[1].run()
            }
            now = target
        },
    }
}

const def: TaskDef = {
    title: 'Importing cards',
    steps: [{ label: 'Read file' }, { label: 'Add items', noun: 'Assets' }],
    onCancel: () => { },
    background: true,
}

let host: ToastHost
let toastClock: ReturnType<typeof fakeToastClock>
let taskClock: ReturnType<typeof manualTaskClock>
let app: Record<string, unknown>
let root: HTMLElement
let opener: HTMLButtonElement

function advance(ms: number): void {
    taskClock.advance(ms)
    toastClock.advance(ms)
    vi.advanceTimersByTime(ms)
    flushSync()
}

// Svelte's tick waits on a timer under fake timers, so each turn moves the fake clock by 1 ms.
async function settle(): Promise<void> {
    for (let turn = 0; turn < 8; turn++) {
        await Promise.resolve()
        vi.advanceTimersByTime(1)
        flushSync()
    }
}

beforeEach(() => {
    vi.useFakeTimers()
    toastClock = fakeToastClock()
    taskClock = manualTaskClock()
    setTaskClockForTests(taskClock.clock)
    host = createToastHost({ clock: toastClock })
    root = document.createElement('div')
    document.body.appendChild(root)
    app = mount(TaskToastHarness, { target: root, props: { host } }) as unknown as Record<string, unknown>
    flushSync()
    opener = root.querySelector<HTMLButtonElement>('[data-test="opener"]')!
})

afterEach(async () => {
    await unmount(app as never)
    root.remove()
    resetTaskHostForTests()
    vi.useRealTimers()
    document.body.replaceChildren()
})

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-part="pattern-dialog"]')
}

function toasts(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-part="task-toast"]')]
}

function toastPart(name: string): HTMLElement {
    const found = toasts()[0]?.querySelector<HTMLElement>(`[data-part="${name}"]`)
    if (!found) throw new Error('missing toast part ' + name)
    return found
}

/** Svelte sets `inert` as a property; jsdom keeps it as a plain property rather than an attribute. */
function isInert(element: HTMLElement): boolean {
    return (element as HTMLElement & { inert?: boolean }).inert === true
}

function inertScope(): HTMLElement {
    return opener.parentElement as HTMLElement
}

function openTask(over: Partial<TaskDef> = {}): TaskHandle {
    opener.focus()
    const handle = alertTask({ ...def, ...over })
    flushSync()
    return handle
}

async function background(): Promise<void> {
    const button = document.querySelector<HTMLButtonElement>('[data-part="pattern-task-background"]')
    expect(button).not.toBeNull()
    button!.click()
    flushSync()
    await settle()
}

describe('pressing the button', () => {
    test('the dialog leaves, the page is released, focus returns to the opener and one toast shows title and step', async () => {
        openTask()
        expect(dialog()).not.toBeNull()
        expect(isInert(inertScope())).toBe(true)
        expect(document.querySelector('[data-part="pattern-task-background"]')!.textContent?.trim()).toBe(language.patternTaskBackground)
        await background()
        expect(dialog()).toBeNull()
        expect(isInert(inertScope())).toBe(false)
        expect(document.activeElement).toBe(opener)
        expect(toasts()).toHaveLength(1)
        expect(toastPart('task-toast-title').textContent).toBe('Importing cards')
        expect(toastPart('task-toast-line').textContent).toBe('Read file')
    })

    test('it announces once politely and a later step change speaks nothing', async () => {
        const handle = openTask()
        await background()
        expect(host.polite.text).toBe(language.patternTaskBackgrounded('Importing cards'))
        const seq = host.polite.seq
        handle.setStep(1)
        advance(300)
        expect(host.polite.seq).toBe(seq)
        expect(toastPart('task-toast-line').textContent).toBe('Add items')
    })

    test('progress updates the same toast node in place without a percentage', async () => {
        const handle = openTask()
        await background()
        const node = toasts()[0]
        handle.setFile(1, 3, 'b.png')
        handle.setCount(2, 5)
        advance(300)
        expect(toasts()[0]).toBe(node)
        const text = toastPart('task-toast-line').textContent!
        expect(text).toContain(language.patternTaskFileOf(2, 3))
        expect(text).toContain(language.patternTaskCount('', 2, 5))
        expect(text).not.toContain('%')
    })

    test('a task without background offers no button', () => {
        openTask({ background: undefined })
        expect(document.querySelector('[data-part="pattern-task-background"]')).toBeNull()
    })

    test('no card offers the button while a replaced Modules round is registered, and it returns when that round ends', () => {
        const unregister = registerDetachedModulesRound()
        openTask()
        expect(document.querySelector('[data-part="pattern-task-background"]')).toBeNull()
        expect(backgroundTask()).toBe(false)
        unregister()
        flushSync()
        expect(document.querySelector('[data-part="pattern-task-background"]')).not.toBeNull()
    })
})

describe('the end of a backgrounded task', () => {
    test('a clean finish becomes View result, hides at 6000 ms and resolves dismissed', async () => {
        const handle = openTask()
        await background()
        const closed = handle.finish({ headline: 'Imported 2 items' })
        flushSync()
        expect(toastPart('task-toast-title').textContent).toBe('Imported 2 items')
        expect(toastPart('task-toast-open').textContent).toBe(language.patternTaskToastResult)
        expect(toastPart('task-toast-dismiss')).not.toBeNull()
        advance(5999)
        expect(toasts()).toHaveLength(1)
        advance(1)
        expect(toasts()).toHaveLength(0)
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'dismissed' })
    })

    test('an open modal layer holds the hide; hover and focus inside the stack hold it too', async () => {
        const handle = openTask()
        await background()
        void handle.finish({ headline: 'Imported' })
        flushSync()
        advance(1000)
        const release = holdModalLayer()
        flushSync()
        advance(4000)
        release()
        flushSync()
        advance(999)
        expect(toasts()).toHaveLength(1)
        advance(4001)
        expect(toasts()).toHaveLength(0)

        const second = openTask()
        await background()
        void second.finish({ headline: 'Again' })
        flushSync()
        const toast = toasts()[0]
        toast.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
        flushSync()
        advance(10_000)
        expect(toasts()).toHaveLength(1)
        toast.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
        flushSync()
        advance(6000)
        expect(toasts()).toHaveLength(0)

        const third = openTask()
        await background()
        void third.finish({ headline: 'Focused' })
        flushSync()
        toastPart('task-toast-open').focus()
        flushSync()
        advance(10_000)
        expect(toasts()).toHaveLength(1)
    })

    test('skips stay with the badge and speak the skipped count; a failure speaks assertively', async () => {
        const handle = openTask()
        await background()
        void handle.finish({ headline: 'Imported 1', skipped: [{ name: 'a', reason: 'x' }] })
        flushSync()
        advance(60_000)
        expect(toasts()).toHaveLength(1)
        expect(toasts()[0].hasAttribute('data-stays')).toBe(true)
        expect(toasts()[0].querySelector('[data-part="task-toast-badge"]')).not.toBeNull()
        expect(host.polite.text).toBe(`Imported 1. ${language.patternTaskSkippedTitle(1)}`)

        const failing = openTask()
        await background()
        void failing.fail({ headline: 'Import failed', dataState: 'same' })
        flushSync()
        expect(host.assertive.text).toBe('Import failed')
    })
})

describe('Open on the toast', () => {
    test('a terminal result reopens the same card with focus on its headline and no toast left', async () => {
        const handle = openTask()
        await background()
        void handle.finish({ headline: 'Imported', actions: [{ id: 'retry', label: 'Retry' }] })
        flushSync()
        opener.focus()
        const open = toastPart('task-toast-open')
        open.focus()
        open.click()
        flushSync()
        await settle()
        expect(dialog()).not.toBeNull()
        expect(toasts()).toHaveLength(0)
        expect(document.activeElement).toBe(document.querySelector('[data-part="pattern-task-result-headline"]'))
        expect(document.querySelector('[data-part="pattern-task-result-action"]')!.textContent).toBe('Retry')
    })

    test('a running task reopens as the same card with focus on the shell and returns focus to the opener after OK', async () => {
        const handle = openTask()
        const id = taskHostView()!.id
        await background()
        toastPart('task-toast-open').click()
        flushSync()
        await settle()
        expect(taskHostView()?.id).toBe(id)
        expect(document.querySelector('[data-part="pattern-task-root"]')!.getAttribute('data-task-state')).toBe('running')
        expect(document.activeElement).toBe(dialog())
        const closed = handle.finish({ headline: 'Imported' })
        flushSync()
        await settle()
        advance(300)
        document.querySelector<HTMLButtonElement>('[data-part="pattern-task-result-ok"]')!.click()
        flushSync()
        await settle()
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'ok' })
        expect(document.activeElement).toBe(opener)
    })

    test('a modal layer disables Open and a click mounts nothing', async () => {
        openTask()
        await background()
        const release = holdModalLayer()
        flushSync()
        const open = toastPart('task-toast-open')
        expect(open.getAttribute('aria-disabled')).toBe('true')
        open.click()
        flushSync()
        expect(dialog()).toBeNull()
        release()
    })

    test('a reopened running card ignores Cancel and the background button for one arm delay, then answers', async () => {
        const onCancel = vi.fn()
        openTask({ onCancel })
        await background()
        toastPart('task-toast-open').click()
        flushSync()
        await settle()
        const cancel = document.querySelector<HTMLElement>('[data-part="pattern-task-cancel"]')!
        const again = document.querySelector<HTMLElement>('[data-part="pattern-task-background"]')!
        const stamp = (button: HTMLElement, at: number) => {
            const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
            Object.defineProperty(tap, 'timeStamp', { value: at })
            button.dispatchEvent(tap)
        }
        const early = performance.now()
        stamp(cancel, early)
        stamp(again, early)
        flushSync()
        expect(onCancel).not.toHaveBeenCalled()
        expect(dialog()).not.toBeNull()
        vi.advanceTimersByTime(300)
        stamp(again, performance.now())
        flushSync()
        await settle()
        expect(dialog()).toBeNull()
        expect(toasts()).toHaveLength(1)
    })

    test('a reopened result card ignores OK for one arm delay', async () => {
        const handle = openTask()
        await background()
        const closed = handle.finish({ headline: 'Imported' })
        flushSync()
        toastPart('task-toast-open').click()
        flushSync()
        await settle()
        const ok = document.querySelector<HTMLElement>('[data-part="pattern-task-result-ok"]')!
        const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
        Object.defineProperty(tap, 'timeStamp', { value: performance.now() })
        ok.dispatchEvent(tap)
        flushSync()
        expect(dialog()).not.toBeNull()
        vi.advanceTimersByTime(300)
        ok.click()
        flushSync()
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'ok' })
    })
})

describe('a task opened while another runs in the background', () => {
    test('both run: the second shows its card, replacing it ends only that card, the first keeps its toast', async () => {
        const a = openTask({ title: 'A' })
        await background()
        const closedA = a.finish({ headline: 'A done' })
        const b = openTask({ title: 'B' })
        expect(dialog()).not.toBeNull()
        expect(toasts()).toHaveLength(1)
        const closedB = b.finish({ headline: 'B done' })
        const c = openTask({ title: 'C' })
        expect(await closedB).toEqual<TaskCloseAnswer>({ kind: 'replaced' })
        expect(c.detached).toBe(false)
        expect(toasts()).toHaveLength(1)
        expect(toastPart('task-toast-title').textContent).toBe('A done')
        let settledA = false
        void closedA.then(() => { settledA = true })
        await settle()
        expect(settledA).toBe(false)
    })
})
