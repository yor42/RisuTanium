import { closeDialogForBack } from './alertBack'
import { pageCovered } from './alertPrompts'

declare global {
    interface Window {
        /**
         * Android Back hook, called by the host on every Back press: true when the page consumed
         * it. Installed by this module. Legacy in-window plugin code can reach it; sandboxed V3
         * plugins cannot.
         */
        __risuTaniumBack?: () => boolean
    }
}

/** A second unhandled Back within this long after the first quits instead of warning again. */
export const QUIT_WINDOW_MS = 2000

export type BackHandler = () => boolean

interface Entry {
    run: BackHandler
}

export interface BackGuardOptions {
    /** Tells the user that another Back quits. A throw means the warning could not be shown. */
    showToast: () => void
    /**
     * Requests a best-effort save of unsaved edits and of a streaming reply. Called on the press
     * that warns and on the press whose warning throws, never on the quitting press, in its own
     * task and try/catch, so a throw blocks neither the warning nor the quit and the save work
     * never delays the answer to the host.
     */
    flush?: () => void
}

const entries: Entry[] = []
let guard: BackGuardOptions | null = null
let armedAt: number | null = null
let stopVisibilityReset: (() => void) | null = null

/**
 * Handles one Back press. Handlers run newest first and the first that returns true ends the
 * press. When none does, the quit guard warns on the first press and lets the second one
 * through (false), which the host turns into the default Back. While a dialog covers the page the
 * press is consumed by the page: the dialog is cancelled when it has a cancel, otherwise it stays,
 * no handler runs, and the arm is dropped so the next press after the dialog starts the guard
 * fresh. The host still runs the default Back if the page does not answer within its timeout.
 */
export function dispatchBack(): boolean {
    if (pageCovered()) {
        armedAt = null
        try {
            closeDialogForBack()
        } catch (error) {
            console.error('Back dialog close failed', error)
        }
        return true
    }
    // A copy, so a handler that unregisters itself or another one cannot make the loop skip any.
    for (const entry of entries.slice().reverse()) {
        try {
            if (entry.run()) {
                return true
            }
        } catch (error) {
            console.error('Back handler failed', error)
        }
    }
    return unhandledPress()
}

function scheduleFlush(flush: (() => void) | undefined): void {
    if (flush === undefined) {
        return
    }
    setTimeout(() => {
        try {
            flush()
        } catch (error) {
            console.error('Back flush failed', error)
        }
    }, 0)
}

function unhandledPress(): boolean {
    if (guard === null) {
        return false
    }
    const now = Date.now()
    if (armedAt !== null && now >= armedAt && now - armedAt < QUIT_WINDOW_MS) {
        armedAt = null
        return false
    }
    // Scheduled before the warning: a press whose warning fails quits at once and must still have
    // requested the save. The host waits for this answer with a 1 s limit, so the save work runs
    // in a later task, after the answer.
    scheduleFlush(guard.flush)
    try {
        guard.showToast()
    } catch (error) {
        console.error('Back warning failed', error)
        armedAt = null
        return false
    }
    armedAt = now
    return true
}

/** Installs the hook on `window` unless it is already there; safe to call any number of times. */
export function ensureBackHook(): void {
    if (window.__risuTaniumBack === dispatchBack) {
        return
    }
    Object.defineProperty(window, '__risuTaniumBack', {
        configurable: true,
        writable: false,
        value: dispatchBack,
    })
}

/**
 * Adds a Back handler and returns its unregister. Unregistering is idempotent and removes only
 * this registration, whatever else was registered since.
 */
export function registerBackHandler(handler: BackHandler): () => void {
    ensureBackHook()
    const entry: Entry = { run: handler }
    entries.push(entry)
    return () => {
        const at = entries.indexOf(entry)
        if (at !== -1) {
            entries.splice(at, 1)
        }
    }
}

/**
 * Turns on the quit guard. Without it an unhandled press returns false. The arm is dropped when
 * the page goes hidden, so a press after returning to the app warns again.
 */
export function installBackGuard(options: BackGuardOptions): void {
    stopVisibilityReset?.()
    guard = options
    armedAt = null
    const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
            armedAt = null
        }
    }
    document.addEventListener('visibilitychange', onVisibility)
    stopVisibilityReset = () => document.removeEventListener('visibilitychange', onVisibility)
    ensureBackHook()
}

/** Clears all registrations, the guard and the arm between tests. */
export function resetBackHandlersForTests(): void {
    entries.length = 0
    guard = null
    armedAt = null
    stopVisibilityReset?.()
    stopVisibilityReset = null
}
