/**
 * The guard that keeps the keep-alive service up from a hidden reply's end until a commit covers the
 * reply's marks (`../hiddenReplySaveGuard`). The first half drives the guard with fake dependencies
 * and the REAL in-flight registry; the second half drives the page wiring with stubbed persistence
 * counters and a stopped seam that behaves like the store (the real store is covered by the store2
 * suite). Mocked success does not prove native WebView behavior.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { inFlightKinds, resetInFlightForTest, subscribeInFlight, beginInFlight } from 'src/ts/process/inFlightWork'

const api = vi.hoisted(() => ({
    marks: 0,
    committed: 0,
    callbacks: new Set<() => void>(),
    /** The stopped reason as the store holds it: '' while saving runs. */
    reason: '',
    stoppedListeners: new Set<() => void>(),
}))

// The stopped seam behaves like the real one: a subscriber is called at once with the current value
// and only a truthy reason counts.
vi.mock('src/ts/globalApi.svelte', () => ({
    getSaveMarkCount: () => api.marks,
    getCommittedSaveMarkCount: () => api.committed,
    afterNextSaveCommit: (callback: () => void) => { api.callbacks.add(callback) },
    isSavingStopped: () => Boolean(api.reason),
    onSavingStopped: (callback: () => void) => {
        if (api.reason) {
            callback()
        }
        api.stoppedListeners.add(callback)
        return () => { api.stoppedListeners.delete(callback) }
    },
}))

function setStoppedReason(reason: string): void {
    api.reason = reason
    for (const listener of [...api.stoppedListeners]) {
        if (reason) {
            listener()
        }
    }
}

import {
    createHiddenReplySaveGuard, holdHiddenReplySave, resetHiddenReplySaveGuardForTest,
    HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS, type HiddenReplySaveGuardDeps,
} from 'src/ts/process/hiddenReplySaveGuard'

//#region fake world

interface FakeWorld {
    deps: HiddenReplySaveGuardDeps
    state: { marks: number, committed: number, hidden: boolean, stopped: string, throwOnCommittedRead: boolean }
    callbacks: Set<() => void>
    visibilityListeners: Set<() => void>
    stoppedListeners: Set<() => void>
    timers: Array<{ callback: () => void, ms: number, live: boolean }>
    /** A commit that covers marks up to `covered`; fires and forgets the registered callbacks like the real registry. */
    commit(covered: number): void
    setHidden(hidden: boolean): void
    stop(reason: string): void
}

function fakeWorld(options: { stoppedListenerCallsAtOnce?: boolean } = {}): FakeWorld {
    const state = { marks: 1, committed: 0, hidden: true, stopped: '', throwOnCommittedRead: false }
    const callbacks = new Set<() => void>()
    const visibilityListeners = new Set<() => void>()
    const stoppedListeners = new Set<() => void>()
    const timers: FakeWorld['timers'] = []
    const deps: HiddenReplySaveGuardDeps = {
        getMarkCount: () => state.marks,
        getCommittedMarkCount: () => {
            if (state.throwOnCommittedRead) {
                throw new Error('read failed')
            }
            return state.committed
        },
        afterNextCommit: (callback) => { callbacks.add(callback) },
        begin: () => beginInFlight('save'),
        isHidden: () => state.hidden,
        onVisibility: (callback) => {
            visibilityListeners.add(callback)
            return () => { visibilityListeners.delete(callback) }
        },
        isStopped: () => Boolean(state.stopped),
        onStopped: (callback) => {
            stoppedListeners.add(callback)
            if (options.stoppedListenerCallsAtOnce) {
                callback()
            }
            return () => { stoppedListeners.delete(callback) }
        },
        schedule: (callback, ms) => {
            const timer = { callback, ms, live: true }
            timers.push(timer)
            return () => { timer.live = false }
        },
    }
    return {
        deps, state, callbacks, visibilityListeners, stoppedListeners, timers,
        commit(covered) {
            state.committed = Math.max(state.committed, covered)
            for (const callback of [...callbacks]) {
                callbacks.delete(callback)
                try { callback() } catch { /* the registry logs and continues */ }
            }
        },
        setHidden(hidden) {
            state.hidden = hidden
            for (const listener of [...visibilityListeners]) {
                listener()
            }
        },
        stop(reason) {
            state.stopped = reason
            for (const listener of [...stoppedListeners]) {
                listener()
            }
        },
    }
}

