/**
 * The hidden Nexus preset must not leak into any colour-scheme listing, change the pinned
 * built-in presets or default, or give the plugin-reachable `changeColorScheme` a Nexus branch.
 * Compatibility guards: each passes with and without the preset file present.
 */
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
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    CustomCSSStore: { subscribe: vi.fn(), set: vi.fn() },
    SafeModeStore: { subscribe: vi.fn(), set: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

import {
    changeColorScheme,
    colorSchemeList,
    colorSchemePresets,
    defaultColorScheme,
    updateColorScheme,
} from './colorscheme'

const PINNED_DEFAULT = {
    bgcolor: '#282a36', darkbg: '#21222c', borderc: '#6272a4', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151', type: 'dark',
}

const PINNED_PRESETS = {
    'default': PINNED_DEFAULT,
    'dark': { bgcolor: '#1a1a1a', darkbg: '#141414', borderc: '#525252', selected: '#3d3d3d', draculared: '#ff5555', textcolor: '#f5f5f5', textcolor2: '#a3a3a3', darkBorderc: '#404040', darkbutton: '#2e2e2e', type: 'dark' },
    'light': { bgcolor: '#ffffff', darkbg: '#f0f0f0', borderc: '#0f172a', selected: '#e0e0e0', draculared: '#ff5555', textcolor: '#0f172a', textcolor2: '#64748b', darkBorderc: '#d1d5db', darkbutton: '#e5e7eb', type: 'light' },
    'cherry': { bgcolor: '#450a0a', darkbg: '#7f1d1d', borderc: '#ea580c', selected: '#d97706', draculared: '#ff5555', textcolor: '#f8f8f2', textcolor2: '#fca5a5', darkBorderc: '#92400e', darkbutton: '#b45309', type: 'dark' },
    'galaxy': { bgcolor: '#0f172a', darkbg: '#1f2a48', borderc: '#8be9fd', selected: '#457b9d', draculared: '#ff5555', textcolor: '#f8f8f2', textcolor2: '#8be9fd', darkBorderc: '#457b9d', darkbutton: '#1f2a48', type: 'dark' },
    'nature': { bgcolor: '#1b4332', darkbg: '#2d6a4f', borderc: '#a8dadc', selected: '#4d908e', draculared: '#ff5555', textcolor: '#f8f8f2', textcolor2: '#4d908e', darkBorderc: '#457b9d', darkbutton: '#2d6a4f', type: 'dark' },
    'ocean': { bgcolor: '#0b1f2a', darkbg: '#08202b', borderc: '#38bdf8', selected: '#164e63', draculared: '#fb7185', textcolor: '#e6f6fb', textcolor2: '#8fc7d5', darkBorderc: '#155e75', darkbutton: '#0f3a4a', type: 'dark' },
    'aurora': { bgcolor: '#10201c', darkbg: '#152a24', borderc: '#5eead4', selected: '#315c52', draculared: '#fb7185', textcolor: '#ecfdf5', textcolor2: '#a7f3d0', darkBorderc: '#2f6f63', darkbutton: '#21443c', type: 'dark' },
    'twilight': { bgcolor: '#171324', darkbg: '#201936', borderc: '#c084fc', selected: '#3b2a5a', draculared: '#f43f5e', textcolor: '#f8f5ff', textcolor2: '#c4b5fd', darkBorderc: '#4c3575', darkbutton: '#2e2348', type: 'dark' },
    'realblack': { bgcolor: '#000000', darkbg: '#000000', borderc: '#6272a4', selected: '#44475a', draculared: '#ff5555', textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#4b5563', darkbutton: '#374151', type: 'dark' },
    'monokai-light': { bgcolor: '#f8f8f2', darkbg: '#e8e8e3', borderc: '#75715e', selected: '#d8d8d0', draculared: '#f92672', textcolor: '#272822', textcolor2: '#75715e', darkBorderc: '#c0c0b8', darkbutton: '#d0d0c8', type: 'light' },
    'monokai-black': { bgcolor: '#272822', darkbg: '#1e1f1a', borderc: '#75715e', selected: '#3e3d32', draculared: '#f92672', textcolor: '#f8f8f2', textcolor2: '#a6a68a', darkBorderc: '#3e3d32', darkbutton: '#3e3d32', type: 'dark' },
    'sky-light': { bgcolor: '#f6fbff', darkbg: '#e8f3fb', borderc: '#0284c7', selected: '#d7ecf8', draculared: '#e11d48', textcolor: '#0f172a', textcolor2: '#516174', darkBorderc: '#b7d7ea', darkbutton: '#dbeafe', type: 'light' },
    'sage-light': { bgcolor: '#f7faf5', darkbg: '#e8f0e6', borderc: '#3f6212', selected: '#d9e8d3', draculared: '#dc2626', textcolor: '#1f2933', textcolor2: '#586a52', darkBorderc: '#b7c9ad', darkbutton: '#dce8d6', type: 'light' },
    'lavender-light': { bgcolor: '#f8f7ff', darkbg: '#ede9fe', borderc: '#6d28d9', selected: '#ddd6fe', draculared: '#e11d48', textcolor: '#1e1b4b', textcolor2: '#5b5680', darkBorderc: '#c4b5fd', darkbutton: '#e0e7ff', type: 'light' },
    'slate-light': { bgcolor: '#f8fafc', darkbg: '#e2e8f0', borderc: '#334155', selected: '#cbd5e1', draculared: '#dc2626', textcolor: '#020617', textcolor2: '#475569', darkBorderc: '#94a3b8', darkbutton: '#cbd5e1', type: 'light' },
    'lite': { bgcolor: '#1f2937', darkbg: '#1C2533', borderc: '#475569', selected: '#475569', draculared: '#ff5555', textcolor: '#f8f8f2', textcolor2: '#64748b', darkBorderc: '#030712', darkbutton: '#374151', type: 'dark' },
}

const PROPERTY_BY_FIELD = {
    '--risu-theme-bgcolor': 'bgcolor',
    '--risu-theme-darkbg': 'darkbg',
    '--risu-theme-borderc': 'borderc',
    '--risu-theme-selected': 'selected',
    '--risu-theme-draculared': 'draculared',
    '--risu-theme-textcolor': 'textcolor',
    '--risu-theme-textcolor2': 'textcolor2',
    '--risu-theme-darkborderc': 'darkBorderc',
    '--risu-theme-darkbutton': 'darkbutton',
} as const

function appliedProperties(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const property of Object.keys(PROPERTY_BY_FIELD)) {
        out[property] = document.documentElement.style.getPropertyValue(property)
    }
    return out
}

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorScheme = structuredClone(defaultColorScheme)
    h.db.colorSchemeName = 'default'
    document.documentElement.removeAttribute('style')
})

