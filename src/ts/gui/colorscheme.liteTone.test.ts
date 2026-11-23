/**
 * Lite mode always reports the dark Lite table, so the scheme type store reads 'dark' under it even when the saved
 * scheme name is a light preset. The Home brand mark takes its tone from that store only.
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
import { ColorSchemeTypeStore, defaultColorScheme, updateColorScheme } from './colorscheme'
import { isLite } from '../lite'

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorScheme = structuredClone(defaultColorScheme)
    h.db.textTheme = 'standard'
    h.db.font = 'default'
    isLite.set(false)
    document.documentElement.removeAttribute('style')
})

afterEach(() => {
    isLite.set(false)
    ColorSchemeTypeStore.set('dark')
})

describe('the scheme type under Lite', () => {
    test('a light preset sets the light type, and Lite overrides it to dark', () => {
        h.db.colorSchemeName = 'light'
        updateColorScheme()
        expect(get(ColorSchemeTypeStore)).toBe('light')

        isLite.set(true)
        updateColorScheme()
        expect(get(ColorSchemeTypeStore)).toBe('dark')
    })
})
