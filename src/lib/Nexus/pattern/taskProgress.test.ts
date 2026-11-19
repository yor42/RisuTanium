// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
    TASK_SLOW_AFTER_MS,
    canMoveTo,
    createTaskController,
    taskAmountText,
    taskAnnouncement,
    taskDeterminate,
    taskFraction,
    taskMarkStatus,
    taskStepStates,
    taskValueText,
    type TaskClock,
    type TaskDef,
    type TaskLabels,
    type TaskSnapshot,
    type TaskView,
} from './taskProgress'

const labels: TaskLabels = {
    stepOf: (i, n) => `Step ${i} of ${n}`,
    fileOf: (i, n) => `File ${i} of ${n}`,
    count: (noun, d, t) => (noun ? `${noun} ${d} / ${t}` : `${d} / ${t}`),
    bytes: (d, t) => `${d} / ${t}`,
    cancelling: 'Wrapping up',
    cancelledHeadline: 'Cancelled',
    skippedTitle: (n) => `${n} skipped`,
}

const steps = [
    { label: 'Read file' },
    { label: 'Check items', noun: 'Assets' },
    { label: 'Add items', noun: 'Assets' },
    { label: 'Tidy up' },
]

function snap(over: Partial<TaskSnapshot> = {}): TaskSnapshot {
    return { title: 'Import', steps, stepIndex: 0, state: 'running', cancelOffered: false, cancelled: false, ...over }
}

/** A manual clock: time moves only through `advance`, which runs due timers in order. */
function fakeClock() {
    let now = 0
    let hidden = false
    let nextId = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    const clock: TaskClock = {
        now: () => now,
        setTimeout: (run, ms) => {
            const id = nextId++
            timers.set(id, { at: now + ms, run })
            return id as unknown as ReturnType<typeof setTimeout>
        },
        clearTimeout: (id) => { timers.delete(id as unknown as number) },
        hidden: () => hidden,
    }
    return {
        clock,
        at(ms: number) { this.advance(ms - now) },
        advance(ms: number) {
            const target = now + ms
            for (;;) {
                let nextTimer: [number, { at: number, run: () => void }] | undefined
                for (const entry of timers) if (entry[1].at <= target && (!nextTimer || entry[1].at < nextTimer[1].at)) nextTimer = entry
                if (!nextTimer) break
                timers.delete(nextTimer[0])
                now = Math.max(now, nextTimer[1].at)
                nextTimer[1].run()
            }
            now = target
        },
        setHidden(value: boolean) { hidden = value },
        pending: () => timers.size,
    }
}

function start(over: Partial<TaskDef> = {}) {
    const time = fakeClock()
    const controller = createTaskController({ title: 'Import', steps, onCancel: () => { }, ...over }, time.clock)
    const published: TaskView[] = []
    controller.subscribe((view) => published.push(view))
    return { time, controller, published }
}

