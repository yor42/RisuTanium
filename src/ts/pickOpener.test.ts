// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    PICK_OPENER_TTL_MS,
    PICK_RETURN_WINDOW_MS,
    clearPickOpener,
    markPickReturned,
    rememberPickOpener,
    resetPickOpenerForTest,
    takePickOpener,
    takePickReturn,
} from './pickOpener'

beforeEach(() => {
    resetPickOpenerForTest()
    vi.useFakeTimers()
})

afterEach(() => {
    resetPickOpenerForTest()
    vi.useRealTimers()
})

describe('takePickReturn', () => {
    // R307-8
    test('is false without a mark', () => {
        expect(takePickReturn()).toBe(false)
    })

    test('is true once inside the window and false after, because the first ask consumes the mark', () => {
        markPickReturned()
        vi.advanceTimersByTime(PICK_RETURN_WINDOW_MS)
        expect(takePickReturn()).toBe(true)
        expect(takePickReturn()).toBe(false)
    })

    test('is false past the window, and that ask also clears the mark', () => {
        markPickReturned()
        vi.advanceTimersByTime(PICK_RETURN_WINDOW_MS + 1)
        expect(takePickReturn()).toBe(false)
        expect(takePickReturn()).toBe(false)
    })

    test('a newer mark replaces an older one', () => {
        markPickReturned()
        vi.advanceTimersByTime(PICK_RETURN_WINDOW_MS + 500)
        markPickReturned()
        expect(takePickReturn()).toBe(true)
    })
})

describe('takePickOpener', () => {
    function attached(): HTMLButtonElement {
        const el = document.createElement('button')
        document.body.appendChild(el)
        return el
    }

    afterEach(() => document.body.replaceChildren())

    test('is null while the picker is still open, because the files have not come back', () => {
        rememberPickOpener(attached())
        expect(takePickOpener()).toBeNull()
    })

    test('gives the remembered element once after the files came back', () => {
        const el = attached()
        rememberPickOpener(el)
        markPickReturned()
        expect(takePickOpener()).toBe(el)
        expect(takePickOpener()).toBeNull()
    })

    test('lives for the time limit and not a millisecond longer, and the late ask clears it', () => {
        const el = attached()
        rememberPickOpener(el)
        markPickReturned()
        vi.advanceTimersByTime(PICK_OPENER_TTL_MS)
        expect(takePickOpener()).toBe(el)

        rememberPickOpener(el)
        markPickReturned()
        vi.advanceTimersByTime(PICK_OPENER_TTL_MS + 1)
        expect(takePickOpener()).toBeNull()
        expect(takePickOpener()).toBeNull()
    })

    test('a pointer press or a key press after the files came back forgets it, and each listener is spent', () => {
        const el = attached()
        const add = vi.spyOn(document, 'addEventListener')
        const remove = vi.spyOn(document, 'removeEventListener')
        rememberPickOpener(el)
        markPickReturned()
        expect(add.mock.calls.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown'])
        document.dispatchEvent(new Event('keydown'))
        expect(takePickOpener()).toBeNull()
        expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['keydown', 'pointerdown'])
        add.mockRestore()
        remove.mockRestore()

        rememberPickOpener(el)
        markPickReturned()
        document.dispatchEvent(new Event('pointerdown'))
        expect(takePickOpener()).toBeNull()
    })

    test('an element that left the page is not given', () => {
        const el = attached()
        rememberPickOpener(el)
        markPickReturned()
        el.remove()
        expect(takePickOpener()).toBeNull()
    })

    test('clearing, or remembering nothing, forgets the element', () => {
        const el = attached()
        rememberPickOpener(el)
        markPickReturned()
        clearPickOpener()
        expect(takePickOpener()).toBeNull()

        rememberPickOpener(el)
        markPickReturned()
        rememberPickOpener(null)
        expect(takePickOpener()).toBeNull()
    })
})
