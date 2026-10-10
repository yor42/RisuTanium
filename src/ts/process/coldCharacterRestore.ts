import { DBState } from "../stores.svelte"
import { alertError } from "../alert"
import { language } from "../../lang"
import type { character, groupChat } from "../storage/database.svelte"
import { readColdStorageItem, type ColdReadErrorKind, type ColdStorageReadResult } from "./coldstorage.svelte"
import { applyStubStateOnRestore } from "./coldCharacter"
import { noteRestoredBytes, readSizeOf } from "./memory/restoredBytes"
import { findChaIdHolders, retainOnRestore } from "./coldRetained"

/**
 * Reading an archived character's unit back and installing it in place of its
 * stub, shared by `changeChar` (`characters.ts`),
 * `restoreColdCharacterByChaId` (`coldMemberRestore.ts`) and the plugin and
 * MCP access paths (`coldCharacterAccess.ts`, `coldRestoreAll.ts`). Reading a
 * copy without installing it is `readColdCharacterCopy`.
 *
 * This module must not import `characters.ts` or `index.svelte.ts` statically.
 * The group turn in `index.svelte.ts` loads `coldMemberRestore.ts` on demand
 * so that this path does not add a load-time cycle back through
 * `characters.ts`; a static import of either module here would put that cycle
 * back. (It does reach `index.svelte.ts` indirectly through
 * `coldstorage.svelte.ts`, which the rest of the application already loads.)
 * It does not look at `doingChat`, since a group turn restores a member
 * mid-send. Formatting the installed character and selecting it are the
 * callers' jobs.
 */

type Slot = character | groupChat

/**
 * Why a unit could not be used: there is no usable character in it
 * (`missing`), the storage failed to read it in a way that may work later
 * (`unreadable`), this page offers no storage for archived data
 * (`unavailable`), the stored copy does not decode or its key cannot be a
 * storage name (`damaged`), it holds a
 * character with another `chaId` than the placeholder (`mismatch`), or the
 * `chaId` is held by several characters (`ambiguous`). Only `missing`,
 * `mismatch` and `ambiguous` are worded as possible data loss
 * (`restoreFailureText`).
 */
export type ColdRestoreFailure = 'missing' | 'unreadable' | 'unavailable' | 'damaged' | 'mismatch' | 'ambiguous'

/**
 * The outcome of reading a stub's character without installing it. An
 * `unreadable` outcome is any failed read; its optional `kind` says the read
 * was one that cannot succeed here (`unavailable`) or whose bytes do not
 * decode or whose key cannot be a storage name (`damaged`), and only changes
 * the reason, and so the wording, of a refusal (`restoreFailureReason`).
 */
export type ColdCopyOutcome =
    | { status: 'ok', character: Slot }
    | { status: 'missing' }
    | { status: 'unreadable', error: unknown, kind?: ColdReadErrorKind }
    | { status: 'mismatch' }

export type ColdRestoreOutcome =
    /**
     * `character` is the character now in the list in place of the stub.
     * `installedHere` is true for the one call that read the unit and made the
     * install, false for a call that joined that restore or found the
     * character already full.
     */
    | { status: 'restored', character: Slot, installedHere: boolean }
    /** No slot to install into was left after the read. Nothing was installed and nothing was shown. */
    | { status: 'gone' }
    /**
     * The unit could not be used, or the chaId is held by several characters.
     * The stub is untouched. The user has been told, unless the request was
     * `quiet`: then the caller owns that, and `reason` says what happened.
     */
    | { status: 'refused', reason: ColdRestoreFailure }

export interface ColdRestoreOptions {
    /**
     * Find the slot to install into after the read by the stub's `chaId`
     * instead of by the stub object: the sole holder of that id. No holder
     * ends silently as `gone`; several holders are refused with the
     * user-facing alert. A sole holder that is already a full character is
     * left alone, and one that is a stub pointing at another unit than the one
     * read is `gone`: a unit is never installed into a placeholder that points
     * elsewhere. A request that joins a running restore applies the holder
     * count again once that restore has settled: none is `gone`, several are
     * refused with the alert.
     */
    byChaId?: boolean
    /**
     * Show no alert of its own on a refusal; the `reason` on the `refused`
     * outcome is the caller's to report. A request that joins a running restore
     * that was refused shows nothing: the running request's option decided what
     * was shown.
     */
    quiet?: boolean
}

// Defined beside the retained records, so that the put-back finds a holder without loading the storage reader.
export { findChaIdHolders }

/** One running restore per stub object; a second request for the same stub joins it instead of reading and installing again. */
const running = new WeakMap<object, Promise<ColdRestoreOutcome>>()

async function readUnit(key: string): Promise<ColdStorageReadResult> {
    try {
        return await readColdStorageItem(key)
    } catch (error) {
        return { status: 'error', error }
    }
}

/**
 * What `result`, the read of `key`, yields for `target`, the placeholder it
 * belongs to: the unit's character, or the way it failed. Logs the failure.
 */
function checkUnit(result: ColdStorageReadResult, key: string, target: Slot): ColdCopyOutcome {
    if (result.status === 'error') {
        console.error(`Cold storage unit ${key} of ${target.name} could not be read`, result.error)
        return result.kind
            ? { status: 'unreadable', error: result.error, kind: result.kind }
            : { status: 'unreadable', error: result.error }
    }
    const stored = result.status === 'ok' ? (result.value as { character?: Slot } | null | undefined)?.character : undefined
    if (!stored) {
        return { status: 'missing' }
    }
    if (stored.chaId !== target.chaId) {
        console.error(`Cold storage unit ${key} holds a character with chaId ${stored.chaId}, but the placeholder ${target.name} has chaId ${target.chaId}; the placeholder is kept`)
        return { status: 'mismatch' }
    }
    return { status: 'ok', character: stored }
}

