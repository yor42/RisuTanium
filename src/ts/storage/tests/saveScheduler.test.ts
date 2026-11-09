import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createSaveScheduler } from 'src/ts/storage/saveScheduler'

function setup() {
    const state = { marks: 0, dirty: false, due: 0, now: 0 }
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    const scheduler = createSaveScheduler({
        debounceMs: 500,
        sleep,
        hooks: {
            onMark: (markDirty) => {
                state.marks += 1
                if (markDirty) {
                    state.dirty = true
                }
            },
            onDue: () => { state.due += 1 },
            onRequestNow: () => {
                state.marks += 1
                state.dirty = true
                state.due += 1
                state.now += 1
            },
        },
    })
    return { state, scheduler }
}

/** Marks a promise's settlement so a test can read it without awaiting it. */
function track(promise: Promise<unknown>): { settled: () => boolean } {
    let done = false
    void promise.then(() => { done = true })
    return { settled: () => done }
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('onRequest (CHORE-624)', () => {
    test('spec guard: TA-6(a) a listener runs once, at the next request, after the request hook', () => {
        const { state, scheduler } = setup()
        const seen: number[] = []

        scheduler.onRequest(() => { seen.push(state.now) })
        scheduler.requestNow()
        scheduler.requestNow()

        expect(seen).toEqual([1])
    })

    test('spec guard: TA-6(b) with a listener armed and no wake the request is kept as the latch, exactly once', async () => {
        const { scheduler } = setup()

        scheduler.onRequest(() => {})
        scheduler.requestNow()

        const first = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(0)
        expect(first.settled()).toBe(true)
        const second = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(499)
        expect(second.settled()).toBe(false)
    })

    // Compatibility guard of the latch semantics: a request that wakes a live wait leaves no latch when no listener is armed.
    test('guard: TA-6(b) with a wake pending and no listener armed the wake resolves and no latch is left', async () => {
        const { scheduler } = setup()
        const waiting = track(scheduler.wait(500))

        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)

        expect(waiting.settled()).toBe(true)
        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(499)
        expect(next.settled()).toBe(false)
    })

    test('spec guard: TA-6(c) a released listener is not called, and a release does not remove another listener', () => {
        const { scheduler } = setup()
        const calls: string[] = []

        const releaseFirst = scheduler.onRequest(() => { calls.push('first') })
        scheduler.onRequest(() => { calls.push('second') })
        releaseFirst()
        scheduler.requestNow()

        expect(calls).toEqual(['second'])
    })

    test('spec guard: TA-6(c) a throwing listener does not stop the others or the request', () => {
        const { state, scheduler } = setup()
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const calls: string[] = []

        scheduler.onRequest(() => { throw new Error('listener failed') })
        scheduler.onRequest(() => { calls.push('second') })
        scheduler.requestNow()

        expect(calls).toEqual(['second'])
        expect(state.due).toBe(1)
        error.mockRestore()
    })

    test('spec guard: TA-6(d) registering and releasing leaves no timer pending', () => {
        const { scheduler } = setup()

        const release = scheduler.onRequest(() => {})
        release()

        expect(vi.getTimerCount()).toBe(0)
    })

    // A wait the loop abandoned (its deferral race) leaves a wake that the next request would spend without a latch.
    test('spec guard: TA-6(e) a stale wake and an armed listener: the request is kept for the next wait', async () => {
        const { scheduler } = setup()
        await Promise.race([Promise.resolve(), scheduler.wait(500)])

        scheduler.onRequest(() => {})
        scheduler.requestNow()

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(0)
        expect(next.settled()).toBe(true)
    })
})

describe('schedule', () => {
    test('guard: a request becomes due after the debounce and a newer one restarts it', async () => {
        const { state, scheduler } = setup()

        scheduler.schedule()
        await vi.advanceTimersByTimeAsync(400)
        scheduler.schedule()
        await vi.advanceTimersByTimeAsync(400)

        expect(state.due).toBe(0)
        expect(scheduler.debouncePending()).toBe(true)
        await vi.advanceTimersByTimeAsync(100)
        expect(state.due).toBe(1)
        expect(scheduler.debouncePending()).toBe(false)
        expect(state.marks).toBe(2)
    })

    test('guard: a request that does not mark the page dirty still counts', () => {
        const { state, scheduler } = setup()

        scheduler.schedule(false)

        expect(state.marks).toBe(1)
        expect(state.dirty).toBe(false)
    })
})

