// MC-1351: a pack may bundle fonts, so a top-level @font-face block is taken out of the stylesheet and judged here; the
// engine then judges the rest exactly as before (it refuses every other at-rule, and an @font-face nested anywhere stays
// in the text for it to refuse). Blocks are found on the raw text with CSS's own tokenising (comments and strings
// skipped, escapes in the at-keyword decoded), so the engine still normalises the text once: normalising twice could turn
// an escaped "/*" into a comment and hide a rule from it.

export interface FontFaceError {
    selector: string
    prop: string
    why: string
}

export interface FontFaceExtraction {
    /** The stylesheet with every top-level @font-face block removed; the original text when there is none. */
    remainder: string
    /** The removed blocks, in order, with their offsets in the original text. */
    blocks: { start: number, end: number, text: string }[]
    errors: FontFaceError[]
    /** The family each block registers, as a use site must write it (lower case). A block with an ambiguous or invalid name adds none. */
    families: string[]
}

const ALLOWED_DESCRIPTORS = new Set(['font-family', 'src', 'font-weight', 'font-style', 'font-stretch', 'font-display', 'unicode-range'])
const SELECTOR = '@font-face'

/** The generic families, which a use site writes unquoted and an @font-face may not register. */
export const GENERIC_FAMILIES: ReadonlySet<string> = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'])
/** The CSS-wide keywords and `default`, which are never a family name. */
export const NON_NAME_WORDS: ReadonlySet<string> = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer', 'default'])
/** An unquoted family word is a CSS identifier: ASCII, no leading digit, no `-` before a digit, no `--` start (fail closed). */
export const FAMILY_IDENT = /^-?[a-z_][a-z0-9_-]*$/i
export const FAMILY_IDENT_REASON = (word: string): string => `a font family word must be a CSS identifier (${word}): quote the name (MC-1550)`

/** Reads the value of a family descriptor (already normalised): the registered name, or the reason the descriptor is refused. */
function familyDescriptor(value: string): { name: string } | { why: string } {
    const quoted = /^(?:"([^"\\]*)"|'([^'\\]*)')$/.exec(value)
    if (quoted) {
        const name = quoted[1] ?? quoted[2]
        if (name === '' || /[^\u0000-\u007f]/.test(name)) return { why: 'an @font-face family name must be a non-empty ASCII name: a pack can name its bundled font in ASCII (MC-1550)' }
        return { name }
    }
    const words = value.split(/\s+/)
    for (const word of words) {
        if (!FAMILY_IDENT.test(word)) return { why: FAMILY_IDENT_REASON(word) }
        if (GENERIC_FAMILIES.has(word) || NON_NAME_WORDS.has(word)) return { why: `an @font-face family may not be named ${word}: it is a generic family, a CSS-wide keyword or "default", not a name (MC-1550)` }
    }
    return { name: words.join(' ') }
}

/** Skips a comment or a string at `i`; returns the index after it, or -1 when it is unterminated, or `i` when there is neither. */
function skipOpaque(css: string, i: number): number {
    if (css[i] === '/' && css[i + 1] === '*') {
        const end = css.indexOf('*/', i + 2)
        return end < 0 ? -1 : end + 2
    }
    if (css[i] === '"' || css[i] === "'") {
        const quote = css[i]
        for (let j = i + 1; j < css.length; j++) {
            if (css[j] === '\\') { j++; continue }
            if (css[j] === quote) return j + 1
            if (css[j] === '\n') return -1
        }
        return -1
    }
    return i
}

/** Reads an identifier at `i` with CSS escapes decoded and case folded; returns it and the index after it. */
function readIdent(css: string, i: number): { name: string, end: number } {
    let name = ''
    let j = i
    while (j < css.length) {
        const ch = css[j]
        if (ch === '\\') {
            const hex = /^[0-9a-fA-F]{1,6}/.exec(css.slice(j + 1, j + 7))
            if (hex) {
                const code = parseInt(hex[0], 16)
                name += code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '�'
                j += 1 + hex[0].length
                if (/[ \t\n]/.test(css[j] ?? '')) j++
            } else if (j + 1 < css.length && css[j + 1] !== '\n') {
                name += css[j + 1]
                j += 2
            } else break
            continue
        }
        if (/[-\w]/.test(ch) || ch.charCodeAt(0) >= 0x80) { name += ch; j++; continue }
        break
    }
    return { name: name.toLowerCase(), end: j }
}

/** Splits `text` at top-level occurrences of `separator`, skipping strings and parentheses. */
function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
        const skipped = skipOpaque(text, i)
        if (skipped < 0) break
        if (skipped > i) { i = skipped - 1; continue }
        const ch = text[i]
        if (ch === '\\') { i++; continue }
        if (ch === '(') depth++
        else if (ch === ')') depth--
        else if (ch === separator && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
    }
    parts.push(text.slice(start))
    return parts
}