/**
 * The full character in `stub`'s unit, as an independent copy that carries the
 * stub's trash state and newer `lastInteraction` (`applyStubStateOnRestore`).
 * It installs nothing, marks nothing for save and shows nothing:
 * `DBState.db.characters` is not touched
 * and the stub stays in its slot. Every call reads the unit again.
 */
export async function readColdCharacterCopy(stub: Slot): Promise<ColdCopyOutcome> {
    const key = stub.coldstorage
    if (!key) {
        return { status: 'missing' }
    }
    const outcome = checkUnit(await readUnit(key), key, stub)
    if (outcome.status !== 'ok') {
        return outcome
    }
    return { status: 'ok', character: applyStubStateOnRestore(stub, outcome.character) }
}

/**
 * The reason a restore is refused for a copy outcome that is not `ok`: the
 * outcome's status, except that an unreadable copy of a kind is refused as
 * that kind.
 */
export function restoreFailureReason(outcome: Exclude<ColdCopyOutcome, { status: 'ok' }>): ColdRestoreFailure {
    return outcome.status === 'unreadable' ? outcome.kind ?? 'unreadable' : outcome.status
}

/**
 * The unnamed message for `reason`. Every reason has its own case, so a reason
 * added to `ColdRestoreFailure` without a message fails the type check instead
 * of falling through to the possible-data-loss text.
 */
function restoreFailureText(reason: ColdRestoreFailure): string {
    switch (reason) {
        case 'unavailable':
            return language.errors.coldStorageRestoreUnavailable
        case 'damaged':
            return language.errors.coldStorageRestoreDamaged
        case 'unreadable':
            return language.errors.coldStorageRestoreUnreadable
        case 'missing':
        case 'mismatch':
        case 'ambiguous':
            return language.errors.coldStorageRestoreFailed
        default: {
            const unhandled: never = reason
            return unhandled
        }
    }
}

/** The refusal of a restore, with the user-facing alert unless the request is `quiet`. */
function refuse(options: ColdRestoreOptions, reason: ColdRestoreFailure): ColdRestoreOutcome {
    if (!options.quiet) {
        alertError(restoreFailureText(reason))
    }
    return { status: 'refused', reason }
}

async function restoreOnce(stub: Slot, options: ColdRestoreOptions): Promise<ColdRestoreOutcome> {
    const key = stub.coldstorage
    if (!key) {
        return { status: 'restored', character: stub, installedHere: false }
    }
    const chaId = stub.chaId
    const result = await readUnit(key)

    // The slot is found again after the read: entries may have been inserted,
    // deleted or replaced while it was pending, so an index taken before it
    // can point at another character.
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        return { status: 'gone' }
    }
    let index: number
    if (options.byChaId) {
        const holders = findChaIdHolders(chaId)
        if (holders.length === 0) {
            return { status: 'gone' }
        }
        if (holders.length > 1) {
            return refuse(options, 'ambiguous')
        }
        index = holders[0]
        const holder = characters[index]
        if (!holder.coldstorage) {
            return { status: 'restored', character: holder, installedHere: false }
        }
        if (holder.coldstorage !== key) {
            return { status: 'gone' }
        }
    } else {
        index = characters.indexOf(stub)
        if (index === -1) {
            return { status: 'gone' }
        }
    }
    // The slot's own state is what the restored character inherits: it may be
    // a copy of the stub that was trashed or lifted from the trash meanwhile.
    const target = characters[index]

    const unit = checkUnit(result, key, target)
    if (unit.status !== 'ok') {
        return refuse(options, restoreFailureReason(unit))
    }

    const restored = applyStubStateOnRestore(target, unit.character)
    characters[index] = restored
    // Over the plain object the unit decoded to, in the step that installs it:
    // nothing has changed it yet, so the fingerprint is what a put-back compares to.
    retainOnRestore(characters[index], target, restored)
    noteRestoredBytes(chaId, readSizeOf(result))
    return { status: 'restored', character: characters[index], installedHere: true }
}

/**
 * Replaces `stub`, a character that is in `DBState.db.characters` as an
 * archived placeholder, by the full character in its unit.
 *
 * The unit is read through `readColdStorageItem`, so a missing unit, one that
 * cannot be read now, a page with no storage for archived data, and a copy
 * that does not decode or whose key cannot be a storage name are told apart
 * to the user; only a missing, mismatched
 * or shared unit claims the data may be lost. The install lands only in the
 * slot found after the read (see `ColdRestoreOptions.byChaId`), and only when
 * the unit's character carries that slot's `chaId` (the placeholder never
 * adopts another id). The restored character keeps the trash state
 * `applyStubStateOnRestore` gives it from the slot as it is when the read
 * completes.
 *
 * Requests for one stub while a restore of it is running join that restore.
 */
export function restoreColdCharacter(stub: Slot, options: ColdRestoreOptions = {}): Promise<ColdRestoreOutcome> {
    const joined = running.get(stub)
    if (joined) {
        const chaId = stub.chaId
        return joined.then((outcome): ColdRestoreOutcome => {
            if (outcome.status !== 'restored') {
                return outcome
            }
            if (options.byChaId) {
                const holders = findChaIdHolders(chaId).length
                if (holders === 0) {
                    return { status: 'gone' }
                }
                if (holders > 1) {
                    return refuse(options, 'ambiguous')
                }
            }
            return { ...outcome, installedHere: false }
        })
    }
    const started = restoreOnce(stub, options).finally(() => {
        running.delete(stub)
    })
    running.set(stub, started)
    return started
}
