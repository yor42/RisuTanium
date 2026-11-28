// @vitest-environment node
/**
 * Stage S (#654, H-7.1/H-7.2): the Settings shell markup reads the `--settings-*` colour roles instead of scheme classes.
 * T4 pins the forward mapping (a class, its variant and the role it must read) against the census of the unmigrated tree,
 * T6 is the H-7.2 scan (a scheme class left outside the pending list, or a scheme re-declaration on a shell element), and
 * T3 keeps the order of co-applied utilities of one property: Tailwind sorts a candidate group by name, so a rename can flip
 * which class wins.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'svelte/compiler'
import { describe, expect, test } from 'vitest'
import census from './fixtures/schemeClassCensus.base.json'

const ROOT = 'src/lib/SettingsShell'
// Files that still carry scheme classes because a later PR of stage S migrates them. Empty when the stage is complete.
const PENDING: readonly string[] = [
    'PersonasShellPage', 'persona/', 'connections/', 'ConnectionsShellPage', 'PluginsShellPage', 'plugins/',
].map((p) => `${ROOT}/${p}`)
const pending = (file: string): boolean => PENDING.some((p) => file.startsWith(p))

const SCHEME = /(?<![\w-])((?:[\w[\]:&>*=.-]*:)?)(bg|text|border|ring|outline)-(bgcolor|darkbg|textcolor2|textcolor|borderc|darkborderc|darkbutton|selected|draculared)(\/\d+)?(?![\w-])/g
const ROLE = /(?<![\w-])(bg|text|border|ring|outline)-\(--settings-([a-z0-9-]+)\)(\/\d+)?/g

/** The variant prefix written before a match (`hover:`, `class:`, ...), read back to the previous delimiter. */
function prefixAt(source: string, index: number): string {
    let i = index
    while (i > 0 && !/[\s"'`{}()]/.test(source[i - 1])) i--
    return source.slice(i, index)
}

/** The independent forward table: which role a scheme class must read, by property, scheme name and variant. */
function expectedRole(pre: string, kind: string, name: string): string {
    const press = /(^|:)(hover|active):/.test(pre)
    const table: Record<string, string> = {
        'bg-bgcolor': 'canvas', 'bg-darkbg': 'panel', 'bg-darkbutton': 'raised', 'bg-selected': press ? 'hover' : 'selected',
        'bg-textcolor': 'swatch', 'bg-textcolor2': 'swatch-2', 'bg-draculared': 'danger-fill',
        'text-textcolor': 'text', 'text-textcolor2': 'text-2', 'text-draculared': 'danger',
        'border-borderc': 'border-strong', 'border-darkborderc': 'border-subtle', 'border-draculared': 'danger',
        'ring-selected': 'focus', 'outline-selected': 'focus',
    }
    const role = table[`${kind}-${name}`]
    if (!role) throw new Error(`no role for ${pre}${kind}-${name}`)
    return role
}
// The text drawn on a selected fill reads its own role; these are the only elements that do (class: directives beside class:bg-selected).
const ON_SELECTED: Readonly<Record<string, number>> = {
    [`${ROOT}/SettingsShellIndex.svelte`]: 2,
    [`${ROOT}/SettingsShellPage.svelte`]: 1,
}

function shellFiles(dir = ROOT, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = path.posix.join(dir, entry)
        if (statSync(full).isDirectory()) shellFiles(full, out)
        else if (full.endsWith('.svelte') && !full.includes('.test.')) out.push(full)
    }
    return out
}
const read = (file: string): string => readFileSync(file, 'utf8')
const base = census as Record<string, string[]>

describe('Settings shell scheme-class census (H-7.2)', () => {
    test('T6: a scheme class survives only in the pending files, and every pending file keeps its base list', () => {
        for (const file of shellFiles()) {
            const left = read(file).match(new RegExp(SCHEME.source, 'g')) ?? []
            if (pending(file)) expect(left.length, file).toBe((base[file] ?? []).length)
            else expect(left, file).toEqual([])
        }
    })

    test('T6: no shell element re-declares a scheme name or opens an island', () => {
        for (const file of shellFiles()) {
            expect(read(file), file).not.toMatch(/--risu-theme-|--color-(bgcolor|darkbg|textcolor2?|borderc|darkborderc|darkbutton|selected|draculared)\s*:|data-own-scheme|use:ownScheme/)
        }
    })

    test('T4: every migrated class reads exactly the role the forward table gives, in file order, with its variant and opacity', () => {
        let migrated = 0
        for (const [file, list] of Object.entries(base)) {
            if (pending(file)) continue
            let onSelected = 0
            const expected = list.map((token) => {
                const m = /^((?:[\w[\]:&>*=.-]*:)?)(bg|text|border|ring|outline)-(\w+?)(\/\d+)?$/.exec(token)
                if (!m) throw new Error(token)
                let role = expectedRole(m[1], m[2], m[3])
                if (m[2] === 'text' && m[3] === 'textcolor' && m[1] === 'class:' && ON_SELECTED[file]) {
                    role = 'on-selected'
                    onSelected++
                }
                return `${m[1]}${m[2]}-(--settings-${role})${m[4] ?? ''}`
            })
            const source = read(file)
            const actual = [...source.matchAll(ROLE)].map((m) => prefixAt(source, m.index!) + m[0])
            expect(actual, file).toEqual(expected)
            expect(onSelected, file).toBe(ON_SELECTED[file] ?? 0)
            migrated += actual.length
        }
        expect(migrated).toBeGreaterThan(0)
    })
})

// ---- T3: co-applied utilities of one property keep their relative order

const OLD_OF_ROLE: Record<string, string> = {
    canvas: 'bgcolor', panel: 'darkbg', raised: 'darkbutton', selected: 'selected', hover: 'selected', focus: 'selected', 'on-selected': 'textcolor',
    text: 'textcolor', 'text-2': 'textcolor2', swatch: 'textcolor', 'swatch-2': 'textcolor2', 'border-strong': 'borderc', 'border-subtle': 'darkborderc',
    danger: 'draculared', 'danger-fill': 'draculared',
}

/** The class attribute and class directives of every element, as source text, one string per element. */
function elementClassSources(source: string): string[] {
    const ast = parse(source, { modern: true }) as unknown as { fragment: unknown }
    const found: string[] = []
    const visit = (node: unknown): void => {
        if (Array.isArray(node)) { node.forEach(visit); return }
        if (node === null || typeof node !== 'object') return
        const n = node as { type?: string, attributes?: { type: string, name: string, start: number, end: number }[] }
        if (n.type && /Element$|^Component$|^SvelteComponent$/.test(n.type) && Array.isArray(n.attributes)) {
            found.push(n.attributes
                .filter((a) => (a.type === 'Attribute' && a.name === 'class') || a.type === 'ClassDirective')
                .map((a) => source.slice(a.start, a.end)).join(' '))
        }
        for (const value of Object.values(node)) visit(value)
    }
    visit(ast.fragment)
    return found
}

describe('Settings shell utility order (T3)', () => {
    test('co-applied roles of one property and variant sort exactly as the scheme names did', () => {
        let pairs = 0
        for (const file of shellFiles()) {
            if (pending(file)) continue
            for (const group of elementClassSources(read(file))) {
                const byKey = new Map<string, { role: string, old: string }[]>()
                for (const m of group.matchAll(ROLE)) {
                    const key = `${prefixAt(group, m.index!).replace(/^class:/, '')}|${m[1]}`
                    const list = byKey.get(key) ?? []
                    // the same role twice (exclusive conditions) is one entry
                    if (!list.some((e) => e.role === m[2])) list.push({ role: m[2], old: `${m[1]}-${OLD_OF_ROLE[m[2]]}` })
                    byKey.set(key, list)
                }
                for (const [key, list] of byKey) {
                    if (list.length < 2) continue
                    // roles that alias one scheme name have no old order between them
                    const uniq = (all: string[]): string[] => all.filter((o, i) => all.indexOf(o) === i)
                    const byRole = uniq([...list].sort((a, b) => (a.role < b.role ? -1 : 1)).map((e) => e.old))
                    const byOld = uniq(list.map((e) => e.old).sort())
                    expect(byRole, `${file} ${key}`).toEqual(byOld)
                    pairs++
                }
            }
        }
        expect(pairs).toBeGreaterThan(0)
    })
})