/** Judges one block's body (already normalised by the caller: comments removed, escapes decoded, case folded). */
function judgeBody(body: string): { errors: FontFaceError[], family?: string } {
    const errors: FontFaceError[] = []
    const fail = (prop: string, why: string) => errors.push({ selector: SELECTOR, prop, why })
    const familyValues: string[] = []
    if (/[{}]/.test(body.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ''))) fail('', 'an @font-face block may only hold font descriptors, no nested blocks (MC-1351)')
    for (const piece of splitTopLevel(body, ';')) {
        const declaration = piece.trim()
        if (!declaration) continue
        const m = /^([-\w]+)\s*:\s*([\s\S]*)$/.exec(declaration)
        if (!m) { fail('', 'an @font-face block may only hold font descriptors (MC-1351)'); continue }
        const [, prop, value] = m
        if (!ALLOWED_DESCRIPTORS.has(prop)) { fail(prop, `${prop} is not an allowed @font-face descriptor (only ${[...ALLOWED_DESCRIPTORS].join(', ')}; MC-1351)`); continue }
        if (prop !== 'src') {
            if (/\(/.test(value)) fail(prop, `${prop} in @font-face takes a plain value, no functions (MC-1351)`)
            if (prop === 'font-family') familyValues.push(value)
            continue
        }
        for (const item of splitTopLevel(value, ',')) {
            const source = item.trim()
            if (/^local\(/.test(source)) { fail('src', 'local() fonts are not allowed: a pack may only use the fonts it bundles (MC-1351)'); continue }
            // One url() naming the file, then optional format() and tech() hints; the url target itself is judged by the url policy.
            if (!/^url\((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^"'()\s]*)\)(\s+(format|tech)\((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[-\w\s,]*)\))*$/.test(source)) {
                fail('src', 'an @font-face src item must be url(<bundled file>) with optional format() or tech() (MC-1351)')
            }
        }
    }
    if (!/(^|;)\s*src\s*:/.test(body)) fail('src', 'an @font-face block must name its bundled font with src (MC-1351)')
    if (!/(^|;)\s*font-family\s*:/.test(body)) fail('font-family', 'an @font-face block must name its family (MC-1351)')
    // The registered name must be unambiguous: one descriptor, exactly one quoted string or one run of identifiers.
    let family: string | undefined
    if (familyValues.length > 1) fail('font-family', 'an @font-face block may name its family only once: the checks and the browser would pick different names (MC-1550)')
    else if (familyValues.length === 1) {
        const parsed = familyDescriptor(familyValues[0])
        if ('name' in parsed) family = parsed.name
        else fail('font-family', parsed.why)
    }
    return { errors, family }
}

/**
 * Takes the top-level @font-face blocks out of a stylesheet. `normaliseBody` is the engine's normalise(), applied to each
 * block's body only for judging; the remainder keeps the original text so the engine reads it exactly as written.
 */
export function extractFontFaces(css: string, normaliseBody: (text: string) => string): FontFaceExtraction {
    const blocks: FontFaceExtraction['blocks'] = []
    const errors: FontFaceError[] = []
    const families: string[] = []
    let depth = 0
    for (let i = 0; i < css.length; i++) {
        const skipped = skipOpaque(css, i)
        if (skipped < 0) break
        if (skipped > i) { i = skipped - 1; continue }
        const ch = css[i]
        if (ch === '\\') { i++; continue }
        if (ch === '{') { depth++; continue }
        if (ch === '}') { depth--; continue }
        if (ch !== '@' || depth !== 0) continue
        const ident = readIdent(css, i + 1)
        if (ident.name !== 'font-face') continue
        // The prelude may hold only whitespace and comments before the block opens.
        let j = ident.end
        for (;;) {
            while (/\s/.test(css[j] ?? '')) j++
            const after = skipOpaque(css, j)
            if (after > j && css[j] === '/') { j = after; continue }
            break
        }
        if (css[j] !== '{') { errors.push({ selector: SELECTOR, prop: '', why: 'an @font-face rule must be followed directly by its block (MC-1351)' }); continue }
        let inner = 1
        let k = j + 1
        let closed = -1
        for (; k < css.length; k++) {
            const s = skipOpaque(css, k)
            if (s < 0) break
            if (s > k) { k = s - 1; continue }
            if (css[k] === '\\') { k++; continue }
            if (css[k] === '{') inner++
            else if (css[k] === '}' && --inner === 0) { closed = k; break }
        }
        if (closed < 0) { errors.push({ selector: SELECTOR, prop: '', why: 'an unterminated @font-face block (MC-1351)' }); break }
        blocks.push({ start: i, end: closed + 1, text: css.slice(i, closed + 1) })
        const judged = judgeBody(normaliseBody(css.slice(j + 1, closed)))
        errors.push(...judged.errors)
        if (judged.family !== undefined) families.push(judged.family)
        i = closed
    }
    if (!blocks.length) return { remainder: css, blocks, errors, families }
    let remainder = ''
    let at = 0
    for (const block of blocks) { remainder += css.slice(at, block.start); at = block.end }
    remainder += css.slice(at)
    return { remainder, blocks, errors, families }
}
