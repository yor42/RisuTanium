/**
 * Picking a scheme repaints the text theme at once: the standard text theme's font colours depend
 * on the scheme type, so `changeColorScheme` must refresh them together with the scheme variables.
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

import { changeColorScheme, updateColorScheme, updateTextThemeAndCSS } from './colorscheme'

function fontColorStandard(): string {
    return document.documentElement.style.getPropertyValue('--FontColorStandard')
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorSchemeName = 'default'
    h.db.textTheme = 'standard'
    h.db.font = 'default'
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    updateTextThemeAndCSS()
})

describe('changeColorScheme refreshes the text theme', () => {
    test('RR: switching from a dark scheme to light paints the light standard font colour', () => {
        expect(fontColorStandard()).toBe('#fafafa')

        changeColorScheme('light')

        expect(fontColorStandard()).toBe('#0f172a')
    })

    test('CG (passes before and after): switching back from light to a dark scheme paints the dark standard font colour', () => {
        changeColorScheme('light')

        changeColorScheme('dark')

        expect(fontColorStandard()).toBe('#fafafa')
    })
})
