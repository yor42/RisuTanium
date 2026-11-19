// @vitest-environment node
/**
 * Every colour check reads a colour through the one reader (colour.ts parseConcrete): hsl(), a named colour and color-mix() in
 * srgb, srgb-linear and oklab reach the chat token check, the chat declaration check, VALUES, the home supplement and the studio
 * risky pass, and each site returns the verdict of the reference twin (T2a-1 to T2a-6, T2a-9 per site).
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { tokenCheck } from './engine'
import { THEME_AREAS, lintAreaPack, type ThemeArea } from './index'
import { homeSupplement } from './registries/home'
import { riskyColourPass } from './registries/studio'

const DESIGN = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)), 'docs/design')
interface RefError { selector: string, prop: string, why: string }
interface RefResult { ok: boolean, errors: RefError[] }
interface RefLoader { LINT: Record<ThemeArea, (css: string, name: string) => RefResult> }
interface RefHome { homeSupplement: (css: string) => RefError[] }
const load = <T,>(rel: string): Promise<T> => import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, rel)).href) as Promise<T>
const lib = await load<RefLoader>('theme/checks/lib.mjs')
const refHome = await load<RefHome>('home/registry-home.mjs')

const whys = (errors: readonly { prop: string, why: string }[], prop?: string): string[] => errors.filter((e) => prop === undefined || e.prop === prop).map((e) => e.why)
const MIX_WHITE = 'color-mix(in srgb, #ffffff 90%, #000000)'
const MIX_DARK = 'color-mix(in srgb, #333 50%, #222)'

describe('chat token check (T2a-1, T2a-2)', () => {
    test.each([['hsl', 'hsl(0 0% 20%)'], ['a named colour', 'black'], ['color-mix', MIX_DARK]])('--nexus-text as %s is judged against the sheet', (_name, value) => {
        expect(whys(tokenCheck(`:root{--nexus-text:${value}}`)).join('\n')).toMatch(/critical text would be [\d.]+:1 on the sheet/)
    })
    test('a legible color-mix text is accepted, an illegible one is refused by contrast and not as unreadable', () => {
        expect(lintAreaPack('chat', `:root{--nexus-text:${MIX_WHITE}}`, 'p').ok).toBe(true)
        const bad = lintAreaPack('chat', `:root{--nexus-text:${MIX_DARK}}`, 'p')
        expect(bad.ok).toBe(false)
        expect(bad.errors.some((e) => /would be [\d.]+:1/.test(e.why))).toBe(true)
        expect(bad.errors.some((e) => /cannot be resolved/.test(e.why))).toBe(false)
    })
})

describe('VALUES focus ring (T2a-3)', () => {
    test.each(THEME_AREAS)('%s: a color-mix focus ring is judged, not "cannot be checked"', (area) => {
        const result = lintAreaPack(area, `:root{--nexus-ring:${MIX_WHITE}}`, 'p')
        expect(result.errors.map((e) => e.why).join('\n')).not.toMatch(/a focus ring colour that cannot be checked/)
        expect(result.ok, JSON.stringify(result.errors)).toBe(true)
    })
})

describe('home primary button pair (T2a-4, T2a-5)', () => {
    const accent = '--nexus-accent:#b0b6cf'
    test.each([
        ['a named on-accent', `:root{${accent};--home-on-accent:black}`],
        ['an hsl on-accent', `:root{${accent};--home-on-accent:hsl(0 0% 0%)}`],
        ['a color-mix accent', `:root{--nexus-accent:color-mix(in oklab, #b0b6cf 80%, #ffffff);--home-on-accent:#000000}`],
    ])('%s is judged, not "cannot be checked"', (_name, css) => {
        expect(whys(homeSupplement(css), '--home-on-accent')).toEqual([])
        expect(whys(refHome.homeSupplement(css), '--home-on-accent')).toEqual([])
    })
    test('the control pair is accepted and a low-contrast pair is still refused', () => {
        expect(whys(homeSupplement(`:root{${accent};--home-on-accent:#000000}`), '--home-on-accent')).toEqual([])
        expect(whys(homeSupplement(`:root{${accent};--home-on-accent:#b0b6cf}`), '--home-on-accent').join('\n')).toMatch(/would be [\d.]+:1/)
    })
})

describe('studio risky pass (T2a-6)', () => {
    test.each([['hsl', 'hsl(240 20% 93%)'], ['color-mix', 'color-mix(in srgb, #ffffff 90%, #000020)'], ['a named colour', 'white']])('--nexus-text as %s is judged against the risky tint', (_name, value) => {
        const css = `:root{--nexus-text:${value}}`
        expect(whys(riskyColourPass(css)).join('\n')).not.toMatch(/cannot be checked against the risky section/)
        expect(lintAreaPack('studio', css, 'p').errors.map((e) => e.why).join('\n')).not.toMatch(/cannot be checked against the risky section/)
    })
    test('a bare channel triple is still read for the danger channel', () => {
        expect(whys(riskyColourPass(':root{--nexus-danger-rgb:255 107 129}'))).toEqual([])
    })
})

describe('each site returns the reference verdict (T2a-9 per site)', () => {
    const SITES: [string, string][] = [
        ['hsl text token', ':root{--nexus-text:hsl(0 0% 20%)}'],
        ['named text token', ':root{--nexus-text:black}'],
        ['color-mix text token, legible', `:root{--nexus-text:${MIX_WHITE}}`],
        ['color-mix text token, illegible', `:root{--nexus-text:${MIX_DARK}}`],
        ['oklab text token', ':root{--nexus-text:color-mix(in oklab, #ffffff 80%, #101010)}'],
        ['out-of-gamut oklab text token', ':root{--nexus-text:color-mix(in oklab, #0000ff, #ffffff)}'],
        ['color-mix ring', `:root{--nexus-ring:${MIX_WHITE}}`],
        ['color-mix accent and on-accent', ':root{--nexus-accent:color-mix(in srgb-linear, #b0b6cf 80%, #ffffff);--home-on-accent:hsl(0 0% 0%)}'],
        ['color-mix danger and channel', ':root{--nexus-danger:color-mix(in srgb, #ff6b81 100%, #000000);--nexus-danger-rgb:255 107 129}'],
        ['hsl text colour on a reach part', '[data-part="chat-list-row"]{color:hsl(0 0% 20%)}'],
        ['named text colour on a reach part', '[data-part="chat-list-row"]{color:black}'],
        ['color-mix text colour on a reach part', `[data-part="chat-list-row"]{color:${MIX_DARK}}`],
        ['color-mix fill on a control', `[data-part="chat-send"]{background:${MIX_WHITE};color:#101010}`],
    ]
    test.each(SITES.flatMap(([name, css]) => THEME_AREAS.map((area): [string, ThemeArea, string] => [name, area, css])))('%s in %s', (_name, area, css) => {
        const port = lintAreaPack(area, css, 'p')
        const ref = lib.LINT[area](css, 'p')
        expect(port.ok).toBe(ref.ok)
    })
})
