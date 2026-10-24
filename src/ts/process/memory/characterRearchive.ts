/**
 * Archives a loaded character again once the user has moved on: its full
 * content is written to a new unit and a stub takes its slot, so the full
 * character is released from memory. It covers the characters the put-back
 * cannot (`characterPutBack.ts`): a restored character that was edited, a
 * character that was never archived this session, and one a plugin restored.
 * The write is the archive engine's (`coldCharacterArchive.ts`), whose
 * fingerprint, read-back and final-step checks decide whether the stub is
 * placed; this module decides only which character to offer it and when.
 *
 * A character is a candidate when it is outside the keep-set (the selected
 * character and its group members, the previous selection and its members),
 * is not written by any registered unit of work, is not due for the startup
 * purge, has not failed here before, and either has no restore record or has
 * one the put-back found changed (`isDirtyRecord`). The put-back decides every
 * other restored character first, so the two jobs never act on the same one.
 *
 * One job runs at a time and one job starts per save commit. The commit
 * callback only schedules a macrotask: the callback runs inside the save
 * iteration, and the engine fingerprints and serializes the whole character
 * synchronously, so that work must start outside it and after every other
 * callback of the commit (the put-back's swaps) has run. `armed` stays set
 * from the callback until that macrotask, so a second commit or a selection
 * change in between schedules nothing.
 *
 * The engine places the stub without awaiting. If the placement lands while a
 * save iteration is encoding that character's block, the iteration may pack the
 * full block under the stub's name; the commit still loads, the character stays
 * full, and the placement's own mark makes the next iteration write the stub.
 *
 * A candidate that cannot be decided yet re-arms for the next commit: one
 * O(n) scan per commit while a restored record awaits the put-back's verdict
 * (a plugin-restored one outside the put-back's pending set waits for the next
 * selection change) or while a registered writer holds a character. Both end
 * when the verdict or the writer does.
 *
 * On success the unit the character's earlier stub named is handed to
 * `supersededUnits.ts`, which deletes it only when no copy of the profile can
 * still name it.
 *
 * Memory only: the failure memo, the orphan counts and the strike count start
 * empty on a page load and are never persisted. The device-wide pause the boot
 * pass records (`readArchiveStrikes`) is honoured but never written here.
 *
 * This module must not import `characterPutBack.ts` (it injects its keep-set),
 * `characters.ts` or `index.svelte.ts`.
 */

import { DBState } from '../../stores.svelte'
import type { Database, character, groupChat } from '../../storage/database.svelte'
import { afterNextSaveCommit, getPeerSaveCount, getSaveMarkCount } from '../../globalApi.svelte'
import { isUsableCharacterId } from '../../storage/characterIds'
import { readArchiveMemo, readArchiveStrikes } from '../../storage/bootArchiveMemo'
import { archiveMayRun, type ArchiveGateFailure } from '../archiveGate'
import { isArchivableCharacter } from '../coldCharacter'
import { contentFingerprint, findChaIdHolders, isDirtyRecord, retainedRecordOf } from '../coldRetained'
import { isWriting } from '../chatOrigin'
import { anyChokePointInFlight, isBusy } from './busyActions'
import { MEASURE, putBackEnabled, tripwireEnabled } from './measureFlag'
import { queueSupersededUnit, resetSupersededUnitsForTest } from './supersededUnits'
import { noteFingerprint, noteReplaced, noteRearchive, type RearchiveOutcome } from './putBackMeasure'

type Slot = character | groupChat

/** What this module needs from the put-back, which owns the selection history. */
export interface RearchiveDeps {
    /** The characters that must stay as they are. */
    keepSet(): Set<string>
    /** Measurement builds only: watch late writes to a character just replaced by a stub. */
    armTripwire?(): void
}

/** Why re-archiving may not run now; the engine's gates plus the two this module adds. */
export type RearchiveBlock = ArchiveGateFailure | 'device-paused' | 'put-back-off'

/** Two counted failures in a row stop re-archiving for the page's life, as the boot pass stops after two. */
const MAX_STRIKES = 2
/** After this many units written for one character and then refused, the character is not tried again. */
const MAX_ORPHANS_PER_CHARACTER = 2

let deps: RearchiveDeps | null = null
let armed = false
let jobPending = false
let strikes = 0
let stoppedForSession = false
const memo = new Set<string>()
const orphans = new Map<string, number>()
let memoDb: Database | null = null

function count(outcome: RearchiveOutcome): void {
    if (MEASURE) {
        noteRearchive(outcome, 0, -1)
    }
}

/**
 * Whether re-archiving may run now. The device pause is refused whether the
 * boot pass recorded it or its record cannot be read, as the pass itself does.
 */
export function rearchiveMayRun(): RearchiveBlock | null {
    if (!putBackEnabled()) {
        return 'put-back-off'
    }
    const blocked = archiveMayRun()
    if (blocked !== null) {
        return blocked
    }
    const device = readArchiveStrikes()
    return device === 'paused' || device === 'unreadable' ? 'device-paused' : null
}

