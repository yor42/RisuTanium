// @vitest-environment node
// The Home screen's part census (#438 Home). HOME_PARTS is recomputed from the markup of the component closure of HomeShell
// (the Home root, which also reaches the library through HomeLibrary and the shared catalog). A rename, a new part, a
// component added to the closure or a home-* or library-* name rendered on another screen fails here until the list is
// reviewed. The library-* names are shared with the standalone catalog, which is never mounted together with HomeShell
// (App.svelte mounts the catalog only while the chat screen is unmounted), so the census also pins that no other screen
// closure renders a home-* or library-* name.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'svelte/compiler'
import { describe, expect, it } from 'vitest'
import { HOME_PARTS, isAreaPart, isHomePart } from './areaParts'
import { judgeAreaSheet } from './index'

const root = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const src = path.join(root, 'src')
const rel = (file: string): string => path.relative(root, file).split(path.sep).join('/')
const TEST_COMPONENT = /\.test\.|Harness|Stub|testHost|\/tests\//

/** The `.svelte` imports of a source file, static (`from`) and dynamic (`import()`), as absolute paths; a specifier that is not a relative or `src/` path is not followed. */
function svelteImports(file: string): string[] {
    const found: string[] = []
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()\s*['"]([^'"]+\.svelte)['"]/g)) {
        const specifier = m[1]
        if (specifier.startsWith('.')) found.push(path.resolve(path.dirname(file), specifier))
        else if (specifier.startsWith('src/')) found.push(path.resolve(root, specifier))
    }
    return found
}

function closureOf(starts: readonly string[]): Set<string> {
    const seen = new Set<string>()
    const stack = [...starts]
    while (stack.length > 0) {
        const file = stack.pop() as string
        if (seen.has(file) || !existsSync(file)) continue
        seen.add(file)
        if (file.endsWith('.svelte')) stack.push(...svelteImports(file))
    }
    return seen
}

function walk(dir: string, into: string[]): string[] {
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full, into)
        else if (/\.(svelte|ts|js|css)$/.test(name)) into.push(full)
    }
    return into
}

const HOME_ROOT = path.join(src, 'lib/UI/Home/HomeShell.svelte')
const home = closureOf([HOME_ROOT])
const homeComponents = [...home].filter((file) => file.endsWith('.svelte') && !TEST_COMPONENT.test(file)).sort()

/** The reviewed non-literal data-parts of the closure: an expression that is not a single string is reviewed only when every string literal in it equals `literals` exactly (members and size); `parts` are the names it can render. */
const REVIEWED_EXPRESSIONS: Readonly<Record<string, { literals: readonly string[]; parts: readonly string[] }>> = {}

/** Components of the closure whose element spreads its rest props, with the reason that is safe: a data-part a caller passes is an attribute of that component's tag, which collect reads at the call site. */
const REVIEWED_SPREADS: Readonly<Record<string, string>> = {}

interface AstNode { readonly type?: string; readonly [key: string]: unknown }
const object = (value: unknown): AstNode | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as AstNode : null)
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : [])

/** Every node of a tree, parents before children; `metadata` and `parent` links are not followed. */
function visit(value: unknown, on: (node: AstNode) => void): void {
    if (Array.isArray(value)) { for (const item of value) visit(item, on); return }
    const node = object(value)
    if (node === null) return
    on(node)
    for (const [key, child] of Object.entries(node)) if (key !== 'metadata' && key !== 'parent') visit(child, on)
}

/** The string a static ESTree node is: a string literal or a template literal with no expression; null for anything else. */
function staticString(node: AstNode | null): string | null {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
    if (node?.type === 'TemplateLiteral' && list(node.expressions).length === 0) {
        const quasis = list(node.quasis)
        const cooked = quasis.length === 1 ? object(object(quasis[0])?.value)?.cooked : undefined
        return typeof cooked === 'string' ? cooked : null
    }
    return null
}

/** The names an expression can yield and whether every value position is static. Only a string literal, a static template, `?:` branches and `||`, `&&`, `??` operands are followed; any other node in a value position is not static. */
function valueNames(node: AstNode | null, names: string[]): boolean {
    if (node === null) return false
    const text = staticString(node)
    if (text !== null) { names.push(text); return true }
    if (node.type === 'Literal') return true
    if (node.type === 'ConditionalExpression') return valueNames(object(node.consequent), names) && valueNames(object(node.alternate), names)
    if (node.type === 'LogicalExpression') return valueNames(object(node.left), names) && valueNames(object(node.right), names)
    return false
}

