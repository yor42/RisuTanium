// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest'
import {
    alertTask,
    answerTask,
    requestTaskCancel,
    resetTaskHostForTests,
    setTaskClockForTests,
    taskBackPress,
    taskHostView,
    taskOpener,
    taskResultRead,
    taskResultShowing,
    taskShown,
    type TaskCloseAnswer,
} from './alertTask.svelte'
import type { TaskClock, TaskDef } from '../lib/Nexus/pattern/taskProgress'

const def: TaskDef = {
    title: 'Import',
    steps: [{ label: 'Read file' }, { label: 'Check items', noun: 'Assets' }, { label: 'Tidy up' }],
    onCancel: () => { },
}

afterEach(() => {
    resetTaskHostForTests()
    document.body.replaceChildren()
})

/** A manual clock: time moves only through `advance`, which runs due timers in order. */
function manualClock() {
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

/** Whether a promise has settled after a few microtask turns. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false
    void promise.then(() => { done = true })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return done
}

describe('task slot', () => {
    test('T21b a replaced handle never writes to the second task, even after the throttle interval has passed', () => {
        const time = manualClock()
        setTaskClockForTests(time.clock)
        const first = alertTask(def)
        const second = alertTask({ ...def, title: 'Second' })
        first.setCount(5, 10)
        first.setBytes(1, 2)
        first.setStep(1)
        first.setFile(0, 3)
        time.advance(1000)
        document.dispatchEvent(new Event('visibilitychange'))
        time.advance(1000)
        const view = taskHostView()
        expect(view?.title).toBe('Second')
        expect(view?.count).toBeUndefined()
        expect(view?.bytes).toBeUndefined()
        expect(view?.file).toBeUndefined()
        expect(view?.stepIndex).toBe(0)

        // The live second task still publishes through the same slot.
        second.setCount(2, 4)
        time.advance(1000)
        expect(taskHostView()?.count?.done).toBe(2)
    })

    test('T21 a second task replaces the first; close removes the card; a repeated finish returns the same promise', async () => {
        const first = alertTask(def)
        const firstView = taskHostView()
        const second = alertTask({ ...def, title: 'Second' })
        expect(await first.finish({ headline: 'Done' })).toEqual({ kind: 'replaced' })
        first.setCount(5, 10)
        first.setStep(1)
        expect(taskHostView()).not.toBe(firstView)
        expect(taskHostView()?.title).toBe('Second')
        expect(taskHostView()?.count).toBeUndefined()
        expect(taskHostView()?.stepIndex).toBe(0)

        const closing = second.finish({ headline: 'Done' })
        expect(second.finish({ headline: 'Again' })).toBe(closing)
        const third = alertTask(def)
        third.close()
        expect(taskHostView()).toBeNull()
        expect(taskShown()).toBe(false)
        expect(await third.finish({ headline: 'Late' })).toEqual({ kind: 'closed' })
    })

    test('T22 answerTask is ignored while running and clears a finished task with the answer', async () => {
        const handle = alertTask(def)
        answerTask({ kind: 'ok' })
        expect(taskShown()).toBe(true)
        const closed = handle.finish({ headline: 'Done' })
        expect(taskResultShowing()).toBe(true)
        answerTask({ kind: 'action', id: 'retry' })
        expect(await closed).toEqual({ kind: 'action', id: 'retry' })
        expect(taskShown()).toBe(false)
    })

    test('T23 a replaced handle is detached: lockCancel is true unless Cancel had been pressed', () => {
        let cancels = 0
        const a = alertTask({ ...def, onCancel: () => { cancels++ } })
        alertTask(def)
        expect(a.detached).toBe(true)
        expect(a.cancelRequested).toBe(false)
        expect(a.lockCancel()).toBe(true)

        const c = alertTask({ ...def, onCancel: () => { cancels++ } })
        expect(c.cancelRequested).toBe(false)
        requestTaskCancel()
        expect(cancels).toBe(1)
        expect(c.cancelRequested).toBe(true)
        alertTask(def)
        expect(c.detached).toBe(true)
        expect(c.cancelRequested).toBe(true)
        expect(c.lockCancel()).toBe(false)
    })

    test('T24 every way out of the slot releases the result-read waiters', async () => {
        const a = alertTask(def)
        const closed: Promise<TaskCloseAnswer> = a.finish({ headline: 'Done' })
        const waiting = taskResultRead()
        expect(await settled(waiting)).toBe(false)
        alertTask(def)
        expect(await settled(waiting)).toBe(true)
        expect(await closed).toEqual({ kind: 'replaced' })

        const b = alertTask(def)
        void b.finish({ headline: 'Done' })
        const waitingB = taskResultRead()
        b.close()
        expect(await settled(waitingB)).toBe(true)

        const c = alertTask(def)
        void c.finish({ headline: 'Done' })
        const waitingC = taskResultRead()
        resetTaskHostForTests()
        expect(await settled(waitingC)).toBe(true)

        alertTask(def)
        expect(await settled(taskResultRead())).toBe(true)
    })

    test('Back cancels when offered, holds when it cannot be stopped, and dismisses a result', async () => {
        expect(taskBackPress()).toBe(false)
        let cancels = 0
        const a = alertTask({ ...def, onCancel: () => { cancels++ } })
        expect(taskBackPress()).toBe(true)
        expect(cancels).toBe(1)
        expect(taskBackPress()).toBe(true)
        expect(cancels).toBe(1)

        const b = alertTask({ ...def, onCancel: () => { cancels++ } })
        expect(b.lockCancel('locked')).toBe(true)
        expect(taskBackPress()).toBe(true)
        expect(cancels).toBe(1)
        expect(taskShown()).toBe(true)

        const closed = b.finish({ headline: 'Done' })
        expect(taskBackPress()).toBe(true)
        expect(await closed).toEqual({ kind: 'ok' })
        expect(a.detached).toBe(true)
    })

    test('the opener is the focused element at open time, and a replacement opened from inside the card inherits it', () => {
        const button = document.createElement('button')
        document.body.appendChild(button)
        button.focus()
        alertTask(def)
        expect(taskOpener()).toBe(button)

        const layer = document.createElement('div')
        layer.setAttribute('data-part', 'pattern-layer')
        const root = document.createElement('section')
        root.setAttribute('data-part', 'pattern-task-root')
        const inner = document.createElement('button')
        root.appendChild(inner)
        layer.appendChild(root)
        document.body.appendChild(layer)
        inner.focus()
        alertTask(def)
        expect(taskOpener()).toBe(button)
    })
})
