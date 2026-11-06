import type { HostIme, ImeState } from '../android/hostBridge'

// Where the host reports no keyboard state (web, desktop), the keyboard is judged open only when a text field has focus
// and the visual viewport is clearly shorter than the layout window. 120 CSS px clears URL-bar and toolbar changes (about
// 56 px) and every phone keyboard (150 px or more even in landscape). A shrink of the whole window (split screen,
// rotation) shortens both heights alike, so it never counts.
export const SOFT_KEYBOARD_MIN_INSET = 120

// A pinch-zoomed viewport is shorter by scale alone and must not read as a keyboard.
const MAX_UNZOOMED_SCALE = 1.01

export interface SoftKeyboardInput {
    textFocused: boolean
    /** The host's keyboard state, or null while the host has reported none; a reported state is authoritative. */
    host: ImeState | null
    windowHeight: number
    viewportHeight: number
    scale: number
}

export function isSoftKeyboardOpen(input: SoftKeyboardInput): boolean {
    if (!input.textFocused) return false
    if (input.host) return input.host.visible
    return Number.isFinite(input.windowHeight) && Number.isFinite(input.viewportHeight)
        && input.scale <= MAX_UNZOOMED_SCALE && input.windowHeight - input.viewportHeight >= SOFT_KEYBOARD_MIN_INSET
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

// Reports open/close transitions of the soft keyboard for text fields inside `root`. The state is recomputed from the
// current inputs on every event and keeps nothing between them, so a window resize leaves no residue.
export function watchSoftKeyboard(root: HTMLElement, win: Window, onchange: (open: boolean) => void, ime: HostIme | null = null): () => void {
    const viewport = win.visualViewport
    if (!viewport && !ime) return () => {}
    const active = root.ownerDocument.activeElement
    let textFocused = !!active && root.contains(active) && isTextField(active)
    let open = false
    const evaluate = () => {
        const next = isSoftKeyboardOpen({
            textFocused,
            host: ime?.read() ?? null,
            windowHeight: win.innerHeight,
            viewportHeight: viewport?.height ?? Number.NaN,
            scale: viewport?.scale ?? 1,
        })
        if (next === open) return
        open = next
        onchange(open)
    }
    const insideRoot = (node: EventTarget | null) => node instanceof Node && root.contains(node)
    const onFocusIn = (event: FocusEvent) => { textFocused = isTextField(event.target); evaluate() }
    const onFocusOut = (event: FocusEvent) => { textFocused = insideRoot(event.relatedTarget) && isTextField(event.relatedTarget); evaluate() }
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    viewport?.addEventListener('resize', evaluate)
    const unsubscribe = ime ? ime.subscribe(evaluate) : () => {}
    evaluate()
    return () => {
        root.removeEventListener('focusin', onFocusIn)
        root.removeEventListener('focusout', onFocusOut)
        viewport?.removeEventListener('resize', evaluate)
        unsubscribe()
    }
}
