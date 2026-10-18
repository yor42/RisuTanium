/**
 * The quiet trigger (`../memory/putBackQuiet`): says when a large loaded character may be judged. Hidden after the
 * save committed, or 30 s without input with the save committed; the callback goes through an idle slot; stopping
 * removes every `document` listener.
 *
 * What is a stand-in: the save loop (`afterNextSaveCommit` collects callbacks and `commit()` runs them;
 * `isSaveClean` answers `h.clean`) and the clock (fake timers, `performance` included). Labels: "acceptance" tests
 * the trigger, which does not exist on the red base (the W4b-1 commit).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    commits: [] as Array<() => void>,
    clean: true,
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    afterNextSaveCommit: (callback: () => void) => { h.commits.push(callback) },
    isSaveClean: () => h.clean,
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { IDLE_MS, startQuietTrigger, type QuietTrigger } from 'src/ts/process/memory/putBackQuiet'

let trigger: QuietTrigger | null = null

function commit(): void {
    for (const callback of h.commits.splice(0)) {
        callback()
    }
}

function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

/** A zero timer started inside a timer callback runs one millisecond later, so a step that ends in one needs a little slack. */
const SLACK_MS = 5

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
    vi.stubGlobal('requestIdleCallback', undefined)
    h.commits.length = 0
    h.clean = true
    setVisibility('visible')
})

afterEach(() => {
    trigger?.stop()
    trigger = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'visibilityState')
    vi.restoreAllMocks()
})

describe('hidden after the save committed', () => {
    test('acceptance: a page that is already hidden runs the callback from an idle slot, once', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        setVisibility('hidden')

        trigger.arm()
        trigger.arm()
        expect(run).not.toHaveBeenCalled()
        vi.advanceTimersByTime(SLACK_MS)

        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance: a page that becomes hidden while armed runs it', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()

        setVisibility('hidden')
        vi.advanceTimersByTime(SLACK_MS)

        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance: with the save not committed it waits for the commit and then runs', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        h.clean = false
        setVisibility('hidden')
        trigger.arm()

        vi.advanceTimersByTime(SLACK_MS)
        expect(run).not.toHaveBeenCalled()
        expect(h.commits.length).toBe(1)

        h.clean = true
        commit()
        vi.advanceTimersByTime(SLACK_MS)
        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance: a page that was shown again by the commit waits for the idle time instead', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        h.clean = false
        setVisibility('hidden')
        trigger.arm()
        vi.advanceTimersByTime(SLACK_MS)

        setVisibility('visible')
        h.clean = true
        commit()
        vi.advanceTimersByTime(SLACK_MS)
        expect(run).not.toHaveBeenCalled()

        vi.advanceTimersByTime(IDLE_MS + SLACK_MS)
        expect(run).toHaveBeenCalledTimes(1)
    })
})

describe('30 s without input', () => {
    test('acceptance: runs at 30 s through a zero timer where there is no idle callback', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()

        vi.advanceTimersByTime(IDLE_MS - 1)
        expect(run).not.toHaveBeenCalled()
        vi.advanceTimersByTime(SLACK_MS)

        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance: runs through the idle callback, with its timeout, where it exists', () => {
        const idle = vi.fn((callback: () => void) => { callback(); return 1 })
        vi.stubGlobal('requestIdleCallback', idle)
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()

        vi.advanceTimersByTime(IDLE_MS)

        expect(idle).toHaveBeenCalledTimes(1)
        expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 })
        expect(run).toHaveBeenCalledTimes(1)
    })

    test.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])('acceptance: a %s starts the 30 s again', (type) => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()

        vi.advanceTimersByTime(20_000)
        document.dispatchEvent(new Event(type))
        vi.advanceTimersByTime(IDLE_MS - 1)
        expect(run).not.toHaveBeenCalled()
        vi.advanceTimersByTime(SLACK_MS)

        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance (F5): with the save not committed the 30 s do not run it; the commit does', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        h.clean = false
        trigger.arm()

        vi.advanceTimersByTime(5 * IDLE_MS)
        expect(run).not.toHaveBeenCalled()
        expect(h.commits.length).toBe(1)

        h.clean = true
        commit()
        vi.advanceTimersByTime(SLACK_MS)
        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance: input between the 30 s timer and the idle slot postpones the run to a new quiet period', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()
        vi.advanceTimersByTime(IDLE_MS)

        document.dispatchEvent(new Event('keydown'))
        vi.advanceTimersByTime(SLACK_MS)
        expect(run).not.toHaveBeenCalled()

        vi.advanceTimersByTime(IDLE_MS + SLACK_MS)
        expect(run).toHaveBeenCalledTimes(1)
    })

    test('acceptance: arming again after a run asks again, and a page that has had input since waits the full time', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()
        vi.advanceTimersByTime(IDLE_MS + SLACK_MS)
        expect(run).toHaveBeenCalledTimes(1)

        document.dispatchEvent(new Event('keydown'))
        trigger.arm()
        vi.advanceTimersByTime(IDLE_MS - 1)
        expect(run).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(SLACK_MS)
        expect(run).toHaveBeenCalledTimes(2)
    })
})

describe('stopping (F5)', () => {
    test('acceptance: every document listener it installed is removed, with the same handler and capture option', () => {
        const added = vi.spyOn(document, 'addEventListener')
        const removed = vi.spyOn(document, 'removeEventListener')
        trigger = startQuietTrigger(vi.fn())

        trigger.stop()

        expect(added.mock.calls.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown', 'touchstart', 'visibilitychange', 'wheel'])
        for (const [type, handler, options] of added.mock.calls) {
            const capture = typeof options === 'object' && options !== null && options.capture === true
            expect(removed.mock.calls.some(([removedType, removedHandler, removedOptions]) => removedType === type && removedHandler === handler
                && (typeof removedOptions === 'object' && removedOptions !== null && removedOptions.capture === true) === capture)).toBe(true)
        }
    })

    test('acceptance: a request that is waiting never runs after the stop, and arming after the stop does nothing', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()
        vi.advanceTimersByTime(IDLE_MS - 1)

        trigger.stop()
        vi.advanceTimersByTime(10 * IDLE_MS)
        trigger.arm()
        setVisibility('hidden')
        vi.advanceTimersByTime(10 * IDLE_MS)

        expect(run).not.toHaveBeenCalled()
    })

    test('acceptance: the input listeners are passive and capturing, so they never delay scrolling or input', () => {
        const added = vi.spyOn(document, 'addEventListener')
        trigger = startQuietTrigger(vi.fn())

        const inputCalls = added.mock.calls.filter(([type]) => type !== 'visibilitychange')

        expect(inputCalls.length).toBe(4)
        for (const [, , options] of inputCalls) {
            expect(options).toMatchObject({ capture: true, passive: true })
        }
    })

    test('acceptance: a stop between the idle time and the idle slot cancels the run', () => {
        const run = vi.fn()
        trigger = startQuietTrigger(run)
        trigger.arm()
        vi.advanceTimersByTime(IDLE_MS)

        trigger.stop()
        vi.advanceTimersByTime(SLACK_MS)

        expect(run).not.toHaveBeenCalled()
    })
})
