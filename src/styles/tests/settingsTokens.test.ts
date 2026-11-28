import postcss from 'postcss'
import { describe, expect, test } from 'vitest'
import { readRepoFile as read } from './cascadeModel'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const APP_FILE = 'src/styles/settings-tokens.css'
const REGISTRY_FILE = 'docs/design/settings/theme-tokens.css'

const norm = (value: string) => value.replace(/\s+/g, ' ').trim()

function declarations(css: string, selector?: string): Map<string, string> {
    const result = new Map<string, string>()
    postcss.parse(css).walkRules((rule) => {
        if (rule.parent?.type !== 'root') return
        if (selector !== undefined && norm(rule.selector) !== selector) return
        rule.walkDecls((decl) => { if (decl.prop.startsWith('--') && !result.has(decl.prop)) result.set(decl.prop, norm(decl.value)) })
    })
    return result
}

const allNames = (css: string): string[] => {
    const names: string[] = []
    postcss.parse(css).walkDecls((decl) => { if (decl.prop.startsWith('--')) names.push(decl.prop) })
    return names
}

/** The registry's first `:root` value of each name, with `var(--x)` references to other registry names resolved to literals. */
function registryResolved(registry: Map<string, string>, name: string, seen: readonly string[] = []): string {
    const value = registry.get(name)!
    return value.replace(/var\((--[\w-]+)\)/g, (whole, ref: string) => {
        if (!registry.has(ref) || seen.includes(ref)) return whole
        return registryResolved(registry, ref, [...seen, name])
    })
}

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) {
            if (entry !== 'tests' && entry !== 'node_modules') sourceFiles(full, out)
        } else if (/\.(css|svelte|ts)$/.test(entry) && !/\.test\./.test(entry)) {
            out.push(full)
        }
    }
    return out
}

const appCss = read(APP_FILE)
const app = declarations(appCss, ':root, [data-own-scheme]')
const registry = declarations(read(REGISTRY_FILE), ':root')

describe('settings tokens file (S1, guard)', () => {
    test('the only rule is the :root and own-scheme island block, and it declares names', () => {
        const selectors: string[] = []
        postcss.parse(appCss).walkRules((rule) => { if (rule.parent?.type === 'root') selectors.push(norm(rule.selector)) })
        expect(selectors).toEqual([':root, [data-own-scheme]'])
        expect(app.size).toBeGreaterThan(0)
        expect(appCss).not.toContain('@media')
        expect(appCss).not.toContain('data-power')
        expect(appCss).not.toContain('color-scheme')
    })

    test('every name is a registry name and carries the registry value, resolved to a literal', () => {
        const wrong: string[] = []
        for (const [name, value] of app) {
            if (!registry.has(name)) wrong.push(`${name}: not in the registry`)
            else if (value !== registryResolved(registry, name)) wrong.push(`${name}: ${value} (registry ${registryResolved(registry, name)})`)
        }
        expect(wrong).toEqual([])
    })

    test('no custom property overlaps another src stylesheet', () => {
        const own = new Set(allNames(appCss))
        const others = sourceFiles('src').filter((file) => file.endsWith('.css') && path.relative('.', file).replace(/\\/g, '/') !== APP_FILE)
        expect(others.flatMap((file) => allNames(readFileSync(file, 'utf8'))).filter((name) => own.has(name))).toEqual([])
    })

    test('no colour, channel or alpha name, and no mention of the scheme role tokens', () => {
        expect([...app.keys()].filter((name) => /^--(color-|alpha-|opacity-|shadow-|selection-)|-rgb$|-color$/.test(name))).toEqual([])
        expect(appCss).not.toContain('--risu-theme-role-')
    })

    test('no size-property rule reads --ui-radius or --ui-border-width through this file', () => {
        expect(appCss).not.toContain('--ui-radius')
        expect(appCss).not.toContain('--ui-border-width')
    })

    test('SettingsShell imports it and styles.css does not', () => {
        expect(read('src/lib/SettingsShell/SettingsShell.svelte')).toContain("import '../../styles/settings-tokens.css'")
        expect(read('src/styles.css')).not.toContain('settings-tokens.css')
    })
})

describe('settings tokens are invisible (S2, guard)', () => {
    test('no source file outside tests reads a declared name', () => {
        const names = [...app.keys()]
        const readers: string[] = []
        for (const file of sourceFiles('src')) {
            if (path.relative('.', file).replace(/\\/g, '/') === APP_FILE) continue
            const text = readFileSync(file, 'utf8')
            for (const name of names) {
                if (new RegExp(`${name.replace(/-/g, '\\-')}(?![\\w-])`).test(text)) readers.push(`${file}: ${name}`)
            }
        }
        expect(readers).toEqual([])
    })
})
