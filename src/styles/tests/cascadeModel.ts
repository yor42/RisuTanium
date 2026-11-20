/**
 * A small model of the CSS cascade for colour tests, run over the real stylesheets and a jsdom DOM.
 *
 * It exists because jsdom does not resolve custom properties through the cascade or compute
 * `var()` per element. It models what the app's colour contracts depend on: cascade layers,
 * specificity (`:where()` counts 0), source order, inline style, custom properties computed per
 * element (with `var()` substituted against that element's own computed custom properties, which
 * is what makes a `@theme` indirection resolve once at `:root`), inheritance, `@property`
 * registrations, and a fixed set of painted properties. It is a model, not a browser: every
 * construct it does not model is recorded in `unmodelled`, never dropped silently.
 *
 * Sheet order is the caller's: the Tailwind output of `src/styles.css` (which already contains the
 * Nexus and pattern tokens), then `chat-tokens.css`, then component CSS, then an optional pack
 * sheet.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Rule } from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { over, parseConcrete, toHex, type Rgba } from '../../ts/themePack/colour'

// Vitest runs from the repository root; `import.meta.url` is not a file URL in the jsdom environment.
export const REPO_ROOT = path.resolve(process.cwd())

export function readRepoFile(relative: string): string {
    return readFileSync(path.join(REPO_ROOT, relative), 'utf8')
}

interface TailwindCompiler { build(candidates: string[]): string }
interface TailwindNode {
    compile(css: string, opts: { base: string, onDependency: (file: string) => void }): Promise<TailwindCompiler>
}

/**
 * The Tailwind output of `src/styles.css`, compiled the way the Vite plugin does, for the given class
 * candidates. It already contains the Nexus and pattern token files that styles.css imports.
 */
export async function compileAppStyles(candidates: string[]): Promise<ModelSheet> {
    const viteRequire = createRequire(realpathSync(path.join(REPO_ROOT, 'node_modules/@tailwindcss/vite/package.json')))
    const node = await import(/* @vite-ignore */ pathToFileURL(viteRequire.resolve('@tailwindcss/node')).href) as TailwindNode
    const compiler = await node.compile(readRepoFile('src/styles.css'), { base: path.join(REPO_ROOT, 'src'), onDependency: () => {} })
    return { name: 'tailwind', css: compiler.build(candidates) }
}

/**
 * The stylesheets ChatShell.svelte imports for their side effect, as repo-relative paths in source order. Vite keeps
 * one module's CSS imports in that order, so the order of these lines is the order the chunk's rules are loaded.
 */
export function chatShellCssImports(): string[] {
    const source = readRepoFile('src/lib/ChatShell/ChatShell.svelte')
    const out: string[] = []
    for (const m of source.matchAll(/^\s*import\s+'([^']+\.css)'\s*$/gm)) {
        out.push(path.posix.normalize(path.posix.join('src/lib/ChatShell', m[1])))
    }
    return out
}

/** The app sheets in load order: the Tailwind output of `src/styles.css`, then ChatShell's CSS imports in source order. */
export async function appSheetsInOrder(candidates: string[]): Promise<ModelSheet[]> {
    const sheets = [await compileAppStyles(candidates)]
    for (const file of chatShellCssImports()) {
        if (existsSync(path.join(REPO_ROOT, file))) sheets.push({ name: path.posix.basename(file, '.css'), css: readRepoFile(file) })
    }
    return sheets
}

/** The sheets plus the real pack element as the last sheet, counted only while its `media` is `all`. */
export function withPackElement(sheets: ModelSheet[], element: HTMLStyleElement | null): ModelSheet[] {
    if (element === null || element.getAttribute('media') !== 'all') return sheets
    return [...sheets, { name: 'pack', css: element.textContent ?? '' }]
}

