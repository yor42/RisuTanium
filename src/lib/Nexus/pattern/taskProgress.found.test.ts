// @vitest-environment node
/**
 * The open count: "n saved, m found so far". The number found is still growing, so it never fills the bar and never
 * makes the card determinate; only a closed count (`setCount`) or bytes do. Its text comes from `labels.countFound`.
 */
import { describe, expect, test } from 'vitest'
import {
    createTaskController,
    taskAmountText,
    taskDeterminate,
    taskFraction,
    taskValueText,
    type TaskClock,
    type TaskLabels,
    type TaskSnapshot,
} from './taskProgress'

const labels: TaskLabels = {
    stepOf: (i, n) => `Step ${i} of ${n}`,
    fileOf: (i, n) => `File ${i} of ${n}`,
    count: (noun, d, t) => (noun ? `${noun} ${d} / ${t}` : `${d} / ${t}`),
    countFound: (noun, d, f) => (noun ? `${noun} ${d} saved, ${f} found so far` : `${d} saved, ${f} found so far`),
    bytes: (d, t) => `${d} / ${t}`,
    cancelling: 'Wrapping up',
    cancelledHeadline: 'Cancelled',
    skippedTitle: (n) => `${n} skipped`,
}

const steps = [
    { label: 'Read file', noun: 'Assets' },
    { label: 'Save assets', noun: 'Assets' },
]

function snap(over: Partial<TaskSnapshot> = {}): TaskSnapshot {
    return { title: 'Import', steps, stepIndex: 0, state: 'running', cancelOffered: false, cancelled: false, ...over }
}

const MIB = 1024 * 1024

/** A clock whose timers never fire and whose time always passes the publish interval, so every report publishes. */
function steadyClock(): TaskClock {
    let now = 0
    return {
        now: () => (now += 1000),
        setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimeout: () => { },
        hidden: () => false,
    }
}

describe('open count', () => {
    test('R-b19 text comes from countFound with the step noun, never a percentage', () => {
        const s = snap({ count: { done: 2, total: 5, open: true } })
        expect(taskAmountText(s, labels)).toBe('Assets 2 saved, 5 found so far')
        expect(taskValueText(s, labels)).toContain('Assets 2 saved, 5 found so far')
    })

    test('R-b19 an open count is ignored for the fraction and for determinate', () => {
        const open = snap({ count: { done: 4, total: 5, open: true } })
        expect(taskFraction(open)).toBe(0)
        expect(taskDeterminate(open)).toBe(false)
        // The same numbers closed do count.
        const closed = snap({ count: { done: 4, total: 5 } })
        expect(taskFraction(closed)).toBeCloseTo(0.4)
        expect(taskDeterminate(closed)).toBe(true)
    })

    test('R-b19 bytes drive the bar while the open count supplies the text', () => {
        const s = snap({ count: { done: 1, total: 3, open: true }, bytes: { done: 5 * MIB, total: 10 * MIB } })
        expect(taskDeterminate(s)).toBe(true)
        expect(taskFraction(s)).toBeCloseTo(0.25)
        expect(taskAmountText(s, labels)).toBe('Assets 1 saved, 3 found so far')
    })

    test('R-b19 setFound opens a count and setCount closes it', () => {
        const controller = createTaskController({ title: 'Import', steps, onCancel: () => { } }, steadyClock())
        controller.setFound(2, 5)
        expect(controller.view.count).toEqual({ done: 2, total: 5, open: true })
        expect(taskDeterminate(controller.view)).toBe(false)
        expect(taskAmountText(controller.view, labels)).toBe('Assets 2 saved, 5 found so far')

        controller.setStep(1)
        controller.setFound(3, 8)
        controller.setCount(3, 8)
        const closed = controller.view.count
        expect(closed?.open).toBeFalsy()
        expect(taskDeterminate(controller.view)).toBe(true)
        expect(taskAmountText(controller.view, labels)).toBe('Assets 3 / 8')
        controller.dispose()
    })

    test('R-b19 setFound ignores nonsense and a step change clears the open count', () => {
        const controller = createTaskController({ title: 'Import', steps, onCancel: () => { } }, steadyClock())
        controller.setFound(Number.NaN, Number.POSITIVE_INFINITY)
        expect(controller.view.count).toEqual({ done: 0, total: 0, open: true })
        expect(taskAmountText(controller.view, labels)).toBe('')
        controller.setFound(1, 2)
        controller.setStep(1)
        expect(controller.view.count).toBeUndefined()
        controller.dispose()
    })
})
