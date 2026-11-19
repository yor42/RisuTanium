// @vitest-environment jsdom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import PatternTask from './PatternTask.svelte'
import { createTaskController, type TaskClock, type TaskController, type TaskDef, type TaskView } from './taskProgress'

const steps = [
    { label: 'Read file' },
    { label: 'Check items', noun: 'Assets' },
    { label: 'Add items', noun: 'Assets' },
    { label: 'Tidy up' },
]

interface Harness {
    controller: TaskController
    target: HTMLElement
    props: { view: TaskView, lowPower: boolean, oncancel: () => void, onanswer: (a: { kind: 'ok' } | { kind: 'action', id: string }) => void }
    answers: Array<{ kind: 'ok' } | { kind: 'action', id: string }>
    cancels: number[]
    now: { value: number }
    tickTo(ms: number): void
}

const mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

/** A manual clock; the harness republishes whatever the controller publishes into the card's `view` prop. */
function open(over: Partial<TaskDef> = {}, lowPower = false): Harness {
    const now = { value: 0 }
    const timers = new Map<number, { at: number, run: () => void }>()
    let nextId = 1
    const clock: TaskClock = {
        now: () => now.value,
        setTimeout: (run, ms) => {
            const id = nextId++
            timers.set(id, { at: now.value + ms, run })
            return id as unknown as ReturnType<typeof setTimeout>
        },
        clearTimeout: (id) => { timers.delete(id as unknown as number) },
        hidden: () => false,
    }
    const cancels: number[] = []
    const controller = createTaskController({ title: 'Import', steps, onCancel: () => { cancels.push(1) }, ...over }, clock)
    const answers: Harness['answers'] = []
    const props = $state({
        view: controller.view,
        lowPower,
        oncancel: () => { controller.requestCancel() },
        onanswer: (a: { kind: 'ok' } | { kind: 'action', id: string }) => { answers.push(a) },
    })
    controller.subscribe((view) => { props.view = view })
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PatternTask as never, { target, props }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return {
        controller,
        target,
        props,
        answers,
        cancels,
        now,
        tickTo(ms: number) {
            const goal = ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | undefined
                for (const entry of timers) if (entry[1].at <= goal && (!next || entry[1].at < next[1].at)) next = entry
                if (!next) break
                timers.delete(next[0])
                now.value = Math.max(now.value, next[1].at)
                next[1].run()
            }
            now.value = goal
            flushSync()
        },
    }
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    vi.restoreAllMocks()
})

function part(target: HTMLElement, name: string): HTMLElement | null {
    return target.querySelector<HTMLElement>(`[data-part="${name}"]`)
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    ;(document.activeElement ?? document.body).dispatchEvent(event)
    return event
}

