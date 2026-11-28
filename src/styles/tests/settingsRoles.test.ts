// @vitest-environment node
/**
 * Stage S (#654, H-7.1): src/styles/settings-roles.css holds the Settings colour roles. T1 pins the drift against the scheme
 * (each role is exactly var(--risu-theme-<name>) in the one root-and-island block, no derived name, no shared name), T7 keeps
 * the declared set and the set the shell reads equal, and the shell imports the file.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { describe, expect, test } from 'vitest'
import { COLOUR_READY_AREAS } from '../../ts/themePack/colourReady'
import { judgeAreaSheet } from '../../ts/themePack/index'
import { readRepoFile as read } from './cascadeModel'

const FILE = 'src/styles/settings-roles.css'
const BASE_FILE = 'src/styles/settings-pack-base.css'
// Every role the Settings shell reads.
const ALIASES: Readonly<Record<string, string>> = {
    canvas: 'bgcolor', panel: 'darkbg', raised: 'darkbutton', selected: 'selected', hover: 'selected', focus: 'selected',
    'on-selected': 'textcolor', text: 'textcolor', 'text-2': 'textcolor2', swatch: 'textcolor', 'swatch-2': 'textcolor2', 'danger-fill': 'draculared',
    'border-strong': 'borderc', 'border-subtle': 'darkborderc', danger: 'draculared',
}

function shellSources(dir = 'src/lib/SettingsShell', out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.posix.join(dir, entry)
        if (statSync(full).isDirectory()) shellSources(full, out)
        else if (full.endsWith('.svelte') && !full.includes('.test.')) out.push(full)
    }
    return out
}

describe('settings-roles.css (H-7.1)', () => {
    const root = postcss.parse(read(FILE))
    const decls: [string, string][] = []
    root.walkDecls((d) => { decls.push([d.prop, d.value.trim()]) })

    test('T1: one :root and island block holding only the roles, each the plain scheme name it aliases', () => {
        const rules: string[] = []
        root.walkRules((r) => { rules.push(r.selector.replace(/\s+/g, ' ')) })
        expect(rules).toEqual([':where(:root, [data-own-scheme])'])
        expect(Object.fromEntries(decls)).toEqual(Object.fromEntries(Object.entries(ALIASES).map(([role, name]) => [`--settings-${role}`, `var(--risu-theme-${name})`])))
        expect(decls.map(([prop]) => prop)).not.toContain('color-scheme')
        for (const [, value] of decls) expect(value).not.toMatch(/-role-/)
    })

    test('T1: no role name is declared by another stylesheet of the app', () => {
        // the pack base re-declares each role on purpose: it is the one other stylesheet that may
        const others = readdirSync('src/styles').filter((f) => f.endsWith('.css') && f !== path.posix.basename(FILE) && f !== path.posix.basename(BASE_FILE))
        for (const file of [...others.map((f) => `src/styles/${f}`), 'src/styles.css']) {
            expect(read(file), file).not.toMatch(new RegExp(`--settings-(${Object.keys(ALIASES).join('|')})\\s*:`))
        }
    })

    test('T7: every declared role is read by the shell and every role the shell reads is declared', () => {
        const read2 = shellSources().map((f) => readFileSync(f, 'utf8')).join('\n')
        const used = new Set([...read2.matchAll(/\(--settings-([a-z0-9-]+)\)/g)].map((m) => m[1]))
        for (const role of Object.keys(ALIASES)) expect(used.has(role), role).toBe(true)
        for (const role of used) expect(role in ALIASES, role).toBe(true)
    })

    test('the shell imports the roles file beside its token file', () => {
        expect(read('src/lib/SettingsShell/SettingsShell.svelte')).toContain("import '../../styles/settings-roles.css'")
    })

    test('a shell component that the classic pages, the sidebars or the Playground render imports the roles itself', () => {
        // The roles must not depend on SettingsShell.svelte staying statically imported: these files are mounted by hosts outside the shell.
        expect(read('src/lib/SettingsShell/ConnectionsShellPage.svelte')).toContain("import '../../styles/settings-roles.css'")
        for (const f of ['connections/MaskedKeyField', 'connections/SlotKeyField', 'connections/ConnectionsLink', 'connections/ServiceConnectionRow', 'connections/SlotKeyRow', 'display/UiSoundsRow']) {
            expect(read(`src/lib/SettingsShell/${f}.svelte`), f).toContain("import '../../../styles/settings-roles.css'")
        }
    })
})

/** Custom-property declarations of the first top-level rule whose selector equals `selector`, whitespace normalised. */
function ruleDeclarations(css: string, selector: string): Map<string, string> {
    const out = new Map<string, string>()
    for (const node of postcss.parse(css).nodes) {
        if (node.type !== 'rule' || node.selector.replace(/\s+/g, ' ').trim() !== selector) continue
        node.walkDecls((d) => { if (d.prop.startsWith('--') && !out.has(d.prop)) out.set(d.prop, d.value.replace(/\s+/g, ' ').trim()) })
        break
    }
    return out
}

