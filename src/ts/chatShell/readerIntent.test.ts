import { describe, expect, test } from 'vitest'
import { TOUCH_SLOP, bindReaderIntent, canHostMove, createReaderIntent, type IntentDirection, type ReaderIntentEvent, type TouchSample } from './readerIntent'

function harness(canMove: (direction: IntentDirection) => boolean = () => true) {
    const intent = createReaderIntent({ canMove })
    const events: ReaderIntentEvent[] = []
    intent.subscribe((event) => events.push(event))
    return { intent, events }
}

const finger = (x: number, y: number, fingers = 1): TouchSample => ({ x, y, fingers })
const total = (events: ReaderIntentEvent[], direction: IntentDirection) => events.filter((event) => event.direction === direction).reduce((sum, event) => sum + event.distance, 0)

// Sequences shaped like the ones Android Chrome delivers: a start, a run of moves, an end.
describe('T-A1 touch sequences', () => {
    test('a tap, a pager tap and a long press without travel emit nothing', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(100, 300))
        intent.touchMove(finger(101, 302))
        intent.touchEnd(0)
        expect(events).toEqual([])
    })
    test('travel below the slop emits nothing, at the slop it counts from the start of the touch', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(100, 300))
        intent.touchMove(finger(100, 300 + TOUCH_SLOP - 1))
        expect(events).toEqual([])
        intent.touchMove(finger(100, 300 + TOUCH_SLOP))
        expect(events).toEqual([{ direction: 'older', distance: TOUCH_SLOP, source: 'touch' }])
    })
    test('a slow drag down is older and a drag up is newer, with the travel accumulating', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(100, 300))
        for (let y = 305; y <= 345; y += 5) intent.touchMove(finger(100, y))
        intent.touchEnd(0)
        expect(total(events, 'older')).toBe(45)
        expect(total(events, 'newer')).toBe(0)
        intent.touchStart(finger(100, 400))
        for (let y = 395; y >= 350; y -= 5) intent.touchMove(finger(100, y))
        expect(total(events, 'newer')).toBe(50)
    })
    test('a fling is a few large moves and the momentum after release adds nothing', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(100, 200))
        intent.touchMove(finger(102, 260))
        intent.touchMove(finger(103, 380))
        intent.touchEnd(0)
        const afterRelease = events.length
        intent.touchMove(finger(103, 500))
        expect(events.length).toBe(afterRelease)
        expect(total(events, 'older')).toBe(180)
    })
    test('a horizontal swipe is locked out for the whole sequence, even if it later turns vertical', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(300, 300))
        intent.touchMove(finger(250, 310))
        intent.touchMove(finger(250, 400))
        expect(events).toEqual([])
        intent.touchEnd(0)
        intent.touchStart(finger(300, 300))
        intent.touchMove(finger(300, 340))
        expect(events.length).toBe(1)
    })
    test('a second finger cancels the sequence, also after it lifts, until every finger is up', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(100, 300))
        intent.touchMove(finger(100, 320))
        expect(events.length).toBe(1)
        intent.touchMove(finger(100, 340, 2))
        intent.touchMove(finger(100, 380, 1))
        intent.touchEnd(1)
        intent.touchMove(finger(100, 420, 1))
        expect(events.length).toBe(1)
        intent.touchEnd(0)
        intent.touchStart(finger(100, 300))
        intent.touchMove(finger(100, 320))
        expect(events.length).toBe(2)
    })
    test('a pinch that starts with two fingers emits nothing', () => {
        const { intent, events } = harness()
        intent.touchStart(finger(100, 300, 2))
        intent.touchMove(finger(100, 360, 2))
        expect(events).toEqual([])
    })
    test('edge pulls: older at the oldest end and newer at the bottom emit nothing, the open direction does', () => {
        const { intent, events } = harness((direction) => direction === 'newer')
        intent.touchStart(finger(100, 300))
        intent.touchMove(finger(100, 340))
        expect(events).toEqual([])
        intent.touchMove(finger(100, 300))
        expect(events).toEqual([{ direction: 'newer', distance: 40, source: 'touch' }])
    })
    test('a drag that starts inside a descendant scroller able to move that way emits nothing', () => {
        const { intent, events } = harness()
        intent.touchStart({ x: 100, y: 300, fingers: 1, blocked: (direction) => direction === 'older' })
        intent.touchMove(finger(100, 340))
        expect(events).toEqual([])
        intent.touchMove(finger(100, 300))
        expect(events.map((event) => event.direction)).toEqual(['newer'])
    })
})

