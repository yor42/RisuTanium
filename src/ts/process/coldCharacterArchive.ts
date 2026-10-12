import { v4 as uuidv4 } from 'uuid'
import { DBState } from '../stores.svelte'
import type { character, groupChat } from '../storage/database.svelte'
import { markCharacterForSave } from '../storage/characterSaveMarks'
import { isUsableCharacterId } from '../storage/characterIds'
import { readColdStorageItem, writeColdStorageUnit } from './coldstorage.svelte'
import { buildColdStub, coldUnitCharacter } from './coldCharacter'
import { pointerChatKeys } from './coldstorageData'
import { contentFingerprint, dropRetained, findChaIdHolders, retainedRecordOf } from './coldRetained'
import { archiveMayRun } from './archiveGate'
import { clearRestoredBytes } from './memory/restoredBytes'

/**
 * Archiving one character now: its full content is written to a new
 * cold-storage unit, read back and compared, and only then is the character's
 * place in the list taken by the stub that points at the unit. This is the
 * write side that `coldCharacterRestore.ts` reads, and it writes the same unit
 * shape (`{character}`) and the same stub (`buildColdStub`) as the boot pass.
 *
 * Every unit key is new, so no existing unit is overwritten. The engine never
 * deletes a unit (`previousUnitKey` is only handed back to the caller), never
 * formats or normalizes the character (the unit leaves out `trashTime`, see
 * `coldUnitCharacter`), takes no lock and does not commit: the
 * stub reaches disk through the normal save, which `markCharacterForSave`
 * schedules. It checks no busy state, keep-set or trash policy; a caller that
 * needs those passes them in `finalCheck`.
 *
 * Nothing is placed in the list until the unit has been written and read back
 * with the fingerprint the character had when it was handed in. A failure
 * leaves the list and the character untouched; a unit that was already written
 * stays behind as an orphan, reported in `writtenUnitKey`. Placing the stub is
 * the commit point: after it the result is always `ok`, and the follow-up steps
 * only log.
 *
 * This module must not import `characters.ts` or `index.svelte.ts`
 * statically (see `coldCharacterRestore.ts`).
 */

type Slot = character | groupChat

export type ArchiveTarget =
    /** Not in the list; on success the stub is appended. */
    | { kind: 'new', character: Slot }
    /** In the list (found by identity); on success its slot holds the stub. */
    | { kind: 'loaded', character: Slot, previousUnitKey?: string }

export interface ArchiveOptions {
    /** Synchronous, run in the final step after the built-in checks; a non-empty string refuses the archive. */
    finalCheck?: () => string | null
    /** Tests only: the key of the unit to write. */
    newUnitKey?: () => string
}

export type ArchiveFailure =
    | 'unavailable'     // this session cannot archive
    | 'setting'         // archiveCharacters is not true
    | 'format-version'  // formatversion below the block format
    | 'v21-plugin'
    | 'bad-target'      // already a stub, a missing, unusable or hidden-character (§) chaId, or not an object
    | 'id-taken'        // new: some slot holds the chaId; loaded: it is not the sole holder
    | 'slot-gone'       // loaded: the character is no longer in the list
    | 'changed'         // loaded: its content differs from what was written
    | 'too-large'       // the unit is over what the Node server accepts; a property of the character, not a device fault
    | 'write-failed'
    | 'read-failed'
    | 'read-mismatch'   // the unit read back holds another chaId or other content
    | 'refused'         // finalCheck said no
    | 'error'           // an unexpected throw before placement

export type ArchiveResult =
    | {
        ok: true
        index: number
        chaId: string
        /** The slot's element read back after placement (the reactive object that now holds the stub), so `characters[index] === stub` holds. */
        stub: Slot
        unitKey: string
        previousUnitKey: string | null
    }
    | {
        ok: false
        reason: ArchiveFailure
        /** The unit that was written before the failure and now has no stub pointing at it. */
        writtenUnitKey: string | null
        /** True only for a device or storage failure; a gate refusal, a changed character or a finalCheck refusal never is. */
        countsAsFailure: boolean
    }

const COUNTED_FAILURES: ReadonlySet<ArchiveFailure> = new Set<ArchiveFailure>(['write-failed', 'read-failed', 'read-mismatch', 'error'])

function failure(reason: ArchiveFailure, writtenUnitKey: string | null): ArchiveResult {
    return { ok: false, reason, writtenUnitKey, countsAsFailure: COUNTED_FAILURES.has(reason) }
}

export { archiveMayRun }

