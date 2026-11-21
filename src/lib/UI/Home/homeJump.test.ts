// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { jumpToSection } from './homeJump'

const spied: Array<{ mockRestore: () => void }> = []
const scrollIntoViewSpy = vi.fn()

beforeEach(() => {
    scrollIntoViewSpy.mockReset()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scrollIntoViewSpy })
})

afterEach(() => {
    spied.splice(0).forEach((spy) => spy.mockRestore())
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    document.body.replaceChildren()
})

/** An element whose `focus` is a spy appending to one shared call log, with a fixed top edge. */
function element(log: string[], top = 0, tag = 'div'): HTMLElement {
    const node = document.createElement(tag)
    node.tabIndex = -1
    document.body.appendChild(node)
    const focus = vi.spyOn(node, 'focus').mockImplementation(() => {
        log.push(`focus:${node.id}`)
    })
    spied.push(focus)
    node.getBoundingClientRect = () => ({ top } as DOMRect)
    return node
}

/** A scroller whose `scrollTo` is a spy appending to the shared call log. */
function scrollerOf(log: string[], { top = 0, scrollTop = 0 } = {}): HTMLElement {
    const node = element(log, top)
    node.id = 'scroller'
    node.scrollTop = scrollTop
    node.scrollTo = vi.fn(() => {
        log.push('scroll')
    }) as unknown as typeof node.scrollTo
    return node
}

describe('jumpToSection', () => {
    test('S4b-U2 a null scroller or target returns false and does nothing', () => {
        const log: string[] = []
        const scroller = scrollerOf(log)
        const target = element(log)

        expect(jumpToSection({ scroller: null, target, reduced: false })).toBe(false)
        expect(jumpToSection({ scroller, target: null, reduced: true })).toBe(false)
        expect(jumpToSection({ scroller: null, target: null, focus: document.body, reduced: true })).toBe(false)

        expect(scroller.scrollTo).not.toHaveBeenCalled()
        expect(log).toEqual([])
    })

    test('S4b-U2 scrolls only the scroller to the target offset and never calls scrollIntoView', () => {
        const log: string[] = []
        const scroller = scrollerOf(log, { top: 40, scrollTop: 300 })
        const target = element(log, 90)

        expect(jumpToSection({ scroller, target, reduced: false })).toBe(true)

        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
        expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 350, behavior: 'smooth' })
        expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    test('S4b-U2 scrolls, then focuses the target without scrolling again, in that order', () => {
        const log: string[] = []
        const scroller = scrollerOf(log)
        const target = element(log)
        target.id = 'section'

        expect(jumpToSection({ scroller, target, reduced: false })).toBe(true)

        expect(log).toEqual(['scroll', 'focus:section'])
        expect(target.focus).toHaveBeenCalledWith({ preventScroll: true })
    })

    test('S4b-U2 a separate focus element takes the focus, and the target does not', () => {
        const log: string[] = []
        const scroller = scrollerOf(log)
        const target = element(log)
        target.id = 'section'
        const heading = element(log, 0, 'h2')
        heading.id = 'heading'

        expect(jumpToSection({ scroller, target, focus: heading, reduced: false })).toBe(true)

        expect(log).toEqual(['scroll', 'focus:heading'])
        expect(target.focus).not.toHaveBeenCalled()
    })

    test('S4b-U2 reduced motion scrolls instantly', () => {
        const log: string[] = []
        const scroller = scrollerOf(log)
        const target = element(log)

        jumpToSection({ scroller, target, reduced: true })

        expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
    })

    test('S4b-U2 a null focus element falls back to the target', () => {
        const log: string[] = []
        const scroller = scrollerOf(log)
        const target = element(log)
        target.id = 'section'

        expect(jumpToSection({ scroller, target, focus: null, reduced: false })).toBe(true)

        expect(log).toEqual(['scroll', 'focus:section'])
    })
})

/** A `ResizeObserver` stand-in that records its targets and lets the test deliver a resize. */
class MockResizeObserver {
    static instances: MockResizeObserver[] = []
    observed: Element[] = []
    disconnect = vi.fn()
    constructor(private readonly callback: () => void) {
        MockResizeObserver.instances.push(this)
    }
    observe(node: Element): void {
        this.observed.push(node)
    }
    /** A disconnected observer delivers nothing, as a real one. */
    fire(): void {
        if (this.disconnect.mock.calls.length > 0) return
        this.callback()
    }
}