/** The class tokens a source file can name, as Tailwind candidates. */
export function classCandidates(...sources: string[]): string[] {
    const out = new Set<string>()
    for (const s of sources) for (const t of s.split(/[\s"'`<>{}()=;,]+/)) if (t) out.add(t)
    return [...out]
}

export interface ModelSheet {
    name: string
    css: string
}

export interface ModelEnv {
    /** Matches `@media (prefers-reduced-motion: reduce)`. Every other environment query is false. */
    reducedMotion?: boolean
    /** The element `:focus` and `:focus-visible` match; `:focus-within` matches it and every ancestor. */
    focused?: Element | null
}

export type PseudoName = '::before' | '::after'

interface Spec { a: number, b: number, c: number }
interface Cond { kind: 'media' | 'supports', params: string }
interface CompiledSelector {
    selector: string
    pseudo: PseudoName | null
    spec: Spec
    rightClasses: string[]
}
interface DeclRec { prop: string, value: string }
interface RuleRec {
    sheet: string
    order: number
    layer: number
    conds: Cond[]
    selectors: CompiledSelector[]
    decls: DeclRec[]
}
interface Registered { initial?: string, inherits: boolean }
interface Entry { prop: string, value: string }

export interface RuleSet {
    rules: RuleRec[]
    registered: Map<string, Registered>
    unmodelled: string[]
}

const FOCUS_ATTR = 'data-cm-focus'
const FOCUS_WITHIN_ATTR = 'data-cm-focus-within'
const IGNORED_AT_RULES = new Set(['keyframes', 'font-face', 'charset', 'import', 'namespace', 'counter-style', 'font-feature-values'])

function specOf(selector: selectorParser.Selector): Spec {
    const sum: Spec = { a: 0, b: 0, c: 0 }
    const add = (s: Spec) => { sum.a += s.a; sum.b += s.b; sum.c += s.c }
    for (const n of selector.nodes) {
        if (selectorParser.isIdentifier(n)) sum.a++
        else if (selectorParser.isClassName(n) || selectorParser.isAttribute(n)) sum.b++
        else if (selectorParser.isTag(n)) sum.c++
        else if (selectorParser.isPseudo(n)) {
            const v = n.value.toLowerCase()
            if (v.startsWith('::') || v === ':before' || v === ':after' || v === ':first-line' || v === ':first-letter') sum.c++
            else if (v === ':where') continue
            else if (v === ':is' || v === ':not' || v === ':has' || v === ':matches') {
                let best: Spec = { a: 0, b: 0, c: 0 }
                for (const arg of n.nodes) {
                    const s = specOf(arg)
                    if (s.a > best.a || (s.a === best.a && (s.b > best.b || (s.b === best.b && s.c > best.c)))) best = s
                }
                add(best)
            }
            else sum.b++
        }
    }
    return sum
}

function compareSpec(x: Spec, y: Spec): number {
    return x.a - y.a || x.b - y.b || x.c - y.c
}

function compileSelector(text: string, report: (what: string) => void): CompiledSelector | null {
    let root: selectorParser.Root
    try {
        root = selectorParser().astSync(text)
    } catch {
        report(`selector ${text}`)
        return null
    }
    if (root.nodes.length !== 1) return null
    const sel = root.nodes[0]
    const spec = specOf(sel)
    let pseudo: PseudoName | null = null
    let unsupported = false
    sel.walk((n) => {
        if (!selectorParser.isPseudo(n)) return
        const v = n.value.toLowerCase()
        if (v === '::before' || v === ':before') { pseudo = '::before'; n.remove() }
        else if (v === '::after' || v === ':after') { pseudo = '::after'; n.remove() }
        else if (v.startsWith('::') || v === ':host' || v === ':host-context') unsupported = true
        else if (v === ':where') n.value = ':is'
        else if (v === ':focus-visible' || v === ':focus') n.replaceWith(...selectorParser().astSync(`[${FOCUS_ATTR}]`).first.nodes)
        else if (v === ':focus-within') n.replaceWith(...selectorParser().astSync(`[${FOCUS_WITHIN_ATTR}]`).first.nodes)
    })
    if (unsupported) {
        report(`selector ${text}`)
        return null
    }
    const rightClasses: string[] = []
    for (let i = sel.nodes.length - 1; i >= 0; i--) {
        const n = sel.nodes[i]
        if (selectorParser.isCombinator(n)) break
        if (selectorParser.isClassName(n)) rightClasses.push(n.value)
    }
    return { selector: sel.toString().trim(), pseudo, spec, rightClasses }
}

function declsOf(node: Container): DeclRec[] {
    const out: DeclRec[] = []
    for (const child of node.nodes ?? []) {
        if (child.type === 'decl') {
            const d = child as Declaration
            out.push({ prop: d.prop.startsWith('--') ? d.prop : d.prop.toLowerCase(), value: d.important ? `${d.value} !important` : d.value })
        }
    }
    return out
}

/** Parses the sheets once; the result is independent of the environment. */
export function compileRules(sheets: ModelSheet[]): RuleSet {
    const unmodelled = new Set<string>()
    const registered = new Map<string, Registered>()
    const layerNames: string[] = []
    const layerRank = (name: string): number => {
        let i = layerNames.indexOf(name)
        if (i < 0) { layerNames.push(name); i = layerNames.length - 1 }
        return i
    }
    const rules: RuleRec[] = []
    let order = 0
    let anon = 0

    for (const sheet of sheets) {
        const report = (what: string) => unmodelled.add(`${sheet.name}: ${what}`)
        const rootNode = postcss.parse(sheet.css)

        const push = (selectors: string[], decls: DeclRec[], layer: string | null, conds: Cond[]) => {
            const compiled: CompiledSelector[] = []
            for (const s of selectors) {
                const c = compileSelector(s, report)
                if (c) compiled.push(c)
            }
            if (decls.some((d) => /!important\s*$/.test(d.value))) report(`!important in ${selectors.join(', ')}`)
            if (compiled.length === 0 || decls.length === 0) return
            rules.push({ sheet: sheet.name, order: order++, layer: layer === null ? Number.MAX_SAFE_INTEGER : layerRank(layer), conds, selectors: compiled, decls })
        }

        const resolveNested = (selectors: string[], parent: string | null): string[] => {
            if (parent === null) return selectors
            return selectors.map((s) => s.includes('&') ? s.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${s}`)
        }

        const walk = (container: Container, layer: string | null, conds: Cond[], parent: string | null) => {
            if (parent !== null) push([parent], declsOf(container), layer, conds)
            for (const child of container.nodes ?? [] as ChildNode[]) {
                if (child.type === 'rule') {
                    const rule = child as Rule
                    const selectors = resolveNested(rule.selectors, parent)
                    push(selectors, declsOf(rule), layer, conds)
                    if (rule.nodes.some((n) => n.type === 'rule' || n.type === 'atrule')) {
                        walk(rule, layer, conds, selectors.map((s) => `:is(${s})`).join(', '))
                    }
                }
                else if (child.type === 'atrule') {
                    const at = child as AtRule
                    const name = at.name.toLowerCase()
                    if (name === 'layer') {
                        const names = at.params.split(',').map((s) => s.trim()).filter(Boolean)
                        if (!at.nodes) {
                            for (const n of names) layerRank(layer === null ? n : `${layer}.${n}`)
                        }
                        else {
                            const local = names[0] ?? `(anon-${anon++})`
                            const full = layer === null ? local : `${layer}.${local}`
                            layerRank(full)
                            walk(at, full, conds, parent)
                        }
                    }
                    else if (name === 'media' || name === 'supports') {
                        walk(at, layer, [...conds, { kind: name, params: at.params }], parent)
                    }
                    else if (name === 'property') {
                        const rec: Registered = { inherits: true }
                        for (const d of declsOf(at)) {
                            if (d.prop === 'inherits') rec.inherits = d.value.trim() === 'true'
                            if (d.prop === 'initial-value') rec.initial = d.value.trim()
                        }
                        registered.set(at.params.trim(), rec)
                    }
                    else if (!IGNORED_AT_RULES.has(name)) {
                        report(`@${name} ${at.params}`)
                    }
                }
            }
        }
        walk(rootNode, null, [], null)
    }
    return { rules, registered, unmodelled: [...unmodelled].sort() }
}

// ---- values

function substitute(text: string, lookup: (name: string) => string | undefined): string | null {
    let out = ''
    let i = 0
    while (i < text.length) {
        const j = text.indexOf('var(', i)
        if (j < 0) { out += text.slice(i); break }
        if (j > 0 && /[\w-]/.test(text[j - 1])) { out += text.slice(i, j + 4); i = j + 4; continue }
        out += text.slice(i, j)
        let depth = 1
        let k = j + 4
        let comma = -1
        while (k < text.length && depth > 0) {
            const ch = text[k]
            if (ch === '(') depth++
            else if (ch === ')') depth--
            else if (ch === ',' && depth === 1 && comma < 0) comma = k
            k++
        }
        const inner = text.slice(j + 4, k - 1)
        const name = (comma < 0 ? inner : text.slice(j + 4, comma)).trim()
        let value = lookup(name)
        if (value === undefined) {
            if (comma < 0) return null
            const fb = substitute(text.slice(comma + 1, k - 1), lookup)
            if (fb === null) return null
            value = fb.trim()
        }
        out += value
        i = k
    }
    return out
}

const COLOUR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'color-mix'])

export function hex8(c: Rgba): string {
    return toHex(c) + Math.round(Math.min(1, Math.max(0, c[3])) * 255).toString(16).padStart(2, '0')
}

/** Rewrites every concrete colour in a value as `#rrggbbaa`; `currentcolor` becomes `current`. Other text is kept. */
export function normaliseColours(text: string, current: string): string {
    let out = ''
    let i = 0
    while (i < text.length) {
        const ch = text[i]
        if (ch === '#') {
            let k = i + 1
            while (k < text.length && /[0-9a-fA-F]/.test(text[k])) k++
            const c = parseConcrete(text.slice(i, k))
            out += c ? hex8(c) : text.slice(i, k)
            i = k
        }
        else if (/[A-Za-z]/.test(ch)) {
            let k = i
            while (k < text.length && /[\w-]/.test(text[k])) k++
            const word = text.slice(i, k)
            const lower = word.toLowerCase()
            if (text[k] === '(') {
                let depth = 1
                let m = k + 1
                while (m < text.length && depth > 0) {
                    if (text[m] === '(') depth++
                    else if (text[m] === ')') depth--
                    m++
                }
                const whole = text.slice(i, m)
                const c = COLOUR_FUNCTIONS.has(lower) ? parseConcrete(whole) : null
                out += c ? hex8(c) : `${word}(${normaliseColours(text.slice(k + 1, m - 1), current)})`
                i = m
            }
            else {
                if (lower === 'currentcolor') out += current
                else if (lower === 'transparent') out += '#00000000'
                else {
                    const c = parseConcrete(lower)
                    out += c ? hex8(c) : word
                }
                i = k
            }
        }
        else {
            out += ch
            i++
        }
    }
    return out
}

/** Compositing a `#rrggbbaa` colour over an opaque `#rrggbb` canvas, as `#rrggbb`. */
export function compositeHex(fg: string, canvas: string): string {
    const f = parseConcrete(fg.length === 9 ? `#${fg.slice(1, 7)}` : fg)
    const alpha = fg.length === 9 ? parseInt(fg.slice(7, 9), 16) / 255 : 1
    const b = parseConcrete(canvas)
    if (!f || !b) return fg
    return toHex(over([f[0], f[1], f[2], alpha], b))
}

function splitTop(text: string, sep: ',' | ' '): string[] {
    const parts: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of text) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        if (depth === 0 && (sep === ',' ? ch === ',' : /\s/.test(ch))) {
            if (cur.trim() !== '') parts.push(cur.trim())
            cur = ''
        }
        else cur += ch
    }
    if (cur.trim() !== '') parts.push(cur.trim())
    return parts
}

const SYSTEM_COLOURS = new Set(['canvas', 'canvastext', 'highlight', 'highlighttext', 'graytext', 'linktext', 'mark', 'marktext', 'buttonface', 'buttontext', 'buttonborder', 'field', 'fieldtext'])
const BORDER_STYLES = new Set(['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'])

function isColourToken(token: string): boolean {
    const t = token.toLowerCase()
    return t === 'currentcolor' || t === 'transparent' || SYSTEM_COLOURS.has(t) || t.startsWith('#') || /^(rgba?|hsla?|color-mix)\(/.test(t) || parseConcrete(t) !== null
}

// ---- the model

interface NodeData {
    entries: Entry[]
    customs: Map<string, string | undefined>
    colour?: string
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const
interface Edge { width: string, style: string, colour: string }

export class CascadeModel {
    readonly unmodelled: string[]
    private readonly set: RuleSet
    private readonly env: ModelEnv
    private readonly cache = new WeakMap<Element, Partial<Record<string, NodeData>>>()
    private readonly condCache = new Map<Cond[], boolean>()
    private readonly extra = new Set<string>()

    constructor(set: RuleSet, env: ModelEnv = {}) {
        this.set = set
        this.env = env
        this.unmodelled = set.unmodelled
        for (const el of document.querySelectorAll(`[${FOCUS_ATTR}]`)) el.removeAttribute(FOCUS_ATTR)
        for (const el of document.querySelectorAll(`[${FOCUS_WITHIN_ATTR}]`)) el.removeAttribute(FOCUS_WITHIN_ATTR)
        env.focused?.setAttribute(FOCUS_ATTR, '')
        for (let el: Element | null | undefined = env.focused; el; el = el.parentElement) el.setAttribute(FOCUS_WITHIN_ATTR, '')
    }

    /** Constructs recorded while resolving, in addition to `unmodelled`. */
    get unmodelledAtRuntime(): string[] {
        return [...this.extra].sort()
    }

    private condsHold(conds: Cond[], sheet: string): boolean {
        const cached = this.condCache.get(conds)
        if (cached !== undefined) return cached
        let ok = true
        for (const c of conds) {
            const p = c.params.toLowerCase().replace(/\s+/g, ' ')
            let holds = false
            if (c.kind === 'media') {
                if (/prefers-reduced-motion:\s*reduce/.test(p)) holds = this.env.reducedMotion === true
                else if (/forced-colors|prefers-reduced-transparency|prefers-contrast|prefers-color-scheme|hover|pointer|print|width|height|orientation/.test(p)) holds = false
                else if (p === 'screen' || p === 'all') holds = true
                else this.extra.add(`${sheet}: @media ${c.params}`)
            }
            else if (p.includes('color-mix')) holds = true
            else this.extra.add(`${sheet}: @supports ${c.params}`)
            if (!holds) { ok = false; break }
        }
        this.condCache.set(conds, ok)
        return ok
    }

    private nodeData(el: Element, pseudo: PseudoName | null): NodeData {
        const slot = this.cache.get(el) ?? {}
        this.cache.set(el, slot)
        const key = pseudo ?? ''
        const existing = slot[key]
        if (existing) return existing

        const hits: { rule: RuleRec, spec: Spec }[] = []
        for (const rule of this.set.rules) {
            let best: Spec | null = null
            for (const s of rule.selectors) {
                if (s.pseudo !== pseudo) continue
                if (s.rightClasses.some((c) => !el.classList.contains(c))) continue
                let matched = false
                try {
                    matched = el.matches(s.selector)
                } catch {
                    this.extra.add(`${rule.sheet}: selector ${s.selector}`)
                }
                if (matched && (best === null || compareSpec(s.spec, best) > 0)) best = s.spec
            }
            if (best !== null && this.condsHold(rule.conds, rule.sheet)) hits.push({ rule, spec: best })
        }
        hits.sort((x, y) => x.rule.layer - y.rule.layer || compareSpec(x.spec, y.spec) || x.rule.order - y.rule.order)
        const entries: Entry[] = []
        for (const h of hits) for (const d of h.rule.decls) entries.push({ prop: d.prop, value: d.value })
        if (pseudo === null) {
            const inline = el.getAttribute('style')
            if (inline) {
                for (const d of declsOf(postcss.parse(`x{${inline}}`).first as Rule)) entries.push({ prop: d.prop, value: d.value })
            }
        }

        const data: NodeData = { entries, customs: new Map() }
        slot[key] = data
        data.customs = this.computeCustoms(el, pseudo, entries)
        return data
    }

    private computeCustoms(el: Element, pseudo: PseudoName | null, entries: Entry[]): Map<string, string | undefined> {
        const parentMap = pseudo !== null
            ? this.nodeData(el, null).customs
            : el.parentElement ? this.nodeData(el.parentElement, null).customs : new Map<string, string | undefined>()
        const result = new Map<string, string | undefined>()
        const isRoot = pseudo === null && el.parentElement === null
        for (const [name, reg] of this.set.registered) {
            // A registered property that does not inherit, and every registered property at the root, starts at its initial value.
            if (!reg.inherits || isRoot) result.set(name, reg.initial)
        }
        for (const [name, value] of parentMap) {
            const reg = this.set.registered.get(name)
            if (reg && !reg.inherits) continue
            result.set(name, value)
        }
        const own = new Map<string, string>()
        for (const e of entries) if (e.prop.startsWith('--')) own.set(e.prop, e.value.trim())
        const done = new Map<string, string | undefined>()
        const resolve = (name: string, stack: string[]): string | undefined => {
            if (done.has(name)) return done.get(name)
            if (stack.includes(name)) return undefined
            const raw = own.get(name)!
            const v = substitute(raw, (n) => own.has(n) ? resolve(n, [...stack, name]) : result.get(n))
            const out = v === null ? undefined : v.trim()
            done.set(name, out)
            return out
        }
        for (const name of own.keys()) result.set(name, resolve(name, []))
        return result
    }

    /** The computed custom property of an element, or undefined when it is guaranteed-invalid. */
    custom(el: Element, name: string, pseudo: PseudoName | null = null): string | undefined {
        return this.nodeData(el, pseudo).customs.get(name)
    }

    /** The winning value of a plain property with `var()` substituted; undefined when unset or invalid. */
    prop(el: Element, property: string, pseudo: PseudoName | null = null): string | undefined {
        const data = this.nodeData(el, pseudo)
        for (let i = data.entries.length - 1; i >= 0; i--) {
            if (data.entries[i].prop === property) return this.value(data, data.entries[i].value) ?? undefined
        }
        return undefined
    }

    private value(data: NodeData, raw: string): string | null {
        return substitute(raw, (n) => data.customs.get(n))
    }

    private colourOf(el: Element, pseudo: PseudoName | null): string {
        const data = this.nodeData(el, pseudo)
        if (data.colour !== undefined) return data.colour
        const inherited = pseudo !== null
            ? this.colourOf(el, null)
            : el.parentElement ? this.colourOf(el.parentElement, null) : '#000000ff'
        let result = inherited
        for (let i = data.entries.length - 1; i >= 0; i--) {
            if (data.entries[i].prop !== 'color') continue
            const v = this.value(data, data.entries[i].value)
            if (v === null) break
            const t = v.trim().toLowerCase()
            result = t === 'inherit' || t === 'currentcolor' || t === 'unset' ? inherited : normaliseColours(v.trim(), inherited)
            break
        }
        data.colour = result
        return result
    }

    /** The painted colours of an element (or its ::before / ::after) as normalised text. */
    painted(el: Element, pseudo: PseudoName | null = null): Record<string, string> {
        const data = this.nodeData(el, pseudo)
        const current = this.colourOf(el, pseudo)
        const out: Record<string, string> = { color: current }
        const norm = (raw: string): string | null => {
            const v = this.value(data, raw)
            return v === null ? null : normaliseColours(v.trim(), current)
        }

        let bgColour = '#00000000'
        let bgImage = 'none'
        const edges: Record<string, Edge> = {}
        const edge = (): Edge => ({ width: 'medium', style: 'none', colour: current })
        for (const s of SIDES) edges[s] = edge()
        let outline = edge()
        let shadow: string | undefined
        let fill: string | undefined
        let stroke: string | undefined

        const sideTokens = (value: string): string[] => {
            const t = splitTop(value, ' ')
            if (t.length === 1) return [t[0], t[0], t[0], t[0]]
            if (t.length === 2) return [t[0], t[1], t[0], t[1]]
            if (t.length === 3) return [t[0], t[1], t[2], t[1]]
            return t.slice(0, 4)
        }
        const applyShorthand = (e: Edge, tokens: string[]): Edge => {
            const next: Edge = { width: 'medium', style: 'none', colour: current }
            for (const t of tokens) {
                const lower = t.toLowerCase()
                if (BORDER_STYLES.has(lower)) next.style = lower
                else if (/^[\d.]+([a-z%]*)$/.test(lower) || lower === 'thin' || lower === 'medium' || lower === 'thick' || lower.startsWith('calc(')) next.width = lower
                else if (isColourToken(t)) next.colour = t
            }
            void e
            return next
        }

        for (const e of data.entries) {
            const p = e.prop
            if (p.startsWith('--')) continue
            if (!/^(background|border|outline|box-shadow|fill|stroke)/.test(p)) continue
            const raw = norm(e.value)
            if (raw === null) continue
            const value = raw.trim()
            if (p === 'background' || p === 'background-color' || p === 'background-image') {
                if (p === 'background-color') bgColour = value
                else if (p === 'background-image') bgImage = value
                else {
                    const parts = splitTop(value, ' ')
                    const image = parts.filter((t) => /^(repeating-)?(linear|radial|conic)-gradient\(|^url\(|^image-set\(/i.test(t))
                    const colour = parts.find((t) => !image.includes(t) && isColourToken(t))
                    bgImage = image.length > 0 ? image.join(' ') : 'none'
                    bgColour = colour ?? '#00000000'
                }
            }
            else if (p === 'border') {
                const tokens = splitTop(value, ' ')
                for (const s of SIDES) edges[s] = applyShorthand(edges[s], tokens)
            }
            else if (p === 'border-width' || p === 'border-style' || p === 'border-color') {
                const field = p === 'border-width' ? 'width' : p === 'border-style' ? 'style' : 'colour'
                sideTokens(value).forEach((t, i) => { edges[SIDES[i]][field] = t.toLowerCase() === 'currentcolor' ? current : field === 'colour' ? t : t.toLowerCase() })
            }
            else if (/^border-(top|right|bottom|left)$/.test(p)) {
                const s = p.slice(7)
                edges[s] = applyShorthand(edges[s], splitTop(value, ' '))
            }
            else if (/^border-(top|right|bottom|left)-(width|style|color)$/.test(p)) {
                const [, s, f] = /^border-(top|right|bottom|left)-(width|style|color)$/.exec(p)!
                edges[s][f === 'color' ? 'colour' : f as 'width' | 'style'] = f === 'color' ? value : value.toLowerCase()
            }
            else if (p === 'outline') outline = applyShorthand(outline, splitTop(value, ' '))
            else if (p === 'outline-width') outline.width = value.toLowerCase()
            else if (p === 'outline-style') outline.style = value.toLowerCase()
            else if (p === 'outline-color') outline.colour = value
            else if (p === 'box-shadow') shadow = value
            else if (p === 'fill') fill = value
            else if (p === 'stroke') stroke = value
            else if (/^border-(inline|block|image|start|end)/.test(p)) this.extra.add(`property ${p}`)
        }

        const painting = (e: Edge): boolean => !(e.style === 'none' || e.style === 'hidden') && !/^0(px|rem|em)?$/.test(e.width)
        if (bgColour !== '#00000000') out['background-color'] = bgColour
        if (bgImage !== 'none') out['background-image'] = bgImage
        for (const s of SIDES) if (painting(edges[s])) out[`border-${s}-color`] = edges[s].colour
        if (painting(outline)) out['outline-color'] = outline.colour
        if (shadow !== undefined && shadow !== 'none') out['box-shadow'] = shadow
        if (fill !== undefined && fill !== 'none') out.fill = fill
        if (stroke !== undefined && stroke !== 'none') out.stroke = stroke
        return out
    }
}
