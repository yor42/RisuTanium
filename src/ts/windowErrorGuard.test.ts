// @vitest-environment happy-dom

/**
 * `classifyWindowError`: what the window `error` handler of the app does with an event.
 *
 * Test labels: the null-error case is a reproducer. The handler read `event.error.target` before
 * the seam existed, so an event whose `error` is null (the notification a browser raises when a
 * ResizeObserver loop completes with undelivered notifications) threw a TypeError inside the
 * handler. The seam did not exist before, so on the earlier base this file fails at the import;
 * `windowErrorHandlerBase` below reproduces the earlier expression itself and shows it throwing.
 * The other cases are guards that keep what the handler did for real errors.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { classifyWindowError, handleWindowError } from './windowErrorGuard'

/** The expression the handler used before the seam: it dereferences `error` without a check. */
function windowErrorHandlerBase(event: { error: { target?: unknown } }): boolean {
    return !(event.error.target instanceof Worker)
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('classifyWindowError', () => {
    test('(R) an event without an error object is ignored, where the earlier expression threw', () => {
        vi.stubGlobal('Worker', class {})
        expect(() => windowErrorHandlerBase({ error: null as unknown as { target?: unknown } })).toThrow(TypeError)
        expect(classifyWindowError({ error: null })).toBe('ignore')
        expect(classifyWindowError({ error: undefined })).toBe('ignore')
    })

    test('(G) an Error is reported', () => {
        expect(classifyWindowError({ error: new Error('boom') })).toBe('report')
    })

    test('(G) a thrown string or plain object is reported', () => {
        expect(classifyWindowError({ error: 'plain text' })).toBe('report')
        expect(classifyWindowError({ error: { code: 3 } })).toBe('report')
    })

    test('(G) an error raised by a worker is logged and not reported', () => {
        class FakeWorker {}
        vi.stubGlobal('Worker', FakeWorker)
        expect(classifyWindowError({ error: { target: new FakeWorker() } })).toBe('log')
    })

    test('(G) in an environment without Worker nothing is taken for a worker error', () => {
        vi.stubGlobal('Worker', undefined)
        expect(classifyWindowError({ error: { target: {} } })).toBe('report')
    })

    test('(G) an error whose target is something else is reported', () => {
        expect(classifyWindowError({ error: { target: document.body } })).toBe('report')
    })
})

describe('handleWindowError', () => {
    const sinks = () => ({ warn: vi.fn(), error: vi.fn(), report: vi.fn() })

    test('(R) an event without an error object warns its message and neither logs an error nor shows an alert', () => {
        const s = sinks()
        handleWindowError({ error: null, message: 'ResizeObserver loop completed with undelivered notifications.' }, s)
        expect(s.warn).toHaveBeenCalledWith('ResizeObserver loop completed with undelivered notifications.')
        expect(s.error).not.toHaveBeenCalled()
        expect(s.report).not.toHaveBeenCalled()
    })

    test('(G) an Error is logged and reported, and not warned', () => {
        const s = sinks()
        const error = new Error('boom')
        handleWindowError({ error, message: 'boom' }, s)
        expect(s.error).toHaveBeenCalledWith(error)
        expect(s.report).toHaveBeenCalledWith(error)
        expect(s.warn).not.toHaveBeenCalled()
    })

    test('(G) a worker error is logged and not reported', () => {
        class FakeWorker {}
        vi.stubGlobal('Worker', FakeWorker)
        const s = sinks()
        const error = { target: new FakeWorker() }
        handleWindowError({ error, message: 'worker failed' }, s)
        expect(s.error).toHaveBeenCalledWith(error)
        expect(s.report).not.toHaveBeenCalled()
    })
})
