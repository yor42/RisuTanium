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
const VALUE_CONTROL_SELECTOR = 'select, input[type="number"], input[type="range"], input[type="color"], input[type="date"], [role="slider"]'
const TEXT_FIELD_SELECTOR = 'textarea, input[type="text"], input[type="password"], input:not([type]), [role="textbox"]'

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
    if((el.matches(FORM_CONTROL_SELECTOR) || el.matches(VALUE_CONTROL_SELECTOR)) && !el.matches(CHOICE_CONTROL_SELECTOR)){
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

export type ControlOptions = { fields?: boolean, values?: boolean }

export function controls(root: ParentNode, options: ControlOptions = {}): Element[] {
    const base = options.fields
        ? 'button, [role="button"], input[type="radio"], textarea, input[type="checkbox"], input[type="text"], input[type="password"], input:not([type]), [role="textbox"]'
        : 'button, [role="button"], input[type="radio"], textarea'
    const selector = options.values ? `${base}, ${VALUE_CONTROL_SELECTOR}` : base
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

const EMBEDDED_VALUE_TAGS = new Set(['input', 'select', 'textarea'])

function accessibleParts(node: Node, isRoot: boolean): string {
    if(node.nodeType === Node.TEXT_NODE){
        return node.textContent ?? ''
    }
    if(node.nodeType !== Node.ELEMENT_NODE){
        return ''
    }
    const element = node as Element
    if(!isRoot && (element.getAttribute('aria-hidden') === 'true' || element.hasAttribute('hidden'))){
        return ''
    }
    const label = normalize(element.getAttribute('aria-label') ?? '')
    if(label !== ''){
        return ` ${label} `
    }
    const tag = element.tagName.toLowerCase()
    if(tag === 'img'){
        return ` ${element.getAttribute('alt') ?? ''} `
    }
    if(EMBEDDED_VALUE_TAGS.has(tag)){
        return ` ${(element as HTMLInputElement).value} `
    }
    let text = ''
    for(const child of Array.from(element.childNodes)){
        text += accessibleParts(child, false)
    }
    return text
}

/**
 * Approximates the text a browser computes from a referenced element's content: text nodes count,
 * aria-hidden and hidden descendants are skipped, an element with an aria-label contributes that label
 * instead of its children, an img contributes its alt and an embedded input or select its value. Unlike
 * `controlName`, it sees a Help button, whose only content is aria-hidden icons behind an aria-label.
 */
export function accessibleText(node: Node): string {
    return normalize(accessibleParts(node, true))
}

function otherFieldIn(parent: Element, control: Element): boolean {
    return Array.from(parent.querySelectorAll(`${VALUE_CONTROL_SELECTOR}, ${TEXT_FIELD_SELECTOR}`)).some((el) => el !== control)
}

/**
 * The checkbox that switches a field on or off: the last checkbox inside the control's parent that comes
 * before the control in document order, and only when that parent holds no other value control or text
 * field. SliderInput and OptionalInput put the toggle and the field side by side under one root. Their
 * enable checkbox is icon-only (named by aria-label, no visible text); a checkbox that shows its own text
 * is a standalone setting that merely shares the parent, so it never counts as the field's toggle.
 */
export function toggleFor(control: Element): HTMLInputElement | null {
    const parent = control.parentElement
    if(parent === null || otherFieldIn(parent, control)){
        return null
    }
    let found: HTMLInputElement | null = null
    for(const box of Array.from(parent.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))){
        if(normalize(visibleText(box.closest('label') ?? box)) !== ''){
            continue
        }
        if(box.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING){
            found = box
        }
    }
    return found
}

/** The value controls, plus the text fields that have a `toggleFor`, in document order and not aria-hidden. */
export function fieldControls(root: ParentNode): Element[] {
    const selector = `${VALUE_CONTROL_SELECTOR}, ${TEXT_FIELD_SELECTOR}`
    return Array.from(root.querySelectorAll(selector))
        .filter((el) => el.closest('[aria-hidden="true"]') === null)
        .filter((el) => el.matches(VALUE_CONTROL_SELECTOR) || toggleFor(el) !== null)
}

/**
 * Marks the colour picker library's closed popup dialog aria-hidden. The library renders the dialog's
 * sliders and text inputs while it is closed and hides them with CSS, which jsdom does not apply; their
 * names are the library's own. Only the library's root structure counts (a `.wrapper` with the dialog
 * role that lacks `.is-open`), so an open picker and any other dialog keep their controls checked.
 */
export function hideClosedColorPickerDialogs(root: ParentNode): void {
    for (const dialog of Array.from(root.querySelectorAll('.wrapper[role="dialog"]:not(.is-open)'))) {
        dialog.setAttribute('aria-hidden', 'true')
    }
}

export type FieldExpectation = { name: string, help?: string, toggle?: boolean }

const NAMING_FORBIDDEN_DESCENDANTS = 'button, [role="button"], a[href], input, select, textarea, [role="slider"], [tabindex], [aria-label]'

function textOfIds(el: Element, idList: string[]): string {
    const parts: string[] = []
    for(const id of idList){
        const target = el.ownerDocument.getElementById(id)
        if(target){
            parts.push(accessibleText(target))
        }
    }
    return normalize(parts.join(' '))
}

/**
 * Checks each value control of `root`, in document order, against the expected names and returns one
 * line per violation, written `#<index> <element> F<rule> <detail>`; a test asserts an empty list.
 * F1 count, F2 exact name, F3 naming ids first in aria-describedby, F4 description is the name then the
 * help, F5 naming element holds only text and is not the control's wrapper, F6 naming ids are not shared
 * with another element, F7 toggle checkbox present exactly when expected and named like the field.
 */
export function fieldNameProblems(root: ParentNode, expected: FieldExpectation[]): string[] {
    const problems: string[] = []
    const fields = fieldControls(root)
    if(fields.length !== expected.length){
        problems.push(`#* F1 expected ${expected.length} controls, found ${fields.length}`)
    }
    const namingIdsOfRoot = new Set<string>()
    for(const el of Array.from(root.querySelectorAll('[aria-labelledby]'))){
        for(const id of ids(el, 'aria-labelledby')){
            namingIdsOfRoot.add(id)
        }
    }
    fields.forEach((control, index) => {
        const expectation = expected[index]
        const report = (rule: string, detail: string) => problems.push(`#${index} ${describeElement(control)} ${rule} ${detail}`)
        if(expectation === undefined){
            report('F1', 'unexpected control')
            return
        }
        const labelIds = ids(control, 'aria-labelledby')
        const describedIds = ids(control, 'aria-describedby')
        const name = textOfIds(control, labelIds)
        if(name === '' || name !== expectation.name){
            report('F2', `name "${name}" expected "${expectation.name}"`)
        }
        const prefixOk = labelIds.length > 0 && labelIds.every((id, i) => describedIds[i] === id)
        if(!prefixOk){
            report('F3', `aria-describedby "${describedIds.join(' ')}" does not start with aria-labelledby "${labelIds.join(' ')}"`)
        }
        const wantedDescription = expectation.help ? `${expectation.name} ${expectation.help}` : expectation.name
        const description = textOfIds(control, describedIds)
        if(description !== wantedDescription){
            report('F4', `description "${description}" expected "${wantedDescription}"`)
        }
        for(const id of describedIds.slice(labelIds.length)){
            if(namingIdsOfRoot.has(id)){
                report('F4', `help id ${id} is also a naming id`)
            }
        }
        for(const id of labelIds){
            const target = control.ownerDocument.getElementById(id)
            if(target === null){
                report('F5', `aria-labelledby id ${id} does not resolve`)
                continue
            }
            if(target.contains(control) || target.querySelector(NAMING_FORBIDDEN_DESCENDANTS) !== null){
                report('F5', `naming element ${id} contains the control or a focusable or labelled descendant`)
            }
            for(const other of Array.from(root.querySelectorAll('[aria-labelledby], [aria-describedby]'))){
                if(other === control){
                    continue
                }
                if(ids(other, 'aria-labelledby').includes(id) || ids(other, 'aria-describedby').includes(id)){
                    report('F6', `naming id ${id} is also referenced by ${describeElement(other)}`)
                }
            }
        }
        const toggle = toggleFor(control)
        if(toggle === null && expectation.toggle === true){
            report('F7', 'expected a toggle checkbox, found none')
        }
        else if(toggle !== null && expectation.toggle !== true){
            report('F7', 'found an unexpected toggle checkbox')
        }
        else if(toggle !== null){
            const toggleName = controlName(toggle)
            if(toggleName === '' || toggleName !== expectation.name){
                report('F7', `toggle name "${toggleName}" expected "${expectation.name}"`)
            }
        }
    })
    return problems
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