describe('T-A2 wheel, keys, scrollbar', () => {
    const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, shiftKey: false, pageHeight: 600 }
    test('wheel up is older and wheel down is newer', () => {
        const { intent, events } = harness()
        intent.wheel({ ...wheel, deltaY: -50 })
        intent.wheel({ ...wheel, deltaY: 30 })
        expect(events).toEqual([{ direction: 'older', distance: 50, source: 'wheel' }, { direction: 'newer', distance: 30, source: 'wheel' }])
    })
    test('line and page delta modes are normalised to pixels', () => {
        const { intent, events } = harness()
        intent.wheel({ ...wheel, deltaY: -3, deltaMode: 1 })
        intent.wheel({ ...wheel, deltaY: -1, deltaMode: 2 })
        expect(events.map((event) => event.distance)).toEqual([48, 600])
    })
    test('a shift or ctrl wheel and a mostly horizontal wheel are not transcript scrolling', () => {
        const { intent, events } = harness()
        intent.wheel({ ...wheel, deltaY: -50, shiftKey: true })
        intent.wheel({ ...wheel, deltaY: -50, ctrlKey: true })
        intent.wheel({ ...wheel, deltaX: 80, deltaY: -50 })
        intent.wheel({ ...wheel, deltaX: 50, deltaY: -50 })
        expect(events).toEqual([])
    })
    test('a wheel over an inner scroller that can still move that way is the scroller\'s', () => {
        const { intent, events } = harness()
        intent.wheel({ ...wheel, deltaY: -50, blocked: () => true })
        expect(events).toEqual([])
    })
    const key = { shiftKey: false, modified: false, editable: false, interactive: false, pageHeight: 600 }
    test('scroll keys map to directions', () => {
        const { intent, events } = harness()
        for (const name of ['PageUp', 'ArrowUp', 'Home']) intent.key({ ...key, key: name })
        for (const name of ['PageDown', 'ArrowDown', 'End', ' ']) intent.key({ ...key, key: name })
        intent.key({ ...key, key: ' ', shiftKey: true })
        expect(events.map((event) => event.direction)).toEqual(['older', 'older', 'older', 'newer', 'newer', 'newer', 'newer', 'older'])
        expect(events.every((event) => event.source === 'key')).toBe(true)
    })
    test('text fields, modified keys, selection extension and Space on a control are not scrolling', () => {
        const { intent, events } = harness()
        intent.key({ ...key, key: 'ArrowUp', editable: true })
        intent.key({ ...key, key: 'PageDown', modified: true })
        intent.key({ ...key, key: 'ArrowDown', shiftKey: true })
        intent.key({ ...key, key: ' ', interactive: true })
        intent.key({ ...key, key: 'a' })
        expect(events).toEqual([])
    })
    test('a scrollbar drag follows the thumb: down is newer, up is older, and it stops on release', () => {
        const { intent, events } = harness()
        intent.scrollbarStart(100)
        intent.scrollbarMove(130)
        intent.scrollbarMove(110)
        intent.scrollbarEnd()
        intent.scrollbarMove(300)
        expect(events).toEqual([{ direction: 'newer', distance: 30, source: 'scrollbar' }, { direction: 'older', distance: 20, source: 'scrollbar' }])
    })
    test('unsubscribing stops delivery', () => {
        const intent = createReaderIntent({ canMove: () => true })
        const seen: ReaderIntentEvent[] = []
        const stop = intent.subscribe((event) => seen.push(event))
        intent.wheel({ ...wheel, deltaY: -10 })
        stop()
        intent.wheel({ ...wheel, deltaY: -10 })
        expect(seen.length).toBe(1)
    })
})

describe('canHostMove', () => {
    test('older needs room above and newer needs room below', () => {
        const top = { scrollHeight: 500, clientHeight: 100, scrollTop: 0 }
        const middle = { scrollHeight: 500, clientHeight: 100, scrollTop: 200 }
        const bottom = { scrollHeight: 500, clientHeight: 100, scrollTop: 400 }
        expect([canHostMove(top, 'older'), canHostMove(top, 'newer')]).toEqual([false, true])
        expect([canHostMove(middle, 'older'), canHostMove(middle, 'newer')]).toEqual([true, true])
        expect([canHostMove(bottom, 'older'), canHostMove(bottom, 'newer')]).toEqual([true, false])
    })
})

