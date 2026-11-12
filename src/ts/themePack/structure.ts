// The browser and the reference engine must split a stylesheet into the same statements, blocks and declarations, and must
// read the same name wherever a name's case matters. This pass judges the canonical text (canonical.ts: no comments, no
// escapes, strings and url() intact) for exactly that, before the engine's patterns see it:
//   N0  one statement structure: only rules, @media blocks of rules and top-level @font-face blocks; no `;` or other text
//       between statements; `@` only at the start of a statement; no `[` or `]` in a rule block; every declaration is
//       name:value; every rule has a selector; brackets close in order (MC-1549).
//   I2  a case-significant span is ASCII and unchanged by the engine's own normalise() (MC-1568): custom property names
//       and var() references, class and id selectors, unquoted attribute values, font family names, and selector
//       attribute names (SVG attribute names are case-sensitive).
//   I3  a string in a selector or at-rule prelude holds only a-z, 0-9, - and _ (MC-1568).
// Case-insensitive keyword spans (property names, keywords, function names, `html`, `:root`, pseudo-classes, hex colours)
// are not judged: the browser and the engine both fold them.
// Invariant: if the engine or a registry ever compares a new case-kept span (a tag, an animation or container name),
// that span must be added to I2 with a reproducer.
import { normalise } from './engine'

export interface StructureError {
    selector: string
    prop: string
    why: string
}

/** The generic families and CSS-wide keywords: never judged as family names. */
const FAMILY_KEYWORDS: ReadonlySet<string> = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', 'initial', 'inherit', 'unset', 'revert', 'revert-layer'])
const SIZE_KEYWORDS: ReadonlySet<string> = new Set(['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large', 'larger', 'smaller', 'math'])
/** The `font` shorthand's system keywords. */
export const SYSTEM_FONTS: ReadonlySet<string> = new Set(['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar'])

const ID_CHAR = /[A-Za-z0-9_-]/
const PROPERTY_NAME = /^(?:--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z0-9-]*)$/
const STRING_LITERAL = /"[^"\n]*"|'[^'\n]*'/g
const SELECTOR_STRING = /^[a-z0-9_-]*$/

/**
 * Whether a span survives the engine's fold: every character is ASCII and normalise() leaves it unchanged. A span whose
 * case the browser keeps but the engine folds would be read as a different name by the checks.
 */
export function caseSafe(span: string): boolean {
    return /^[\u0000-\u007f]*$/.test(span) && normalise(span) === span
}

const excerpt = (text: string): string => JSON.stringify(text.trim().slice(0, 60))

const N0A = (text: string): string => `text outside a rule (${excerpt(text)}): the browser joins it to the next rule and drops that rule, the checks do not (MC-1549)`
const N0B = (text: string): string => `@ may only start a statement (${excerpt(text)}): put @media and @font-face blocks on their own (MC-1549)`
const N0C = (text: string): string => `square brackets are not allowed in a rule block (${excerpt(text)}): the browser reads the rest of the block differently from the checks (MC-1549)`
const N0D = (text: string): string => `every part of a rule block must be one name:value declaration (${excerpt(text)}): write each as name:value and end it with a semicolon (MC-1549)`
const N0E = (text: string): string => `a rule needs a selector on each side of every comma and combinator (${excerpt(text)}): add the missing selector or remove the stray comma or combinator (MC-1549)`
const N0F = (text: string): string => `brackets must close in order (${excerpt(text)}): a ] cannot close a ( and a ) cannot close a [ (MC-1549)`
const I3_REASON = (text: string): string => `an attribute value or at-rule string in a selector or prelude may hold only a-z, 0-9, - and _ (${excerpt(text)}): write the part, role or state name exactly as the app does, in lower case (MC-1568)`
const ATTRIBUTE_NAME_REASON = (text: string): string => `an attribute name in a selector must be written in lower case (${excerpt(text)}): attribute names on SVG elements are case-sensitive, so the browser and the checks could read two different names (MC-1568)`

function caseReason(where: string, text: string): string {
    if (/[^\u0000-\u007f]/.test(text)) return `${where} may hold only ASCII characters (${excerpt(text)}): letters such as the Kelvin sign or a dotted capital I change when the checks fold case and the browser does not fold them (MC-1568)`
    return `${where} must be written in lower case (${excerpt(text)}): the browser keeps the case of ${where} but the checks fold it, so they would read a different name (MC-1568)`
}

/** Splits `text` at top-level occurrences of `separator`, skipping strings and (), [] groups. */
export function splitTop(text: string, separator: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < text.length && text[j] !== ch && text[j] !== '\n') j++
            i = j
            continue
        }
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
        else if (ch === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
    }
    parts.push(text.slice(start))
    return parts
}

