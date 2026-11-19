// @vitest-environment node
// CHORE-738 stage 5 (MC-2320, MC-2321, MC-2322, MC-2323): the install judge's per-token limits on the focus rings. Chat --focus-ring-w and --focus-ring-w-forced
// are at most 4 px; --focus-ring-offset-inset and --focus-ring-offset-wide run from -6 to 6 px; in Settings only, --pattern-focus-width is at most 4 px and
// --pattern-focus-offset runs from -6 to 6 px. Each row is labelled REPRO (refused now, accepted before the limits) or GUARD (accepted or equal before and after).
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AREA_LINT, lintAreaPack, type ThemeArea } from './index'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const DESIGN = path.resolve(ROOT, 'docs/design')
interface RefLint { ok: boolean, errors: { prop: string, why: string }[] }
const refLib = await import(/* @vite-ignore */ pathToFileURL(path.join(DESIGN, 'theme/checks/lib.mjs')).href) as { LINT: Record<ThemeArea, (css: string, name: string) => RefLint> }

const AREAS: ThemeArea[] = ['chat', 'settings', 'studio', 'home']
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const whys = (area: ThemeArea, css: string): string[] => lintAreaPack(area, css, 'probe').errors.map((e) => `${e.prop} | ${e.why}`)
const ok = (area: ThemeArea, css: string): boolean => lintAreaPack(area, css, 'probe').ok
const maxWhy = (token: string, worst: string, cap: string): RegExp => new RegExp(`^${esc(token)} \\| above the critical maximum: ${esc(token)} can be ${esc(worst)} .*the ceiling is ${esc(cap)}$`)
const minWhy = (token: string, worst: string, floor: string): RegExp => new RegExp(`^${esc(token)} \\| below the critical minimum: ${esc(token)} can be ${esc(worst)} .*the floor is ${esc(floor)}$`)
const has = (area: ThemeArea, css: string, re: RegExp): void => {
    const found = whys(area, css)
    expect(found.some((why) => re.test(why)), `${area} ${css}: ${re} against ${JSON.stringify(found)}`).toBe(true)
}
const accepted = (area: ThemeArea, css: string): void => {
    expect(ok(area, css), `${area} ${css}: ${JSON.stringify(whys(area, css))}`).toBe(true)
}

const WIDTHS = ['--focus-ring-w', '--focus-ring-w-forced']
const OFFSETS = ['--focus-ring-offset-inset', '--focus-ring-offset-wide']

describe('R1 a ring width over 4 px is refused in every area (REPRO)', () => {
    const rows = AREAS.flatMap((area) => WIDTHS.flatMap((token) => ['4.01', '5', '60'].map((px) => [area, token, px] as const)))
    it.each(rows)('%s %s:%spx', (area, token, px) => has(area, `:root{${token}:${px}px}`, maxWhy(token, px, '4px')))
})

describe('R2 a ring width at or under 4 px stays accepted (GUARD)', () => {
    const rows = AREAS.flatMap((area) => WIDTHS.flatMap((token) => ['4px', '3px', '0.25rem'].map((value) => [area, token, value] as const)))
    it.each(rows)('%s %s:%s', (area, token, value) => accepted(area, `:root{${token}:${value}}`))
})

describe('R3 a ring offset outside -6 to 6 px is refused in every area (REPRO)', () => {
    const rows = AREAS.flatMap((area) => OFFSETS.flatMap((token) => ['7', '6.5', '60', '-7', '-6.5', '-60'].map((px) => [area, token, px] as const)))
    it.each(rows)('%s %s:%spx', (area, token, px) => has(area, `:root{${token}:${px}px}`, Number(px) > 0 ? maxWhy(token, px, '6px') : minWhy(token, px, '-6px')))
})

describe('R4 a ring offset from -6 to 6 px stays accepted (GUARD)', () => {
    const rows = AREAS.flatMap((area) => OFFSETS.flatMap((token) => ['6px', '-6px', '0px', '-2px', '4px'].map((value) => [area, token, value] as const)))
    it.each(rows)('%s %s:%s', (area, token, value) => accepted(area, `:root{${token}:${value}}`))
})