/** Every string literal and static template anywhere in an expression, including the test of a conditional. */
function allStrings(node: AstNode): string[] {
    const found: string[] = []
    visit(node, (inner) => { const text = staticString(inner); if (text !== null) found.push(text) })
    return found
}

const ELEMENT_TYPES = new Set(['RegularElement', 'Component', 'SvelteElement', 'SvelteComponent', 'SvelteSelf', 'SvelteFragment'])
const sameSet = (a: readonly string[], b: readonly string[]): boolean => new Set(a).size === a.length && a.length === b.length && b.every((n) => a.includes(n))

interface Rendered { names: Set<string>; byName: Map<string, Set<string>>; unreviewed: string[] }
/** The `data-part` names of the components' markup, read from the compiler's AST: every `data-part` attribute of an element or component, and a spread on an element, is either a name this reads or a line in `unreviewed`. */
function collect(files: readonly string[]): Rendered {
    const names = new Set<string>()
    const byName = new Map<string, Set<string>>()
    const unreviewed: string[] = []
    const add = (name: string, file: string): void => {
        names.add(name)
        if (!byName.has(name)) byName.set(name, new Set())
        byName.get(name)?.add(rel(file))
    }
    for (const file of files) {
        let ast: AstNode | null
        try {
            ast = object(parse(readFileSync(file, 'utf8'), { modern: true }))
        } catch {
            unreviewed.push(`${rel(file)}: cannot be parsed`)
            continue
        }
        const reviewed = REVIEWED_EXPRESSIONS[rel(file)]
        visit(ast?.fragment, (node) => {
            if (typeof node.type !== 'string' || !ELEMENT_TYPES.has(node.type)) return
            for (const attribute of list(node.attributes)) {
                const item = object(attribute)
                if (item?.type === 'SpreadAttribute') {
                    if ((node.type === 'RegularElement' || node.type === 'SvelteElement') && REVIEWED_SPREADS[rel(file)] === undefined) unreviewed.push(`${rel(file)}: a spread attribute on an element`)
                    continue
                }
                if (item?.type !== 'Attribute' || item.name !== 'data-part') continue
                const parts = list(item.value)
                const single = object(item.value)
                if (item.value === true) {
                    unreviewed.push(`${rel(file)}: a data-part with no value`)
                } else if (single?.type === 'ExpressionTag') {
                    const expression = object(single.expression)
                    const direct = staticString(expression)
                    if (direct !== null) { add(direct, file); continue }
                    const yielded: string[] = []
                    const staticOnly = expression !== null && valueNames(expression, yielded)
                    const ok = reviewed !== undefined && expression !== null && staticOnly && sameSet(allStrings(expression), [...reviewed.literals]) && sameSet(yielded, [...reviewed.parts])
                    if (ok) for (const n of yielded) add(n, file)
                    else unreviewed.push(`${rel(file)}: a data-part expression that is not a reviewed form (${expression?.type ?? 'unknown'})`)
                } else if (parts.length === 1 && object(parts[0])?.type === 'Text' && typeof object(parts[0])?.data === 'string') {
                    add(object(parts[0])?.data as string, file)
                } else {
                    unreviewed.push(`${rel(file)}: a data-part that mixes text and expressions`)
                }
            }
        })
    }
    return { names, byName, unreviewed }
}
const rendered = collect(homeComponents)
const HOME_PREFIXED = /^(home|library)(-[a-z0-9-]+)?$/

/** The names the Home tree renders that are not home-* or library-* parts: each belongs to another area, with the reason it keeps its name. */
const FOREIGN: ReadonlyMap<string, string> = new Map<string, string>([
    ['character-name-row', 'the character name row of the shared catalog (CharacterNameRow), not a home part'],
    ['pattern-dialog', 'the pattern dialog frame (popups): another area owns it, and it is critical by name'],
    ['pattern-dialog-announce', 'the pattern dialog frame (popups)'],
    ['pattern-layer', 'the pattern dialog layer (popups)'],
    ['pattern-scrim', 'the pattern dialog scrim (popups)'],
    ['reply-error-dot', 'a reply status part the chat shell rows render as well'],
    ['reply-new-dot', 'a reply status part the chat shell rows render as well'],
    ['reply-writing-badge', 'a reply status part the chat shell rows render as well'],
    ['trash-days-left', 'the trash row countdown of the shared catalog'],
    ['trash-empty', 'the trash empty state of the shared catalog'],
])

