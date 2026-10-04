/**
 * The decision of the automatic idle reload as pure functions over a snapshot
 * of signals, so every condition can be tested alone. Nothing here reads the
 * page.
 *
 * The reload exists to release characters this page restored from their
 * archived units. It fires only when it can release something, when nothing is
 * unsaved, unfinished or typed, and when the user has been away long enough
 * that a reload costs nothing but a moment.
 */

import type { ArchiveStrikeState } from '../../storage/bootArchiveMemo'

/** No pointer, key, touch, scroll or plugin activity for this long before the hold starts counting. */
export const IDLE_MS = 120_000
/** The gate must hold, with no interruption and no change in the watched counters, this long before the reload. */
export const HOLD_MS = 5_000
/** Unit payload restored by characters that would be released, below which the reload is not armed. */
export const RESTORED_BYTES_THRESHOLD = 50 * 1024 * 1024
/** At most one idle reload per this interval on a page's tab. */
export const MIN_RELOAD_INTERVAL_MS = 10 * 60_000
export const POLL_MS = 1_000
/** The selection part of a hand-off older than this is not applied. */
export const SELECTION_FRESH_MS = MIN_RELOAD_INTERVAL_MS
/** After this long without the page going away, a reload the browser did not carry out gives up its selection part. */
export const SELECTION_WITHDRAW_MS = 15_000

export interface IdleSignals {
    /** The platform has an idle reload path at all (web, or desktop with the path switched on). */
    platformEnabled: boolean

    archivingOn: boolean
    /** This boot's archive session could archive. */
    canArchive: boolean
    v21PluginEnabled: boolean
    breaker: ArchiveStrikeState
    tooLarge: boolean
    formatOk: boolean
    /** Restored bytes of the characters the reload would release (the keep-inline set left out). */
    restoredBytesOutside: number
    /** Another tab holds the storage presence lock; `null` while that is not yet known. */
    otherTabOpen: boolean | null

    /** `isSaveClean()`. */
    saveClean: boolean

    busyAction: boolean
    chokePointInFlight: boolean
    workInProgress: boolean
    startupCleanupPending: boolean
    pluginDevMode: boolean

    idleMs: number
    windowFocused: boolean
    pageVisible: boolean
    ttsPlaying: boolean
    mediaPlaying: boolean
    pluginPanelOpen: boolean
    realmOpen: boolean
    alertOpen: boolean
    promptOpen: boolean
    modalOpen: boolean

    /** The composer of the chat on screen holds text or a staged file. */
    composerDraftOnScreen: boolean
    /** A message editor, a partial-message editor or a translation editor is open. */
    editorOpen: boolean

    /** The last idle reload of this tab is younger than the interval. */
    rateLimited: boolean
    /** The rate-limit record cannot be read, so a new one could not be relied on. */
    historyUnreadable: boolean
}

export type IdleBlocker =
    | 'platform'
    | 'archivingOff' | 'cannotArchive' | 'v21Plugin' | 'breaker' | 'tooLarge' | 'formatVersion'
    | 'belowThreshold' | 'otherTab'
    | 'unsaved'
    | 'busyAction' | 'chokePoint' | 'work' | 'startupCleanup' | 'pluginDevMode'
    | 'notIdle' | 'noFocus' | 'hidden' | 'tts' | 'media' | 'pluginPanel' | 'realm' | 'alert' | 'prompt' | 'modal'
    | 'composerDraft' | 'editorOpen'
    | 'rateLimited' | 'historyUnreadable'

/**
 * Whether this page may arm the idle reload at all. A page whose archive session could not archive can release nothing, and a page started by an idle
 * reload whose pass did not commit has just shown that reloading released nothing, so it does not reload again.
 */
export function idleReloadMayStart(page: {
    platformEnabled: boolean
    canArchive: boolean
    bootedByIdleReload: boolean
    bootPassCommitted: boolean
}): boolean {
    return page.platformEnabled && page.canArchive && !(page.bootedByIdleReload && !page.bootPassCommitted)
}

/** Every condition that currently blocks the reload; empty when it may fire. */
export function idleGateBlockers(s: IdleSignals): IdleBlocker[] {
    const blockers: IdleBlocker[] = []
    const add = (blocked: boolean, name: IdleBlocker) => {
        if (blocked) {
            blockers.push(name)
        }
    }
    add(!s.platformEnabled, 'platform')
    add(!s.archivingOn, 'archivingOff')
    add(!s.canArchive, 'cannotArchive')
    add(s.v21PluginEnabled, 'v21Plugin')
    add(s.breaker !== 'none', 'breaker')
    add(s.tooLarge, 'tooLarge')
    add(!s.formatOk, 'formatVersion')
    add(!(s.restoredBytesOutside >= RESTORED_BYTES_THRESHOLD), 'belowThreshold')
    add(s.otherTabOpen !== false, 'otherTab')
    add(!s.saveClean, 'unsaved')
    add(s.busyAction, 'busyAction')
    add(s.chokePointInFlight, 'chokePoint')
    add(s.workInProgress, 'work')
    add(s.startupCleanupPending, 'startupCleanup')
    add(s.pluginDevMode, 'pluginDevMode')
    add(!(s.idleMs >= IDLE_MS), 'notIdle')
    add(!s.windowFocused, 'noFocus')
    add(!s.pageVisible, 'hidden')
    add(s.ttsPlaying, 'tts')
    add(s.mediaPlaying, 'media')
    add(s.pluginPanelOpen, 'pluginPanel')
    add(s.realmOpen, 'realm')
    add(s.alertOpen, 'alert')
    add(s.promptOpen, 'prompt')
    add(s.modalOpen, 'modal')
    add(s.composerDraftOnScreen, 'composerDraft')
    add(s.editorOpen, 'editorOpen')
    add(s.rateLimited, 'rateLimited')
    add(s.historyUnreadable, 'historyUnreadable')
    return blockers
}

/**
 * Where the continuous hold stands. `epoch` holds counters that only grow
 * (the last activity, the save marks, the draft versions): a change in any of
 * them restarts the hold even when the gate is open again by the next look, so
 * a change that was made and undone between two looks still counts.
 */
export interface HoldState {
    since: number | null
    epoch: readonly number[] | null
}

export const NOT_HOLDING: HoldState = { since: null, epoch: null }

function sameEpoch(a: readonly number[], b: readonly number[]): boolean {
    return a.length === b.length && a.every((value, i) => value === b[i])
}

/**
 * One look at the gate. `blocked` is whether any blocker is present. The hold
 * starts at the first look that finds the gate open, restarts at any look that
 * finds it blocked or the epoch changed, and `fire` is true at the first look
 * at which the hold has lasted `holdMs`.
 */
export function stepHold(
    state: HoldState,
    look: { blocked: boolean, epoch: readonly number[], now: number },
    holdMs: number = HOLD_MS,
): { state: HoldState, fire: boolean } {
    if (look.blocked) {
        return { state: NOT_HOLDING, fire: false }
    }
    if (state.since === null || state.epoch === null || !sameEpoch(state.epoch, look.epoch)) {
        return { state: { since: look.now, epoch: look.epoch }, fire: false }
    }
    return { state, fire: look.now - state.since >= holdMs }
}
