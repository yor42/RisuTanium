import { isReturnToChat } from '../../lib/Setting/settingsRoute'
import { DBState, selIdState, settingsOpen } from '../stores.svelte'

export type SettingsOrigin = { kind: 'chat', name: string } | { kind: 'none' }

interface OpenCapture {
    origin: SettingsOrigin
    fromFix: boolean
    opener: HTMLElement | null
    openerPart: string | null
}

const NO_CAPTURE: OpenCapture = { origin: { kind: 'none' }, fromFix: false, opener: null, openerPart: null }

let captured: OpenCapture = NO_CAPTURE
let stopWatching: (() => void) | null = null

function captureOpen(): OpenCapture {
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    const character = selIdState.selId >= 0 ? DBState.db.characters?.[selIdState.selId] : undefined
    return {
        origin: character ? { kind: 'chat', name: character.name } : { kind: 'none' },
        fromFix: isReturnToChat(),
        opener,
        openerPart: opener?.getAttribute('data-part') ?? null,
    }
}

/**
 * Starts recording where each Settings open came from. The record is taken synchronously on the closed to
 * open change, before any flush moves focus or the selection. Safe to call more than once.
 */
export function installSettingsOrigin(): void {
    if (stopWatching) return
    let wasOpen = false
    stopWatching = settingsOpen.subscribe((open) => {
        if (open && !wasOpen) captured = captureOpen()
        wasOpen = open
    })
}

/** Where the current (or last) Settings open came from. */
export function settingsOrigin(): SettingsOrigin {
    return captured.origin
}

function focusable(element: HTMLElement): boolean {
    return element.isConnected && element.closest('[inert]') === null
}

/**
 * Returns focus to what opened Settings, best effort, once the close has flushed.
 *  - After the Fix route the failed-send card owns the focus, so nothing is restored.
 *  - The captured opener gets it while it is connected and not inert.
 *  - An opener that was unmounted and mounted again is found by its `data-part`.
 *  - Otherwise focus stays where the browser put it.
 */
export function restoreOpenerFocus(): void {
    const { fromFix, opener, openerPart } = captured
    if (fromFix) return
    if (opener && focusable(opener)) {
        opener.focus()
        return
    }
    if (openerPart === null) return
    for (const candidate of document.querySelectorAll<HTMLElement>('[data-part]')) {
        if (candidate.getAttribute('data-part') === openerPart && focusable(candidate)) {
            candidate.focus()
            return
        }
    }
}

/** Test-only: forgets the record and the install so one test cannot leak into the next. */
export function resetSettingsOriginForTests(): void {
    stopWatching?.()
    stopWatching = null
    captured = NO_CAPTURE
}
