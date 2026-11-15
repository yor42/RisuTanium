// Geometry rules of the shared pack-install validator (DD-256, DD-260). Called by the pack linter with the normalised, private-variable-free pack text and the effective registry.
//   1. ANCESTOR INSET (DD-260). registry.chains: [{ name, parts: [outer ... inner], defaults, budget }]. Every padding, margin and border declaration that names a part of a chain is read per side (left, right, start, end) in px, or refused as "cannot be measured"
//      (inherit, revert, a value or number of values outside the property's grammar, a name with no reader). Per box kind and side a part's value is the largest any declaration gives it, whatever its selector, state, @media, importance or order, floored by the page's own
//      value (defaults); a reading never depends on another declaration. Left plus right is summed per kind and part, in the larger of the two reading directions, and the parts of one chain are summed; the sum may not exceed the budget (default 120 px: a 360 px phone keeps 240 px
//      for the protected block inside). Widths, gap and paint over a control are outside this rule.
//   2. SHEET HEIGHT (DD-256). registry.sheets: [{ name, terms }]. A protected sheet's height at 360 px wide is estimated from the geometry tokens it reads, each at the LARGEST value the pack can give it
//      (every :root, root-attribute and @media alternative; the app default while no unconditional :root declaration replaces it). It may not exceed 640 px (a 360x640 phone), so a pack whose every size is
//      inside its own ceiling but whose sum pushes the buttons off the screen is rejected.
//      terms: { px } a constant; { t: token, n } n times a token; { text: { chars, size: token, lead, hpad: [tokens], hfixed } } a block of text, wrapped at 360 - 2 * (hpad tokens) - hfixed with 1 em per character (Korean).
//      The estimate is a model of the DOM (not a measurement): it is an upper bound built from the part list and token reads.
import { decls } from './csslit'
import { parseConcrete } from './failclosed'

/** One rejection reason of the validator. */
export interface LintError {
    selector: string
    prop: string
    why: string
}

/** A chain of ancestor parts, outermost first, whose summed horizontal inset is bounded. */
export interface GeometryChain {
    name: string
    parts: readonly string[]
    /** The horizontal padding the page itself gives a part (px, split evenly between its two sides): a floor under every pack rule on each side. */
    defaults?: Readonly<Record<string, number>>
    /** Default 120 px. */
    budget?: number
    /** Only quoted in the message; default 240 px. */
    minInner?: number
}

/** A block of wrapped text in a sheet-height model. */
export interface SheetTextTerm {
    chars: number
    size: string
    lead?: number
    hpad?: readonly string[]
    hfixed?: number
}

/** One term of a sheet-height model: `px` a constant, `t` (`n` times) a token, or `text` a wrapped block; the first present field wins in that order. */
export interface SheetTerm {
    px?: number
    t?: string
    n?: number
    text?: SheetTextTerm
}

/** A protected sheet. With a `cap` it scrolls and only `fixed` + `minScroll` (default 96 px) must fit under the cap; without one the whole `terms` estimate must fit 640 px. */
export interface GeometrySheet {
    name: string
    terms: readonly SheetTerm[]
    fixed?: readonly SheetTerm[]
    cap?: number
    minScroll?: number
}

/** The registry fields the geometry pass reads. */
export interface GeometryRegistry {
    /** The app's default token values. */
    app?: Map<string, string>
    chains?: readonly GeometryChain[]
    sheets?: readonly GeometrySheet[]
}

/** [name, content] for an uncapped sheet; [name, content, shown, fixed] for a capped one (all rounded px). */
export type SheetHeightRow = [string, number] | [string, number, number, number]

/** The errors of the pass, carrying the height rows of every sheet that could be judged. */
export type GeometryErrors = LintError[] & { heights?: SheetHeightRow[] }

interface TokenRead {
    v: string
    cond: boolean
}

