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
import { readRepoFile as read } from './cascadeModel'

const FILE = 'src/styles/settings-roles.css'
// Roles declared by this PR; the next PR of stage S adds swatch-2 and danger-fill with their readers.
const ALIASES: Readonly<Record<string, string>> = {
    canvas: 'bgcolor', panel: 'darkbg', raised: 'darkbutton', selected: 'selected', hover: 'selected', focus: 'selected',
    'on-selected': 'textcolor', text: 'textcolor', 'text-2': 'textcolor2', swatch: 'textcolor',
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
        expect(rules).toEqual([':root, [data-own-scheme]'])
        expect(Object.fromEntries(decls)).toEqual(Object.fromEntries(Object.entries(ALIASES).map(([role, name]) => [`--settings-${role}`, `var(--risu-theme-${name})`])))
        expect(decls.map(([prop]) => prop)).not.toContain('color-scheme')
        for (const [, value] of decls) expect(value).not.toMatch(/-role-/)
    })

    test('T1: no role name is declared by another stylesheet of the app', () => {
        const others = readdirSync('src/styles').filter((f) => f.endsWith('.css') && f !== path.posix.basename(FILE))
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
})
