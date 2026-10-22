// @vitest-environment happy-dom

/**
 * The Back registry and quit guard. `pageCovered` and `closeDialogForBack` are the collaborators and are mocked: the
 * contract under test is dispatch order, the failure containment and the guard's timing.
 * Every test is a feature test of the new module (F); none can pass on a base without it.
 * Time is `Date.now` under fake timers.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { covered, closeDialog } = vi.hoisted(() => ({ covered: vi.fn(() => false), closeDialog: vi.fn() }))
vi.mock('./alertPrompts', () => ({ pageCovered: covered }))
vi.mock('./alertBack', () => ({ closeDialogForBack: closeDialog }))

import {
    QUIT_WINDOW_MS,
    dispatchBack,
    ensureBackHook,
    installBackGuard,
    registerBackHandler,
    resetBackHandlersForTests,
} from './backHandlers'

const showToast = vi.fn()

function setVisibility(state: 'hidden' | 'visible'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    covered.mockReturnValue(false)
    closeDialog.mockReset()
    showToast.mockReset()
    resetBackHandlersForTests()
})

afterEach(() => {
    resetBackHandlersForTests()
    delete (document as unknown as Record<string, unknown>).visibilityState
    vi.useRealTimers()
})

describe('registry', () => {
    test('(F) handlers run newest first and the first true ends the press', () => {
        const calls: string[] = []
        registerBackHandler(() => (calls.push('old'), true))
        registerBackHandler(() => (calls.push('mid'), true))
        registerBackHandler(() => (calls.push('new'), false))
        expect(dispatchBack()).toBe(true)
        expect(calls).toEqual(['new', 'mid'])
    })

    test('(F) the host hook is the dispatcher and survives its property being deleted', () => {
        registerBackHandler(() => true)
        expect(window.__risuTaniumBack?.()).toBe(true)
        delete window.__risuTaniumBack
        expect(window.__risuTaniumBack).toBeUndefined()
        ensureBackHook()
        expect(window.__risuTaniumBack?.()).toBe(true)
    })

    test('(F) the hook property is not writable', () => {
        ensureBackHook()
        const hook = window.__risuTaniumBack
        expect(() => {
            'use strict'
            ;(window as unknown as Record<string, unknown>).__risuTaniumBack = () => true
        }).toThrow()
        expect(window.__risuTaniumBack).toBe(hook)
    })

    test('(F) unregister removes only its own handler and is idempotent', () => {
        const calls: string[] = []
        const offA = registerBackHandler(() => (calls.push('a'), false))
        registerBackHandler(() => (calls.push('b'), false))
        offA()
        offA()
        dispatchBack()
        expect(calls).toEqual(['b'])
    })

    test('(F) the same function registered twice is two registrations', () => {
        const handler = vi.fn(() => false)
        const off = registerBackHandler(handler)
        registerBackHandler(handler)
        off()
        dispatchBack()
        expect(handler).toHaveBeenCalledTimes(1)
    })

    test('(F) a throwing handler is logged and older handlers and the guard still run', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        installBackGuard({ showToast })
        const older = vi.fn(() => false)
        registerBackHandler(older)
        registerBackHandler(() => {
            throw new Error('boom')
        })
        expect(dispatchBack()).toBe(true)
        expect(older).toHaveBeenCalledTimes(1)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })

    test('(F) a handler unregistering during dispatch makes the loop skip nothing', () => {
        const calls: string[] = []
        registerBackHandler(() => (calls.push('oldest'), false))
        const offMiddle = registerBackHandler(() => (calls.push('middle'), false))
        registerBackHandler(() => {
            calls.push('newest')
            offMiddle()
            return false
        })
        dispatchBack()
        expect(calls).toEqual(['newest', 'middle', 'oldest'])
        calls.length = 0
        dispatchBack()
        expect(calls).toEqual(['newest', 'oldest'])
    })
})

describe('quit guard', () => {
    test('(F) without a guard an unhandled press is false and shows nothing', () => {
        expect(dispatchBack()).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })

    test('(F) with zero handlers the first press warns and arms, the second within the window quits', () => {
        installBackGuard({ showToast })
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1500)
        expect(dispatchBack()).toBe(false)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(F) a gap of 1 s and one just under the window both quit', () => {
        installBackGuard({ showToast })
        dispatchBack()
        vi.advanceTimersByTime(1000)
        expect(dispatchBack()).toBe(false)
        dispatchBack()
        vi.advanceTimersByTime(QUIT_WINDOW_MS - 1)
        expect(dispatchBack()).toBe(false)
    })

    test('(F) a stale arm warns again instead of quitting', () => {
        installBackGuard({ showToast })
        dispatchBack()
        vi.advanceTimersByTime(QUIT_WINDOW_MS)
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
    })

    test('(F) a second press 2500 ms after the warning warns again', () => {
        installBackGuard({ showToast })
        expect(dispatchBack()).toBe(true)
        vi.advanceTimersByTime(2500)
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
    })

    test('(F) a clock moved back past the arm warns again instead of quitting', () => {
        installBackGuard({ showToast })
        expect(dispatchBack()).toBe(true)
        vi.setSystemTime(1_000_000 - 500)
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
        vi.advanceTimersByTime(500)
        expect(dispatchBack()).toBe(false)
    })

    test('(F) the quitting press clears the arm: a third press warns again', () => {
        installBackGuard({ showToast })
        dispatchBack()
        expect(dispatchBack()).toBe(false)
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
    })

    test('(F) the page going hidden drops the arm; becoming visible alone does not arm', () => {
        installBackGuard({ showToast })
        dispatchBack()
        setVisibility('hidden')
        setVisibility('visible')
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
    })

    test('(F) a visible change does not drop the arm', () => {
        installBackGuard({ showToast })
        dispatchBack()
        setVisibility('visible')
        expect(dispatchBack()).toBe(false)
    })

    test('(F) a press handled by a handler neither warns nor arms', () => {
        installBackGuard({ showToast })
        const off = registerBackHandler(() => true)
        expect(dispatchBack()).toBe(true)
        off()
        expect(showToast).not.toHaveBeenCalled()
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
    })

    test('(F) a covered press is consumed, closes the dialog once, runs no handler, neither warns nor flushes', () => {
        const flush = vi.fn()
        installBackGuard({ showToast, flush })
        const handler = vi.fn(() => true)
        registerBackHandler(handler)
        covered.mockReturnValue(true)
        expect(dispatchBack()).toBe(true)
        expect(closeDialog).toHaveBeenCalledTimes(1)
        expect(handler).not.toHaveBeenCalled()
        expect(showToast).not.toHaveBeenCalled()
        vi.runAllTimers()
        expect(flush).not.toHaveBeenCalled()
        covered.mockReturnValue(false)
        expect(dispatchBack()).toBe(true)
        expect(handler).toHaveBeenCalledTimes(1)
        expect(closeDialog).toHaveBeenCalledTimes(1)
    })

    test('(F) a covered press with no guard installed is still consumed', () => {
        covered.mockReturnValue(true)
        expect(dispatchBack()).toBe(true)
        expect(closeDialog).toHaveBeenCalledTimes(1)
    })

    test('(F) a covered press resets the arm: after the dialog the next press warns, the one after quits', () => {
        installBackGuard({ showToast })
        dispatchBack()
        covered.mockReturnValue(true)
        expect(dispatchBack()).toBe(true)
        covered.mockReturnValue(false)
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(2)
        expect(dispatchBack()).toBe(false)
    })

    test('(F) a throwing dialog close is logged and the press is still consumed', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        closeDialog.mockImplementation(() => {
            throw new Error('onCancel failed')
        })
        covered.mockReturnValue(true)
        expect(dispatchBack()).toBe(true)
        expect(error).toHaveBeenCalled()
        error.mockRestore()
    })

    test('(F) the flush runs once, after the answer, on the warning press and not on the quitting press', () => {
        const flush = vi.fn()
        installBackGuard({ showToast, flush })
        expect(dispatchBack()).toBe(true)
        expect(flush).not.toHaveBeenCalled()
        vi.advanceTimersByTime(0)
        expect(flush).toHaveBeenCalledTimes(1)
        expect(dispatchBack()).toBe(false)
        vi.runAllTimers()
        expect(flush).toHaveBeenCalledTimes(1)
    })

    test('(F) a press handled by a handler does not flush', () => {
        const flush = vi.fn()
        installBackGuard({ showToast, flush })
        registerBackHandler(() => true)
        dispatchBack()
        vi.runAllTimers()
        expect(flush).not.toHaveBeenCalled()
    })

    test('(F) a throwing flush is logged after the answer and the warning still shows and arms', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        installBackGuard({ showToast, flush: () => { throw new Error('save failed') } })
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        expect(error).not.toHaveBeenCalled()
        expect(() => vi.runAllTimers()).not.toThrow()
        expect(error).toHaveBeenCalled()
        expect(dispatchBack()).toBe(false)
        error.mockRestore()
    })

    test('(F) a throwing showToast still flushes after that press, which quits', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const flush = vi.fn()
        installBackGuard({ showToast: () => { throw new Error('no toast') }, flush })
        expect(dispatchBack()).toBe(false)
        expect(flush).not.toHaveBeenCalled()
        vi.runAllTimers()
        expect(flush).toHaveBeenCalledTimes(1)
        error.mockRestore()
    })

    test('(F) a throwing showToast returns false and leaves nothing armed', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        let failing = true
        installBackGuard({
            showToast: () => {
                if (failing) {
                    throw new Error('no toast')
                }
                showToast()
            },
        })
        expect(dispatchBack()).toBe(false)
        failing = false
        expect(dispatchBack()).toBe(true)
        expect(showToast).toHaveBeenCalledTimes(1)
        error.mockRestore()
    })

    test('(F) installing the guard again replaces the old one and its visibility listener', () => {
        const first = vi.fn()
        installBackGuard({ showToast: first })
        installBackGuard({ showToast })
        dispatchBack()
        expect(first).not.toHaveBeenCalled()
        expect(showToast).toHaveBeenCalledTimes(1)
    })
})
