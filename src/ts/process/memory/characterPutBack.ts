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
    rawRefOf,
    retainedCount,
    retainedRecordOf,
    type RetainedRecord,
} from '../coldRetained'
import { anyChokePointInFlight, isBusy } from './busyActions'
import { addGroupMembers, baseKeepInline } from './keepSet'
import { MEASURE, tripwireEnabled } from './measureFlag'
import {
    countReason,
    noteCandidate,
    noteCandidateExit,
    noteDirty,
    noteFingerprint,
    noteFire,
    noteReplaced,
    readReasonCounters,
    registerPutBackProvider,
    resetPutBackMeasureForTest,
    tripwireStep,
    type CandidateExit,
    type FireOutcome,
    type PutBackReason,
} from './putBackMeasure'
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

/** Why a candidate was or was not put back; counted in measurement builds only, in memory only. */
export type { PutBackReason }

function count(reason: PutBackReason): void {
    if (MEASURE) {
        countReason(reason)
    }
}

export function getPutBackCounters(): Readonly<Record<PutBackReason, number>> {
    return readReasonCounters()
}

/** The `chaId`s waiting for the next commit; checked again, in full, when it comes. */
const pending = new Set<string>()
let currentChaId: string | null = null
let previousChaId: string | null = null
let armed = false
let tripwireArmed = false

/** Takes `chaId` out of `pending`, recording how long it waited and why it left. */
function leave(chaId: string, exit: CandidateExit): void {
    pending.delete(chaId)
    if (MEASURE) {
        noteCandidateExit(chaId, exit)
    }
}

function clearPending(exit: CandidateExit): void {
    for (const chaId of [...pending]) {
        leave(chaId, exit)
    }
}

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

/** Re-arms itself for the next save commit until the measurement module wants no more. */
function armTripwire(): void {
    if (!tripwireArmed) {
        tripwireArmed = true
        afterNextSaveCommit(() => {
            tripwireArmed = false
            if (tripwireStep()) {
                armTripwire()
            }
        })
    }
}

if (MEASURE) {
    registerPutBackProvider({
        keepSet: () => putBackKeepSet(),
        retainedCount,
        fingerprint: (cha) => contentFingerprint(cha as Parameters<typeof contentFingerprint>[0]),
        differingKeys: (keyHashes, cha) => differingKeys({ keyHashes }, cha as Parameters<typeof contentFingerprint>[0]),
    })
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
    // The replaced object is held weakly only.
    if (MEASURE && tripwireEnabled()) {
        noteReplaced(record.chaId, record.fp, record.keyHashes, live, rawRefOf(record))
        armTripwire()
    }
    dropRetained(record)
    // No effect marks a stub put back into its slot, and the character's saved
    // block is the full one: without this the stub would never be written.
    markCharacterForSave(record.chaId)
    clearRestoredBytes(record.chaId)
}

/** Time inside the current fire that a normal build does not spend: left out of its duration and of its time budget. */
let measurementMs = 0

function fire(): void {
    const startedAt = MEASURE ? performance.now() : 0
    measurementMs = 0
    const outcome = runFire()
    if (MEASURE) {
        noteFire(outcome, performance.now() - startedAt - measurementMs)
    }
}

function runFire(): FireOutcome {
    armed = false
    if (!putBackMayRun()) {
        clearPending('cleared-early')
        return 'empty'
    }
    if (isBusy() || anyChokePointInFlight()) {
        count('busy')
        arm()
        return 'busy'
    }
    const characters = DBState.db?.characters
    if (!Array.isArray(characters)) {
        clearPending('cleared-early')
        return 'empty'
    }
    pruneRetained()
    const keep = putBackKeepSet()
    const startedAt = performance.now()
    let fingerprints = 0
    let deferredWriting = false
    let dropped = false
    for (const chaId of [...pending]) {
        if (keep.has(chaId)) {
            leave(chaId, 'kept')
            count('kept')
            dropped = true
            continue
        }
        const holders = findChaIdHolders(chaId)
        const record = holders.length === 1 ? retainedRecordOf(characters[holders[0]]) : undefined
        if (!record) {
            leave(chaId, 'gone')
            count('gone')
            dropped = true
            continue
        }
        if (isWriting({ chaId })) {
            count('writing')
            deferredWriting = true
            continue
        }
        if (fingerprints >= MAX_FINGERPRINTS_PER_FIRE || performance.now() - startedAt - measurementMs >= MAX_FIRE_MS) {
            break
        }
        fingerprints += 1
        const fingerprintStartedAt = MEASURE ? performance.now() : 0
        const current = contentFingerprint(characters[holders[0]])
        if (MEASURE) {
            noteFingerprint('fire', performance.now() - fingerprintStartedAt, current)
        }
        if (current !== record.fp) {
            if (MEASURE) {
                const blockStartedAt = performance.now()
                const keys = differingKeys(record, characters[holders[0]])
                noteFingerprint('fire-keyhash', performance.now() - blockStartedAt, current)
                noteDirty(chaId, keys)
                if (import.meta.env.DEV) {
                    console.debug('[put-back] changed since restore, kept loaded:', chaId, keys)
                }
                measurementMs += performance.now() - blockStartedAt
            }
            leave(chaId, 'dirty')
            dropRetained(record)
            count('dirty')
            continue
        }
        swapIn(characters, holders[0], record)
        leave(chaId, 'swap')
        count('clean')
        break
    }
    if (pending.size > 0) {
        arm()
    }
    if (fingerprints > 0) {
        return 'fingerprinted'
    }
    if (deferredWriting) {
        return 'writing'
    }
    return dropped ? 'kept-only' : 'empty'
}

/** Adds every retained character outside the keep-set to the pending set and waits for the next commit. */
function onSelection(index: number): void {
    const chaId = chaIdAt(index)
    if (chaId !== null && chaId !== currentChaId) {
        previousChaId = currentChaId
        currentChaId = chaId
    }
    if (chaId !== null) {
        leave(chaId, 'cleared-selection')
    }
    if (!hasRetained() || !putBackMayRun()) {
        return
    }
    const keep = putBackKeepSet()
    for (const cha of DBState.db.characters) {
        const record = retainedRecordOf(cha)
        if (record && !keep.has(record.chaId)) {
            pending.add(record.chaId)
            if (MEASURE) {
                noteCandidate(record.chaId)
            }
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
    tripwireArmed = false
    resetPutBackMeasureForTest()
}
