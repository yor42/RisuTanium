// Geometry rules of the shared pack-install validator (DD-256, DD-260). Called by the pack linter with the normalised, private-variable-free pack text and the effective registry.
//   1. ANCESTOR PADDING (DD-260). registry.chains: [{ name, parts: [outer ... inner], budget }]. The horizontal padding and border a pack gives the parts of one chain are SUMMED in the worst case
//      (for each part the largest left + right it gives in any rule); the sum may not exceed the budget (default 120 px: a 360 px phone keeps 240 px for the protected block inside).
//   2. SHEET HEIGHT (DD-256). registry.sheets: [{ name, terms }]. A protected sheet's height at 360 px wide is estimated from the geometry tokens it reads, each at the LARGEST value the pack can give it
//      (every :root, root-attribute and @media alternative; the app default while no unconditional :root declaration replaces it). It may not exceed 640 px (a 360x640 phone), so a pack whose every size is
//      inside its own ceiling but whose sum pushes the buttons off the screen is rejected.
//      terms: { px } a constant; { t: token, n } n times a token; { text: { chars, size: token, lead, hpad: [tokens], hfixed } } a block of text, wrapped at 360 - 2 * (hpad tokens) - hfixed with 1 em per character (Korean).
//      The estimate is a model of the DOM (not a measurement): it is an upper bound built from the part list and token reads.
import { decls } from './csslit'

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
    /** The inset the page itself gives a part (px), replaced by any pack rule that states a horizontal padding or border for it. */
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

    // 1. ancestor padding summed along a chain
    const lens = (v: string): number[] => {
        const r: number[] = []
        for (const x of v.trim().split(/\s+/)) {
            const n = num(x.replace(/!important/, ''))
            r.push(Number.isNaN(n) ? (/%/.test(x) ? 0.2 * VIEW_W : 0) : n)
        }
        return r
    }
    const partsOf = (sel: string): string[] => [...(sel.trim().split(/[\s>+~]+/).pop() || '').matchAll(/\[data-part="([^"\]]*)"\]/g)].map((m) => m[1])
    const resolveVars = (v: string): string[] => {
        const xs = expand(v, 0)
        return xs && xs.length ? xs : [v]
    }
    // largest horizontal padding + border width a rule gives, over the alternatives of its var()s
    const inset = (block: Map<string, string>): number => {
        let best = 0
        const val = (p: string): string | undefined => block.get(p)
        const cands: number[] = []
        const sh = val('padding')
        if (sh) for (const x of resolveVars(sh)) {
            const l = lens(x)
            const [r, lft] = [l[1] ?? l[0], l[3] ?? l[1] ?? l[0]]
            cands.push(r + lft)
        }
        const side = (p: string): number => {
            const v = val(p)
            return v ? Math.max(...resolveVars(v).map((x) => lens(x)[0] || 0)) : 0
        }
        const pl = Math.max(side('padding-left'), side('padding-inline-start'), side('padding-inline')), pr = Math.max(side('padding-right'), side('padding-inline-end'), side('padding-inline'))
        cands.push(pl + pr)
        const bw = ((): number => {
            const v = val('border') || val('border-width') || val('border-left-width') || val('border-right-width')
            return v ? Math.max(...resolveVars(v).map((x) => lens(x)[0] || 0)) * 2 : 0
        })()
        for (const c of cands) best = Math.max(best, c)
        return best + bw
    }
    const hasInset = (block: Map<string, string>): boolean => ['padding', 'padding-left', 'padding-right', 'padding-inline', 'padding-inline-start', 'padding-inline-end', 'border', 'border-width', 'border-left-width', 'border-right-width'].some((p) => block.has(p))
    const blocks = new Map<string, Map<string, string>>()
    for (const d of all) {
        if (d.prop.startsWith('--')) continue
        const k = d.ctx.selector.trim()
        if (!blocks.has(k)) blocks.set(k, new Map<string, string>())
        blocks.get(k)!.set(d.prop, d.value.trim())
    }
    for (const ch of reg.chains || []) {
        // each part has the inset the page gives it (ch.defaults, measured in the DOM); a pack rule that states a horizontal padding or border for the part replaces it (the largest such value counts)
        const per = new Map<string, number>(ch.parts.map((p): [string, number] => [p, (ch.defaults || {})[p] || 0]))
        const packSet = new Map<string, number>()
        for (const [sel, block] of blocks) for (const s of sel.split(',')) {
            const ps = partsOf(s)
            if (!hasInset(block)) continue
            const i = inset(block)
            for (const p of ps) if (per.has(p) && i > (packSet.get(p) ?? -1)) packSet.set(p, i)
        }
        for (const [p, v] of packSet) per.set(p, v)
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
