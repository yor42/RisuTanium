// @vitest-environment node
// Stage U (#654, MC-4702, H-7): Studio's colour roles. Studio re-points the Tailwind scheme names at --studio-* roles
// (studio-roles.css) on .studio-root, each role defaults to the scheme role it replaces, and nothing outside the Studio root
// changes. These rows fail when a scheme name is read inside Studio with no role behind it (a colour variant nothing reads),
// when a role default drifts from the scheme or the remap leaks (a visible change with no pack), when the root loses its
// class or the file its import (Studio unreadable under a later base), or when a role stops being pack-settable.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { judgeAreaSheet } from './index'
import { COLOUR_READY_AREAS } from './colourReady'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')
const posix = (file: string): string => path.relative(root, file).split(path.sep).join('/')

/** Tailwind scheme name and the Studio role that replaces it inside Studio. */
const ROLES = [
    { scheme: 'textcolor', role: '--studio-fg' },
    { scheme: 'textcolor2', role: '--studio-fg-2' },
    { scheme: 'bgcolor', role: '--studio-canvas' },
    { scheme: 'darkbg', role: '--studio-surface' },
    { scheme: 'darkbutton', role: '--studio-surface-raised' },
    { scheme: 'selected', role: '--studio-selected' },
    { scheme: 'borderc', role: '--studio-edge' },
    { scheme: 'darkborderc', role: '--studio-edge-strong' },
    { scheme: 'draculared', role: '--studio-danger' },
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

const rolesCss = read('src/styles/studio-roles.css')
const screen = read('src/lib/Studio/StudioScreen.svelte')

describe('H-7.1 role tokens', () => {
    const app = declarations(rolesCss, ':where(:root, [data-own-scheme])')

    it('declares exactly the nine roles, each the plain scheme role its Tailwind name read, with no derived name', () => {
        expect([...app.keys()].sort()).toEqual(ROLES.map((r) => r.role).sort())
        for (const { scheme, role } of ROLES) expect(app.get(role), role).toBe(`var(--risu-theme-${scheme})`)
        expect(rolesCss).not.toMatch(/-role-|color-scheme/)
    })

    it('re-points exactly the nine scheme names at their roles, on the Studio root only', () => {
        const map = declarations(rolesCss, '.studio-root')
        const expected = ROLES.map(({ scheme, role }) => [`--color-${scheme}`, `var(${role})`])
        expect([...map.entries()].sort()).toEqual(expected.sort())
        const selectors = [...rolesCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1].replace(/\s+/g, ' ').trim())
        expect(selectors).toEqual([':where(:root, [data-own-scheme])', '.studio-root'])
    })

    it('src/styles.css maps each scheme name to its scheme role, so the remap is the identity with no pack', () => {
        const theme = read('src/styles.css')
        for (const { scheme } of ROLES) expect(theme, scheme).toMatch(new RegExp(`--color-${scheme}:\\s*var\\(--risu-theme-${scheme}\\)`))
    })

    it('no other stylesheet or source declares a role', () => {
        const names = ROLES.map((r) => r.role.slice(2)).sort((a, b) => b.length - a.length).join('|')
        const decl = new RegExp(`(?<![\\w-])--(${names})\\s*:`)
        const stack = [path.join(root, 'src')]
        const offenders: string[] = []
        while (stack.length > 0) {
            const dir = stack.pop() as string
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) { if (entry.name !== 'node_modules') stack.push(full); continue }
                if (!/\.(css|svelte|ts)$/.test(entry.name) || /\.test\.|studio-roles\.css$|studio-pack-base\.css$/.test(entry.name)) continue
                if (decl.test(readFileSync(full, 'utf8'))) offenders.push(posix(full))
            }
        }
        expect(offenders).toEqual([])
    })
})

