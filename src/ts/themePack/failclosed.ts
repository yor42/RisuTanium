// Fail-closed token pass of the shared pack-install validator (DD-242). Called by the engine's lintPack with the normalised pack text and the effective registry.
//   1. ROLE TOKENS ONLY.   A pack may set a custom property only if it is on the pack-settable list: the shared names below, the registry's own `settable` list, any token the registry
//                          deliberately bounds (registry.minimums / registry.maximums, the engine's value space). Every other name is rejected with "not a pack-settable token".
//   2. COLOURS RESOLVE.    Every value of a colour token (a --color-*, --nexus-* colour, a -rgb channel, or a token whose default is a colour) must resolve, in EVERY declaration the pack makes of it
//                          (:root, a root attribute, an @media block), to a concrete sRGB colour: hex, rgb(), hsl(), a named colour, or color-mix() in srgb, srgb-linear or oklab (colour.ts parseConcrete,
//                          the one reader of every colour check). color-mix() in any other space, oklch(), light-dark(), relative colours, currentcolor,
//                          inherit, unknown functions, an unresolved var() all fail. A fully transparent value fails too (a token whose default is transparent may stay transparent).
//   3. OPAQUE SURFACES.    registry.opaque (shared: the sheet and the toast) must resolve to alpha 1.
//   4. CONTRAST.           registry.pairs ([foreground token, background token, ratio, label]) and registry.surfaces are judged over the WORST CASE of every alternative the pack can produce.
//
// "Alternatives": every declaration of a token anywhere in the pack counts as a possible value; the app's own default counts only while no unconditional :root declaration replaces it.
// A var() chain is expanded through every alternative of every token on the way (as the minimums pass does).
import { decls } from './csslit'
import { parseConcrete } from './colour'
import type { Rgba } from './colour'

export { parseConcrete }
export type { Rgba }

/** A token name pattern: an exact name, or a regular expression tested against the whole name. */
export type NameMatch = string | RegExp

/** Token name to its default value (the app's token stylesheets). */
export type TokenMap = Map<string, string>

/** One rejection: the selector of the offending declaration, the property and the reason. `rule` tags the category of a warning. */
export interface LintError {
    selector: string
    prop: string
    why: string
    rule?: 'contrast' | 'readability' | 'layout'
}

/** Token-on-token contrast: [foreground token, background token or surface key, ratio, label]. */
export type ContrastPair = [string, string, number, string?]

/** Contrast of a token on a surface: [token, surface key, label, ratio]. */
export type SurfaceCheck = [string, string, string, number]

/** A channel token that must stand for a colour token: [channel token, colour token, label]. */
export type SameChannel = [string, string, string?]

/** The registry fields the pack-settable test reads. */
export interface SettableRegistry {
    settable?: readonly NameMatch[]
    minimums?: Record<string, string | number>
    maximums?: Record<string, string | number>
    isBounded?: (name: string) => boolean
    privatePrefix?: string
}

/** The fields of the engine's effective registry that the fail-closed pass reads. */
export interface FailClosedRegistry extends SettableRegistry {
    app?: TokenMap
    transparentOk?: readonly NameMatch[]
    colours?: readonly NameMatch[]
    opaque?: Iterable<string>
    same?: readonly SameChannel[]
    pairs?: readonly ContrastPair[]
    surfaces?: readonly SurfaceCheck[]
}

/** The result of inlining private variables: one normalised text per combination of their values. */
export interface InlineResult {
    variants: string[]
    error?: string
}

// ---- the shared pack-settable names (colour roles, shared geometry, the Deep Nexus decoration hooks). Area role tokens come from the registry.
export const SHARED_SETTABLE: NameMatch[] = [
    /^--nexus-(?!animate-)[a-z0-9-]+$/,      // colours, channels, blur, touch size, focus ring pair, motion basics (the motion ones are bounded by the shared minimums and maximums)
    /^--color-(?!scheme$)[a-z0-9-]+$/,       // every colour role of chat, Settings and Studio
    '--color-scheme', '--font', '--mono', '--alpha-switch-off', '--radius-field', '--radius-sheet', '--radius-control', '--radius-popup',
    '--chat-message-font',
]

