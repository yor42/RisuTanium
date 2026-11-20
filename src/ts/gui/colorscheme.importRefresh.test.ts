/**
 * Importing a custom colour scheme repaints the text theme at once: the standard text theme's font
 * colours depend on the scheme type, so `importColorScheme` must refresh them together with the
 * scheme variables.
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    db: {} as Record<string, unknown>,
    picked: null as { data: Uint8Array } | null,
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
    selectSingleFile: vi.fn(async () => h.picked),
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

import { importColorScheme, updateColorScheme, updateTextThemeAndCSS } from './colorscheme'

const LIGHT_CUSTOM = {
    bgcolor: '#ffffff', darkbg: '#f1f5f9', borderc: '#cbd5e1', selected: '#e2e8f0', draculared: '#dc2626',
    textcolor: '#0f172a', textcolor2: '#475569', darkBorderc: '#94a3b8', darkbutton: '#e2e8f0', type: 'light',
}

function fontColorStandard(): string {
    return document.documentElement.style.getPropertyValue('--FontColorStandard')
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorSchemeName = 'default'
    h.db.textTheme = 'standard'
    h.db.font = 'default'
    h.picked = { data: new TextEncoder().encode(JSON.stringify(LIGHT_CUSTOM)) }
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    updateTextThemeAndCSS()
})

describe('importColorScheme refreshes the text theme', () => {
    test('RR: importing a light scheme over a dark one paints the light standard font colour', async () => {
        expect(fontColorStandard()).toBe('#fafafa')

        await importColorScheme()

        expect(h.db.colorSchemeName).toBe('custom')
        expect(fontColorStandard()).toBe('#0f172a')
    })

    test('CG (passes before and after): importing a dark scheme keeps the dark standard font colour', async () => {
        h.picked = { data: new TextEncoder().encode(JSON.stringify({ ...LIGHT_CUSTOM, type: 'dark' })) }

        await importColorScheme()

        expect(fontColorStandard()).toBe('#fafafa')
    })
})
