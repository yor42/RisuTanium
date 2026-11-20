// @vitest-environment jsdom

/**
 * The new screens' colour tokens follow the user's colour scheme. The fixtures are the real
 * producers: the Tailwind output of `src/styles.css` (which contains the Nexus and pattern token
 * files), the lazily loaded `chat-tokens.css`, and the real `updateColorScheme`, resolved per
 * element by the cascade model.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { cr, over, parseConcrete, type Rgba } from '../../ts/themePack/colour'
import { CascadeModel, REPO_ROOT, classCandidates, compileAppStyles, compileRules, normaliseColours, readRepoFile, type ModelSheet, type RuleSet } from './cascadeModel'

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

import { colorSchemeList, colorSchemePresets, defaultColorScheme, updateColorScheme, type ColorScheme } from '../../ts/gui/colorscheme'

// Scheme properties recorded instead of failed. A scheme whose derivation cannot reach a floor goes here with its reason.
const ACCEPTED_SHORTFALLS: string[] = []

let rules: RuleSet
let appSheets: ModelSheet[]

beforeAll(async () => {
    const tailwind = await compileAppStyles(classCandidates('text-nexus-text nexus-canvas bg-nexus-canvas text-nexus-text-secondary text-nexus-text-muted text-nexus-danger'))
    appSheets = [tailwind, { name: 'chat-tokens', css: readRepoFile('src/styles/chat-tokens.css') }]
    rules = compileRules(appSheets)
}, 120000)

beforeEach(() => {
    for (const key of Object.keys(h.db)) delete h.db[key]
    h.db.colorScheme = structuredClone(defaultColorScheme)
    h.db.colorSchemeName = 'default'
    document.documentElement.removeAttribute('style')
    document.body.innerHTML = ''
})

afterEach(() => {
    document.body.innerHTML = ''
})

function apply(name: string, set: RuleSet = rules): CascadeModel {
    h.db.colorSchemeName = name
    document.documentElement.removeAttribute('style')
    updateColorScheme()
    return new CascadeModel(set)
}

function fromHex8(text: string): Rgba {
    const c = parseConcrete(`#${text.slice(1, 7)}`)
    if (!c) throw new Error(`not a colour: ${text}`)
    return [c[0], c[1], c[2], text.length === 9 ? parseInt(text.slice(7, 9), 16) / 255 : 1]
}

const ROOT = () => document.documentElement

function colour(m: CascadeModel, name: string, canvas?: Rgba): Rgba {
    const raw = m.custom(ROOT(), name)
    if (raw === undefined) throw new Error(`${name} is not resolved`)
    const c = fromHex8(normaliseColours(raw, '#000000ff'))
    return canvas ? over(c, canvas) : c
}

const channelsOf = (hex: string): string => {
    const c = parseConcrete(hex)!
    return `${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])}`
}

const SCHEMES: Record<string, ColorScheme> = { ...colorSchemePresets }

describe('TB1: the new-screen colour names resolve to the active scheme', () => {
    test.each(['light', 'nexus', 'twilight', 'default'])('%s: canvas, text and overlay channel come from the scheme', (name) => {
        const scheme = SCHEMES[name]
        const m = apply(name)
        const canvas = colour(m, '--nexus-canvas')
        expect(canvas.slice(0, 3)).toEqual(parseConcrete(scheme.bgcolor)!.slice(0, 3))
        const text = colour(m, '--nexus-text', canvas)
        expect(text.slice(0, 3).map(Math.round)).toEqual(parseConcrete(scheme.textcolor)!.slice(0, 3).map(Math.round))
        expect(m.custom(ROOT(), '--nexus-overlay-rgb')).toBe(channelsOf(scheme.textcolor))
    })

    test('a utility class resolves through the theme indirection to the scheme text colour', () => {
        document.body.innerHTML = '<div id="probe" class="text-nexus-text"></div>'
        const m = apply('light')
        const probe = document.getElementById('probe')!
        const painted = fromHex8(m.painted(probe).color)
        const canvas = colour(m, '--nexus-canvas')
        expect(over(painted, canvas).slice(0, 3).map(Math.round)).toEqual(parseConcrete(SCHEMES.light.textcolor)!.slice(0, 3).map(Math.round))
    })
})

describe('TB1b: derived roles reach the tokens', () => {
    test.each(['light', 'twilight', 'cherry'])('%s: muted text, accent and danger resolve to the derived roles', async (name) => {
        const { deriveSchemeRoles } = await import('../../ts/gui/schemeRoles')
        const roles = deriveSchemeRoles(SCHEMES[name])
        const m = apply(name)
        const same = (token: string, role: string) => expect(normaliseColours(m.custom(ROOT(), token)!, '#000000ff')).toBe(normaliseColours(role, '#000000ff'))
        same('--nexus-text-muted', roles['text-muted'])
        same('--nexus-accent', roles.accent)
        same('--nexus-danger', roles.danger)
        expect(m.custom(ROOT(), '--nexus-accent-rgb')).toBe(roles['accent-rgb'])
    })

    test('the muted-text role is written by updateColorScheme', () => {
        apply('light')
        expect(document.documentElement.style.getPropertyValue('--risu-theme-role-text-muted')).not.toBe('')
    })
})

describe('TB2: every preset meets its contrast floors on its own canvas and surfaces', () => {
    // Cherry's scheme collapses text, muted and secondary into one hierarchy level; that is a property of the scheme.
    test.each(colorSchemeList)('%s', (name) => {
        const m = apply(name)
        const canvas = colour(m, '--nexus-canvas')
        const surface = colour(m, '--nexus-surface', canvas)
        const raised = colour(m, '--nexus-surface-raised', canvas)
        const failures: string[] = []
        const floor = (what: string, fg: Rgba, bg: Rgba, min: number) => {
            const ratio = cr(over(fg, bg), bg)
            if (ratio < min && !ACCEPTED_SHORTFALLS.includes(`${name}:${what}`)) failures.push(`${name}: ${what} ${ratio.toFixed(2)} < ${min}`)
        }
        for (const token of ['--nexus-text', '--nexus-text-secondary', '--nexus-text-muted']) {
            floor(`${token} on canvas`, colour(m, token), canvas, 4.5)
            floor(`${token} on surface`, colour(m, token), surface, 4.5)
        }
        floor('muted on raised', colour(m, '--nexus-text-muted'), raised, 4.5)
        floor('field border on canvas', colour(m, '--nexus-field-border'), canvas, 3)
        floor('field border on surface', colour(m, '--nexus-field-border'), surface, 3)
        for (const token of ['--nexus-accent', '--nexus-ring']) {
            floor(`${token} on canvas`, colour(m, token), canvas, 4.5)
            floor(`${token} on surface`, colour(m, token), surface, 4.5)
            floor(`${token} on raised`, colour(m, token), raised, 3)
        }
        floor('danger on canvas', colour(m, '--nexus-danger'), canvas, 4.5)
        floor('danger on surface', colour(m, '--nexus-danger'), surface, 4.5)
        floor('toast text', colour(m, '--nexus-text'), colour(m, '--color-surface-toast', canvas), 4.5)
        const overlay = parseConcrete(`rgb(${m.custom(ROOT(), '--nexus-overlay-rgb')!.split(' ').join(' ')})`)!
        const track = over([overlay[0], overlay[1], overlay[2], Number(m.custom(ROOT(), '--alpha-switch-off'))], canvas)
        floor('switch-off track on canvas', track, canvas, 3)
        floor('switch-off track on surface', track, surface, 3)
        floor('on-accent', colour(m, '--pattern-on-accent'), colour(m, '--nexus-accent', canvas), 4.5)
        floor('on-danger', colour(m, '--pattern-on-danger'), colour(m, '--nexus-danger', canvas), 4.5)
        expect(failures).toEqual([])
    })

    test('no shortfall is accepted', () => {
        expect(ACCEPTED_SHORTFALLS).toEqual([])
    })

    test('the colour scheme property follows the scheme type', () => {
        for (const name of colorSchemeList) {
            const m = apply(name)
            expect(m.custom(ROOT(), '--color-scheme')).toBe(SCHEMES[name].type)
        }
    })
})

describe('TB4b: token fallbacks equal the Default derivation', () => {
    const FILES = ['src/styles/nexus-tokens.css', 'src/styles/chat-tokens.css', 'src/styles/pattern-tokens.css', 'src/styles.css', 'src/ts/chatShell/cardEffects.css']

    test('every role reference carries the role derived from the built-in Default as its fallback', async () => {
        const { deriveSchemeRoles } = await import('../../ts/gui/schemeRoles')
        const roles = deriveSchemeRoles(defaultColorScheme) as unknown as Record<string, string>
        let found = 0
        for (const file of FILES) {
            for (const m of readRepoFile(file).matchAll(/var\(--risu-theme-role-([a-z-]+),\s*([^)]+)\)/g)) {
                found++
                expect(m[2].trim(), `${file} ${m[1]}`).toBe(roles[m[1]])
            }
        }
        expect(found).toBeGreaterThanOrEqual(17)
    })
})

describe('TB5e: the classic focus ring and the new-screen ring are one colour', () => {
    test.each(colorSchemeList)('%s: --nexus-ring equals the focus-ring role', (name) => {
        const m = apply(name)
        const role = document.documentElement.style.getPropertyValue('--risu-theme-role-focus-ring')
        expect(role).not.toBe('')
        expect(normaliseColours(m.custom(ROOT(), '--nexus-ring')!, '#000000ff')).toBe(normaliseColours(role, '#000000ff'))
    })
})

describe('TB7: the derived roles are read only by the token files and the classic focus ring', () => {
    function walk(dir: string, out: string[]) {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name)
            if (e.isDirectory()) walk(p, out)
            else if (/\.(svelte|css|ts)$/.test(e.name) && !/\.test\./.test(e.name) && !/[\\/]tests[\\/]/.test(p)) out.push(p)
        }
    }

    // pattern-tokens.css reads the roles only through --nexus-canvas, so it names none.
    test('--risu-theme-role- appears only in the Nexus and chat token files, the classic focus ring rules, colorscheme.ts and schemeRoles.ts', () => {
        const files: string[] = []
        walk(path.join(REPO_ROOT, 'src'), files)
        const users = files
            .filter((f) => readFileSync(f, 'utf8').includes('--risu-theme-role-'))
            .map((f) => path.relative(REPO_ROOT, f).replace(/\\/g, '/'))
            .sort()
        expect(users).toEqual([
            'src/styles.css',
            'src/styles/chat-tokens.css',
            'src/styles/nexus-tokens.css',
            'src/ts/chatShell/cardEffects.css',
            'src/ts/gui/colorscheme.ts',
            'src/ts/gui/schemeRoles.ts',
        ])
    })
})

describe('TB8b: a pack declaration still wins over the scheme mapping', () => {
    test('under light, a pack :root that sets the accent and canvas gets its own values', () => {
        const pack = { name: 'pack', css: ':root{--nexus-accent:#ffaa00;--nexus-canvas:#123456}' }
        const set = compileRules([...appSheets, pack])
        const m = apply('light', set)
        expect(normaliseColours(m.custom(ROOT(), '--nexus-accent')!, '#000000ff')).toBe('#ffaa00ff')
        expect(normaliseColours(m.custom(ROOT(), '--nexus-canvas')!, '#000000ff')).toBe('#123456ff')
    })
})
