/**
 * The `localStorage` keys the retired boot archive pass left on a device. No
 * code writes them any more; devices that ran the old pass may still hold
 * them, and the two clear functions below remove them.
 *
 * The notice memo (skipped characters, the Node server's too-large refusal and
 * the paused notice record) and the crash-loop strike count share
 * `clearArchiveMemo`. The stub-enrichment count has its own key and its own
 * `clearStubEnrichStrikes`, because `clearArchiveMemo` runs on every boot that
 * reads the setting off and must leave it. A change of the setting in Settings,
 * in either direction, removes it.
 */

const SKIPPED_KEY = 'archivePassSkipped'
const TOO_LARGE_KEY = 'archivePassTooLarge'
const STRIKES_KEY = 'archivePassStrikes'
const PAUSED_TOLD_KEY = 'archivePassPausedTold'
const STUB_ENRICH_KEY = 'stubEnrichStrikes'

/** Zero is the absence of the key. A failure is logged and ignored. */
export function clearStubEnrichStrikes(): void {
    try {
        localStorage.removeItem(STUB_ENRICH_KEY)
    } catch (error) {
        console.warn('The stub-enrichment count could not be cleared on this device:', error)
    }
}

/** Forgets the notice memo, the strike count and the told record; other storage keys are left alone. */
export function clearArchiveMemo(): void {
    for (const key of [SKIPPED_KEY, TOO_LARGE_KEY, STRIKES_KEY, PAUSED_TOLD_KEY]) {
        try {
            localStorage.removeItem(key)
        } catch (error) {
            console.warn('The archive pass memo could not be cleared on this device:', error)
        }
    }
}
