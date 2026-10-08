// @vitest-environment jsdom

/**
 * The page side of the Android system-bar colour bridge: reducing any CSS colour to opaque
 * RGB with the browser's own parser, and calling the host once per colour scheme change.
 *
 * jsdom reduces hex (with alpha), `rgb()`, `hsl()` and named colours to `rgb()`/`rgba()`, drops
 * an invalid colour on assignment and passes `oklch()` and `color-mix()` through unchanged, so
 * those cases are checked here. A real WebView's serialisation, and the native bars, are
 * checked on a device; nothing here proves them. happy-dom converts nothing and would not
 * exercise the parser.
 *
 * Test labels: `(R)` tests cannot run on the base (the module they import does not exist),
 * so their red-before-green evidence is the mutant that removes the `syncSystemBars` call from
 * `updateColorScheme`, which fails them; `(G)` is a compatibility guard.
 */
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDb: unknown }).__testDb),
    setDatabase: vi.fn(),
}) as unknown as typeof import('../storage/database.svelte'))

vi.mock(import('../globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('../globalApi.svelte'))

vi.mock(import('../util'), () => ({
    BufferToText: vi.fn(),
    selectSingleFile: vi.fn(),
}) as unknown as typeof import('../util'))

vi.mock(import('../alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('../alert'))

vi.mock(import('../../lang'), () => ({
    language: { errors: {} },
}) as unknown as typeof import('../../lang'))

vi.mock(import('../stores.svelte'), () => ({
    CustomCSSStore: writable(''),
    DBState: {
        get db() { return (globalThis as unknown as { __testDb: unknown }).__testDb },
        set db(value: unknown) { (globalThis as unknown as { __testDb: unknown }).__testDb = value },
    },
    SafeModeStore: writable(false),
}) as unknown as typeof import('../stores.svelte'))

import { cssColorToRgb, FALLBACK_BAR_COLOR, syncSystemBars } from './systemBars'
import { changeColorScheme, colorSchemePresets, defaultColorScheme, updateColorScheme } from './colorscheme'
import { isLite } from '../lite'

const FALLBACK = { red: 0x28, green: 0x2a, blue: 0x36 }

describe('cssColorToRgb', () => {
    test.each([
        ['#282a36', { red: 40, green: 42, blue: 54 }],
        ['#abc', { red: 170, green: 187, blue: 204 }],
        ['#ffffff80', { red: 255, green: 255, blue: 255 }],
        ['rgb(10, 20, 30)', { red: 10, green: 20, blue: 30 }],
        ['rgba(10, 20, 30, 0.2)', { red: 10, green: 20, blue: 30 }],
        ['hsl(120, 50%, 50%)', { red: 64, green: 191, blue: 64 }],
        ['red', { red: 255, green: 0, blue: 0 }],
    ])('(G) %s is reduced to opaque RGB by the browser parser', (value, expected) => {
        expect(cssColorToRgb(value)).toEqual(expected)
    })

    test.each(['', 'not a colour', '#12', 'rgb(1, 2)'])('(G) the invalid colour %j falls back to the default dark background', (value) => {
        expect(cssColorToRgb(value)).toEqual(FALLBACK)
    })

    test.each(['oklch(0.5 0.2 30)', 'color-mix(in srgb, red 50%, blue)'])('(G) %s, which is not computed to rgb(), falls back too', (value) => {
        expect(cssColorToRgb(value)).toEqual(FALLBACK)
    })

    test('(G) the fallback is the default dark scheme\'s background', () => {
        expect(FALLBACK_BAR_COLOR).toBe(defaultColorScheme.bgcolor)
        expect(cssColorToRgb(defaultColorScheme.bgcolor)).toEqual(FALLBACK)
    })

    test('(G) the probe is attached while it is read and gone afterwards', () => {
        const before = document.body.children.length
        let attachedWhileRead = false
        const original = window.getComputedStyle
        const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
            attachedWhileRead = el.isConnected
            return original.call(window, el, pseudo)
        })
        try {
            cssColorToRgb('#123456')
        } finally {
            spy.mockRestore()
        }
        expect(attachedWhileRead).toBe(true)
        expect(document.body.children.length).toBe(before)
    })
})

describe('syncSystemBars', () => {
    afterEach(() => {
        delete window.__risuTaniumSystemBars
    })

    test('(G) the host is called as a method with integer channels', () => {
        const calls: Array<{ self: unknown; args: unknown[] }> = []
        const bridge = {
            setBackground(this: unknown, ...args: number[]) {
                calls.push({ self: this, args })
            },
        }
        window.__risuTaniumSystemBars = bridge
        syncSystemBars('#112233')

        expect(calls).toEqual([{ self: bridge, args: [17, 34, 51] }])
    })

    test('(G) without a host bridge nothing is parsed or called', () => {
        const create = vi.spyOn(document, 'createElement')
        try {
            expect(() => syncSystemBars('#112233')).not.toThrow()
            expect(create).not.toHaveBeenCalled()
        } finally {
            create.mockRestore()
        }
    })

    test('(G) a bridge without the method, or one that throws, changes nothing and throws nothing', () => {
        window.__risuTaniumSystemBars = {}
        expect(() => syncSystemBars('#112233')).not.toThrow()
        window.__risuTaniumSystemBars = { setBackground: 5 as unknown as () => unknown }
        expect(() => syncSystemBars('#112233')).not.toThrow()
        window.__risuTaniumSystemBars = { setBackground: () => { throw new Error('host failed') } }
        expect(() => syncSystemBars('#112233')).not.toThrow()
    })
})

describe('updateColorScheme tells the host', () => {
    let setBackground: Mock<(red: number, green: number, blue: number) => unknown>

    beforeEach(() => {
        setBackground = vi.fn<(red: number, green: number, blue: number) => unknown>()
        vi.stubGlobal('safeStructuredClone', structuredClone)
        isLite.set(false)
        ;(globalThis as unknown as { __testDb: unknown }).__testDb = {
            colorScheme: { ...colorSchemePresets.dark, bgcolor: '#112233' },
        }
    })

    afterEach(() => {
        delete window.__risuTaniumSystemBars
        isLite.set(false)
        vi.unstubAllGlobals()
    })

    test('(R) with the host present, the applied background goes to it', () => {
        window.__risuTaniumSystemBars = { setBackground }
        updateColorScheme()

        expect(setBackground).toHaveBeenCalledTimes(1)
        expect(setBackground).toHaveBeenCalledWith(17, 34, 51)
        expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#112233')
    })

    test('(R) a custom colour in any CSS form reaches the host as integers', () => {
        window.__risuTaniumSystemBars = { setBackground }
        ;(globalThis as unknown as { __testDb: { colorScheme: { bgcolor: string } } }).__testDb.colorScheme.bgcolor = 'hsl(120, 50%, 50%)'
        updateColorScheme()

        expect(setBackground).toHaveBeenCalledWith(64, 191, 64)
    })

    test('(R) the lite override is what the host is told, as it is what the page applies', () => {
        window.__risuTaniumSystemBars = { setBackground }
        isLite.set(true)
        updateColorScheme()

        const lite = colorSchemePresets.lite.bgcolor
        expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')).toBe(lite)
        const { red, green, blue } = cssColorToRgb(lite)
        expect(setBackground).toHaveBeenCalledWith(red, green, blue)
    })

    test('(R) changing the scheme tells the host again', () => {
        window.__risuTaniumSystemBars = { setBackground }
        updateColorScheme()
        changeColorScheme('light')

        expect(setBackground).toHaveBeenCalledTimes(2)
        expect(setBackground).toHaveBeenLastCalledWith(255, 255, 255)
    })

    test('(G) without the host nothing is called and the scheme is still applied', () => {
        updateColorScheme()

        expect(setBackground).not.toHaveBeenCalled()
        expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#112233')
    })
})
