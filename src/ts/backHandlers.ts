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
}

const entries: Entry[] = []
let guard: BackGuardOptions | null = null
let armedAt: number | null = null
let stopVisibilityReset: (() => void) | null = null

/**
 * Handles one Back press. Handlers run newest first and the first that returns true ends the
 * press. When none does, the quit guard warns on the first press and lets the second one
 * through (false), which the host turns into the default Back. A dialog on screen is left alone:
 * neither a warning nor an arm, so the press behaves as it did before the guard existed.
 */
export function dispatchBack(): boolean {
    if (pageCovered()) {
        return false
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

function unhandledPress(): boolean {
    if (guard === null) {
        return false
    }
    const now = Date.now()
    if (armedAt !== null && now >= armedAt && now - armedAt < QUIT_WINDOW_MS) {
        armedAt = null
        return false
    }
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
