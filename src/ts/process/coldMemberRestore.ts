import { DBState } from "../stores.svelte"
import { findChaIdHolders, restoreColdCharacter } from "./coldCharacterRestore"
import { alertNamedRestoreFailure } from "./coldCharacterAccess"
import { characterFormatUpdate } from "../characters"

/**
 * Brings the cold-storage character holding `chaId` back into memory through
 * `restoreColdCharacter`, which reads the unit, checks that it holds the same
 * `chaId` and installs it in the sole holder of that id that is still a
 * placeholder once the read is done. Resolves true when the character holding
 * that id is warm afterwards, false when it is not.
 *
 * This function tells the user why it failed, once and by the character's
 * name, with the wording that fits: a missing unit, one that cannot be read
 * now, a page with no storage for archived data, a copy that does not decode,
 * a unit for another character, or a `chaId` held by several characters,
 * before or after the read. It stays silent when no character holds the id,
 * before the read or once it is done, and when the only holder is a
 * placeholder that points at another unit than the one read: then there is
 * nothing to install. The caller shows no alert of its own.
 *
 * `characters.ts` imports `doingChat` from `index.svelte.ts`, so a static
 * import of this module from `index.svelte.ts` would put a load-time cycle
 * through it. The send loads this module with a dynamic `import()` at the call
 * site, on the cold-member path only.
 */
export async function restoreColdCharacterByChaId(chaId: string): Promise<boolean> {
    const holders = findChaIdHolders(chaId)
    if (holders.length === 0) {
        return false
    }
    const placeholder = DBState.db.characters[holders[0]]
    if (holders.length > 1) {
        alertNamedRestoreFailure(placeholder, 'ambiguous')
        return false
    }
    if (!placeholder.coldstorage) {
        return true
    }
    const outcome = await restoreColdCharacter(placeholder, { byChaId: true, quiet: true })
    if (outcome.status === 'refused') {
        alertNamedRestoreFailure(placeholder, outcome.reason)
    }
    if (outcome.status !== 'restored') {
        return false
    }
    // Every caller that gets `restored` formats, the one that made the install
    // and one that joined it alike: the answer is true only for a member whose
    // format has run, and a format that throws rejects every waiting send. The
    // format is idempotent apart from `lastInteraction`.
    const index = DBState.db.characters.indexOf(outcome.character)
    if (index !== -1) {
        characterFormatUpdate(index, { updateInteraction: true })
    }
    return true
}
