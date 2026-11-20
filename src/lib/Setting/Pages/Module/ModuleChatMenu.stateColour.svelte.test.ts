// @vitest-environment jsdom

/**
 * `ModuleChatMenu.svelte` paints the character-on toggle with the derived `state-violet` scheme role,
 * which stays at least 3:1 on the panel's painted `darkbg` and on the scheme page colour under every
 * preset. The fixtures are the real producers: the real component mounted from source, the Tailwind
 * output of `src/styles.css` compiled for it, and the real `updateColorScheme` over every preset, all
 * resolved per element by the cascade model. The panel background is read from the model, not assumed.
 *
 * RR-2 is a regression reproducer (the toggle was a Tailwind palette literal that fails 3:1 on cherry
 * and nature). G-1 is a new-rule guard.
 *
 * MOCKED: the database, stores, util and global API modules and the system bars. The scrim stays black
 * by design and is not part of the contrast check.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { cr, parseConcrete, type Rgba } from 'src/ts/themePack/colour'
import {
    CascadeModel, classCandidates, compileAppStyles, compileRules, normaliseColours, readRepoFile,
    type RuleSet,
} from 'src/styles/tests/cascadeModel'

//#region module mocks

vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        SettingsMenuIndex: writable(0),
        settingsOpen: writable(false),
        CustomCSSStore: writable(''),
        SafeModeStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return {
        getDatabase: vi.fn(() => DBState.db),
        setDatabase: vi.fn(),
    } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/util'), () => ({
    selectSingleFile: vi.fn(),
    BufferToText: (buf: Uint8Array) => new TextDecoder().decode(buf),
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

//#endregion

import { colorSchemeList, colorSchemePresets, updateColorScheme } from 'src/ts/gui/colorscheme'
import { DBState } from 'src/ts/stores.svelte'
import ModuleChatMenu from './ModuleChatMenu.svelte'

let rules: RuleSet
let toggle: HTMLElement
let panel: HTMLElement
let instance: unknown

function makeModule(name: string): RisuModule {
    return { name, description: '', id: 'id-' + name } as RisuModule
}

/** Tailwind's default palette is written in oklch, which the colour parser does not read; out-of-gamut values are clipped. */
function oklchToRgba(token: string): Rgba | null {
    const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(token)
    if (m === null) return null
    const L = Number(m[1]) / (m[2] === '%' ? 100 : 1)
    const C = Number(m[3])
    const hue = (Number(m[4]) * Math.PI) / 180
    const a = C * Math.cos(hue)
    const b = C * Math.sin(hue)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    const lin = [
        4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
    ]
    const gamma = (v: number): number => {
        const c2 = Math.min(1, Math.max(0, v))
        return 255 * (c2 <= 0.0031308 ? 12.92 * c2 : 1.055 * c2 ** (1 / 2.4) - 0.055)
    }
    return [gamma(lin[0]), gamma(lin[1]), gamma(lin[2]), 1]
}

beforeAll(async () => {
    rules = compileRules([await compileAppStyles(classCandidates(readRepoFile('src/lib/Setting/Pages/Module/ModuleChatMenu.svelte')))])
    DBState.db = {
        modules: [makeModule('A'), makeModule('B')],
        enabledModules: [],
        characters: [{ modules: ['id-B'], chatPage: 0, chats: [{ modules: ['id-A'] }] }],
    } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    instance = mount(ModuleChatMenu, { target, props: { alertMode: false } })
    flushSync()
    const row = Array.from(target.querySelectorAll('div.pl-3.py-3')).find((r) => r.querySelector('span')?.textContent?.trim() === 'B')
    toggle = row!.querySelector('button')!
    panel = target.querySelector<HTMLElement>('div.bg-darkbg')!
}, 120000)

afterAll(async () => {
    await unmount(instance as never).catch(() => {})
    document.documentElement.removeAttribute('style')
})

function applyScheme(name: string): void {
    ;(DBState.db as unknown as Record<string, unknown>).colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
}

const hexOf = (value: string | undefined): string => normaliseColours(value ?? '', '#000000ff')
const colourOf = (value: string | undefined): Rgba => {
    const text = value ?? ''
    const c = parseConcrete(text.slice(0, 7)) ?? oklchToRgba(text)
    if (c === null) throw new Error(`not a concrete colour: ${text}`)
    return c
}

describe('the fixture is live', () => {
    test('the character-on toggle and the panel were found', () => {
        expect(rules.rules.length).toBeGreaterThan(0)
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(panel).not.toBeNull()
    })
})

describe('RR-2: the character-on toggle reads at 3:1 or more on the panel and page colours', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        const model = new CascadeModel(rules)
        const text = colourOf(model.painted(toggle).color)
        const panelFill = colourOf(model.painted(panel)['background-color'])
        expect(hexOf(model.painted(panel)['background-color']), `${name} panel fill`).toBe(hexOf(scheme.darkbg))
        expect(cr(text, panelFill), `${name} on the painted panel`).toBeGreaterThanOrEqual(3)
        expect(cr(text, parseConcrete(scheme.bgcolor)!), `${name} on bgcolor`).toBeGreaterThanOrEqual(3)
    })
})

describe('G-1: the painted colour is the inline scheme role', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const painted = new CascadeModel(rules).painted(toggle).color
        expect(hexOf(painted)).toBe(hexOf(document.documentElement.style.getPropertyValue('--risu-theme-role-state-violet')))
    })

    test('Default (Dusk Nexus) paints the Tailwind seed', () => {
        applyScheme('default')
        expect(hexOf(new CascadeModel(rules).painted(toggle).color)).toBe(hexOf('#8e51ff'))
    })
})
