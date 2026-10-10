import { DBState } from "../stores.svelte"
import { alertClear, alertError, alertWait, waitAlert } from "../alert"
import { language } from "../../lang"
import { findChaIdHolders, restoreColdCharacter } from "./coldCharacterRestore"
import { recordRestoreAllStart, resetRestoreAllStrikes } from "../storage/bootArchiveMemo"

/**
 * Restores every archived character in `DBState.db.characters`, for code that
 * reads the live list directly and must never see a placeholder (an enabled
 * V2.1 plugin; `loadPlugins` calls this before its code runs).
 *
 * The units are read one at a time, so at most one archived character is in
 * memory beyond those already installed. Each restore is quiet; a character
 * whose unit cannot be used stays archived and, at the end, one notice names
 * every such character; the notice has an OK button and the call returns once
 * the user has dismissed it. A restored character keeps the newer
 * `lastInteraction` of its stub and its unit. With no placeholder left nothing
 * is read and nothing is shown.
 *
 * Like `coldCharacterRestore.ts`, this module must not import `characters.ts`
 * or `index.svelte.ts`.
 */

/** Up to this many restores are quick enough not to show a progress notice. */
const QUIET_RESTORE_COUNT = 5

/**
 * Restores that are running in this page. Only the first to start records the
 * start in the crash-loop count and only the last to end resets it, so
 * overlapping restores count as one.
 */
let restoresInFlight = 0

export async function restoreAllColdCharacters(): Promise<void> {
    const pending = (DBState.db?.characters ?? [])
        .filter((cha) => cha?.coldstorage)
        .map((cha) => ({ chaId: cha.chaId, name: cha.name || language.errors.coldStorageUnknownCharacterName }))
    if (pending.length === 0) {
        return
    }

    const showProgress = pending.length > QUIET_RESTORE_COUNT
    const failed: string[] = []
    if (restoresInFlight === 0) {
        recordRestoreAllStart()
    }
    restoresInFlight++
    try {
        for (let i = 0; i < pending.length; i++) {
            if (showProgress) {
                alertWait(language.errors.coldStoragePluginRestoreProgress(pending.length - i))
            }
            // The list may have changed during the previous read: the stub is found again by its id.
            const holders = findChaIdHolders(pending[i].chaId)
            if (holders.length === 0) {
                continue
            }
            if (holders.length > 1) {
                failed.push(pending[i].name)
                continue
            }
            const holder = DBState.db.characters[holders[0]]
            if (!holder.coldstorage) {
                continue
            }
            const outcome = await restoreColdCharacter(holder, { byChaId: true, quiet: true })
            if (outcome.status === 'refused') {
                failed.push(pending[i].name)
            }
        }
    } finally {
        // The count goes back to zero before any notice that waits for the
        // user: a page closed at a notice is not an interrupted restore.
        restoresInFlight--
        if (restoresInFlight === 0) {
            resetRestoreAllStrikes()
        }
    }

    if (showProgress) {
        alertClear()
    }
    if (failed.length > 0) {
        // The notice has an OK button and loading waits until the user has
        // dismissed it: the plugin is about to see these characters as
        // placeholders, and a later progress text or clear of the single alert
        // slot must not replace it.
        alertError(language.errors.coldStoragePluginRestoreIncomplete(failed.join(', ')))
        await waitAlert()
    }
}
