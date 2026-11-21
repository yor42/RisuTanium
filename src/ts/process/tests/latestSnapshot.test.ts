/**
 * `readLatest` and `yieldTask` (`../latestSnapshot`).
 *
 * `readLatest(reader, keep)` reads every snapshot of a stream as it arrives and hands the consumer only the newest one:
 * the producer is never held back (its eager `start()` loop keeps folding), and a consumer that is busy skips the
 * snapshots that were superseded meanwhile. `yieldTask()` is one posted-message task: the 'off' reply loop awaits it
 * after each written pass so that events queued during the pass reach the helper first.
 *
 * Every test here is a helper unit test of new code: none is a regression reproducer (the module does not exist on the
 * pre-change base, so the whole file fails on import there). The send-level reproducers are in
 * `sendChatStreamLatest.svelte.test.ts`.
 *
 * The producer shape is the real one: an eager `ReadableStream` whose `start()` captures the controller and enqueues
 * without looking at `desiredSize`. Where the real pass-through of `usageCapture` is needed, the real `settleUsage` is
 * used (the stores and the tokenizer it imports are mocked, as in `usageCapture.test.ts`).
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'

vi.mock('../../stores.svelte', () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
}))

vi.mock('../../tokenizer', () => ({
    ChatTokenizer: class {
        constructor(_extra: number, _mode: string) {}
        async tokenizeChat(_chat: unknown) { return 1 }
    },
    tokenize: vi.fn(async () => 1),
}))

import { readLatest, yieldTask } from '../latestSnapshot'
import { settleUsage } from '../../usage/usageCapture'
import { createUsageMeter } from '../../usage/usageMeter'

//#region fixtures

const RealMessageChannel = globalThis.MessageChannel

/** The test's own macrotask: a real message, never a timer, so it also works while timers are faked. */
function realMacrotask(): Promise<void> {
    return new Promise<void>((resolve) => {
        const channel = new RealMessageChannel()
        channel.port1.onmessage = () => {
            channel.port1.close()
            resolve()
        }
        channel.port2.postMessage(null)
    })
}

/** Microtask drain only: no macrotask runs. */
async function drain(count = 50): Promise<void> {
    for (let i = 0; i < count; i++) {
        await Promise.resolve()
    }
}

/** Resolves with the settled value, or 'pending' when the promise did not settle within a real 40 ms. */
async function settledOrPending<T>(promise: Promise<T>): Promise<T | 'pending'> {
    return await Promise.race([
        promise,
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 40)),
    ])
}

/** An eager producer: the controller is captured and enqueued to without checking `desiredSize`. */
function eagerSource<T>(): {
    stream: ReadableStream<T>
    push(value: T): void
    close(): void
    error(reason: unknown): void
    cancelReasons: unknown[]
} {
    let controller: ReadableStreamDefaultController<T> | undefined
    const cancelReasons: unknown[] = []
    const stream = new ReadableStream<T>({
        start(c) { controller = c },
        cancel(reason) { cancelReasons.push(reason) },
    })
    return {
        stream,
        push(value) { try { controller?.enqueue(value) } catch { /* cancelled */ } },
        close() { try { controller?.close() } catch { /* cancelled */ } },
        error(reason) { try { controller?.error(reason) } catch { /* cancelled */ } },
        cancelReasons,
    }
}

/** A pull-based producer with a high-water mark of 0 (the shape of `usageCapture`'s pass-through): one value per pull. */
function pullSource(count: number): { stream: ReadableStream<string>, pulled(): number } {
    let pulled = 0
    const stream = new ReadableStream<string>({
        pull(controller) {
            if (pulled < count) {
                pulled += 1
                controller.enqueue(`s${pulled}`)
            }
            else {
                controller.close()
            }
        },
    }, { highWaterMark: 0 })
    return { stream, pulled: () => pulled }
}

const keepAll = () => true

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

//#endregion

