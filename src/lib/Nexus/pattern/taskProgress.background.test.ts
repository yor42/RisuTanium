import { describe, expect, test } from 'vitest'
import {
    createTaskController,
    taskToastContent,
    taskToastPhase,
    type TaskClock,
    type TaskLabels,
    type TaskView,
} from './taskProgress'

const labels: TaskLabels = {
    stepOf: (index, total) => `Step ${index} of ${total}`,
    fileOf: (index, total) => `File ${index} of ${total}`,
    count: (noun, done, total) => `${noun} ${done} / ${total}`,
    bytes: (done, total) => `${done} / ${total}`,
    cancelling: 'Wrapping up',
    cancelledHeadline: 'Cancelled',
    skippedTitle: (count) => `${count} skipped`,
    dataLine: (failure) => `data:${failure.dataState}`,
}

const steps = [{ label: 'Read file', mark: 'transfer_in' as const }, { label: 'Add items', noun: 'Assets' }]

function view(over: Partial<TaskView> = {}): TaskView {
    return {
        id: 1,
        title: 'Importing cards',
        steps,
        stepIndex: 0,
        state: 'running',
        cancelOffered: false,
        cancelled: false,
        fraction: 0.25,
        slow: false,
        ...over,
    }
}

const clock: TaskClock = {
    now: () => 0,
    setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => { },
    hidden: () => false,
}

describe('taskToastPhase', () => {
    test('confirm, running and cancelling read as running', () => {
        expect(taskToastPhase(view({ state: 'confirm' }))).toBe('running')
        expect(taskToastPhase(view())).toBe('running')
        expect(taskToastPhase(view({ state: 'cancelling' }))).toBe('running')
    })

    test('a clean done is done; skips, a failure and a cancelled done stay', () => {
        expect(taskToastPhase(view({ state: 'done', result: { headline: 'Imported' } }))).toBe('done')
        expect(taskToastPhase(view({ state: 'done', result: { headline: 'Imported', skipped: [{ name: 'a', reason: 'x' }] } }))).toBe('stays')
        expect(taskToastPhase(view({ state: 'done-with-skips', result: { headline: 'Imported', skipped: [{ name: 'a', reason: 'x' }] } }))).toBe('stays')
        expect(taskToastPhase(view({ state: 'failed', failure: { headline: 'Failed', dataState: 'same' } }))).toBe('stays')
        expect(taskToastPhase(view({ state: 'done', cancelled: true, result: { headline: '' } }))).toBe('stays')
    })
})

describe('taskToastContent', () => {
    test('a running line carries the file, the step and the count, and never a percentage', () => {
        const content = taskToastContent(view({ stepIndex: 1, file: { index: 1, total: 3 }, count: { done: 2, total: 5 }, fraction: 0.5 }), labels)
        expect(content.title).toBe('Importing cards')
        expect(content.line).toBe('File 2 of 3: Add items · Assets 2 / 5')
        expect(content.line).not.toContain('%')
        expect(content.fraction).toBe(0.5)
        expect(content.determinate).toBe(true)
        expect(content.badge).toBe(false)
    })

    test('a bytes line reads in MiB and a step without an amount has no separator', () => {
        const bytes = taskToastContent(view({ bytes: { done: 1024 * 1024, total: 4 * 1024 * 1024 } }), labels)
        expect(bytes.line).toBe('Read file · 1.0 MiB / 4.0 MiB')
        expect(bytes.line).not.toContain('%')
        expect(bytes.mark).toBe('transfer_in')
        const plain = taskToastContent(view(), labels)
        expect(plain.line).toBe('Read file')
        expect(plain.determinate).toBe(false)
    })

    test('a cancelling task keeps its step line', () => {
        const content = taskToastContent(view({ state: 'cancelling' }), labels)
        expect(content.line).toBe('Read file')
        expect(content.mark).toBe('finishing')
    })

    test('a clean result: the headline is the title and the first summary line the line', () => {
        const content = taskToastContent(view({ state: 'done', fraction: 1, result: { headline: 'Imported 2 items', summary: ['2 characters', 'second'] } }), labels)
        expect(content.title).toBe('Imported 2 items')
        expect(content.line).toBe('2 characters')
        expect(content.badge).toBe(false)
        expect(content.mark).toBe('done')
        expect(taskToastContent(view({ state: 'done', result: { headline: 'Imported' } }), labels).line).toBe('')
    })

    test('skips give the skipped count and the badge', () => {
        const content = taskToastContent(view({ state: 'done-with-skips', result: { headline: 'Imported 1', summary: ['note'], skipped: [{ name: 'a', reason: 'x' }, { name: 'b', reason: 'y' }] } }), labels)
        expect(content.line).toBe('2 skipped')
        expect(content.badge).toBe(true)
    })

    test('a failure gives the failure headline and its data line, with no badge', () => {
        const content = taskToastContent(view({ state: 'failed', failure: { headline: 'Import failed', dataState: 'partial' } }), labels)
        expect(content.title).toBe('Import failed')
        expect(content.line).toBe('data:partial')
        expect(content.badge).toBe(false)
        expect(content.mark).toBe('error')
    })

    test('a cancelled done uses the cancelled headline and no badge', () => {
        const content = taskToastContent(view({ state: 'done', cancelled: true, result: { headline: '', summary: ['kept 1'] } }), labels)
        expect(content.title).toBe('Cancelled')
        expect(content.line).toBe('kept 1')
        expect(content.badge).toBe(false)
    })
})

describe('background flag on the controller', () => {
    const def = { title: 'T', steps, onCancel: () => { } }

    test('the snapshot carries background only when the def asks for it', () => {
        expect(createTaskController(def, clock).view.background).toBeUndefined()
        expect(createTaskController({ ...def, background: true }, clock).view.background).toBe(true)
    })

    test('a held def offers it only after offerBackground', () => {
        const controller = createTaskController({ ...def, background: true, backgroundHeld: true }, clock)
        expect(controller.view.background).toBeUndefined()
        controller.offerBackground()
        expect(controller.view.background).toBe(true)
    })

    test('withdrawBackground is permanent and publishes at once', () => {
        const controller = createTaskController({ ...def, background: true }, clock)
        const seen: Array<true | undefined> = []
        controller.subscribe((next) => { seen.push(next.background) })
        controller.withdrawBackground()
        expect(seen).toEqual([undefined])
        controller.offerBackground()
        expect(controller.view.background).toBeUndefined()
        const held = createTaskController({ ...def, background: true, backgroundHeld: true }, clock)
        held.withdrawBackground()
        const heldSeen: Array<true | undefined> = []
        held.subscribe((next) => { heldSeen.push(next.background) })
        held.offerBackground()
        expect(held.view.background).toBeUndefined()
        expect(heldSeen).toEqual([])
    })

    test('both are no-ops after dispose', () => {
        const controller = createTaskController({ ...def, background: true, backgroundHeld: true }, clock)
        controller.dispose()
        controller.offerBackground()
        expect(controller.view.background).toBeUndefined()
    })
})
