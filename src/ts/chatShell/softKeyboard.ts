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

// The host reports a close before the window resizes (2 to 46 ms earlier on devices), and a rotation sends a close followed
// by a visible report again about 170 ms later. A host close of an open keyboard therefore waits for the next resize: a
// resize at the same width is the keyboard closing and settles it at once; a resize at another width is a rotation, which
// settles only once no resize has come for the quiet period, long enough to span that second report. A width change that
// came shortly before the host close (the window can turn before the host reports) counts as part of the same rotation.
// A visible report arriving first cancels the close. Without any resize the close settles after the same quiet period,
// because a rotation's first resize can arrive later than a shorter delay.
export const SOFT_KEYBOARD_ROTATION_QUIET_MS = 300

// Reports open/close transitions of the soft keyboard for text fields inside `root`. The state is recomputed from the
// current inputs on every event (a focus event's evaluation runs at the end of the current microtask checkpoint); the only
// thing kept between events is a host close that is waiting to settle.
export function watchSoftKeyboard(root: HTMLElement, win: Window, onchange: (open: boolean) => void, ime: HostIme | null = null): () => void {
    const viewport = win.visualViewport
    if (!viewport && !ime) return () => {}
    const active = root.ownerDocument.activeElement
    let textFocused = !!active && root.contains(active) && isTextField(active)
    let open = false
    let disposed = false
    let focusEvaluationPending = false
    // A host close of an open keyboard that is waiting for the size to settle.
    let closing = false
    let widthAtClose = 0
    let widthChanged = false
    let settleTimer: number | null = null
    const widthNow = () => viewport?.width ?? win.innerWidth
    // A width change seen while nothing was closing, remembered for the quiet period so a host close that follows it
    // is judged as a rotation.
    let lastWidth = widthNow()
    let recentWidthChange = false
    let recentTimer: number | null = null
    const clearRecentWidthChange = () => {
        recentWidthChange = false
        if (recentTimer !== null) { win.clearTimeout(recentTimer); recentTimer = null }
    }
    const noteWidth = () => {
        const width = widthNow()
        if (width === lastWidth) return
        lastWidth = width
        recentWidthChange = true
        if (recentTimer !== null) win.clearTimeout(recentTimer)
        recentTimer = win.setTimeout(clearRecentWidthChange, SOFT_KEYBOARD_ROTATION_QUIET_MS)
    }
    const clearClosing = () => {
        closing = false
        widthChanged = false
        if (settleTimer !== null) { win.clearTimeout(settleTimer); settleTimer = null }
    }
    const compute = (commitClose: boolean) => {
        const host = ime?.read() ?? null
        const next = isSoftKeyboardOpen({
            textFocused,
            host,
            windowHeight: win.innerHeight,
            viewportHeight: viewport?.height ?? Number.NaN,
            scale: viewport?.scale ?? 1,
        })
        if (next === open) { clearClosing(); return }
        if (!commitClose && !next && textFocused && host && !host.visible) {
            if (closing) return
            closing = true
            widthAtClose = widthNow()
            widthChanged = recentWidthChange
            settleTimer = win.setTimeout(settle, SOFT_KEYBOARD_ROTATION_QUIET_MS)
            return
        }
        clearClosing()
        open = next
        onchange(open)
    }
    const evaluate = () => compute(false)
    // The deferred close is committed from the inputs as they are now, so a report that changed meanwhile wins.
    function settle(): void {
        clearClosing()
        compute(true)
    }
    const onResize = () => {
        noteWidth()
        if (!closing) { evaluate(); return }
        if (settleTimer !== null) { win.clearTimeout(settleTimer); settleTimer = null }
        if (widthNow() !== widthAtClose) widthChanged = true
        if (!widthChanged) { settle(); return }
        settleTimer = win.setTimeout(settle, SOFT_KEYBOARD_ROTATION_QUIET_MS)
    }
    const insideRoot = (node: EventTarget | null) => node instanceof Node && root.contains(node)
    // Script can dispatch a focus event synchronously from inside a framework DOM update (`focus()`, `blur()`, removing a
    // focused node). The focus flag changes at once, but the change is reported after that update and before the next
    // task, so the consumer may write reactive state. Several focus events in one task report once, from the final focus.
    const scheduleEvaluate = () => {
        if (focusEvaluationPending) return
        focusEvaluationPending = true
        void Promise.resolve().then(() => {
            focusEvaluationPending = false
            if (disposed) return
            evaluate()
        })
    }
    const onFocusIn = (event: FocusEvent) => { textFocused = isTextField(event.target); scheduleEvaluate() }
    const onFocusOut = (event: FocusEvent) => { textFocused = insideRoot(event.relatedTarget) && isTextField(event.relatedTarget); scheduleEvaluate() }
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    viewport?.addEventListener('resize', onResize)
    const unsubscribe = ime ? ime.subscribe(evaluate) : () => {}
    evaluate()
    return () => {
        disposed = true
        root.removeEventListener('focusin', onFocusIn)
        root.removeEventListener('focusout', onFocusOut)
        viewport?.removeEventListener('resize', onResize)
        unsubscribe()
        clearClosing()
        clearRecentWidthChange()
    }
}
