// Where focus goes after a History action (undo, redo, revert, Restore deleted, a restore point): to the field the
// action changed, read by comparing the owner's live fields before and after it. A changed first message wins over
// the other fields, the default first message coming right after the alternates and the example text right after
// that; among first messages the first changed position wins, as the first changed card does among example cards.
// When nothing changed, or the field is
// not on screen, focus is left where it is unless it was lost (removed, disabled or on the body); then it goes to
// the fallback the caller names.
import { afterFlush } from '../afterFlush'
import { registryPaths, valuesEqual } from './history/fieldAccess'
import { FIELD_PRESENTATION, type SetPath } from './history/fieldRegistry'
import { cardSpans, cardText } from './longText/exampleCards'
import { sameJsonValue } from '../storage/store2/codec/normalize'
import type { ForeignFieldRead, OwnerFields } from './ownerFields'

// A registered path other than the two first message paths, which have their own targets: its focus is the element
// its presentation names, and the target kind is the path itself.
export type ElementFocusPath = Exclude<SetPath, 'firstMessage' | 'exampleMessage'>

export type FocusTarget =
    | { kind: 'greeting'; index: number }
    | { kind: 'greetingAdd' }
    | { kind: 'firstMessage' }
    | { kind: 'example'; card: number }
    | { kind: 'exampleAdd' }
    | { kind: ElementFocusPath }

function hasElementFocus(path: SetPath): path is ElementFocusPath {
    const focus = FIELD_PRESENTATION[path].focus
    return focus !== null && typeof focus === 'object'
}

// The cards of an example text as the list shows them, with a held marker line treated as a marker.
function exampleCardTexts(value: unknown): string[] {
    const text = typeof value === 'string' ? value : ''
    const spans = cardSpans(text, null)
    return spans.map((_, i) => cardText(text, spans, i))
}

// The first card whose text differs; a removal at the end goes to the card before it, and an emptied list to the Add
// button, as a greeting delete does.
function exampleTarget(before: unknown, after: unknown): FocusTarget {
    const a = exampleCardTexts(before)
    const b = exampleCardTexts(after)
    const shared = Math.min(a.length, b.length)
    let first = 0
    while (first < shared && a[first] === b[first]) first++
    if (first < b.length) return { kind: 'example', card: first }
    return b.length > 0 ? { kind: 'example', card: b.length - 1 } : { kind: 'exampleAdd' }
}

export function isForeignFieldRead(value: unknown): value is ForeignFieldRead {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, 'foreign')
}

// Two tagged foreign readings are equal when their values are (a read returns a fresh copy each time); a tagged reading
// never equals a typed value or `undefined`. Anything else compares by value (a bias list is a fresh copy per read).
function sameFieldRead(a: unknown, b: unknown): boolean {
    if (isForeignFieldRead(a) || isForeignFieldRead(b)) return isForeignFieldRead(a) && isForeignFieldRead(b) && sameJsonValue(a.foreign, b.foreign)
    return valuesEqual(a, b)
}

export function changedFieldTarget(before: OwnerFields, after: OwnerFields): FocusTarget | null {
    const a = before.greetings
    const b = after.greetings
    const shared = Math.min(a.length, b.length)
    let first = 0
    while (first < shared && a[first] === b[first]) first++
    if (first < shared || a.length !== b.length) {
        // A row that now holds a changed or put-back text; a removal at the end goes to the row before it, and an
        // emptied list to the Add button, as a delete does.
        if (first < b.length) return { kind: 'greeting', index: first }
        return b.length > 0 ? { kind: 'greeting', index: b.length - 1 } : { kind: 'greetingAdd' }
    }
    if (before.firstMessage !== after.firstMessage) return { kind: 'firstMessage' }
    if (before.exampleMessage !== after.exampleMessage) return exampleTarget(before.exampleMessage, after.exampleMessage)
    for (const path of registryPaths()) {
        if (hasElementFocus(path) && !sameFieldRead(before[path], after[path])) return { kind: path }
    }
    return null
}

