// The browser judges a stylesheet by its tokens (CSS Syntax 3, "tokenization"); the reference engine reads it with
// patterns over normalised text. Wherever those two readings can differ, a rule can hide from every check, and the
// differences are many (escapes, comments as token boundaries, bad strings and bad urls, unusual whitespace). So the
// validator does not try to model each one: it tokenises the preprocessed stylesheet itself, refuses every construct
// whose reading is ambiguous (the strict profile below), and hands the other passes a canonical text in which the
// patterns and the browser must agree: no escapes, no comments (each becomes one space, the token boundary a browser
// keeps), no bad tokens. A pack that needs none of these constructs loses nothing; the acceptance packs use none.
//
// The same tokens give the resource policy (MC-1351) its targets: every url token, and every string argument of a
// resource function, judged where it is written; a resource function may not take var(), attr() or env(), so no
// target can arrive from elsewhere.
import { isBundledTarget, URL_POLICY_REASON, ELEMENT_REASON } from './urlPolicy'

export interface ProfileError {
    selector: string
    prop: string
    why: string
}

export interface CanonicalStylesheet {
    /** The stylesheet with every comment replaced by one space; equal to the input when there is none. */
    text: string
    /** Constructs the strict profile refuses, and resources that are not bundled files. */
    errors: ProfileError[]
}

const ESCAPE_REASON = 'a backslash escape is not allowed in a pack stylesheet: write the character itself (escapes read differently to the validator and to the browser)'
const BAD_STRING_REASON = 'a string broken by a line end, or unterminated, is not allowed (the browser drops it and reads on differently)'
const BAD_URL_REASON = 'an unquoted url() may not hold a quote, a parenthesis, a brace, a semicolon, a backslash, whitespace or a non-ASCII or control character, and must be closed (the browser reads it as a broken url and skips text the validator would read)'
const COMMENT_IN_STRING_REASON = 'a string or a url() may not contain /* or */ (the validator would read a comment the browser does not)'
const UNTERMINATED_COMMENT_REASON = 'an unterminated comment is not allowed'
const COMMENT_JOIN_REASON = 'a comment between two parts of a word or value is not allowed: write a space instead (it reads as one word to the validator and as two to the browser)'
const CDO_CDC_REASON = 'the <!-- and --> markers are not allowed in a pack stylesheet'
const CONTROL_REASON = 'a control character other than tab and line feed is not allowed in a pack stylesheet'
const NON_ASCII_REASON = 'a character outside ASCII is only allowed inside a string or a comment (identifiers and values must be plain ASCII)'
const INDIRECT_RESOURCE_REASON = 'a resource function may not take var(), attr() or env(): every resource must be written where it is used (MC-1351)'
const NESTED_BLOCK_REASON = 'a block inside a rule (CSS nesting, or a {} value) is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only'
const NESTED_AT_REASON = 'an at-rule inside a rule is not allowed: a pack has top-level rules, @media blocks of rules and @font-face only'
const BRACE_IN_GROUP_REASON = 'a brace inside parentheses or brackets is not allowed (the browser and the validator would close the block in different places)'
const UNCLOSED_REASON = 'every block, parenthesis and bracket must be closed before the end of the stylesheet'
const IMPORTANT_REASON = '"!" may only be written as !important, with nothing between'
const NUMBER_REASON = 'a number must be written plainly (no exponent) and with a lower-case unit the validator measures: px, rem, em, vw, vh, vmin, vmax, pt, cm, mm, in, ch, ex, %, deg, rad, grad, turn, s, ms, fr, x, dpi, dppx or dpcm'

