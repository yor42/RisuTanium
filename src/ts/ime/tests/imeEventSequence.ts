type TextField = HTMLInputElement | HTMLTextAreaElement | HTMLElement

function writeText(element: TextField, text: string): void {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.value = text
    else element.textContent = text
}

export function compositionStart(element: TextField): void {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
}

export function compositionEnd(element: TextField, text: string): void {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }))
}

export function composeText(element: TextField, text: string): void {
    writeText(element, text)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true }))
}

// Mirrors the WebView sequence a soft Go/Enter produces: the syllable is committed by
// compositionend, and the Enter keydown follows it with isComposing already false.
export function imeEventSequence(element: TextField, text: string): void {
    compositionStart(element)
    composeText(element, text)
    compositionEnd(element, text)
}

export function enterKeydown(element: TextField, init: { isComposing?: boolean, keyCode?: number, shiftKey?: boolean } = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: init.keyCode ?? 13,
        which: init.keyCode ?? 13,
        shiftKey: init.shiftKey ?? false,
        isComposing: init.isComposing ?? false,
        bubbles: true,
        cancelable: true,
    })
    element.dispatchEvent(event)
    return event
}