/** The top-level whitespace-separated tokens of a value, with their offsets. */
function topTokens(value: string): { text: string, start: number, end: number }[] {
    const tokens: { text: string, start: number, end: number }[] = []
    let depth = 0
    let start = -1
    const close = (end: number) => { if (start >= 0) { tokens.push({ text: value.slice(start, end), start, end }); start = -1 } }
    for (let i = 0; i < value.length; i++) {
        const ch = value[i]
        if (/\s/.test(ch) && depth === 0) { close(i); continue }
        if (start < 0) start = i
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < value.length && value[j] !== ch && value[j] !== '\n') j++
            i = j
            continue
        }
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1)
    }
    close(value.length)
    return tokens
}

export interface FontShorthand {
    /** The size token, as written. */
    size: string
    /** The `/` line-height token, when written. */
    lineHeight?: string
    /** The family list: everything after the size and line height. */
    family: string
}

/**
 * Splits the `font` shorthand at its size: the first top-level token whose head is a length, a percent, a size keyword
 * or a function (unitless numbers are weights or angles and are skipped). Null when there is no size.
 */
export function splitFontShorthand(value: string): FontShorthand | null {
    const tokens = topTokens(value.replace(/\s*!\s*important\s*$/i, ''))
    const text = value.replace(/\s*!\s*important\s*$/i, '')
    for (let k = 0; k < tokens.length; k++) {
        const token = tokens[k]
        const head = token.text.split('/')[0]
        const isSize = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z]+|%)$/.test(head) || SIZE_KEYWORDS.has(head.toLowerCase()) || /^[A-Za-z-]+\(/.test(head)
        if (!isSize) continue
        let end = token.end
        let size = head
        let lineHeight: string | undefined
        const slash = token.text.indexOf('/')
        if (slash >= 0) {
            lineHeight = token.text.slice(slash + 1)
            if (lineHeight === '' && k + 1 < tokens.length) { lineHeight = tokens[k + 1].text; end = tokens[k + 1].end; k++ }
        } else if (k + 1 < tokens.length && tokens[k + 1].text.startsWith('/')) {
            const next = tokens[k + 1]
            lineHeight = next.text.slice(1)
            end = next.end
            if (lineHeight === '' && k + 2 < tokens.length) { lineHeight = tokens[k + 2].text; end = tokens[k + 2].end }
        }
        size = size.trim()
        return { size, lineHeight, family: text.slice(end).trim() }
    }
    return null
}

