/**
 * The shared body-interceptor loop: the chaining entry point (`globalFetch`, `fetchNative`) and the non-chaining
 * one (the Gemini event callbacks), their order, their error handling and their behaviour on an aborted signal.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    store: [] as Array<{ id: string, callback: (body: unknown, type: string) => Promise<unknown> }>,
}))

vi.mock('../../../stores.svelte', () => ({ bodyIntercepterStore: h.store }))

import { notifyBodyInterceptors, runBodyInterceptors } from '../bodyInterceptors'

beforeEach(() => {
    h.store.length = 0
    vi.restoreAllMocks()
})

describe('runBodyInterceptors (chaining)', () => {
    test('BI-1: order is kept, a truthy return is the next payload, a falsy return keeps it', async () => {
        const seen: unknown[] = []
        h.store.push(
            { id: 'a', callback: async (body) => { seen.push(['a', body]); return 'from-a' } },
            { id: 'b', callback: async (body) => { seen.push(['b', body]); return '' } },
            { id: 'c', callback: async (body, kind) => { seen.push(['c', body, kind]); return undefined } },
        )

        const result = await runBodyInterceptors('start', 'k', null)

        expect(result).toEqual({ settled: true, value: 'from-a' })
        expect(seen).toEqual([['a', 'start'], ['b', 'from-a'], ['c', 'from-a', 'k']])
    })

    test('BI-1: a throwing interceptor is logged and the next one runs', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const boom = new Error('boom')
        h.store.push(
            { id: 'a', callback: async () => { throw boom } },
            { id: 'b', callback: async () => 'after' },
        )

        expect(await runBodyInterceptors('start', 'k', null)).toEqual({ settled: true, value: 'after' })
        expect(error).toHaveBeenCalledWith(boom)
    })

    test('BI-1: an already aborted signal calls none', async () => {
        const callback = vi.fn(async () => 'x')
        h.store.push({ id: 'a', callback })
        const controller = new AbortController()
        controller.abort()

        expect(await runBodyInterceptors('start', 'k', controller.signal)).toEqual({ settled: false })
        expect(callback).not.toHaveBeenCalled()
    })

    test('an interceptor that never settles is abandoned at the abort and the later ones are not called', async () => {
        const later = vi.fn(async () => 'x')
        h.store.push({ id: 'hang', callback: () => new Promise(() => {}) }, { id: 'later', callback: later })
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const controller = new AbortController()

        const pending = runBodyInterceptors('start', 'k', controller.signal)
        controller.abort()

        expect(await pending).toEqual({ settled: false })
        expect(later).not.toHaveBeenCalled()
    })
})

describe('notifyBodyInterceptors (non-chaining)', () => {
    test('BI-1: the return value is ignored and the factory runs once per interceptor', async () => {
        const received: unknown[] = []
        const factory = vi.fn(() => ({ fresh: true }))
        h.store.push(
            { id: 'a', callback: async (body) => { received.push(body); return 'x' } },
            { id: 'b', callback: async (body) => { received.push(body); return 'y' } },
        )

        expect(await notifyBodyInterceptors(factory, 'meta', null)).toEqual({ settled: true, value: undefined })

        expect(factory).toHaveBeenCalledTimes(2)
        expect(received).toEqual([{ fresh: true }, { fresh: true }])
        expect(received[0]).not.toBe(received[1])
    })

    test('BI-1: a throwing interceptor is logged and the next one runs', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const boom = new Error('boom')
        const next = vi.fn(async () => undefined)
        h.store.push({ id: 'a', callback: async () => { throw boom } }, { id: 'b', callback: next })

        expect(await notifyBodyInterceptors(() => 1, 'meta', null)).toEqual({ settled: true, value: undefined })
        expect(error).toHaveBeenCalledWith(boom)
        expect(next).toHaveBeenCalledTimes(1)
    })

    test('BI-1: an already aborted signal calls none', async () => {
        const callback = vi.fn(async () => undefined)
        h.store.push({ id: 'a', callback })
        const controller = new AbortController()
        controller.abort()

        expect(await notifyBodyInterceptors(() => 1, 'meta', controller.signal)).toEqual({ settled: false })
        expect(callback).not.toHaveBeenCalled()
    })
})
