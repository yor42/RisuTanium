// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    alertTask,
    answerTask,
    backgroundOffered,
    backgroundTask,
    backgroundTaskCount,
    registerDetachedModulesRound,
    requestTaskCancel,
    resetTaskHostForTests,
    setTaskClockForTests,
    setTaskToastPresenter,
    taskHostView,
    taskOpener,
    taskReopened,
    taskShown,
    type TaskCloseAnswer,
    type TaskToastPresenter,
} from './alertTask.svelte'
import type { TaskDef, TaskView } from '../lib/Nexus/pattern/taskProgress'

const def: TaskDef = {
    title: 'Import',
    steps: [{ label: 'Read file' }, { label: 'Add items' }],
    onCancel: () => { },
    background: true,
}

interface FakePresenter extends TaskToastPresenter {
    posts: Array<{ view: TaskView, open(): void, end(): void }>
    updates: Array<{ id: number, view: TaskView }>
    ends: Array<{ id: number, returnFocus: boolean }>
}

function fakePresenter(): FakePresenter {
    const posts: FakePresenter['posts'] = []
    const updates: FakePresenter['updates'] = []
    const ends: FakePresenter['ends'] = []
    let nextId = 100
    return {
        posts,
        updates,
        ends,
        post(view, on) {
            posts.push({ view, ...on })
            return nextId++
        },
        update(id, view) { updates.push({ id, view }) },
        end(id, opts) { ends.push({ id, returnFocus: opts.returnFocus }) },
    }
}

let presenter: FakePresenter

beforeEach(() => {
    presenter = fakePresenter()
    setTaskToastPresenter(presenter)
})

afterEach(() => {
    resetTaskHostForTests()
    document.body.replaceChildren()
})

async function settled(promise: Promise<unknown>): Promise<boolean> {
    let done = false
    void promise.then(() => { done = true })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    return done
}

describe('backgroundTask acceptance rules', () => {
    test('a running task with background and a presenter is accepted and leaves the slot empty', () => {
        const handle = alertTask(def)
        expect(taskShown()).toBe(true)
        expect(backgroundTask()).toBe(true)
        expect(taskShown()).toBe(false)
        expect(taskHostView()).toBeNull()
        expect(presenter.posts).toHaveLength(1)
        expect(presenter.posts[0].view.title).toBe('Import')
        expect(backgroundTaskCount()).toBe(1)
        expect(handle.backgrounded).toBe(true)
        expect(handle.inBackground).toBe(true)
        expect(handle.detached).toBe(false)
    })

    test('nothing is accepted in confirm', () => {
        alertTask({ ...def, confirm: { headline: 'Go', cancelLabel: 'No', primaryLabel: 'Yes' } })
        expect(backgroundTask()).toBe(false)
        expect(taskShown()).toBe(true)
        expect(presenter.posts).toHaveLength(0)
    })

    test('nothing is accepted in cancelling', () => {
        alertTask(def)
        requestTaskCancel()
        expect(taskHostView()?.state).toBe('cancelling')
        expect(backgroundTask()).toBe(false)
        expect(presenter.posts).toHaveLength(0)
    })

    test('nothing is accepted on a result', () => {
        const handle = alertTask(def)
        void handle.finish({ headline: 'Done' })
        expect(backgroundTask()).toBe(false)
        expect(presenter.posts).toHaveLength(0)
    })

    test('nothing is accepted without background on the def', () => {
        alertTask({ ...def, background: undefined })
        expect(backgroundTask()).toBe(false)
        expect(taskShown()).toBe(true)
    })

    test('nothing is accepted without a presenter', () => {
        setTaskToastPresenter(null)
        alertTask(def)
        expect(backgroundTask()).toBe(false)
        expect(taskShown()).toBe(true)
    })

    test('nothing is accepted with no task shown', () => {
        expect(backgroundTask()).toBe(false)
    })

    test('a held def refuses until offered; a withdrawn handle refuses for good', () => {
        const held = alertTask({ ...def, backgroundHeld: true })
        expect(backgroundTask()).toBe(false)
        held.offerBackground()
        expect(taskHostView()?.background).toBe(true)
        held.withdrawBackground()
        expect(taskHostView()?.background).toBeUndefined()
        held.offerBackground()
        expect(backgroundTask()).toBe(false)
        expect(taskShown()).toBe(true)
    })

    test('withdraw and offer on a detached handle do nothing', () => {
        const first = alertTask(def)
        alertTask(def)
        expect(first.detached).toBe(true)
        expect(() => { first.withdrawBackground(); first.offerBackground() }).not.toThrow()
        expect(taskHostView()?.background).toBe(true)
    })
})