// Functions whose string arguments name a resource (url() with a quoted argument included), after a vendor prefix is removed.
const RESOURCE_FUNCTIONS = new Set(['url', 'image-set', 'src', 'image', 'cross-fade'])
const INDIRECT = new Set(['var', 'attr', 'env'])
// What a browser accepts in an unquoted url token, less braces and ';' (a path never needs them, and the passes that count
// blocks must not see one there); the target itself is then judged by isBundledTarget.
const UNQUOTED_URL_CHAR = /[!#-&*-:<-[\]-z|~]/
const IDENT_CHAR = /[A-Za-z0-9_-]/
const WHITESPACE = /[ \t\n]/
// Characters that continue a word or value on either side of a comment.
const WORD_CHAR = /[A-Za-z0-9_\-#.%!@]/
// The units a number may carry. The size checks measure lengths in exactly the length units listed here, in lower
// case, so a length in any other unit, or with an exponent, would be measured as something smaller than the browser
// draws; such a number is refused rather than measured. `n` and `n-<digits>` are the an+b forms of :nth-child().
const NUMBER_UNIT = /^(?:|px|rem|em|vw|vh|vmin|vmax|pt|cm|mm|in|ch|ex|deg|rad|grad|turn|s|ms|fr|x|dpi|dppx|dpcm|n|n-\d+)$/

/** Tokenises a preprocessed stylesheet (CR, FF and NUL already rewritten) under the strict profile. */
export function canonicalStylesheet(css: string): CanonicalStylesheet {
    const errors: ProfileError[] = []
    const seen = new Set<string>()
    const fail = (prop: string, why: string) => {
        const key = `${prop}|${why}`
        if (!seen.has(key)) { seen.add(key); errors.push({ selector: '(stylesheet)', prop, why }) }
    }
    const judgeTarget = (target: string) => { if (!isBundledTarget(target)) fail('url()', `${URL_POLICY_REASON}: ${target.slice(0, 120)}`) }
    // The open functions and parentheses, innermost last, by name ('' for a plain parenthesis or bracket).
    const stack: string[] = []
    const inResourceFunction = () => stack.length > 0 && RESOURCE_FUNCTIONS.has(stack[stack.length - 1])
    const anyResourceFunction = () => stack.some((name) => RESOURCE_FUNCTIONS.has(name))
    // The blocks open around the current position: a top-level rule or @font-face holds declarations, an @media block holds rules.
    type Block = 'media' | 'declarations'
    const blocks: Block[] = []
    let preludeStart = 0
    let text = ''
    let i = 0
    const n = css.length
    while (i < n) {
        const ch = css[i]
        const code = ch.charCodeAt(0)
        if (ch === '\\') { fail('', ESCAPE_REASON); text += ch; i++; continue }
        if (code < 0x20 && ch !== '\t' && ch !== '\n') { fail('', CONTROL_REASON); text += ch; i++; continue }
        if (code === 0x7f) { fail('', CONTROL_REASON); text += ch; i++; continue }
        if (ch === '/' && css[i + 1] === '*') {
            const end = css.indexOf('*/', i + 2)
            if (end < 0) { fail('', UNTERMINATED_COMMENT_REASON); text += css.slice(i); break }
            if (WORD_CHAR.test(css[i - 1] ?? '') && WORD_CHAR.test(css[end + 2] ?? '')) fail('', COMMENT_JOIN_REASON)
            text += ' '
            i = end + 2
            continue
        }
        if (css.startsWith('<!--', i) || css.startsWith('-->', i)) { fail('', CDO_CDC_REASON); text += ch; i++; continue }
        if (ch === '"' || ch === "'") {
            let j = i + 1
            let value = ''
            let closed = false
            while (j < n) {
                const c = css[j]
                if (c === ch) { closed = true; break }
                if (c === '\n') break
                if (c === '\\') fail('', ESCAPE_REASON)
                else if (c.charCodeAt(0) < 0x20 && c !== '\t') fail('', CONTROL_REASON)
                value += c
                j++
            }
            if (!closed) fail('', BAD_STRING_REASON)
            if (value.includes('/*') || value.includes('*/')) fail('', COMMENT_IN_STRING_REASON)
            if (inResourceFunction()) judgeTarget(value)
            text += css.slice(i, closed ? j + 1 : j)
            i = closed ? j + 1 : j
            continue
        }
        if (code >= 0x80) { fail('', NON_ASCII_REASON); text += ch; i++; continue }
        if (IDENT_CHAR.test(ch)) {
            let j = i
            while (j < n && IDENT_CHAR.test(css[j])) j++
            const word = css.slice(i, j)
            // A word starting with a digit is a number (after '#' it is a colour, after 'u+' a unicode-range).
            const digits = /^-?\d+/.exec(word)
            if (digits && css[i - 1] !== '#' && css.slice(i - 2, i).toLowerCase() !== 'u+' && !NUMBER_UNIT.test(word.slice(digits[0].length))) fail('', NUMBER_REASON)
            text += word
            i = j
            if (css[i] !== '(') continue
            const name = word.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '')
            if (name === 'element') fail('url()', `${ELEMENT_REASON}`)
            if (INDIRECT.has(name) && anyResourceFunction()) fail('url()', INDIRECT_RESOURCE_REASON)
            if (name !== 'url') { stack.push(name); text += '('; i++; continue }
            // url( : a quoted argument is a function call (its string is judged as a resource); otherwise it is one url token.
            let k = i + 1
            while (k < n && WHITESPACE.test(css[k])) k++
            if (css[k] === '"' || css[k] === "'") { stack.push('url'); text += css.slice(i, k); i = k; continue }
            let target = ''
            while (k < n && css[k] !== ')' && !WHITESPACE.test(css[k])) {
                if (!UNQUOTED_URL_CHAR.test(css[k])) { fail('url()', BAD_URL_REASON); break }
                target += css[k]
                k++
            }
            // A broken url is judged on what it holds so far as well, so a remote target is named as such.
            judgeTarget(target)
            if (target.includes('/*') || target.includes('*/')) fail('url()', COMMENT_IN_STRING_REASON)
            while (k < n && WHITESPACE.test(css[k])) k++
            if (css[k] !== ')') {
                fail('url()', BAD_URL_REASON)
                text += css.slice(i, k)
                i = k
                continue
            }
            text += css.slice(i, k + 1)
            i = k + 1
            continue
        }
        if (ch === '{') {
            if (stack.length) fail('', BRACE_IN_GROUP_REASON)
            const prelude = text.slice(preludeStart).trim().toLowerCase()
            const inside = blocks[blocks.length - 1]
            if (inside === 'declarations') fail('', NESTED_BLOCK_REASON)
            else if (inside === 'media' && prelude.startsWith('@')) fail('', NESTED_AT_REASON)
            blocks.push(inside === undefined && prelude.startsWith('@media') ? 'media' : 'declarations')
            text += ch
            i++
            preludeStart = text.length
            continue
        }
        if (ch === '}') {
            if (stack.length) fail('', BRACE_IN_GROUP_REASON)
            blocks.pop()
            text += ch
            i++
            preludeStart = text.length
            continue
        }
        if (ch === ';' && blocks[blocks.length - 1] !== 'declarations') { text += ch; i++; preludeStart = text.length; continue }
        if (ch === '@' && blocks[blocks.length - 1] === 'declarations') fail('', NESTED_AT_REASON)
        if (ch === '!' && css.slice(i + 1, i + 10).toLowerCase() !== 'important') fail('', IMPORTANT_REASON)
        if (ch === '(' || ch === '[') stack.push('')
        else if ((ch === ')' || ch === ']') && stack.length) stack.pop()
        text += ch
        i++
    }
    if (blocks.length || stack.length) fail('', UNCLOSED_REASON)
    return { text, errors }
}