describe('PatternTask card', () => {
    // The progress bar's value text names the amount (never a percentage) and the card is one labelled alertdialog group.
    test('T10 an alertdialog holding a named group and a progressbar whose value text carries the count', () => {
        const h = open()
        h.controller.setStep(1)
        h.controller.setCount(5, 10)
        h.tickTo(300)
        const dialog = part(h.target, 'pattern-dialog')!
        expect(dialog.getAttribute('role')).toBe('alertdialog')
        const group = dialog.querySelector('[data-part="pattern-task-root"]')!
        expect(group.getAttribute('role')).toBe('group')
        expect(group.getAttribute('aria-labelledby')).toBe(part(h.target, 'pattern-task-title')!.id)
        const bar = part(h.target, 'pattern-task-bar')!
        expect(bar.getAttribute('role')).toBe('progressbar')
        expect(bar.getAttribute('aria-valuemin')).toBe('0')
        expect(bar.getAttribute('aria-valuemax')).toBe('100')
        expect(bar.getAttribute('aria-valuenow')).toBe(String(Math.round(h.props.view.fraction * 100)))
        expect(bar.getAttribute('aria-valuetext')).toBe('Step 2 of 4: Check items, Assets 5 / 10')
        expect(part(h.target, 'pattern-task-count')!.getAttribute('aria-hidden')).toBe('true')
        expect(part(h.target, 'pattern-task-count')!.textContent).toContain('Assets 5 / 10')
    })

    test('T11 exactly one live region outside aria-hidden; its text changes on a step, not on counts', () => {
        const h = open()
        const live = () => [...h.target.querySelectorAll('[role="status"], [aria-live]')].filter((el) => !el.closest('[aria-hidden="true"]'))
        expect(live()).toHaveLength(1)
        const status = part(h.target, 'pattern-task-status')!
        const before = status.textContent
        for (let i = 1; i <= 3; i++) {
            h.tickTo(i * 300)
            h.controller.setCount(i, 10)
        }
        h.tickTo(2000)
        expect(status.textContent).toBe(before)
        h.controller.setStep(1)
        h.tickTo(3000)
        expect(status.textContent).not.toBe(before)
        expect(live()).toHaveLength(1)
    })

    test('T12 no ring on the mark and no percent text in any state', () => {
        const h = open()
        const texts = () => h.target.textContent ?? ''
        const noRing = () => expect(h.target.querySelector('svg.nexus-mark')!.hasAttribute('data-progress')).toBe(false)
        h.controller.setStep(1)
        h.controller.setCount(7, 10)
        h.tickTo(300)
        noRing()
        expect(texts()).not.toContain('%')
        h.controller.requestCancel()
        flushSync()
        noRing()
        expect(texts()).not.toContain('%')
        h.controller.settleCancel()
        flushSync()
        expect(texts()).not.toContain('%')
        const failed = open()
        failed.controller.fail({ headline: 'Broke', dataState: 'same' })
        flushSync()
        expect(failed.target.textContent).not.toContain('%')
        const done = open()
        done.controller.finish({ headline: 'Imported' })
        flushSync()
        expect(done.target.textContent).not.toContain('%')
    })

    test('T13 an uncounted step shows the sweep and an indeterminate bar; a counted step does neither', () => {
        const h = open()
        expect(part(h.target, 'pattern-task-bar-sweep')).not.toBeNull()
        expect(part(h.target, 'pattern-task-bar')!.getAttribute('data-task-mode')).toBe('indeterminate')
        h.controller.setStep(1)
        h.controller.setCount(1, 10)
        h.tickTo(300)
        expect(part(h.target, 'pattern-task-bar-sweep')).toBeNull()
        expect(part(h.target, 'pattern-task-bar')!.getAttribute('data-task-mode')).toBe('determinate')
    })

    test('T14 low power marks the layer and the bar, the mark keeps animating, and status text stays', () => {
        const h = open({}, true)
        expect(part(h.target, 'pattern-layer')!.hasAttribute('data-low-power')).toBe(true)
        expect(part(h.target, 'pattern-task-bar')!.hasAttribute('data-low-power')).toBe(true)
        expect(h.target.querySelector('svg.nexus-mark')!.hasAttribute('data-still')).toBe(false)
        document.documentElement.classList.add('rm')
        try {
            h.controller.setStep(1)
            h.tickTo(300)
            expect(part(h.target, 'pattern-task-status')!.textContent).toBe('Check items')
            expect(part(h.target, 'pattern-task-step')).not.toBeNull()
        } finally {
            document.documentElement.classList.remove('rm')
        }
    })

    test('T16 Cancel when offered presses once and stays disabled while cancelling; Escape cancels; a locked card consumes Escape', () => {
        const h = open()
        const cancel = part(h.target, 'pattern-task-cancel') as HTMLButtonElement
        expect(cancel).not.toBeNull()
        cancel.click()
        flushSync()
        expect(h.cancels).toHaveLength(1)
        expect(part(h.target, 'pattern-task-cancel')!.getAttribute('aria-disabled')).toBe('true')
        part(h.target, 'pattern-task-cancel')!.click()
        expect(h.cancels).toHaveLength(1)

        const esc = open()
        const escSpy = vi.fn(esc.props.oncancel)
        esc.props.oncancel = escSpy
        flushSync()
        press('Escape')
        expect(escSpy).toHaveBeenCalledTimes(1)
        expect(esc.cancels).toHaveLength(1)

        // A locked card never even forwards Escape to its cancel prop; it only consumes the key.
        const locked = open()
        const lockedSpy = vi.fn(locked.props.oncancel)
        locked.props.oncancel = lockedSpy
        locked.controller.lockCancel()
        flushSync()
        const event = press('Escape')
        expect(lockedSpy).not.toHaveBeenCalled()
        expect(locked.cancels).toHaveLength(0)
        expect(event.defaultPrevented).toBe(true)
    })

    test('T17 locking Cancel removes it, moves focus to the dialog shell and names the reason as the description', () => {
        const h = open()
        const cancel = part(h.target, 'pattern-task-cancel') as HTMLButtonElement
        cancel.focus()
        expect(document.activeElement).toBe(cancel)
        h.controller.lockCancel()
        flushSync()
        return tick().then(() => new Promise<void>((resolve) => setTimeout(resolve, 0))).then(() => {
            expect(part(h.target, 'pattern-task-cancel')).toBeNull()
            expect(document.activeElement).toBe(part(h.target, 'pattern-dialog'))
            const reason = part(h.target, 'pattern-task-cancel-reason')!
            expect(reason.textContent).toContain("can't be stopped midway")
            expect(part(h.target, 'pattern-dialog')!.getAttribute('aria-describedby')).toBe(reason.id)
        })
    })

    test('T18 five skips show three and the full count; More and Less toggle; the headline has focus', () => {
        const h = open()
        const skipped = [1, 2, 3, 4, 5].map((n) => ({ name: `n${n}`, reason: 'r' }))
        h.controller.finish({ headline: 'Imported 7', summary: ['7 characters'], skipped })
        flushSync()
        const headline = part(h.target, 'pattern-task-result-headline')!
        expect(document.activeElement).toBe(headline)
        const section = part(h.target, 'pattern-task-result-skipped')!
        expect(section.querySelector('h4')!.textContent).toBe('5 skipped')
        expect(section.querySelectorAll('[data-part="pattern-task-result-skip"]')).toHaveLength(3)
        const more = part(h.target, 'pattern-task-result-more') as HTMLButtonElement
        expect(more.textContent).toBe('2 more')
        more.click()
        flushSync()
        expect(section.querySelectorAll('[data-part="pattern-task-result-skip"]')).toHaveLength(5)
        expect(more.getAttribute('aria-expanded')).toBe('true')
        more.click()
        flushSync()
        expect(section.querySelectorAll('[data-part="pattern-task-result-skip"]')).toHaveLength(3)
        expect(section.querySelector('h4')!.textContent).toBe('5 skipped')
    })

    test('T19 result answers: an action answers its id, OK answers ok, Escape answers ok; failure states what happened to the data', () => {
        const h = open()
        h.controller.finish({ headline: 'Imported', skipped: [{ name: 'a', reason: 'b' }], actions: [{ id: 'retry', label: 'Retry' }, { id: 'other', label: 'Other' }] })
        flushSync()
        ;(part(h.target, 'pattern-task-result-ok') as HTMLButtonElement).click()
        expect(h.answers.pop()).toEqual({ kind: 'ok' })
        ;(h.target.querySelectorAll('[data-part="pattern-task-result-action"]')[1] as HTMLButtonElement).click()
        expect(h.answers.pop()).toEqual({ kind: 'action', id: 'other' })
        press('Escape')
        expect(h.answers.pop()).toEqual({ kind: 'ok' })

        const unknown = open()
        unknown.controller.fail({ headline: 'Broke', dataState: 'unknown' })
        flushSync()
        expect(part(unknown.target, 'pattern-task-result-data')!.textContent).toContain("Couldn't confirm what was saved")
        const partial = open()
        partial.controller.fail({ headline: 'Broke', dataState: 'partial', kept: 4, failed: 2, detail: 'Disk full.' })
        flushSync()
        expect(part(partial.target, 'pattern-task-result-data')!.textContent).toBe('The 4 already added are still there. 2 failed. Disk full.')
        const same = open()
        same.controller.fail({ headline: 'Broke', dataState: 'same' })
        flushSync()
        expect(part(same.target, 'pattern-task-result-data')!.textContent).toBe("Your data wasn't changed")
    })

    test('a cancelled task ends in a result card that says nothing was changed', () => {
        const h = open()
        h.controller.requestCancel()
        h.controller.settleCancel()
        flushSync()
        expect(part(h.target, 'pattern-task-result')!.getAttribute('data-outcome')).toBe('cancelled')
        expect(part(h.target, 'pattern-task-result-headline')!.textContent).toBe('Cancelled')
        expect(part(h.target, 'pattern-task-result-summary')!.textContent).toBe('Nothing was changed')
    })

    test('T20 a batch shows File i of n in the subtitle, restarts the steps and changes the announcement', () => {
        const h = open()
        h.controller.setStep(2)
        h.tickTo(300)
        const before = part(h.target, 'pattern-task-status')!.textContent
        h.controller.setFile(1, 3, 'b.risum')
        h.tickTo(600)
        const subtitle = part(h.target, 'pattern-task-subtitle')!.textContent!
        expect(subtitle).toContain('File 2 of 3')
        expect(subtitle).toContain('b.risum')
        expect(part(h.target, 'pattern-task-bar')!.getAttribute('aria-valuetext')!.startsWith('File 2 of 3')).toBe(true)
        expect(part(h.target, 'pattern-task-status')!.textContent).not.toBe(before)
        const states = [...h.target.querySelectorAll('[data-part="pattern-task-step"]')].map((el) => el.getAttribute('data-step-state'))
        expect(states).toEqual(['now', 'next', 'next', 'next'])
    })

    // Diagnostic G3: no elapsed timer is ever drawn.
    test('G3 after a minute on an uncounted step the card shows no clock text', () => {
        const h = open()
        h.tickTo(61000)
        expect(h.target.textContent).not.toMatch(/\d+:\d\d/)
        expect(part(h.target, 'pattern-task-slow')!.hasAttribute('data-visible')).toBe(true)
    })
})
