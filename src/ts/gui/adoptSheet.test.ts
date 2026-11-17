// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { adoptSheet } from './adoptSheet'

function sheets(name: string): Element[] {
    return [...document.head.querySelectorAll('style[data-risu-sheet]')].filter((style) => style.getAttribute('data-risu-sheet') === name)
}

afterEach(() => {
    document.head.replaceChildren()
    vi.unstubAllGlobals()
})

describe('adoptSheet', () => {
    test('installs one style element named for the sheet, with the css text', () => {
        adoptSheet('one', '.a { color: red }')
        const adopted = sheets('one')
        expect(adopted).toHaveLength(1)
        expect(adopted[0].tagName).toBe('STYLE')
        expect(adopted[0].parentElement).toBe(document.head)
        expect(adopted[0].textContent).toBe('.a { color: red }')
    })

    test('adopting a name again keeps the first element and its text', () => {
        adoptSheet('one', '.a { color: red }')
        adoptSheet('one', '.b { color: blue }')
        const adopted = sheets('one')
        expect(adopted).toHaveLength(1)
        expect(adopted[0].textContent).toBe('.a { color: red }')
    })

    test('different names get their own elements', () => {
        adoptSheet('one', '.a {}')
        adoptSheet('two', '.b {}')
        expect(sheets('one')).toHaveLength(1)
        expect(sheets('two')).toHaveLength(1)
    })

    test('without a document it does nothing and does not throw', () => {
        vi.stubGlobal('document', undefined)
        expect(() => adoptSheet('one', '.a {}')).not.toThrow()
        vi.unstubAllGlobals()
        expect(sheets('one')).toHaveLength(0)
    })
})
