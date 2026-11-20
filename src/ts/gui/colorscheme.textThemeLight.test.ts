/**
 * The text theme's accent font colours (italic, bold, quotes) must stay readable on the light
 * scheme surfaces. The real `updateColorScheme` and `updateTextThemeAndCSS` run over the real
 * preset table; only storage and UI side effects are mocked.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
}))

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => h.db),
    setDatabase: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: h.db },
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import { colorSchemeList, colorSchemePresets, updateColorScheme, updateTextThemeAndCSS } from './colorscheme'
import { isLite } from '../lite'

type FontKey = 'Standard' | 'Italic' | 'Bold' | 'ItalicBold' | 'Quote1' | 'Quote2'
const FONT_KEYS: FontKey[] = ['Standard', 'Italic', 'Bold', 'ItalicBold', 'Quote1', 'Quote2']

const lightPresets = colorSchemeList.filter((name) => colorSchemePresets[name].type === 'light')
const darkPresets = colorSchemeList.filter((name) => colorSchemePresets[name].type === 'dark')

function channel(v: number): number {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(hex: string): number {
    const n = parseInt(hex.slice(1), 16)
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

function cr(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
}

function font(key: FontKey): string {
    return document.documentElement.style.getPropertyValue(`--FontColor${key}`).toLowerCase()
}

function fonts(): Record<FontKey, string> {
    return Object.fromEntries(FONT_KEYS.map((key) => [key, font(key)])) as Record<FontKey, string>
}

function paint(scheme: string, textTheme: string) {
    h.db.colorSchemeName = scheme
    h.db.textTheme = textTheme
    updateColorScheme()
    updateTextThemeAndCSS()
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.font = 'default'
    h.db.customTextTheme = {
        FontColorStandard: '#111111',
        FontColorItalic: '#222222',
        FontColorBold: '#333333',
        FontColorItalicBold: '#444444',
    }
    isLite.set(false)
    document.documentElement.removeAttribute('style')
})

describe('light scheme text theme', () => {
    test('the light preset list is not empty', () => {
        expect(lightPresets.length).toBeGreaterThan(0)
        expect(darkPresets.length).toBeGreaterThan(0)
    })

    describe.each(lightPresets)('T6 RR: high contrast on %s', (name) => {
        test('paints the retuned accent colours', () => {
            paint(name, 'highcontrast')
            expect(fonts()).toEqual({
                Standard: '#0f172a',
                Italic: '#5c4a00',
                Bold: '#0b5f7a',
                ItalicBold: '#8a4200',
                Quote1: '#0b5f7a',
                Quote2: '#8a4200',
            })
        })

        test('every font colour reads at 4.5:1 on bgcolor and darkbg', () => {
            paint(name, 'highcontrast')
            const scheme = colorSchemePresets[name]
            for (const key of FONT_KEYS) {
                expect(cr(font(key), scheme.bgcolor), `${key} on bgcolor`).toBeGreaterThanOrEqual(4.5)
                expect(cr(font(key), scheme.darkbg), `${key} on darkbg`).toBeGreaterThanOrEqual(4.5)
            }
        })
    })

    describe.each(lightPresets)('T7 RR: standard on %s', (name) => {
        test('paints retuned quotes and keeps the other four values', () => {
            paint(name, 'standard')
            expect(fonts()).toEqual({
                Standard: '#0f172a',
                Italic: '#5f6066',
                Bold: '#0f172a',
                ItalicBold: '#5f6066',
                Quote1: '#0b5f7a',
                Quote2: '#8a4200',
            })
        })

        test('quotes read at 4.5:1 on bgcolor and darkbg', () => {
            paint(name, 'standard')
            const scheme = colorSchemePresets[name]
            for (const key of ['Quote1', 'Quote2'] as FontKey[]) {
                expect(cr(font(key), scheme.bgcolor), `${key} on bgcolor`).toBeGreaterThanOrEqual(4.5)
                expect(cr(font(key), scheme.darkbg), `${key} on darkbg`).toBeGreaterThanOrEqual(4.5)
            }
        })
    })
})

describe('dark, custom and lite text themes are unchanged', () => {
    test.each(darkPresets)('T8 CG (passes before and after): high contrast on dark %s', (name) => {
        paint(name, 'highcontrast')
        expect(fonts()).toEqual({
            Standard: '#f8f8f2',
            Italic: '#f1fa8c',
            Bold: '#8be9fd',
            ItalicBold: '#ffb86c',
            Quote1: '#8be9fd',
            Quote2: '#ffb86c',
        })
    })

    test.each(darkPresets)('T8 CG (passes before and after): standard on dark %s', (name) => {
        paint(name, 'standard')
        expect(fonts()).toEqual({
            Standard: '#fafafa',
            Italic: '#9a9ba1',
            Bold: '#fafafa',
            ItalicBold: '#9a9ba1',
            Quote1: '#8be9fd',
            Quote2: '#ffb86c',
        })
    })

    test.each(lightPresets)('T9 pin: custom theme on light %s keeps its colours and follows the scheme for absent quotes', (name) => {
        paint(name, 'custom')
        expect(fonts()).toEqual({
            Standard: '#111111',
            Italic: '#222222',
            Bold: '#333333',
            ItalicBold: '#444444',
            Quote1: '#0b5f7a',
            Quote2: '#8a4200',
        })
    })

    test.each(lightPresets)('T9 CG (passes before and after): lite on light %s paints the dark standard values', (name) => {
        isLite.set(true)
        paint(name, 'highcontrast')
        expect(fonts()).toEqual({
            Standard: '#fafafa',
            Italic: '#9a9ba1',
            Bold: '#fafafa',
            ItalicBold: '#9a9ba1',
            Quote1: '#8be9fd',
            Quote2: '#ffb86c',
        })
    })
})
