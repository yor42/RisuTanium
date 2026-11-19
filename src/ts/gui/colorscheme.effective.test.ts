/**
 * Built-in colour schemes apply live: when `colorSchemeName` names a built-in preset the painted
 * colours come from the current preset table, not from the copy saved with the database. The saved
 * copy is never rewritten passively, so saves and `.bin` backups keep what the user stored. Custom
 * schemes, unknown names and prototype keys paint the saved copy.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

import { get } from 'svelte/store'
import {
    ColorSchemeTypeStore,
    changeColorScheme,
    colorSchemePresets,
    defaultColorScheme,
    effectiveColorScheme,
    updateColorScheme,
    updateTextThemeAndCSS,
} from './colorscheme'
import { isLite } from '../lite'

const OLD_COPY = {
    bgcolor: '#282a36', darkbg: '#21222c', borderc: '#6272a4', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151', type: 'dark',
} as const

const CUSTOM = {
    bgcolor: '#101010', darkbg: '#202020', borderc: '#303030', selected: '#404040', draculared: '#505050',
    textcolor: '#606060', textcolor2: '#123456', darkBorderc: '#707070', darkbutton: '#808080', type: 'dark',
} as const

function textcolor2(): string {
    return document.documentElement.style.getPropertyValue('--risu-theme-textcolor2')
}

function italics(): { italic: string, italicBold: string } {
    return {
        italic: document.documentElement.style.getPropertyValue('--FontColorItalic'),
        italicBold: document.documentElement.style.getPropertyValue('--FontColorItalicBold'),
    }
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorScheme = structuredClone(OLD_COPY)
    h.db.colorSchemeName = 'default'
    h.db.textTheme = 'standard'
    h.db.font = 'default'
    isLite.set(false)
    document.documentElement.removeAttribute('style')
})

afterEach(() => {
    isLite.set(false)
})

describe('built-in schemes apply live', () => {
    test('T4-1 RR: default paints the current table and leaves the saved copy untouched', () => {
        const before = structuredClone(h.db.colorScheme)

        updateColorScheme()

        expect(textcolor2()).toBe('#94a3b8')
        expect(h.db.colorScheme).toEqual(before)
    })

    test.each([
        ['light', '#525f73'],
        ['realblack', '#94a3b8'],
    ])('T4-2 RR: %s paints its current table value', (name, expected) => {
        h.db.colorSchemeName = name

        updateColorScheme()

        expect(textcolor2()).toBe(expected)
    })

    test('T4-3 RR: lite mode paints the lite table even for a custom name', () => {
        h.db.colorSchemeName = 'custom'
        h.db.colorScheme = structuredClone(CUSTOM)
        isLite.set(true)

        updateColorScheme()

        expect(textcolor2()).toBe('#94a3b8')
    })

    test('T4-4 CG (passes before and after): custom paints the saved copy', () => {
        h.db.colorSchemeName = 'custom'
        h.db.colorScheme = structuredClone(CUSTOM)

        updateColorScheme()

        expect(textcolor2()).toBe('#123456')
    })

    test.each(['retired-x', 'toString', '__proto__', 'constructor'])('T4-5 CG (passes before and after): unknown or prototype name %s paints the saved copy', (name) => {
        h.db.colorSchemeName = name
        h.db.colorScheme = structuredClone(CUSTOM)

        updateColorScheme()

        expect(document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')).toBe('#101010')
        expect(textcolor2()).toBe('#123456')
    })

    test('T4-5b CG: a missing saved copy with a non-built-in name paints the default', () => {
        h.db.colorSchemeName = 'retired-x'
        delete h.db.colorScheme

        updateColorScheme()

        expect(textcolor2()).toBe(defaultColorScheme.textcolor2)
    })
})

describe('standard text theme italics follow the effective scheme', () => {
    test('T4-6 RR: a dark built-in gets the dark italic colour', () => {
        updateColorScheme()
        updateTextThemeAndCSS()

        expect(italics()).toEqual({ italic: '#9a9ba1', italicBold: '#9a9ba1' })
    })

    test('T4-6 RR: a light built-in with a stale dark copy gets the light italic colour and type', () => {
        h.db.colorSchemeName = 'light'
        h.db.colorScheme = structuredClone(OLD_COPY)

        updateColorScheme()
        updateTextThemeAndCSS()

        expect(get(ColorSchemeTypeStore)).toBe('light')
        expect(italics()).toEqual({ italic: '#6b6c72', italicBold: '#6b6c72' })
    })

    test('T4-6 CG: lite mode keeps the dark italic colour', () => {
        h.db.colorSchemeName = 'light'
        isLite.set(true)

        updateTextThemeAndCSS()

        expect(italics()).toEqual({ italic: '#9a9ba1', italicBold: '#9a9ba1' })
    })
})

describe('effectiveColorScheme', () => {
    test('returns the built-in table entry for a built-in name', () => {
        expect(effectiveColorScheme({ colorSchemeName: 'light', colorScheme: structuredClone(OLD_COPY) })).toEqual(colorSchemePresets.light)
    })

    test('never writes the saved copy back', () => {
        const db = { colorSchemeName: 'default', colorScheme: structuredClone(OLD_COPY) }

        effectiveColorScheme(db)

        expect(db.colorScheme).toEqual(OLD_COPY)
    })
})

describe('explicit choice', () => {
    test('T4-8 CG: changeColorScheme stores a copy of the current table', () => {
        changeColorScheme('light')

        expect(h.db.colorScheme).toEqual(colorSchemePresets.light)
        expect(h.db.colorScheme).not.toBe(colorSchemePresets.light)
        expect(h.db.colorSchemeName).toBe('light')
    })
})
