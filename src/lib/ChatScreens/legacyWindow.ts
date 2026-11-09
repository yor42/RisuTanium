/**
 * The mounted-row bound of the legacy chat list. The list mounts the newest `loadPages` rows and grows that window
 * when the reader scrolls near its top. The window shrinks back to the cap only when the reader is back at the
 * latest messages, so the rows that go are the oldest ones, far above the viewport of a bottom-origin scroller.
 */

/** Rows the list keeps mounted once the reader is back at the latest messages. */
export const LEGACY_MOUNT_CAP = 100

/** The cap for a user's initial page setting: a setting above the default cap is never trimmed below itself. */
export function legacyMountCap(initialPages: number): number {
    return Math.max(LEGACY_MOUNT_CAP, initialPages)
}

export interface LegacyTrimInputs {
    loadPages: number
    cap: number
    atBottom: boolean
    /** The same scroll event already grew the window, so growth and trim never alternate within one event. */
    grew: boolean
    /** A message edit or translation-edit draft is open; its row must stay mounted. */
    editorsOpen: boolean
    /** A fold is active; the fold owns the window. */
    folded: boolean
    scrollingToMessage: boolean
}

/** The page count to shrink the window to, or null when the window stays as it is. */
export function legacyTrimPages(inputs: LegacyTrimInputs): number | null {
    if (!Number.isFinite(inputs.loadPages) || inputs.loadPages <= inputs.cap) {
        return null
    }
    if (!inputs.atBottom || inputs.grew || inputs.editorsOpen || inputs.folded || inputs.scrollingToMessage) {
        return null
    }
    return inputs.cap
}
