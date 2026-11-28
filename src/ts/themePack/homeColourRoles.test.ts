// @vitest-environment node
// Stage H (#654, MC-4702, H-7): Home's colour roles. The landing re-points the Tailwind scheme names at --home-* roles
// (home-roles.css), each role defaults to the scheme role it replaces (home-roles.css), the pack base pins them
// (home-pack-base.css), and a pack that sets them is judged. These rows fail when a scheme name is read inside Home with no
// role behind it (a colour variant nothing reads), when a role default drifts from the scheme (a visible change with no pack),
// or when the base, its selector or its import order changes.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { judgeAreaSheet } from './index'
import { COLOUR_READY_AREAS } from './colourReady'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')

/** Tailwind scheme name and the Home role that replaces it inside the landing. */
const ROLES = [
    { scheme: 'textcolor', role: '--home-fg' },
    { scheme: 'textcolor2', role: '--home-fg-2' },
    { scheme: 'bgcolor', role: '--home-canvas' },
    { scheme: 'darkbg', role: '--home-surface' },
    { scheme: 'darkbutton', role: '--home-surface-raised' },
    { scheme: 'selected', role: '--home-selected' },
    { scheme: 'borderc', role: '--home-edge' },
    { scheme: 'darkborderc', role: '--home-edge-strong' },
    { scheme: 'draculared', role: '--home-danger' },
] as const

/** Custom-property declarations of the first rule whose selector equals `selector`, comments and whitespace normalised. */
function declarations(css: string, selector: string): Map<string, string> {
    const out = new Map<string, string>()
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1].replace(/\s+/g, ' ').trim() === selector)
    if (!rule) return out
    for (const d of rule[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim())
    return out
}

const registryTokens = read('docs/design/home/home-tokens.css')
const rolesCss = read('src/styles/home-roles.css')
const baseCss = read('src/styles/home-pack-base.css')
const BASE_SELECTOR = ':root:where([data-theme-pack-base][data-theme-pack-area="home"])'

describe('H-7.1 role tokens', () => {
    const app = declarations(rolesCss, ':root, [data-own-scheme]')
    const registry = declarations(registryTokens, ':root')

    it('each role aliases the scheme role its Tailwind name read, in the app and in the registry', () => {
        for (const { scheme, role } of ROLES) {
            expect(app.get(role), role).toBe(`var(--risu-theme-${scheme})`)
            expect(registry.get(role), role).toBe(`var(--risu-theme-${scheme})`)
        }
    })

    it('home-roles.css re-points exactly the nine scheme names at their roles, on the landing root only', () => {
        const map = declarations(rolesCss, '.home-root')
        const expected = ROLES.map(({ scheme, role }) => [`--color-${scheme}`, `var(${role})`])
        expect([...map.entries()].sort()).toEqual(expected.sort())
    })

    it('src/styles.css maps each scheme name to its scheme role, so the remap is the identity with no pack', () => {
        const theme = read('src/styles.css')
        for (const { scheme } of ROLES) expect(theme, scheme).toMatch(new RegExp(`--color-${scheme}:\\s*var\\(--risu-theme-${scheme}\\)`))
    })
})

