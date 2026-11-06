// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { isSoftKeyboardOpen, isTextField, SOFT_KEYBOARD_MIN_INSET, watchSoftKeyboard } from './softKeyboard'

class ViewportStub extends EventTarget {
    height = 800
    width = 400
    scale = 1
    resize(height: number): void {
        this.height = height
        this.dispatchEvent(new Event('resize'))
    }
}

const base = { textFocused: true, referenceHeight: 800, viewportHeight: 800 - SOFT_KEYBOARD_MIN_INSET, scale: 1 }

describe('isSoftKeyboardOpen', () => {
    test('a focused text field and an inset of at least the threshold is open', () => {
        expect(isSoftKeyboardOpen(base)).toBe(true)
    })
    test('an inset below the threshold (URL bar, toolbar) is closed', () => {
        expect(isSoftKeyboardOpen({ ...base, viewportHeight: 800 - SOFT_KEYBOARD_MIN_INSET + 1 })).toBe(false)
    })
    test('without a focused text field a shrunken viewport is closed', () => {
        expect(isSoftKeyboardOpen({ ...base, textFocused: false })).toBe(false)
    })
    test('a pinch-zoomed viewport is closed', () => {
        expect(isSoftKeyboardOpen({ ...base, scale: 2 })).toBe(false)
    })
    test('non-finite heights are closed', () => {
        expect(isSoftKeyboardOpen({ ...base, viewportHeight: Number.NaN })).toBe(false)
    })
})

describe('isTextField', () => {
    test('text areas, text inputs and contenteditable hosts count; buttons, checkboxes and read-only fields do not', () => {
        const make = (html: string) => { const holder = document.createElement('div'); holder.innerHTML = html; return holder.firstElementChild as HTMLElement }
        expect(isTextField(make('<textarea></textarea>'))).toBe(true)
        expect(isTextField(make('<input type="text">'))).toBe(true)
        expect(isTextField(make('<input type="search">'))).toBe(true)
        expect(isTextField(make('<input type="checkbox">'))).toBe(false)
        expect(isTextField(make('<input type="submit">'))).toBe(false)
        expect(isTextField(make('<textarea readonly></textarea>'))).toBe(false)
        expect(isTextField(make('<textarea disabled></textarea>'))).toBe(false)
        expect(isTextField(make('<button></button>'))).toBe(false)
        expect(isTextField(null)).toBe(false)
    })
})

describe('watchSoftKeyboard', () => {
    let viewport: ViewportStub
    let root: HTMLElement
    let field: HTMLTextAreaElement
    let outside: HTMLTextAreaElement
    let stop: () => void

    function setup(): ReturnType<typeof vi.fn> {
        viewport = new ViewportStub()
        Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
        root = document.createElement('div')
        field = document.createElement('textarea')
        outside = document.createElement('textarea')
        root.append(field)
        document.body.append(root, outside)
        const changes = vi.fn()
        stop = watchSoftKeyboard(root, window, changes)
        return changes
    }

    afterEach(() => {
        stop()
        document.body.replaceChildren()
        Reflect.deleteProperty(window, 'visualViewport')
    })

    test('focus plus a viewport shrink opens it; recovering the viewport closes it', () => {
        const changes = setup()
        field.focus()
        expect(changes).not.toHaveBeenCalled()
        viewport.resize(450)
        expect(changes).toHaveBeenLastCalledWith(true)
        viewport.resize(800)
        expect(changes).toHaveBeenLastCalledWith(false)
        expect(changes).toHaveBeenCalledTimes(2)
    })

    test('focus leaving the text field closes it while the viewport is still short', () => {
        const changes = setup()
        field.focus()
        viewport.resize(450)
        field.blur()
        expect(changes).toHaveBeenLastCalledWith(false)
    })

    test('focus moving to a text field outside the shell closes it', () => {
        const changes = setup()
        field.focus()
        viewport.resize(450)
        outside.focus()
        expect(changes).toHaveBeenLastCalledWith(false)
    })

    test('a shrink below the threshold never opens it', () => {
        const changes = setup()
        field.focus()
        viewport.resize(800 - SOFT_KEYBOARD_MIN_INSET + 1)
        expect(changes).not.toHaveBeenCalled()
    })

    test('a shrink without a focused text field never opens it', () => {
        const changes = setup()
        viewport.resize(450)
        expect(changes).not.toHaveBeenCalled()
    })

    test('a keyboard that also shrinks the window is still measured against the height before focus', () => {
        const changes = setup()
        field.focus()
        Object.defineProperty(window, 'innerHeight', { value: 450, configurable: true })
        viewport.resize(450)
        expect(changes).toHaveBeenLastCalledWith(true)
    })

    test('after dispose, focus and viewport changes report nothing', () => {
        const changes = setup()
        field.focus()
        stop()
        viewport.resize(450)
        expect(changes).not.toHaveBeenCalled()
    })
})