describe('the hidden Nexus preset', () => {
    test('T-PRESET-1 guard: the listing is the pinned 17 names and has no nexus key', () => {
        expect([...colorSchemeList]).toEqual(Object.keys(PINNED_PRESETS))
        expect(colorSchemeList).toHaveLength(17)
        expect('nexus' in colorSchemePresets).toBe(false)
    })

    test('T-PRESET-2 guard: every preset and the default keep their pinned values', () => {
        expect(defaultColorScheme).toEqual(PINNED_DEFAULT)
        expect(colorSchemePresets).toEqual(PINNED_PRESETS)
    })

    test.each(Object.entries(PINNED_PRESETS))('T-PRESET-2 guard: applying %s sets the nine pinned theme properties', (_name, scheme) => {
        h.db.colorScheme = structuredClone(scheme)
        updateColorScheme()
        const expected: Record<string, string> = {}
        for (const [property, field] of Object.entries(PROPERTY_BY_FIELD)) {
            expected[property] = scheme[field]
        }
        expect(appliedProperties()).toEqual(expected)
    })

    test('T-PRESET-5 guard: changeColorScheme with nexus acts like an unknown name', () => {
        changeColorScheme('no-such-scheme')
        const unknown = { scheme: structuredClone(h.db.colorScheme), name: h.db.colorSchemeName, css: appliedProperties() }

        h.db.colorScheme = structuredClone(defaultColorScheme)
        h.db.colorSchemeName = 'default'
        document.documentElement.removeAttribute('style')
        changeColorScheme('nexus')

        expect(h.db.colorScheme).toEqual(unknown.scheme)
        expect(h.db.colorSchemeName === 'nexus' ? 'no-such-scheme' : h.db.colorSchemeName).toBe(unknown.name)
        expect(appliedProperties()).toEqual(unknown.css)
    })
})
