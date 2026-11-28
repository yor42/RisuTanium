// @vitest-environment jsdom
/**
 * The root attribute that names the area of the element that is on with a base (`data-theme-pack-area`), driven through the
 * real gate with plain `style` probe elements. It is written and removed together with `data-theme-pack-base`.
 */
import { flushSync } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import {
    declareSurface,
    installThemePackGate,
    registerThemePackElement,
    registerThemePackOverlay,
    resetThemePackGateForTests,
    setThemePackElementBase,
    syncThemePackMedia,
} from './surfaceGate.svelte'

const BASE = 'data-theme-pack-base'
const AREA = 'data-theme-pack-area'
const root = (): HTMLElement => document.documentElement

function probe(area: string, base: 'dark' | 'light' | null): HTMLStyleElement {
    const element = document.createElement('style')
    element.setAttribute('data-theme-pack', area)
    element.setAttribute('media', 'not all')
    document.head.appendChild(element)
    registerThemePackElement(element, area, base)
    return element
}

afterEach(() => {
    resetThemePackGateForTests()
    document.head.innerHTML = ''
})

describe('data-theme-pack-area', () => {
    test('names the shown area while its element is on with a base, with the base attribute', () => {
        probe('home', 'dark')
        installThemePackGate(() => false)
        declareSurface('home')
        flushSync()
        expect(root().getAttribute(BASE)).toBe('')
        expect(root().getAttribute(AREA)).toBe('home')
    })

    test('follows the shown area when another area takes over, and leaves with the base attribute when it is hidden (kills M2 and M3)', () => {
        probe('home', 'dark')
        probe('chat', 'light')
        installThemePackGate(() => false)
        const releaseHome = declareSurface('home')
        flushSync()
        expect(root().getAttribute(AREA)).toBe('home')
        const releaseChat = declareSurface('chat')
        flushSync()
        expect(root().getAttribute(AREA)).toBe('chat')
        expect(root().getAttribute(BASE)).toBe('light')
        releaseChat()
        flushSync()
        expect(root().getAttribute(AREA)).toBe('home')
        releaseHome()
        flushSync()
        expect(root().hasAttribute(AREA)).toBe(false)
        expect(root().hasAttribute(BASE)).toBe(false)
    })

    test('is never written for an element registered with a null base, shape mode included (kills M1)', () => {
        const element = probe('chat', 'dark')
        installThemePackGate(() => false)
        declareSurface('chat')
        flushSync()
        expect(root().getAttribute(AREA)).toBe('chat')
        setThemePackElementBase(element, null)
        syncThemePackMedia()
        expect(root().hasAttribute(BASE)).toBe(false)
        expect(root().hasAttribute(AREA)).toBe(false)
    })

    test('is never written for a shown area that has no registered element, nor for an overlay', () => {
        probe('studio', null)
        const overlay = document.createElement('style')
        document.head.appendChild(overlay)
        registerThemePackOverlay(overlay, 'colour')
        installThemePackGate(() => false)
        declareSurface('home')
        flushSync()
        expect(root().hasAttribute(AREA)).toBe(false)
        declareSurface('studio')
        flushSync()
        expect(root().hasAttribute(AREA)).toBe(false)
    })

    test('the test reset removes it', () => {
        probe('chat', 'dark')
        installThemePackGate(() => false)
        declareSurface('chat')
        flushSync()
        expect(root().hasAttribute(AREA)).toBe(true)
        resetThemePackGateForTests()
        expect(root().hasAttribute(AREA)).toBe(false)
        expect(root().hasAttribute(BASE)).toBe(false)
    })
})