function liveTimers(world: FakeWorld): FakeWorld['timers'] {
    return world.timers.filter((timer) => timer.live)
}

function expectNothingLeaked(world: FakeWorld): void {
    expect(inFlightKinds()).toEqual([])
    expect(world.visibilityListeners.size).toBe(0)
    expect(world.stoppedListeners.size).toBe(0)
    expect(liveTimers(world)).toHaveLength(0)
}

//#endregion

beforeEach(() => {
    resetInFlightForTest()
    api.marks = 0
    api.committed = 0
    api.callbacks.clear()
    api.reason = ''
    api.stoppedListeners.clear()
    resetHiddenReplySaveGuardForTest()
})

afterEach(() => {
    resetHiddenReplySaveGuardForTest()
    resetInFlightForTest()
    Reflect.deleteProperty(document, 'visibilityState')
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('the guard with fake dependencies', () => {
    test('a hidden reply with an uncommitted mark holds one save token', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)

        guard.hold()

        expect(inFlightKinds()).toEqual(['save'])
        expect(guard.held()).toBe(true)
        expect(world.callbacks.size).toBe(1)
    })

    test('a mark already covered by a commit holds nothing', () => {
        const world = fakeWorld()
        world.state.committed = 1
        const guard = createHiddenReplySaveGuard(world.deps)

        guard.hold()

        expect(inFlightKinds()).toEqual([])
        expect(guard.held()).toBe(false)
    })

    test('a second hidden reply raises the target and adds no token or registration', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        world.state.marks = 3
        guard.hold()

        expect(world.callbacks.size).toBe(1)
        world.commit(2)
        expect(guard.held()).toBe(true)
        world.commit(3)
        expect(guard.held()).toBe(false)
        expectNothingLeaked(world)
    })

    test('a commit covering the marks releases the token and every listener', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()

        world.commit(1)

        expectNothingLeaked(world)
    })

    test('a commit that predates the reply re-registers and keeps the token', () => {
        const world = fakeWorld()
        world.state.marks = 5
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()

        world.commit(4)

        expect(guard.held()).toBe(true)
        expect(world.callbacks.size).toBe(1)
        world.commit(5)
        expectNothingLeaked(world)
    })

    test('a throwing read of the committed count still re-registers', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        world.state.throwOnCommittedRead = true
        world.commit(1)
        world.state.throwOnCommittedRead = false

        expect(guard.held()).toBe(true)
        expect(world.callbacks.size).toBe(1)
        world.commit(1)
        expectNothingLeaked(world)
    })

    test('saving stopped releases the token', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()

        world.stop('too large')

        expectNothingLeaked(world)
    })

    test('saving already stopped holds nothing', () => {
        const world = fakeWorld()
        world.state.stopped = 'too large'
        const guard = createHiddenReplySaveGuard(world.deps)

        guard.hold()

        expect(inFlightKinds()).toEqual([])
        expect(world.visibilityListeners.size).toBe(0)
    })

    test('a stopped notice delivered during subscription leaves no token or listener behind', () => {
        const world = fakeWorld({ stoppedListenerCallsAtOnce: true })
        const guard = createHiddenReplySaveGuard(world.deps)

        guard.hold()

        expect(guard.held()).toBe(false)
        expectNothingLeaked(world)
    })

    test('becoming visible does not release; the bound does, after continuous visibility', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        expect(liveTimers(world)).toHaveLength(0)

        world.setHidden(false)

        expect(guard.held()).toBe(true)
        const live = liveTimers(world)
        expect(live).toHaveLength(1)
        expect(live[0].ms).toBe(HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS)
        live[0].callback()
        expectNothingLeaked(world)
    })

    test('hiding again cancels the bound and keeps the token; visible again arms a fresh bound', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        world.setHidden(false)
        world.setHidden(true)

        expect(guard.held()).toBe(true)
        expect(liveTimers(world)).toHaveLength(0)
        world.setHidden(false)
        expect(liveTimers(world)).toHaveLength(1)
        expect(guard.held()).toBe(true)
    })

    test('repeated visibility changes while visible arm a single bound', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        world.setHidden(false)
        world.setHidden(false)

        expect(liveTimers(world)).toHaveLength(1)
    })

    test('a commit after the bound armed cancels the bound', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        world.setHidden(false)

        world.commit(1)

        expectNothingLeaked(world)
    })

    test('release is idempotent', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        guard.release()
        guard.release()
        world.commit(1)

        expectNothingLeaked(world)
    })

    test('a late callback after release does nothing, and a later reply begins a fresh token', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        guard.hold()
        guard.release()
        expect(world.callbacks.size).toBe(1)
        world.commit(1)
        expect(world.callbacks.size).toBe(0)

        world.state.marks = 2
        guard.hold()

        expect(inFlightKinds()).toEqual(['save'])
        expect(guard.held()).toBe(true)
    })

    test('release, then begin, then several uncovered commits keeps the registrations bounded', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        for (let cycle = 0; cycle < 4; cycle++) {
            world.state.marks += 1
            guard.hold()
            guard.release()
        }
        world.state.marks += 100
        guard.hold()

        for (let commit = 1; commit <= 5; commit++) {
            expect(world.callbacks.size).toBeLessThanOrEqual(1)
            world.commit(commit)
            expect(guard.held()).toBe(true)
        }
        expect(world.callbacks.size).toBe(1)
    })

    test('the token is a save kind that notifies the registry on begin and end', () => {
        const world = fakeWorld()
        const guard = createHiddenReplySaveGuard(world.deps)
        const seen: string[][] = []
        const off = subscribeInFlight(() => seen.push(inFlightKinds()))

        guard.hold()
        guard.release()
        off()

        expect(seen).toEqual([['save'], []])
    })
})