// decorative colours a pack may switch off (the two canvas blooms: upstream's look has none). Everything else that is fully transparent is rejected; a registry adds its own decorative names in `transparentOk`.
export const SHARED_TRANSPARENT_OK: string[] = ['--nexus-canvas-bloom', '--nexus-canvas-warm']

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const toRe = (x: NameMatch): RegExp => (x instanceof RegExp ? x : new RegExp('^' + escapeRe(x) + '$'))
export function makeMatcher(list?: readonly NameMatch[] | null): (n: string) => boolean {
    const res = (list || []).map(toRe)
    return (n) => res.some((r) => r.test(n))
}

// ---- colours
// a channel triple "r g b" or "r, g, b" (the value of a -rgb token)
export function parseTriple(s: string): Rgba | null {
    s = String(s).trim().toLowerCase().replace(/\s*!important$/, '')
    const p = s.split(/[\s,]+/).filter(Boolean)
    if (p.length !== 3) return null
    const c = p.map((x) => (/^[+-]?\d*\.?\d+$/.test(x) ? parseFloat(x) : NaN))
    if (c.some((x) => Number.isNaN(x) || x < 0 || x > 255)) return null
    return [c[0], c[1], c[2], 1]
}
const lum = (c: readonly number[]): number => {
    const f = c.slice(0, 3).map((x) => {
        x /= 255
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
}
// a translucent colour composited onto an opaque one
const flat = (f: readonly number[], b: readonly number[]): Rgba => {
    const mix = (i: number): number => f[i] * f[3] + b[i] * (1 - f[3])
    return [mix(0), mix(1), mix(2), 1]
}
export const ratio = (a: readonly number[], b: readonly number[]): number => {
    const x = lum(a), y = lum(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/
// DD-258: a pack may keep private helper variables under ONE prefix (--pack-). They are INLINED before anything is judged: every var(--pack-x) in the pack is replaced by each value the variable is
// declared with anywhere in the pack (:root, a root attribute, an @media block, other private variables it chains through), the private declarations are dropped, and the whole stylesheet is linted once per
// combination. A private variable therefore cannot carry a value past a floor, a ceiling, a colour, a contrast or an allowlist rule: what reaches a role token or a property is what is judged.
// Returns { variants: [normalised text...], error? }. No private declaration and no private use: the text itself, once.
export function inlinePrivate(text: string, prefix: string, limit = 256): InlineResult {
    const PV = new RegExp('var\\(\\s*(' + escapeRe(prefix) + '[\\w-]+)\\s*(?:,\\s*((?:[^()]|\\([^()]*\\))*))?\\)', 'g')
    const ds = decls(text).filter((d) => d.prop.startsWith(prefix) && !d.ctx.keyframes)
    if (!ds.length && !PV.test(text)) return { variants: [text] }
    PV.lastIndex = 0
    const raw = new Map<string, string[]>()
    for (const d of ds) {
        if (!raw.has(d.prop)) raw.set(d.prop, [])
        raw.get(d.prop)!.push(d.value.replace(/\s*!important\s*$/, '').trim())
    }
    const memo = new Map<string, string[]>()
    // all strings v can be with private variables replaced; null on a cycle or when there are too many
    const expandStr = (v: string, depth: number, stack: string[]): string[] | null => {
        if (depth > 20) return null
        const m = new RegExp(PV.source).exec(v)
        if (!m) return [v]
        const opts = raw.has(m[1]) ? valuesOf(m[1], depth + 1, stack) : (m[2] !== undefined ? expandStr(m[2].trim(), depth + 1, stack) : [`var(${m[1]})`])
        if (opts === null) return null
        const out: string[] = []
        for (const o of opts) {
            const rest = expandStr(v.slice(0, m.index) + o.replace(/var\(/g, 'var\u0000(') + v.slice(m.index + m[0].length), depth + 1, stack)
            if (rest === null) return null
            out.push(...rest)
            if (out.length > limit) return null
        }
        return [...new Set(out)].map((s) => s.replace(/var\u0000\(/g, 'var('))
    }
    const valuesOf = (n: string, depth: number, stack: string[]): string[] | null => {
        if (memo.has(n)) return memo.get(n)!
        if (stack.includes(n)) return null
        const out: string[] = []
        for (const r of raw.get(n)!) {
            const xs = expandStr(r, depth, [...stack, n])
            if (xs === null) return null
            out.push(...xs)
        }
        const u = [...new Set(out)]
        memo.set(n, u)
        return u
    }
    const names = new Set([...raw.keys()])
    for (const m of text.matchAll(PV)) names.add(m[1])
    const alts = new Map<string, string[]>()
    for (const n of names) {
        if (!raw.has(n)) continue
        const v = valuesOf(n, 0, [])
        if (v === null) return { variants: [text], error: `${n} chains through private variables without end or has too many values` }
        alts.set(n, v)
    }
    // drop the private declarations (blank them out, keeping offsets)
    let base = text
    for (const d of [...ds].sort((a, b) => b.vs - a.vs)) {
        const s = base.lastIndexOf(d.prop, d.vs)
        base = base.slice(0, s) + ' '.repeat(d.ve - s) + base.slice(d.ve)
    }
    const multi = [...alts].filter(([, v]) => v.length > 1).map(([n]) => n)
    let combos: Map<string, string>[] = [new Map()]
    for (const n of multi) {
        const next: Map<string, string>[] = []
        for (const c of combos) for (const v of alts.get(n)!) next.push(new Map(c).set(n, v))
        combos = next
        if (combos.length > limit) return { variants: [text], error: `more than ${limit} combinations of private variable values` }
    }
    const variants = combos.map((c) => base.replace(PV, (m: string, n: string, fb: string | undefined) => (c.has(n) ? c.get(n)! : alts.has(n) ? alts.get(n)![0] : fb !== undefined ? fb.trim() : m)))
    // a value that still names a private variable (declared nowhere, no fallback) stays as var(): it is invalid at use time and judged as such
    return { variants }
}

// is this custom property pack-settable under this (effective) registry? (the same test the pass uses)
export function settableTest(reg: SettableRegistry): (n: string) => boolean {
    const settable = makeMatcher([...SHARED_SETTABLE, ...(reg.settable || [])])
    const bounded = (n: string): boolean => Object.prototype.hasOwnProperty.call(reg.minimums || {}, n) || Object.prototype.hasOwnProperty.call(reg.maximums || {}, n) || (reg.isBounded ? reg.isBounded(n) : false)
    const priv = reg.privatePrefix ? (n: string): boolean => n.startsWith(reg.privatePrefix!) : (): boolean => false
    return (n) => settable(n) || bounded(n) || priv(n)
}

interface Alternative {
    v: string
    sel: string
    cond: boolean
}

interface ColourAlternatives {
    cols: Rgba[]
    bad: string[]
    channel: boolean
}

export function failClosedPass(text: string, reg: FailClosedRegistry): LintError[] {
    const errs: LintError[] = []
    const fail = (selector: string, prop: string, why: string): void => {
        errs.push({ selector, prop, why })
    }
    const ds = decls(text).filter((d) => d.prop.startsWith('--') && !d.ctx.keyframes)
    const app: TokenMap = reg.app || new Map()
    const transparentOk = makeMatcher([...SHARED_TRANSPARENT_OK, ...(reg.transparentOk || [])])
    const isSettable = settableTest(reg)

    // 1. role tokens only
    const seen = new Set<string>()
    for (const d of ds) {
        if (seen.has(d.prop)) continue
        seen.add(d.prop)
        if (!isSettable(d.prop)) fail(d.ctx.selector.trim() || '(no selector)', d.prop, `${d.prop} is not a pack-settable token (a pack may set only the role tokens its registry lists: shared colour and role names, the area's role tokens, and tokens the area bounds with a floor or a ceiling)`)
    }

    // ---- alternatives of a token
    const byName = new Map<string, Alternative[]>()
    for (const d of ds) {
        const v = d.value.replace(/\s*!important\s*$/, '').trim()
        if (!byName.has(d.prop)) byName.set(d.prop, [])
        byName.get(d.prop)!.push({ v, sel: d.ctx.selector.trim(), cond: d.ctx.at.length > 0 })
    }
    const unconditional = (n: string): boolean => (byName.get(n) || []).some((x) => !x.cond && /^(:root|html)$/.test(x.sel))
    const raws = (n: string): string[] => {
        const out = (byName.get(n) || []).map((x) => x.v)
        if (app.has(n) && !unconditional(n)) out.push(app.get(n)!)
        return out
    }
    const LIMIT = 512
    // every string v can take with its var() calls substituted; null if something cannot be resolved or there are too many
    // Memoised on (value, depth), and the key must keep depth (the depth limit changes the result): nothing else feeds it, and without it a chain of tokens each declared several times expands exponentially (a pack of about 1 KB could take minutes).
    const expanded = new Map<string, string[] | null>()
    function expand(v: string, depth: number): string[] | null {
        const key = `${depth}\u0000${v}`
        if (expanded.has(key)) return expanded.get(key)!
        const result = expandOnce(v, depth)
        expanded.set(key, result)
        return result
    }
    function expandOnce(v: string, depth: number): string[] | null {
        if (depth > 14) return null
        const m = VAR.exec(v)
        if (!m) return [v]
        let opts: (string | null)[] = raws(m[1]).flatMap((x): (string | null)[] => expand(x, depth + 1) ?? [null])
        if (!opts.length) {
            if (m[2] === undefined) return null
            opts = expand(m[2].trim(), depth + 1) ?? [null]
        }
        if (opts.some((o) => o === null)) return null
        const uniq = [...new Set(opts)].filter((o): o is string => o !== null)
        const out: string[] = []
        for (const o of uniq) {
            const r = expand(v.slice(0, m.index) + o + v.slice(m.index + m[0].length), depth + 1)
            if (r === null) return null
            out.push(...r)
            if (out.length > LIMIT) return null
        }
        return [...new Set(out)]
    }
    // the colours of a colour or channel token (the name decides which) and the values that are neither
    const colAlts = (n: string): ColourAlternatives => {
        const cols: Rgba[] = [], bad: string[] = []
        const channel = /-rgb$/.test(n) || (app.has(n) && !!parseTriple(expand(app.get(n)!, 0)?.[0] ?? '') && !parseConcrete(expand(app.get(n)!, 0)?.[0] ?? ''))
        for (const r of raws(n)) {
            const xs = expand(r, 0)
            if (xs === null) {
                bad.push(r)
                continue
            }
            for (const x of xs) {
                const c = channel ? parseTriple(x) : parseConcrete(x)
                if (c) cols.push(c)
                else bad.push(x)
            }
        }
        return { cols, bad, channel }
    }
    const NAME_COLOUR = /^--(color-(?!scheme$)|nexus-(canvas|surface|edge|field-border|text|accent|ring|core|warm|danger|network|overlay|shade|warning|success))/
    const extraColour = makeMatcher(reg.colours)
    const isColourToken = (n: string): boolean => {
        if (n === '--color-scheme') return false
        if (/-rgb$/.test(n) || NAME_COLOUR.test(n) || extraColour(n)) return true
        if (!app.has(n)) return false
        const xs = expand(app.get(n)!, 0)
        return !!xs && xs.length > 0 && xs.every((x) => !!parseConcrete(x) || !!parseTriple(x))
    }
    const defaultTransparent = (n: string): boolean => {
        if (!app.has(n)) return false
        const xs = expand(app.get(n)!, 0)
        return !!xs && xs.some((x) => {
            const c = parseConcrete(x)
            return !!c && c[3] === 0
        })
    }
    const selOf = (n: string): string => (byName.get(n) || [{ sel: ':root' }])[0].sel || ':root'

    // 2. colours resolve; 3. opaque surfaces
    const opaque = new Set<string>(reg.opaque || [])
    const checked = new Set([...byName.keys()].filter((n) => isSettable(n) && isColourToken(n)))
    for (const n of opaque) checked.add(n)
    for (const n of checked) {
        const { cols, bad, channel } = colAlts(n)
        if (n === '--color-scheme') continue
        if (bad.length) {
            fail(selOf(n), n, `${n}: ${channel ? 'a colour channel that is not three numbers from 0 to 255' : 'a colour that cannot be resolved to a concrete sRGB colour (hex, rgb(), hsl(), a named colour or color-mix() in srgb, srgb-linear or oklab)'}: ${bad[0].slice(0, 50)}`)
            continue
        }
        if (!channel && cols.some((c) => c[3] === 0) && !defaultTransparent(n) && !transparentOk(n)) {
            fail(selOf(n), n, `${n}: a fully transparent colour (the token would draw nothing)`)
            continue
        }
        if (opaque.has(n) && cols.some((c) => c[3] < 1 - 1e-9)) fail(selOf(n), n, `${n}: a protected surface must resolve to an opaque colour (alpha 1), not ${cols.find((c) => c[3] < 1)!.map((x, i) => (i < 3 ? Math.round(x) : +x.toFixed(2))).join(' ')}`)
    }
    if (byName.has('--color-scheme')) for (const x of byName.get('--color-scheme')!) if (!/^(light|dark)$/.test(x.v)) fail(x.sel, '--color-scheme', '--color-scheme must be light or dark')

    // 4. contrast over the worst case: pairs [foreground, background, ratio, label] (token on token) and surfaces [token, surfaceKey, label, ratio]
    const canvasCols = (): Rgba[] => {
        const r = colAlts('--nexus-canvas').cols
        return r.length ? r : [[0, 1, 28, 1]]
    }
    const SURFACE_TOKENS: Record<string, string> = { canvas: '--nexus-canvas', sheet: '--color-surface-sheet', toast: '--color-surface-toast', glass: '--nexus-surface', raised: '--nexus-surface-raised' }
    // the colours (alpha 1) a surface can have; glass layers are flattened onto every canvas
    const surfAlts = (key: string): Rgba[] => {
        const tok = SURFACE_TOKENS[key]
        if (!tok) return []
        const base = colAlts(tok).cols
        if (key === 'canvas' || key === 'sheet' || key === 'toast') return base.map((c) => (c[3] < 1 ? flat(c, canvasCols()[0]) : c))
        const out: Rgba[] = []
        for (const cv of canvasCols()) for (const g of base) out.push(flat(g, cv))
        return out
    }
    const judged = new Set<string>()
    const judge = (fgTok: string, bgCols: Rgba[], need: number, label: string, bgName: string): void => {
        const key = fgTok + '|' + bgName + '|' + need
        if (judged.has(key)) return
        judged.add(key)
        const { cols: fgs, bad } = colAlts(fgTok)
        if (bad.length || !fgs.length || !bgCols.length) return   // an unresolvable colour is reported above
        let worst = Infinity
        for (const bg of bgCols) for (const fg of fgs) {
            const r = ratio(fg[3] < 1 ? flat(fg, bg) : fg, bg)
            if (r < worst) worst = r
        }
        if (worst < need - 1e-9) fail(selOf(fgTok), fgTok, `${fgTok.replace('--', '')} would be ${worst.toFixed(2)}:1 on ${label} (needs ${need}:1), judged over the worst case of everything the pack sets`)
    }
    // registry.same: [[channel token, colour token, label]]: a channel that stands for a colour (--studio-canvas-rgb for --nexus-canvas) must be that colour in every case (within 8 per channel), so a tint drawn from it cannot disagree with the surface
    for (const [chanTok, colTok, label] of reg.same || []) {
        const a = colAlts(chanTok).cols, b = colAlts(colTok).cols
        let bad: [Rgba, Rgba] | null = null
        for (const x of a) for (const y of b) if ([0, 1, 2].some((i) => Math.abs(x[i] - y[i]) > 8)) bad = [x, y]
        if (bad) fail(selOf(chanTok), chanTok, `${chanTok} (${bad[0].slice(0, 3).map(Math.round).join(' ')}) is not the colour of ${colTok} (${bad[1].slice(0, 3).map(Math.round).join(' ')}): ${label || 'the channel must stand for the same colour'}`)
    }
    for (const [fg, bg, need, label] of reg.pairs || []) {
        const bgCols = bg.startsWith('--') ? colAlts(bg).cols.map((x) => (x[3] < 1 ? flat(x, canvasCols()[0]) : x)) : surfAlts(bg)
        judge(fg, bgCols, need, label || bg, bg)
    }
    for (const [tok, key, label, need] of reg.surfaces || []) judge(tok, surfAlts(key), need, label, 'surface:' + key)
    return errs
}