/** The case-significant words of a family list as written: strings, and identifiers that are not keywords, functions or dashed idents. */
export function familyWords(list: string): string[] {
    const words: string[] = []
    for (const item of splitTop(list, ',')) {
        const text = item.trim()
        if (!text) continue
        const quoted = /^(["'])([\s\S]*)\1$/.exec(text)
        if (quoted) { words.push(quoted[2]); continue }
        for (const token of text.split(/\s+/)) {
            if (!token || /[()]/.test(token) || token.startsWith('--')) continue
            if (FAMILY_KEYWORDS.has(token.toLowerCase())) continue
            words.push(token)
        }
    }
    return words
}

/** Judges the family names written in a family list; returns the reasons. */
export function judgeFamilyList(list: string): string[] {
    const reasons: string[] = []
    for (const word of familyWords(list)) if (!caseSafe(word)) reasons.push(caseReason('a font family name', word))
    return reasons
}

export function structurePass(css: string): StructureError[] {
    const errors: StructureError[] = []
    const seen = new Set<string>()
    const fail = (prop: string, why: string) => {
        const key = `${prop}|${why}`
        if (!seen.has(key)) { seen.add(key); errors.push({ selector: '(stylesheet)', prop, why }) }
    }
    type Kind = 'media' | 'rule' | 'fontface' | 'other'
    const blocks: Kind[] = []
    const groups: string[] = []
    const n = css.length
    let start = 0
    let i = 0
    const top = (): Kind | undefined => blocks[blocks.length - 1]
    const inDeclarations = (): boolean => { const t = top(); return t === 'rule' || t === 'fontface' }
    const inPrelude = (): boolean => { const t = top(); return t === undefined || t === 'media' }

    const judgeSelector = (prelude: string) => {
        const flat = prelude.replace(STRING_LITERAL, '""')
        if (flat.trim() === '') { fail('', N0E(prelude)); return }
        for (const item of splitTop(flat, ',')) {
            const t = item.trim()
            if (t === '' || /^[>+~]/.test(t) || /[>+~]$/.test(t)) { fail('', N0E(prelude)); break }
        }
        for (const m of flat.matchAll(/\[\s*([^\]=~|^$*\s"']*)/g)) if (/[A-Z]/.test(m[1])) fail('', ATTRIBUTE_NAME_REASON(m[1]))
        for (const m of flat.matchAll(/\[\s*[^\]=~|^$*\s"']+\s*[~|^$*]?=\s*([^\]\s"']+)/g)) if (!caseSafe(m[1])) fail('', caseReason('an attribute value', m[1]))
        const outsideAttributes = flat.replace(/\[[^\]]*\]/g, '[]')
        for (const m of outsideAttributes.matchAll(/([.#])([A-Za-z0-9_-]+)/g)) if (!caseSafe(m[2])) fail('', caseReason(m[1] === '.' ? 'a class name' : 'an id', m[2]))
    }

    const judgeDeclaration = (segment: string, kind: Kind) => {
        const text = segment.trim()
        if (text === '') return
        const colon = text.indexOf(':')
        const name = colon < 0 ? '' : text.slice(0, colon).trim()
        if (colon < 0 || !PROPERTY_NAME.test(name)) { fail('', N0D(text)); return }
        const lower = name.toLowerCase()
        const value = text.slice(colon + 1).replace(/\s*!\s*important\s*$/i, '')
        if (lower === 'font-family') for (const why of judgeFamilyList(value)) fail(lower, why)
        else if (lower === 'font' && kind === 'rule') {
            const split = splitFontShorthand(value)
            if (split) for (const why of judgeFamilyList(split.family)) fail(lower, why)
        }
    }

    while (i < n) {
        const ch = css[i]
        if (ch === '"' || ch === "'") {
            let j = i + 1
            while (j < n && css[j] !== ch && css[j] !== '\n') j++
            const inner = css.slice(i + 1, j)
            if (inPrelude() && !SELECTOR_STRING.test(inner)) fail('', I3_REASON(inner))
            i = css[j] === ch ? j + 1 : j
            continue
        }
        if ((ch === 'u' || ch === 'U') && (i === 0 || !ID_CHAR.test(css[i - 1])) && css.slice(i, i + 4).toLowerCase() === 'url(') {
            let k = i + 4
            while (k < n && /[ \t\n]/.test(css[k])) k++
            if (css[k] !== '"' && css[k] !== "'") {
                const close = css.indexOf(')', k)
                i = close < 0 ? n : close + 1
                continue
            }
        }
        if (ch === '-' && css[i + 1] === '-' && (i === 0 || !ID_CHAR.test(css[i - 1]))) {
            let j = i + 2
            while (j < n && ID_CHAR.test(css[j])) j++
            const ident = css.slice(i, j)
            if (!caseSafe(ident)) fail('', caseReason(css.slice(Math.max(0, i - 8), i).trimEnd().endsWith('(') ? 'a var() reference' : 'a custom property name', ident))
            i = j
            continue
        }
        if (ch === '(') { groups.push('('); i++; continue }
        if (ch === '[') {
            if (inDeclarations()) fail('', N0C(css.slice(start, i + 1)))
            groups.push('[')
            i++
            continue
        }
        if (ch === ')' || ch === ']') {
            if (ch === ']' && inDeclarations()) fail('', N0C(css.slice(start, i + 1)))
            const opener = ch === ')' ? '(' : '['
            if (groups.length && groups[groups.length - 1] === opener) groups.pop()
            else fail('', N0F(css.slice(Math.max(start, i - 30), i + 1)))
            i++
            continue
        }
        if (ch === '@') {
            if (!inPrelude() || css.slice(start, i).trim() !== '') fail('', N0B(css.slice(start, i + 12)))
            i++
            continue
        }
        if (ch === '{') {
            if (groups.length) { fail('', N0F(css.slice(Math.max(start, i - 30), i + 1))); groups.length = 0 }
            const t = top()
            if (t === undefined || t === 'media') {
                const prelude = css.slice(start, i)
                const trimmed = prelude.trim()
                if (trimmed.startsWith('@')) {
                    const name = (/^@([A-Za-z-]*)/.exec(trimmed)?.[1] ?? '').toLowerCase()
                    if (t === undefined && name === 'media') blocks.push('media')
                    else if (t === undefined && name === 'font-face') blocks.push('fontface')
                    else { if (t === 'media') fail('', N0A(trimmed)); blocks.push('other') }
                } else {
                    judgeSelector(prelude)
                    blocks.push('rule')
                }
            } else blocks.push('other')
            start = i + 1
            i++
            continue
        }
        if (ch === '}') {
            if (groups.length) { fail('', N0F(css.slice(Math.max(start, i - 30), i + 1))); groups.length = 0 }
            const t = top()
            if (t === undefined) fail('', N0A(css.slice(start, i + 1)))
            else {
                if (t === 'rule' || t === 'fontface') judgeDeclaration(css.slice(start, i), t)
                else if (t === 'media' && css.slice(start, i).trim() !== '') fail('', N0A(css.slice(start, i)))
                blocks.pop()
            }
            start = i + 1
            i++
            continue
        }
        if (ch === ';') {
            if (groups.length) {
                if (inDeclarations()) fail('', N0D(css.slice(start, i + 1)))
                i++
                continue
            }
            const t = top()
            if (t === 'rule' || t === 'fontface') judgeDeclaration(css.slice(start, i), t)
            else if (t === undefined || t === 'media') fail('', N0A(css.slice(start, i + 1)))
            start = i + 1
            i++
            continue
        }
        i++
    }
    if (blocks.length === 0 && css.slice(start).trim() !== '') fail('', N0A(css.slice(start)))
    return errors
}
