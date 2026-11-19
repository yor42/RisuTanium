// Where focus goes after a History action (undo, redo, revert, Restore deleted, a restore point): to the field the
// action changed, read by comparing the owner's live fields before and after it. A changed first message wins over
// the other fields, the default first message coming right after the alternates and the example text right after
// that; among first messages the first changed position wins, as the first changed card does among example cards.
// When nothing changed, or the field is
// not on screen, focus is left where it is unless it was lost (removed, disabled or on the body); then it goes to
// the fallback the caller names.
import { afterFlush } from '../afterFlush'
import { cardSpans, cardText } from './longText/exampleCards'
import type { OwnerFields } from './ownerFields'

export type FocusTarget =
    | { kind: 'greeting'; index: number }
    | { kind: 'greetingAdd' }
    | { kind: 'firstMessage' }
    | { kind: 'example'; card: number }
    | { kind: 'exampleAdd' }
    | { kind: 'desc' }
    | { kind: 'hideChatIcon' }
    | { kind: 'risutanium_render_when_complete' }
    | { kind: 'note' }

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
    if (before.desc !== after.desc) return { kind: 'desc' }
    if (before.hideChatIcon !== after.hideChatIcon) return { kind: 'hideChatIcon' }
    if (before.renderWhenComplete !== after.renderWhenComplete) return { kind: 'risutanium_render_when_complete' }
    if (before.note !== after.note) return { kind: 'note' }
    return null
}

function elementFor(scope: ParentNode, target: FocusTarget): HTMLElement | null {
    switch (target.kind) {
        case 'greeting':
            return scope.querySelectorAll<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-greeting-input"]')[target.index] ?? null
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
        case 'desc':
            return scope.querySelector<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-form-desc"]')
        case 'hideChatIcon':
            return scope.querySelector<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-form-hide-icon"]')
        case 'risutanium_render_when_complete':
            return scope.querySelector<HTMLElement>('[data-part="studio-character-form"] [data-part="studio-form-render-when-complete"]')
        case 'note':
            return scope.querySelector<HTMLElement>('[data-part="studio-chat-note-form"] [data-part="studio-form-note"]')
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
    const element = target ? elementFor(scope() ?? document, target) : null
    if (element && element.isConnected) {
        element.focus()
        if (document.activeElement === element) return
    }
    if (focusLost()) fallback()?.focus()
}