describe('requestNow', () => {
    test('makes the change due at once and clears the pending debounce, so no second pass fires from it', async () => {
        const { state, scheduler } = setup()
        scheduler.schedule()

        scheduler.requestNow()
        expect(state.due).toBe(1)
        expect(state.dirty).toBe(true)
        expect(scheduler.debouncePending()).toBe(false)

        await vi.advanceTimersByTimeAsync(2000)
        expect(state.due).toBe(1)
    })

    test('a request after it restarts the debounce normally', async () => {
        const { state, scheduler } = setup()
        scheduler.requestNow()

        scheduler.schedule()
        expect(scheduler.debouncePending()).toBe(true)
        await vi.advanceTimersByTimeAsync(499)
        expect(state.due).toBe(1)
        await vi.advanceTimersByTimeAsync(1)

        expect(state.due).toBe(2)
        expect(state.marks).toBe(2)
    })

    test('wakes a wait that is pending', async () => {
        const { scheduler } = setup()
        const waiting = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(100)
        expect(waiting.settled()).toBe(false)

        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)

        expect(waiting.settled()).toBe(true)
    })

    test('with no wait pending, the next wait returns at once and only that one', async () => {
        const { scheduler } = setup()
        scheduler.requestNow()

        const first = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(0)
        expect(first.settled()).toBe(true)

        const second = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(999)
        expect(second.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(second.settled()).toBe(true)
    })

    test('a wake spends the request: the wait after it takes its full length', async () => {
        const { scheduler } = setup()
        const woken = track(scheduler.wait(1000))
        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)
        expect(woken.settled()).toBe(true)

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(499)
        expect(next.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(next.settled()).toBe(true)
    })

    test('the timer of a woken wait does not end a later wait early', async () => {
        const { scheduler } = setup()
        const woken = scheduler.wait(1000)
        scheduler.requestNow()
        await woken
        const later = track(scheduler.wait(5000))

        await vi.advanceTimersByTimeAsync(1000)
        expect(later.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(4000)
        expect(later.settled()).toBe(true)
    })

    test('a request still wakes a later wait after the timer of an earlier woken wait has fired', async () => {
        const { scheduler } = setup()
        const woken = scheduler.wait(1000)
        scheduler.requestNow()
        await woken
        const later = track(scheduler.wait(5000))
        await vi.advanceTimersByTimeAsync(1000)

        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)

        expect(later.settled()).toBe(true)
    })

    test('does not end a sleep that does not go through wait, and the request is spent on the next wait once', async () => {
        const { scheduler } = setup()
        const otherSleep = track(new Promise<void>((resolve) => setTimeout(resolve, 1000)))
        const forever = track(new Promise<never>(() => {}))

        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(500)
        expect(otherSleep.settled()).toBe(false)

        await vi.advanceTimersByTimeAsync(500)
        expect(otherSleep.settled()).toBe(true)

        const spent = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(0)
        expect(spent.settled()).toBe(true)
        const after = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(999)
        expect(after.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1_000_000)
        expect(forever.settled()).toBe(false)
    })
})