function isArchivableTarget(value: unknown): value is Slot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false
    }
    const cha = value as Slot
    return !cha.coldstorage
        && typeof cha.chaId === 'string'
        && !cha.chaId.startsWith('§')
        && isUsableCharacterId(cha.chaId)
}

function indexOfIdentity(character: Slot): number {
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        return -1
    }
    for (let i = 0; i < characters.length; i++) {
        if (characters[i] === character) {
            return i
        }
    }
    return -1
}

/** Runs one follow-up of a placed stub; a throw is logged and never changes the result. */
function followUp(step: () => void): void {
    try {
        step()
    } catch (error) {
        console.error('Archived character follow-up failed', error)
    }
}

/**
 * Archives `target` now. Never rejects. On `ok` exactly one slot holds a stub
 * that names a unit read back with the fingerprint the character had on entry,
 * and the character is marked for save. On failure nothing in the list changed.
 */
export async function archiveCharacterNow(target: ArchiveTarget, options: ArchiveOptions = {}): Promise<ArchiveResult> {
    let written: string | null = null
    let stub: Slot
    let key: string
    let chaId: string
    let record: ReturnType<typeof retainedRecordOf>
    let liveIndex = -1
    try {
        const blocked = archiveMayRun()
        if (blocked) {
            return failure(blocked, null)
        }
        const live = target.character
        if (!isArchivableTarget(live)) {
            return failure('bad-target', null)
        }
        chaId = live.chaId
        if (target.kind === 'new') {
            if (findChaIdHolders(chaId).length > 0) {
                return failure('id-taken', null)
            }
        } else {
            const index = indexOfIdentity(live)
            if (index === -1) {
                return failure('slot-gone', null)
            }
            const holders = findChaIdHolders(chaId)
            if (holders.length !== 1 || holders[0] !== index) {
                return failure('id-taken', null)
            }
        }

        const fp = contentFingerprint(live)
        key = (options.newUnitKey ?? uuidv4)()
        const writeResult = await writeColdStorageUnit(key, { character: coldUnitCharacter(live) })
        if (writeResult === 'too-large') {
            return failure('too-large', null)
        }
        if (writeResult !== 'written') {
            return failure('write-failed', null)
        }
        written = key

        const read = await readColdStorageItem(key)
        if (read.status !== 'ok') {
            return failure('read-failed', written)
        }
        const readBack = (read.value as { character?: Slot } | null | undefined)?.character
        if (typeof readBack !== 'object' || readBack === null || readBack.chaId !== chaId || contentFingerprint(readBack) !== fp) {
            return failure('read-mismatch', written)
        }

        // Final step: no await from here to the placement.
        const stillBlocked = archiveMayRun()
        if (stillBlocked) {
            return failure(stillBlocked, written)
        }
        if (target.kind === 'new') {
            if (findChaIdHolders(chaId).length > 0) {
                return failure('id-taken', written)
            }
        } else {
            liveIndex = indexOfIdentity(live)
            if (liveIndex === -1) {
                return failure('slot-gone', written)
            }
            const holders = findChaIdHolders(chaId)
            if (holders.length !== 1 || holders[0] !== liveIndex) {
                return failure('id-taken', written)
            }
            if (contentFingerprint(live) !== fp) {
                return failure('changed', written)
            }
        }
        if (options.finalCheck?.()) {
            return failure('refused', written)
        }

        stub = buildColdStub(readBack, key, pointerChatKeys(readBack))
        if (typeof live.lastInteraction === 'number') {
            stub.lastInteraction = live.lastInteraction
        } else {
            delete stub.lastInteraction
        }
        if (live.trashTime) {
            stub.trashTime = live.trashTime
        } else {
            delete stub.trashTime
        }
        record = target.kind === 'loaded' ? retainedRecordOf(live) : undefined
    } catch (error) {
        console.error('Archiving a character failed', error)
        return failure('error', written)
    }

    // Placement is the commit point: from here on the result is ok.
    let index: number
    let placed: Slot
    try {
        const characters = DBState.db.characters
        if (target.kind === 'new') {
            index = characters.push(stub) - 1
        } else {
            index = liveIndex
            characters[index] = stub
        }
        placed = characters[index]
    } catch (error) {
        console.error('Placing an archived character failed', error)
        return failure('error', written)
    }
    if (target.kind === 'loaded') {
        followUp(() => clearRestoredBytes(chaId))
        if (record) {
            const retained = record
            followUp(() => dropRetained(retained))
        }
    }
    followUp(() => markCharacterForSave(chaId))
    return {
        ok: true,
        index,
        chaId,
        stub: placed,
        unitKey: key,
        previousUnitKey: target.kind === 'loaded' ? target.previousUnitKey ?? null : null,
    }
}
