// @vitest-environment jsdom

/**
 * The task group of the toast view: the labelled region, the two shown entries and "+N", Open and Dismiss, the
 * still marks, the holds and the focus return around owner removal. The host is a real `createToastHost` on a fake
 * clock; the harness is the one of `ToastHost.svelte.test.ts`.
 */
import { flushSync } from 'svelte'
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))
vi.mock('../../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { language } from '../../../lang'
import type { TaskToastContent, TaskToastInit } from '../../../ts/toast/toastHost.svelte'
import { holdModalLayer } from './modalLayers.svelte'
import { clock, focusFrom, host, installToastHarness, mouse, origin, part, settle, show, toastElements } from './ToastHost.scenarios.test-helpers.svelte'

installToastHarness()

function content(over: Partial<TaskToastContent> = {}): TaskToastContent {
    return { title: 'Import', line: 'File 1 of 2: a.png', mark: 'transfer_in', fraction: 0.25, determinate: true, badge: false, phase: 'running', openLabel: 'Open', ...over }
}

function init(over: Partial<TaskToastInit> = {}): TaskToastInit {
    return { ...content(), onOpen: () => { }, onEnd: () => { }, ...over }
}

function taskToasts(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[data-part="task-toast"]')]
}

function region(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-part="task-toasts"]')
}

describe('task group: structure', () => {
    test('with no task posted there is no task node and the plain toast DOM is unchanged', () => {
        show()
        host.post({ text: 'plain' })
        flushSync()
        expect(region()).toBeNull()
        expect(document.querySelector('[data-part^="task-toast"]')).toBeNull()
        expect(toastElements()).toHaveLength(1)
    })

    test('the region is labelled; each toast is a group labelled by its title with hidden line and bar', () => {
        show()
        host.postTask(init({ title: 'Importing cards', line: 'File 1 of 2: a.png' }))
        flushSync()
        const group = region()!
        expect(group.getAttribute('role')).toBe('region')
        expect(group.getAttribute('aria-label')).toBe(language.patternTaskToastsLabel)
        const [toast] = taskToasts()
        expect(toast.getAttribute('role')).toBe('group')
        expect(toast.getAttribute('aria-label')).toBe('Importing cards')
        expect(toast.getAttribute('data-task-phase')).toBe('running')
        expect(part(toast, 'task-toast-title').textContent).toBe('Importing cards')
        expect(part(toast, 'task-toast-line').textContent).toBe('File 1 of 2: a.png')
        expect(part(toast, 'task-toast-line').getAttribute('aria-hidden')).toBe('true')
        expect(part(toast, 'task-toast-bar').getAttribute('aria-hidden')).toBe('true')
        expect(part(toast, 'task-toast-bar').getAttribute('style')).toContain('--p-fill')
        expect(part(toast, 'task-toast-open').textContent).toBe('Open')
        expect(toast.querySelector('[data-part="task-toast-dismiss"]')).toBeNull()
    })

    test('an update changes the text in place on the same node', () => {
        show()
        const id = host.postTask(init())
        flushSync()
        const [before] = taskToasts()
        host.updateTask(id, content({ line: 'File 2 of 2: b.png' }))
        flushSync()
        const [after] = taskToasts()
        expect(after).toBe(before)
        expect(part(after, 'task-toast-line').textContent).toBe('File 2 of 2: b.png')
    })

    test('only the newest mark moves; the others carry data-still', () => {
        show()
        host.postTask(init({ title: 'A' }))
        host.postTask(init({ title: 'B' }))
        flushSync()
        const stills = taskToasts().map((toast) => toast.querySelector('.nexus-mark')!.hasAttribute('data-still'))
        expect(stills).toEqual([true, false])
    })

    test('the warning badge shows only when badge is set; Dismiss shows when the phase is not running', () => {
        show()
        const id = host.postTask(init())
        flushSync()
        expect(document.querySelector('[data-part="task-toast-badge"]')).toBeNull()
        host.updateTask(id, content({ phase: 'stays', badge: true, openLabel: 'View result' }))
        flushSync()
        const [toast] = taskToasts()
        expect(toast.hasAttribute('data-stays')).toBe(true)
        expect(toast.querySelector('[data-part="task-toast-badge"]')).not.toBeNull()
        expect(part(toast, 'task-toast-dismiss').getAttribute('aria-label')).toBe(language.uiCommon.close)
        expect(part(toast, 'task-toast-open').textContent).toBe('View result')
    })

    test('3 tasks show the last 2 and a +N button that swaps its text, label and aria-expanded', () => {
        show()
        host.postTask(init({ title: 'A' }))
        host.postTask(init({ title: 'B' }))
        host.postTask(init({ title: 'C' }))
        flushSync()
        expect(taskToasts().map((toast) => toast.getAttribute('aria-label'))).toEqual(['B', 'C'])
        const more = region()!.querySelector<HTMLButtonElement>('[data-part="task-toast-more"]')!
        expect(more.textContent!.trim()).toBe(language.patternTaskToastMore(1))
        expect(more.getAttribute('aria-label')).toBe(language.patternTaskToastMoreLabel(1))
        expect(more.getAttribute('aria-expanded')).toBe('false')
        more.click()
        flushSync()
        expect(taskToasts().map((toast) => toast.getAttribute('aria-label'))).toEqual(['A', 'B', 'C'])
        const less = region()!.querySelector<HTMLButtonElement>('[data-part="task-toast-more"]')!
        expect(less.textContent!.trim()).toBe(language.patternTaskShowLess)
        expect(less.getAttribute('aria-label')).toBe(language.patternTaskShowLess)
        expect(less.getAttribute('aria-expanded')).toBe('true')
    })
})