// Same text model as the pattern sheet-height check: a Korean glyph is 1 em wide, lines = ceil(chars / floor(width / size)).
const VIEW_W = 360, VIEW_H = 640, CHAR_EM = 1
// colour functions hold numbers that are not widths
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\((?:[^()]|\([^()]*\))*\)/g
const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/
// calc() is evaluated only after the expression is reduced to digits, dots, spaces, + - * / and parentheses; anything that does not evaluate is NaN.
const num = (s0: string): number => {
    const s = String(s0).trim()
    let m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(s)
    if (m) return parseFloat(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1)
    m = /^calc\((.*)\)$/.exec(s)
    if (m) {
        const e = m[1].replace(/(-?\d*\.?\d+)(px|rem|em)\b/g, (x: string, n: string, u: string) => String(parseFloat(n) * (u === 'px' ? 1 : 16)))
        if (/^[\d.\s+\-*\/()]+$/.test(e)) {
            try {
                return (Function(`return (${e})`) as () => number)()
            } catch {
                return NaN
            }
        }
    }
    return NaN
}

/** The horizontal places a declaration can set: physical left and right, logical start and end. */
export type InsetSlot = 'L' | 'R' | 'S' | 'E'
/** The three boxes whose horizontal inset is summed along a chain. */
export type InsetKind = 'padding' | 'border' | 'margin'
/** How a row reads its values: `length` (padding, margin), `width` and `style` (border longhands), `line` (a border shorthand). */
export type InsetGrammar = 'length' | 'width' | 'style' | 'line'
/** How many values a row takes: `box` 1-4 (left and right from the CSS box rule), `pair` 1-2 (start, end), `single` exactly one value (a line shorthand is one value of its own grammar). */
export type InsetArity = 'box' | 'pair' | 'single'

/** One property the reader measures. `slots` are the places it sets. */
export interface ReaderRow {
    prop: string
    kind: InsetKind
    grammar: InsetGrammar
    arity: InsetArity
    slots: readonly InsetSlot[]
}

const spacingRows = (kind: 'padding' | 'margin'): ReaderRow[] => [
    { prop: kind, kind, grammar: 'length', arity: 'box', slots: ['L', 'R'] },
    { prop: `${kind}-left`, kind, grammar: 'length', arity: 'single', slots: ['L'] },
    { prop: `${kind}-right`, kind, grammar: 'length', arity: 'single', slots: ['R'] },
    { prop: `${kind}-inline`, kind, grammar: 'length', arity: 'pair', slots: ['S', 'E'] },
    { prop: `${kind}-inline-start`, kind, grammar: 'length', arity: 'single', slots: ['S'] },
    { prop: `${kind}-inline-end`, kind, grammar: 'length', arity: 'single', slots: ['E'] },
]
const borderRows = (grammar: 'line' | 'width' | 'style', suffix: string): ReaderRow[] => {
    const multi: InsetArity = grammar === 'line' ? 'single' : 'box'
    const inline: InsetArity = grammar === 'line' ? 'single' : 'pair'
    return [
        { prop: `border${suffix}`, kind: 'border', grammar, arity: multi, slots: ['L', 'R'] },
        { prop: `border-left${suffix}`, kind: 'border', grammar, arity: 'single', slots: ['L'] },
        { prop: `border-right${suffix}`, kind: 'border', grammar, arity: 'single', slots: ['R'] },
        { prop: `border-inline${suffix}`, kind: 'border', grammar, arity: inline, slots: ['S', 'E'] },
        { prop: `border-inline-start${suffix}`, kind: 'border', grammar, arity: 'single', slots: ['S'] },
        { prop: `border-inline-end${suffix}`, kind: 'border', grammar, arity: 'single', slots: ['E'] },
    ]
}
/** Every property the reader measures (30 rows): padding and margin, and the border line, width and style forms, each in the six horizontal spellings. */
export const READER_ROWS: readonly ReaderRow[] = [...spacingRows('padding'), ...spacingRows('margin'), ...borderRows('line', ''), ...borderRows('width', '-width'), ...borderRows('style', '-style')]
const ROW_BY_PROP = new Map<string, ReaderRow>(READER_ROWS.map((r) => [r.prop, r]))

/**
 * The class of a padding, margin or border property on a part of a judged chain: READ (the reader measures it), BLOCK (block axis only, no horizontal effect: a pack cannot change writing-mode or direction),
 * PAINT (a border colour), NO-EFFECT (a radius) or REFUSED (not a CSS property, or not measurable).
 */