/** The memo and orphan counts describe one database; a replaced database starts them empty. */
function syncDatabase(): void {
    if (memoDb !== DBState.db) {
        memoDb = DBState.db
        memo.clear()
        orphans.clear()
    }
}

function busyNow(): boolean {
    return isBusy() || anyChokePointInFlight()
}

type GateReason = 'skip' | 'kept' | 'purge' | 'memo' | 'put-back' | 'writing'

/**
 * Why `cha` is not offered to the engine now, or null. Synchronous and cheap:
 * no fingerprint. The same checks the engine and `finalCheck` repeat.
 */
function gateReason(cha: unknown, keep: ReadonlySet<string>, now: number, skipped: ReadonlySet<string>, holders: ReadonlyMap<string, number>): GateReason | null {
    if (typeof cha !== 'object' || cha === null || Array.isArray(cha)) {
        return 'skip'
    }
    const slot = cha as Slot
    if (slot.coldstorage || typeof slot.chaId !== 'string' || slot.chaId.startsWith('§') || !isUsableCharacterId(slot.chaId)) {
        return 'skip'
    }
    const chaId = slot.chaId
    if (holders.get(chaId) !== 1) {
        return 'skip'
    }
    if (keep.has(chaId)) {
        return 'kept'
    }
    if (!isArchivableCharacter(slot, now)) {
        return 'purge'
    }
    if (memo.has(chaId) || skipped.has(chaId)) {
        return 'memo'
    }
    const record = retainedRecordOf(slot)
    if (record && !isDirtyRecord(record)) {
        return 'put-back'
    }
    if (isWriting({ chaId })) {
        return 'writing'
    }
    return null
}

interface Scan {
    candidate: Slot | null
    /** A character that may become a candidate at a later commit: written by a unit of work, or awaiting the put-back's verdict. */
    deferred: boolean
}

function scan(): Scan {
    const characters = DBState.db?.characters
    if (!deps || !Array.isArray(characters)) {
        return { candidate: null, deferred: false }
    }
    const keep = deps.keepSet()
    const now = Date.now()
    const skipped = readArchiveMemo().skipped
    const holders = new Map<string, number>()
    for (const cha of characters) {
        const chaId = cha?.chaId
        if (typeof chaId === 'string') {
            holders.set(chaId, (holders.get(chaId) ?? 0) + 1)
        }
    }
    let deferred = false
    for (const cha of characters) {
        const reason = gateReason(cha, keep, now, skipped, holders)
        if (reason === null) {
            return { candidate: cha, deferred }
        }
        if (reason === 'writing' || reason === 'put-back') {
            deferred = true
            if (MEASURE && reason === 'writing') {
                count('deferred-writing')
            }
        } else if (MEASURE && reason === 'purge') {
            count('skipped-purge')
        } else if (MEASURE && reason === 'memo') {
            count('skipped-memo')
        }
    }
    return { candidate: null, deferred }
}

function arm(): void {
    if (!armed) {
        armed = true
        afterNextSaveCommit(() => { setTimeout(fire, 0) })
    }
}

/** Arms for the next commit when a candidate or a deferred character remains. */
function armIfWork(): void {
    syncDatabase()
    const found = scan()
    if (found.candidate !== null || found.deferred) {
        arm()
    }
}

/** Runs outside the save iteration, after every callback of the commit that scheduled it. */
function fire(): void {
    armed = false
    if (jobPending) {
        // The running job arms again when it ends and a candidate remains.
        return
    }
    if (stoppedForSession) {
        count('stopped')
        return
    }
    if (rearchiveMayRun() !== null) {
        // A gate that is off waits for the next selection change.
        return
    }
    if (busyNow()) {
        count('deferred-busy')
        arm()
        return
    }
    syncDatabase()
    const found = scan()
    if (found.candidate === null) {
        if (found.deferred) {
            arm()
        }
        return
    }
    jobPending = true
    runJob(found.candidate).catch((error) => console.error('Re-archiving a character failed', error))
}

/** Sampled anew in the engine's final synchronous step: a non-empty string refuses the archive. */
function finalReason(cha: Slot, chaId: string, dbAtStart: Database): string | null {
    if (DBState.db !== dbAtStart) {
        return 'database-replaced'
    }
    if (stoppedForSession) {
        return 'stopped'
    }
    if (rearchiveMayRun() !== null) {
        return 'gate'
    }
    if (deps?.keepSet().has(chaId)) {
        return 'kept'
    }
    if (isWriting({ chaId })) {
        return 'writing'
    }
    if (busyNow()) {
        return 'busy'
    }
    if (!isArchivableCharacter(cha, Date.now())) {
        return 'purge-due'
    }
    return null
}