function fakeHost(scrollTop: number, scrollHeight = 500) {
    const host = document.createElement('main')
    Object.defineProperty(host, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(host, 'clientHeight', { value: 100, configurable: true })
    Object.defineProperty(host, 'clientWidth', { value: 100, configurable: true })
    Object.defineProperty(host, 'scrollTop', { value: scrollTop, writable: true, configurable: true })
    document.body.appendChild(host)
    return host
}

function touchEvent(type: string, points: { x: number, y: number }[]): Event {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'touches', { value: points.map((point) => ({ clientX: point.x, clientY: point.y })) })
    return event
}

describe('bindReaderIntent wiring', () => {
    test('touch, wheel and keys on the host reach the reducer, and unbinding stops them', () => {
        const host = fakeHost(200)
        const { intent, events } = harness((direction) => canHostMove(host, direction))
        const unbind = bindReaderIntent(host, intent)
        host.dispatchEvent(touchEvent('touchstart', [{ x: 50, y: 100 }]))
        host.dispatchEvent(touchEvent('touchmove', [{ x: 50, y: 140 }]))
        host.dispatchEvent(touchEvent('touchend', []))
        host.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true }))
        host.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
        expect(events.map((event) => `${event.source}:${event.direction}`)).toEqual(['touch:older', 'wheel:newer', 'key:older'])
        unbind()
        host.dispatchEvent(new WheelEvent('wheel', { deltaY: 60, bubbles: true }))
        expect(events.length).toBe(3)
        host.remove()
    })
    test('a wheel over an inner scroller that can move that way is ignored, but not when it is at its end', () => {
        const host = fakeHost(200)
        const inner = document.createElement('div')
        inner.style.overflowY = 'auto'
        Object.defineProperty(inner, 'scrollHeight', { value: 400, configurable: true })
        Object.defineProperty(inner, 'clientHeight', { value: 100, configurable: true })
        Object.defineProperty(inner, 'scrollTop', { value: 150, writable: true, configurable: true })
        host.appendChild(inner)
        const { intent, events } = harness()
        bindReaderIntent(host, intent)
        inner.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
        expect(events).toEqual([])
        inner.scrollTop = 0
        inner.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true }))
        expect(events.length).toBe(1)
        host.remove()
    })
    test('keys typed in a text field are ignored', () => {
        const host = fakeHost(200)
        const field = document.createElement('textarea')
        host.appendChild(field)
        const { intent, events } = harness()
        bindReaderIntent(host, intent)
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
        expect(events).toEqual([])
        host.remove()
    })
    test('a mouse press on the scrollbar gutter starts a drag that the window moves and ends', () => {
        const host = fakeHost(200)
        const { intent, events } = harness()
        bindReaderIntent(host, intent)
        const press = new MouseEvent('pointerdown', { bubbles: true, clientY: 100, button: 0 })
        Object.defineProperty(press, 'pointerType', { value: 'mouse' })
        Object.defineProperty(press, 'offsetX', { value: 110 })
        host.dispatchEvent(press)
        window.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientY: 130 }), { pointerType: 'mouse' }))
        window.dispatchEvent(new MouseEvent('pointerup'))
        window.dispatchEvent(new MouseEvent('pointermove', { clientY: 200 }))
        expect(events).toEqual([{ direction: 'newer', distance: 30, source: 'scrollbar' }])
        host.remove()
    })
    test('a press inside the content or by touch is not a scrollbar drag', () => {
        const host = fakeHost(200)
        const { intent, events } = harness()
        bindReaderIntent(host, intent)
        const inside = new MouseEvent('pointerdown', { bubbles: true, clientY: 100, button: 0 })
        Object.defineProperty(inside, 'pointerType', { value: 'mouse' })
        Object.defineProperty(inside, 'offsetX', { value: 40 })
        host.dispatchEvent(inside)
        const byTouch = new MouseEvent('pointerdown', { bubbles: true, clientY: 100, button: 0 })
        Object.defineProperty(byTouch, 'pointerType', { value: 'touch' })
        Object.defineProperty(byTouch, 'offsetX', { value: 110 })
        host.dispatchEvent(byTouch)
        window.dispatchEvent(new MouseEvent('pointermove', { clientY: 160 }))
        expect(events).toEqual([])
        host.remove()
    })
})
