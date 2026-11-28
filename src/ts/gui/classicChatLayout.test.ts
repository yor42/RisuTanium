// @vitest-environment jsdom

/**
 * The classic chat sheet. jsdom has no layout, so the sheet is read through CSSOM and its selectors are matched
 * against built DOM; real sizes, stickiness and safe-area insets are device rows.
 *
 * Labels: G = guard of the rule text of a new module (it cannot run on the base, where the module is absent);
 * D = diagnostic of what jsdom keeps.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { touchInput } from './classicChatLayout'
import sheetText from './classicChatLayout.css?raw'

function styleRules(): CSSStyleRule[] {
    const style = document.head.querySelector('style[data-risu-sheet="classic-chat-layout"]') as HTMLStyleElement
    expect(style).not.toBeNull()
    return [...(style.sheet as CSSStyleSheet).cssRules].filter((r) => r.constructor.name === 'CSSStyleRule') as CSSStyleRule[]
}

function rulesMatching(el: Element): CSSStyleRule[] {
    return styleRules().filter((r) => el.matches(r.selectorText))
}

function declared(el: Element, property: string): string[] {
    return rulesMatching(el).map((r) => r.style.getPropertyValue(property)).filter((v) => v !== '')
}

function build(markers: Record<string, string>, tag = 'div'): HTMLElement {
    const el = document.createElement(tag)
    for (const [name, value] of Object.entries(markers)) {
        el.setAttribute(name, value)
    }
    document.body.append(el)
    return el
}

afterEach(() => {
    delete document.documentElement.dataset.input
    delete document.documentElement.dataset.layout
    document.body.replaceChildren()
})

describe('D what jsdom keeps', () => {
    test('D1 the raw text carries max() and env(); the CSSOM may drop them', () => {
        expect(sheetText).toContain('padding-bottom: max(.5rem, env(safe-area-inset-bottom))')
        expect(sheetText).toContain('bottom: calc(var(--classic-composer-h, 4rem) + env(safe-area-inset-bottom))')
    })
})

describe('G the composer rule', () => {
    test('G T2a it applies under touch input only and pins the composer above the bottom inset', () => {
        const composer = build({ 'data-classic-composer': '' })
        expect(rulesMatching(composer)).toHaveLength(0)
        document.documentElement.dataset.input = 'hover'
        expect(rulesMatching(composer)).toHaveLength(0)
        document.documentElement.dataset.input = 'touch'
        expect(declared(composer, 'position')).toEqual(['sticky'])
        expect(declared(composer, 'bottom')).toEqual(['0px'])
        expect(declared(composer, 'z-index')).toEqual(['29'])
        expect(sheetText).toMatch(/\[data-classic-composer\][^}]*padding-bottom: max\(\.5rem, env\(safe-area-inset-bottom\)\)/)
        expect(sheetText).toMatch(/\[data-classic-composer\][^}]*background-color: var\(--color-bgcolor\)/)
    })

    test('G T2a the menu is fixed above the composer, over its z-index, and scrolls', () => {
        const menu = build({ 'data-classic-menu': '' })
        expect(rulesMatching(menu)).toHaveLength(0)
        document.documentElement.dataset.input = 'touch'
        expect(declared(menu, 'position')).toEqual(['fixed'])
        expect(Number(declared(menu, 'z-index')[0])).toBeGreaterThan(29)
        expect(declared(menu, 'max-height')).toEqual(['70vh'])
        expect(declared(menu, 'overflow-y')).toEqual(['auto'])
        expect(sheetText).toMatch(/\[data-classic-menu\][^}]*bottom: calc\(var\(--classic-composer-h, 4rem\) \+ env\(safe-area-inset-bottom\)\)/)
    })
})

describe('G the tap rules', () => {
    function targets(): HTMLElement[] {
        const actions = build({ 'data-classic-actions': '' })
        const actionButton = document.createElement('button')
        actions.append(actionButton)
        const tap = build({ 'data-classic-tap': '' }, 'button')
        const menu = build({ 'data-classic-menu': '' })
        const row = document.createElement('div')
        menu.append(row)
        return [actionButton, tap, row]
    }

    test('G T6a touch reaches 44px and hover 40px on every marked control', () => {
        const list = targets()
        document.documentElement.dataset.input = 'touch'
        for (const el of list) {
            expect(declared(el, 'min-width')).toEqual(['44px'])
            expect(declared(el, 'min-height')).toEqual(['44px'])
        }
        document.documentElement.dataset.input = 'hover'
        for (const el of list) {
            expect(declared(el, 'min-width')).toEqual(['40px'])
            expect(declared(el, 'min-height')).toEqual(['40px'])
        }
    })

    test('G T6a an unmarked button gets no size rule', () => {
        const plain = build({}, 'button')
        document.documentElement.dataset.input = 'touch'
        expect(declared(plain, 'min-width')).toEqual([])
    })

    test('G T6a the action buttons centre their icon', () => {
        const actions = build({ 'data-classic-actions': '' })
        const button = document.createElement('button')
        actions.append(button)
        expect(declared(button, 'display')).toEqual(['flex'])
        expect(declared(button, 'justify-content')).toEqual(['center'])
    })
})

describe('G the phone header', () => {
    test('G T1b the header is hidden except under the phone layout, where the floating arrow steps aside', () => {
        const header = build({ 'data-classic-header': '' }, 'header')
        const arrow = build({ 'data-classic-arrow-yield': '' }, 'button')
        expect(declared(header, 'display')).toEqual(['none'])
        expect(declared(arrow, 'display')).toEqual([])
        document.documentElement.dataset.layout = 'wide'
        expect(declared(header, 'display')).toEqual(['none'])
        expect(declared(arrow, 'display')).toEqual([])
        document.documentElement.dataset.layout = 'phone'
        expect(declared(header, 'display')).toEqual(['none', 'flex'])
        expect(declared(arrow, 'display')).toEqual(['none'])
    })

    test('G T1b the top-bar pill drops below the header on the phone layout only', () => {
        const pill = build({ 'data-classic-pill': 'top' }, 'button')
        expect(declared(pill, 'top')).toEqual([])
        document.documentElement.dataset.layout = 'phone'
        expect(declared(pill, 'top')).toEqual(['3.5rem'])
    })
})

describe('G touchInput', () => {
    test('G it reads the root input attribute', () => {
        expect(touchInput()).toBe(false)
        document.documentElement.dataset.input = 'hover'
        expect(touchInput()).toBe(false)
        document.documentElement.dataset.input = 'touch'
        expect(touchInput()).toBe(true)
    })
})
