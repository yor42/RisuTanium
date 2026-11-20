/**
 * Remembers that a file picker has just returned files. A sheet that mounts within the window of that return opens
 * while the Android window is still changing state, so its first focus event can go unspoken; the sheet asks
 * `takePickReturn` once whether it opened that way. The mark is consumed by the first ask, so at most one sheet per
 * picker return reacts to it. The same return also hands the button that opened the picker to the card that follows, once
 * (`takePickOpener`), because the chooser takes focus away from that button. This module imports nothing, so any layer
 * can use it.
 */

/** The longest gap between a picker returning and a sheet opening that still counts as the same gesture. */
export const PICK_RETURN_WINDOW_MS = 1000

/**
 * How long the button that opened a picker stays the opener of the card that follows the pick. A card opens right after
 * the picker returns (the preflight path reads only file sizes first, and other rounds open their card at the start), so
 * a longer gap means the user has moved on and the stale button must not take focus back.
 */
export const PICK_OPENER_TTL_MS = 5000

let returnedAt: number | null = null
let opener: HTMLElement | null = null
let openerExpiresAt: number | null = null
let stopWatchingInput: (() => void) | null = null

function stopWatching(): void {
    stopWatchingInput?.()
    stopWatchingInput = null
}

/** Remembers the element that had focus when a picker opened; `null` forgets it. The time limit starts at the return. */
export function rememberPickOpener(element: HTMLElement | null): void {
    stopWatching()
    opener = element
    openerExpiresAt = null
}

/** Forgets the remembered element, for a picker that returned nothing. */
export function clearPickOpener(): void {
    rememberPickOpener(null)
}

/**
 * For a picker that returned nothing: forgets the remembered element and puts focus back on `opener`, the element that
 * had focus when that picker opened. Focus moves only while `opener` is still in the page and focus is on nowhere or
 * the body; a user who moved focus elsewhere keeps it.
 */
export function returnFocusToPickOpener(opener: HTMLElement | null): void {
    clearPickOpener()
    if (opener === null || !opener.isConnected) return
    const active = document.activeElement
    if (active === null || active === document.body) opener.focus()
}

/**
 * The remembered element, once: only after the files came back, within the time limit and while it is still in the page.
 * Any call clears it.
 */
export function takePickOpener(): HTMLElement | null {
    const element = opener
    const expiresAt = openerExpiresAt
    clearPickOpener()
    if (element === null || expiresAt === null) return null
    return performance.now() <= expiresAt && element.isConnected ? element : null
}

/** Called when a picker hands back at least one file. */
export function markPickReturned(): void {
    returnedAt = performance.now()
    if (opener === null) return
    stopWatching()
    openerExpiresAt = performance.now() + PICK_OPENER_TTL_MS
    // The user acting on the page after the pick means the button no longer says where they were.
    const forget = (): void => clearPickOpener()
    document.addEventListener('pointerdown', forget, { capture: true, once: true })
    document.addEventListener('keydown', forget, { capture: true, once: true })
    stopWatchingInput = () => {
        document.removeEventListener('pointerdown', forget, { capture: true })
        document.removeEventListener('keydown', forget, { capture: true })
    }
}

/** True once, and only within the window after `markPickReturned`; any call clears the mark. */
export function takePickReturn(): boolean {
    const at = returnedAt
    returnedAt = null
    return at !== null && performance.now() - at <= PICK_RETURN_WINDOW_MS
}

/** Clears the mark so one test cannot leak a pick return into the next. */
export function resetPickOpenerForTest(): void {
    returnedAt = null
    clearPickOpener()
}
