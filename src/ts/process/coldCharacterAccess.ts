import { DBState } from "../stores.svelte"
import { alertError } from "../alert"
import { language } from "../../lang"
import type { character, groupChat } from "../storage/database.svelte"
import { findChaIdHolders, readColdCharacterCopy, restoreColdCharacter, restoreFailureReason, type ColdRestoreFailure } from "./coldCharacterRestore"

/**
 * How a plugin call or an MCP tool reaches an archived character (a stub in
 * `DBState.db.characters` whose full data lives in a cold-storage unit):
 * reading it from a copy without installing it, or restoring it before a
 * write. Both fail to their caller with a message, and the user is told once,
 * by name, here; the shared restore is asked to stay quiet.
 *
 * Like `coldCharacterRestore.ts`, this module must not import `characters.ts`
 * or `index.svelte.ts`: `v3.svelte.ts` and the MCP modules load it, and
 * `v3.svelte.ts` sits in a load-time cycle through `index.svelte.ts`. It does not format a
 * restored character and does not change its `lastInteraction`; opening a
 * character is what does both (`changeChar`).
 */

type Slot = character | groupChat

/** A stub that could not be used: `message` is the text the user was shown, and what the caller reports. */
export interface ColdAccessFailure {
    status: 'failed'
    message: string
}

/**
 * The named message for `reason`. Every reason has its own case, so a reason
 * added to `ColdRestoreFailure` without a message fails the type check instead
 * of falling through to the possible-data-loss text. Only `missing`,
 * `mismatch` and `ambiguous` claim the data may be lost.
 */
function namedRestoreFailureText(name: string, reason: ColdRestoreFailure): string {
    switch (reason) {
        case 'unavailable':
            return language.errors.coldStorageNamedRestoreUnavailable(name)
        case 'damaged':
            return language.errors.coldStorageNamedRestoreDamaged(name)
        case 'unreadable':
            return language.errors.coldStorageNamedRestoreUnreadable(name)
        case 'missing':
        case 'mismatch':
        case 'ambiguous':
            return language.errors.coldStorageNamedRestoreFailed(name)
        default: {
            const unhandled: never = reason
            return unhandled
        }
    }
}

/**
 * Shows the user one alert naming `stub`, with the wording that fits `reason`,
 * and returns it as a failure. For a caller that restored with `quiet` and
 * reports the failure itself.
 */
export function alertNamedRestoreFailure(stub: Slot, reason: ColdRestoreFailure): ColdAccessFailure {
    const name = stub.name || language.errors.coldStorageUnknownCharacterName
    const message = namedRestoreFailureText(name, reason)
    alertError(message)
    return { status: 'failed', message }
}

/**
 * The full character in `stub`'s unit as an independent copy. `stub` stays in
 * its slot and nothing is marked for save. On a missing, unreadable (including
 * a page with no storage for archived data, a copy that does not decode and a
 * key that cannot be a storage name) or
 * mismatched unit the user gets one alert naming the character, worded for
 * that reason, and `message` is what the caller reports.
 */
export async function readArchivedCharacter(stub: Slot): Promise<{ status: 'ok', character: Slot } | ColdAccessFailure> {
    const copy = await readColdCharacterCopy(stub)
    if (copy.status === 'ok') {
        return copy
    }
    return alertNamedRestoreFailure(stub, restoreFailureReason(copy))
}

export type ColdWriteTarget =
    /** `character` is the live full character holding the `chaId`, at `index` in `DBState.db.characters`. */
    | { status: 'ready', character: Slot, index: number }
    /** No character holds the `chaId` any more. Nothing was written or shown. */
    | { status: 'gone' }
    | ColdAccessFailure

/** The live holder of `chaId` when exactly one character holds it. */
function soleHolder(chaId: string): { status: 'found', index: number, holder: Slot } | { status: 'gone' } | { status: 'ambiguous', holder: Slot } {
    const holders = findChaIdHolders(chaId)
    if (holders.length === 0) {
        return { status: 'gone' }
    }
    const holder = DBState.db.characters[holders[0]]
    if (holders.length > 1) {
        return { status: 'ambiguous', holder }
    }
    return { status: 'found', index: holders[0], holder }
}

/**
 * Makes the character holding `chaId` a full one, restoring it from its unit
 * first when it is a stub, and returns it found again by `chaId` (an index or
 * object taken before the read may be stale). A full holder is returned as it
 * is. On a failed restore the stub is left unchanged and the user gets one
 * alert naming the character.
 */
export async function restoreArchivedForWrite(chaId: string): Promise<ColdWriteTarget> {
    const before = soleHolder(chaId)
    if (before.status === 'gone') {
        return before
    }
    if (before.status === 'ambiguous') {
        return alertNamedRestoreFailure(before.holder, 'ambiguous')
    }
    if (before.holder.coldstorage) {
        const outcome = await restoreColdCharacter(before.holder, { byChaId: true, quiet: true })
        if (outcome.status === 'gone') {
            return { status: 'gone' }
        }
        if (outcome.status === 'refused') {
            return alertNamedRestoreFailure(before.holder, outcome.reason)
        }
    }
    const after = soleHolder(chaId)
    if (after.status === 'gone') {
        return after
    }
    if (after.status === 'ambiguous') {
        return alertNamedRestoreFailure(after.holder, 'ambiguous')
    }
    if (after.holder.coldstorage) {
        // A placeholder has no full data to write into.
        return { status: 'gone' }
    }
    return { status: 'ready', character: after.holder, index: after.index }
}