describe('readLatest: which snapshot the consumer gets', () => {
    test('H1 a consumer that keeps up gets every value, in order, whether it waits first or reads after', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)

        const waiting = latest.next()
        source.push('v1')
        expect(await waiting).toEqual({ done: false, value: 'v1' })

        source.push('v2')
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: 'v2' })

        const waitingAgain = latest.next()
        source.push('v3')
        expect(await waitingAgain).toEqual({ done: false, value: 'v3' })
    })

    test('H2 values that arrive while no next() is pending are superseded: next() gives the newest', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        for (const value of ['v1', 'v2', 'v3', 'v4', 'v5']) {
            source.push(value)
        }
        // Drain first: the pump has read every value only after its microtasks ran.
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: 'v5' })
    })

    test('H3 done comes after the pending newest value, never before it', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        source.push('v1')
        source.push('v2')
        source.close()
        // Drain first: the pump has read both values and the close only after its microtasks ran.
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: 'v2' })
        expect(await latest.next()).toEqual({ done: true })
        expect(await latest.next()).toEqual({ done: true })
    })

    test('H4 an error comes after the pending newest value the pump had read', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        const failure = new Error('boom')
        source.push('v1')
        await drain()
        source.push('v2')
        await drain()
        source.error(failure)
        // Drain first: the pump has read v2 and met the error only after its microtasks ran.
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: 'v2' })
        await expect(latest.next()).rejects.toBe(failure)
    })

    // Accepted stream-spec behaviour, not a helper defect.
    test('H4b values still queued in the source when it errors are discarded by the stream, not by the helper', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        const failure = new Error('boom')
        // Let the pump put its read on the stream first, so the first enqueue fulfils that read directly.
        await drain()
        // One synchronous block: v3..v5 sit in the stream's queue when `error` resets it (WHATWG queue reset on error).
        source.push('v2')
        source.push('v3')
        source.push('v4')
        source.push('v5')
        source.error(failure)
        expect(await latest.next()).toEqual({ done: false, value: 'v2' })
        await expect(latest.next()).rejects.toBe(failure)
    })

    test('H5 the error is sticky: every later next() rejects with the same error', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        const failure = new Error('boom')
        source.error(failure)
        await drain()
        await expect(latest.next()).rejects.toBe(failure)
        await expect(latest.next()).rejects.toBe(failure)
    })

    test('H12 an equal or identical value is still new: the consumer is not left waiting', async () => {
        const source = eagerSource<{ text: string }>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        const same = { text: 'same' }

        source.push(same)
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: same })

        // The identical object again (a producer that reuses its snapshot object).
        source.push(same)
        await drain()
        expect(await settledOrPending(latest.next())).toEqual({ done: false, value: same })

        // An equal value that is not identical.
        source.push({ text: 'same' })
        await drain()
        expect(await settledOrPending(latest.next())).toEqual({ done: false, value: { text: 'same' } })
    })

    test('H12 a repeated primitive is delivered each time', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        for (const value of ['x', 'x', 'y', 'y']) {
            source.push(value)
            await drain()
            expect(await settledOrPending(latest.next())).toEqual({ done: false, value })
        }
    })
})

describe('readLatest: keep predicate', () => {
    test('H9 a value the predicate rejects never replaces a kept one and is never delivered', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), (value) => !!value)
        source.push('v1')
        source.push('')
        source.close()
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: 'v1' })
        expect(await latest.next()).toEqual({ done: true })
    })

    test('H9 a stream whose values are all rejected ends with done and no value', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), (value) => !!value)
        source.push('')
        source.push('')
        source.close()
        await drain()
        expect(await latest.next()).toEqual({ done: true })
    })

    test('H9 the object chunks of an ooba-style producer pass the predicate as plain values', async () => {
        const source = eagerSource<{ [key: string]: string }>()
        const latest = readLatest(source.stream.getReader(), (value) => !!value)
        source.push({ '0': 'first' })
        source.push({ '0': 'second', '1': 'extra' })
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: { '0': 'second', '1': 'extra' } })
    })
})

describe('readLatest: reading ahead of the consumer', () => {
    test('H8 the pump reads a pull-based source to its end although the consumer never asked', async () => {
        const source = pullSource(20)
        const latest = readLatest(source.stream.getReader(), keepAll)
        await realMacrotask()
        await realMacrotask()
        expect(source.pulled()).toBe(20)
        expect(await latest.next()).toEqual({ done: false, value: 's20' })
        expect(await latest.next()).toEqual({ done: true })
    })

    // The shape the request modules hand to the send: the real pass-through of `usageCapture`.
    test('H8 the real settleUsage pass-through is read to its end and its newest value is delivered', async () => {
        const inner = eagerSource<{ [key: string]: string }>()
        const arg = { usageMeter: createUsageMeter(), aiModel: 'm', formated: [] }
        const wrapped = settleUsage(arg, 'model', { type: 'streaming', result: inner.stream })
        if (wrapped.type !== 'streaming') {
            throw new Error('settleUsage did not wrap the stream')
        }
        const latest = readLatest(wrapped.result.getReader(), keepAll)
        for (let i = 1; i <= 8; i++) {
            inner.push({ '0': `t${i}` })
        }
        inner.close()
        await realMacrotask()
        await realMacrotask()
        expect(await latest.next()).toEqual({ done: false, value: { '0': 't8' } })
        expect(await latest.next()).toEqual({ done: true })
    })
})