const luminance = (hex: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)

describe('settings-pack-base.css (H-7.3)', () => {
    const SELECTOR = ':root:where([data-theme-pack-base][data-theme-pack-area="settings"])'
    const baseCss = read(BASE_FILE)
    const base = ruleDeclarations(baseCss, SELECTOR)
    const registry = ruleDeclarations(read('docs/design/settings/theme-tokens.css'), ':root')

    test('the docs token file declares every role as the plain scheme alias, beside the reference scheme', () => {
        for (const [role, name] of Object.entries(ALIASES)) expect(registry.get(`--settings-${role}`), role).toBe(`var(--risu-theme-${name})`)
        for (const name of new Set(Object.values(ALIASES))) expect(registry.get(`--risu-theme-${name}`), name).toMatch(/^#[0-9a-f]{6}$/)
    })

    test('the base is area-qualified, declares exactly the roles, and pins the reference scheme (text-2 aside)', () => {
        expect([...base.keys()].sort()).toEqual(Object.keys(ALIASES).map((role) => `--settings-${role}`).sort())
        for (const [role, name] of Object.entries(ALIASES)) {
            if (role === 'text-2') continue
            expect(base.get(`--settings-${role}`), role).toBe(registry.get(`--risu-theme-${name}`))
        }
    })

    test('--settings-text-2 is lifted to 4.5:1 on every surface role of the base (it carries no pair), and the text roles reach 4.5:1 too', () => {
        for (const bg of ['canvas', 'panel', 'raised', 'selected', 'hover']) {
            expect(ratio(base.get('--settings-text-2') as string, base.get(`--settings-${bg}`) as string), bg).toBeGreaterThanOrEqual(4.5)
            expect(ratio(base.get('--settings-text') as string, base.get(`--settings-${bg}`) as string), bg).toBeGreaterThanOrEqual(4.5)
        }
        expect(ratio(base.get('--settings-on-selected') as string, base.get('--settings-selected') as string)).toBeGreaterThanOrEqual(4.5)
        for (const bg of ['canvas', 'panel']) expect(ratio(base.get('--settings-danger') as string, base.get(`--settings-${bg}`) as string), bg).toBeGreaterThanOrEqual(4.5)
    })

    test('the base is judged ok with no note, so a pack that leaves a role unset gets a judged value', () => {
        const sheet = `:root { ${[...base].map(([name, value]) => `${name}: ${value};`).join(' ')} }`
        const verdict = judgeAreaSheet('settings', sheet)
        expect(verdict.result.errors).toEqual([])
        expect(verdict.result.ok).toBe(true)
        expect(verdict.result.notes).toBeUndefined()
    })

    test('SettingsShell imports the tokens, then the role defaults, then the base last', () => {
        const shell = read('src/lib/SettingsShell/SettingsShell.svelte')
        const order = ['settings-tokens.css', 'settings-roles.css', 'settings-pack-base.css'].map((f) => shell.indexOf(`styles/${f}`))
        expect(order.every((i) => i > 0)).toBe(true)
        expect([...order].sort((a, b) => a - b)).toEqual(order)
    })

    test('stays inert while Settings is not colour-ready (MC-4707)', () => {
        expect([...COLOUR_READY_AREAS]).toEqual(['chat'])
    })
})

describe('judge: the Settings roles are settable and paired', () => {
    const sheet = (decls: string): string => `:root { ${decls} }`

    test('T6: a sheet that sets the text and panel roles is accepted (the roles are declared by the docs token file)', () => {
        const verdict = judgeAreaSheet('settings', sheet('--settings-text: #f8f8f2; --settings-panel: #21222c;'))
        expect(verdict.result.errors).toEqual([])
        expect(verdict.result.ok).toBe(true)
    })

    test('every role is accepted on its own, and an unlisted settings name is still refused', () => {
        for (const role of Object.keys(ALIASES)) expect(judgeAreaSheet('settings', sheet(`--settings-${role}: #f8f8f2;`)).result.ok, role).toBe(true)
        expect(judgeAreaSheet('settings', sheet('--settings-bogus-name: #fff;')).result.ok).toBe(false)
    })

    test('T10s: on-selected equal to the selected fill is a contrast note on the foreground role (a note, not a refusal)', () => {
        const verdict = judgeAreaSheet('settings', sheet('--settings-on-selected: #44475a;'))
        expect(verdict.result.ok).toBe(true)
        expect(verdict.result.notes?.some((n) => n.prop === '--settings-on-selected' && n.rule === 'contrast')).toBe(true)
    })

    test('primary text that cannot be read on a fill it sits on is a contrast note, for every fill of the pair list', () => {
        for (const bg of ['canvas', 'panel', 'raised', 'hover']) {
            const verdict = judgeAreaSheet('settings', sheet(`--settings-text: #f8f8f2; --settings-${bg}: #f8f8f2;`))
            expect(verdict.result.notes?.some((n) => n.rule === 'contrast' && n.why.includes(`the ${bg} role`)), bg).toBe(true)
        }
        // the focus role is a ring or outline colour, never a fill under text: no text pair judges it
        const ring = judgeAreaSheet('settings', sheet('--settings-text: #f8f8f2; --settings-focus: #f8f8f2;'))
        expect(ring.result.ok).toBe(true)
        expect(ring.result.notes?.some((n) => n.why.includes('the focus role'))).toBeFalsy()
        for (const bg of ['canvas', 'panel']) {
            const verdict = judgeAreaSheet('settings', sheet(`--settings-danger: #ff5555; --settings-${bg}: #ff5555;`))
            expect(verdict.result.notes?.some((n) => n.rule === 'contrast' && n.why.includes(`the ${bg} role`)), bg).toBe(true)
        }
    })

    test('a role fill must be opaque: a translucent canvas, panel, raised or selected fill is flagged', () => {
        for (const bg of ['canvas', 'panel', 'raised', 'selected']) {
            const verdict = judgeAreaSheet('settings', sheet(`--settings-${bg}: rgb(0 0 0 / 0.4);`))
            expect([...(verdict.result.notes ?? []), ...verdict.result.errors].some((n) => n.prop === `--settings-${bg}`), bg).toBe(true)
        }
    })
})

describe('the selected fill carries the on-selected text role (A5)', () => {
    // A static or conditional fill on the selected role must name the text role in the same element, unless it draws no text (a toggle
    // track, a dot, a swatch or a marker). The pinned counts name those fill-only elements per file, so a new one is reviewed.
    const NO_TEXT: Readonly<Record<string, number>> = {
        'ModeVisibilityGroup.svelte': 1, 'ShellSettingRow.svelte': 1, 'display/ThemeCards.svelte': 3, 'input/NewMessageButtonRow.svelte': 1, 'plugins/PluginRow.svelte': 1,
    }
    const tagAround = (text: string, at: number): string => {
        let depth = 0
        let end = at
        for (; end < text.length; end++) {
            if (text[end] === '{') depth++
            else if (text[end] === '}') depth--
            else if (text[end] === '>' && depth <= 0) break
        }
        return text.slice(text.lastIndexOf('<', at), end + 1)
    }

    test('T11: every element filled with the selected role names text-(--settings-on-selected), or is a pinned fill-only element', () => {
        const withoutText: Record<string, number> = {}
        let fills = 0
        for (const file of shellSources()) {
            const text = readFileSync(file, 'utf8')
            for (const m of text.matchAll(/bg-\(--settings-selected\)/g)) {
                fills++
                if (tagAround(text, m.index as number).includes('text-(--settings-on-selected)')) continue
                const key = file.slice('src/lib/SettingsShell/'.length)
                withoutText[key] = (withoutText[key] ?? 0) + 1
            }
        }
        expect(fills, 'the scan finds the fills').toBeGreaterThanOrEqual(13)
        expect(withoutText).toEqual(NO_TEXT)
    })
})
