// Low power and reduced motion are this device's own choices (MC-1529): kept in localStorage, never in the
// database or a backup. The producer marks the document root, and every consumer reads only the root:
// low power is the `nexus-low-power` class plus the `data-low-power` attribute (consumers read either),
// resolved reduced motion is the `rm` class, and an explicit "off" is the `rm-off` class, which the chat
// shell's OS media-query rules step aside for.

export type ReducedMotionMode = 'system' | 'on' | 'off'

export interface MotionState {
    lowPower: boolean
    reducedMotion: ReducedMotionMode
    systemReduced: boolean
}

/** Why the animation speed has no effect right now, or null while it applies. */
export type AnimationDimReason = 'lowPower' | 'system' | 'reduced'

const LOW_POWER_KEY = 'risuChatShell.lowPower'
const REDUCED_MOTION_KEY = 'risuChatShell.reducedMotion'
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** An absent, unknown or unreadable value reads as off and is never rewritten. */
export function readLowPower(): boolean {
    try {
        return localStorage.getItem(LOW_POWER_KEY) === '1'
    } catch {
        return false
    }
}

/** An absent, unknown or unreadable value reads as following the system and is never rewritten. */
export function readReducedMotion(): ReducedMotionMode {
    try {
        const stored = localStorage.getItem(REDUCED_MOTION_KEY)
        return stored === 'on' || stored === 'off' || stored === 'system' ? stored : 'system'
    } catch {
        return 'system'
    }
}

function store(key: string, value: string): void {
    try {
        localStorage.setItem(key, value)
    } catch {
        // The current session keeps the choice when device storage is unavailable.
    }
}

export function resolveReducedMotion(mode: ReducedMotionMode, systemReduced: boolean): boolean {
    return mode === 'on' ? true : mode === 'off' ? false : systemReduced
}

export function applyMotionClasses(root: Element, state: MotionState): void {
    root.classList.toggle('nexus-low-power', state.lowPower)
    root.toggleAttribute('data-low-power', state.lowPower)
    root.classList.toggle('rm', resolveReducedMotion(state.reducedMotion, state.systemReduced))
    root.classList.toggle('rm-off', state.reducedMotion === 'off')
}

export function animationDimReason(state: MotionState): AnimationDimReason | null {
    if (state.lowPower) return 'lowPower'
    if (!resolveReducedMotion(state.reducedMotion, state.systemReduced)) return null
    return state.reducedMotion === 'system' ? 'system' : 'reduced'
}

/**
 * Whether motion is reduced for a component deciding in script. The root's classes win; without either (the
 * producer has not run) the OS query decides.
 */
export function reducedMotionActive(
    root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
    matchMedia: Window['matchMedia'] | undefined = typeof window === 'undefined' ? undefined : window.matchMedia?.bind(window),
): boolean {
    if (root?.classList.contains('rm')) return true
    if (root?.classList.contains('rm-off')) return false
    return typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION_QUERY).matches
}

const state = $state<MotionState>({ lowPower: readLowPower(), reducedMotion: readReducedMotion(), systemReduced: false })

/** The device's current choices, reactive; change them through the setters. */
export const motionPrefs: Readonly<MotionState> = state

const listeners = new Set<() => void>()

/** Runs after every change of a choice or of the OS query, once the root is marked. Returns the unsubscriber. */
export function onMotionChange(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

function applyTo(root: Element | null): void {
    if (root) applyMotionClasses(root, state)
    for (const listener of [...listeners]) listener()
}

function apply(): void {
    applyTo(typeof document === 'undefined' ? null : document.documentElement)
}

export function setLowPower(enabled: boolean): void {
    state.lowPower = enabled
    store(LOW_POWER_KEY, enabled ? '1' : '0')
    apply()
}

export function setReducedMotion(mode: ReducedMotionMode): void {
    state.reducedMotion = mode
    store(REDUCED_MOTION_KEY, mode)
    apply()
}

type MotionHost = { matchMedia?: Window['matchMedia'], document: Document }

let installed: { count: number, stop: () => void } | null = null

/**
 * Applies the stored choices to the root and keeps `systemReduced` in step with the OS. Installing again while
 * installed shares the one listener; the listener stops when every disposer has run.
 */
export function installMotionPrefs(host: MotionHost = window): () => void {
    if (installed) {
        installed.count++
    } else {
        state.lowPower = readLowPower()
        state.reducedMotion = readReducedMotion()
        const list = typeof host.matchMedia === 'function' ? host.matchMedia(REDUCED_MOTION_QUERY) : null
        state.systemReduced = list?.matches === true
        const onChange = (event: { matches: boolean }) => {
            state.systemReduced = event.matches
            applyTo(host.document.documentElement)
        }
        list?.addEventListener?.('change', onChange)
        installed = { count: 1, stop: () => list?.removeEventListener?.('change', onChange) }
        applyMotionClasses(host.document.documentElement, state)
    }
    let disposed = false
    return () => {
        if (disposed || !installed) return
        disposed = true
        if (--installed.count === 0) {
            installed.stop()
            installed = null
        }
    }
}