describe('Home census: the rendered Home parts', () => {
    it('reads every render form: no unreviewed non-literal data-part', () => {
        expect(rendered.unreviewed).toEqual([])
        expect(homeComponents.length).toBeGreaterThan(10)
    })

    it('HOME_PARTS equals the home-* and library-* names the HomeShell closure renders (a mismatch prints the expected list)', () => {
        const expected = new Set([...rendered.names].filter((n) => HOME_PREFIXED.test(n)))
        const missing = [...expected].filter((n) => !HOME_PARTS.has(n))
        const extra = [...HOME_PARTS].filter((n) => !expected.has(n))
        expect({ missing, extra }, `expected HOME_PARTS (${expected.size} names) =\n${[...expected].sort().map((n) => `    '${n}',`).join('\n')}`).toEqual({ missing: [], extra: [] })
    })

    it('the names of the closure that are not home-* or library-* parts are exactly the reviewed foreign list', () => {
        const foreign = [...rendered.names].filter((n) => !HOME_PREFIXED.test(n)).sort()
        expect(foreign, `foreign names of the closure:\n${foreign.map((n) => `'${n}'`).join(', ')}`).toEqual([...FOREIGN.keys()].sort())
        for (const name of FOREIGN.keys()) expect(isHomePart(name), name).toBe(false)
    })

    it('no home-* or library-* name is rendered by a component outside the HomeShell closure', () => {
        const everything = walk(path.join(src, 'lib'), []).filter((file) => file.endsWith('.svelte') && !TEST_COMPONENT.test(file))
        const elsewhere = collect(everything.filter((file) => !home.has(file)))
        expect([...elsewhere.names].filter((n) => HOME_PREFIXED.test(n))).toEqual([])
    })

    it('no chat shell, settings shell or Studio closure reaches a component that renders a home-* or library-* name', () => {
        const others = [
            ['ChatShell', path.join(src, 'lib/ChatShell/ChatShell.svelte')],
            ['SettingsShell', path.join(src, 'lib/SettingsShell/SettingsShell.svelte')],
            ['Studio', path.join(src, 'lib/Studio/StudioScreen.svelte')],
        ] as const
        for (const [label, start] of others) {
            expect(existsSync(start), `${label} root exists`).toBe(true)
            const files = [...closureOf([start])].filter((file) => file.endsWith('.svelte') && !TEST_COMPONENT.test(file))
            expect([...collect(files).names].filter((n) => HOME_PREFIXED.test(n)), label).toEqual([])
        }
    })

    it('every home part is a part of the Home area and of no chat, Studio, Settings or popups sheet', () => {
        for (const name of HOME_PARTS) {
            expect(isAreaPart('home', name), name).toBe(true)
            for (const area of ['chat', 'studio', 'settings', 'popups'] as const) expect(isAreaPart(area, name), `${area} ${name}`).toBe(false)
        }
    })

    it('the home prefix rule is a membership test: the Home parts of the chat, Studio, Settings and popups screens are refused for a home sheet', () => {
        for (const name of ['chat-composer', 'toast', 'settings-page', 'studio-header', 'pattern-alert-body', 'sidebar-home', 'more-list', 'rail-settings', 'homepage', 'library_x', 'home_x']) {
            expect(isAreaPart('home', name), name).toBe(false)
        }
        for (const name of ['home', 'library', 'home-greeting', 'library-row', 'home-x-1']) expect(isAreaPart('home', name), name).toBe(true)
    })

    it('HP-1: a home sheet that colours a part of another screen is refused with the membership reason', () => {
        for (const name of ['chat-composer', 'toast', 'settings-page', 'studio-header', 'pattern-alert-body']) {
            const result = judgeAreaSheet('home', `[data-part="${name}"]{color:#7a1f5c}`).result
            expect(result.ok, name).toBe(false)
            expect(result.errors.map((e) => e.why).join(' | '), name).toMatch(new RegExp(`the part ${name} is not a part of the home screen`))
        }
    })
})
