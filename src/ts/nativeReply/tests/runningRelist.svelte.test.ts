import { afterEach, describe, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'
import { createRelistScheduler, relistWhileNativeBlocked, resetRelistForTests, type RelistDeps } from '../runningRelist.svelte'
import { requestReconcile, resetPageStateForTests, setReconcileTrigger } from '../pageState'

/**
 * The bounded re-list while the shown chat waits on a native reply (O-6). All are guards for the new scheduler; the end to
 * end reproducer for the defect is in the composer tests (T1, T1b) and the real-reconciler run is in
 * runningReplies.svelte.test.ts (T6). Mutants: M2 (release keeps the timer), M3 (no backoff), M4 (overlap allowed), M5
 * (hidden page arms a timer), M6 (hold keyed on the origin object, not the chat).
 */

interface Harness {
    deps: RelistDeps
    request: ReturnType<typeof vi.fn<() => Promise<void>>>
    visibility: { visible: boolean, listeners: Set<() => void> }
    setVisible(value: boolean): void
}

function harness(request: () => Promise<void> = async () => {}): Harness {
    const visibility = { visible: true, listeners: new Set<() => void>() }
    const fn = vi.fn<() => Promise<void>>(request)
    return {
        deps: {
            request: fn,
            visible: () => visibility.visible,
            onVisibilityChange: (listener) => {
                visibility.listeners.add(listener)
                return () => { visibility.listeners.delete(listener) }
            },
        },
        request: fn,
        visibility,
        setVisible(value) {
            visibility.visible = value
            for (const listener of [...visibility.listeners]) listener()
        },
    }
}

afterEach(() => {
    vi.useRealTimers()
    resetRelistForTests()
    resetPageStateForTests()
})

describe('the scheduler', () => {
    test('T2: releasing the hold stops the schedule, and no timer or listener remains', async () => {
        vi.useFakeTimers()
        const h = harness()
        const release = createRelistScheduler(h.deps).hold()
        await vi.advanceTimersByTimeAsync(2000)
        expect(h.request).toHaveBeenCalledTimes(1)
        release()
        expect(h.visibility.listeners.size).toBe(0)
        await vi.advanceTimersByTimeAsync(600_000)
        expect(h.request).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    test('T2: a release while the first timer is armed cancels it, and a second release does nothing', async () => {
        vi.useFakeTimers()
        const h = harness()
        const scheduler = createRelistScheduler(h.deps)
        const release = scheduler.hold()
        const other = scheduler.hold()
        release()
        release()
        await vi.advanceTimersByTimeAsync(2000)
        expect(h.request).toHaveBeenCalledTimes(1)
        other()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('T3: the gaps are 2, 4, 8, 16 then 30 seconds, never shorter', async () => {
        vi.useFakeTimers()
        const h = harness()
        createRelistScheduler(h.deps).hold()
        const times: number[] = []
        h.request.mockImplementation(async () => { times.push(Date.now() - start) })
        const start = Date.now()
        await vi.advanceTimersByTimeAsync(1999)
        expect(h.request).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(120_000 - 1999)
        expect(times).toEqual([2000, 6000, 14000, 30000, 60000, 90000, 120000])
    })

    test('T4: a hidden page arms nothing, and becoming visible restarts from the first gap', async () => {
        vi.useFakeTimers()
        const h = harness()
        h.visibility.visible = false
        createRelistScheduler(h.deps).hold()
        await vi.advanceTimersByTimeAsync(300_000)
        expect(h.request).not.toHaveBeenCalled()
        h.setVisible(true)
        await vi.advanceTimersByTimeAsync(1999)
        expect(h.request).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(h.request).toHaveBeenCalledTimes(1)
    })

    test('T4: hiding clears the armed timer', async () => {
        vi.useFakeTimers()
        const h = harness()
        createRelistScheduler(h.deps).hold()
        await vi.advanceTimersByTimeAsync(1000)
        h.setVisible(false)
        await vi.advanceTimersByTimeAsync(600_000)
        expect(h.request).not.toHaveBeenCalled()
        h.setVisible(true)
        await vi.advanceTimersByTimeAsync(2000)
        expect(h.request).toHaveBeenCalledTimes(1)
    })

    test('T5: a request that has not resolved is never followed by a second one', async () => {
        vi.useFakeTimers()
        let resolve: () => void = () => {}
        const h = harness(() => new Promise<void>((done) => { resolve = done }))
        createRelistScheduler(h.deps).hold()
        await vi.advanceTimersByTimeAsync(2000)
        expect(h.request).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(600_000)
        expect(h.request).toHaveBeenCalledTimes(1)
        resolve()
        await vi.advanceTimersByTimeAsync(3999)
        expect(h.request).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(h.request).toHaveBeenCalledTimes(2)
    })

    test('T5: hiding and showing the page while a request is pending arms no second request', async () => {
        vi.useFakeTimers()
        const h = harness(() => new Promise<void>(() => {}))
        createRelistScheduler(h.deps).hold()
        await vi.advanceTimersByTimeAsync(2000)
        expect(h.request).toHaveBeenCalledTimes(1)
        h.setVisible(false)
        h.setVisible(true)
        await vi.advanceTimersByTimeAsync(600_000)
        expect(h.request).toHaveBeenCalledTimes(1)
    })

    test('T4: a hold taken while the page is hidden arms no timer', () => {
        vi.useFakeTimers()
        const h = harness()
        h.visibility.visible = false
        createRelistScheduler(h.deps).hold()
        expect(vi.getTimerCount()).toBe(0)
    })

    test('T6: a rejected request is logged, keeps the hold and continues with the next gap', async () => {
        vi.useFakeTimers()
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
        const h = harness(async () => { throw new Error('list failed') })
        createRelistScheduler(h.deps).hold()
        await vi.advanceTimersByTimeAsync(2000)
        expect(h.request).toHaveBeenCalledTimes(1)
        expect(logged).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(3999)
        expect(h.request).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(h.request).toHaveBeenCalledTimes(2)
        logged.mockRestore()
    })
})

describe('relistWhileNativeBlocked', () => {
    function host(blocked: () => { chaId: string, chatId: string } | null): () => void {
        return $effect.root(() => { relistWhileNativeBlocked(blocked) })
    }

    test('T2/T8: the hold follows the blocked chat: a clear stops it, another blocked chat restarts from the first gap', async () => {
        vi.useFakeTimers()
        const trigger = vi.fn(async () => {})
        setReconcileTrigger(trigger)
        const shown = $state<{ origin: { chaId: string, chatId: string } | null }>({ origin: { chaId: 'a', chatId: 'a1' } })
        const stop = host(() => shown.origin)
        flushSync()
        await vi.advanceTimersByTimeAsync(2000)
        expect(trigger).toHaveBeenCalledTimes(1)
        shown.origin = null
        flushSync()
        await vi.advanceTimersByTimeAsync(600_000)
        expect(trigger).toHaveBeenCalledTimes(1)
        shown.origin = { chaId: 'c', chatId: 'c1' }
        flushSync()
        await vi.advanceTimersByTimeAsync(1999)
        expect(trigger).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(trigger).toHaveBeenCalledTimes(2)
        stop()
        await vi.advanceTimersByTimeAsync(600_000)
        expect(trigger).toHaveBeenCalledTimes(2)
    })

    test('T8: a fresh origin object for the same chat keeps the schedule', async () => {
        vi.useFakeTimers()
        const trigger = vi.fn(async () => {})
        setReconcileTrigger(trigger)
        const shown = $state<{ origin: { chaId: string, chatId: string } | null }>({ origin: { chaId: 'a', chatId: 'a1' } })
        const stop = host(() => shown.origin)
        flushSync()
        await vi.advanceTimersByTimeAsync(2000)
        expect(trigger).toHaveBeenCalledTimes(1)
        shown.origin = { chaId: 'a', chatId: 'a1' }
        flushSync()
        await vi.advanceTimersByTimeAsync(3999)
        expect(trigger).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(trigger).toHaveBeenCalledTimes(2)
        stop()
    })

    test('T8: nothing is scheduled while the caller reports no block', async () => {
        vi.useFakeTimers()
        const trigger = vi.fn(async () => {})
        setReconcileTrigger(trigger)
        const stop = host(() => null)
        flushSync()
        expect(vi.getTimerCount()).toBe(0)
        await vi.advanceTimersByTimeAsync(600_000)
        expect(trigger).not.toHaveBeenCalled()
        stop()
    })
})

test('T7: requestReconcile resolves when the installed trigger does, and at once with none installed', async () => {
    await requestReconcile()
    let resolve: () => void = () => {}
    setReconcileTrigger(() => new Promise<void>((done) => { resolve = done }))
    let settled = false
    const pending = requestReconcile().then(() => { settled = true })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)
    resolve()
    await pending
    expect(settled).toBe(true)
})