describe('jumpToSection re-aim', () => {
    let tops: { target: number }
    let log: string[]
    let scroller: HTMLElement
    let target: HTMLElement

    beforeEach(() => {
        vi.useFakeTimers()
        MockResizeObserver.instances = []
        vi.stubGlobal('ResizeObserver', MockResizeObserver)
        log = []
        tops = { target: 90 }
        scroller = scrollerOf(log, { top: 40, scrollTop: 300 })
        target = element(log, 90)
        target.getBoundingClientRect = () => ({ top: tops.target } as DOMRect)
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    test('S4b-F2 a resize after the jump re-issues the scroll with the target current offset, and never refocuses', () => {
        jumpToSection({ scroller, target, reduced: false })
        const observer = MockResizeObserver.instances[0]
        expect(observer.observed).toEqual([scroller, target])
        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)

        tops.target = 150
        observer.fire()

        expect(scroller.scrollTo).toHaveBeenCalledTimes(2)
        expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 410, behavior: 'smooth' })
        expect(target.focus).toHaveBeenCalledTimes(1)
    })

    test('S4b-F2 a resize that leaves the offset unchanged does not scroll again, and reduced motion stays instant', () => {
        jumpToSection({ scroller, target, reduced: true })
        const observer = MockResizeObserver.instances[0]

        observer.fire()
        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)

        tops.target = 20
        observer.fire()
        expect(scroller.scrollTo).toHaveBeenLastCalledWith({ top: 280, behavior: 'instant' })
    })

    test.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('S4b-F2 a %s on the document ends the re-aim', (type) => {
        jumpToSection({ scroller, target, reduced: false })
        const observer = MockResizeObserver.instances[0]

        document.dispatchEvent(new Event(type))
        expect(observer.disconnect).toHaveBeenCalled()

        tops.target = 150
        observer.fire()
        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
    })

    test('S4b-F2 an input on the scroller ends the re-aim', () => {
        jumpToSection({ scroller, target, reduced: false })
        const observer = MockResizeObserver.instances[0]

        scroller.dispatchEvent(new Event('wheel'))

        expect(observer.disconnect).toHaveBeenCalled()
    })

    test('S4b-F2 the window end disconnects the observer and ends the re-aim', () => {
        jumpToSection({ scroller, target, reduced: false })
        const observer = MockResizeObserver.instances[0]

        vi.advanceTimersByTime(999)
        expect(observer.disconnect).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(observer.disconnect).toHaveBeenCalledTimes(1)

        tops.target = 150
        observer.fire()
        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
    })

    test('S4b-F2 aborting the signal disconnects the observer and removes the input listeners', () => {
        const removed: string[] = []
        const controller = new AbortController()
        jumpToSection({ scroller, target, reduced: false, signal: controller.signal })
        const observer = MockResizeObserver.instances[0]
        const removeDocument = vi.spyOn(document, 'removeEventListener').mockImplementation((type) => { removed.push(`document:${type}`) })
        const removeScroller = vi.spyOn(scroller, 'removeEventListener').mockImplementation((type) => { removed.push(`scroller:${type}`) })
        spied.push(removeDocument, removeScroller)

        controller.abort()

        expect(observer.disconnect).toHaveBeenCalledTimes(1)
        for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
            expect(removed).toContain(`document:${type}`)
            expect(removed).toContain(`scroller:${type}`)
        }
        expect(vi.getTimerCount()).toBe(0)
    })

    test('S4b-F2 an already aborted signal never starts the re-aim, and the first scroll and focus still happen', () => {
        const controller = new AbortController()
        controller.abort()

        expect(jumpToSection({ scroller, target, reduced: false, signal: controller.signal })).toBe(true)

        expect(MockResizeObserver.instances).toHaveLength(0)
        expect(log).toEqual(['scroll', 'focus:'])
    })

    test('S4b-F2 compatibility guard: without ResizeObserver the jump scrolls once and sets no timer', () => {
        vi.unstubAllGlobals()
        vi.stubGlobal('ResizeObserver', undefined)

        expect(jumpToSection({ scroller, target, reduced: false })).toBe(true)

        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })
})