export type FamilyClass = 'READ' | 'BLOCK' | 'PAINT' | 'NO-EFFECT' | 'REFUSED'
const BLOCK_SIDES: readonly string[] = ['top', 'bottom', 'block', 'block-start', 'block-end']
const PAINT_SIDES: readonly string[] = ['top', 'right', 'bottom', 'left', 'block', 'block-start', 'block-end', 'inline', 'inline-start', 'inline-end']
const CORNER_SIDES: readonly string[] = ['top-start', 'top-end', 'right-start', 'right-end', 'bottom-start', 'bottom-end', 'left-start', 'left-end']
const NOT_A_PROPERTY: readonly string[] = [
    ...(['padding', 'margin'] as const).flatMap((k) => CORNER_SIDES.map((s) => `${k}-${s}`)),
    ...CORNER_SIDES.flatMap((s) => ['', '-width', '-style', '-color'].map((x) => `border-${s}${x}`)),
]
const NOT_MEASURED: readonly string[] = ['border-collapse', 'border-spacing']
/** Every name of the family `{padding, margin, border}` x side that the property allow-list admits, in exactly one class (133 names). Radius corner names are the allow-list's own set. */
export const FAMILY_CLASSES: Readonly<Record<FamilyClass, readonly string[]>> = {
    READ: READER_ROWS.map((r) => r.prop),
    BLOCK: [
        ...(['padding', 'margin'] as const).flatMap((k) => BLOCK_SIDES.map((s) => `${k}-${s}`)),
        ...BLOCK_SIDES.flatMap((s) => ['', '-width', '-style'].map((x) => `border-${s}${x}`)),
    ],
    PAINT: ['border-color', ...PAINT_SIDES.map((s) => `border-${s}-color`)],
    'NO-EFFECT': ['border-radius', ...['top', 'bottom', 'start', 'end'].flatMap((a) => ['left', 'right', 'start', 'end'].map((b) => `border-${a}-${b}-radius`))],
    REFUSED: [...NOT_A_PROPERTY, ...NOT_MEASURED],
}
const FAMILY_CLASS_KEYS: readonly FamilyClass[] = ['READ', 'BLOCK', 'PAINT', 'NO-EFFECT', 'REFUSED']
const CLASS_BY_PROP = new Map<string, FamilyClass>()
for (const cls of FAMILY_CLASS_KEYS) for (const name of FAMILY_CLASSES[cls]) CLASS_BY_PROP.set(name, cls)
const NOT_A_PROPERTY_SET: ReadonlySet<string> = new Set(NOT_A_PROPERTY)
const NOT_MEASURED_SET: ReadonlySet<string> = new Set(NOT_MEASURED)
// every padding, margin and border name, vendor aliases included; a name in the family with no class is refused
const FAMILY = /^(-webkit-)?(padding|margin|border)(-[a-z]+)*$/
/** The class of a family property, or null when the name is not in the family. A family name with no listed class is REFUSED. */
export const familyClass = (prop: string): FamilyClass | null => FAMILY.test(prop) ? CLASS_BY_PROP.get(prop) ?? 'REFUSED' : null

/** One side's reading in px, per place. */
type Reading = Partial<Record<InsetSlot, number>>
type Sides = Record<InsetSlot, number>
const SLOTS: readonly InsetSlot[] = ['L', 'R', 'S', 'E']
const IMPORTANT = /\s*!\s*important\s*$/i
// CSS defines thin, medium and thick as 1, 3 and 5 px (the width a visible style gets without one is medium)
const WIDTH_WORDS = new Map<string, number>([['thin', 1], ['medium', 3], ['thick', 5]])
const MEDIUM_PX = 3
const VISIBLE_STYLES: ReadonlySet<string> = new Set(['dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset'])
// A word in a border line shorthand is the colour only when the engine accepts it as one: a hex, a named colour or transparent (parseConcrete), currentcolor, or a system colour.
const SYSTEM_COLOURS: ReadonlySet<string> = new Set(['canvas', 'canvastext', 'linktext', 'visitedtext', 'activetext', 'buttonface', 'buttontext', 'buttonborder', 'field', 'fieldtext', 'highlight', 'highlighttext', 'selecteditem', 'selecteditemtext', 'mark', 'marktext', 'graytext', 'accentcolor', 'accentcolortext'])
const isColourWord = (t: string): boolean => t === 'currentcolor' || SYSTEM_COLOURS.has(t) || parseConcrete(t) !== null
const LENGTH = /^([+-]?)(\d*\.?\d+)(px|rem|%)?$/
const CSS_WIDE: ReadonlySet<string> = new Set(['initial', 'unset', 'revert', 'revert-layer'])