// The greeting list registers how to mount a card by data index; the returned function unregisters it.
let greetingReveal: ((index: number) => Promise<void>) | null = null
export function registerGreetingReveal(reveal: (index: number) => Promise<void>): () => void {
    greetingReveal = reveal
    return () => {
        if (greetingReveal === reveal) greetingReveal = null
    }
}

// A form with collapsible sections registers how to reveal the one holding a path whose element is not mounted; the
// returned function unregisters it. The reveal is transient, as the greeting list's: it only makes the element
// reachable for this focus placement, and the collapse state the user left stays as it was.
let fieldReveal: ((path: SetPath) => Promise<void>) | null = null
export function registerFieldReveal(reveal: (path: SetPath) => Promise<void>): () => void {
    fieldReveal = reveal
    return () => {
        if (fieldReveal === reveal) fieldReveal = null
    }
}

function isElementTarget(target: FocusTarget): target is { kind: ElementFocusPath } {
    return target.kind !== 'greeting' && target.kind !== 'greetingAdd' && target.kind !== 'firstMessage' && target.kind !== 'example' && target.kind !== 'exampleAdd'
}

function elementFor(scope: ParentNode, target: FocusTarget): HTMLElement | null {
    switch (target.kind) {
        case 'greeting':
            return scope.querySelector<HTMLElement>(`[data-part="studio-character-form"] [data-part="studio-greeting-input"][data-index="${target.index}"]`)
        case 'greetingAdd':
            return scope.querySelector<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-greeting-add"]')
        case 'firstMessage':
            return scope.querySelector<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-form-first-message"]')
        case 'example':
        case 'exampleAdd': {
            // The text view stands in for the list while it is shown.
            const textView = scope.querySelector<HTMLElement>('[data-part="studio-example-form"] [data-part="studio-example-text"]')
            if (textView) return textView
            return target.kind === 'example'
                ? scope.querySelectorAll<HTMLElement>('[data-part="studio-example-form"] [data-part="studio-example-input"]')[target.card] ?? null
                : scope.querySelector<HTMLElement>('[data-part="studio-example-form"] [data-part="studio-example-add"]')
        }
        default: {
            const focus = FIELD_PRESENTATION[target.kind].focus
            if (focus === null || typeof focus !== 'object') return null
            const within = `[data-part="${focus.form}"] [data-part="${focus.part}"]`
            // A path that repairs a flag stored as a non-boolean is carried by the flag's own element.
            return scope.querySelector<HTMLElement>(focus.byPath ? `${within}[data-path="${target.kind}"], ${within}[data-fix-path="${target.kind}"]` : within)
        }
    }
}

// Focus was lost: nothing holds it, or the holder was removed or disabled (an engine may move a disabled element's
// focus to the body only at its next style update).
export function focusLost(): boolean {
    const active = document.activeElement
    return active === null || active === document.body || !active.isConnected || active.matches(':disabled')
}

// `before` is read right before the action and `after` right after it; the DOM is read after the next flush. The
// target is focused and then checked: an element that cannot take focus leaves the focus where it was, and a lost
// focus then goes to the fallback.
export async function placeFocusAfterHistory(before: OwnerFields | null, after: OwnerFields | null, scope: () => ParentNode | null, fallback: () => HTMLElement | null | undefined): Promise<void> {
    const target = before && after ? changedFieldTarget(before, after) : null
    await afterFlush()
    let element = target ? elementFor(scope() ?? document, target) : null
    // A greeting card outside the list's window is not mounted: have the list mount it, then look again.
    if (!element && target?.kind === 'greeting' && greetingReveal) {
        await greetingReveal(target.index)
        element = elementFor(scope() ?? document, target)
    }
    // A field inside a collapsed section is not mounted: have the form reveal its section, then look again.
    if (!element && target && isElementTarget(target) && fieldReveal) {
        await fieldReveal(target.kind)
        element = elementFor(scope() ?? document, target)
    }
    if (element && element.isConnected) {
        element.focus()
        if (document.activeElement === element) return
    }
    if (focusLost()) fallback()?.focus()
}
