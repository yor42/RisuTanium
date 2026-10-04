import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { longpress, type LongpressCallback } from './longtouch'

// The action is exercised on a real DOM node with fake timers; no module is
// mocked. Touches are plain objects, as happy-dom accepts them in a TouchEvent.

interface Point {
    identifier: number
    target: EventTarget
    clientX: number
    clientY: number
}

let node: HTMLButtonElement
let clicks: number
let callback: Mock<LongpressCallback>
let teardown: Array<() => void>

function point(x = 100, y = 100, identifier = 1): Point {
    return { identifier, target: node, clientX: x, clientY: y }
}

function touch(type: string, touches: Point[], changed: Point[] = touches): TouchEvent {
    const ev = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: touches as unknown as Touch[],
        changedTouches: changed as unknown as Touch[],
    })
    node.dispatchEvent(ev)
    return ev
}

function mouse(type: string): MouseEvent {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true })
    node.dispatchEvent(ev)
    return ev
}

function mount(param: Parameters<typeof longpress>[1]) {
    const action = longpress(node, param)
    teardown.push(() => action.destroy())
    return action
}

beforeEach(() => {
    vi.useFakeTimers()
    node = document.createElement('button')
    document.body.appendChild(node)
    clicks = 0
    node.addEventListener('click', () => { clicks++ })
    callback = vi.fn<LongpressCallback>()
    teardown = []
})

afterEach(() => {
    teardown.forEach((fn) => fn())
    node.remove()
    vi.useRealTimers()
})

describe('longpress: mouse', () => {
    // Compatibility guard: the plain-callback form behaves as a mouse-only long-press.
    test('a mouse button held 600 ms fires the callback once', () => {
        mount(callback)
        mouse('mousedown')
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a mouse button released before 500 ms does not fire', () => {
        mount(callback)
        mouse('mousedown')
        vi.advanceTimersByTime(300)
        mouse('mouseup')
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('a mouse move before 500 ms cancels the press', () => {
        mount(callback)
        mouse('mousedown')
        vi.advanceTimersByTime(200)
        window.dispatchEvent(new MouseEvent('mousemove'))
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('the options form with touch enabled still fires on a held mouse button', () => {
        mount({ callback, touch: true })
        mouse('mousedown')
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    // Feature test: destroy clears a pending mouse timer.
    test('destroy cancels a pending mouse press', () => {
        const action = mount(callback)
        mouse('mousedown')
        action.destroy()
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })
})

describe('longpress: touch is opt-in', () => {
    test('a plain callback never fires on a held touch', () => {
        mount(callback)
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('the options form without touch never fires on a held touch', () => {
        mount({ callback })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('a touch held 600 ms fires the callback once with the touch event', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback.mock.calls[0][0]).toBeInstanceOf(TouchEvent)
    })

    test('a touch released at 300 ms does not fire and its click is not swallowed', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(300)
        const end = touch('touchend', [], [point()])
        node.click()
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
        expect(end.defaultPrevented).toBe(false)
        expect(clicks).toBe(1)
    })

    test('a touch that moves 20 px at 200 ms does not fire', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point(100, 100)])
        vi.advanceTimersByTime(200)
        touch('touchmove', [point(120, 100)])
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('a touch that drifts 5 px still fires', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point(100, 100)])
        vi.advanceTimersByTime(200)
        touch('touchmove', [point(105, 100)])
        vi.advanceTimersByTime(400)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a second finger down cancels the pending press', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point(100, 100, 1)])
        vi.advanceTimersByTime(200)
        touch('touchstart', [point(100, 100, 1), point(150, 100, 2)], [point(150, 100, 2)])
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('a touchcancel before 500 ms does not fire', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(200)
        touch('touchcancel', [], [point()])
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })

    test('destroy cancels a pending touch press', () => {
        const action = mount({ callback, touch: true })
        touch('touchstart', [point()])
        action.destroy()
        vi.advanceTimersByTime(600)
        expect(callback).not.toHaveBeenCalled()
    })
})

describe('longpress: click after a fired touch long-press', () => {
    test('a click delivered after the touch ends is swallowed, and a later tap clicks normally', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        const end = touch('touchend', [], [point()])
        expect(end.defaultPrevented).toBe(true)
        node.click()
        expect(clicks).toBe(0)

        vi.advanceTimersByTime(1000)
        touch('touchstart', [point()])
        vi.advanceTimersByTime(100)
        touch('touchend', [], [point()])
        node.click()
        expect(callback).toHaveBeenCalledTimes(1)
        expect(clicks).toBe(1)
    })

    test('when no click follows, a tap 1 s later clicks exactly once', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        touch('touchend', [], [point()])

        vi.advanceTimersByTime(1000)
        touch('touchstart', [point()])
        vi.advanceTimersByTime(100)
        touch('touchend', [], [point()])
        node.click()
        expect(callback).toHaveBeenCalledTimes(1)
        expect(clicks).toBe(1)
    })

    test('a tap that begins right after the long-press is not swallowed', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        touch('touchend', [], [point()])

        vi.advanceTimersByTime(50)
        touch('touchstart', [point()])
        vi.advanceTimersByTime(100)
        touch('touchend', [], [point()])
        node.click()
        expect(clicks).toBe(1)
    })

    test('a touchcancel after a fired long-press also swallows the click that follows', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        touch('touchcancel', [], [point()])
        node.click()
        expect(callback).toHaveBeenCalledTimes(1)
        expect(clicks).toBe(0)
    })

    test('a click arriving after the suppression window is not swallowed', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        touch('touchend', [], [point()])
        vi.advanceTimersByTime(700)
        node.click()
        expect(clicks).toBe(1)
    })

    test('destroy leaves later clicks alone', () => {
        const action = mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        touch('touchend', [], [point()])
        action.destroy()
        node.click()
        expect(clicks).toBe(1)
    })
})

describe('longpress: mouse events that follow a touch', () => {
    test('a compatibility mousedown and mouseup after a held touch add no second callback', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
        touch('touchend', [], [point()])
        vi.advanceTimersByTime(20)
        mouse('mousedown')
        mouse('mouseup')
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a compatibility mousedown with no mouseup adds no second callback', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(1500)
        expect(callback).toHaveBeenCalledTimes(1)
        touch('touchend', [], [point()])
        vi.advanceTimersByTime(20)
        mouse('mousedown')
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a mouse press that starts more than a second after the touch fires normally', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(200)
        touch('touchend', [], [point()])
        vi.advanceTimersByTime(1100)
        mouse('mousedown')
        vi.advanceTimersByTime(600)
        expect(callback).toHaveBeenCalledTimes(1)
    })

    test('a mousedown while a touch is still down does not start a mouse press', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        vi.advanceTimersByTime(100)
        mouse('mousedown')
        touch('touchend', [], [point()])
        vi.advanceTimersByTime(20)
        mouse('mouseup')
        vi.advanceTimersByTime(700)
        expect(callback).not.toHaveBeenCalled()
    })
})

describe('longpress: context menu', () => {
    test('a contextmenu during a touch is prevented', () => {
        mount({ callback, touch: true })
        touch('touchstart', [point()])
        const menu = new Event('contextmenu', { bubbles: true, cancelable: true })
        node.dispatchEvent(menu)
        expect(menu.defaultPrevented).toBe(true)
    })

    test('a contextmenu with no touch down is left alone', () => {
        mount({ callback, touch: true })
        const menu = new Event('contextmenu', { bubbles: true, cancelable: true })
        node.dispatchEvent(menu)
        expect(menu.defaultPrevented).toBe(false)
    })
})
