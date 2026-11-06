import { describe, expect, test } from 'vitest'
import { asShellFocus, isShellFocusing } from './shellFocus'

describe('shell focus mark', () => {
    test('is set only while the wrapped call runs and returns its value', () => {
        expect(isShellFocusing()).toBe(false)
        let inside = false
        const value = asShellFocus(() => { inside = isShellFocusing(); return 7 })
        expect(inside).toBe(true)
        expect(value).toBe(7)
        expect(isShellFocusing()).toBe(false)
    })
    test('nested calls keep the mark until the outermost one ends', () => {
        asShellFocus(() => {
            asShellFocus(() => {})
            expect(isShellFocusing()).toBe(true)
        })
        expect(isShellFocusing()).toBe(false)
    })
    test('a throwing call still clears the mark', () => {
        expect(() => asShellFocus(() => { throw new Error('boom') })).toThrow('boom')
        expect(isShellFocusing()).toBe(false)
    })
    test('a focus event dispatched by the wrapped focus() call sees the mark, a later user focus does not', () => {
        // A plain EventTarget stands in for the element: focus() dispatches its events synchronously.
        const element = new EventTarget()
        const seen: boolean[] = []
        element.addEventListener('focusin', () => { seen.push(isShellFocusing()) })
        asShellFocus(() => element.dispatchEvent(new Event('focusin')))
        element.dispatchEvent(new Event('focusin'))
        expect(seen).toEqual([true, false])
    })
})
