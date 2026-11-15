// Rule SCOPE (UI-S6 I0a): a chat or Studio stylesheet is judged against one screen and applied to that screen only (MC-1608),
// so it must reach nothing else. Every channel through which a stylesheet reaches beyond the elements it names is closed by a
// positive list:
//   axis A  statements: style rules, @media blocks of style rules and top-level @font-face blocks (the engine and the canonical
//           tokenizer already refuse every other statement; scopeRules.test.ts pins each refusal);
//   axis B  selectors: the engine's compound grammar, and every entry names a part of the screen (areaParts.ts);
//   axis C  properties: the list below on a part, custom properties and one colour-scheme declaration on the root;
//   axis D  names: the area's own tokens, `--pack-*` helpers and `pack-` font families.
// The passes of the engine still apply to what these rules accept.
import { bare, decls, type Decl } from './csslit'
import { COMPOUND, normalise, type LintError } from './engine'
import { inlinePrivate } from './failclosed'
import { isAreaPart, type ScopedArea } from './areaParts'
import { allowedTokenNames, reservedNameReason } from './appThemeNames'
import type { ThemeArea } from './index'

/** The properties a stylesheet may set on a part: effects that stay inside the matched element's box and its descendants and that define no document-wide name. */
export const PROP_ALLOW: readonly RegExp[] = [
    /^(color|opacity|visibility|cursor|pointer-events|user-select|-webkit-user-select|accent-color|caret-color|scrollbar-color|scrollbar-width|color-scheme|fill|stroke|stroke-width|box-shadow|text-shadow)$/,
    /^background(-color|-image|-position(-x|-y)?|-size|-repeat|-clip|-origin)?$/,
    /^border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-(width|style|color))?$/, /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/,
    /^(font|font-(family|size|weight|style|stretch|variant|variant-[a-z-]+|feature-settings|variation-settings|kerning|synthesis|optical-sizing))$/,
    /^(line-height|letter-spacing|word-spacing|text-align|text-align-last|text-decoration(-[a-z-]+)?|text-underline-offset|text-underline-position|text-transform|text-indent|text-overflow|text-wrap(-mode|-style)?|white-space(-collapse)?|word-break|overflow-wrap|word-wrap|hyphens|tab-size|vertical-align|list-style(-type|-position)?|-webkit-line-clamp|line-clamp|-webkit-box-orient|text-rendering|-webkit-font-smoothing|-moz-osx-font-smoothing)$/,
    /^(display|position|top|right|bottom|left|inset(-[a-z-]+)?|float|clear|box-sizing|aspect-ratio|object-fit|object-position|clip|overflow|overflow-x|overflow-y)$/,
    /^((min-|max-)?(width|height|block-size|inline-size))$/, /^(margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/,
    /^(gap|row-gap|column-gap|order|flex|flex-[a-z-]+|align-(content|items|self)|justify-(content|items|self)|place-(content|items|self)|grid|grid-[a-z-]+)$/,
    /^(border-collapse|border-spacing|table-layout|caption-side|empty-cells)$/,
]
export const isAllowedProperty = (prop: string): boolean => PROP_ALLOW.some((pattern) => pattern.test(prop))

/**
 * What each shorthand on PROP_ALLOW sets: `sets` are longhands that are on PROP_ALLOW themselves; `resets` are longhands outside it
 * that the shorthand writes only to their initial value or to a value that stays inside the element (`border` resets border-image,
 * `font` resets font-size-adjust, `font-synthesis` writes its own switches). The two shorthands that can write a longhand outside
 * PROP_ALLOW from their value, `background` (background-attachment) and `list-style` (list-style-image), are judged by value in
 * judgeShorthandValue.
 */
