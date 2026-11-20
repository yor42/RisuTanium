// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import PatternTask from './PatternTask.svelte'
import { createTaskController, type TaskClock, type TaskConfirm, type TaskController, type TaskView } from './taskProgress'

const steps = [{ label: 'Read file' }, { label: 'Add items' }]
const confirm: TaskConfirm = {
    headline: 'Import 2 files',
    consequences: ['3.0 MiB in total', 'Each file is added in turn'],
    cancelLabel: 'Cancel',
    primaryLabel: 'Import',
}

interface Harness {
    controller: TaskController
    target: HTMLElement
    onconfirm: ReturnType<typeof vi.fn>
    ondecline: ReturnType<typeof vi.fn>
    oncancel: ReturnType<typeof vi.fn>
}

const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const clock: TaskClock = {
    now: () => performance.now(),
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => { },
    hidden: () => false,
}

function open(): Harness {
    const controller = createTaskController({ title: 'Import', steps, onCancel: () => { }, confirm }, clock)
    const onconfirm = vi.fn()
    const ondecline = vi.fn()
    const oncancel = vi.fn(() => { controller.requestCancel() })
    const props = $state({ view: controller.view as TaskView, lowPower: false, oncancel, onanswer: () => { }, onconfirm, ondecline })
    controller.subscribe((view) => { props.view = view })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PatternTask, { target, props })
    mounted.push({ target, app })
    flushSync()
    return { controller, target, onconfirm, ondecline, oncancel }
}

function part(target: HTMLElement, name: string): HTMLElement | null {
    return target.querySelector<HTMLElement>(`[data-part="${name}"]`)
}

/** A click whose own event time is `stamp`, whatever the clock says when its handler runs. */
function tapStamped(button: HTMLElement, stamp: number): void {
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: stamp })
    button.dispatchEvent(tap)
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
}

function stubArmDelay(value: string): void {
    const real = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const style = real(element, pseudo)
        vi.spyOn(style, 'getPropertyValue').mockImplementation((name) => (name === '--warning-arm-delay' ? value : ''))
        return style
    })
}

