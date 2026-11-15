// The value rules of the theme-pack validator (MC-1549, MC-1550, MC-1555, MC-1556, MC-1564, MC-1565). The engine measures
// sizes with patterns that take the largest number and score what they cannot read as zero, and it keeps one value per
// token. A pack is therefore held to a normal form in which that single reading is the value the browser uses:
//   N1  a token other than --pack-* is set once, on plain :root; a --pack-* helper may vary by state but needs a plain
//       :root value; no `!`, no empty or CSS-wide value, no unknown reference, no cycle, a chain of at most 8 tokens.
//   N2  var() is exactly var(--name): no fallback, set apart from the text around it, naming a token that has a value.
//   N3  every length is px or rem, only allow-listed functions compute a value, percent appears only where the engine
//       reads it; the rules judge the written value and every value var() reaches, app token values included.
// plus the font size, line height, bounded-token and font family rules. The engine is untouched; this pass only adds
// refusals. Colour readings (oklch, hwb, lab and the like on focus and contrast checks) are not closed here.
import { decls, type Decl } from './csslit'
import { normalise, type LintError } from './engine'
import { FAMILY_IDENT, FAMILY_IDENT_REASON, GENERIC_FAMILIES } from './fontFace'
import { judgeFamilyList, splitFontShorthand, splitTop, SYSTEM_FONTS } from './structure'
import { tokenFile, type TokenFile } from './tokens'

/** The font tokens a pack may set, judged as font-family wherever they are declared or reached. */
export const FONT_TOKENS: readonly string[] = ['--font', '--mono', '--settings-font', '--home-font', '--home-mono', '--studio-font-mono', '--chat-message-font']
/** Font tokens whose value may name only the pack's own families, generic families and --pack-* helpers that resolve to those: a var() of any app token is refused, even one the pack sets itself. */
export const STRICT_FONT_TOKENS: readonly string[] = ['--chat-message-font']
/** Tokens the engine bounds only through its largest-number reading: each must be one plain length (rule B). */
export const BOUNDED_TOKENS: readonly string[] = ['--size-touch-lg', '--size-touch', '--font-size-sm', '--font-size-md', '--font-size-base', '--sheet-padding-x', '--sheet-padding-bottom', '--control-padding-x', '--item-padding-x', '--item-gap', '--focus-ring-w', '--focus-ring-w-forced']

export interface ValueEnv {
    /** The font families the pack registers with @font-face (lower case). */
    ownFamilies: ReadonlySet<string>
    /** Every value of each custom property in the area's app token files (lower case). */
    app: ReadonlyMap<string, readonly string[]>
    /** The canonical stylesheet before the @font-face blocks were taken out, case kept; the family names reached through tokens are judged on it. */
    source?: string
}

/** Every custom-property declaration in every block of the named token files, as the reference reads them but kept as a list. */
export function readAppValues(files: readonly TokenFile[]): Map<string, string[]> {
    const out = new Map<string, string[]>()
    for (const file of files) {
        for (const m of normalise(tokenFile(file)).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
            const list = out.get(m[1])
            if (list) list.push(m[2].trim())
            else out.set(m[1], [m[2].trim()])
        }
    }
    return out
}