describe('the page wiring', () => {
    function setVisibility(state: 'visible' | 'hidden'): void {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    }

    function commitAt(covered: number): void {
        api.committed = Math.max(api.committed, covered)
        for (const callback of [...api.callbacks]) {
            api.callbacks.delete(callback)
            callback()
        }
    }

    beforeEach(() => {
        vi.useFakeTimers()
        setVisibility('hidden')
        api.marks = 1
    })

    // The store's "not stopped" value is the empty string, and a store calls its subscriber at once.
    test('a running save (empty stopped reason) holds the token until a covering commit', () => {
        holdHiddenReplySave()

        expect(inFlightKinds()).toEqual(['save'])
        commitAt(0)
        expect(inFlightKinds()).toEqual(['save'])
        commitAt(1)
        expect(inFlightKinds()).toEqual([])
    })

    test('a stopped reason set while held releases the token', () => {
        holdHiddenReplySave()

        setStoppedReason('too large')

        expect(inFlightKinds()).toEqual([])
    })

    test('a stopped reason already set holds nothing', () => {
        setStoppedReason('too large')

        holdHiddenReplySave()

        expect(inFlightKinds()).toEqual([])
    })

    test('visible does not release; two minutes of continuous visibility do', () => {
        holdHiddenReplySave()
        setVisibility('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS - 1000)
        expect(inFlightKinds()).toEqual(['save'])

        vi.advanceTimersByTime(1000)

        expect(inFlightKinds()).toEqual([])
    })

    test('hiding before the bound keeps the token past it', () => {
        holdHiddenReplySave()
        setVisibility('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS - 1000)
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        vi.advanceTimersByTime(HIDDEN_REPLY_SAVE_VISIBLE_BOUND_MS * 3)

        expect(inFlightKinds()).toEqual(['save'])
    })

    test('release, begin and uncovered commits keep one registration against the real set', () => {
        // Stopping releases without a commit, so each cycle leaves its callback registered.
        for (let cycle = 0; cycle < 3; cycle++) {
            api.marks += 1
            holdHiddenReplySave()
            setStoppedReason('too large')
            setStoppedReason('')
        }
        api.marks += 50
        holdHiddenReplySave()
        for (let commit = 0; commit < 4; commit++) {
            commitAt(api.committed + 1)
        }

        expect(api.callbacks.size).toBe(1)
        expect(inFlightKinds()).toEqual(['save'])
    })
})
