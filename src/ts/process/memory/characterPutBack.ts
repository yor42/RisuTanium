/**
 * Puts a character that was restored from its unit back as the stub it
 * replaced, once the user has moved on and nothing changed it: the full
 * character is then released from memory instead of staying for the page's life.
 *
 * A character is a candidate when a selection change leaves it outside the
 * keep-set (the selected character and its group members, the previous
 * selection and its members, and any character a registered unit of work
 * writes). Every check is repeated in `fire`, which runs right after a save
 * iteration committed: only then is the character's saved block known to hold
 * what the unit holds, and the swap is followed by an explicit mark, because no
 * effect marks a stub put back into its slot.
 *
 * The put-back writes no unit and takes no lock, so it does not depend on the
 * boot archive pass being allowed on this platform.
 */

import { get } from 'svelte/store'
import { untrack } from 'svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { afterNextSaveCommit } from '../../globalApi.svelte'
import { markCharacterForSave } from '../../storage/characterSaveMarks'
import { hasEnabledV21Plugin } from '../../plugins/v21Plugins'
import { isWriting } from '../chatOrigin'
import {
    contentFingerprint,
    differingKeys,
    dropRetained,
    findChaIdHolders,
    hasRetained,
    pruneRetained,
    retainedRecordOf,
    type RetainedRecord,
} from '../coldRetained'
import { anyChokePointInFlight, isBusy } from './busyActions'
import { addGroupMembers, baseKeepInline } from './keepSet'
import { clearRestoredBytes } from './restoredBytes'

/** One `fire` swaps at most one character, fingerprints at most this many, and stops starting a fingerprint after `MAX_FIRE_MS`. */
const MAX_FINGERPRINTS_PER_FIRE = 3
const MAX_FIRE_MS = 8

/*
 * Only a swap's own mark guarantees another commit. After a stop with no swap
 * (the fingerprint or time budget, a busy deferral, or an `isWriting` deferral)
 * the remaining candidates wait in `pending` for the next commit from any
 * mark. That is safe, because every check runs again in `fire`; the cost is
 * that the full characters stay in memory longer.
 */

/** Why a candidate was or was not put back; counted in development builds only, in memory only. */
export type PutBackReason = 'clean' | 'dirty' | 'busy' | 'writing' | 'kept' | 'gone'

const counters: Record<PutBackReason, number> = { clean: 0, dirty: 0, busy: 0, writing: 0, kept: 0, gone: 0 }

function count(reason: PutBackReason): void {
    if (import.meta.env.DEV) {
        counters[reason] += 1
    }
}

export function getPutBackCounters(): Readonly<Record<PutBackReason, number>> {
    return { ...counters }
}

/** The `chaId`s waiting for the next commit; checked again, in full, when it comes. */
const pending = new Set<string>()
let currentChaId: string | null = null
let previousChaId: string | null = null
let armed = false

/** Whether this database may put characters back at all: archiving on, no V2.1 plugin and a block-format database. */
function putBackMayRun(): boolean {
    const db = DBState.db
    return !!db
        && db.archiveCharacters !== false
        && !hasEnabledV21Plugin(db.plugins)
        && typeof db.formatversion === 'number'
        && db.formatversion >= 5
}

function chaIdAt(index: number): string | null {
    const chaId = DBState.db?.characters?.[index]?.chaId
    return typeof chaId === 'string' && chaId !== '' ? chaId : null
}

/** The base keep-set and the previous selection with its group members. */
function putBackKeepSet(): Set<string> {
    const keep = baseKeepInline()
    if (previousChaId !== null) {
        keep.add(previousChaId)
        const characters = DBState.db?.characters
        for (const index of findChaIdHolders(previousChaId)) {
            addGroupMembers(keep, characters?.[index])
        }
    }
    return keep
}

function arm(): void {
    if (!armed) {
        armed = true
        afterNextSaveCommit(fire)
    }
}

/** Swaps the retained stub into `index`, carrying what changes without the content changing, and marks it for save. */
function swapIn(characters: NonNullable<typeof DBState.db>['characters'], index: number, record: RetainedRecord): void {
    const live = characters[index]
    const stub = record.stub
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
    characters[index] = stub
    dropRetained(record)
    // No effect marks a stub put back into its slot, and the character's saved
    // block is the full one: without this the stub would never be written.
    markCharacterForSave(record.chaId)
    clearRestoredBytes(record.chaId)
}

function fire(): void {
    armed = false
    if (!putBackMayRun()) {
        pending.clear()
        return
    }
    if (isBusy() || anyChokePointInFlight()) {
        count('busy')
        arm()
        return
    }
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        pending.clear()
        return
    }
    pruneRetained()
    const keep = putBackKeepSet()
    const startedAt = performance.now()
    let fingerprints = 0
    for (const chaId of [...pending]) {
        if (keep.has(chaId)) {
            pending.delete(chaId)
            count('kept')
            continue
        }
        const holders = findChaIdHolders(chaId)
        const record = holders.length === 1 ? retainedRecordOf(characters[holders[0]]) : undefined
        if (!record) {
            pending.delete(chaId)
            count('gone')
            continue
        }
        if (isWriting({ chaId })) {
            count('writing')
            continue
        }
        if (fingerprints >= MAX_FINGERPRINTS_PER_FIRE || performance.now() - startedAt >= MAX_FIRE_MS) {
            break
        }
        fingerprints += 1
        pending.delete(chaId)
        if (contentFingerprint(characters[holders[0]]) !== record.fp) {
            if (import.meta.env.DEV) {
                console.debug('[put-back] changed since restore, kept loaded:', chaId, differingKeys(record, characters[holders[0]]))
            }
            dropRetained(record)
            count('dirty')
            continue
        }
        swapIn(characters, holders[0], record)
        count('clean')
        break
    }
    if (pending.size > 0) {
        arm()
    }
}

/** Adds every retained character outside the keep-set to the pending set and waits for the next commit. */
function onSelection(index: number): void {
    const chaId = chaIdAt(index)
    if (chaId !== null && chaId !== currentChaId) {
        previousChaId = currentChaId
        currentChaId = chaId
    }
    if (chaId !== null) {
        pending.delete(chaId)
    }
    if (!hasRetained() || !putBackMayRun()) {
        return
    }
    const keep = putBackKeepSet()
    for (const cha of DBState.db.characters) {
        const record = retainedRecordOf(cha)
        if (record && !keep.has(record.chaId)) {
            pending.add(record.chaId)
        }
    }
    if (pending.size > 0) {
        arm()
    }
}

/**
 * Starts watching the selection. Call it once, after the database is installed,
 * on a page that saves. Returns the function that stops it.
 */
export function startCharacterPutBack(): () => void {
    currentChaId = chaIdAt(get(selectedCharID))
    // The body runs untracked: a selection set from inside an effect would
    // otherwise make that effect depend on every character read here.
    return selectedCharID.subscribe((index) => untrack(() => onSelection(index)))
}

export function resetPutBackForTest(): void {
    pending.clear()
    currentChaId = null
    previousChaId = null
    armed = false
    for (const reason of Object.keys(counters) as PutBackReason[]) {
        counters[reason] = 0
    }
}
