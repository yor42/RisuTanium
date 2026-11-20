// @vitest-environment jsdom

/**
 * `ModuleSettings.svelte` paints its two categorical module-state controls (the integrated-namespace
 * globe and the conversion-row button) with the derived `state-amber` and `state-violet` scheme
 * roles, which stay at least 3:1 on the scheme's page and panel colours under every preset. The
 * fixtures are the real producers: the real component mounted from source, the Tailwind output of
 * `src/styles.css` compiled for it, and the real `updateColorScheme` over every preset, all resolved
 * per element by the cascade model.
 *
 * RR-1 is a regression reproducer (the controls were Tailwind palette literals that fail 3:1 on
 * light presets and on nature). G-1 and G-3 are new-rule guards; G-2 and the touch case are
 * compatibility guards that pass before and after.
 *
 * MOCKED: alert, database, stores, the util and global API modules, the system bars and the
 * conversion, MCP and module-store helpers, as in `ModuleSettings.iconNames.svelte.test.ts`.
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

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
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

vi.mock(import('src/ts/gui/systemBars'), () => ({
    syncSystemBars: vi.fn(),
}) as unknown as typeof import('src/ts/gui/systemBars'))

vi.mock(import('src/ts/process/modules'), () => ({
    exportModule: vi.fn(),
    exportModuleLegacy: vi.fn(),
    importModule: vi.fn(),
    refreshModules: vi.fn(),
}) as unknown as typeof import('src/ts/process/modules'))

vi.mock(import('src/ts/process/mcp/mcp'), () => ({
    importMCPModule: vi.fn(),
}) as unknown as typeof import('src/ts/process/mcp/mcp'))

vi.mock(import('src/ts/interchangeability'), () => ({
    convertModuleToCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/interchangeability'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    checkCharOrder: vi.fn(),
    downloadFile: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/gui/tooltip'), () => ({
    tooltip: () => ({}),
}) as unknown as typeof import('src/ts/gui/tooltip'))

vi.mock('src/lib/Setting/Pages/Module/ModuleMenu.svelte', () => ({ default: () => {} }))

//#endregion

import { colorSchemeList, colorSchemePresets, updateColorScheme } from 'src/ts/gui/colorscheme'
import { DBState } from 'src/ts/stores.svelte'
import ModuleSettings from './ModuleSettings.svelte'

let rules: RuleSet
let globe: HTMLElement
let conversion: HTMLElement
const instances: unknown[] = []

function makeModule(name: string, extra: Partial<RisuModule> = {}): RisuModule {
    return { name, description: '', id: 'id-' + name, ...extra } as RisuModule
}

function mountModules(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    instances.push(mount(ModuleSettings, { target, props: {} }))
    flushSync()
    return target
}

function rowButtons(target: HTMLElement, title: string): HTMLButtonElement[] {
    const span = Array.from(target.querySelectorAll('span.text-lg')).find((s) => s.textContent?.trim() === title)
    if (!span) throw new Error('row not found: ' + title)
    return Array.from(span.parentElement!.querySelectorAll('button'))
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
    rules = compileRules([await compileAppStyles(classCandidates(readRepoFile('src/lib/Setting/Pages/Module/ModuleSettings.svelte')))])
    DBState.db = {
        modules: [
            makeModule('A'),
            makeModule('B', { namespace: 'ns1' }),
        ],
        enabledModules: ['id-A'],
        moduleIntergration: 'ns0, ns1',
    } as unknown as Database
    globe = rowButtons(mountModules(), 'B')[0]
    const converting = mountModules()
    converting.querySelector<HTMLButtonElement>('div.flex.mr-2.mt-4 button:nth-child(2)')!.click()
    flushSync()
    conversion = rowButtons(converting, 'A')[0]
}, 120000)

afterAll(async () => {
    for (const instance of instances.splice(0)) await unmount(instance as never).catch(() => {})
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
const painted = (el: HTMLElement, env: ConstructorParameters<typeof CascadeModel>[1] = {}): string =>
    new CascadeModel(rules, env).painted(el).color
const role = (name: string): string => document.documentElement.style.getPropertyValue(`--risu-theme-role-${name}`)

describe('the compiled sheet and the fixture are live', () => {
    test('both controls were found and the compiled rules are not empty', () => {
        expect(rules.rules.length).toBeGreaterThan(0)
        expect(globe.getAttribute('aria-pressed')).toBe('false')
        expect(conversion.getAttribute('aria-label')).not.toBeNull()
    })
})

describe('RR-1: the state controls read at 3:1 or more on the scheme page and panel colours', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        const scheme = colorSchemePresets[name]
        for (const [label, el] of [['integrated globe', globe], ['conversion button', conversion]] as const) {
            const colour = colourOf(painted(el))
            for (const surface of ['bgcolor', 'darkbg'] as const) {
                expect(cr(colour, parseConcrete(scheme[surface])!), `${name} ${label} on ${surface}`).toBeGreaterThanOrEqual(3)
            }
        }
    })
})

describe('G-1: the painted colour is the inline scheme role', () => {
    test.each(colorSchemeList)('%s', (name) => {
        applyScheme(name)
        expect(hexOf(painted(globe))).toBe(hexOf(role('state-amber')))
        expect(hexOf(painted(conversion))).toBe(hexOf(role('state-violet')))
    })

    test('Default (Dusk Nexus) paints the Tailwind seeds', () => {
        applyScheme('default')
        expect(hexOf(painted(globe))).toBe(hexOf('#fe9a00'))
        expect(hexOf(painted(conversion))).toBe(hexOf('#8e51ff'))
    })
})

describe('G-2 and G-3: the amber globe hover', () => {
    test.each(colorSchemeList)('%s: on a hover-capable pointer it paints the scheme text colour, a step of at least 1.5 from rest', (name) => {
        applyScheme(name)
        const tx = hexOf(colorSchemePresets[name].textcolor)
        const hover = painted(globe, { hovered: globe, hoverMedia: true })
        expect(hexOf(hover)).toBe(tx)
        expect(cr(colourOf(hover), colourOf(painted(globe))), `${name} hover step`).toBeGreaterThanOrEqual(1.5)
    })

    test.each(colorSchemeList)('%s: on a hover-capable pointer that is not over the globe it keeps the role colour', (name) => {
        applyScheme(name)
        expect(hexOf(painted(globe, { hoverMedia: true }))).toBe(hexOf(role('state-amber')))
    })

    test.each(colorSchemeList)('%s: without hover media a sticky :hover keeps the role colour', (name) => {
        applyScheme(name)
        expect(hexOf(painted(globe, { hovered: globe, hoverMedia: false }))).toBe(hexOf(painted(globe)))
    })
})