describe('task model', () => {
    // The fraction is an equal share per step, filled by count or bytes, with a batch file as an equal share.
    test('T1 fraction: equal share per step, filled by count or bytes; a batch file takes an equal share', () => {
        expect(taskFraction(snap({ stepIndex: 1, count: { done: 5, total: 10 } }))).toBe(0.375)
        expect(taskFraction(snap({ stepIndex: 0, file: { index: 1, total: 3 } }))).toBeCloseTo(1 / 3)
        expect(taskFraction(snap({ stepIndex: 2, bytes: { done: 1, total: 4 } }))).toBe(0.5625)
        expect(taskFraction(snap({ stepIndex: 1, count: { done: 4, total: 0 } }))).toBe(0.25)
        expect(taskFraction(snap({ stepIndex: 1, count: { done: 4, total: Number.NaN } }))).toBe(0.25)
        expect(taskDeterminate(snap({ count: { done: 4, total: 0 } }))).toBe(false)
        expect(taskDeterminate(snap({ count: { done: 4, total: 8 } }))).toBe(true)
        expect(taskFraction(snap({ state: 'done' }))).toBe(1)
        expect(taskFraction(snap({ state: 'done-with-skips' }))).toBe(1)
    })

    test('T2 the published fraction never decreases', () => {
        const { time, controller } = start()
        controller.setStep(1)
        controller.setCount(8, 10)
        time.advance(300)
        const high = controller.view.fraction
        controller.setCount(2, 10)
        time.advance(300)
        expect(controller.view.fraction).toBe(high)
    })

    test('T3 the announcement changes on step, file and state only', () => {
        const { time, controller } = start()
        const before = taskAnnouncement(controller.view, labels)
        controller.setStep(1)
        time.advance(300)
        const step = taskAnnouncement(controller.view, labels)
        expect(step).not.toBe(before)
        controller.setCount(3, 10)
        controller.setBytes(1, 2)
        time.advance(300)
        expect(taskAnnouncement(controller.view, labels)).toBe(step)
        time.advance(TASK_SLOW_AFTER_MS)
        expect(controller.view.slow).toBe(true)
        expect(taskAnnouncement(controller.view, labels)).toBe(step)
        controller.requestCancel()
        expect(taskAnnouncement(controller.view, labels)).toBe('Wrapping up')
        controller.finish({ headline: 'Imported', skipped: [{ name: 'a', reason: 'b' }, { name: 'c', reason: 'd' }] })
        expect(taskAnnouncement(controller.view, labels)).toBe('Imported. 2 skipped')
    })

    test('T4 value text and amount text carry the amount, never a percentage', () => {
        const counted = snap({ stepIndex: 1, count: { done: 3, total: 10 } })
        expect(taskValueText(counted, labels)).toBe('Step 2 of 4: Check items, Assets 3 / 10')
        expect(taskAmountText(counted, labels)).toBe('Assets 3 / 10')
        const sized = snap({ stepIndex: 0, bytes: { done: 1048576, total: 3145728 }, file: { index: 1, total: 3 } })
        expect(taskAmountText(sized, labels)).toBe('1.0 MiB / 3.0 MiB')
        expect(taskValueText(sized, labels)).toBe('File 2 of 3: Step 1 of 4: Read file, 1.0 MiB / 3.0 MiB')
        expect(taskAmountText(snap(), labels)).toBe('')
        for (const text of [taskValueText(counted, labels), taskValueText(sized, labels), taskAmountText(sized, labels)]) expect(text).not.toContain('%')
    })

    test('T5 transitions: the table, and calls that do not apply are ignored without throwing', () => {
        expect(canMoveTo('running', 'cancelling')).toBe(true)
        expect(canMoveTo('cancelling', 'done')).toBe(true)
        expect(canMoveTo('cancelling', 'cancelling')).toBe(false)
        expect(canMoveTo('done', 'failed')).toBe(false)
        expect(canMoveTo('failed', 'running')).toBe(false)
        const { controller } = start()
        controller.setStep(2)
        controller.flush()
        expect(controller.view.stepIndex).toBe(2)
        // A backward or same-index step is refused: the step index never moves back and its count survives.
        controller.setCount(1, 4)
        expect(() => controller.setStep(1)).not.toThrow()
        controller.flush()
        expect(controller.view.stepIndex).toBe(2)
        expect(controller.view.count?.done).toBe(1)
        expect(() => controller.setStep(2)).not.toThrow()
        controller.flush()
        expect(controller.view.stepIndex).toBe(2)
        expect(controller.view.count?.done).toBe(1)
        expect(() => controller.setStep(99)).not.toThrow()
        controller.flush()
        expect(controller.view.stepIndex).toBe(2)
        controller.finish({ headline: 'Done' })
        controller.setStep(3)
        controller.setCount(1, 2)
        controller.fail({ headline: 'x', dataState: 'same' })
        expect(controller.view.state).toBe('done')
        expect(controller.view.stepIndex).toBe(2)
        expect(controller.view.failure).toBeUndefined()
        expect(taskMarkStatus(controller.view)).toBe('done')
    })

    test('step states and mark follow the state', () => {
        expect(taskStepStates(snap({ stepIndex: 1 }))).toEqual(['done', 'now', 'next', 'next'])
        expect(taskStepStates(snap({ stepIndex: 1, state: 'failed' }))).toEqual(['done', 'failed', 'next', 'next'])
        expect(taskStepStates(snap({ stepIndex: 3, state: 'done' }))).toEqual(['done', 'done', 'done', 'done'])
        expect(taskMarkStatus(snap({ steps: [{ label: 'a', mark: 'transfer_in' }] }))).toBe('transfer_in')
        expect(taskMarkStatus(snap({ state: 'cancelling' }))).toBe('finishing')
        expect(taskMarkStatus(snap({ state: 'done', cancelled: true }))).toBe('stopped')
        expect(taskMarkStatus(snap({ state: 'failed' }))).toBe('error')
    })
})