describe('task group: Open and Dismiss', () => {
    test('Open calls onOpen; Dismiss ends the action with dismissed', () => {
        show()
        const onOpen = vi.fn()
        const onEnd = vi.fn()
        const id = host.postTask(init({ onOpen, onEnd }))
        flushSync()
        part(taskToasts()[0], 'task-toast-open').click()
        expect(onOpen).toHaveBeenCalledTimes(1)
        host.updateTask(id, content({ phase: 'stays' }))
        flushSync()
        part<HTMLButtonElement>(taskToasts()[0], 'task-toast-dismiss').click()
        flushSync()
        expect(onEnd).toHaveBeenCalledWith('dismissed')
        expect(taskToasts()).toHaveLength(0)
    })

    test('Open is aria-disabled and does nothing while a modal layer is open', () => {
        show()
        const onOpen = vi.fn()
        host.postTask(init({ onOpen }))
        flushSync()
        const open = part<HTMLButtonElement>(taskToasts()[0], 'task-toast-open')
        expect(open.getAttribute('aria-disabled')).toBeNull()
        const release = holdModalLayer()
        flushSync()
        expect(open.getAttribute('aria-disabled')).toBe('true')
        open.click()
        expect(onOpen).not.toHaveBeenCalled()
        release()
        flushSync()
        expect(open.getAttribute('aria-disabled')).toBeNull()
        open.click()
        expect(onOpen).toHaveBeenCalledTimes(1)
    })
})

describe('task group: holds', () => {
    test('a mouse hover and a focus inside the stack hold the clean-finish clock', async () => {
        show()
        const id = host.postTask(init())
        host.updateTask(id, content({ phase: 'done', openLabel: 'View result' }))
        flushSync()
        const [toast] = taskToasts()
        mouse('pointerenter', toast, 'mouse')
        expect(host.holds().hover).toBe(true)
        clock.advance(60_000)
        expect(host.tasks).toHaveLength(1)
        mouse('pointerleave', toast, 'mouse')
        expect(host.holds().hover).toBe(false)
        focusFrom(origin, part<HTMLButtonElement>(toast, 'task-toast-open'))
        expect(host.holds().focus).toBe(true)
        clock.advance(60_000)
        expect(host.tasks).toHaveLength(1)
        origin.focus()
        await settle()
        expect(host.holds().focus).toBe(false)
        clock.advance(6000)
        flushSync()
        expect(host.tasks).toHaveLength(0)
    })
})

describe('task group: focus return', () => {
    test('F4 (i) dismissing a focused stays toast returns focus to where it entered the stack from', async () => {
        show()
        const id = host.postTask(init({ phase: 'stays' }))
        flushSync()
        const dismiss = part<HTMLButtonElement>(taskToasts()[0], 'task-toast-dismiss')
        focusFrom(origin, dismiss)
        dismiss.click()
        await settle()
        expect(taskToasts()).toHaveLength(0)
        expect(id).toBeGreaterThan(0)
        expect(document.activeElement).toBe(origin)
    })

    test('F4 (iii) an owner removal with returnFocus false does not refocus the origin', async () => {
        show()
        const id = host.postTask(init())
        flushSync()
        const open = part<HTMLButtonElement>(taskToasts()[0], 'task-toast-open')
        focusFrom(origin, open)
        host.endTask(id, { returnFocus: false })
        await settle()
        expect(taskToasts()).toHaveLength(0)
        expect(document.activeElement).not.toBe(origin)
    })

    test('F4 (iii) an owner removal with the default option returns focus to the origin', async () => {
        show()
        const id = host.postTask(init())
        flushSync()
        focusFrom(origin, part<HTMLButtonElement>(taskToasts()[0], 'task-toast-open'))
        host.endTask(id)
        await settle()
        expect(document.activeElement).toBe(origin)
    })

    test('F4 (ii) a skip set while focus was elsewhere never outlives its publish', async () => {
        show()
        const id = host.postTask(init())
        flushSync()
        host.endTask(id, { returnFocus: false })
        await settle()
        host.post({ text: 'plain' })
        flushSync()
        const dismiss = part<HTMLButtonElement>(toastElements()[0], 'toast-dismiss')
        focusFrom(origin, dismiss)
        dismiss.click()
        await settle()
        expect(document.activeElement).toBe(origin)
    })

    test('F4 an unknown-id endTask latches no skip', async () => {
        show()
        host.post({ text: 'plain' })
        flushSync()
        const dismiss = part<HTMLButtonElement>(toastElements()[0], 'toast-dismiss')
        focusFrom(origin, dismiss)
        host.endTask(999, { returnFocus: false })
        dismiss.click()
        await settle()
        expect(document.activeElement).toBe(origin)
    })
})
