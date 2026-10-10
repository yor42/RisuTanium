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
