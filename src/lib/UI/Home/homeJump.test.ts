// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { jumpToSection, revealInScrollContainer } from './homeJump'

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

    test('S4b-F4 onLayout runs once right after the focus, before any resize', () => {
        const onLayout = vi.fn(() => { log.push('layout') })

        jumpToSection({ scroller, target, reduced: false, onLayout })

        expect(log).toEqual(['scroll', 'focus:', 'layout'])
        expect(onLayout).toHaveBeenCalledTimes(1)
    })

    test('S4b-F4 onLayout runs again on every resize callback, also when the landing offset is unchanged', () => {
        const onLayout = vi.fn()
        jumpToSection({ scroller, target, reduced: false, onLayout })
        const observer = MockResizeObserver.instances[0]

        observer.fire()
        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
        expect(onLayout).toHaveBeenCalledTimes(2)

        tops.target = 150
        observer.fire()
        expect(scroller.scrollTo).toHaveBeenCalledTimes(2)
        expect(onLayout).toHaveBeenCalledTimes(3)
    })

    test('S4b-F4 the observe elements are observed besides the scroller and the target', () => {
        const inner = element(log)

        jumpToSection({ scroller, target, reduced: false, observe: [inner] })

        expect(MockResizeObserver.instances[0].observed).toEqual([scroller, target, inner])
    })

    test.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])('S4b-F4 onLayout does not run after a %s', (type) => {
        const onLayout = vi.fn()
        jumpToSection({ scroller, target, reduced: false, onLayout })
        const observer = MockResizeObserver.instances[0]

        document.dispatchEvent(new Event(type))
        observer.fire()

        expect(onLayout).toHaveBeenCalledTimes(1)
    })

    test('S4b-F4 onLayout does not run after the window end', () => {
        const onLayout = vi.fn()
        jumpToSection({ scroller, target, reduced: false, onLayout })
        const observer = MockResizeObserver.instances[0]

        vi.advanceTimersByTime(1000)
        observer.fire()

        expect(onLayout).toHaveBeenCalledTimes(1)
    })

    test('S4b-F4 onLayout does not run after the signal aborts', () => {
        const onLayout = vi.fn()
        const controller = new AbortController()
        jumpToSection({ scroller, target, reduced: false, signal: controller.signal, onLayout })
        const observer = MockResizeObserver.instances[0]

        controller.abort()
        observer.fire()

        expect(onLayout).toHaveBeenCalledTimes(1)
    })

    test('S4b-F2 compatibility guard: without ResizeObserver the jump scrolls once and sets no timer', () => {
        vi.unstubAllGlobals()
        vi.stubGlobal('ResizeObserver', undefined)

        expect(jumpToSection({ scroller, target, reduced: false })).toBe(true)

        expect(scroller.scrollTo).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(0)
    })
})

describe('revealInScrollContainer', () => {
    /** A section holding a scrolling list holding a control; rects are fixed, the landing scroller is separate. */
    function listFixture({ listTop = 100, listHeight = 200, controlTop = 0, controlHeight = 24, scrollTop = 0 } = {}) {
        const landing = document.createElement('div')
        landing.scrollTop = 55
        const section = document.createElement('section')
        const list = document.createElement('div')
        list.style.overflowY = 'auto'
        const row = document.createElement('div')
        const control = document.createElement('button')
        row.appendChild(control)
        list.appendChild(row)
        section.appendChild(list)
        landing.appendChild(section)
        document.body.appendChild(landing)
        list.scrollTop = scrollTop
        Object.defineProperty(list, 'clientHeight', { configurable: true, value: listHeight })
        list.getBoundingClientRect = () => ({ top: listTop, bottom: listTop + listHeight } as DOMRect)
        control.getBoundingClientRect = () => ({ top: listTop + controlTop, bottom: listTop + controlTop + controlHeight } as DOMRect)
        return { landing, section, list, control }
    }

    test('S4b-U7 a control below the list box raises the list scrollTop by the overflow, nothing else moves', () => {
        const { landing, section, list, control } = listFixture({ controlTop: 260, scrollTop: 10 })

        revealInScrollContainer(control, section)

        expect(list.scrollTop).toBe(10 + 284 - 200)
        expect(landing.scrollTop).toBe(55)
        expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    test('S4b-U7 a control above the list box lowers the list scrollTop to it', () => {
        const { landing, section, list, control } = listFixture({ controlTop: -30, scrollTop: 90 })

        revealInScrollContainer(control, section)

        expect(list.scrollTop).toBe(60)
        expect(landing.scrollTop).toBe(55)
        expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    test('S4b-U7 a control already inside the list box changes nothing', () => {
        const { landing, section, list, control } = listFixture({ controlTop: 50, scrollTop: 10 })

        revealInScrollContainer(control, section)

        expect(list.scrollTop).toBe(10)
        expect(landing.scrollTop).toBe(55)
        expect(scrollIntoViewSpy).not.toHaveBeenCalled()
    })

    test('S4b-U7 with no scrolling ancestor up to the section nothing is touched', () => {
        const { landing, section, list, control } = listFixture({ controlTop: 260 })
        list.style.overflowY = 'visible'
        landing.style.overflowY = 'auto'

        revealInScrollContainer(control, section)

        expect(list.scrollTop).toBe(0)
        expect(landing.scrollTop).toBe(55)
    })
})