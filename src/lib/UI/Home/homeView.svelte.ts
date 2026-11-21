import { afterFlush } from '../../../ts/afterFlush'

/**
 * Home's library state. Home owns it; it is not persisted and no stored field depends on it. The library
 * is embedded in the landing, so there is no separate view to be in.
 *
 * `libraryEngaged` is true once, during this HomeShell visit, the library was opened, requested or touched,
 * and a pending last-character restore reads it (a restore must never win over the user). Reset by every
 * `startHomeView`. `libraryRequest` counts explicit requests to reveal the library; HomeShell reveals on
 * each rise, and ignores the value it read at creation.
 */
export const homeView: { libraryEngaged: boolean, libraryRequest: number } = $state({ libraryEngaged: false, libraryRequest: 0 })

// A library requested by the end of a Home-opened Studio visit, not yet used by a HomeShell creation.
// Deliberately not reactive: it is read once, at creation.
let pendingResume = false

/** Marks the library as used this visit: a touch inside the embedded section, or any entry into the library. */
export function engageHomeLibrary(): void {
    homeView.libraryEngaged = true
}

/** Asks the landing to reveal its library: engages it and raises the request counter HomeShell watches. */
export function openHomeLibrary(): void {
    engageHomeLibrary()
    homeView.libraryRequest += 1
}

export function showHomeLanding(): void {
    // A landing means the library did not resume, so a focus request left over must not reach a later reveal.
    returnFocusChaId = null
}

/**
 * Reveals the library after a Home-opened Studio visit ended. Two halves, each needed for a different
 * creation order inside the close's own flush: the request counter serves a HomeShell that already exists,
 * the pending intent serves one that is created after the close.
 */
export function requestHomeLibrary(): void {
    openHomeLibrary()
    pendingResume = true
    void afterFlush().then(() => {
        pendingResume = false
    })
}

// The character whose control should take the focus when the library is next revealed, after a Home-opened
// Studio visit ended. Not reactive: the reveal reads it once.
let returnFocusChaId: string | null = null

/** Asks the reveal to focus this character's control. */
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
 * Called once when a HomeShell is created; true when this creation resumes the library after a visit just
 * ended, so the shell reveals it.
 *
 * The pending intent lives only until the `afterFlush()` wait after the visit's close. That wait flushes the
 * Home branch the close dirtied, so a shell created by that flush still sees the intent. The intent is cleared
 * before any remount flush that `onSettingsClosed` schedules, so a `{#key}` remount after a visit has ended
 * starts at the top, like every other cover. The same holds for a creation moved into a later batch (an
 * `{#await}` around HomeShell). The request counter, not this intent, serves a shell that already exists.
 */
export function startHomeView(): boolean {
    const resume = pendingResume
    pendingResume = false
    if (!resume) returnFocusChaId = null
    homeView.libraryEngaged = resume
    return resume
}
