// @vitest-environment jsdom

/**
 * The task-toast channel of the toast host: in-place updates, the clean-finish hold, the 2-visible window, holds and
 * suspension, owner removal and its focus-return seam. Every host runs on a fake clock; `recordCaughtError` is mocked
 * so a throwing callback can be asserted.
 */
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const recordCaughtError = vi.hoisted(() => vi.fn())
vi.mock('../caughtErrors', () => ({ recordCaughtError }))

import {
    createToastHost,
    type TaskToastContent,
    type TaskToastInit,
    type ToastClock,
    type ToastConfig,
    type ToastHost,
} from './toastHost.svelte'

interface FakeClock extends ToastClock {
    advance(ms: number): void
}

function fakeClock(): FakeClock {
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
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) {
                    break
                }
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

function content(over: Partial<TaskToastContent> = {}): TaskToastContent {
    return { title: 'Import', line: 'File 1 of 2', mark: 'transfer_in', fraction: 0.1, determinate: true, badge: false, phase: 'running', openLabel: 'Open', ...over }
}

function init(over: Partial<TaskToastInit> = {}): TaskToastInit {
    return { ...content(), onOpen: () => { }, onEnd: () => { }, ...over }
}

function setup(config?: Partial<ToastConfig>) {
    const clock = fakeClock()
    const host = createToastHost({ clock, config })
    return { clock, host }
}

afterEach(() => {
    recordCaughtError.mockReset()
})

function ids(host: ToastHost): number[] {
    return host.tasks.map((task) => task.id)
}

