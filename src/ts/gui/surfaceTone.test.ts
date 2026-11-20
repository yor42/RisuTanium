// @vitest-environment node

/**
 * The tone of the surface a pattern component sits on: the pack base wins when it is set, the
 * scheme type otherwise. The scheme type store is the one `updateColorScheme` writes.
 */
import { get } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import { updateColorScheme } from './colorscheme'
import { ColorSchemeTypeStore, packBaseTone, patternSurfaceTone, surfaceToneFor } from './surfaceTone'

// The root style write needs a document; a minimal one keeps this file in the node environment.
vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() } } })

afterEach(() => {
    packBaseTone.set(null)
    ColorSchemeTypeStore.set('dark')
})

describe('surfaceToneFor', () => {
    test.each([
        ['dark', null, 'dark'],
        ['light', null, 'light'],
        ['light', 'dark', 'dark'],
        ['dark', 'light', 'light'],
        ['dark', 'dark', 'dark'],
    ] as const)('scheme %s with pack base %s is %s', (scheme, base, expected) => {
        expect(surfaceToneFor(scheme, base)).toBe(expected)
    })
})

describe('patternSurfaceTone', () => {
    test('follows the scheme type that updateColorScheme writes', () => {
        h.db.colorSchemeName = 'light'
        updateColorScheme()
        expect(get(patternSurfaceTone)).toBe('light')
        h.db.colorSchemeName = 'default'
        updateColorScheme()
        expect(get(patternSurfaceTone)).toBe('dark')
    })

    test('the pack base wins while it is set and releases when it is cleared', () => {
        ColorSchemeTypeStore.set('light')
        packBaseTone.set('dark')
        expect(get(patternSurfaceTone)).toBe('dark')
        packBaseTone.set(null)
        expect(get(patternSurfaceTone)).toBe('light')
    })
})
