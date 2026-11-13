import { afterFlush } from '../../../ts/afterFlush'

/**
 * Which part of Home is showing. Home owns this state; it is not persisted and no stored field
 * depends on it. HomeShell starts it at the landing on every creation (`startHomeView`), except for
 * the creations that follow a Home-opened Studio visit, which start at the library. The Sidebar's
 * Home buttons reset it after they clear the selection, so the order of the selection writes is
 * unchanged.
 */
export type HomeViewName = 'landing' | 'library'

export const homeView: { view: HomeViewName } = $state({ view: 'landing' })

// A library requested by the end of a Home-opened Studio visit, not yet used by a HomeShell creation.
// Deliberately not reactive: it is read once, at creation.
let pendingResume = false

export function openHomeLibrary(): void {
    homeView.view = 'library'
}

export function showHomeLanding(): void {
    homeView.view = 'landing'
    // A landing means the library did not resume, so a focus request left over must not reach a later library.
    returnFocusChaId = null
}

/**
 * Shows the library after a Home-opened Studio visit ended. Two halves, each needed for a different
 * creation order inside the close's own flush: the view serves a HomeShell that already exists, the
 * pending intent serves one that is created after the close.
 */
export function requestHomeLibrary(): void {
    homeView.view = 'library'
    pendingResume = true
    void afterFlush().then(() => {
        pendingResume = false
    })
}

// The character whose control should take the focus when the library next mounts, after a Home-opened
// Studio visit ended. Not reactive: the library reads it once, on mount.
let returnFocusChaId: string | null = null

/** Asks the library, once it is mounted, to focus this character's control. */
export function requestHomeReturnFocus(chaId: string): void {
    returnFocusChaId = chaId
}

/** The pending focus request, cleared by taking it; null when there is none. */
export function takeHomeReturnFocus(): string | null {
    const chaId = returnFocusChaId
    returnFocusChaId = null
    return chaId
}

/**
 * Called once when a HomeShell is created: the library when a visit just ended, else the landing.
 *
 * The pending library intent lives only until the `afterFlush()` wait after the visit's close. That wait
 * flushes the Home branch the close dirtied, so a shell created by that flush still sees the intent. The
 * intent is cleared before any remount flush that `onSettingsClosed` schedules, so a `{#key}` remount after
 * a visit has ended
 * starts at the landing, like every other cover. The same holds for a creation moved into a later batch (an
 * `{#await}` around HomeShell). The view half of `requestHomeLibrary`, not this intent, serves a shell that
 * already exists.
 */
export function startHomeView(): HomeViewName {
    const view: HomeViewName = pendingResume ? 'library' : 'landing'
    pendingResume = false
    if (view === 'landing') returnFocusChaId = null
    homeView.view = view
    return view
}
