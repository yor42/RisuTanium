// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from '../../../lang'
import PatternTask from './PatternTask.svelte'
import { createTaskController, type TaskClock, type TaskView } from './taskProgress'

const steps = [{ label: 'Read file' }, { label: 'Add items' }]

const clock: TaskClock = {
    now: () => performance.now(),
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => { },
    hidden: () => false,
}

const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function runningView(over: Partial<TaskView> = {}): TaskView {
    return { id: 1, title: 'Import', steps, stepIndex: 0, state: 'running', cancelOffered: true, cancelled: false, fraction: 0, slow: false, background: true, ...over }
}

interface Mounted {
    target: HTMLElement
    props: { view: TaskView, lowPower: boolean, oncancel: () => void, onanswer: (a: { kind: 'ok' } | { kind: 'action', id: string }) => void, onbackground: () => void, armOnMount?: boolean, backgroundOffered?: boolean }
}

function mountCard(view: TaskView, extra: { armOnMount?: boolean, backgroundOffered?: boolean } = {}): Mounted & { oncancel: ReturnType<typeof vi.fn>, onanswer: ReturnType<typeof vi.fn>, onbackground: ReturnType<typeof vi.fn> } {
    const oncancel = vi.fn()
    const onanswer = vi.fn()
    const onbackground = vi.fn()
    const props = $state({ view, lowPower: false, oncancel, onanswer, onbackground, ...extra })
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push({ target, app: mount(PatternTask, { target, props }) })
    flushSync()
    return { target, props, oncancel, onanswer, onbackground }
}

function part(target: HTMLElement, name: string): HTMLElement | null {
    return target.querySelector<HTMLElement>(`[data-part="${name}"]`)
}

function tapStamped(button: HTMLElement, stamp: number): void {
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    Object.defineProperty(tap, 'timeStamp', { value: stamp })
    button.dispatchEvent(tap)
}

async function settleFocus(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()
}

