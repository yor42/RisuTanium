// @vitest-environment jsdom

/** The presenter maps a task view to toast content and decides what is spoken; the host is a real one on a fake clock. */
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { language } from '../../../lang'
import { createToastHost, type ToastClock } from '../../../ts/toast/toastHost.svelte'
import { createTaskToastPresenter } from './taskToastPresenter'
import type { TaskView } from './taskProgress'

function fakeClock(): ToastClock & { advance(ms: number): void } {
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

const steps = [{ label: 'Read file' }, { label: 'Add items', noun: 'Assets' }]

function view(over: Partial<TaskView> = {}): TaskView {
    return { id: 1, title: 'Importing', steps, stepIndex: 0, state: 'running', cancelOffered: false, cancelled: false, fraction: 0.2, slow: false, ...over }
}

function setup() {
    const clock = fakeClock()
    const host = createToastHost({ clock })
    const presenter = createTaskToastPresenter(host)
    const open = vi.fn()
    const end = vi.fn()
    const id = presenter.post(view(), { open, end })
    return { clock, host, presenter, open, end, id }
}

describe('task toast presenter', () => {
    test('post shows the running toast and announces the backgrounding politely', () => {
        const { host, id } = setup()
        const [task] = host.tasks
        expect(task.id).toBe(id)
        expect(task.title).toBe('Importing')
        expect(task.line).toBe('Read file')
        expect(task.phase).toBe('running')
        expect(task.openLabel).toBe(language.patternTaskToastOpen)
        expect(host.polite.text).toBe(language.patternTaskBackgrounded('Importing'))
        expect(host.assertive.text).toBe('')
    })

    test('updates within running announce nothing, whatever changes', () => {
        const { host, presenter, id } = setup()
        const seq = host.polite.seq
        presenter.update(id, view({ stepIndex: 1, count: { done: 1, total: 3 } }))
        presenter.update(id, view({ stepIndex: 1, file: { index: 1, total: 2 }, count: { done: 2, total: 3 } }))
        expect(host.polite.seq).toBe(seq)
        expect(host.assertive.text).toBe('')
        expect(host.tasks[0].line).toBe('File 2 of 2: Add items · Assets 2 / 3')
    })

    test('running to done announces the headline politely and switches the open label', () => {
        const { host, presenter, id } = setup()
        presenter.update(id, view({ state: 'done', fraction: 1, result: { headline: 'Imported 2 items' } }))
        expect(host.polite.text).toBe('Imported 2 items')
        expect(host.tasks[0].phase).toBe('done')
        expect(host.tasks[0].openLabel).toBe(language.patternTaskToastResult)
    })

    test('a done result appends its first summary line, and only that one', () => {
        const { host, presenter, id } = setup()
        const note = language.importTaskDuplicatesLeftOut(1)
        presenter.update(id, view({ state: 'done', result: { headline: 'Imported', summary: [note, 'a later line'] } }))
        expect(host.polite.text).toBe(`Imported. ${note}`)
        expect(host.polite.text).not.toContain('a later line')
    })

    test('running to done with skips announces the skipped count and stays', () => {
        const { host, presenter, id } = setup()
        presenter.update(id, view({ state: 'done-with-skips', result: { headline: 'Imported 1', skipped: [{ name: 'a', reason: 'x' }] } }))
        expect(host.polite.text).toBe(`Imported 1. ${language.patternTaskSkippedTitle(1)}`)
        expect(host.tasks[0].phase).toBe('stays')
        expect(host.tasks[0].badge).toBe(true)
    })

    test('running to failed announces assertively with the failure headline', () => {
        const { host, presenter, id } = setup()
        const politeSeq = host.polite.seq
        presenter.update(id, view({ state: 'failed', failure: { headline: 'Import failed', dataState: 'same' } }))
        expect(host.assertive.text).toBe('Import failed')
        expect(host.polite.seq).toBe(politeSeq)
        expect(host.tasks[0].line).toBe(language.patternTaskDataSame)
    })

    test('a second update after the end state announces nothing more', () => {
        const { host, presenter, id } = setup()
        presenter.update(id, view({ state: 'done', result: { headline: 'Imported' } }))
        const seq = host.polite.seq
        presenter.update(id, view({ state: 'done', result: { headline: 'Imported', summary: ['x'] } }))
        expect(host.polite.seq).toBe(seq)
    })

    test('the hold and the dismissal reach the end callback', () => {
        const { clock, host, presenter, end, id } = setup()
        presenter.update(id, view({ state: 'done', result: { headline: 'Imported' } }))
        clock.advance(5999)
        expect(end).not.toHaveBeenCalled()
        clock.advance(1)
        expect(end).toHaveBeenCalledTimes(1)
        expect(host.tasks).toHaveLength(0)

        const second = presenter.post(view(), { open: () => { }, end })
        presenter.update(second, view({ state: 'failed', failure: { headline: 'x', dataState: 'same' } }))
        host.dismissTask(second)
        expect(end).toHaveBeenCalledTimes(2)
    })

    test('Open reaches the open callback and end removes the toast without an end callback', () => {
        const { host, presenter, open, end, id } = setup()
        host.openTask(id)
        expect(open).toHaveBeenCalledTimes(1)
        presenter.end(id, { returnFocus: false })
        expect(host.tasks).toHaveLength(0)
        expect(host.takeFocusReturnSkip()).toBe(true)
        expect(end).not.toHaveBeenCalled()
    })
})
