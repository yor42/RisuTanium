// The soft keyboard is judged open only when a text field has focus and the visual viewport is clearly shorter than the
// height the shell had before the field took focus. 120 CSS px clears URL-bar and toolbar changes (about 56 px) and every
// phone keyboard (150 px or more even in landscape).
export const SOFT_KEYBOARD_MIN_INSET = 120

// A pinch-zoomed viewport is shorter by scale alone and must not read as a keyboard.
const MAX_UNZOOMED_SCALE = 1.01

export interface SoftKeyboardInput {
    textFocused: boolean
    referenceHeight: number
    viewportHeight: number
    scale: number
}

export function isSoftKeyboardOpen(input: SoftKeyboardInput): boolean {
    return input.textFocused && Number.isFinite(input.referenceHeight) && Number.isFinite(input.viewportHeight)
        && input.scale <= MAX_UNZOOMED_SCALE && input.referenceHeight - input.viewportHeight >= SOFT_KEYBOARD_MIN_INSET
}

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

// Only a field that raises the soft keyboard counts: text areas, text-like inputs and contenteditable hosts.
export function isTextField(node: EventTarget | null): boolean {
    if (!(node instanceof HTMLElement)) return false
    if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled
    if (node instanceof HTMLInputElement) return !node.readOnly && !node.disabled && !NON_TEXT_INPUT_TYPES.has(node.type)
    const attribute = node.getAttribute('contenteditable')
    return node.isContentEditable === true || (attribute !== null && attribute !== 'false')
}

// Reports open/close transitions of the soft keyboard for text fields inside `root`. The reference height is re-read
// while no text field is focused, so a keyboard that shrinks the window itself is still measured against the height
// the shell had before focus; a width change (rotation) restarts the reference.
export function watchSoftKeyboard(root: HTMLElement, win: Window, onchange: (open: boolean) => void): () => void {
    const viewport = win.visualViewport
    if (!viewport) return () => {}
    const active = root.ownerDocument.activeElement
    let textFocused = !!active && root.contains(active) && isTextField(active)
    let referenceHeight = Math.max(win.innerHeight, viewport.height)
    let width = viewport.width
    let open = false
    const evaluate = () => {
        if (viewport.width !== width) {
            width = viewport.width
            referenceHeight = 0
        }
        referenceHeight = textFocused ? Math.max(referenceHeight, win.innerHeight) : Math.max(win.innerHeight, viewport.height)
        const next = isSoftKeyboardOpen({ textFocused, referenceHeight, viewportHeight: viewport.height, scale: viewport.scale })
        if (next === open) return
        open = next
        onchange(open)
    }
    const insideRoot = (node: EventTarget | null) => node instanceof Node && root.contains(node)
    const onFocusIn = (event: FocusEvent) => { textFocused = isTextField(event.target); evaluate() }
    const onFocusOut = (event: FocusEvent) => { textFocused = insideRoot(event.relatedTarget) && isTextField(event.relatedTarget); evaluate() }
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    viewport.addEventListener('resize', evaluate)
    evaluate()
    return () => {
        root.removeEventListener('focusin', onFocusIn)
        root.removeEventListener('focusout', onFocusOut)
        viewport.removeEventListener('resize', evaluate)
    }
}
