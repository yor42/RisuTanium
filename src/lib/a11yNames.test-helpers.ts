// Pure-DOM accessible-name helpers for the icon-name tests. Form controls follow a strict rule
// taken from Android WebView with TalkBack, which speaks neither wrapping labels nor `for` labels:
// - a radio or checkbox is named only by aria-label, because only aria-label is spoken in the
//   control's own stop (aria-labelledby alone is computed but not spoken);
// - a text input, textarea or contenteditable role="textbox" is named by aria-labelledby, and only
//   counts as named when its aria-describedby also lists the naming element's id, because only the
//   description reaches the control's own stop.
// title and tooltips never count as a name.

const FORM_CONTROL_SELECTOR = 'input, textarea, [role="textbox"]'
const CHOICE_CONTROL_SELECTOR = 'input[type="radio"], input[type="checkbox"]'

const PALETTE_NAMES = 'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const PALETTE_PROPERTIES = 'text|bg|border|ring|outline|fill|stroke|from|via|to|divide|placeholder|shadow|accent|caret|decoration'
const PALETTE_PATTERN = new RegExp(
    `^(?:[a-z0-9\\-\\[\\]]+:)*(?:${PALETTE_PROPERTIES})-(?:(?:${PALETTE_NAMES})-\\d{2,3}|white|black)(?:/\\d+)?$`
)

function normalize(text: string){
    return text.replace(/\s+/g, ' ').trim()
}

function visibleText(node: Node): string {
    if(node.nodeType === Node.TEXT_NODE){
        return node.textContent ?? ''
    }
    if(node.nodeType !== Node.ELEMENT_NODE){
        return ''
    }
    const element = node as Element
    if(element.getAttribute('aria-hidden') === 'true'){
        return ''
    }
    if(element.tagName.toLowerCase() === 'img'){
        return element.getAttribute('alt') ?? ''
    }
    let text = ''
    for(const child of Array.from(element.childNodes)){
        text += visibleText(child)
    }
    return text
}

function referencedText(el: Element, attribute: string): string {
    const ids = (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '')
    const parts: string[] = []
    for(const id of ids){
        const target = el.ownerDocument.getElementById(id)
        parts.push(target ? normalize(target.textContent ?? '') : '')
    }
    return normalize(parts.join(' '))
}

function ids(el: Element, attribute: string): string[] {
    return (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '')
}

/** True when every aria-labelledby id of the control also appears in its aria-describedby. */
export function describedByIncludesName(el: Element): boolean {
    const described = ids(el, 'aria-describedby')
    const naming = ids(el, 'aria-labelledby')
    return naming.length > 0 && naming.every((id) => described.includes(id))
}

export function controlName(el: Element): string {
    const labelled = referencedText(el, 'aria-labelledby')
    if(el.matches(FORM_CONTROL_SELECTOR) && !el.matches(CHOICE_CONTROL_SELECTOR)){
        return describedByIncludesName(el) ? labelled : ''
    }
    if(el.matches(CHOICE_CONTROL_SELECTOR)){
        return normalize(el.getAttribute('aria-label') ?? '')
    }
    if(labelled !== ''){
        return labelled
    }
    const label = normalize(el.getAttribute('aria-label') ?? '')
    if(label !== ''){
        return label
    }
    return normalize(visibleText(el))
}

export function controlDescription(el: Element): string {
    return referencedText(el, 'aria-describedby')
}

export type ControlOptions = { fields?: boolean }

export function controls(root: ParentNode, options: ControlOptions = {}): Element[] {
    const selector = options.fields
        ? 'button, [role="button"], input[type="radio"], textarea, input[type="checkbox"], input[type="text"], input[type="password"], input:not([type]), [role="textbox"]'
        : 'button, [role="button"], input[type="radio"], textarea'
    return Array.from(root.querySelectorAll(selector)).filter((el) => el.closest('[aria-hidden="true"]') === null)
}

export function describeElement(el: Element): string {
    const type = el.getAttribute('type')
    const svg = el.querySelector('svg')
    return `<${el.tagName.toLowerCase()}${type ? ` type=${type}` : ''} class="${el.getAttribute('class') ?? ''}"${svg ? ` svg="${svg.getAttribute('class') ?? ''}"` : ''}>`
}

export function unnamedControls(root: ParentNode, options: ControlOptions = {}): string[] {
    return controls(root, options).filter((el) => controlName(el) === '').map(describeElement)
}

export type IconOptions = { extra?: string[], skip?: string[] }

function skipSelector(skip: string[] | undefined){
    return skip && skip.length > 0 ? skip.join(', ') : null
}

export function exposedIcons(root: ParentNode, options: IconOptions = {}): string[] {
    const selectors = ['svg.lucide', ...(options.extra ?? [])].join(', ')
    const skip = skipSelector(options.skip)
    return Array.from(root.querySelectorAll(selectors))
        .filter((el) => el.closest('[aria-hidden="true"]') === null)
        .filter((el) => skip === null || el.closest(skip) === null)
        .map((el) => `<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">`)
}

export type PaletteOptions = { allow?: RegExp[], skip?: string[] }

export function paletteClasses(root: ParentNode, options: PaletteOptions = {}): string[] {
    const skip = skipSelector(options.skip)
    const found = new Set<string>()
    for(const el of Array.from(root.querySelectorAll('*'))){
        if(skip !== null && el.closest(skip) !== null){
            continue
        }
        for(const token of Array.from(el.classList)){
            if(!PALETTE_PATTERN.test(token)){
                continue
            }
            if((options.allow ?? []).some((allowed) => allowed.test(token))){
                continue
            }
            found.add(token)
        }
    }
    return Array.from(found).sort()
}

const SCHEME_TOKENS = 'textcolor2?|draculared|bgcolor|darkbg|darkbutton|selected|borderc|darkborderc'
const TEXT_COLOUR_BODY = `(?:(?:${SCHEME_TOKENS})|[a-z]+-\\d{2,3}|white|black)(?:/\\d+)?`
const REST_TEXT_COLOUR = new RegExp(`^text-(${TEXT_COLOUR_BODY})$`)
const HOVER_TEXT_COLOUR = new RegExp(`^hover:text-(${TEXT_COLOUR_BODY})$`)

function firstColour(el: Element, pattern: RegExp): string | null {
    for(const token of Array.from(el.classList)){
        const match = pattern.exec(token)
        if(match){
            return match[1]
        }
    }
    return null
}

export type TextColourTokens = { rest: string | null, hover: string | null }

/**
 * The text-colour token pair that applies to a glyph's container. `rest` is the first `text-<colour>`
 * class on the container or its nearest ancestor that has one, as CSS inheritance resolves it, and
 * size classes such as `text-sm` never match. `hover` is the first `hover:text-<colour>` class on the
 * same walk, stopping at the nearest button or `[role=button]` (inclusive), because a hover class
 * above the control does not apply while the control is hovered. Reads classes, not computed styles.
 */
export function textColourTokens(glyph: Element): TextColourTokens {
    let rest: string | null = null
    let hover: string | null = null
    let hoverOpen = true
    for(let el: Element | null = glyph; el !== null; el = el.parentElement){
        if(rest === null){
            rest = firstColour(el, REST_TEXT_COLOUR)
        }
        if(hoverOpen && hover === null){
            hover = firstColour(el, HOVER_TEXT_COLOUR)
        }
        if(hoverOpen && el.matches('button, [role="button"]')){
            hoverOpen = false
        }
        if(rest !== null && !hoverOpen){
            break
        }
    }
    return { rest, hover }
}