const CSS_WIDE: ReadonlySet<string> = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer'])
const COLOUR_FUNCTIONS: ReadonlySet<string> = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix'])
const GRADIENT = /^(?:repeating-)?(?:linear|radial|conic)-gradient$/
const PLAIN_FUNCTIONS: ReadonlySet<string> = new Set(['var', 'url', 'image-set', '-webkit-image-set', 'minmax', 'repeat', 'fit-content', 'cubic-bezier', 'steps', 'rect'])
const RELATIVE_UNIT = /(?<![\w.#])(-?(?:\d+\.?\d*|\.\d+))(em|ex|ch|vw|vh|vmin|vmax|pt|cm|mm|in)(?![\w-])/g
const PERCENT = /(?<![\w.#])-?(?:\d+\.?\d*|\.\d+)%/g
const PERCENT_PROPS = /^(?:width|min-width|max-width|height|min-height|max-height|(?:min-|max-)?(?:block|inline)-size|flex-basis|flex|padding(?:-[a-z-]+)?|gap|row-gap|column-gap|border(?:-[a-z]+)*-radius|background-position|background-size)$/
const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem)$/
const VAR_EXACT = /^var\(\s*(--[a-z0-9_-]+)\s*\)$/
const NEGATION_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)[a-z%]*$/
const MAX_CHAIN = 8
const MAX_DEPTH = 12

interface Call {
    name: string
    nameStart: number
    open: number
    close: number
    parent: number
    inColour: boolean
}

/** Finds every function call (and plain parenthesis, name '') of a value; strings and unquoted url() bodies are opaque. */
function parseCalls(v: string): { calls: Call[], balanced: boolean } {
    const calls: Call[] = []
    const stack: number[] = []
    let balanced = true
    let i = 0
    const n = v.length
    const push = (name: string, nameStart: number, open: number): number => {
        const parent = stack.length ? stack[stack.length - 1] : -1
        const inColour = parent >= 0 && (calls[parent].inColour || COLOUR_FUNCTIONS.has(calls[parent].name))
        calls.push({ name, nameStart, open, close: -1, parent, inColour })
        return calls.length - 1
    }
    while (i < n) {
        const ch = v[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < n && v[j] !== ch && v[j] !== '\n') j++
            i = j + 1
            continue
        }
        if (/[a-z0-9_-]/i.test(ch)) {
            let j = i
            while (j < n && /[a-z0-9_-]/i.test(v[j])) j++
            if (v[j] === '(') {
                const name = v.slice(i, j).toLowerCase()
                const index = push(name, i, j)
                if (name === 'url') {
                    let k = j + 1
                    while (k < n && /[ \t\n]/.test(v[k])) k++
                    if (v[k] !== '"' && v[k] !== "'") {
                        const close = v.indexOf(')', k)
                        if (close < 0) { balanced = false; calls[index].close = n; i = n } else { calls[index].close = close; i = close + 1 }
                        continue
                    }
                }
                stack.push(index)
                i = j + 1
                continue
            }
            i = j
            continue
        }
        if (ch === '(') { stack.push(push('', i, i)); i++; continue }
        if (ch === ')') {
            const index = stack.pop()
            if (index === undefined) balanced = false
            else calls[index].close = i
            i++
            continue
        }
        i++
    }
    for (const index of stack) { calls[index].close = n; balanced = false }
    return { calls, balanced }
}

/** The value with strings, url() bodies, colour-function arguments (and gradient arguments when asked) blanked to spaces. */
function masked(v: string, calls: Call[], gradients: boolean): string {
    const chars = v.split('')
    const blank = (from: number, to: number) => { for (let k = Math.max(0, from); k < Math.min(chars.length, to); k++) chars[k] = ' ' }
    for (let i = 0; i < v.length; i++) {
        const ch = v[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < v.length && v[j] !== ch && v[j] !== '\n') j++
            blank(i + 1, j)
            i = j
        }
    }
    for (const call of calls) {
        if (COLOUR_FUNCTIONS.has(call.name) || call.name === 'url' || (gradients && GRADIENT.test(call.name))) blank(call.open + 1, call.close)
    }
    return chars.join('')
}

function stripImportant(v: string): string {
    return v.replace(/\s*!\s*important\s*$/i, '').trim()
}

const siteOf = (d: Decl): string => (d.ctx.at.length ? `${d.ctx.at.join(' ')} ${d.ctx.selector.trim()}` : d.ctx.selector.trim()).trim()
const isPlainRoot = (d: Decl): boolean => d.ctx.selector.trim() === ':root' && d.ctx.at.length === 0

interface TokenSite { value: string, plain: boolean }