// the top-level tokens of a value, parenthesised groups kept whole; null when the parentheses do not balance
const tokensOf = (v: string): string[] | null => {
    const out: string[] = []
    let cur = '', depth = 0
    for (const ch of v) {
        if (ch === '(') depth++
        else if (ch === ')') { depth--; if (depth < 0) return null }
        if (depth === 0 && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; continue }
        cur += ch
    }
    if (depth !== 0) return null
    if (cur) out.push(cur)
    return out
}
// A px or rem length (rem = 16 px), a bare 0, or a percentage as a share of the 360 px page (an upper bound: no containing block is wider); a negative length counts 0 because it widens the box. null otherwise.
const lengthPx = (t: string, percent: boolean): number | null => {
    const m = LENGTH.exec(t)
    if (!m) return null
    const n = parseFloat(m[2])
    let px: number
    if (m[3] === 'px') px = n
    else if (m[3] === 'rem') px = n * 16
    else if (m[3] === '%') { if (!percent) return null; px = n / 100 * VIEW_W }
    else if (n === 0) px = 0
    else return null
    return m[1] === '-' ? 0 : px
}
const tokenPx = (row: ReaderRow, t: string): number | null => {
    if (row.grammar === 'width') return WIDTH_WORDS.get(t) ?? lengthPx(t, false)
    if (row.grammar === 'style') return VISIBLE_STYLES.has(t) ? MEDIUM_PX : t === 'none' || t === 'hidden' ? 0 : null
    if (t === 'auto') return row.kind === 'margin' ? 0 : null
    return lengthPx(t, true)
}
// A border line shorthand: at most one width, one style and one colour, in any order. The stated width counts; without one a visible style counts medium; none, hidden or no style counts 0.
const linePx = (v: string): number | null => {
    const toks = tokensOf(v.replace(COLOUR_FUNCTION, ' '))
    if (!toks || !toks.length) return null
    let colours = (v.match(COLOUR_FUNCTION) ?? []).length, width: number | null = null, style: number | null = null
    for (const t of toks) {
        const w = WIDTH_WORDS.get(t) ?? lengthPx(t, false)
        if (w !== null) {
            if (width !== null) return null
            width = w
        } else if (VISIBLE_STYLES.has(t) || t === 'none' || t === 'hidden') {
            if (style !== null) return null
            style = VISIBLE_STYLES.has(t) ? MEDIUM_PX : 0
        } else if (!CSS_WIDE.has(t) && t !== 'inherit' && t !== 'auto' && isColourWord(t)) {
            if (++colours > 1) return null
        } else return null
    }
    return width ?? style ?? 0
}
const filled = (slots: readonly InsetSlot[], px: number): Reading => {
    const r: Reading = {}
    for (const s of slots) r[s] = px
    return r
}
// the reading of one var()-free alternative of a declaration's value; null when it cannot be measured
const readAlternative = (row: ReaderRow, alt: string): Reading | null => {
    const v = alt.replace(IMPORTANT, '').trim().toLowerCase()
    const toks = tokensOf(v)
    if (!toks || !toks.length) return null
    if (toks.length === 1 && (CSS_WIDE.has(toks[0]) || toks[0] === 'inherit')) {
        // inherit takes the parent's value, and revert the user agent's (40 px of inline padding in a list): neither is modelled. initial and unset are 0 for padding and margin and the medium border everywhere else.
        if (toks[0] === 'inherit') return null
        if (row.kind === 'border') return filled(row.slots, MEDIUM_PX)
        return toks[0] === 'initial' || toks[0] === 'unset' ? filled(row.slots, 0) : null
    }
    if (row.grammar === 'line') {
        const px = linePx(v)
        return px === null ? null : filled(row.slots, px)
    }
    const vals: number[] = []
    for (const t of toks) {
        const px = tokenPx(row, t)
        if (px === null) return null
        vals.push(px)
    }
    if (row.arity === 'box') return vals.length > 4 ? null : { R: vals[1] ?? vals[0], L: vals[3] ?? vals[1] ?? vals[0] }
    if (row.arity === 'pair') return vals.length > 2 ? null : { S: vals[0], E: vals[1] ?? vals[0] }
    return vals.length === 1 ? filled(row.slots, vals[0]) : null
}
const UNREADABLE_FIX_LENGTH = 'write each side as a px or rem length, 0 or a percentage (a margin may also be auto)'
const UNREADABLE_FIX_BORDER = 'write each border side as a px or rem width, 0, thin, medium or thick, with at most one visible style (dotted, dashed, solid, double, groove, ridge, inset or outset) and one colour'

