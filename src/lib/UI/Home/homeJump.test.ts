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
