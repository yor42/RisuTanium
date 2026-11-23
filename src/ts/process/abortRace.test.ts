// @vitest-environment node

/**
 * The abort-race leaf. Test kinds: every row is a diagnostic for a new module (no pre-fix defect to
 * reproduce) except where a title says otherwise. The rows that watch for an unhandled rejection use the
 * process-level `unhandledRejection` event, which is what the page's own `unhandledrejection` handler
 * observes in a WebView: a leaked rejection fails the row on a real event, not on a reading of the code.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createStopDeadline, detach, linkedAbort, raceAbort, raceUntil } from './abortRace'

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    vi.restoreAllMocks()
    vi.useRealTimers()
})

// Node reports an unhandled rejection after the microtask drain that follows a macrotask.
async function flush() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

describe('raceAbort', () => {
    test('L-1: an abort after the work started abandons it at once', async () => {
        const controller = new AbortController()
        const work = deferred<string>()
        const result = raceAbort(controller.signal, () => work.promise, { label: 'hook' })
        controller.abort()
        expect(await result).toEqual({ settled: false })
    })

    test('L-2: an already aborted signal never calls the work', async () => {
        const controller = new AbortController()
        controller.abort()
        const start = vi.fn(() => Promise.resolve('x'))
        expect(await raceAbort(controller.signal, start, { label: 'hook' })).toEqual({ settled: false })
        expect(start).not.toHaveBeenCalled()
    })

    test('L-3: a rejection before the abort is the work\'s own error', async () => {
        const controller = new AbortController()
        const failure = new Error('hook failed')
        await expect(raceAbort(controller.signal, () => Promise.reject(failure), { label: 'hook' })).rejects.toBe(failure)
    })

    test('L-4: a rejection after the abandonment is one console warning and no unhandled rejection', async () => {
        const controller = new AbortController()
        const work = deferred<string>()
        const result = raceAbort(controller.signal, () => work.promise, { label: 'hook' })
        controller.abort()
        expect(await result).toEqual({ settled: false })
        const late = new Error('late failure')
        work.reject(late)
        await flush()
        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn).toHaveBeenNthCalledWith(1, 'hook')
        expect(warn).toHaveBeenNthCalledWith(2, 'hook', late)
        expect(error).not.toHaveBeenCalled()
    })

    test('L-6: timeoutMs abandons the work with no signal', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const work = deferred<string>()
        const result = raceAbort(null, () => work.promise, { label: 'hook', timeoutMs: 60_000 })
        await vi.advanceTimersByTimeAsync(59_999)
        let done = false
        void result.then(() => { done = true })
        await Promise.resolve()
        expect(done).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await result).toEqual({ settled: false })
        expect(vi.getTimerCount()).toBe(0)
    })

    test('L-7: a synchronous throw of the work becomes a rejection', async () => {
        const controller = new AbortController()
        const failure = new Error('sync')
        await expect(raceAbort(controller.signal, () => { throw failure }, { label: 'hook' })).rejects.toBe(failure)
    })

    test('L-8: the abort listener is removed after the work settles', async () => {
        const controller = new AbortController()
        const remove = vi.spyOn(controller.signal, 'removeEventListener')
        expect(await raceAbort(controller.signal, () => Promise.resolve(1), { label: 'hook' })).toEqual({ settled: true, value: 1 })
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    })

    test('L-9: onLateValue receives the late value, and a late undefined value logs nothing', async () => {
        const controller = new AbortController()
        const work = deferred<string | undefined>()
        const late = vi.fn()
        const result = raceAbort(controller.signal, () => work.promise, { label: 'hook', onLateValue: late })
        controller.abort()
        await result
        work.resolve(undefined)
        await flush()
        expect(late).toHaveBeenCalledWith(undefined)
        expect(warn).toHaveBeenCalledTimes(1)

        const second = deferred<string | undefined>()
        const seen = vi.fn()
        const secondController = new AbortController()
        const secondResult = raceAbort(secondController.signal, () => second.promise, { label: 'hook', onLateValue: seen })
        secondController.abort()
        await secondResult
        second.resolve('v')
        await flush()
        expect(seen).toHaveBeenCalledWith('v')
        expect(unhandled).toEqual([])
    })

    test('L-9b: a synchronous throw of onLateValue is one console warning and no unhandled rejection', async () => {
        const controller = new AbortController()
        const work = deferred<string>()
        const failure = new Error('late callback')
        const result = raceAbort(controller.signal, () => work.promise, {
            label: 'hook',
            onLateValue: () => { throw failure },
        })
        controller.abort()
        expect(await result).toEqual({ settled: false })
        work.resolve('v')
        await flush()
        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalledTimes(2)
        expect(warn).toHaveBeenLastCalledWith('hook', failure)
    })

    test('L-9c: a late stream whose cancel rejects is one console warning and no unhandled rejection', async () => {
        const cases: Array<[string, ReadableStream<string>, string]> = [
            ['errored by its own abort', new ReadableStream<string>({ start(c) { c.error(new Error('AbortError: plugin fetch aborted')) } }), 'AbortError: plugin fetch aborted'],
            ['a source whose cancel throws', new ReadableStream<string>({ cancel() { throw new Error('source cancel failed') } }), 'source cancel failed'],
        ]
        for (const [, stream, message] of cases) {
            warn.mockClear()
            const controller = new AbortController()
            const work = deferred<{ success: boolean, content: ReadableStream<string> }>()
            const result = raceAbort(controller.signal, () => work.promise, {
                label: 'provider',
                onLateValue: (d) => d?.content.cancel(),
            })
            controller.abort()
            await result
            work.resolve({ success: true, content: stream })
            await flush()
            expect(unhandled).toEqual([])
            expect(warn).toHaveBeenCalledTimes(2)
            const [label, reported] = warn.mock.calls[1] as [string, Error]
            expect(label).toBe('provider')
            expect(reported.message).toBe(message)
        }
    })

    test('L-10: a null signal is a plain await', async () => {
        expect(await raceAbort(null, () => Promise.resolve(5), { label: 'hook' })).toEqual({ settled: true, value: 5 })
        const failure = new Error('x')
        await expect(raceAbort(undefined, Promise.reject(failure), { label: 'hook' })).rejects.toBe(failure)
    })

    test('L-11: abandoned aborts on an abort, on a deadline and on a timeout', async () => {
        const controller = new AbortController()
        let seen!: AbortSignal
        const work = deferred<string>()
        const byAbort = raceAbort(controller.signal, (abandoned) => { seen = abandoned; return work.promise }, { label: 'a' })
        expect(seen.aborted).toBe(false)
        controller.abort()
        await byAbort
        expect(seen.aborted).toBe(true)

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const deadline = createStopDeadline(source.signal, 1000)
        let seenDeadline!: AbortSignal
        const byDeadline = raceUntil(deadline, (abandoned) => { seenDeadline = abandoned; return new Promise<string>(() => undefined) }, { label: 'b' })
        source.abort()
        await vi.advanceTimersByTimeAsync(1000)
        await byDeadline
        expect(seenDeadline.aborted).toBe(true)

        let seenTimeout!: AbortSignal
        const byTimeout = raceAbort(null, (abandoned) => { seenTimeout = abandoned; return new Promise<string>(() => undefined) }, { label: 'c', timeoutMs: 5 })
        await vi.advanceTimersByTimeAsync(5)
        await byTimeout
        expect(seenTimeout.aborted).toBe(true)
    })

    test('L-12: abandoned stays unaborted after a normal settle and a later abort', async () => {
        const controller = new AbortController()
        let seen!: AbortSignal
        expect(await raceAbort(controller.signal, (abandoned) => { seen = abandoned; return Promise.resolve(1) }, { label: 'hook' })).toEqual({ settled: true, value: 1 })
        controller.abort()
        expect(seen.aborted).toBe(false)
    })

    test('L-19: a promise that exists before the race is subscribed even when the race short-circuits', async () => {
        const controller = new AbortController()
        controller.abort()
        const failure = new Error('imggen failed')
        const existing = deferred<string>()
        const result = await raceAbort(controller.signal, existing.promise, { label: 'inlay' })
        expect(result).toEqual({ settled: false })
        existing.reject(failure)
        await flush()
        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenLastCalledWith('inlay', failure)

        warn.mockClear()
        const live = new AbortController()
        const resolves = deferred<string>()
        const settled = raceAbort(live.signal, resolves.promise, { label: 'inlay' })
        resolves.resolve('done')
        expect(await settled).toEqual({ settled: true, value: 'done' })
    })
})

describe('raceUntil and the stop deadline', () => {
    test('L-5: two races on one deadline both abandon at Stop plus the grace', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const deadline = createStopDeadline(source.signal, 10_000)
        const first = raceUntil(deadline, () => new Promise<string>(() => undefined), { label: 'first' })
        source.abort()
        await vi.advanceTimersByTimeAsync(9000)
        const second = raceUntil(deadline, () => new Promise<string>(() => undefined), { label: 'second' })
        let secondDone = false
        void second.then(() => { secondDone = true })
        await vi.advanceTimersByTimeAsync(999)
        expect(secondDone).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await first).toEqual({ settled: false })
        expect(await second).toEqual({ settled: false })
        deadline.dispose()
    })

    test('L-13: an abort alone does not abandon a raceUntil; work finishing inside the grace wins', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const deadline = createStopDeadline(source.signal, 10_000)
        const work = deferred<string>()
        const result = raceUntil(deadline, () => work.promise, { label: 'pass' })
        source.abort()
        await vi.advanceTimersByTimeAsync(5000)
        work.resolve('done')
        expect(await result).toEqual({ settled: true, value: 'done' })
        deadline.dispose()
    })

    test('L-14: an expired deadline never calls the work', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const deadline = createStopDeadline(source.signal, 100)
        source.abort()
        await vi.advanceTimersByTimeAsync(100)
        expect(deadline.expired).toBe(true)
        const start = vi.fn(() => Promise.resolve('x'))
        expect(await raceUntil(deadline, start, { label: 'pass' })).toEqual({ settled: false })
        expect(start).not.toHaveBeenCalled()
    })

    test('L-16: dispose clears the timer', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const deadline = createStopDeadline(source.signal, 10_000)
        source.abort()
        expect(vi.getTimerCount()).toBe(1)
        deadline.dispose()
        expect(vi.getTimerCount()).toBe(0)
        expect(deadline.expired).toBe(false)
    })

    test('L-17: a deadline created on an aborted signal expires at creation plus the grace', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        source.abort()
        const deadline = createStopDeadline(source.signal, 500)
        expect(deadline.expired).toBe(false)
        await vi.advanceTimersByTimeAsync(499)
        expect(deadline.expired).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(deadline.expired).toBe(true)
    })

    test('L-18: onExpire runs once at expiry, never after dispose, and a throw is one console warning', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const onExpire = vi.fn()
        createStopDeadline(source.signal, 1000, onExpire)
        source.abort()
        vi.advanceTimersByTime(1000)
        expect(onExpire).toHaveBeenCalledTimes(1)

        const second = new AbortController()
        const disposedExpire = vi.fn()
        const disposed = createStopDeadline(second.signal, 1000, disposedExpire)
        second.abort()
        disposed.dispose()
        vi.advanceTimersByTime(5000)
        expect(disposedExpire).not.toHaveBeenCalled()

        const third = new AbortController()
        const failure = new Error('expire failed')
        createStopDeadline(third.signal, 1000, () => { throw failure })
        third.abort()
        expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
        expect(warn).toHaveBeenCalledWith('The stop deadline', failure)
    })

    test('L-18c: a promise onExpire returns that rejects is one console warning and no unhandled rejection', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const source = new AbortController()
        const failure = new Error('async expire failed')
        createStopDeadline(source.signal, 1000, () => Promise.reject(failure))
        source.abort()
        vi.advanceTimersByTime(1000)
        vi.useRealTimers()
        await flush()
        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalledWith('The stop deadline', failure)
    })

    test('L-18b: an expiry timer that was already due when the deadline was disposed neither expires it nor runs onExpire', async () => {
        // Only setTimeout is faked, so dispose()'s clearTimeout cannot cancel the pending callback,
        // as with a callback the runtime has already dequeued.
        vi.useFakeTimers({ toFake: ['setTimeout'] })
        const source = new AbortController()
        const onExpire = vi.fn()
        const deadline = createStopDeadline(source.signal, 1000, onExpire)
        source.abort()
        deadline.dispose()
        vi.advanceTimersByTime(1000)
        expect(onExpire).not.toHaveBeenCalled()
        expect(deadline.expired).toBe(false)
    })
})

describe('linkedAbort', () => {
    test('L-15: follows either source, is aborted at creation if a source is, and dispose detaches', () => {
        const a = new AbortController()
        const b = new AbortController()
        const linked = linkedAbort(a.signal, b.signal, null, undefined)
        expect(linked.signal.aborted).toBe(false)
        b.abort()
        expect(linked.signal.aborted).toBe(true)
        expect(a.signal.aborted).toBe(false)

        const already = new AbortController()
        already.abort()
        expect(linkedAbort(new AbortController().signal, already.signal).signal.aborted).toBe(true)

        const c = new AbortController()
        const detached = linkedAbort(c.signal)
        detached.dispose()
        c.abort()
        expect(detached.signal.aborted).toBe(false)
    })
})

describe('detach', () => {
    test('DT-1: a late rejection is one console warning and no unhandled rejection; a fulfilled result logs nothing', async () => {
        const failure = new Error('late')
        expect(detach('x', () => Promise.reject(failure))).toBeUndefined()
        await flush()
        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('x', failure)

        warn.mockClear()
        detach('x', () => Promise.resolve(1))
        detach('x', () => 'plain')
        await flush()
        expect(warn).not.toHaveBeenCalled()
    })

    test('DT-2: a synchronous throw is one console warning; a throwing console does not make detach throw', async () => {
        const failure = new Error('sync')
        expect(() => detach('x', () => { throw failure })).not.toThrow()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('x', failure)

        warn.mockImplementation(() => { throw new Error('console broke') })
        expect(() => detach('x', () => { throw failure })).not.toThrow()
        expect(() => detach('x', () => Promise.reject(failure))).not.toThrow()
        await flush()
        expect(unhandled).toEqual([])
    })

    test('DT-3: a rejecting stream cancel is one console warning, for an errored, a throwing and a locked stream', async () => {
        const errored = new ReadableStream<string>({ start(c) { c.error(new Error('errored')) } })
        const throwing = new ReadableStream<string>({ cancel() { throw new Error('source cancel failed') } })
        const locked = new ReadableStream<string>()
        locked.getReader()
        for (const stream of [errored, throwing, locked]) {
            warn.mockClear()
            detach('x', () => stream.cancel())
            await flush()
            expect(unhandled).toEqual([])
            expect(warn).toHaveBeenCalledTimes(1)
        }
    })
})
