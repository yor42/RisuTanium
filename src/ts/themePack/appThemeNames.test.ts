// @vitest-environment node
// R-e / axis D (UI-S6 I0a): the app owns the Tailwind theme names and the colour scheme's inline names on every screen, and a
// stylesheet applied to one screen may declare only that screen's own tokens and its --pack-* helpers.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_THEME_NAMES, TAILWIND_DEFAULT_NAMES, allowedTokenNames, declaredTokenNames, isColourSchemeInlineName, reservedNameReason } from './appThemeNames'
import { effective } from './engine'
import { lintAreaPack, type ThemeArea } from './index'
import { STUDIO_REGISTRY } from './registries/studio'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.resolve(ROOT, rel), 'utf8')
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const declaredIn = (css: string): string[] => [...stripComments(css).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])

/** The text of every `@theme` block of a stylesheet. */
function themeBlocks(css: string): string[] {
    const text = stripComments(css)
    const blocks: string[] = []
    const opener = /@theme\b[^{;]*\{/g
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
        let depth = 1
        let end = m.index + m[0].length
        while (end < text.length && depth > 0) {
            if (text[end] === '{') depth++
            else if (text[end] === '}') depth--
            end++
        }
        blocks.push(text.slice(m.index + m[0].length, end - 1))
    }
    return blocks
}
const asConstant = (names: ReadonlySet<string>): string => `[\n${[...names].sort().map((n) => `    '${n}',`).join('\n')}\n]`

/** `file` and every local stylesheet it imports (an `@import "./..."` line), recursively, as repository-relative paths. */
function localStylesheets(file: string, into: string[] = []): string[] {
    if (into.includes(file)) return into
    into.push(file)
    for (const m of stripComments(read(file)).matchAll(/@import\s+["'](\.[^"']+)["']/g)) localStylesheets(path.posix.join(path.posix.dirname(file), m[1]), into)
    return into
}
const appStylesheets = localStylesheets('src/styles.css')
const appTheme = new Set(appStylesheets.flatMap((file) => themeBlocks(read(file)).flatMap(declaredIn)))
const tailwindDefault = new Set(declaredIn(read('node_modules/tailwindcss/theme.css')))

const refused = (area: ThemeArea, css: string): boolean => !lintAreaPack(area, css, 'probe').ok
const reasons = (area: ThemeArea, css: string): string[] => lintAreaPack(area, css, 'probe').errors.map((e) => e.why)

describe('T0a-14: the reserved name lists equal the files they were generated from', () => {
    it('T equals the @theme names of styles.css and the stylesheets it imports (mismatch prints the constant)', () => {
        expect({ missing: [...appTheme].filter((n) => !APP_THEME_NAMES.has(n)), extra: [...APP_THEME_NAMES].filter((n) => !appTheme.has(n)) }, `APP_THEME_NAME_LIST (${appTheme.size}) =\n${asConstant(appTheme)}`).toEqual({ missing: [], extra: [] })
    })

    it('the stylesheet list is derived from the local imports of styles.css', () => {
        expect(appStylesheets[0]).toBe('src/styles.css')
        expect(appStylesheets).toEqual(expect.arrayContaining(['src/styles/nexus.css', 'src/styles/pattern-tokens.css']))
        expect(appStylesheets.every((file) => fs.existsSync(path.resolve(ROOT, file)))).toBe(true)
    })

    it('D equals the names of the installed tailwindcss/theme.css (mismatch prints the constant)', () => {
        expect({ missing: [...tailwindDefault].filter((n) => !TAILWIND_DEFAULT_NAMES.has(n)), extra: [...TAILWIND_DEFAULT_NAMES].filter((n) => !tailwindDefault.has(n)) }, `TAILWIND_DEFAULT_NAME_LIST (${tailwindDefault.size}) =\n${asConstant(tailwindDefault)}`).toEqual({ missing: [], extra: [] })
    })

    it('the lists hold the names the probes rely on', () => {
        for (const n of ['--color-textcolor', '--color-bgcolor', '--color-darkbg', '--color-nexus-canvas', '--color-nexus-text']) expect(APP_THEME_NAMES.has(n), n).toBe(true)
        for (const n of ['--font-weight-bold', '--color-red-500', '--color-gray-900', '--font-weight-medium']) expect(TAILWIND_DEFAULT_NAMES.has(n), n).toBe(true)
        expect(APP_THEME_NAMES.size).toBeGreaterThan(80)
        expect(TAILWIND_DEFAULT_NAMES.size).toBeGreaterThan(300)
    })

    it('I covers every name colorscheme.ts writes on the root, as a pack would spell it', () => {
        const written = [...read('src/ts/gui/colorscheme.ts').matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1])
        expect(written.length).toBeGreaterThan(15)
        for (const n of written) expect(isColourSchemeInlineName(n.toLowerCase()), n).toBe(true)
        expect(isColourSchemeInlineName('--color-textcolor')).toBe(false)
    })
})

