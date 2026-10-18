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
 *
 * A restored character found changed is not dropped from the retained records
 * when re-archiving may run: it is marked dirty and left to
 * `characterRearchive.ts`, which writes its new unit. The put-back never
 * fingerprints a dirty-marked record again.
 *
 * On a page with a store2 residency (`runFireStore2`) the same selection logic
 * unloads a character that residency loaded this session. What decides is the
 * residency's verdict against the acknowledged encoding, not a fingerprint, and
 * the stub comes from that encoding. The verdict and the swap run in one
 * synchronous task: an edit between them would be lost. A dirty verdict marks
 * the character so that the next pass writes it, and a later commit judges it
 * again, at most `MAX_DIRTY_VERDICTS` times. A character created or imported
 * this session was not loaded, has no record and stays resident. A large
 * character is judged only when the page is quiet (`putBackQuiet.ts`).
 */

import { get } from 'svelte/store'
import { untrack } from 'svelte'
import { DBState, selectedCharID } from '../../stores.svelte'
import { afterNextSaveCommit } from '../../globalApi.svelte'
import { markCharacterForSave } from '../../storage/characterSaveMarks'
import { hasEnabledV21Plugin } from '../../plugins/v21Plugins'
import type { Residency } from '../../storage/store2/residency'
import { getResidency } from '../../storage/store2/residencyActive'
import { isWriting } from '../chatOrigin'
import {
    contentFingerprint,
    differingKeys,
    dropLoaded,
    dropRetained,
    findChaIdHolders,
    hasLoaded,
    hasRetained,
    isDirtyRecord,
    loadedRecordOf,
    noteDirtyRecord,
    pruneRetained,
    rawRefOf,
    retainedCount,
    retainedRecordOf,
    type RetainedRecord,
} from '../coldRetained'
import { anyChokePointInFlight, isBusy } from './busyActions'
import { rearchiveMayRun, rearchiveOnSelection, resetCharacterRearchiveForTest, startCharacterRearchive } from './characterRearchive'
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
import { startQuietTrigger, type QuietTrigger } from './putBackQuiet'
import { clearRestoredBytes, restoredBytesOf } from './restoredBytes'

/** One `fire` swaps at most one character, fingerprints at most this many, and stops starting a fingerprint after `MAX_FIRE_MS`. */
const MAX_FINGERPRINTS_PER_FIRE = 3
const MAX_FIRE_MS = 8

/** A character whose last read was larger than this is judged only when the page is quiet. */
const LARGE_BYTES = 1024 * 1024

/** Dirty verdicts a character may collect before the store2 put-back leaves it loaded; a selection of it starts the count again. */
const MAX_DIRTY_VERDICTS = 3

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
/** Store2 only: the large candidates, which wait for the quiet trigger instead of the next commit. */
const deferredLarge = new Set<string>()
/** Store2 only: the dirty verdicts each character has had since it was last selected. */
const dirtyVerdicts = new Map<string, number>()
let quiet: QuietTrigger | null = null
let currentChaId: string | null = null
let previousChaId: string | null = null
let armed = false
let tripwireArmed = false

/** Takes `chaId` out of `pending`, recording how long it waited and why it left. */
function leave(chaId: string, exit: CandidateExit): void {
    pending.delete(chaId)
    deferredLarge.delete(chaId)
    if (MEASURE) {
        noteCandidateExit(chaId, exit)
    }
}