describe('waitRearm', () => {
    test('a request that wakes it also sets the latch, so the next wait returns at once and only that one', async () => {
        const { scheduler } = setup()
        const backoff = track(scheduler.waitRearm(60_000))
        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)
        expect(backoff.settled()).toBe(true)

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(0)
        expect(next.settled()).toBe(true)
        const after = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(499)
        expect(after.settled()).toBe(false)
    })

    test('a latch already set ends it at once and stays set for the wait after it', async () => {
        const { scheduler } = setup()
        scheduler.requestNow()

        const backoff = track(scheduler.waitRearm(60_000))
        await vi.advanceTimersByTimeAsync(0)
        expect(backoff.settled()).toBe(true)

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(0)
        expect(next.settled()).toBe(true)
    })

    test('guard: without a request it takes its full length and leaves no latch', async () => {
        const { scheduler } = setup()
        const backoff = track(scheduler.waitRearm(1000))
        await vi.advanceTimersByTimeAsync(999)
        expect(backoff.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(backoff.settled()).toBe(true)

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(499)
        expect(next.settled()).toBe(false)
    })

    test('guard: a plain wait woken by a request leaves no latch (idle wake unchanged)', async () => {
        const { scheduler } = setup()
        const idle = track(scheduler.wait(1000))
        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)
        expect(idle.settled()).toBe(true)

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(499)
        expect(next.settled()).toBe(false)
    })

    test('a plain wait woken by a request after a rearm wait leaves no latch (the rearm flag does not outlive its wait)', async () => {
        const { scheduler } = setup()
        const backoff = scheduler.waitRearm(60_000)
        scheduler.requestNow()
        await backoff
        await scheduler.wait(500)

        const idle = track(scheduler.wait(1000))
        scheduler.requestNow()
        await vi.advanceTimersByTimeAsync(0)
        expect(idle.settled()).toBe(true)

        const next = track(scheduler.wait(500))
        await vi.advanceTimersByTimeAsync(0)
        expect(next.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(499)
        expect(next.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(next.settled()).toBe(true)
    })

    test('guard: the timer of a woken rearm wait does not end a later wait early', async () => {
        const { scheduler } = setup()
        const woken = scheduler.waitRearm(1000)
        scheduler.requestNow()
        await woken
        const spent = scheduler.wait(500)
        await spent
        const later = track(scheduler.wait(5000))

        await vi.advanceTimersByTimeAsync(1000)
        expect(later.settled()).toBe(false)
    })
})

describe('wait', () => {
    test('guard: without a request, the wait takes its full length (the retry backoff is unchanged)', async () => {
        const { scheduler } = setup()
        const waiting = track(scheduler.wait(1000))

        await vi.advanceTimersByTimeAsync(999)
        expect(waiting.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(waiting.settled()).toBe(true)
    })
})

describe('wakeIdle (CHORE-687)', () => {
    test('TW1(a) it ends a live wait and calls no hook: no mark, no dirty page, no due change', async () => {
        const { state, scheduler } = setup()
        const waiting = track(scheduler.wait(60_000))

        scheduler.wakeIdle()
        await vi.advanceTimersByTimeAsync(0)

        expect(waiting.settled()).toBe(true)
        expect(state.marks).toBe(0)
        expect(state.dirty).toBe(false)
        expect(state.due).toBe(0)
        expect(scheduler.debouncePending()).toBe(false)
    })

    test('TW1(b) with no live wait the next wait returns at once, once; the one after sleeps', async () => {
        const { scheduler } = setup()

        scheduler.wakeIdle()
        const first = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(0)
        expect(first.settled()).toBe(true)

        const second = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(999)
        expect(second.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(second.settled()).toBe(true)
    })

    test('TW1(c) it does not end a live rearm wait: a failure back-off keeps its delay', async () => {
        const { scheduler } = setup()
        const backoff = track(scheduler.waitRearm(1000))

        scheduler.wakeIdle()
        await vi.advanceTimersByTimeAsync(999)
        expect(backoff.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(backoff.settled()).toBe(true)

        // It left nothing behind for the wait that follows the back-off.
        const next = track(scheduler.wait(1000))
        await vi.advanceTimersByTimeAsync(999)
        expect(next.settled()).toBe(false)
    })

    test('TW1(d) it runs no onRequest listener and leaves the latch unset: a later rearm wait sleeps', async () => {
        const { scheduler } = setup()
        let ran = 0
        scheduler.onRequest(() => { ran += 1 })

        scheduler.wakeIdle()
        scheduler.wakeIdle()
        expect(ran).toBe(0)

        // The idle latch is consumed by a plain wait only; a rearm wait is not ended by it.
        const rearm = track(scheduler.waitRearm(1000))
        await vi.advanceTimersByTimeAsync(999)
        expect(rearm.settled()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(rearm.settled()).toBe(true)
        expect(ran).toBe(0)
    })
})