async function runJob(cha: Slot): Promise<void> {
    const startedAt = MEASURE ? performance.now() : 0
    let outcome: RearchiveOutcome = 'gate'
    let fpLength = -1
    let rearm = false
    try {
        // Before the engine's await: a peer save that lands during the job
        // must show against this baseline.
        const peerSavesAtStart = getPeerSaveCount()
        // The engine is loaded here, before anything is read about the
        // character: from the pre-gate below to the engine's fingerprint and
        // the serialised unit nothing awaits, so the unit is the state that was
        // checked. Loaded statically the engine would join the start-up import
        // path through the put-back.
        const { archiveCharacterNow } = await import('../coldCharacterArchive')
        const dbAtStart = DBState.db
        const chaId = cha.chaId
        const previousUnitKey = retainedRecordOf(cha)?.unitKey
        if (rearchiveMayRun() !== null) {
            return
        }
        if (busyNow()) {
            outcome = 'deferred-busy'
            rearm = true
            return
        }
        syncDatabase()
        const index = findChaIdHolders(chaId)
        const sole = index.length === 1 && DBState.db.characters[index[0]] === cha
        const reason = gateReason(cha, deps?.keepSet() ?? new Set<string>(), Date.now(), readArchiveMemo().skipped, new Map([[chaId, sole ? 1 : 2]]))
        if (reason !== null) {
            outcome = reason === 'writing' ? 'deferred-writing' : reason === 'purge' ? 'skipped-purge' : reason === 'memo' ? 'skipped-memo' : 'gate'
            rearm = true
            return
        }
        // Measurement builds only: the fingerprint is what the tripwire compares
        // against, so it is taken before the engine can place the stub.
        let beforeLabel = ''
        if (MEASURE) {
            const fingerprintStartedAt = performance.now()
            beforeLabel = contentFingerprint(cha)
            noteFingerprint('rearchive', performance.now() - fingerprintStartedAt, beforeLabel)
            fpLength = parseInt(beforeLabel, 10)
        }

        const result = await archiveCharacterNow(
            { kind: 'loaded', character: cha, previousUnitKey },
            { finalCheck: () => finalReason(cha, chaId, dbAtStart) },
        )

        const sameDatabase = DBState.db === dbAtStart
        const remember = (): void => {
            if (sameDatabase) {
                memo.add(chaId)
            }
        }
        if (result.ok === true) {
            strikes = 0
            outcome = 'archived'
            rearm = true
            if (result.previousUnitKey !== null && sameDatabase) {
                try {
                    queueSupersededUnit({ chaId, newKey: result.unitKey, oldKey: result.previousUnitKey, peerSavesAt: peerSavesAtStart, db: dbAtStart }, getSaveMarkCount())
                } catch (error) {
                    console.error('Queueing a superseded unit failed', error)
                }
            }
            if (MEASURE && tripwireEnabled() && deps?.armTripwire) {
                noteReplaced(chaId, beforeLabel, undefined, cha)
                deps.armTripwire()
            }
            return
        }
        switch (result.reason) {
            case 'unavailable':
            case 'setting':
            case 'format-version':
                // A gate went off during the job: the next selection change tries again.
                outcome = 'gate'
                return
            case 'too-large':
                // Not a device fault: neither counted nor reset, and never retried.
                remember()
                outcome = 'too-large'
                rearm = true
                return
            case 'bad-target':
                remember()
                outcome = 'refused'
                rearm = true
                return
        }
        if (result.countsAsFailure) {
            strikes += 1
            remember()
            outcome = 'counted-failure'
            if (strikes >= MAX_STRIKES) {
                stoppedForSession = true
            } else {
                rearm = true
            }
            return
        }
        // changed, refused, slot-gone, id-taken: the list is untouched. A unit
        // already written stays behind as an orphan, so a character that keeps
        // ending this way is not offered again.
        if (result.writtenUnitKey !== null && sameDatabase) {
            const total = (orphans.get(chaId) ?? 0) + 1
            orphans.set(chaId, total)
            if (total >= MAX_ORPHANS_PER_CHARACTER) {
                memo.add(chaId)
            }
        }
        outcome = result.reason === 'changed' ? 'changed' : 'refused'
        rearm = true
    } finally {
        jobPending = false
        if (MEASURE) {
            noteRearchive(outcome, performance.now() - startedAt, fpLength)
        }
        if (rearm && !stoppedForSession) {
            armIfWork()
        }
    }
}

/**
 * Stores the put-back's keep-set function. Call it before the put-back
 * subscribes to the selection, which calls back at once.
 */
export function startCharacterRearchive(next: RearchiveDeps): void {
    deps = next
}

/**
 * The selection moved and the put-back has updated the previous and current
 * selection: arm for the next commit when a character may be archived.
 */
export function rearchiveOnSelection(): void {
    if (!deps || rearchiveMayRun() !== null || stoppedForSession) {
        return
    }
    armIfWork()
}

export function resetCharacterRearchiveForTest(): void {
    resetSupersededUnitsForTest()
    deps = null
    armed = false
    jobPending = false
    strikes = 0
    stoppedForSession = false
    memo.clear()
    orphans.clear()
    memoDb = null
}
