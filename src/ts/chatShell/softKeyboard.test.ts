// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { HostIme, ImeState } from '../android/hostBridge'
import { isSoftKeyboardOpen, isTextField, SOFT_KEYBOARD_MIN_INSET, SOFT_KEYBOARD_ROTATION_QUIET_MS, watchSoftKeyboard } from './softKeyboard'

class ViewportStub extends EventTarget {
    height = 800
    width = 400
    scale = 1
    resize(height: number, width = this.width): void {
        this.height = height
        this.width = width
        this.dispatchEvent(new Event('resize'))
    }
}

// The host bridge as the page sees it: `read` is null until the first report.
class HostImeStub implements HostIme {
    state: ImeState | null = null
    listeners = new Set<(state: ImeState) => void>()
    read(): ImeState | null {
        return this.state
    }
    subscribe(listener: (state: ImeState) => void): () => void {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }
    report(visible: boolean, height: number): void {
        this.state = { visible, height }
        for (const listener of [...this.listeners]) listener(this.state)
    }
}

const base = { textFocused: true, host: null, windowHeight: 800, viewportHeight: 800 - SOFT_KEYBOARD_MIN_INSET, scale: 1 }

// Heights measured on the device: portrait window, the same window with Gboard and Honeyboard open, the lower split-screen
// window, and the two window heights seen while rotating to landscape with the keyboard open.
const PORTRAIT = 773.7
const GBOARD_VIEWPORT = 485.3
const HONEYBOARD_VIEWPORT = 446.1
const SPLIT_WINDOW = 370.7
const ROTATION_TRANSIENT = 51
const LANDSCAPE_WITH_KEYBOARD = 387

