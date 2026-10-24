import { DBState } from '../stores.svelte'
import { canBootArchive } from './memory/bootArchiveState'

/**
 * The gates every archive of a character must pass, kept apart from the
 * archive engine (`coldCharacterArchive.ts`) so that callers on the start-up
 * path can ask them without loading the engine and the cold-storage module it
 * imports.
 */

/** The oldest `formatversion` whose characters are saved as blocks; the boot pass archives from here on as well. */
const MIN_FORMAT_VERSION = 5

export type ArchiveGateFailure =
    | 'unavailable'     // this session cannot archive
    | 'setting'         // archiveCharacters is not true
    | 'format-version'  // formatversion below the block format

/** The gates that must hold for the whole archive, synchronous; null when archiving may run. */
export function archiveMayRun(): ArchiveGateFailure | null {
    if (!canBootArchive()) {
        return 'unavailable'
    }
    const db = DBState.db
    if (!db || db.archiveCharacters !== true) {
        return 'setting'
    }
    if (typeof db.formatversion !== 'number' || db.formatversion < MIN_FORMAT_VERSION) {
        return 'format-version'
    }
    return null
}
