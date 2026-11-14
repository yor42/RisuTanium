import { keyEventBlocked } from '../keyEventBlocked'
import { hasOpenShell } from '../../lib/Nexus/pattern/patternFocus'

const MESSAGE_SELECTOR = 'article[data-part="chat-message"]'
const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'range', 'color', 'file'])

export interface TranscriptEndKeyOptions {
    transcript: () => HTMLElement | undefined
    run: () => void
}

// End on the transcript or on a message travels to the newest message. The listener sits on the shell root in the capture phase, an ancestor
// of the transcript, so it runs before any listener on the transcript or a message: the reader-intent listener never sees this key
// (a reader-intent event would cancel the travel this key starts). Every other target keeps its own End: buttons and scrollers inside a
// message, text fields and the composer.
export function installTranscriptEndKey(shell: HTMLElement, options: TranscriptEndKeyOptions): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'End' || event.altKey || event.shiftKey || event.metaKey) return
        if (event.isComposing || event.keyCode === 229) return
        const transcript = options.transcript()
        const target = event.target instanceof Element ? event.target : null
        if (!transcript || !target) return
        const onTranscript = target === transcript
        const onMessage = target.matches(MESSAGE_SELECTOR) && transcript.contains(target)
        if (!onTranscript && !onMessage) return
        event.preventDefault()
        event.stopPropagation()
        options.run()
    }
    shell.addEventListener('keydown', onKeyDown, { capture: true })
    return () => shell.removeEventListener('keydown', onKeyDown, { capture: true })
}

export interface JumpSheetKeyOptions {
    shellRoot: HTMLElement
    surfaceVisible: () => boolean
    // The sidebar (or its drawer) is open: a key aimed at the page body then belongs to it, not to the chat.
    sidebarOpen: () => boolean
    // The type of the alert on screen; only no alert and a toast leave the key to the chat.
    alertType: () => string
    onopen: (active: Element | null) => void
}

// A control that keeps Ctrl+G for itself: text-like inputs, text areas, selects and editable content.
function isTextField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
    return target.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type)
}

// Ctrl or Cmd with G and nothing else. Under a non-Latin layout `key` is not "g", so the physical key stands in for it.
function isJumpKey(event: KeyboardEvent): boolean {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false
    if (event.key === 'g' || event.key === 'G') return true
    return event.code === 'KeyG' && !/^[a-z]$/i.test(event.key)
}

// Ctrl+G opens the jump sheet when focus is in the chat and not in a text field. The listener sits on the window in the capture phase,
// registered after the hotkey recorder (which only records whether the keys were blocked) and so before the hotkey listener on the document:
// a key it takes is consumed there and never reaches the configured hotkey. Everywhere else the key is left untouched.
// Focus on the page body or on nothing counts as in the chat while the chat surface is visible, no sidebar is open and no sheet is open.
export function installJumpSheetKey(options: JumpSheetKeyOptions): () => void {
    const onKeyDown = (event: KeyboardEvent): void => {
        if (!isJumpKey(event) || event.defaultPrevented || keyEventBlocked(event)) return
        if (isTextField(event.target) || hasOpenShell() || !options.surfaceVisible()) return
        const alertType = options.alertType()
        if (alertType !== 'none' && alertType !== 'toast') return
        const target = event.target
        const onPage = target === null || target === document || target === document.body || target === document.documentElement
        const inChat = target instanceof Node && options.shellRoot.contains(target)
        if (!inChat && !(onPage && !options.sidebarOpen())) return
        event.preventDefault()
        event.stopPropagation()
        options.onopen(document.activeElement)
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
}
