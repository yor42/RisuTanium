/**
 * The theme-pack scheme in `colorscheme.ts` (T27, T27e and the unit rows behind T13/T18): the fork-only name, the live
 * lookup that only `theme-pack` consults, the snapshot reader, `schemeWithoutPack`, and the order in which
 * `enterPackScheme` writes. `DBState.db` is a plain object here, as in the neighbouring colour-scheme tests.
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

import {
    PACK_SCHEME_NAME,
    colorSchemePresets,
    defaultColorScheme,
    effectiveColorScheme,
    enterPackScheme,
    leavePackScheme,
    readSchemeSnapshot,
    schemeWithoutPack,
    setPackSchemeProvider,
    type ColorScheme,
} from './colorscheme'
import { isLite } from '../lite'

const PACK: ColorScheme = {
    bgcolor: '#21222c', darkbg: '#191a21', borderc: '#bd93f9', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#a0a4b8', darkBorderc: '#343746', darkbutton: '#282a36', type: 'dark',
}
const CUSTOM: ColorScheme = {
    bgcolor: '#101010', darkbg: '#202020', borderc: '#303030', selected: '#404040', draculared: '#505050',
    textcolor: '#606060', textcolor2: '#123456', darkBorderc: '#707070', darkbutton: '#808080', type: 'dark',
}
const OWN_COPY: ColorScheme = {
    bgcolor: '#111111', darkbg: '#222222', borderc: '#333333', selected: '#444444', draculared: '#555555',
    textcolor: '#666666', textcolor2: '#777777', darkBorderc: '#888888', darkbutton: '#999999', type: 'light',
}

function bgcolor(): string {
    return document.documentElement.style.getPropertyValue('--risu-theme-bgcolor')
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) {
        Reflect.deleteProperty(h.db, key)
    }
    Object.assign(h.db, {
        colorSchemeName: 'default',
        colorScheme: structuredClone(defaultColorScheme),
        customColorScheme: structuredClone(CUSTOM),
        textTheme: 'standard',
        customTextTheme: {},
    })
    document.documentElement.removeAttribute('style')
})

afterEach(() => {
    setPackSchemeProvider(null)
    isLite.set(false)
})

describe('T27 the pack scheme name and the live lookup', () => {
    test('the name is a fork-only literal: no preset key and not custom', () => {
        expect(PACK_SCHEME_NAME).toBe('theme-pack')
        expect(Object.hasOwn(colorSchemePresets, PACK_SCHEME_NAME)).toBe(false)
        expect(PACK_SCHEME_NAME).not.toBe('custom')
    })

    test('under the name, a provider answer paints; without one the stored copy paints', () => {
        h.db.colorSchemeName = PACK_SCHEME_NAME
        h.db.colorScheme = structuredClone(OWN_COPY)
        expect(effectiveColorScheme(h.db as never)).toEqual(OWN_COPY)
        setPackSchemeProvider(() => PACK)
        expect(effectiveColorScheme(h.db as never)).toBe(PACK)
        setPackSchemeProvider(() => null)
        expect(effectiveColorScheme(h.db as never)).toEqual(OWN_COPY)
    })

    test('the provider is consulted only for the pack name: custom, unknown and preset names ignore it', () => {
        setPackSchemeProvider(() => PACK)
        h.db.colorScheme = structuredClone(OWN_COPY)
        for (const name of ['custom', 'retired-x']) {
            h.db.colorSchemeName = name
            expect(effectiveColorScheme(h.db as never)).toEqual(OWN_COPY)
        }
        h.db.colorSchemeName = 'ocean'
        expect(effectiveColorScheme(h.db as never)).toBe(colorSchemePresets.ocean)
    })

    test('lite always reports the lite scheme, whatever the provider says', () => {
        setPackSchemeProvider(() => PACK)
        h.db.colorSchemeName = PACK_SCHEME_NAME
        isLite.set(true)
        expect(effectiveColorScheme(h.db as never)).toBe(colorSchemePresets.lite)
    })
})

describe('the snapshot reader and schemeWithoutPack', () => {
    test('readSchemeSnapshot accepts a named full scheme and rejects everything else', () => {
        expect(readSchemeSnapshot({ name: 'ocean', scheme: OWN_COPY })).toEqual({ name: 'ocean', scheme: OWN_COPY })
        expect(readSchemeSnapshot(undefined)).toBeNull()
        expect(readSchemeSnapshot(null)).toBeNull()
        expect(readSchemeSnapshot('x')).toBeNull()
        expect(readSchemeSnapshot({ name: '', scheme: OWN_COPY })).toBeNull()
        expect(readSchemeSnapshot({ name: PACK_SCHEME_NAME, scheme: OWN_COPY })).toBeNull()
        expect(readSchemeSnapshot({ name: 'ocean', scheme: { ...OWN_COPY, bgcolor: 5 } })).toBeNull()
        expect(readSchemeSnapshot({ name: 'ocean', scheme: { ...OWN_COPY, type: 'sepia' } })).toBeNull()
        expect(readSchemeSnapshot({ name: 'ocean' })).toBeNull()
    })

    test('a preset snapshot gives the current table entry, not the saved copy', () => {
        h.db.themePackSchemeSnapshot = { name: 'ocean', scheme: OWN_COPY }
        const out = schemeWithoutPack(h.db as never)
        expect(out.colorSchemeName).toBe('ocean')
        expect(out.colorScheme).toEqual(colorSchemePresets.ocean)
        expect(out.colorScheme).not.toBe(colorSchemePresets.ocean)
    })

    test('a custom snapshot gives the Custom slot', () => {
        h.db.themePackSchemeSnapshot = { name: 'custom', scheme: OWN_COPY }
        expect(schemeWithoutPack(h.db as never)).toEqual({ colorSchemeName: 'custom', colorScheme: CUSTOM })
    })

    test('any other name gives its saved copy', () => {
        h.db.themePackSchemeSnapshot = { name: 'retired-x', scheme: OWN_COPY }
        expect(schemeWithoutPack(h.db as never)).toEqual({ colorSchemeName: 'retired-x', colorScheme: OWN_COPY })
    })

    test('a missing or invalid snapshot gives default', () => {
        expect(schemeWithoutPack(h.db as never)).toEqual({ colorSchemeName: 'default', colorScheme: defaultColorScheme })
        h.db.themePackSchemeSnapshot = { name: 'ocean' }
        expect(schemeWithoutPack(h.db as never)).toEqual({ colorSchemeName: 'default', colorScheme: defaultColorScheme })
    })

    test('it never writes', () => {
        h.db.themePackSchemeSnapshot = { name: 'ocean', scheme: OWN_COPY }
        const before = structuredClone(h.db)
        schemeWithoutPack(h.db as never)
        expect(h.db).toEqual(before)
    })
})

describe('enterPackScheme and leavePackScheme', () => {
    test('entering from another scheme writes the snapshot, the copy and the name, and paints the pack', () => {
        h.db.colorSchemeName = 'ocean'
        h.db.colorScheme = structuredClone(colorSchemePresets.ocean)
        enterPackScheme(PACK)
        expect(h.db.colorSchemeName).toBe(PACK_SCHEME_NAME)
        expect(h.db.colorScheme).toEqual(PACK)
        expect(h.db.colorScheme).not.toBe(PACK)
        expect(h.db.themePackSchemeSnapshot).toEqual({ name: 'ocean', scheme: colorSchemePresets.ocean })
        expect(bgcolor()).toBe(PACK.bgcolor)
    })

    test('entering again while on the pack scheme keeps the snapshot', () => {
        h.db.colorSchemeName = 'ocean'
        enterPackScheme(PACK)
        const snapshot = structuredClone(h.db.themePackSchemeSnapshot)
        enterPackScheme({ ...PACK, bgcolor: '#000001' })
        expect(h.db.themePackSchemeSnapshot).toEqual(snapshot)
        expect((h.db.colorScheme as ColorScheme).bgcolor).toBe('#000001')
    })

    test('the Custom slot is never written, entering or leaving', () => {
        const before = structuredClone(h.db.customColorScheme)
        enterPackScheme(PACK)
        expect(h.db.customColorScheme).toEqual(before)
        leavePackScheme()
        expect(h.db.customColorScheme).toEqual(before)
    })

    test('leaving restores the snapshot scheme and deletes the key', () => {
        h.db.colorSchemeName = 'ocean'
        enterPackScheme(PACK)
        leavePackScheme()
        expect(h.db.colorSchemeName).toBe('ocean')
        expect(h.db.colorScheme).toEqual(colorSchemePresets.ocean)
        expect('themePackSchemeSnapshot' in h.db).toBe(false)
        expect(bgcolor()).toBe(colorSchemePresets.ocean.bgcolor)
    })

    test('leaving after a later pick writes no scheme field and still deletes the key', () => {
        enterPackScheme(PACK)
        h.db.colorSchemeName = 'dark'
        h.db.colorScheme = structuredClone(colorSchemePresets.dark)
        leavePackScheme()
        expect(h.db.colorSchemeName).toBe('dark')
        expect(h.db.colorScheme).toEqual(colorSchemePresets.dark)
        expect('themePackSchemeSnapshot' in h.db).toBe(false)
    })

    test('T27e a throw in the write phase leaves the user\'s own name in place', () => {
        const stored = h.db.colorScheme
        Object.defineProperty(h.db, 'colorScheme', {
            get: () => stored,
            set: () => { throw new Error('write') },
            configurable: true,
        })
        expect(() => enterPackScheme(PACK)).toThrow()
        expect(h.db.colorSchemeName).toBe('default')
    })

    test('a throw while computing writes nothing', () => {
        const before = structuredClone(h.db)
        const clone = vi.spyOn(globalThis, 'safeStructuredClone').mockImplementationOnce(() => { throw new Error('clone') })
        try {
            expect(() => enterPackScheme(PACK)).toThrow()
            expect(h.db).toEqual(before)
        } finally {
            clone.mockRestore()
        }
    })
})