/** The token index the rules share: every pack declaration of each custom property, and the resolver R. */
function buildIndex(text: string, env: ValueEnv, all: Decl[]) {
    const sites = new Map<string, TokenSite[]>()
    for (const d of all) {
        if (!d.prop.startsWith('--')) continue
        const list = sites.get(d.prop)
        const site = { value: d.value, plain: isPlainRoot(d) }
        if (list) list.push(site)
        else sites.set(d.prop, [site])
    }
    /** Every value `var(name)` can take: all declared values of a --pack-* helper; for any other token the pack's last plain-root value, else the app's values. */
    const R = (name: string, withApp: boolean): string[] => {
        const own = sites.get(name)
        if (name.startsWith('--pack-')) return own ? own.map((s) => s.value) : []
        const plain = own?.filter((s) => s.plain) ?? []
        const out: string[] = []
        if (plain.length) out.push(plain[plain.length - 1].value)
        else if (own) out.push(...own.map((s) => s.value))
        if (!plain.length || withApp) out.push(...(env.app.get(name) ?? []))
        return out
    }
    const known = (name: string): boolean => sites.has(name) || env.app.has(name)
    // The longest var() chain starting at a token, saturating at MAX_CHAIN + 1; -1 marks a cycle.
    const memo = new Map<string, number>()
    const running = new Set<string>()
    const chain = (name: string, level: number): number => {
        const hit = memo.get(name)
        if (hit !== undefined) return hit
        if (running.has(name)) return -1
        if (level > 64) return MAX_CHAIN + 1
        running.add(name)
        let deepest = 0
        let cycle = false
        for (const value of R(name, false)) {
            for (const m of value.matchAll(/var\(\s*(--[a-z0-9_-]+)/g)) {
                const next = chain(m[1], level + 1)
                if (next < 0) cycle = true
                else deepest = Math.max(deepest, next)
            }
        }
        running.delete(name)
        const result = cycle ? -1 : Math.min(MAX_CHAIN + 1, 1 + deepest)
        if (level <= 64) memo.set(name, result)
        return result
    }
    return { sites, R, known, chain }
}

/** The values a token takes in the stylesheet, as the rules read them (unit-test entry point). */
export function tokenValues(canon: string, name: string, env: ValueEnv, withApp = false): string[] {
    const text = normalise(canon)
    return buildIndex(text, env, decls(text)).R(name, withApp)
}

export function valueRulesPass(canon: string, env: ValueEnv): LintError[] {
    const text = normalise(canon)
    const all = decls(text)
    const { sites, R, known, chain } = buildIndex(text, env, all)
    const errors: LintError[] = []
    const seen = new Set<string>()
    const push = (selector: string, prop: string, why: string) => {
        const key = `${selector}|${prop}|${why}`
        if (!seen.has(key)) { seen.add(key); errors.push({ selector, prop, why }) }
    }
    const report = (d: Decl, why: string) => push(d.ctx.selector.trim() || '(stylesheet)', d.prop, why)

    const operand = (a: string, depth: number): boolean => {
        const t = a.trim()
        if (NEGATION_NUMBER.test(t)) return true
        const v = VAR_EXACT.exec(t)
        if (v) {
            if (depth > MAX_DEPTH) return false
            const values = R(v[1], true)
            return values.length > 0 && values.every((x) => operand(x, depth + 1))
        }
        return negation(t, depth)
    }
    /** `calc(A * -1)` or `calc(-1 * A)` with A an operand. */
    const negation = (expr: string, depth: number): boolean => {
        const t = expr.trim()
        if (!t.startsWith('calc(') || !t.endsWith(')')) return false
        const parts = splitTop(t.slice(5, -1), '*')
        if (parts.length !== 2) return false
        const [left, right] = [parts[0].trim(), parts[1].trim()]
        if (right === '-1') return operand(left, depth + 1)
        if (left === '-1') return operand(right, depth + 1)
        return false
    }

    /** N3a, N3b and N3c over one value as written; `via` names the token when the value was reached through var(). */
    const judgeLiteral = (v: string, prop: string, percentOk: boolean | null, via: string | null, out: string[]) => {
        const { calls } = parseCalls(v)
        const suffix = via ? ` (through var(${via}))` : ''
        const reachedPrefix = via ? `${prop || 'a value'} uses var(${via}), whose value ${v.trim().slice(0, 60)} ` : ''
        for (const m of masked(v, calls, false).matchAll(RELATIVE_UNIT)) {
            out.push(via
                ? `${reachedPrefix}is in ${m[2]}: only px and rem lengths are allowed, also through tokens (MC-1564)`
                : `only px and rem lengths are allowed (${m[0]}): ${m[2]} depends on the font size or the screen, which the checks do not know (MC-1549, MC-1555)`)
        }
        for (const call of calls) {
            let allowed: boolean
            if (call.inColour) allowed = call.name === '' || call.name === 'var' || call.name === 'calc' || COLOUR_FUNCTIONS.has(call.name)
            else if (call.name === '') allowed = true
            else if (call.name === 'calc') allowed = negation(v.slice(call.nameStart, call.close + 1), 0)
            else allowed = PLAIN_FUNCTIONS.has(call.name) || COLOUR_FUNCTIONS.has(call.name) || GRADIENT.test(call.name)
            if (!allowed) out.push(`${call.name || '('}() is not allowed in a pack${call.name === 'calc' ? ' except as calc(<x> * -1)' : ''} (allowed: var(), colour functions, gradients, url(), image-set(), calc(<x> * -1), minmax(), repeat(), fit-content(), cubic-bezier(), steps(), rect()) (MC-1549, MC-1555)${suffix}`)
        }
        if (percentOk === false) {
            for (const m of masked(v, calls, true).matchAll(PERCENT)) out.push(`a percentage is not allowed in ${prop} (${m[0]}): the checks read it as 0 there (MC-1549, MC-1555)${suffix}`)
        }
    }

    // The messages for everything a token reaches, memoised per token, property and percent allowance.
    const reachMemo = new Map<string, string[]>()
    const reaching = new Set<string>()
    const reach = (name: string, prop: string, percentOk: boolean, depth: number): string[] => {
        const key = `${name}|${prop}|${percentOk}`
        const hit = reachMemo.get(key)
        if (hit) return hit
        if (reaching.has(key) || depth > MAX_DEPTH) return []
        reaching.add(key)
        const out: string[] = []
        for (const value of R(name, false)) {
            judgeLiteral(value, prop, percentOk, name, out)
            const { calls } = parseCalls(value)
            for (const call of calls) {
                if (call.name !== 'var' || call.inColour) continue
                const m = VAR_EXACT.exec(value.slice(call.nameStart, call.close + 1))
                if (m && m[1] !== '--pack-') out.push(...reach(m[1], prop, percentOk, depth + 1))
            }
        }
        reaching.delete(key)
        reachMemo.set(key, out)
        return out
    }

    // True when the value, followed through var() with the app values included, is made only of terminals the predicate accepts.
    const everyForm = (v: string, accept: (terminal: string) => boolean, depth: number, active: ReadonlySet<string>): boolean => {
        const t = v.trim()
        const ref = VAR_EXACT.exec(t)
        if (!ref) return accept(t)
        if (depth > MAX_DEPTH || active.has(ref[1])) return false
        const values = R(ref[1], true)
        const next = new Set(active).add(ref[1])
        return values.length > 0 && values.every((x) => everyForm(x, accept, depth + 1, next))
    }
    const fontSizeTerminal = (t: string): boolean => {
        if (CSS_WIDE.has(t)) return true
        const m = LENGTH.exec(t)
        return !!m && parseFloat(m[1]) > 0
    }
    const lineHeightTerminal = (t: string): boolean => CSS_WIDE.has(t) || t === 'normal' || /^(?:\d+\.?\d*|\.\d+)$/.test(t) || (!!LENGTH.exec(t) && parseFloat(t) >= 0)
    const FONT_SIZE_REASON = 'a font size must be one px or rem length above 0, a CSS-wide keyword or a token of those (no percent, keyword, function or zero): the checks measure only plain lengths (MC-1549, MC-1555)'
    const LINE_HEIGHT_REASON = 'a line height must be a plain number, a px or rem length, normal or a CSS-wide keyword (MC-1555)'

    // Rule F: a font family list names only the pack's own @font-face families and the generic families.
    const familyReason = (name: string): string => `font family "${name}" is not allowed: a pack may name only its own @font-face families and the generic families (MC-1550)`
    // In strict mode a var() item passes only as a --pack-* helper the pack declares; its values are judged strictly too.
    const judgeFamilies = (list: string, depth: number, active: ReadonlySet<string>, out: string[], strict = false) => {
        const whole = list.trim()
        if (CSS_WIDE.has(whole)) return
        for (const item of splitTop(whole, ',')) {
            const it = item.trim()
            if (it === '') { out.push('a font family list may not have an empty item: remove the extra comma (MC-1550)'); continue }
            const quoted = /^(?:"([^"\\\n]*)"|'([^'\\\n]*)')$/.exec(it)
            if (quoted) {
                const name = quoted[1] ?? quoted[2]
                if (/[^\u0000-\u007f]/.test(name) || !env.ownFamilies.has(name)) out.push(familyReason(name))
                continue
            }
            const ref = VAR_EXACT.exec(it)
            if (ref) {
                const declared = sites.get(ref[1])
                if (strict && !ref[1].startsWith('--pack-')) out.push(familyReason(`var(${ref[1]})`))
                else if (!declared) {
                    if (!FONT_TOKENS.includes(ref[1])) out.push(familyReason(`var(${ref[1]})`))
                } else if (depth > MAX_DEPTH || active.has(ref[1])) out.push(familyReason(`var(${ref[1]})`))
                else {
                    const next = new Set(active).add(ref[1])
                    for (const s of declared) judgeFamilies(s.value, depth + 1, next, out, strict)
                }
                continue
            }
            const words = it.split(/\s+/)
            let bad = false
            for (const word of words) {
                if (!FAMILY_IDENT.test(word)) { out.push(FAMILY_IDENT_REASON(word)); bad = true; break }
            }
            if (bad) continue
            if (words.length === 1 && GENERIC_FAMILIES.has(words[0])) continue
            // A run of words is one family name; a generic or CSS-wide word inside it makes it a name only if the pack registers it.
            const name = words.join(' ')
            if (!env.ownFamilies.has(name)) out.push(familyReason(name))
        }
    }

    const usedPack = new Map<string, Decl>()
    for (const d of all) {
        const custom = d.prop.startsWith('--')
        const value = custom ? d.value.trim() : stripImportant(d.value)
        const { calls, balanced } = parseCalls(value)

        // N1: token declarations
        if (custom) {
            if (d.prop === '--pack-') report(d, 'the bare name --pack- is not a helper token: add a name after the prefix, for example --pack-gap (DD-258)')
            else if (!d.prop.startsWith('--pack-') && !isPlainRoot(d)) report(d, `${d.prop} is set on ${siteOf(d)}: a pack may set tokens only on :root; for a value that changes with the input or layout, set a --pack-* helper there and point the token at it on :root (MC-1565)`)
            if (value.includes('!')) report(d, `"!" is not allowed in a token value (${d.prop}): the browser drops or reorders the declaration in a way the checks do not read (MC-1564)`)
            if (value === '') report(d, `${d.prop} may not be empty: the browser then uses a value the checks do not see; give it a value or remove the declaration (MC-1549)`)
            else if (CSS_WIDE.has(value)) report(d, `${d.prop} may not be ${value}: the browser then uses a value the checks do not see; write the value out (MC-1549)`)
            const depth = chain(d.prop, 0)
            if (depth < 0) report(d, `${d.prop} refers to itself through var(): remove one reference of the cycle (MC-1549)`)
            else if (depth > MAX_CHAIN) report(d, `the var() chain from ${d.prop} is deeper than ${MAX_CHAIN} tokens: point it at a shorter chain (MC-1549)`)
        }

        // N2: every var() in the value
        if (!balanced) report(d, `var() must be exactly var(--name), without a fallback (${value.slice(0, 60)}): the checks do not read fallbacks (MC-1564)`)
        for (const call of calls) {
            if (call.name !== 'var') continue
            const written = value.slice(call.nameStart, call.close + 1)
            const ref = VAR_EXACT.exec(written)
            if (!ref) { report(d, `var() must be exactly var(--name), without a fallback (${written.slice(0, 60)}): the checks do not read fallbacks (MC-1564)`); continue }
            const before = value[call.nameStart - 1]
            const after = value[call.close + 1]
            if ((before !== undefined && !/[\s,/()]/.test(before)) || (after !== undefined && !/[\s,/()]/.test(after))) report(d, `var() must stand apart from the text around it (${value.slice(Math.max(0, call.nameStart - 8), call.close + 9)}): write a space (MC-1564)`)
            if (ref[1] === '--pack-') { report(d, 'the bare name --pack- is not a helper token: add a name after the prefix, for example --pack-gap (DD-258)'); continue }
            if (ref[1].startsWith('--pack-') && !usedPack.has(ref[1])) usedPack.set(ref[1], d)
            if (!call.inColour) {
                if (!known(ref[1])) report(d, custom ? `${d.prop} uses var(${ref[1]}), which neither the pack nor the app defines: declare it on :root or use a token the app defines (MC-1549)` : `var(${ref[1]}) names no token of the pack or the app: the checks cannot read its value (MC-1549)`)
            }
        }

        // N3: the written value, and every value reached through var()
        const percentOk: boolean | null = custom ? null : PERCENT_PROPS.test(d.prop)
        const own: string[] = []
        judgeLiteral(value, d.prop, percentOk, null, own)
        for (const call of calls) {
            if (call.name !== 'var' || call.inColour) continue
            const ref = VAR_EXACT.exec(value.slice(call.nameStart, call.close + 1))
            if (ref && ref[1] !== '--pack-') own.push(...reach(ref[1], d.prop, percentOk !== false, 0))
        }
        for (const why of own) report(d, why)

        // font size, line height and font families
        if (d.prop === 'font-size') {
            if (!everyForm(value, fontSizeTerminal, 0, new Set())) report(d, FONT_SIZE_REASON)
        } else if (d.prop === 'line-height') {
            if (!everyForm(value, lineHeightTerminal, 0, new Set())) report(d, LINE_HEIGHT_REASON)
        } else if (d.prop === 'font-family') {
            const out: string[] = []
            judgeFamilies(value, 0, new Set(), out)
            for (const why of out) report(d, why)
        } else if (d.prop === 'font' && !CSS_WIDE.has(value)) {
            if (/var\(/.test(value)) report(d, 'var() is not allowed in the font shorthand: write font-family and font-size separately (MC-1556)')
            else {
                const split = splitFontShorthand(value)
                if (!split) report(d, SYSTEM_FONTS.has(value.split(/\s+/)[0]) ? `the font shorthand may not name a system font (${value.slice(0, 40)}): a pack may name only its own @font-face families and the generic families (MC-1550)` : 'the font shorthand needs a size and a family (MC-1550)')
                else {
                    if (!everyForm(split.size, fontSizeTerminal, 0, new Set())) report(d, FONT_SIZE_REASON)
                    if (split.lineHeight !== undefined && !everyForm(split.lineHeight, lineHeightTerminal, 0, new Set())) report(d, LINE_HEIGHT_REASON)
                    if (split.family === '') report(d, 'the font shorthand needs a size and a family (MC-1550)')
                    else {
                        const out: string[] = []
                        judgeFamilies(split.family, 0, new Set(), out)
                        for (const why of out) report(d, why)
                    }
                }
            }
        } else if (custom && FONT_TOKENS.includes(d.prop)) {
            const out: string[] = []
            judgeFamilies(value, 0, new Set([d.prop]), out, STRICT_FONT_TOKENS.includes(d.prop))
            for (const why of out) report(d, why)
        }

        // rule B: the bounded tokens are one plain length
        if (custom && BOUNDED_TOKENS.includes(d.prop) && isPlainRoot(d)) {
            const terminals: string[] = []
            const collect = (v: string, level: number): boolean => {
                const ref = VAR_EXACT.exec(v.trim())
                if (!ref) { terminals.push(v.trim()); return true }
                const values = R(ref[1], false)
                if (level > MAX_DEPTH || values.length === 0) return false
                return values.every((x) => collect(x, level + 1))
            }
            const resolved = collect(value, 0)
            const shape = (t: string): boolean => LENGTH.test(t) || t === '0'
            if (!resolved || !terminals.every(shape)) report(d, `${d.prop} must be one plain length: the checks read only its largest number (MC-1549)`)
            else if (d.prop === '--focus-ring-w-forced' && terminals.some((t) => { const m = LENGTH.exec(t); return !m || parseFloat(m[1]) * (m[2] === 'rem' ? 16 : 1) < 1 })) report(d, '--focus-ring-w-forced below 1px removes the focus ring in forced colours (DD-243)')
        } else if (custom && BOUNDED_TOKENS.includes(d.prop)) {
            // set off plain :root (refused by N1r): still shape-checked so the reason is complete
            if (!/^(?:-?(?:\d+\.?\d*|\.\d+)(?:px|rem)|0|var\([^)]*\))$/.test(value)) report(d, `${d.prop} must be one plain length: the checks read only its largest number (MC-1549)`)
        }
    }

    // N1q: a --pack-* helper that is used needs a plain :root value
    for (const [name, user] of usedPack) {
        if (!sites.get(name)?.some((s) => s.plain)) report(user, `${name} is used but has no value on :root: give it a :root value outside @media, so every element has a value the checks read (DD-258, MC-1565)`)
    }

    // I2t: family names reached through tokens, judged as written (case kept)
    if (env.source !== undefined) {
        const familyTokens = new Set<string>(FONT_TOKENS)
        const queue: string[] = []
        const note = (list: string) => { for (const m of list.matchAll(/var\(\s*(--[a-z0-9_-]+)/g)) if (!familyTokens.has(m[1])) { familyTokens.add(m[1]); queue.push(m[1]) } }
        for (const d of all) {
            if (d.prop === 'font-family') note(d.value)
            else if (d.prop === 'font') note(splitFontShorthand(stripImportant(d.value))?.family ?? '')
        }
        for (const name of FONT_TOKENS) queue.push(name)
        while (queue.length) {
            const name = queue.pop()!
            for (const s of sites.get(name) ?? []) note(s.value)
        }
        for (const d of decls(env.source)) {
            if (!d.prop.startsWith('--') || !familyTokens.has(d.prop.toLowerCase())) continue
            for (const why of judgeFamilyList(stripImportant(d.value))) report(d, why)
        }
    }
    return errors
}