export function geometryPass(text: string, reg: GeometryRegistry): GeometryErrors {
    const errs: GeometryErrors = []
    const fail = (selector: string, prop: string, why: string): void => { errs.push({ selector, prop, why }) }
    const all = decls(text).filter((d) => !d.ctx.keyframes)
    const app: Map<string, string> = reg.app || new Map<string, string>()
    const byName = new Map<string, TokenRead[]>()
    for (const d of all) if (d.prop.startsWith('--')) {
        if (!byName.has(d.prop)) byName.set(d.prop, [])
        byName.get(d.prop)!.push({ v: d.value.replace(/\s*!important\s*$/, '').trim(), cond: d.ctx.at.length > 0 || !/^(:root|html)$/.test(d.ctx.selector.trim()) })
    }
    // every value the pack gives a token, plus the app default while no unconditional root declaration replaces it
    const raws = (n: string): string[] => {
        const out = (byName.get(n) || []).map((x) => x.v)
        if (app.has(n) && !(byName.get(n) || []).some((x) => !x.cond)) out.push(app.get(n)!)
        return out
    }
    // every var()-free alternative of a value; null when a reference does not resolve, recurses past depth 14 or yields more than 256 alternatives
    // Memoised on (value, depth), and the key must keep depth (the depth limit changes the result): nothing else feeds it, and without it a chain of tokens each declared several times expands exponentially (a pack of about 1 KB could take minutes).
    const expanded = new Map<string, string[] | null>()
    const expand = (v: string, depth: number): string[] | null => {
        const key = `${depth}\u0000${v}`
        if (expanded.has(key)) return expanded.get(key)!
        const result = expandOnce(v, depth)
        expanded.set(key, result)
        return result
    }
    const expandOnce = (v: string, depth: number): string[] | null => {
        if (depth > 14) return null
        const m = VAR.exec(v)
        if (!m) return [v]
        let opts: (string | null)[] = raws(m[1]).flatMap((x): (string | null)[] => expand(x, depth + 1) ?? [null])
        if (!opts.length) {
            if (m[2] === undefined) return null
            opts = expand(m[2].trim(), depth + 1) ?? [null]
        }
        const live: string[] = []
        for (const o of opts) {
            if (o === null) return null
            live.push(o)
        }
        const out: string[] = []
        for (const o of [...new Set(live)]) {
            const r = expand(v.slice(0, m.index) + o + v.slice(m.index + m[0].length), depth + 1)
            if (r === null) return null
            out.push(...r)
            if (out.length > 256) return null
        }
        return [...new Set(out)]
    }
    // the largest length a token can take (0 when it has no value at all); NaN when any alternative is not a length
    const worst = (tok: string): number => {
        let w = 0
        for (const r of raws(tok)) {
            const xs = expand(r, 0)
            if (xs === null) return NaN
            for (const x of xs) {
                const n = num(x)
                if (Number.isNaN(n)) return NaN
                if (n > w) w = n
            }
        }
        return w
    }

    // 1. ancestor inset summed along a chain
    const partsOf = (sel: string): string[] => [...(sel.trim().split(/[\s>+~]+/).pop() || '').matchAll(/\[data-part="([^"\]]*)"\]/g)].map((m) => m[1])
    const chainParts = new Set<string>()
    for (const ch of reg.chains || []) for (const p of ch.parts) chainParts.add(p)
    // The reading of a declaration depends only on its own name and value: never on another declaration, its block, its importance or its order. Adding a declaration can therefore only raise a part's measure.
    // Every var() alternative is read and the largest per place kept; a value that cannot be read, or a family name that is not measured, is refused, never read as 0.
    const measured = new Map<string, Record<InsetKind, Sides>>()
    const refusedOnce = new Set<string>()
    const refuse = (part: string, prop: string, value: string, why: string): void => {
        const key = `${part}\u0000${prop}\u0000${value}`
        if (refusedOnce.has(key)) return
        refusedOnce.add(key)
        fail(`[data-part="${part}"]`, prop, why)
    }
    const blankSides = (): Sides => ({ L: 0, R: 0, S: 0, E: 0 })
    if (chainParts.size) for (const d of all) {
        const cls = familyClass(d.prop)
        if (cls === null || cls === 'BLOCK' || cls === 'PAINT' || cls === 'NO-EFFECT') continue
        const named = [...new Set(d.ctx.selector.split(',').flatMap(partsOf).filter((p) => chainParts.has(p)))]
        if (!named.length) continue
        const value = d.value.replace(IMPORTANT, '').trim()
        const row = ROW_BY_PROP.get(d.prop)
        if (cls === 'REFUSED' || !row) {
            for (const p of named) refuse(p, d.prop, value, NOT_A_PROPERTY_SET.has(d.prop)
                ? `${d.prop} is not a CSS property, so it cannot be measured on ${p}, a part around a protected block (DD-260)`
                : `${d.prop} cannot be measured on ${p}, a part around a protected block (DD-260): ${NOT_MEASURED_SET.has(d.prop) ? 'it spaces the cells of a table, which the lint does not model' : 'it is not a padding, margin or border property the lint reads'}`)
            continue
        }
        const alternatives = expand(value, 0)
        const merged: Reading = {}
        let readable = !!alternatives && alternatives.length > 0
        for (const alt of readable ? alternatives! : []) {
            const r = readAlternative(row, alt)
            if (!r) { readable = false; break }
            for (const s of SLOTS) {
                const px = r[s]
                if (px !== undefined) merged[s] = Math.max(merged[s] ?? 0, px)
            }
        }
        for (const p of named) {
            if (!readable) {
                refuse(p, d.prop, value, `${d.prop}: ${value.slice(0, 40)} cannot be measured on ${p}, a part around a protected block (DD-260): ${row.kind === 'border' ? UNREADABLE_FIX_BORDER : UNREADABLE_FIX_LENGTH}`)
                continue
            }
            let kinds = measured.get(p)
            if (!kinds) { kinds = { padding: blankSides(), border: blankSides(), margin: blankSides() }; measured.set(p, kinds) }
            const sides = kinds[row.kind]
            for (const s of SLOTS) sides[s] = Math.max(sides[s], merged[s] ?? 0)
        }
    }
    // One box kind of one part: start is left and end right in a left-to-right page, the reverse in a right-to-left one; each place is floored by the page's own value, the larger reading is kept.
    const across = (x: Sides, floorL: number, floorR: number): number => {
        const l = Math.max(x.L, floorL), r = Math.max(x.R, floorR)
        return Math.max(Math.max(l, x.S) + Math.max(r, x.E), Math.max(l, x.E) + Math.max(r, x.S))
    }
    for (const ch of reg.chains || []) {
        // The page's own padding of a part (ch.defaults, measured in the DOM, split evenly between its sides) is a floor under every pack rule on each side; a conditional rule can state less, so a rule never lowers it.
        const per = new Map<string, number>()
        for (const p of ch.parts) {
            const floor = ((ch.defaults || {})[p] || 0) / 2
            const kinds = measured.get(p)
            per.set(p, across(kinds?.padding ?? blankSides(), floor, floor) + across(kinds?.border ?? blankSides(), 0, 0) + across(kinds?.margin ?? blankSides(), 0, 0))
        }
        const sum = [...per.values()].reduce((a, b) => a + b, 0), budget = ch.budget ?? 120
        if (sum > budget) fail(ch.parts.filter((p) => per.get(p)! > 0).map((p) => `[data-part="${p}"]`).join(' '), 'padding', `ancestor padding along ${ch.name} sums to ${Math.round(sum)} px of ${VIEW_W} (${[...per].filter(([, v]) => v).map(([p, v]) => p + ' ' + Math.round(v)).join(', ')}): over the ${budget} px budget that keeps ${ch.minInner ?? 240} px for the protected block on a phone (DD-260)`)
    }

    // 2. the worst-case height of each protected sheet
    //    A sheet that SCROLLS (max-height with an overflow scroller) is described by { name, terms, cap, fixed, minScroll }:
    //    `terms` the content estimate (an upper bound, reported); `cap` the most the page lets it grow (px); `fixed` the terms that do not scroll (the grab bar and title, the padding outside the scroller).
    //    Its actions stay reachable by scrolling, so what a pack can break is the room left for the scroller: fixed + minScroll (one action row and its padding, default 96 px) must fit under the cap. A sheet with no cap is
    //    judged on its whole height.
    const sum = (terms: readonly SheetTerm[], onBad: (token: string) => void): number | null => {
        let h = 0
        for (const t of terms) {
            if (t.px !== undefined) { h += t.px; continue }
            if (t.t) {
                const w = worst(t.t)
                if (Number.isNaN(w)) { onBad(t.t); return null }
                h += (t.n ?? 1) * w
                continue
            }
            if (t.text) {
                const s = worst(t.text.size)
                if (Number.isNaN(s)) { onBad(t.text.size); return null }
                let hp = t.text.hfixed || 0
                for (const k of t.text.hpad || []) {
                    const w = worst(k)
                    if (Number.isNaN(w)) { onBad(k); return null }
                    hp += 2 * w
                }
                const width = Math.max(40, VIEW_W - hp)
                const lines = Math.ceil(t.text.chars / Math.max(1, Math.floor(width / (s * CHAR_EM))))
                h += lines * s * (t.text.lead ?? 1.4)
            }
        }
        return h
    }
    for (const sh of reg.sheets || []) {
        let bad = null as string | null
        const content = sum(sh.terms, (b) => { bad = b })
        if (bad || content === null) { fail(':root', bad || sh.name, `${sh.name}: the height of the sheet cannot be judged (${bad} does not resolve to a length); a protected sheet must fit a ${VIEW_W}x${VIEW_H} phone (DD-256)`); continue }
        if (sh.cap) {
            const fixed = sh.fixed ? sum(sh.fixed, (b) => { bad = b }) : 0
            if (bad || fixed === null) { fail(':root', bad || sh.name, `${sh.name}: the fixed part of the sheet cannot be judged (${bad})`); continue }
            (errs.heights ||= []).push([sh.name, Math.round(content), Math.round(Math.min(content, sh.cap)), Math.round(fixed)])
            if (fixed + (sh.minScroll ?? 96) > sh.cap) fail(':root', sh.name, `${sh.name}: with every size at the largest value this pack gives it, the part of the sheet that does not scroll is about ${Math.round(fixed)} px and leaves no room for the scrolling actions under the ${Math.round(sh.cap)} px the page allows (DD-256)`)
            continue
        }
        (errs.heights ||= []).push([sh.name, Math.round(content)])
        if (content > VIEW_H) fail(':root', sh.name, `${sh.name}: with every size at the largest value this pack gives it, the sheet is about ${Math.round(content)} px tall and does not fit a ${VIEW_W}x${VIEW_H} phone (${VIEW_H} px): its buttons would leave the screen (DD-256)`)
    }
    return errs
}

/** The height model of every protected sheet at the values a pack gives (used to report the margin). */
export function sheetHeights(text: string, reg: GeometryRegistry): SheetHeightRow[] {
    return geometryPass(text, reg).heights || []
}