function clearPending(exit: CandidateExit): void {
    for (const chaId of [...pending, ...deferredLarge]) {
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
    const residency = getResidency()
    if (residency !== null) {
        return runFireStore2(residency, false)
    }
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
        if (isDirtyRecord(record)) {
            leave(chaId, 'dirty')
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
            if (rearchiveMayRun() === null) {
                noteDirtyRecord(record)
            } else {
                dropRetained(record)
            }
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

function armQuiet(): void {
    quiet?.arm()
}

/** Asks for the quiet trigger once the next commit has landed: nothing guarantees one, but a swap or a dirty mark always makes one. */
function armQuietAfterCommit(): void {
    afterNextSaveCommit(armQuiet)
}

/** The quiet trigger's callback: the store2 fire over the large candidates. */
function fireQuiet(): void {
    const residency = getResidency()
    if (residency === null) {
        deferredLarge.clear()
        return
    }
    runFireStore2(residency, true)
}

/**
 * The store2 fire. It runs the checks of the legacy `runFire` in the same order, then judges each candidate by the
 * residency's verdict and swaps in the stub the acknowledged encoding gives. `quietRun` takes the candidates from
 * `deferredLarge` instead of `pending`; the foreground never judges a large character.
 */
function runFireStore2(residency: Residency, quietRun: boolean): FireOutcome {
    const candidates = quietRun ? deferredLarge : pending
    const wait = quietRun ? armQuietAfterCommit : arm
    if (!putBackMayRun()) {
        clearPending('cleared-early')
        return 'empty'
    }
    if (isBusy() || anyChokePointInFlight()) {
        count('busy')
        wait()
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
    let verdicts = 0
    let deferredWriting = false
    let dropped = false
    for (const chaId of [...candidates]) {
        if (keep.has(chaId)) {
            leave(chaId, 'kept')
            count('kept')
            dropped = true
            continue
        }
        const holders = findChaIdHolders(chaId)
        const loaded = holders.length === 1 ? loadedRecordOf(characters[holders[0]]) : undefined
        if (!loaded) {
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
        if (!quietRun && restoredBytesOf(chaId) > LARGE_BYTES) {
            // Not a verdict: it counts toward nothing.
            pending.delete(chaId)
            deferredLarge.add(chaId)
            continue
        }
        if (verdicts >= MAX_FINGERPRINTS_PER_FIRE || performance.now() - startedAt >= MAX_FIRE_MS) {
            break
        }
        verdicts += 1
        // No await from the verdict to the swap.
        const index = holders[0]
        const verdict = residency.verdict(characters[index])
        const stub = verdict === 'clean' ? residency.stubFor(characters[index]) : null
        if (stub !== null) {
            // The stub is the plain object the database assembly gives for an entity: a boundary into the typed list.
            characters[index] = stub as unknown as typeof characters[number]
            dropLoaded(loaded)
            // The stub is carried, so this pass writes nothing; it only guarantees a commit for the callbacks.
            markCharacterForSave(chaId)
            clearRestoredBytes(chaId)
            dirtyVerdicts.delete(chaId)
            leave(chaId, 'swap')
            count('clean')
            break
        }
        if (verdict === 'dirty') {
            markCharacterForSave(chaId)
            const dirty = (dirtyVerdicts.get(chaId) ?? 0) + 1
            dirtyVerdicts.set(chaId, dirty)
            count('dirty')
            if (dirty >= MAX_DIRTY_VERDICTS) {
                leave(chaId, 'dirty')
            }
            continue
        }
        // The acknowledged encoding cannot answer for it (a shared id, an outcome not yet known): it stays loaded.
        leave(chaId, 'gone')
        count('gone')
        dropped = true
    }
    if (candidates.size > 0) {
        wait()
    }
    if (!quietRun && deferredLarge.size > 0) {
        armQuiet()
    }
    if (verdicts > 0) {
        return 'fingerprinted'
    }
    if (deferredWriting) {
        return 'writing'
    }
    return dropped ? 'kept-only' : 'empty'
}

/** Adds the loaded characters outside the keep-set to the pending set and waits for the next commit. */
function collectStore2Candidates(chaId: string | null): void {
    if (chaId !== null) {
        dirtyVerdicts.delete(chaId)
    }
    if (!hasLoaded() || !putBackMayRun()) {
        return
    }
    const keep = putBackKeepSet()
    for (const cha of DBState.db.characters) {
        const record = loadedRecordOf(cha)
        if (record && !keep.has(record.chaId) && (dirtyVerdicts.get(record.chaId) ?? 0) < MAX_DIRTY_VERDICTS) {
            pending.add(record.chaId)
            if (MEASURE) {
                noteCandidate(record.chaId)
            }
        }
    }
    if (pending.size > 0) {
        // A selection change runs the selected-character effect, which marks a pass, so a commit follows even when
        // nothing was edited.
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
    // Before the retained-record exit: a character that was never restored has
    // no record and is still a re-archive candidate.
    rearchiveOnSelection()
    if (chaId !== null) {
        leave(chaId, 'cleared-selection')
    }
    if (getResidency() !== null) {
        collectStore2Candidates(chaId)
        return
    }
    if (!hasRetained() || !putBackMayRun()) {
        return
    }
    const keep = putBackKeepSet()
    for (const cha of DBState.db.characters) {
        const record = retainedRecordOf(cha)
        if (record && !isDirtyRecord(record) && !keep.has(record.chaId)) {
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
    // A store2 page has no re-archive: its characters leave memory only through the residency.
    if (getResidency() === null) {
        // Before the subscription below, which calls `onSelection` at once.
        startCharacterRearchive({ keepSet: putBackKeepSet, armTripwire: MEASURE ? armTripwire : undefined })
    } else {
        quiet?.stop()
        quiet = startQuietTrigger(fireQuiet)
    }
    // The body runs untracked: a selection set from inside an effect would
    // otherwise make that effect depend on every character read here.
    const unsubscribe = selectedCharID.subscribe((index) => untrack(() => onSelection(index)))
    return () => {
        unsubscribe()
        quiet?.stop()
        quiet = null
    }
}

export function resetPutBackForTest(): void {
    quiet?.stop()
    quiet = null
    deferredLarge.clear()
    dirtyVerdicts.clear()
    pending.clear()
    currentChaId = null
    previousChaId = null
    armed = false
    tripwireArmed = false
    resetCharacterRearchiveForTest()
    resetPutBackMeasureForTest()
}