describe('H-7.2 every scheme name Studio reads has a role behind it', () => {
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
        const stack = [path.join(root, 'src/lib/Studio/StudioScreen.svelte')]
        while (stack.length > 0) {
            const file = stack.pop() as string
            if (seen.has(file)) continue
            // an unresolved import would silently shrink the closure
            if (existsSync(`${file}.ts`)) continue // a .svelte.ts rune module, not markup
            if (!existsSync(file)) throw new Error('unresolved import in the Studio closure: ' + posix(file))
            seen.add(file)
            stack.push(...importsOf(file))
        }
        return [...seen].filter((file) => !testFile.test(posix(file)))
    })()
    const names = ROLES.map((r) => r.scheme).sort((a, b) => b.length - a.length).join('|')
    const utility = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*-?(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|caret|shadow|decoration)-(${names})(?![\\w-])`, 'g')
    const varRead = /var\(--color-([a-z0-9-]+)\)/g

    it('the closure is the Studio components plus the shared controls they render', () => {
        const rel = closure.map(posix)
        for (const f of ['src/lib/Studio/StudioDetail.svelte', 'src/lib/Studio/StudioRiskyConfirm.svelte', 'src/lib/Studio/StudioRestoreSheet.svelte', 'src/lib/Studio/StudioPresetListSheet.svelte',
            'src/lib/UI/Windowed/WindowedSegment.svelte', 'src/lib/UI/GUI/NumberInput.svelte', 'src/lib/Setting/PresetLockSwitch.svelte', 'src/lib/Setting/Pages/Model/ModelDataRefresh.svelte']) expect(rel, f).toContain(f)
    })

    it('every scheme name read in the closure is one the remap covers, each role is read, and no file reads a --risu-theme-* value directly', () => {
        const covered = new Set<string>(ROLES.map((r) => r.scheme))
        const used = new Set<string>()
        const direct: string[] = []
        for (const file of closure) {
            const text = readFileSync(file, 'utf8')
            for (const m of text.matchAll(utility)) used.add(m[1])
            for (const m of text.matchAll(varRead)) if (/^(?:textcolor2?|bgcolor|darkbg|darkbutton|selected|borderc|darkborderc|draculared)$/.test(m[1])) used.add(m[1])
            if (/var\(--risu-theme-/.test(text)) direct.push(posix(file))
        }
        expect([...used].filter((n) => !covered.has(n))).toEqual([])
        expect([...covered].filter((n) => !used.has(n)), 'a role nothing reads').toEqual([])
        expect(direct).toEqual([])
    })

    it('Studio does not move painted content out of its root', () => {
        const portals = closure.map(posix).filter((f) => f.startsWith('src/lib/Studio/') && /document\.body\.(?:append|appendChild|prepend)\(|use:portal|\{@attach portal/.test(read(f)))
        // MacroPicker appends an invisible measuring mirror (no painted colour) and nothing else
        expect(portals).toEqual(['src/lib/Studio/MacroPicker.svelte'])
        expect(read('src/lib/Studio/MacroPicker.svelte')).toMatch(/mirror\.style\.cssText|mirror\.style/)
    })
})

describe('H-7.3 wiring', () => {
    it('the Studio root carries the class and the screen imports the roles after the token file', () => {
        expect(screen).toMatch(/<div bind:this=\{root\} data-part="studio"[^>]*class="studio-root /)
        const order = ['studio-tokens.css', 'studio-roles.css'].map((f) => screen.indexOf(`styles/${f}`))
        expect(order.every((i) => i > 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

    it('stays inert while Studio is not colour-ready (MC-4707)', () => {
        expect(COLOUR_READY_AREAS.has('studio')).toBe(false)
    })

    it('T7: every role is pack-settable, the base is imported after the roles, and an unlisted studio name is still refused', () => {
        for (const { role } of ROLES) expect(judgeAreaSheet('studio', `:root { ${role}: #ffffff; }`).result.ok, role).toBe(true)
        expect(judgeAreaSheet('studio', ':root { --studio-bogus-name: #ffffff; }').result.ok).toBe(false)
        const order = ['studio-tokens.css', 'studio-roles.css', 'studio-pack-base.css'].map((f) => screen.indexOf(`styles/${f}`))
        expect(order.every((i) => i > 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

    it('T10s: text equal to a fill it sits on, and a translucent fill, are notes on the role', () => {
        const same = judgeAreaSheet('studio', ':root { --studio-fg: #44475a; --studio-selected: #44475a; }')
        expect(same.result.ok).toBe(true)
        expect(same.result.notes?.some((n) => n.rule === 'contrast')).toBe(true)
        for (const bg of ['canvas', 'surface', 'surface-raised', 'selected']) {
            const v = judgeAreaSheet('studio', `:root { --studio-fg: #f8f8f2; --studio-${bg}: #f8f8f2; }`)
            expect(v.result.notes?.some((n) => n.rule === 'contrast' && n.prop === '--studio-fg' && n.why.includes(`the ${bg} role`)), `fg on ${bg}`).toBe(true)
        }
        for (const bg of ['canvas', 'surface']) {
            const v = judgeAreaSheet('studio', `:root { --studio-danger: #ff5555; --studio-${bg}: #ff5555; }`)
            expect(v.result.notes?.some((n) => n.rule === 'contrast' && n.prop === '--studio-danger' && n.why.includes(`the ${bg} role`)), `danger on ${bg}`).toBe(true)
        }
        for (const bg of ['canvas', 'surface', 'surface-raised', 'selected']) {
            const v = judgeAreaSheet('studio', `:root { --studio-${bg}: rgb(0 0 0 / 0.4); }`)
            expect([...(v.result.notes ?? []), ...v.result.errors].some((n) => n.prop === `--studio-${bg}`), bg).toBe(true)
        }
    })

    it('the base declares exactly the nine roles under the area-qualified selector and pins the reference scheme', () => {
        const base = declarations(read('src/styles/studio-pack-base.css'), ':root:where([data-theme-pack-base][data-theme-pack-area="studio"])')
        expect([...base.keys()].sort()).toEqual(ROLES.map((r) => r.role).sort())
        const docs = declarations(read('docs/design/studio/studio-tokens.css'), ':root')
        for (const { scheme, role } of ROLES) {
            expect(docs.get(role), role).toBe(`var(--risu-theme-${scheme})`)
            if (role !== '--studio-fg-2') expect(base.get(role), role).toBe(docs.get(`--risu-theme-${scheme}`))
        }
    })
})

describe('dual-use components resolve to the scheme outside the Studio root', () => {
    it('the shared controls Studio renders read the app names (var(--color-*)), never a scheme value directly, so the remap reaches them and equals the scheme elsewhere', () => {
        for (const f of ['src/lib/UI/GUI/SegmentedControl.svelte', 'src/lib/UI/GUI/SliderInput.svelte']) expect(read(f), f).not.toContain('--risu-theme-')
    })

    it('StudioToggleLink and StudioEntryRow are rendered only outside Studio, and the class sits on exactly one element of the app', () => {
        const holders: string[] = []
        const importers: string[] = []
        const stack = [path.join(root, 'src')]
        while (stack.length > 0) {
            const dir = stack.pop() as string
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name)
                if (entry.isDirectory()) { if (entry.name !== 'node_modules') stack.push(full); continue }
                if (!entry.name.endsWith('.svelte') || /\.test\./.test(entry.name)) continue
                const text = readFileSync(full, 'utf8')
                if (/class="[^"]*\bstudio-root\b/.test(text)) holders.push(posix(full))
                if (posix(full).startsWith('src/lib/Studio/') && /Studio(ToggleLink|EntryRow)\.svelte/.test(text) && !/Studio(ToggleLink|EntryRow)\.svelte$/.test(posix(full))) importers.push(posix(full))
            }
        }
        expect(holders).toEqual(['src/lib/Studio/StudioScreen.svelte'])
        expect(importers).toEqual([])
    })
})
