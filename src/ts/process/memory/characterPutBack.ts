/**
 * Puts a character that a store2 residency loaded this session back as the
 * stub it replaced, once the user has moved on and nothing changed it: the full
 * character is then released from memory instead of staying for the page's life.
 *
 * Put-back runs only on a page with a registered residency; with none it does
 * nothing.
 *
 * A character is a candidate when a selection change leaves it outside the
 * keep-set (the selected character and its group members, the previous
 * selection and its members, and any character a registered unit of work
 * writes). Every check is repeated in `fire`, which runs right after a save
 * iteration committed: only then is the character's saved block known to hold
 * what the residency holds, and the swap is followed by an explicit mark,
 * because no effect marks a stub put back into its slot.
 *
 * What decides is the residency's verdict against the acknowledged encoding,
 * and the stub comes from that encoding. The verdict and the swap run in one
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
import type { Residency } from '../../storage/store2/residency'
import { getResidency } from '../../storage/store2/residencyActive'
import { isWriting } from '../chatOrigin'
import {
    contentFingerprint,
    differingKeys,
    dropLoaded,
    findChaIdHolders,
    hasLoaded,
    loadedRecordOf,
    pruneRetained,
    retainedCount,
} from '../coldRetained'
import { anyChokePointInFlight, isBusy } from './busyActions'
import { addGroupMembers, baseKeepInline } from './keepSet'
import { MEASURE } from './measureFlag'
import {
    countReason,
    noteCandidate,
    noteCandidateExit,
    noteFire,
    readReasonCounters,
    registerPutBackProvider,
    resetPutBackMeasureForTest,
    type CandidateExit,
    type FireOutcome,
    type PutBackReason,
} from './putBackMeasure'
import { startQuietTrigger, type QuietTrigger } from './putBackQuiet'
import { clearRestoredBytes, restoredBytesOf } from './restoredBytes'

/** One `fire` swaps at most one character and fingerprints at most this many. It always starts the first fingerprint, so a stalled thread cannot make a fire judge nothing; `MAX_FIRE_MS` bounds starting any further one. */
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

/** Whether this database may put characters back at all: archiving on and a database at the block format version. */
function putBackMayRun(): boolean {
    const db = DBState.db
    return !!db
        && db.archiveCharacters !== false
        && typeof db.formatversion === 'number'
        && db.formatversion >= 5
}

function chaIdAt(index: number): string | null {
    const chaId = DBState.db?.characters?.[index]?.chaId
    return typeof chaId === 'string' && chaId !== '' ? chaId : null
}

/** The base keep-set and the previous selection with its group members; exported so a fast-forward counts the same characters in use. */
export function putBackKeepSet(): Set<string> {
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

if (MEASURE) {
    registerPutBackProvider({
        keepSet: () => putBackKeepSet(),
        retainedCount,
        fingerprint: (cha) => contentFingerprint(cha as Parameters<typeof contentFingerprint>[0]),
        differingKeys: (keyHashes, cha) => differingKeys({ keyHashes }, cha as Parameters<typeof contentFingerprint>[0]),
    })
}

function fire(): void {
    const startedAt = MEASURE ? performance.now() : 0
    const outcome = runFire()
    if (MEASURE) {
        noteFire(outcome, performance.now() - startedAt)
    }
}

function runFire(): FireOutcome {
    armed = false
    const residency = getResidency()
    if (residency === null) {
        clearPending('cleared-early')
        return 'empty'
    }
    return runFireStore2(residency, false)
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
 * The fire. It judges each candidate by the residency's verdict and swaps in the stub the acknowledged encoding
 * gives. `quietRun` takes the candidates from `deferredLarge` instead of `pending`; the foreground never judges a
 * large character.
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
        if (verdicts >= MAX_FINGERPRINTS_PER_FIRE || (verdicts > 0 && performance.now() - startedAt >= MAX_FIRE_MS)) {
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

/** Adds every loaded character outside the keep-set to the pending set and waits for the next commit. */
function onSelection(index: number): void {
    const chaId = chaIdAt(index)
    if (chaId !== null && chaId !== currentChaId) {
        previousChaId = currentChaId
        currentChaId = chaId
    }
    if (chaId !== null) {
        leave(chaId, 'cleared-selection')
    }
    if (getResidency() === null) {
        return
    }
    collectStore2Candidates(chaId)
}

/**
 * Starts watching the selection. Call it once, after the database is installed,
 * on a page that saves. Returns the function that stops it.
 */
export function startCharacterPutBack(): () => void {
    currentChaId = chaIdAt(get(selectedCharID))
    // Characters leave memory only through the residency: a page without one puts nothing back.
    if (getResidency() !== null) {
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
    resetPutBackMeasureForTest()
}