describe('H-7.2 every scheme name the landing reads has a role behind it', () => {
    const testFile = /\.test\.|Harness|Stub|testHost|\/tests\//
    const importsOf = (file: string): string[] => {
        const found: string[] = []
        for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()\s*['"]([^'"]+\.svelte)['"]/g)) {
            if (m[1].startsWith('.')) found.push(path.resolve(path.dirname(file), m[1]))
            else if (m[1].startsWith('src/')) found.push(path.resolve(root, m[1]))
        }
        return found
    }
    const closure = (() => {
        const seen = new Set<string>()
        const stack = [path.join(root, 'src/lib/UI/Home/HomeShell.svelte')]
        while (stack.length > 0) {
            const file = stack.pop() as string
            if (seen.has(file) || !existsSync(file)) continue
            seen.add(file)
            stack.push(...importsOf(file))
        }
        return [...seen].filter((file) => !testFile.test(file.split(path.sep).join('/')))
    })()
    const names = ROLES.map((r) => r.scheme).sort((a, b) => b.length - a.length).join('|')
    const utility = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*-?(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|caret|shadow|decoration)-(${names})(?![\\w-])`, 'g')
    const varRead = new RegExp(`var\\(--color-(${names})\\)`, 'g')

    it('the closure is the Home components plus the shared catalog and Realm panel', () => {
        const rel = closure.map((f) => path.relative(root, f).split(path.sep).join('/'))
        expect(rel).toContain('src/lib/UI/Home/HomeDrawer.svelte')
        expect(rel).toContain('src/lib/Others/GridCatalog.svelte')
        expect(rel).toContain('src/lib/UI/Realm/RealmPanel.svelte')
    })

    it('every scheme name used in a utility or var() is one the remap covers, and no closure file reads a --risu-theme-* value directly', () => {
        const covered = new Set<string>(ROLES.map((r) => r.scheme))
        const used = new Set<string>()
        const direct: string[] = []
        for (const file of closure) {
            const text = readFileSync(file, 'utf8')
            for (const m of text.matchAll(utility)) used.add(m[1])
            for (const m of text.matchAll(varRead)) used.add(m[1])
            for (const m of text.matchAll(/var\(--color-([a-z0-9-]+)\)/g)) if (/^(?:textcolor|bgcolor|darkbg|darkbutton|selected|borderc|darkborderc|draculared|textcolor2)$/.test(m[1]) === false && !/^(?:primary|secondary|neutral|danger|success|nexus|surface|accent|warning|placeholder|scheme|hit|scope|skeleton|on|alpha)/.test(m[1])) used.add(m[1])
            if (/var\(--risu-theme-/.test(text)) direct.push(path.relative(root, file))
        }
        expect([...used].filter((n) => !covered.has(n))).toEqual([])
        expect(used.size, 'the scan finds scheme utilities').toBeGreaterThan(5)
        expect(direct).toEqual([])
    })
})

describe('H-7.3 base block', () => {
    it('is area-qualified, declares exactly the nine roles, and pins the registry reference scheme', () => {
        const base = declarations(baseCss, BASE_SELECTOR)
        expect([...base.keys()].sort()).toEqual(ROLES.map((r) => r.role).sort())
        const scheme = declarations(registryTokens, ':root')
        for (const { scheme: name, role } of ROLES) {
            if (role === '--home-fg-2') continue
            expect(base.get(role), role).toBe(scheme.get(`--risu-theme-${name}`))
        }
    })

    it('--home-fg-2 is lifted to at least 4.5:1 on every surface role of the base, and the base repaints the body canvas', () => {
        const base = declarations(baseCss, BASE_SELECTOR)
        const lum = (hex: string): number => {
            const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
            return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        }
        const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)
        for (const bg of ['--home-canvas', '--home-surface', '--home-surface-raised', '--home-selected']) {
            expect(ratio(base.get('--home-fg-2') as string, base.get(bg) as string), bg).toBeGreaterThanOrEqual(4.5)
            expect(ratio(base.get('--home-fg') as string, base.get(bg) as string), bg).toBeGreaterThanOrEqual(4.5)
        }
        expect(declarations(baseCss, `${BASE_SELECTOR} body`).size).toBe(0)
        expect(baseCss).toMatch(/:where\(\[data-theme-pack-base\]\[data-theme-pack-area="home"\]\) body \{\s*background-color: var\(--home-canvas\);/)
    })

    it('HomeShell imports the tokens, then the role defaults, then the base (same specificity: the later file wins, so the base must come last)', () => {
        const shell = read('src/lib/UI/Home/HomeShell.svelte')
        const order = ['home-tokens.css', 'home-roles.css', 'home-pack-base.css'].map((f) => shell.indexOf(`styles/${f}`))
        expect(order.every((i) => i > 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

    it('stays inert while Home is not colour-ready (MC-4707)', () => {
        expect(COLOUR_READY_AREAS.has('home')).toBe(false)
    })
})

describe('judge: the Home roles are settable and the primary text is paired', () => {
    const sheet = (decls: string): string => `:root { ${decls} }`

    it('accepts the reference values', () => {
        expect(judgeAreaSheet('home', sheet('--home-fg: #f8f8f2; --home-surface: #21222c; --home-canvas: #282a36;')).result.ok).toBe(true)
    })

    it('notes primary text that cannot be read on a surface it sits on (a contrast note, MC-3421)', () => {
        for (const bg of ['--home-canvas', '--home-surface', '--home-surface-raised', '--home-selected']) {
            const verdict = judgeAreaSheet('home', sheet(`--home-fg: #f8f8f2; ${bg}: #f8f8f2;`))
            expect(verdict.result.notes?.some((n) => n.rule === 'contrast' && n.why.includes(bg)), bg).toBe(true)
        }
    })

    it('a Home role that is not listed stays refused', () => {
        expect(judgeAreaSheet('home', sheet('--home-bogus-colour: #fff;')).result.ok).toBe(false)
    })
})
