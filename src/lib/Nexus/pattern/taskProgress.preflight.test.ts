import { describe, expect, test } from 'vitest'
import {
    TASK_SLOW_AFTER_MS,
    createTaskController,
    taskAnnouncement,
    taskMarkStatus,
    taskStepStates,
    taskValueText,
    type TaskClock,
    type TaskConfirm,
    type TaskLabels,
    type TaskSnapshot,
} from './taskProgress'

const labels: TaskLabels = {
    stepOf: (i, n) => `Step ${i} of ${n}`,
    fileOf: (i, n) => `File ${i} of ${n}`,
    count: (noun, d, t) => `${noun} ${d} / ${t}`,
    bytes: (d, t) => `${d} / ${t}`,
    cancelling: 'Wrapping up',
    cancelledHeadline: 'Cancelled',
    skippedTitle: (n) => `${n} skipped`,
}

const steps = [{ label: 'Read file' }, { label: 'Check items' }, { label: 'Add items' }]
const confirm: TaskConfirm = { headline: 'Import 2 files', consequences: ['3.0 MiB in total'], cancelLabel: 'Cancel', primaryLabel: 'Import' }

/** A manual clock: time moves only through `advance`, which runs due timers in order. */
function fakeClock() {
    let now = 0
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
        hidden: () => false,
    }
    return {
        clock,
        advance(ms: number) {
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

function snap(over: Partial<TaskSnapshot> = {}): TaskSnapshot {
    return { title: 'Import', steps, stepIndex: 0, state: 'running', cancelOffered: false, cancelled: false, ...over }
}

describe('the confirm state of the task model', () => {
    // R3-1
    test('a def with confirm starts in confirm, ignores progress, and confirm() starts the slow timer', () => {
        const clock = fakeClock()
        const c = createTaskController({ title: 'Import', steps, onCancel: () => { }, confirm }, clock.clock)
        expect(c.view.state).toBe('confirm')
        c.setStep(1)
        c.setFile(0, 2)
        c.setCount(1, 2)
        c.setBytes(1, 2)
        expect(c.view.stepIndex).toBe(0)
        expect(c.view.file).toBeUndefined()
        expect(c.view.count).toBeUndefined()
        clock.advance(TASK_SLOW_AFTER_MS + 100)
        expect(c.view.slow).toBe(false)
        expect(c.confirm()).toBe(true)
        expect(c.view.state).toBe('running')
        expect(c.view.slow).toBe(false)
        clock.advance(TASK_SLOW_AFTER_MS + 100)
        expect(c.view.slow).toBe(true)
        expect(c.confirm()).toBe(false)
    })

    // R3-2
    test('lockCancel in confirm returns false and requestCancel does not move the state', () => {
        const calls: number[] = []
        const c = createTaskController({ title: 'Import', steps, onCancel: () => { calls.push(1) }, confirm }, fakeClock().clock)
        expect(c.view.state).toBe('confirm')
        expect(c.lockCancel()).toBe(false)
        expect(c.requestCancel()).toBe(false)
        expect(c.view.state).toBe('confirm')
        expect(calls).toEqual([])
    })

    // R3-3
    test('the helpers are total over a confirm snapshot', () => {
        const s = snap({ state: 'confirm', confirm })
        expect(s.state).toBe('confirm')
        expect(taskAnnouncement(s, labels)).toBe('')
        expect(taskStepStates(s)).toEqual(['next', 'next', 'next'])
        expect(taskMarkStatus(s)).toBe('idle')
        expect(taskValueText(s, labels)).toBe('')
    })
})