describe('task toast channel: lifecycle', () => {
    test('a running task toast shows and has no timer', () => {
        const { clock, host } = setup()
        const id = host.postTask(init())
        expect(host.tasks.map((task) => task.id)).toEqual([id])
        clock.advance(120000)
        expect(ids(host)).toEqual([id])
    })

    test('updateTask keeps the entry (same id) and bumps version only for a changed field', () => {
        const { host } = setup()
        const id = host.postTask(init())
        const before = host.version
        host.updateTask(id, content({ line: 'File 2 of 2' }))
        expect(host.version).toBe(before + 1)
        expect(ids(host)).toEqual([id])
        expect(host.tasks[0].line).toBe('File 2 of 2')
        host.updateTask(id, content({ line: 'File 2 of 2' }))
        expect(host.version).toBe(before + 1)
    })

    test('a clean finish hides after exactly 6000 ms and calls onEnd(hidden) after the entry is gone', () => {
        const { clock, host } = setup()
        let seenAtEnd = -1
        const onEnd = vi.fn((_why: 'dismissed' | 'hidden') => { seenAtEnd = host.tasks.length })
        const id = host.postTask(init({ onEnd }))
        host.updateTask(id, content({ phase: 'done', title: 'Imported' }))
        clock.advance(5999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
        expect(onEnd).toHaveBeenCalledTimes(1)
        expect(onEnd).toHaveBeenCalledWith('hidden')
        expect(seenAtEnd).toBe(0)
    })

    test('the done hold is taskDoneMs, not the plain success duration', () => {
        const { clock, host } = setup({ taskDoneMs: 2000 })
        const id = host.postTask(init())
        host.updateTask(id, content({ phase: 'done' }))
        clock.advance(1999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
    })

    test('a stays phase never hides', () => {
        const { clock, host } = setup()
        const id = host.postTask(init())
        host.updateTask(id, content({ phase: 'stays', badge: true }))
        clock.advance(600000)
        expect(ids(host)).toEqual([id])
    })

    test('leaving done clears the timer', () => {
        const { clock, host } = setup()
        const id = host.postTask(init())
        host.updateTask(id, content({ phase: 'done' }))
        clock.advance(3000)
        host.updateTask(id, content({ phase: 'stays' }))
        clock.advance(600000)
        expect(ids(host)).toEqual([id])
    })

    test('dismissTask removes the entry and calls onEnd(dismissed)', () => {
        const { host } = setup()
        const onEnd = vi.fn()
        const id = host.postTask(init({ onEnd }))
        host.dismissTask(id)
        expect(ids(host)).toEqual([])
        expect(onEnd).toHaveBeenCalledWith('dismissed')
        expect(onEnd).toHaveBeenCalledTimes(1)
    })

    test('endTask is an owner removal: no onEnd call', () => {
        const { clock, host } = setup()
        const onEnd = vi.fn()
        const id = host.postTask(init({ onEnd }))
        host.updateTask(id, content({ phase: 'done' }))
        host.endTask(id)
        clock.advance(10000)
        expect(ids(host)).toEqual([])
        expect(onEnd).not.toHaveBeenCalled()
    })

    test('a throwing callback is caught and logged under toast.task', () => {
        const { host } = setup()
        const id = host.postTask(init({ onEnd: () => { throw new Error('boom') } }))
        expect(() => host.dismissTask(id)).not.toThrow()
        expect(recordCaughtError).toHaveBeenCalledWith('toast.task', expect.any(Error))
        expect(ids(host)).toEqual([])
    })

    test('task ids share the plain counter, so an id is unique across both lists', () => {
        const { host } = setup()
        const plain = host.post({ text: 'plain' })
        const task = host.postTask(init())
        expect(task).not.toBe(plain)
    })

    test('reset clears task entries and their timers', () => {
        const { clock, host } = setup()
        const onEnd = vi.fn()
        const id = host.postTask(init({ onEnd }))
        host.updateTask(id, content({ phase: 'done' }))
        host.reset()
        expect(ids(host)).toEqual([])
        clock.advance(10000)
        expect(onEnd).not.toHaveBeenCalled()
    })
})

describe('task toast channel: focus-return skip and unknown ids', () => {
    test('endTask with returnFocus false skips the view focus return exactly once', () => {
        const { host } = setup()
        const id = host.postTask(init())
        host.endTask(id, { returnFocus: false })
        expect(host.takeFocusReturnSkip()).toBe(true)
        expect(host.takeFocusReturnSkip()).toBe(false)
    })

    test('endTask without the option leaves the skip off', () => {
        const { host } = setup()
        const id = host.postTask(init())
        host.endTask(id)
        expect(host.takeFocusReturnSkip()).toBe(false)
    })

    test('an unknown id is a no-op: no publish, no throw, no announcement, no skip latch', () => {
        const { host } = setup()
        host.postTask(init())
        const version = host.version
        const polite = host.polite.seq
        expect(() => {
            host.updateTask(999, content({ line: 'x' }), { text: 'spoken' })
            host.dismissTask(999)
            host.endTask(999, { returnFocus: false })
        }).not.toThrow()
        expect(host.version).toBe(version)
        expect(host.polite.seq).toBe(polite)
        expect(host.takeFocusReturnSkip()).toBe(false)
        expect(host.tasks).toHaveLength(1)
    })
})

describe('task toast channel: window and holds', () => {
    function three(host: ToastHost): number[] {
        return [host.postTask(init({ title: 'A' })), host.postTask(init({ title: 'B' })), host.postTask(init({ title: 'C' }))]
    }

    test('3 tasks show the last 2 and name the rest', () => {
        const { host } = setup()
        three(host)
        expect(host.tasks.map((task) => task.shown)).toEqual([false, true, true])
        expect(host.tasks.map((task) => task.newest)).toEqual([false, false, true])
        expect(host.tasksHidden).toBe(1)
        expect(host.tasksExpanded).toBe(false)
    })

    test('expanding shows all and collapsing returns; at 2 or fewer expansion resets', () => {
        const { host } = setup()
        const [a] = three(host)
        host.toggleTasksExpanded()
        expect(host.tasksExpanded).toBe(true)
        expect(host.tasks.map((task) => task.shown)).toEqual([true, true, true])
        expect(host.tasksHidden).toBe(0)
        host.toggleTasksExpanded()
        expect(host.tasks.map((task) => task.shown)).toEqual([false, true, true])
        host.toggleTasksExpanded()
        host.endTask(a)
        expect(host.tasksExpanded).toBe(false)
        expect(host.tasks.map((task) => task.shown)).toEqual([true, true])
    })

    test('a collapsed done entry does not count down; expanding starts it', () => {
        const { clock, host } = setup()
        const [a] = three(host)
        host.updateTask(a, content({ phase: 'done', title: 'A' }))
        clock.advance(60000)
        expect(ids(host)).toContain(a)
        host.toggleTasksExpanded()
        clock.advance(5999)
        expect(ids(host)).toContain(a)
        clock.advance(1)
        expect(ids(host)).not.toContain(a)
    })

    test('task entries do not count toward the plain maxVisible and plain admission is unchanged', () => {
        const { host } = setup()
        host.postTask(init())
        host.postTask(init())
        host.post({ text: 'one' })
        host.post({ text: 'two' })
        host.post({ text: 'three' })
        expect(host.visible.map((toast) => toast.text)).toEqual(['one', 'two', 'three'])
        expect(host.tasks.map((task) => task.shown)).toEqual([true, true])
        expect(host.count()).toEqual({ visible: 3, queued: 0, suspenders: 0, pausers: 0 })
    })

    test('hover and focus holds stop the clock and resume with the time left', () => {
        const { clock, host } = setup()
        const id = host.postTask(init())
        host.updateTask(id, content({ phase: 'done' }))
        clock.advance(2000)
        host.setHold('hover', true)
        clock.advance(60000)
        expect(ids(host)).toEqual([id])
        host.setHold('hover', false)
        host.setHold('focus', true)
        clock.advance(60000)
        expect(ids(host)).toEqual([id])
        host.setHold('focus', false)
        clock.advance(3999)
        expect(ids(host)).toEqual([id])
        clock.advance(1)
        expect(ids(host)).toEqual([])
    })

    test('a pause and a suspension hold the clock', () => {
        const { clock, host } = setup()
        const id = host.postTask(init())
        host.updateTask(id, content({ phase: 'done' }))
        let paused = $state(false)
        let covered = $state(false)
        const cleanup = $effect.root(() => {
            host.pauseWhile(() => paused)
            host.suspendWhile(() => covered)
        })
        paused = true
        flushSync()
        clock.advance(60000)
        expect(ids(host)).toEqual([id])
        paused = false
        covered = true
        flushSync()
        clock.advance(60000)
        expect(ids(host)).toEqual([id])
        covered = false
        flushSync()
        clock.advance(6000)
        expect(ids(host)).toEqual([])
        cleanup()
    })
})

describe('task toast channel: announcements', () => {
    test('postTask and updateTask announce only when given text; assertive goes to the assertive region', () => {
        const { host } = setup()
        const id = host.postTask(init({ announce: { text: 'continues in the background' } }))
        expect(host.polite.text).toBe('continues in the background')
        const politeSeq = host.polite.seq
        host.updateTask(id, content({ line: 'File 2 of 2' }))
        expect(host.polite.seq).toBe(politeSeq)
        host.updateTask(id, content({ phase: 'stays', title: 'Failed' }), { text: 'Failed', assertive: true })
        expect(host.assertive.text).toBe('Failed')
        expect(host.polite.seq).toBe(politeSeq)
    })

    test('an announcement is held while suspended', () => {
        const { host } = setup()
        let covered = $state(true)
        const cleanup = $effect.root(() => { host.suspendWhile(() => covered) })
        flushSync()
        host.postTask(init({ announce: { text: 'held' } }))
        expect(host.polite.text).toBe('')
        covered = false
        flushSync()
        expect(host.polite.text).toBe('held')
        cleanup()
    })
})
