// @vitest-environment node

/**
 * The derived colour roles: contrast floors on every built-in scheme, deterministic and total
 * output, and the raw-input fallbacks for colours that cannot be read. No role is ever stored.
 */
import { describe, expect, test, vi } from 'vitest'
import { bestExtreme, cr, parseConcrete, toHex } from '../themePack/colour'

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
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
    DBState: { db: {} },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import { colorSchemePresets, defaultColorScheme, type ColorScheme } from './colorscheme'
import { deriveSchemeRoles, deriveSchemeRolesChecked } from './schemeRoles'

const SCHEMES = Object.entries(colorSchemePresets) as [string, ColorScheme][]
const c = (hex: string) => parseConcrete(hex)!

describe('deriveSchemeRoles', () => {
    test.each(SCHEMES)('%s: every role meets its floor on the scheme surfaces', (_name, s) => {
        const { roles, short } = deriveSchemeRolesChecked(s)
        expect(short).toEqual([])
        const bg = c(s.bgcolor)
        const dbg = c(s.darkbg)
        const btn = c(s.darkbutton)
        for (const role of ['text-muted', 'text-secondary'] as const) {
            expect(cr(c(roles[role]), bg), role).toBeGreaterThanOrEqual(4.5)
            expect(cr(c(roles[role]), dbg), role).toBeGreaterThanOrEqual(4.5)
        }
        expect(cr(c(roles['text-muted']), btn)).toBeGreaterThanOrEqual(4.5)
        expect(cr(c(roles['field-border']), bg)).toBeGreaterThanOrEqual(3)
        expect(cr(c(roles['field-border']), dbg)).toBeGreaterThanOrEqual(3)
        expect(cr(c(roles.accent), bg)).toBeGreaterThanOrEqual(4.5)
        expect(cr(c(roles.accent), dbg)).toBeGreaterThanOrEqual(4.5)
        expect(cr(c(roles.accent), btn)).toBeGreaterThanOrEqual(3)
        expect(cr(c(roles.danger), bg)).toBeGreaterThanOrEqual(4.5)
        expect(cr(c(roles.danger), dbg)).toBeGreaterThanOrEqual(4.5)
        expect(cr(c(roles['focus-ring']), bg), 'focus-ring').toBeGreaterThanOrEqual(3)
        expect(cr(c(roles['focus-ring']), dbg), 'focus-ring').toBeGreaterThanOrEqual(3)
        expect(cr(c(roles['focus-ring']), btn), 'focus-ring').toBeGreaterThanOrEqual(3)
        expect(roles['color-scheme']).toBe(s.type)
    })

    test('the accent channel is the accent solid', () => {
        for (const [, s] of SCHEMES) {
            const roles = deriveSchemeRoles(s)
            const a = c(roles.accent)
            expect(roles['accent-rgb']).toBe(`${Math.round(a[0])} ${Math.round(a[1])} ${Math.round(a[2])}`)
        }
    })

    test('the built-in Default derives its pinned roles', () => {
        expect(deriveSchemeRoles(defaultColorScheme)).toEqual({
            'text-secondary': '#bfc6e3', 'text-muted': '#a6b0d4', 'accent': '#6f7fc8', 'accent-rgb': '111 127 200',
            'focus-ring': '#6f7fc8', 'field-border': '#6f7fc8', 'danger': '#ff6b81', 'danger-rgb': '255 107 129', 'warning-rgb': '255 209 102',
            'overlay-rgb': '238 240 255', 'switch-off-alpha': '0.36', 'surface-toast': '#2f3670', 'color-scheme': 'dark',
            'on-selected': '#eef0ff',
        })
    })

    test.each(SCHEMES)('%s: on-selected is the text colour where it reaches 4.5:1 on selected, else black or white', (_name, s) => {
        const role = deriveSchemeRoles(s)['on-selected']
        const sel = c(s.selected)
        expect(cr(c(role), sel)).toBeGreaterThanOrEqual(4.5)
        if (cr(c(s.textcolor), sel) >= 4.5) expect(role).toBe(toHex(c(s.textcolor)))
        else expect(role).toBe(toHex(bestExtreme(sel)))
    })

    test.each([['cherry', '#000000'], ['galaxy', '#ffffff'], ['nature', '#000000']])('%s: on-selected falls to the extreme %s', (name, extreme) => {
        expect(deriveSchemeRoles(colorSchemePresets[name])['on-selected']).toBe(extreme)
    })

    test('an unreadable selected colour keeps the text colour', () => {
        const s: ColorScheme = { ...defaultColorScheme, selected: 'nonsense' }
        expect(deriveSchemeRoles(s)['on-selected']).toBe('#eef0ff')
    })

    test('is deterministic and idempotent', () => {
        for (const [, s] of SCHEMES) {
            expect(deriveSchemeRoles(s)).toEqual(deriveSchemeRoles({ ...s }))
        }
    })

    test.each(['nonsense', '', '#12'])('unreadable input %j never throws and falls back to the raw input or the Default accent', (bad) => {
        const s: ColorScheme = { ...defaultColorScheme, textcolor2: bad, borderc: bad, draculared: bad, textcolor: bad, selected: bad }
        const roles = deriveSchemeRoles(s)
        expect(roles['text-muted']).toBe(bad)
        expect(roles['field-border']).toBe(bad)
        expect(roles.danger).toBe(bad)
        expect(roles['text-secondary']).toBe(bad)
        expect(roles['surface-toast']).toBe(bad)
        expect(roles.accent).toBe('#6f7fc8')
        expect(roles['accent-rgb']).toBe('111 127 200')
        expect(roles['focus-ring']).toBe('#6f7fc8')
    })

    test('a scheme whose muted text sits just under the floor is lifted above it', () => {
        // #94a3b8 on #374151 is 4.02:1.
        const s: ColorScheme = { ...defaultColorScheme, bgcolor: '#374151', darkbg: '#374151', darkbutton: '#374151', textcolor2: '#94a3b8', textcolor: '#f8f8f2' }
        const roles = deriveSchemeRoles(s)
        expect(cr(c('#94a3b8'), c('#374151'))).toBeLessThan(4.5)
        expect(cr(c(roles['text-muted']), c('#374151'))).toBeGreaterThanOrEqual(4.5)
    })
})
