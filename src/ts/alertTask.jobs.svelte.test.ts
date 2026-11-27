// @vitest-environment jsdom
/**
 * `backgroundJobs`: the reactive list of backgrounded tasks that have not ended, with the Open and Cancel the Tasks
 * dialog calls. Tasks are real `alertTask` slots with the `background: true` definition the importers pass, shown through
 * a fake toast presenter; time moves only through the fake clock.
 *
 * T-613-04..07 are diagnostics (the accessor is new). T-613-08 is a compatibility guard: the presenter's call log is
 * the same before and after the accessor exists, with or without a reader.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    alertTask,
    backgroundJobs,
    backgroundTask,
    resetTaskHostForTests,
    setTaskClockForTests,
    setTaskToastPresenter,
    taskReopened,
    taskShown,
    type TaskToastPresenter,
} from './alertTask.svelte'
import type { TaskClock, TaskDef, TaskView } from '../lib/Nexus/pattern/taskProgress'

const def: TaskDef = {
    title: 'Import',
    subtitle: 'Characters',
    steps: [{ label: 'Read file' }, { label: 'Add items', noun: 'Assets' }],
    onCancel: () => { },
    background: true,
}

interface FakePresenter extends TaskToastPresenter {
    posts: Array<{ view: TaskView, open(): void, end(): void }>
    log: string[]
    ends: Array<{ id: number, returnFocus: boolean }>
}

function fakePresenter(): FakePresenter {
    const posts: FakePresenter['posts'] = []
    const log: string[] = []
    const ends: FakePresenter['ends'] = []
    let nextId = 100
    return {
        posts,
        log,
        ends,
        post(view, on) {
            const id = nextId++
            posts.push({ view, ...on })
            log.push(`post:${id}`)
            return id
        },
        update(id, view) { log.push(`update:${id}:${view.state}`) },
        end(id, opts) {
            ends.push({ id, returnFocus: opts.returnFocus })
            log.push(`end:${id}:${opts.returnFocus}`)
        },
    }
}

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

let presenter: FakePresenter
let time: ReturnType<typeof manualClock>

beforeEach(() => {
    presenter = fakePresenter()
    time = manualClock()
    setTaskClockForTests(time.clock)
    setTaskToastPresenter(presenter)
})

afterEach(() => {
    resetTaskHostForTests()
    setTaskClockForTests(null)
    document.body.replaceChildren()
})

describe('backgroundJobs lists the backgrounded tasks that have not ended', () => {
    test('T-613-04: a backgrounded task is listed in backgrounding order with its view id, title and subtitle', () => {
        expect(backgroundJobs()).toEqual([])

        alertTask(def)
        expect(backgroundTask()).toBe(true)
        alertTask({ ...def, title: 'Second', subtitle: undefined })
        expect(backgroundTask()).toBe(true)

        const jobs = backgroundJobs()
        expect(jobs.map((job) => job.title)).toEqual(['Import', 'Second'])
        expect(jobs.map((job) => job.subtitle)).toEqual(['Characters', undefined])
        expect(jobs.map((job) => job.id)).toEqual(presenter.posts.map((post) => post.view.id))
        expect(new Set(jobs.map((job) => job.id)).size).toBe(2)
    })

    test('T-613-04: the card in the slot and a closed entry are not listed', () => {
        alertTask(def)
        backgroundTask()
        const closing = alertTask({ ...def, title: 'Closing' })
        backgroundTask()
        alertTask({ ...def, title: 'Shown' })

        expect(backgroundJobs().map((job) => job.title)).toEqual(['Import', 'Closing'])

        closing.close()

        expect(backgroundJobs().map((job) => job.title)).toEqual(['Import'])
    })

    test('T-613-05: an effect over the list re-runs on background, on a published view, on finish, on close and on reopen', () => {
        const seen: string[] = []
        const stopEffect = $effect.root(() => {
            $effect(() => {
                seen.push(backgroundJobs().map((job) => `${job.title}:${job.view.count?.done ?? '-'}`).join(','))
            })
        })
        flushSync()
        expect(seen).toEqual([''])

        const first = alertTask(def)
        backgroundTask()
        flushSync()
        expect(seen.at(-1)).toBe('Import:-')

        first.setStep(1)
        first.setCount(0, 10)
        time.advance(300)
        flushSync()
        expect(seen.at(-1)).toBe('Import:0')
        first.setCount(4, 10)
        time.advance(300)
        flushSync()
        expect(seen.at(-1)).toBe('Import:4')

        void first.finish({ headline: 'Done' })
        flushSync()
        expect(seen.at(-1)).toBe('')

        const second = alertTask({ ...def, title: 'Second' })
        backgroundTask()
        flushSync()
        expect(seen.at(-1)).toBe('Second:-')
        second.close()
        flushSync()
        expect(seen.at(-1)).toBe('')

        alertTask({ ...def, title: 'Third' })
        backgroundTask()
        flushSync()
        expect(seen.at(-1)).toBe('Third:-')
        expect(backgroundJobs()[0].open()).toBe(true)
        flushSync()
        expect(seen.at(-1)).toBe('')
        stopEffect()
    })

    test('T-613-06: cancel() requests the task\'s cancel once and the job stops offering it', () => {
        const onCancel = vi.fn()
        const handle = alertTask({ ...def, onCancel })
        backgroundTask()
        const job = backgroundJobs()[0]

        expect(job.canCancel).toBe(true)
        expect(job.cancel()).toBe(true)

        expect(onCancel).toHaveBeenCalledTimes(1)
        expect(handle.cancelRequested).toBe(true)
        expect(backgroundJobs()[0].view.state).toBe('cancelling')
        expect(backgroundJobs()[0].canCancel).toBe(false)
        expect(job.cancel()).toBe(false)
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    test('T-613-06: after lockCancel the job offers no cancel and cancel() does nothing; a task without onCancel never offers it', () => {
        const onCancel = vi.fn()
        const locked = alertTask({ ...def, onCancel })
        backgroundTask()
        expect(locked.lockCancel()).toBe(true)

        const job = backgroundJobs()[0]
        expect(job.canCancel).toBe(false)
        expect(job.cancel()).toBe(false)
        expect(onCancel).not.toHaveBeenCalled()

        alertTask({ ...def, title: 'Plain', onCancel: undefined })
        backgroundTask()
        const plain = backgroundJobs().find((candidate) => candidate.title === 'Plain')
        expect(plain?.canCancel).toBe(false)
        expect(plain?.cancel()).toBe(false)
    })

    test('T-613-07: open() brings the card back with the toast ended without a focus return', () => {
        alertTask(def)
        backgroundTask()

        expect(backgroundJobs()[0].open()).toBe(true)

        expect(taskShown()).toBe(true)
        expect(taskReopened()).toBe(true)
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: false }])
        expect(backgroundJobs()).toEqual([])
    })

    test('T-613-07: open() is false and changes nothing while another card is shown', () => {
        alertTask(def)
        backgroundTask()
        alertTask({ ...def, title: 'Shown' })

        expect(backgroundJobs()[0].open()).toBe(false)

        expect(taskReopened()).toBe(false)
        expect(presenter.ends).toEqual([])
        expect(backgroundJobs().map((job) => job.title)).toEqual(['Import'])
    })

    test('T-613-07: a call on a job whose entry has ended is a false no-op', () => {
        const onCancel = vi.fn()
        const handle = alertTask({ ...def, onCancel })
        backgroundTask()
        const job = backgroundJobs()[0]

        handle.close()

        expect(job.open()).toBe(false)
        expect(job.cancel()).toBe(false)
        expect(onCancel).not.toHaveBeenCalled()
        expect(taskShown()).toBe(false)
    })
})

describe('the presenter sees the same calls whether or not the jobs are read', () => {
    function run(readJobs: boolean): string[] {
        const handle = alertTask(def)
        backgroundTask()
        if (readJobs) backgroundJobs()
        handle.setStep(1)
        handle.setCount(0, 2)
        time.advance(300)
        handle.setCount(1, 2)
        if (readJobs) backgroundJobs()
        presenter.posts[0].open()
        backgroundTask()
        void handle.finish({ headline: 'Done' })
        if (readJobs) backgroundJobs()
        presenter.posts[1].end()
        return presenter.log.slice()
    }

    test('T-613-08: background, update, reopen, background again, finish and dismiss keep their order and ids', () => {
        const expected = ['post:100', 'update:100:running', 'end:100:false', 'post:101', 'update:101:done', 'end:101:true']

        expect(run(false)).toEqual(expected)

        resetTaskHostForTests()
        presenter = fakePresenter()
        time = manualClock()
        setTaskClockForTests(time.clock)
        setTaskToastPresenter(presenter)

        expect(run(true)).toEqual(expected)
    })
})
