/**
 * DOM helpers for the pattern dialog shell: the Tab trap, background inert flags, focus return and
 * focus rescue. Everything here takes the elements it works on, so none of it reads the page.
 */

import { holdModalLayer } from './modalLayers.svelte'

const FOCUSABLE = [
    'a[href]',
    'area[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    '[contenteditable]:not([contenteditable="false"])',
    '[tabindex]',
].join(',')

function isTabbable(element: HTMLElement): boolean {
    if (element.tabIndex < 0) return false
    if (element.matches(':disabled')) return false
    if (element.hasAttribute('inert') || element.closest('[hidden], [inert]')) return false
    return true
}

/** The controls inside `root` that Tab reaches, in document order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isTabbable)
}

/**
 * Keeps Tab and Shift+Tab inside `root`: from the last control forward, or from the first control
 * (or the shell itself) backward, focus wraps. Returns true when it handled the key.
 */
export function trapTab(event: KeyboardEvent, root: HTMLElement): boolean {
    if (event.key !== 'Tab' || event.defaultPrevented) return false
    const items = tabbables(root)
    const active = root.ownerDocument.activeElement
    if (items.length === 0) {
        event.preventDefault()
        root.focus()
        return true
    }
    const first = items[0]
    const last = items[items.length - 1]
    const outside = !active || !root.contains(active)
    // A focused element that Tab never reaches (a heading with tabindex -1) and that sits before the first control
    // stands where the root does: Shift+Tab from it wraps to the last control.
    const beforeFirst = !outside && !items.includes(active as HTMLElement)
        && (first.compareDocumentPosition(active as Node) & Node.DOCUMENT_POSITION_PRECEDING) !== 0
    if (event.shiftKey) {
        if (outside || active === first || active === root || beforeFirst) {
            event.preventDefault()
            last.focus()
            return true
        }
    } else if (outside || active === last) {
        event.preventDefault()
        first.focus()
        return true
    }
    return false
}

/** Wait after the frame before an opening text is written, so the dialog's own focus speech has finished first. */
export const ANNOUNCE_SETTLE_MS = 200

/** The same wait after a sheet opened over a returning file picker: past the window's state changes. */
export const PICK_REFOCUS_SETTLE_MS = 600

/**
 * Runs `callback` once, one animation frame and then `ms` after the call. The returned function cancels it, before or
 * after the frame.
 */
export function afterFrameSettle(callback: () => void, ms: number = ANNOUNCE_SETTLE_MS): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const frame = requestAnimationFrame(() => {
        if (cancelled) return
        timer = setTimeout(() => {
            if (!cancelled) callback()
        }, ms)
    })
    return () => {
        cancelled = true
        cancelAnimationFrame(frame)
        if (timer !== undefined) clearTimeout(timer)
    }
}

/** How many layers hold an element inert, and whether it was inert before the first of them. */
const inertHolds = new WeakMap<HTMLElement, { count: number, wasInert: boolean }>()

/**
 * Sets `inert` on each element and returns a function that releases this call's hold. An element stays inert while any
 * layer holds it, whatever order the layers release in; when the last hold goes, the element returns to exactly the
 * state it had before the first one, including an element that was already inert. Releasing twice releases once.
 */
export function makeInert(elements: readonly HTMLElement[]): () => void {
    const held = [...elements]
    for (const element of held) {
        const hold = inertHolds.get(element)
        if (hold) hold.count++
        else inertHolds.set(element, { count: 1, wasInert: element.hasAttribute('inert') })
        element.setAttribute('inert', '')
    }
    let released = false
    return () => {
        if (released) return
        released = true
        for (const element of held) {
            const hold = inertHolds.get(element)
            if (!hold) continue
            hold.count--
            if (hold.count > 0) continue
            inertHolds.delete(element)
            if (!hold.wasInert) element.removeAttribute('inert')
        }
    }
}

/** Returns focus to the control that opened the shell, if it is still on the page and usable. */
export function returnFocus(trigger: HTMLElement | null | undefined): boolean {
    if (!trigger || !trigger.isConnected || trigger.closest('[inert]')) return false
    trigger.focus()
    return trigger.ownerDocument.activeElement === trigger
}

function focusIsLost(root: HTMLElement): boolean {
    const active = root.ownerDocument.activeElement
    if (!active || active === root.ownerDocument.body) return true
    if (!root.contains(active)) return true
    return active.matches(':disabled') || active.closest('[hidden], [inert]') !== null
}

/**
 * Keeps focus on a live control inside `root`. When the focused control is hidden, disabled or
 * removed, or focus escapes the shell, focus moves to `fallback`. `isActive` lets a shell that sits
 * under a newer one stand down. Returns a function that stops watching.
 */
export function watchFocus(root: HTMLElement, fallback: HTMLElement, isActive: () => boolean = () => true): () => void {
    const rescue = () => {
        if (isActive() && focusIsLost(root)) fallback.focus()
    }
    const observer = new MutationObserver(rescue)
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'inert'] })
    const onFocusIn = (event: FocusEvent) => {
        if (isActive() && event.target instanceof Node && !root.contains(event.target)) fallback.focus()
    }
    root.ownerDocument.addEventListener('focusin', onFocusIn)
    return () => {
        observer.disconnect()
        root.ownerDocument.removeEventListener('focusin', onFocusIn)
    }
}

const openShells: object[] = []
const shellOpenListeners = new Set<(element: HTMLElement | undefined) => void>()

/**
 * Calls `listener` each time a shell registers, with the shell's element when its caller passed one. The shell is
 * already registered when the listener runs. Returns the function that stops listening.
 */
export function onShellOpen(listener: (element: HTMLElement | undefined) => void): () => void {
    shellOpenListeners.add(listener)
    return () => { shellOpenListeners.delete(listener) }
}

/**
 * Records an opened shell. Only the most recently opened one acts on keys. An open shell also holds a modal layer,
 * which pauses the toast timers. Returns the unregister function.
 */
export function registerShell(token: object, element?: HTMLElement): () => void {
    openShells.push(token)
    const releaseLayer = holdModalLayer()
    for (const listener of [...shellOpenListeners]) listener(element)
    return () => {
        releaseLayer()
        const index = openShells.indexOf(token)
        if (index >= 0) openShells.splice(index, 1)
    }
}

/** Whether any shell is open. A layout change that mounts a modal surface must not open it over one. */
export function hasOpenShell(): boolean {
    return openShells.length > 0
}

export function isTopmostShell(token: object): boolean {
    return openShells[openShells.length - 1] === token
}