describe('a backgrounded task', () => {
    test('keeps its write gate: lockCancel is true and Cancel from the slot is a no-op', () => {
        const onCancel = vi.fn()
        const handle = alertTask({ ...def, onCancel })
        expect(backgroundTask()).toBe(true)
        requestTaskCancel()
        expect(onCancel).not.toHaveBeenCalled()
        expect(handle.lockCancel()).toBe(true)
        expect(handle.cancelRequested).toBe(false)
    })

    test('forwards progress and its result to the presenter and keeps the closed promise pending', async () => {
        // The controller publishes at most once per interval, so the clock passes it before the progress calls.
        let time = 0
        setTaskClockForTests({
            now: () => time,
            setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
            clearTimeout: () => { },
            hidden: () => false,
        })
        const handle = alertTask(def)
        backgroundTask()
        time = 300
        handle.setStep(1)
        handle.setCount(1, 4)
        expect(presenter.updates.length).toBeGreaterThan(0)
        const last = presenter.updates[presenter.updates.length - 1]
        expect(last.id).toBe(100)
        expect(last.view.stepIndex).toBe(1)
        const closed = handle.finish({ headline: 'Done' })
        expect(presenter.updates[presenter.updates.length - 1].view.state).toBe('done')
        expect(await settled(closed)).toBe(false)
    })

    test('the end callback of a terminal task resolves dismissed and removes the toast', async () => {
        const handle = alertTask(def)
        backgroundTask()
        const closed = handle.finish({ headline: 'Done' })
        presenter.posts[0].end()
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'dismissed' })
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: true }])
        expect(backgroundTaskCount()).toBe(0)
        expect(handle.detached).toBe(true)
    })

    test('the end callback of a running task changes nothing', async () => {
        const handle = alertTask(def)
        backgroundTask()
        presenter.posts[0].end()
        expect(handle.detached).toBe(false)
        expect(backgroundTaskCount()).toBe(1)
        expect(await settled(handle.finish({ headline: 'x' }))).toBe(false)
    })

    test('close() ends the toast with focus return and resolves closed', async () => {
        const handle = alertTask(def)
        backgroundTask()
        const closed = handle.finish({ headline: 'Done' })
        handle.close()
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'closed' })
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: true }])
        expect(backgroundTaskCount()).toBe(0)
    })

    test('a test reset ends every toast', () => {
        alertTask(def)
        backgroundTask()
        resetTaskHostForTests()
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: true }])
        expect(backgroundTaskCount()).toBe(0)
    })

    test('presenter teardown detaches every background entry as closed', async () => {
        const handle = alertTask(def)
        backgroundTask()
        const closed = handle.finish({ headline: 'Done' })
        setTaskToastPresenter(null)
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'closed' })
        expect(backgroundTaskCount()).toBe(0)
        expect(handle.detached).toBe(true)
    })

    test('a newer task replaces only the shown card and leaves the background entry alone', async () => {
        const a = alertTask(def)
        backgroundTask()
        const b = alertTask(def)
        expect(a.detached).toBe(false)
        expect(taskShown()).toBe(true)
        const c = alertTask(def)
        expect(b.detached).toBe(true)
        expect(a.detached).toBe(false)
        expect(c.detached).toBe(false)
        expect(backgroundTaskCount()).toBe(1)
        const closedA = a.finish({ headline: 'Done' })
        expect(presenter.updates[presenter.updates.length - 1].view.state).toBe('done')
        expect(await settled(closedA)).toBe(false)
    })
})

describe('reopening from the toast', () => {
    test('brings the same controller back to the slot without ending its toast focus', () => {
        const button = document.createElement('button')
        document.body.appendChild(button)
        button.focus()
        const handle = alertTask(def)
        const id = taskHostView()!.id
        backgroundTask()
        expect(taskReopened()).toBe(false)
        presenter.posts[0].open()
        expect(taskHostView()?.id).toBe(id)
        expect(taskReopened()).toBe(true)
        expect(taskOpener()).toBe(button)
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: false }])
        expect(handle.inBackground).toBe(false)
        expect(handle.backgrounded).toBe(true)
        expect(backgroundTaskCount()).toBe(0)
    })

    test('a reopened card can be sent to the background again', () => {
        alertTask(def)
        backgroundTask()
        presenter.posts[0].open()
        expect(backgroundTask()).toBe(true)
        expect(presenter.posts).toHaveLength(2)
        expect(taskReopened()).toBe(false)
    })

    test('is refused while a card is shown', () => {
        alertTask(def)
        backgroundTask()
        alertTask(def)
        presenter.posts[0].open()
        expect(backgroundTaskCount()).toBe(1)
        expect(presenter.ends).toEqual([])
        expect(taskReopened()).toBe(false)
    })

    test('a result answered after the reopen settles the closed promise with the answer', async () => {
        const handle = alertTask(def)
        backgroundTask()
        const closed = handle.finish({ headline: 'Done' })
        presenter.posts[0].open()
        answerTask({ kind: 'ok' })
        expect(await closed).toEqual<TaskCloseAnswer>({ kind: 'ok' })
        expect(presenter.ends).toEqual([{ id: 100, returnFocus: false }])
    })
})

describe('a replaced Modules round that may still Replace', () => {
    test('no card offers background while one is registered, and the offer returns when it ends', () => {
        const unregister = registerDetachedModulesRound()
        expect(backgroundOffered()).toBe(false)
        alertTask(def)
        expect(backgroundTask()).toBe(false)
        expect(taskShown()).toBe(true)
        unregister()
        expect(backgroundOffered()).toBe(true)
        expect(backgroundTask()).toBe(true)
    })

    test('two rounds count separately and unregistering twice is harmless', () => {
        const first = registerDetachedModulesRound()
        const second = registerDetachedModulesRound()
        first()
        first()
        expect(backgroundOffered()).toBe(false)
        second()
        expect(backgroundOffered()).toBe(true)
    })

    test('a test reset clears the registrations', () => {
        registerDetachedModulesRound()
        resetTaskHostForTests()
        expect(backgroundOffered()).toBe(true)
    })
})