export interface ShorthandEffect {
    sets: readonly string[]
    resets: readonly string[]
}
const BOX_SIDES = ['top', 'right', 'bottom', 'left']
const sideLonghands = (shorthand: string): string[] => BOX_SIDES.map((side) => `${shorthand}-${side}`)
const borderLonghands = (prefix: string): string[] => ['width', 'style', 'color'].map((aspect) => `${prefix}-${aspect}`)
export const SHORTHAND_EFFECTS: Readonly<Record<string, ShorthandEffect>> = {
    background: { sets: ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-origin', 'background-clip'], resets: ['background-blend-mode'] },
    border: { sets: [...borderLonghands('border-top'), ...borderLonghands('border-right'), ...borderLonghands('border-bottom'), ...borderLonghands('border-left')], resets: ['border-image-source', 'border-image-slice', 'border-image-width', 'border-image-outset', 'border-image-repeat'] },
    'border-top': { sets: borderLonghands('border-top'), resets: [] },
    'border-right': { sets: borderLonghands('border-right'), resets: [] },
    'border-bottom': { sets: borderLonghands('border-bottom'), resets: [] },
    'border-left': { sets: borderLonghands('border-left'), resets: [] },
    'border-block': { sets: ['border-block-start-width', 'border-block-start-style', 'border-block-start-color', 'border-block-end-width', 'border-block-end-style', 'border-block-end-color'], resets: [] },
    'border-inline': { sets: ['border-inline-start-width', 'border-inline-start-style', 'border-inline-start-color', 'border-inline-end-width', 'border-inline-end-style', 'border-inline-end-color'], resets: [] },
    'border-block-start': { sets: borderLonghands('border-block-start'), resets: [] },
    'border-block-end': { sets: borderLonghands('border-block-end'), resets: [] },
    'border-inline-start': { sets: borderLonghands('border-inline-start'), resets: [] },
    'border-inline-end': { sets: borderLonghands('border-inline-end'), resets: [] },
    'background-position': { sets: ['background-position-x', 'background-position-y'], resets: [] },
    'border-block-width': { sets: ['border-block-start-width', 'border-block-end-width'], resets: [] },
    'border-block-style': { sets: ['border-block-start-style', 'border-block-end-style'], resets: [] },
    'border-block-color': { sets: ['border-block-start-color', 'border-block-end-color'], resets: [] },
    'border-inline-width': { sets: ['border-inline-start-width', 'border-inline-end-width'], resets: [] },
    'border-inline-style': { sets: ['border-inline-start-style', 'border-inline-end-style'], resets: [] },
    'border-inline-color': { sets: ['border-inline-start-color', 'border-inline-end-color'], resets: [] },
    'border-width': { sets: sideLonghands('border').map((side) => `${side}-width`), resets: [] },
    'border-style': { sets: sideLonghands('border').map((side) => `${side}-style`), resets: [] },
    'border-color': { sets: sideLonghands('border').map((side) => `${side}-color`), resets: [] },
    'border-radius': { sets: ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'], resets: [] },
    font: { sets: ['font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-size', 'line-height', 'font-family'], resets: ['font-size-adjust', 'font-language-override', 'font-feature-settings', 'font-variation-settings', 'font-kerning', 'font-optical-sizing'] },
    'font-variant': { sets: ['font-variant-ligatures', 'font-variant-caps', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-alternates', 'font-variant-position'], resets: [] },
    'font-synthesis': { sets: [], resets: ['font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps'] },
    'text-decoration': { sets: ['text-decoration-line', 'text-decoration-style', 'text-decoration-color', 'text-decoration-thickness'], resets: [] },
    'text-wrap': { sets: ['text-wrap-mode', 'text-wrap-style'], resets: [] },
    'white-space': { sets: ['white-space-collapse', 'text-wrap-mode'], resets: [] },
    'list-style': { sets: ['list-style-type', 'list-style-position'], resets: [] },
    margin: { sets: sideLonghands('margin'), resets: [] },
    padding: { sets: sideLonghands('padding'), resets: [] },
    'margin-block': { sets: ['margin-block-start', 'margin-block-end'], resets: [] },
    'margin-inline': { sets: ['margin-inline-start', 'margin-inline-end'], resets: [] },
    'padding-block': { sets: ['padding-block-start', 'padding-block-end'], resets: [] },
    'padding-inline': { sets: ['padding-inline-start', 'padding-inline-end'], resets: [] },
    inset: { sets: BOX_SIDES, resets: [] },
    'inset-block': { sets: ['inset-block-start', 'inset-block-end'], resets: [] },
    'inset-inline': { sets: ['inset-inline-start', 'inset-inline-end'], resets: [] },
    overflow: { sets: ['overflow-x', 'overflow-y'], resets: [] },
    flex: { sets: ['flex-grow', 'flex-shrink', 'flex-basis'], resets: [] },
    'flex-flow': { sets: ['flex-direction', 'flex-wrap'], resets: [] },
    gap: { sets: ['row-gap', 'column-gap'], resets: [] },
    'grid-gap': { sets: ['row-gap', 'column-gap'], resets: [] },
    'grid-area': { sets: ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'], resets: [] },
    'grid-row': { sets: ['grid-row-start', 'grid-row-end'], resets: [] },
    'grid-column': { sets: ['grid-column-start', 'grid-column-end'], resets: [] },
    'grid-template': { sets: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'], resets: [] },
    'place-content': { sets: ['align-content', 'justify-content'], resets: [] },
    'place-items': { sets: ['align-items', 'justify-items'], resets: [] },
    'place-self': { sets: ['align-self', 'justify-self'], resets: [] },
    grid: { sets: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow'], resets: [] },
}

const SHORTHAND_BACKGROUND_ATTACHMENT = /(^|[\s,/])(fixed|local)(?=$|[\s,)/])/
const PRIVATE_REFERENCE = /var\(\s*--pack-[\w-]+\s*(?:,\s*(?:[^()]|\([^()]*\))*)?\)/g
const FUNCTION_TOKEN = /[a-z-]+\(/

/** The reason a shorthand value sets a longhand outside PROP_ALLOW, or ''. A private `var(--pack-*)` reference is judged through the values it can take (inlinePrivate variants), not as a function token. */
export function judgeShorthandValue(prop: string, value: string): string {
    const v = bare(value.replace(/\s*!important\s*$/, '').trim().replace(PRIVATE_REFERENCE, ' '))
    if (prop === 'list-style' && FUNCTION_TOKEN.test(v)) return 'list-style with a function value (url(), symbols(), var()) would set list-style-image, which a pack may not set (MC-1586)'
    if (prop === 'background' && SHORTHAND_BACKGROUND_ATTACHMENT.test(v)) return 'background with fixed or local would set background-attachment, which a pack may not set (MC-1586)'
    return ''
}

const FAMILY_NAME = /^pack-[a-z0-9][a-z0-9 _-]{0,62}$/
const ROOT_ATTRIBUTES: ReadonlySet<string> = new Set(['data-input', 'data-layout'])

interface ParsedCompound {
    root: string
    attrs: [string, string | undefined][]
    pseudo: string
}
interface ParsedEntry {
    /** Why the entry is outside the pack selector grammar; '' when it parses. */
    grammarWhy: string
    compounds: ParsedCompound[]
    siblings: boolean
}

/** Splits an entry into compounds at descendant and child combinators outside brackets; a sibling combinator or a stray combinator is reported. */
function splitEntry(entry: string): { compounds: string[], siblings: boolean, stray: boolean } {
    const compounds: string[] = []
    let current = ''
    let separator = ''
    let depth = 0
    let siblings = false
    let stray = false
    const text = entry.trim()
    for (const ch of text) {
        if (ch === '[') depth++
        if (ch === ']') depth--
        if (depth === 0 && /[\s>+~]/.test(ch)) {
            if (current) { compounds.push(current); current = '' }
            separator += ch
            continue
        }
        if (separator) {
            if (/[+~]/.test(separator)) siblings = true
            else if (!compounds.length || !/^(\s+|\s*>\s*)$/.test(separator)) stray = true
            separator = ''
        }
        current += ch
    }
    if (current) compounds.push(current)
    if (separator) stray = true
    return { compounds, siblings, stray }
}

/** Parses a selector-list entry with the engine's compound grammar; an entry the grammar does not match is outside the pack selector grammar. */
export function parseSelectorEntry(entry: string): ParsedEntry {
    const split = splitEntry(entry)
    const compounds: ParsedCompound[] = []
    let grammarWhy = ''
    if (!split.compounds.length) grammarWhy = 'an empty selector'
    else if (split.stray) grammarWhy = 'a combinator other than a space or > between two compounds'
    for (const text of split.compounds) {
        const m = COMPOUND.exec(text)
        if (!m || (!m[1] && !m[2])) {
            grammarWhy ||= `${text} is not a compound of the pack selector grammar (:root or html, then [data-*] attributes, then :hover, :focus-within or :focus-visible)`
            continue
        }
        compounds.push({ root: m[1] || '', attrs: [...m[2].matchAll(/\[(data-[\w-]+)(?:="([^"\]]*)")?\]/g)].map((a): [string, string | undefined] => [a[1], a[2]]), pseudo: m[3] })
    }
    return { grammarWhy, compounds, siblings: split.siblings }
}

const isRootEntry = (entry: ParsedEntry): boolean => entry.compounds.length === 1 && !!entry.compounds[0].root && !entry.compounds[0].pseudo && entry.compounds[0].attrs.every(([name]) => ROOT_ATTRIBUTES.has(name))

const NO_PART_WHY = 'a selector must end in a [data-part="..."] of this screen; one that names no part reaches elements of every screen (MC-1586)'
const SIBLING_WHY = 'the sibling combinators + and ~ are not allowed in a pack selector: they reach elements the stylesheet does not name (MC-1586)'
const VALUELESS_WHY = '[data-part] without a value matches the parts of every screen: name a part of this screen (MC-1586)'
const rootWhy = (prop: string): string => `${prop} may not be set on the document root: only tokens, and color-scheme set to light or dark on :root or html, may be (MC-1586)`
const propertyWhy = (prop: string): string => `${prop} is not on the list of properties a pack may set on a part (MC-1586)`
const partWhy = (area: ScopedArea, value: string, role: 'subject' | 'ancestor'): string => `the part ${value} is not a part of the ${area} screen; a ${area} stylesheet may name only the ${area} screen's own parts, ${role === 'subject' ? 'as the element it styles' : 'in a selector that styles one of them'} (MC-1586)`
const tokenWhy = (name: string): string => `${name} is not a token this stylesheet may set: a pack may set the tokens of its own screen's token stylesheets and its own --pack-* helpers (MC-1586)`
const familyWhy = (family: string): string => `the @font-face family ${family} must start with pack- (lower case letters, digits, space, _ and -, at most 63 characters after the first): a pack may not register a name the app or the system uses (MC-1586)`

const isColourSchemeChoice = (d: Decl, entry: string): boolean => d.prop === 'color-scheme' && /^(:root|html)$/.test(entry) && d.ctx.at.length === 0 && /^(light|dark)$/.test(d.value.replace(/\s*!important\s*$/, '').trim())

/**
 * Judges a chat or Studio stylesheet against Rule SCOPE. `css` is the stylesheet with its @font-face blocks taken out, `families`
 * the families those blocks register. Other areas are not scoped.
 */
export function scopePass(area: ThemeArea, css: string, families: readonly string[]): LintError[] {
    if (area !== 'chat' && area !== 'studio') return []
    const errors: LintError[] = []
    const seen = new Set<string>()
    const add = (selector: string, prop: string, why: string): void => {
        const key = `${selector}|${prop}|${why}`
        if (!seen.has(key)) { seen.add(key); errors.push({ selector, prop, why }) }
    }
    for (const family of families) if (!FAMILY_NAME.test(family)) add('@font-face', 'font-family', familyWhy(family))
    const text = normalise(css)
    const allowedTokens = allowedTokenNames(area)
    for (const d of decls(text)) {
        if (d.ctx.keyframes) continue
        const custom = d.prop.startsWith('--')
        const listed = d.ctx.selector.trim() || '(no selector)'
        if (custom && !d.prop.startsWith('--pack-') && !allowedTokens.has(d.prop)) add(listed, d.prop, reservedNameReason(d.prop) || tokenWhy(d.prop))
        for (const entry of d.ctx.selector.split(',').map((s) => s.trim()).filter(Boolean)) {
            const parsed = parseSelectorEntry(entry)
            if (parsed.grammarWhy) { add(entry, d.prop, `not a pack selector: ${parsed.grammarWhy} (MC-1586)`); continue }
            if (isRootEntry(parsed)) {
                if (!custom && !isColourSchemeChoice(d, entry)) add(entry, d.prop, rootWhy(d.prop))
                continue
            }
            if (parsed.siblings) add(entry, d.prop, SIBLING_WHY)
            const last = parsed.compounds[parsed.compounds.length - 1]
            for (const compound of parsed.compounds) {
                for (const [name, value] of compound.attrs) {
                    if (name !== 'data-part') continue
                    if (value === undefined) add(entry, d.prop, VALUELESS_WHY)
                    else if (!isAreaPart(area, value)) add(entry, d.prop, partWhy(area, value, compound === last ? 'subject' : 'ancestor'))
                }
            }
            if (!last.attrs.some(([name]) => name === 'data-part')) add(entry, d.prop, NO_PART_WHY)
            if (!custom && !isAllowedProperty(d.prop)) add(entry, d.prop, propertyWhy(d.prop))
        }
    }
    // A shorthand is judged by the longhands it sets, on the declaration as written and on every value a private variable can give it.
    const variants = inlinePrivate(text, '--pack-')
    for (const variant of [text, ...variants.variants]) {
        for (const d of decls(variant)) {
            if (d.ctx.keyframes || d.prop.startsWith('--')) continue
            const why = judgeShorthandValue(d.prop, d.value)
            if (why) add(d.ctx.selector.trim() || '(no selector)', d.prop, why)
        }
    }
    return errors
}
