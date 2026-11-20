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

/** Hue (degrees) and chroma of an sRGB hex colour in OKLCH. */
function oklch(hex: string): { h: number, c: number } {
    const lin = c(hex).slice(0, 3).map((v) => v / 255).map((u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4))
    const l = Math.cbrt(0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2])
    const m = Math.cbrt(0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2])
    const s = Math.cbrt(0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2])
    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    const b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return { h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, c: Math.hypot(a, b) }
}

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
        expect(cr(c(roles['state-amber']), bg), 'state-amber').toBeGreaterThanOrEqual(3)
        expect(cr(c(roles['state-amber']), dbg), 'state-amber').toBeGreaterThanOrEqual(3)
        expect(cr(c(roles['state-violet']), bg), 'state-violet').toBeGreaterThanOrEqual(3)
        expect(cr(c(roles['state-violet']), dbg), 'state-violet').toBeGreaterThanOrEqual(3)
        expect(roles['color-scheme']).toBe(s.type)
    })

    test.each(SCHEMES)('%s: a state role equals its seed wherever the seed already passes', (_name, s) => {
        const roles = deriveSchemeRoles(s)
        for (const [role, seed] of [['state-amber', '#fe9a00'], ['state-violet', '#8e51ff']] as const) {
            const passes = cr(c(seed), c(s.bgcolor)) >= 3 && cr(c(seed), c(s.darkbg)) >= 3
            if (passes) expect(roles[role]).toBe(seed)
            else expect(roles[role]).not.toBe(seed)
        }
    })

    test.each(SCHEMES)('%s: the state roles keep their hue family and stay saturated', (_name, s) => {
        const roles = deriveSchemeRoles(s)
        const amber = oklch(roles['state-amber'])
        const violet = oklch(roles['state-violet'])
        expect(amber.h, 'amber hue').toBeGreaterThanOrEqual(53)
        expect(amber.h, 'amber hue').toBeLessThanOrEqual(77)
        expect(violet.h, 'violet hue').toBeGreaterThanOrEqual(282)
        expect(violet.h, 'violet hue').toBeLessThanOrEqual(306)
        expect(amber.c, 'amber chroma').toBeGreaterThanOrEqual(0.09)
        expect(violet.c, 'violet chroma').toBeGreaterThanOrEqual(0.09)
    })

    test('a scheme whose text colour equals the page colour reports both state roles as short', () => {
        // Light presets fail the amber seed, and the lift target is as bright as the page, so no mix reaches the floor.
        const light = colorSchemePresets.light
        const { short } = deriveSchemeRolesChecked({ ...light, textcolor: light.bgcolor, darkbg: light.bgcolor })
        expect(short).toContain('state-amber')
        const dark = deriveSchemeRolesChecked({ ...colorSchemePresets.nature, textcolor: colorSchemePresets.nature.bgcolor, darkbg: colorSchemePresets.nature.bgcolor })
        expect(dark.short).toContain('state-violet')
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
            'on-selected': '#eef0ff', 'on-borderc': '#000000', 'state-amber': '#fe9a00', 'state-violet': '#8e51ff', 'on-danger': '#ffffff',
        })
    })

    // The rest, selected and hover fills of the danger Button and of GridCatalog's icon trash button
    // (Tailwind red-700, red-800 and red-600 clipped to sRGB); the compiled-sheet tests pin them to the markup.
    const DANGER_FILLS = ['#c10007', '#9f0712', '#e7000b']

    test.each(SCHEMES)('%s: on-danger reaches 4.5:1 on every danger fill and is the text colour where that already holds', (_name, s) => {
        const role = deriveSchemeRoles(s)['on-danger']
        for (const fill of DANGER_FILLS) expect(cr(c(role), c(fill)), `${role} on ${fill}`).toBeGreaterThanOrEqual(4.5)
        if (DANGER_FILLS.every((f) => cr(c(s.textcolor), c(f)) >= 4.5)) expect(role).toBe(toHex(c(s.textcolor)))
        else expect(role).toBe('#ffffff')
    })

    test('on-danger keeps the scheme text colour on aurora and falls to white on Default', () => {
        expect(deriveSchemeRoles(colorSchemePresets.aurora)['on-danger']).toBe(toHex(c(colorSchemePresets.aurora.textcolor)))
        expect(deriveSchemeRoles(colorSchemePresets.light)['on-danger']).toBe('#ffffff')
    })

    test('a text colour that fails every danger fill gives white', () => {
        const s: ColorScheme = { ...defaultColorScheme, textcolor: '#c10007' }
        expect(deriveSchemeRoles(s)['on-danger']).toBe('#ffffff')
    })

    test('an unreadable text colour keeps the raw input for on-danger', () => {
        const s: ColorScheme = { ...defaultColorScheme, textcolor: 'nonsense' }
        expect(deriveSchemeRoles(s)['on-danger']).toBe('nonsense')
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

    test.each(SCHEMES)('%s: on-borderc is the text colour where it reaches 4.5:1 on borderc, else black or white', (_name, s) => {
        const role = deriveSchemeRoles(s)['on-borderc']
        const bc = c(s.borderc)
        expect(cr(c(role), bc)).toBeGreaterThanOrEqual(4.5)
        if (cr(c(s.textcolor), bc) >= 4.5) expect(role).toBe(toHex(c(s.textcolor)))
        else expect(role).toBe(toHex(bestExtreme(bc)))
    })

    test.each([['light', '#ffffff'], ['default', '#000000'], ['cherry', '#000000'], ['galaxy', '#000000']])('%s: on-borderc falls to the extreme %s', (name, extreme) => {
        expect(deriveSchemeRoles(colorSchemePresets[name])['on-borderc']).toBe(extreme)
    })

    test('an unreadable borderc colour keeps the text colour', () => {
        const s: ColorScheme = { ...defaultColorScheme, borderc: 'nonsense' }
        expect(deriveSchemeRoles(s)['on-borderc']).toBe('#eef0ff')
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
        expect(roles['state-amber']).toBe('#fe9a00')
        expect(roles['state-violet']).toBe('#8e51ff')
    })

    test('a scheme whose muted text sits just under the floor is lifted above it', () => {
        // #94a3b8 on #374151 is 4.02:1.
        const s: ColorScheme = { ...defaultColorScheme, bgcolor: '#374151', darkbg: '#374151', darkbutton: '#374151', textcolor2: '#94a3b8', textcolor: '#f8f8f2' }
        const roles = deriveSchemeRoles(s)
        expect(cr(c('#94a3b8'), c('#374151'))).toBeLessThan(4.5)
        expect(cr(c(roles['text-muted']), c('#374151'))).toBeGreaterThanOrEqual(4.5)
    })
})