function accessibleName(element: HTMLElement): string {
    return element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''
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

describe('the background button', () => {
    test('a running view with background renders it with the label and calls onbackground once per click', () => {
        const h = mountCard(runningView())
        const button = part(h.target, 'pattern-task-background')!
        expect(button).not.toBeNull()
        expect(button.tagName).toBe('BUTTON')
        expect(button.textContent?.trim()).toBe(language.patternTaskBackground)
        expect(button.getAttribute('data-variant')).toBe('secondary')
        button.click()
        expect(h.onbackground).toHaveBeenCalledTimes(1)
    })

    test('it sits in the actions row beside Cancel', () => {
        const h = mountCard(runningView())
        const actions = part(h.target, 'pattern-task-actions')!
        expect(actions.contains(part(h.target, 'pattern-task-cancel'))).toBe(true)
        expect(actions.contains(part(h.target, 'pattern-task-background'))).toBe(true)
    })

    test('it is absent without background, in cancelling, in a result and when the slot does not offer it', () => {
        expect(part(mountCard(runningView({ background: undefined })).target, 'pattern-task-background')).toBeNull()
        expect(part(mountCard(runningView({ state: 'cancelling', cancelOffered: false })).target, 'pattern-task-background')).toBeNull()
        expect(part(mountCard(runningView({ state: 'done', fraction: 1, result: { headline: 'Done' } })).target, 'pattern-task-background')).toBeNull()
        expect(part(mountCard(runningView(), { backgroundOffered: false }).target, 'pattern-task-background')).toBeNull()
    })

    test('it is absent in the preflight sheet and appears once confirmed', async () => {
        const controller = createTaskController({
            title: 'Import',
            steps,
            onCancel: () => { },
            background: true,
            confirm: { headline: 'Import 2 files', cancelLabel: 'Cancel', primaryLabel: 'Import' },
        }, clock)
        const h = mountCard(controller.view)
        expect(part(h.target, 'pattern-task-background')).toBeNull()
        vi.advanceTimersByTime(300)
        controller.confirm()
        h.props.view = controller.view
        flushSync()
        await settleFocus()
        expect(part(h.target, 'pattern-task-background')).not.toBeNull()
    })

    test('right after the confirm swap it ignores input for one arm delay', async () => {
        const controller = createTaskController({
            title: 'Import',
            steps,
            onCancel: () => { },
            background: true,
            confirm: { headline: 'Import 2 files', cancelLabel: 'Cancel', primaryLabel: 'Import' },
        }, clock)
        const h = mountCard(controller.view)
        vi.advanceTimersByTime(300)
        controller.confirm()
        h.props.view = controller.view
        flushSync()
        await settleFocus()
        const button = part(h.target, 'pattern-task-background')!
        vi.advanceTimersByTime(100)
        button.click()
        expect(h.onbackground).not.toHaveBeenCalled()
        vi.advanceTimersByTime(200)
        button.click()
        expect(h.onbackground).toHaveBeenCalledTimes(1)
    })

    test('a first mount without a preflight accepts it at once', () => {
        const h = mountCard(runningView())
        part(h.target, 'pattern-task-background')!.click()
        expect(h.onbackground).toHaveBeenCalledTimes(1)
    })
})

describe('a reopened card is armed afresh', () => {
    test('the background button and the task Cancel ignore a tap at 0 ms and answer after the arm delay', () => {
        const before = performance.now()
        const h = mountCard(runningView(), { armOnMount: true })
        const background = part(h.target, 'pattern-task-background')!
        const cancel = part(h.target, 'pattern-task-cancel')!
        tapStamped(background, before)
        tapStamped(cancel, before)
        expect(h.onbackground).not.toHaveBeenCalled()
        expect(h.oncancel).not.toHaveBeenCalled()
        vi.advanceTimersByTime(300)
        const after = performance.now()
        tapStamped(background, after)
        tapStamped(cancel, after)
        expect(h.onbackground).toHaveBeenCalledTimes(1)
        expect(h.oncancel).toHaveBeenCalledTimes(1)
    })

    test('a tap stamped before the arm time stays ignored after the timer fired', () => {
        const before = performance.now()
        const h = mountCard(runningView(), { armOnMount: true })
        vi.advanceTimersByTime(300)
        tapStamped(part(h.target, 'pattern-task-background')!, before + 10)
        expect(h.onbackground).not.toHaveBeenCalled()
        tapStamped(part(h.target, 'pattern-task-background')!, performance.now() + 250)
        expect(h.onbackground).toHaveBeenCalledTimes(1)
    })

    test('a reopened result card guards OK and its action buttons the same way', () => {
        const view = runningView({ state: 'failed', cancelOffered: false, failure: { headline: 'Failed', dataState: 'same', actions: [{ id: 'retry', label: 'Retry' }] } })
        const before = performance.now()
        const h = mountCard(view, { armOnMount: true })
        const ok = part(h.target, 'pattern-task-result-ok')!
        const retry = part(h.target, 'pattern-task-result-action')!
        tapStamped(ok, before)
        tapStamped(retry, before)
        expect(h.onanswer).not.toHaveBeenCalled()
        vi.advanceTimersByTime(300)
        const after = performance.now()
        tapStamped(retry, after)
        expect(h.onanswer).toHaveBeenCalledWith({ kind: 'action', id: 'retry' })
        tapStamped(ok, after)
        expect(h.onanswer).toHaveBeenLastCalledWith({ kind: 'ok' })
    })

    test('a result card that is not reopened answers at once', () => {
        const view = runningView({ state: 'done', cancelOffered: false, fraction: 1, result: { headline: 'Done', actions: [{ id: 'retry', label: 'Retry' }] } })
        const h = mountCard(view)
        part(h.target, 'pattern-task-result-ok')!.click()
        part(h.target, 'pattern-task-result-action')!.click()
        expect(h.onanswer).toHaveBeenCalledTimes(2)
    })
})

describe('the running card Cancel', () => {
    test('is a button whose accessible name is the cancel label', () => {
        const h = mountCard(runningView())
        const cancel = part(h.target, 'pattern-task-cancel')!
        expect(cancel.tagName).toBe('BUTTON')
        expect(accessibleName(cancel)).toBe(language.cancel)
    })
})