describe('task controller throttle', () => {
    test('T6 count publishes: leading after an idle second, trailing with the latest value; none right after construction', () => {
        const a = start()
        a.time.at(1000)
        for (let i = 0; i < 10; i++) {
            a.time.at(1000 + i * 10)
            a.controller.setCount(i + 1, 10)
        }
        a.time.at(1300)
        expect(a.published).toHaveLength(2)
        expect(a.published[0].count?.done).toBe(1)
        expect(a.published[1].count?.done).toBe(10)

        // A step change goes through the same throttle: nothing before the last publish (1250) plus the interval.
        a.controller.setStep(1)
        a.time.at(1499)
        expect(a.published).toHaveLength(2)
        a.time.at(1500)
        expect(a.published).toHaveLength(3)
        expect(a.published[2].stepIndex).toBe(1)
        expect(a.published[2].count).toBeUndefined()

        // lockCancel publishes at once with the pending count and leaves no trailing publish behind.
        a.time.at(1510)
        a.controller.setCount(1, 5)
        a.time.at(1520)
        a.controller.lockCancel()
        expect(a.published).toHaveLength(4)
        expect(a.published[3].count?.done).toBe(1)
        a.time.at(2200)
        expect(a.published).toHaveLength(4)

        const b = start()
        for (let t = 10; t <= 100; t += 10) {
            b.time.at(t)
            b.controller.setCount(t / 10, 20)
        }
        expect(b.published).toHaveLength(0)
        b.time.at(250)
        expect(b.published).toHaveLength(1)
        expect(b.published[0].count?.done).toBe(10)
    })

    test('T6b a flood of file changes publishes twice; a transition inside the window wins and drops the trailing publish', () => {
        const flood = (finishAt?: number) => {
            const s = start({ steps: steps.slice(0, 2) })
            s.time.at(1000)
            for (let k = 0; k < 20; k++) {
                s.controller.setFile(k, 20)
                s.time.advance(5)
            }
            if (finishAt !== undefined) {
                s.time.at(finishAt)
                s.controller.finish({ headline: 'Done' })
            }
            s.time.at(1300)
            return s
        }
        const a = flood()
        expect(a.published).toHaveLength(2)
        expect(a.published[0].file?.index).toBe(0)
        expect(a.published[1].file?.index).toBe(19)
        expect(a.published[1].stepIndex).toBe(0)
        expect(a.published[1].count).toBeUndefined()
        const announcements = new Set(a.published.map((v) => taskAnnouncement(v, labels)))
        expect(announcements.size).toBe(2)

        const b = flood(1240)
        expect(b.published).toHaveLength(2)
        expect(b.published[1].state).toBe('done')
        expect(b.published[1].file?.index).toBe(19)
    })

    test('T7 a hidden tab publishes nothing until flush', () => {
        const { time, controller, published } = start()
        time.at(1000)
        time.setHidden(true)
        controller.setCount(3, 10)
        time.at(2000)
        expect(published).toHaveLength(0)
        time.setHidden(false)
        controller.flush()
        expect(published).toHaveLength(1)
        expect(published[0].count?.done).toBe(3)
    })

    test('T8 the slow hint is 8 s without visible progress and restarts on a step or an advancing count', () => {
        const a = start()
        a.time.at(7900)
        expect(a.controller.view.slow).toBe(false)
        a.time.at(8000)
        expect(a.controller.view.slow).toBe(true)

        const b = start()
        b.time.at(7000)
        b.controller.setStep(1)
        b.time.at(14000)
        expect(b.controller.view.slow).toBe(false)
        b.time.at(15000)
        expect(b.controller.view.slow).toBe(true)

        const c = start()
        for (let t = 2000, done = 1; t <= 20000; t += 2000, done++) {
            c.time.at(t)
            c.controller.setCount(done, 100)
        }
        c.time.at(20300)
        expect(c.controller.view.slow).toBe(false)
        c.time.at(28000)
        expect(c.controller.view.slow).toBe(true)

        const d = start()
        d.time.at(5000)
        d.controller.setCount(1, 10)
        d.time.at(7000)
        d.controller.setCount(1, 10)
        d.time.at(13000)
        expect(d.controller.view.slow).toBe(true)

        // A byte count that advances restarts the timer like an advancing item count.
        const e = start()
        for (let t = 2000, done = 1; t <= 20000; t += 2000, done++) {
            e.time.at(t)
            e.controller.setBytes(done, 100)
        }
        e.time.at(20300)
        expect(e.controller.view.slow).toBe(false)
        e.time.at(28000)
        expect(e.controller.view.slow).toBe(true)

        d.controller.finish({ headline: 'Done' })
        expect(d.controller.view.slow).toBe(false)
        expect(d.time.pending()).toBe(0)
    })
})

describe('task controller cancel', () => {
    test('T9 Cancel is offered only with onCancel, until locked; a request locks out the writer', () => {
        const none = start({ onCancel: undefined })
        expect(none.controller.view.cancelOffered).toBe(false)
        expect(none.controller.requestCancel()).toBe(false)

        let calls = 0
        const { controller } = start({ onCancel: () => { calls++ } })
        expect(controller.view.cancelOffered).toBe(true)
        expect(controller.requestCancel()).toBe(true)
        expect(calls).toBe(1)
        expect(controller.requestCancel()).toBe(false)
        expect(controller.lockCancel()).toBe(false)
        expect(controller.view.state).toBe('cancelling')

        const locked = start({ onCancel: () => { calls++ } })
        expect(locked.controller.lockCancel('reason')).toBe(true)
        expect(locked.controller.view.cancelOffered).toBe(false)
        expect(locked.controller.view.lockReason).toBe('reason')
        expect(locked.controller.requestCancel()).toBe(false)
        expect(calls).toBe(1)
    })

    test('settleCancel ends a cancelling task as cancelled; finish and fail end it otherwise', () => {
        const a = start()
        a.controller.requestCancel()
        a.controller.settleCancel()
        expect(a.controller.view.state).toBe('done')
        expect(a.controller.view.cancelled).toBe(true)
        expect(taskAnnouncement(a.controller.view, labels)).toBe('Cancelled')
        const b = start()
        b.controller.setStep(1)
        b.controller.fail({ headline: 'Broke', dataState: 'partial', kept: 2, failed: 1 })
        expect(b.controller.view.state).toBe('failed')
        expect(taskStepStates(b.controller.view)[1]).toBe('failed')
        expect(b.controller.view.fraction).toBeGreaterThan(0)
    })
})