describe('isSoftKeyboardOpen', () => {
    test('without a host report, a focused text field and a viewport shorter than the window by the threshold is open', () => {
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
    test('a shrink of the whole window (split screen) shortens both heights alike and is closed', () => {
        expect(isSoftKeyboardOpen({ ...base, windowHeight: SPLIT_WINDOW, viewportHeight: SPLIT_WINDOW })).toBe(false)
    })
    test('a host report is authoritative: visible opens with no viewport difference, hidden closes with a large one', () => {
        expect(isSoftKeyboardOpen({ ...base, windowHeight: 800, viewportHeight: 800, host: { visible: true, height: 288 } })).toBe(true)
        expect(isSoftKeyboardOpen({ ...base, host: { visible: false, height: 0 } })).toBe(false)
    })
    test('a host report still needs a focused text field', () => {
        expect(isSoftKeyboardOpen({ ...base, textFocused: false, host: { visible: true, height: 288 } })).toBe(false)
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

    function setWindowHeight(height: number): void {
        Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
    }

    // A change of the whole window: the window and the visual viewport shrink together.
    function resizeWindow(height: number, width?: number): void {
        setWindowHeight(height)
        viewport.resize(height, width)
    }

    function setup(ime: HostIme | null = null, height = 800): ReturnType<typeof vi.fn> {
        viewport = new ViewportStub()
        viewport.height = height
        Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
        setWindowHeight(height)
        root = document.createElement('div')
        field = document.createElement('textarea')
        outside = document.createElement('textarea')
        root.append(field)
        document.body.append(root, outside)
        const changes = vi.fn()
        stop = watchSoftKeyboard(root, window, changes, ime)
        return changes
    }

    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => {
        stop()
        vi.useRealTimers()
        document.body.replaceChildren()
        Reflect.deleteProperty(window, 'visualViewport')
    })

    describe('without a host report (web, desktop)', () => {
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

        test('a split-screen entry with the composer focused and no keyboard shrinks both heights and is not a keyboard', () => {
            const changes = setup(null, PORTRAIT)
            field.focus()
            resizeWindow(SPLIT_WINDOW)
            expect(changes).not.toHaveBeenCalled()
        })

        test('a rotation round trip with a focused field never reads as a keyboard and leaves nothing behind', () => {
            const changes = setup(null, PORTRAIT)
            field.focus()
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            resizeWindow(PORTRAIT, 400)
            expect(changes).not.toHaveBeenCalled()
            viewport.resize(PORTRAIT - SOFT_KEYBOARD_MIN_INSET)
            expect(changes).toHaveBeenLastCalledWith(true)
        })
    })

    describe('with a host report (Android)', () => {
        test('the host\'s report opens and closes it whatever the window does; the keyboard shrinks the window itself', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            setWindowHeight(GBOARD_VIEWPORT)
            viewport.resize(GBOARD_VIEWPORT)
            expect(changes).toHaveBeenCalledTimes(1)
            expect(changes).toHaveBeenLastCalledWith(true)
            ime.report(false, 0)
            resizeWindow(PORTRAIT)
            expect(changes).toHaveBeenCalledTimes(2)
            expect(changes).toHaveBeenLastCalledWith(false)
        })

        test('both keyboards\' heights from the device open it', () => {
            for (const shrunk of [GBOARD_VIEWPORT, HONEYBOARD_VIEWPORT]) {
                const ime = new HostImeStub()
                const changes = setup(ime, PORTRAIT)
                field.focus()
                ime.report(true, PORTRAIT - shrunk)
                expect(changes).toHaveBeenLastCalledWith(true)
                stop()
                document.body.replaceChildren()
            }
        })

        test('entering split screen with the composer focused and no keyboard is not a keyboard', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            ime.report(false, 0)
            field.focus()
            resizeWindow(SPLIT_WINDOW)
            expect(changes).not.toHaveBeenCalled()
        })

        test('a floating keyboard takes no space from the page, so it reads as closed', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(false, 0)
            viewport.resize(PORTRAIT - 300)
            expect(changes).not.toHaveBeenCalled()
        })

        test('a rotation with the keyboard open gives no extra change while the host reports it visible throughout', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            expect(changes).toHaveBeenCalledTimes(1)
            resizeWindow(ROTATION_TRANSIENT, 798)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            ime.report(true, 200)
            resizeWindow(PORTRAIT - 288, 400)
            expect(changes).toHaveBeenCalledTimes(1)
            ime.report(false, 0)
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS)
            expect(changes).toHaveBeenCalledTimes(2)
            expect(changes).toHaveBeenLastCalledWith(false)
        })

        // Phone 1 event order: the host report leads the window resize by 2 to 46 ms.
        test('a plain close settles at the first resize at the same width, with no timer needed', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            resizeWindow(GBOARD_VIEWPORT)
            ime.report(false, 0)
            expect(changes).toHaveBeenCalledTimes(1)
            resizeWindow(PORTRAIT)
            expect(changes).toHaveBeenCalledTimes(2)
            expect(changes).toHaveBeenLastCalledWith(false)
        })

        test('a close with no resize settles after the settle delay and not before', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            ime.report(false, 0)
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS - 1)
            expect(changes).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(1)
            expect(changes).toHaveBeenLastCalledWith(false)
            expect(changes).toHaveBeenCalledTimes(2)
        })

        // Device order seen on Gboard and Honeyboard: the window turns before the host reports the close.
        test('a width change before the host close still counts as a rotation', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            vi.advanceTimersByTime(80)
            resizeWindow(ROTATION_TRANSIENT, 798)
            vi.advanceTimersByTime(4)
            ime.report(false, 0)
            vi.advanceTimersByTime(74)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            expect(changes).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(164)
            ime.report(true, 200)
            vi.advanceTimersByTime(1000)
            expect(changes).toHaveBeenCalledTimes(1)
        })

        test('a host close whose first resize comes 116 ms later, followed by a visible report, gives no change', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            ime.report(false, 0)
            vi.advanceTimersByTime(116)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            vi.advanceTimersByTime(109)
            ime.report(true, 200)
            vi.advanceTimersByTime(1000)
            expect(changes).toHaveBeenCalledTimes(1)
        })

        test('a plain close in landscape long after a rotation settles at the first resize at the same width', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            ime.report(true, 200)
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS + 1)
            expect(changes).toHaveBeenCalledTimes(1)
            ime.report(false, 0)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD + 200, 798)
            expect(changes).toHaveBeenCalledTimes(2)
            expect(changes).toHaveBeenLastCalledWith(false)
        })

        test('a rotation close followed by a visible report again gives no change at all', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            resizeWindow(GBOARD_VIEWPORT)
            expect(changes).toHaveBeenCalledTimes(1)
            // The host reports the close before the first landscape resize, then the visible report follows the resizes.
            ime.report(false, 0)
            vi.advanceTimersByTime(8)
            resizeWindow(ROTATION_TRANSIENT, 798)
            vi.advanceTimersByTime(8)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            vi.advanceTimersByTime(154)
            ime.report(true, 200)
            vi.advanceTimersByTime(1000)
            expect(changes).toHaveBeenCalledTimes(1)
        })

        test('a width change that stays quiet with the host still closed commits the close after the quiet period from the last resize', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            ime.report(false, 0)
            resizeWindow(ROTATION_TRANSIENT, 798)
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS - 1)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS - 1)
            expect(changes).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(1)
            expect(changes).toHaveBeenCalledTimes(2)
            expect(changes).toHaveBeenLastCalledWith(false)
        })

        test('focus leaving the field closes at once even while a host close is waiting', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            ime.report(false, 0)
            outside.focus()
            expect(changes).toHaveBeenLastCalledWith(false)
            expect(changes).toHaveBeenCalledTimes(2)
        })

        test('after dispose, a waiting host close never fires', () => {
            const ime = new HostImeStub()
            const changes = setup(ime, PORTRAIT)
            field.focus()
            ime.report(true, PORTRAIT - GBOARD_VIEWPORT)
            ime.report(false, 0)
            stop()
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS * 5)
            expect(changes).toHaveBeenCalledTimes(1)
        })

        test('after dispose, no timer is left from a remembered width change', () => {
            const ime = new HostImeStub()
            setup(ime, PORTRAIT)
            resizeWindow(LANDSCAPE_WITH_KEYBOARD, 798)
            expect(vi.getTimerCount()).toBe(1)
            stop()
            expect(vi.getTimerCount()).toBe(0)
        })

        test('the fallback is used before the first report; afterwards the host alone decides', () => {
            const ime = new HostImeStub()
            const changes = setup(ime)
            field.focus()
            viewport.resize(450)
            expect(changes).toHaveBeenLastCalledWith(true)
            ime.report(false, 0)
            vi.advanceTimersByTime(SOFT_KEYBOARD_ROTATION_QUIET_MS)
            expect(changes).toHaveBeenLastCalledWith(false)
            viewport.resize(400)
            viewport.resize(450)
            expect(changes).toHaveBeenCalledTimes(2)
        })

        test('a report that was already there when watching starts is used at once', () => {
            const ime = new HostImeStub()
            ime.state = { visible: true, height: 288 }
            viewport = new ViewportStub()
            Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
            setWindowHeight(800)
            root = document.createElement('div')
            field = document.createElement('textarea')
            root.append(field)
            document.body.append(root)
            field.focus()
            const changes = vi.fn()
            stop = watchSoftKeyboard(root, window, changes, ime)
            expect(changes).toHaveBeenCalledWith(true)
        })

        test('a visible keyboard with focus outside the shell does not count', () => {
            const ime = new HostImeStub()
            const changes = setup(ime)
            outside.focus()
            ime.report(true, 288)
            expect(changes).not.toHaveBeenCalled()
            field.focus()
            expect(changes).toHaveBeenLastCalledWith(true)
            outside.focus()
            expect(changes).toHaveBeenLastCalledWith(false)
        })

        test('it works where the browser offers no visual viewport', () => {
            const ime = new HostImeStub()
            viewport = new ViewportStub()
            Object.defineProperty(window, 'visualViewport', { value: null, configurable: true })
            root = document.createElement('div')
            field = document.createElement('textarea')
            root.append(field)
            document.body.append(root)
            const changes = vi.fn()
            stop = watchSoftKeyboard(root, window, changes, ime)
            field.focus()
            ime.report(true, 288)
            expect(changes).toHaveBeenLastCalledWith(true)
        })

        test('after dispose, host reports stop being listened to', () => {
            const ime = new HostImeStub()
            const changes = setup(ime)
            field.focus()
            stop()
            expect(ime.listeners.size).toBe(0)
            ime.report(true, 288)
            expect(changes).not.toHaveBeenCalled()
        })
    })

    test('after dispose, focus and viewport changes report nothing', () => {
        const changes = setup()
        field.focus()
        stop()
        viewport.resize(450)
        expect(changes).not.toHaveBeenCalled()
    })
})
