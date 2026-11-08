import type { Database } from './database.svelte'

export const HOME_MODES = ['rp', 'hybrid', 'utility'] as const

export type HomeMode = typeof HOME_MODES[number]

export type ModeState = {
    visibleModes: HomeMode[]
    hideUnusedModes: boolean
}

export type ModeLock = 'off' | 'last'

type ModeTarget = Pick<Database, 'visibleModes' | 'hideUnusedModes'>

/** A fresh array on every call: callers may keep and mutate it. */
export function defaultVisibleModes(): HomeMode[] {
    return [...HOME_MODES]
}

/**
 * Boundary narrowing for a stored or caller-supplied set. Anything that is
 * not an array holding at least one valid token means all three modes;
 * unknown tokens and duplicates are dropped and the order is canonical.
 * The result is always a new array.
 */
export function normalizeVisibleModes(value: unknown): HomeMode[] {
    if (!Array.isArray(value)) {
        return defaultVisibleModes()
    }
    const kept = HOME_MODES.filter((mode) => value.includes(mode))
    return kept.length > 0 ? kept : defaultVisibleModes()
}

/** True only for the stored boolean `true`. */
export function normalizeHideUnusedModes(value: unknown): boolean {
    return value === true
}

/** The modes Home shows: the remembered set only while hiding is on. */
export function shownModes(state: ModeState): HomeMode[] {
    return state.hideUnusedModes ? normalizeVisibleModes(state.visibleModes) : defaultVisibleModes()
}

/** Hiding is on and Home shows fewer than all three modes. */
export function isRepairState(state: ModeState): boolean {
    return state.hideUnusedModes && shownModes(state).length < HOME_MODES.length
}

/** Show-all has something to do only while some mode is hidden. */
export function canShowAll(state: ModeState): boolean {
    return shownModes(state).length < HOME_MODES.length
}

/**
 * 'off': hiding is off, so every box is checked and locked and the remembered
 * set is kept untouched. 'last': the only visible mode cannot be unchecked.
 */
export function lockOf(mode: HomeMode, state: ModeState): ModeLock | null {
    if (!state.hideUnusedModes) {
        return 'off'
    }
    const visible = normalizeVisibleModes(state.visibleModes)
    if (visible.includes(mode) && visible.length === 1) {
        return 'last'
    }
    return null
}

/**
 * The set after checking or unchecking `mode`, or null when the lock refuses:
 * any write under 'off', and an uncheck under 'last'.
 */
export function withModeToggled(state: ModeState, mode: HomeMode, checked: boolean): HomeMode[] | null {
    const lock = lockOf(mode, state)
    if (lock === 'off' || (lock === 'last' && !checked)) {
        return null
    }
    const next = normalizeVisibleModes(state.visibleModes).filter((entry) => entry !== mode)
    if (checked) {
        next.push(mode)
    }
    return normalizeVisibleModes(next)
}

/** Assigns a normalised copy; neither the old array nor `modes` is aliased. */
export function setVisibleModes(target: ModeTarget, modes: readonly HomeMode[]): void {
    target.visibleModes = normalizeVisibleModes([...modes])
}

/** Never touches the remembered set: it returns when hiding goes on again. */
export function setHideUnusedModes(target: ModeTarget, value: boolean): void {
    target.hideUnusedModes = value
}

export function showAllModes(target: ModeTarget): void {
    target.visibleModes = defaultVisibleModes()
    target.hideUnusedModes = false
}
