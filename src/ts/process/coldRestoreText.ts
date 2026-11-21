import { language } from "../../lang"
import type { ColdRestoreFailure } from "./coldCharacterRestore"

/**
 * The wording of an archived-restore failure alert, kept apart from
 * `coldCharacterRestore.ts` so that UI modules can name the character without
 * loading the restore and storage stack. This module imports only `language`
 * and, as a type, `ColdRestoreFailure`.
 */

/** The name a restore failure message gives `slot`: its own, else the shared fallback for a slot with none. */
export function restoreFailureName(slot: { name?: string }): string {
    return slot.name || language.errors.coldStorageUnknownCharacterName
}

/**
 * The message naming the character `name` for `reason`. Every reason has its
 * own case, so a reason added to `ColdRestoreFailure` without a message fails
 * the type check instead of falling through to the possible-data-loss text.
 * Only `missing`, `mismatch` and `ambiguous` claim the data may be lost.
 */
export function namedRestoreFailureText(name: string, reason: ColdRestoreFailure): string {
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