describe('readLatest: cancel', () => {
    test('H6 cancel while next() waits ends that wait with done and cancels the source with the reason', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        const waiting = latest.next()
        await drain()
        const reason = new Error('stop')
        await latest.cancel(reason)
        expect(await settledOrPending(waiting)).toEqual({ done: true })
        expect(source.cancelReasons).toEqual([reason])
        expect(await latest.next()).toEqual({ done: true })
    })

    test('H6 cancel reaches the source in the same synchronous step', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        void latest.cancel()
        expect(source.cancelReasons).toHaveLength(1)
        await drain()
    })

    test('H7 cancel drops the pending value: nothing is delivered afterwards', async () => {
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        source.push('v1')
        // Drain first: v1 is pending only after the pump ran.
        await drain()
        await latest.cancel()
        expect(await latest.next()).toEqual({ done: true })
        source.push('v2')
        await drain()
        expect(await latest.next()).toEqual({ done: true })
    })
})

describe('readLatest: no timers, no stray rejections', () => {
    test('H10 with every timer frozen the helper still delivers, and it arms none', async () => {
        vi.useFakeTimers()
        const source = eagerSource<string>()
        const latest = readLatest(source.stream.getReader(), keepAll)
        const waiting = latest.next()
        source.push('v1')
        expect(await waiting).toEqual({ done: false, value: 'v1' })
        source.push('v2')
        source.push('v3')
        await drain()
        expect(await latest.next()).toEqual({ done: false, value: 'v3' })
        source.close()
        await drain()
        expect(await latest.next()).toEqual({ done: true })
        expect(vi.getTimerCount()).toBe(0)
    })

    test('H11 a stream error nobody has asked about yet raises no unhandled rejection', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)
        try {
            const source = eagerSource<string>()
            const latest = readLatest(source.stream.getReader(), keepAll)
            const failure = new Error('boom')
            source.error(failure)
            await new Promise<void>((resolve) => setTimeout(resolve, 30))
            expect(unhandled).toEqual([])
            await expect(latest.next()).rejects.toBe(failure)
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })

    test('H11 cancelling a source that is being read raises no unhandled rejection', async () => {
        const unhandled: unknown[] = []
        const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
        process.on('unhandledRejection', onUnhandled)
        try {
            const source = eagerSource<string>()
            const latest = readLatest(source.stream.getReader(), keepAll)
            await drain()
            await latest.cancel(new Error('stop'))
            await new Promise<void>((resolve) => setTimeout(resolve, 30))
            expect(unhandled).toEqual([])
        }
        finally {
            process.off('unhandledRejection', onUnhandled)
        }
    })
})

describe('yieldTask', () => {
    test('Y1 it arms no timer: with every timer frozen it still resolves on a message task', async () => {
        vi.useFakeTimers()
        let done = false
        void yieldTask().then(() => { done = true })
        await realMacrotask()
        await realMacrotask()
        expect(done).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })

    test('Y2 it is a task, not a microtask: it is still pending after any microtask drain', async () => {
        let done = false
        void yieldTask().then(() => { done = true })
        await drain(100)
        expect(done).toBe(false)
        await realMacrotask()
        await realMacrotask()
        expect(done).toBe(true)
    })

    test('Y3 each yield closes the port it opened, once', async () => {
        let created = 0
        let closed = 0
        vi.stubGlobal('MessageChannel', class extends RealMessageChannel {
            constructor() {
                super()
                created += 1
                const close = this.port1.close.bind(this.port1)
                this.port1.close = () => {
                    closed += 1
                    close()
                }
            }
        })
        await yieldTask()
        expect(created).toBe(1)
        expect(closed).toBe(1)
        for (let i = 0; i < 49; i++) {
            await yieldTask()
        }
        expect(created).toBe(50)
        expect(closed).toBe(50)
    })

    test('Y4 without MessageChannel it resolves at once instead of hanging', async () => {
        vi.stubGlobal('MessageChannel', undefined)
        let done = false
        void yieldTask().then(() => { done = true })
        await drain(5)
        expect(done).toBe(true)
    })
})