async function settleFocus(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app)
        target.remove()
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('the confirm sheet of the task card', () => {
    // R3-9
    test('is an alertdialog labelled by the headline, described by the consequences, with Cancel focused first', () => {
        const h = open()
        const dialog = part(h.target, 'pattern-dialog')!
        expect(h.controller.view.state).toBe('confirm')
        expect(dialog.getAttribute('role')).toBe('alertdialog')
        const headline = part(h.target, 'pattern-warn-headline')!
        expect(dialog.getAttribute('aria-labelledby')).toBe(headline.id)
        expect(headline.textContent).toBe('Import 2 files')
        const list = part(h.target, 'pattern-warn-consequences')!
        expect(dialog.getAttribute('aria-describedby')).toBe(list.id)
        expect(document.activeElement).toBe(part(h.target, 'pattern-warn-cancel'))
        expect(h.target.querySelector('[role="progressbar"]')).toBeNull()
        const status = part(h.target, 'pattern-task-status')!
        expect(status.getAttribute('role')).toBe('status')
        expect(status.textContent).toBe('')
        expect(part(h.target, 'pattern-task-root')!.getAttribute('data-task-state')).toBe('confirm')
        expect(part(h.target, 'pattern-warn-root')!.getAttribute('data-pattern-severity')).toBe('confirm')
        expect(part(h.target, 'pattern-warn-primary')!.textContent).toBe('Import')
        expect(part(h.target, 'pattern-warn-cancel')!.textContent).toBe('Cancel')
    })

    // R3-10
    test('the primary ignores input for the arm delay and accepts it after', () => {
        const h = open()
        const primary = part(h.target, 'pattern-warn-primary')!
        primary.click()
        vi.advanceTimersByTime(200)
        primary.click()
        expect(h.onconfirm).not.toHaveBeenCalled()
        vi.advanceTimersByTime(60)
        primary.click()
        expect(h.onconfirm).toHaveBeenCalledTimes(1)
        primary.click()
        expect(h.onconfirm).toHaveBeenCalledTimes(1)
    })

    test('a tap stamped before the arm time stays ignored when dispatched after the timer fired', () => {
        const before = performance.now()
        const h = open()
        const after = performance.now()
        vi.advanceTimersByTime(300)
        const primary = part(h.target, 'pattern-warn-primary')!
        tapStamped(primary, before + 10)
        expect(h.onconfirm).not.toHaveBeenCalled()
        tapStamped(primary, after + 250)
        expect(h.onconfirm).toHaveBeenCalledTimes(1)
    })

    test('the arm delay is read from the computed style', () => {
        stubArmDelay('600ms')
        const h = open()
        const primary = part(h.target, 'pattern-warn-primary')!
        vi.advanceTimersByTime(500)
        primary.click()
        expect(h.onconfirm).not.toHaveBeenCalled()
        vi.advanceTimersByTime(100)
        primary.click()
        expect(h.onconfirm).toHaveBeenCalledTimes(1)
    })

    test('a repeated keydown on the primary is default-prevented, a first one is not', () => {
        const h = open()
        const primary = part(h.target, 'pattern-warn-primary')!
        const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
        primary.dispatchEvent(repeat)
        expect(repeat.defaultPrevented).toBe(true)
        const first = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        primary.dispatchEvent(first)
        expect(first.defaultPrevented).toBe(false)
    })

    // R3-12
    test('Escape declines once and never calls oncancel; the Cancel button declines', () => {
        const h = open()
        const event = press('Escape')
        expect(event.defaultPrevented).toBe(true)
        expect(h.ondecline).toHaveBeenCalledTimes(1)
        expect(h.oncancel).not.toHaveBeenCalled()
        ;(part(h.target, 'pattern-warn-cancel') as HTMLButtonElement).click()
        expect(h.ondecline).toHaveBeenCalledTimes(2)
        expect(h.oncancel).not.toHaveBeenCalled()
    })

    // R3-11
    test('confirming turns the same dialog into the running card: dialog role, swap marker, shell focus, task Cancel', async () => {
        const h = open()
        const dialog = part(h.target, 'pattern-dialog')!
        expect(h.controller.confirm()).toBe(true)
        flushSync()
        await settleFocus()
        expect(part(h.target, 'pattern-dialog')).toBe(dialog)
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(part(h.target, 'pattern-task-root')!.getAttribute('data-swap')).toBe('in')
        expect(part(h.target, 'pattern-warn-root')).toBeNull()
        expect(dialog.getAttribute('aria-labelledby')).toBe(part(h.target, 'pattern-task-title')!.id)
        expect(document.activeElement).toBe(dialog)
        expect(part(h.target, 'pattern-task-cancel')).not.toBeNull()
    })

    test('a card that never showed a confirm carries no swap marker', () => {
        const controller = createTaskController({ title: 'Import', steps, onCancel: () => { } }, clock)
        const props = $state({ view: controller.view as TaskView, lowPower: false, oncancel: () => { }, onanswer: () => { } })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ target, app: mount(PatternTask, { target, props }) })
        flushSync()
        expect(part(target, 'pattern-task-root')!.hasAttribute('data-swap')).toBe(false)
    })

    // G1-E3
    test('right after confirm the running card Cancel ignores input for one arm delay', async () => {
        const h = open()
        vi.advanceTimersByTime(300)
        h.controller.confirm()
        flushSync()
        await settleFocus()
        const cancel = part(h.target, 'pattern-task-cancel')!
        vi.advanceTimersByTime(100)
        cancel.click()
        expect(h.oncancel).not.toHaveBeenCalled()
        vi.advanceTimersByTime(200)
        cancel.click()
        expect(h.oncancel).toHaveBeenCalledTimes(1)
    })

    test('a card without a confirm accepts its Cancel press at once', () => {
        const controller = createTaskController({ title: 'Import', steps, onCancel: () => { } }, clock)
        const oncancel = vi.fn()
        const props = $state({ view: controller.view as TaskView, lowPower: false, oncancel, onanswer: () => { } })
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push({ target, app: mount(PatternTask, { target, props }) })
        flushSync()
        part(target, 'pattern-task-cancel')!.click()
        expect(oncancel).toHaveBeenCalledTimes(1)
    })
})
