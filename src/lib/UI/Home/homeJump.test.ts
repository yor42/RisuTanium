// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { jumpToSection } from './homeJump'

const spied: Array<{ mockRestore: () => void }> = []

afterEach(() => {
    spied.splice(0).forEach((spy) => spy.mockRestore())
    document.body.replaceChildren()
})

/** An element with `scrollIntoView` and `focus` replaced by spies that append to one shared call log. */
function element(log: string[], tag = 'div'): HTMLElement {
    const node = document.createElement(tag)
    node.tabIndex = -1
    document.body.appendChild(node)
    node.scrollIntoView = vi.fn(() => {
        log.push(`scroll:${node.id}`)
    })
    const focus = vi.spyOn(node, 'focus').mockImplementation(() => {
        log.push(`focus:${node.id}`)
    })
    spied.push(focus)
    return node
}

describe('jumpToSection', () => {
    test('S4b-U2 a null scroll target returns false and does nothing', () => {
        expect(jumpToSection({ scroll: null, reduced: false })).toBe(false)
        expect(jumpToSection({ scroll: null, focus: document.body, reduced: true })).toBe(false)
    })

    test('S4b-U2 scrolls the section to the top, then focuses it without scrolling again, in that order', () => {
        const log: string[] = []
        const section = element(log)
        section.id = 'section'

        expect(jumpToSection({ scroll: section, reduced: false })).toBe(true)

        expect(log).toEqual(['scroll:section', 'focus:section'])
        expect(section.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
        expect(section.focus).toHaveBeenCalledWith({ preventScroll: true })
    })

    test('S4b-U2 a separate focus element takes the focus, and the scroll element does not', () => {
        const log: string[] = []
        const section = element(log)
        section.id = 'section'
        const heading = element(log, 'h2')
        heading.id = 'heading'

        expect(jumpToSection({ scroll: section, focus: heading, reduced: false })).toBe(true)

        expect(log).toEqual(['scroll:section', 'focus:heading'])
        expect(heading.scrollIntoView).not.toHaveBeenCalled()
        expect(section.focus).not.toHaveBeenCalled()
    })

    test('S4b-U2 reduced motion scrolls instantly', () => {
        const log: string[] = []
        const section = element(log)

        jumpToSection({ scroll: section, reduced: true })

        expect(section.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
    })

    test('S4b-U2 a null focus element falls back to the scroll element', () => {
        const log: string[] = []
        const section = element(log)
        section.id = 'section'

        expect(jumpToSection({ scroll: section, focus: null, reduced: false })).toBe(true)

        expect(log).toEqual(['scroll:section', 'focus:section'])
    })
})