describe('A_tok: the tokens a stylesheet of the area may declare', () => {
    for (const area of ['chat', 'studio'] as const) {
        it(`${area}: declared, pack-settable and not reserved`, () => {
            const allowed = allowedTokenNames(area)
            const declared = new Set(declaredTokenNames(area))
            const bounded = new Set(Object.keys(effective(area === 'studio' ? STUDIO_REGISTRY : undefined).minimums).concat(Object.keys(effective(area === 'studio' ? STUDIO_REGISTRY : undefined).maximums)))
            expect(allowed.size).toBeGreaterThan(150)
            for (const n of allowed) {
                expect(declared.has(n) || bounded.has(n), `${n} is declared by the area's token files or bounded by its registry`).toBe(true)
                expect(reservedNameReason(n), n).toBe('')
            }
        })
    }

    it('keeps the tokens the acceptance sheets set and drops the shared font weights', () => {
        expect(allowedTokenNames('chat').has('--nexus-text')).toBe(true)
        expect(allowedTokenNames('chat').has('--radius-bubble')).toBe(true)
        expect(allowedTokenNames('chat').has('--font-weight-bold')).toBe(false)
        expect([...allowedTokenNames('studio')].some((n) => n.startsWith('--studio-'))).toBe(true)
        // a name the registry bounds is settable even where no token stylesheet declares it
        expect(allowedTokenNames('studio').has('--studio-tab-size')).toBe(true)
    })
})

describe('R-e: a pack declares no app theme name', () => {
    // T0a-10: base observed ok:true for each of these (gate1, gate1-r2 probes).
    it.each([
        ['chat', ':root{--color-textcolor:#111111;--color-bgcolor:#111111}'],
        ['studio', ':root{--color-textcolor:#111111;--color-bgcolor:#111111}'],
        ['chat', ':root{--color-red-500:#ffffff;--color-gray-900:#ffffff}'],
        ['chat', ':root{--font-weight-bold:100}'],
        ['chat', ':root{--color-nexus-canvas:#ffffff;--color-nexus-text:#ffffff}'],
        ['studio', ':root{--color-nexus-canvas:#ffffff}'],
    ] as const)('%s refuses %s', (area, css) => {
        expect(refused(area, css)).toBe(true)
        expect(reasons(area, css).some((why) => /belongs to the app's Tailwind theme/.test(why))).toBe(true)
    })

    // T0a-11: a name in a Tailwind namespace that no list holds is not a token of the area either.
    it('refuses a made-up colour name and a name of another screen, and accepts --pack-* helpers', () => {
        expect(refused('chat', ':root{--color-madeup-x:#111111}')).toBe(true)
        expect(refused('chat', ':root{--settings-dialog-padding:4px}')).toBe(true)
        expect(refused('chat', ':root{--page-max-width:400px}')).toBe(true)
        expect(refused('chat', ':root{--home-gap:4px}')).toBe(true)
        expect(refused('chat', ':root{--pack-x:1px}')).toBe(false)
    })

    // T0a-6: the colour scheme's inline names (refused on the unchanged base as well, which this pins; the reserved-name reason itself is checked directly).
    it('refuses the colour scheme inline names', () => {
        for (const name of ['--risu-theme-bgcolor', '--fontcolorstandard', '--risu-font-family']) {
            expect(refused('chat', `:root{${name}:#000000}`), name).toBe(true)
            expect(refused('studio', `:root{${name}:#000000}`), name).toBe(true)
            expect(reservedNameReason(name), name).toMatch(/colour scheme on the document root/)
        }
    })

    it('accepts the tokens of the area, in both areas', () => {
        expect(refused('chat', ':root{--nexus-text:#f0f0f0}')).toBe(false)
        expect(refused('studio', ':root{--nexus-text:#f0f0f0}')).toBe(false)
    })
})