describe('R5 the worst case over a private helper override counts (REPRO)', () => {
    it.each(AREAS)('%s width through --pack-r under data-input', (area) => {
        has(area, ':root{--pack-r:2px;--focus-ring-w:var(--pack-r)}html[data-input="touch"]{--pack-r:5px}', maxWhy('--focus-ring-w', '5', '4px'))
    })
    it.each(AREAS)('%s inset offset through --pack-o under data-input', (area) => {
        has(area, ':root{--pack-o:-2px;--focus-ring-offset-inset:var(--pack-o)}html[data-input="touch"]{--pack-o:-7px}', minWhy('--focus-ring-offset-inset', '-7', '-6px'))
    })
})

describe('R6 the Settings pattern ring over its limits is refused (REPRO)', () => {
    it.each(['4.01', '5', '60'])('--pattern-focus-width:%spx', (px) => has('settings', `:root{--pattern-focus-width:${px}px}`, maxWhy('--pattern-focus-width', px, '4px')))
    it.each(['7', '6.5', '-7', '-6.5'])('--pattern-focus-offset:%spx', (px) => {
        has('settings', `:root{--pattern-focus-offset:${px}px}`, Number(px) > 0 ? maxWhy('--pattern-focus-offset', px, '6px') : minWhy('--pattern-focus-offset', px, '-6px'))
    })
})

describe('R7 the Settings pattern ring inside its limits stays accepted (GUARD)', () => {
    it.each([
        ':root{--pattern-focus-width:4px}',
        ':root{--pattern-focus-width:2px}',
        ':root{--pattern-focus-offset:6px}',
        ':root{--pattern-focus-offset:-6px}',
        ':root{--pattern-focus-offset:2px}',
    ])('%s', (css) => accepted('settings', css))
})

describe('R8 the pattern pair stays unsettable in chat, Studio and Home (GUARD)', () => {
    const rows = (['chat', 'studio', 'home'] as const).flatMap((area) => ['--pattern-focus-width', '--pattern-focus-offset'].map((token) => [area, token] as const))
    it.each(rows)('%s %s:2px', (area, token) => has(area, `:root{${token}:2px}`, new RegExp(`^${esc(token)} \\| ${esc(token)} is not a pack-settable token`)))
})

describe('R9 the app defaults restated stay accepted (GUARD)', () => {
    const DEFAULTS = ':root{--focus-ring-w:2px;--focus-ring-w-forced:3px;--focus-ring-offset:2px;--focus-ring-offset-inset:-2px;--focus-ring-offset-wide:4px}'
    it.each(AREAS)('%s', (area) => accepted(area, DEFAULTS))
    it('settings pattern defaults', () => accepted('settings', ':root{--pattern-focus-width:2px;--pattern-focus-offset:2px}'))
})

describe('R10 Settings agrees with the reference on the limited names (GUARD, parity)', () => {
    const names = ['--pattern-focus-width', '--pattern-focus-offset', ...WIDTHS, ...OFFSETS]
    const values = ['-7px', '-6px', '0px', '4px', '4.01px', '6px', '7px', 'auto']
    it.each(names.flatMap((name) => values.map((value) => [name, value] as const)))('%s:%s', (name, value) => {
        const css = `:root{${name}:${value}}`
        expect(AREA_LINT.settings(css, 'p'), css).toEqual(refLib.LINT.settings(css, 'p'))
    })
})

describe('R11 Settings reads --focus-ring-w through --nexus-focus-ring-width (MC-2338)', () => {
    it('settings refuses a nexus width of 5px through the alias (REPRO)', () => has('settings', ':root{--nexus-focus-ring-width:5px}', maxWhy('--focus-ring-w', '5', '4px')))
    it('settings accepts a nexus width of 4px (GUARD)', () => accepted('settings', ':root{--nexus-focus-ring-width:4px}'))
    it.each(['chat', 'studio', 'home'] as const)('%s accepts a nexus width of 8px (GUARD)', (area) => accepted(area, ':root{--nexus-focus-ring-width:8px}'))
})

describe('R13 an offset that cannot be measured is refused (REPRO)', () => {
    const rows = (['chat', 'studio'] as const).flatMap((area) => OFFSETS.map((token) => [area, token] as const))
    it.each(rows)('%s %s:auto', (area, token) => has(area, `:root{${token}:auto}`, new RegExp(`^${esc(token)} \\| .*cannot be ruled out`)))
    it.each(rows)('%s %s:2px 2px (a pair of lengths)', (area, token) => has(area, `:root{${token}:2px 2px}`, new RegExp(`^${esc(token)} \\| .*cannot be ruled out`)))
})
