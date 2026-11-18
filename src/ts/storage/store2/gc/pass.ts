import type { AppStoreKind } from '../../store/appStore'
import type { GuardedCapabilities } from '../../store/contract'
import {
    REMOVE_BATCH_MAX, Store2BackendError, Store2CommitConflictError, Store2FenceConflictError, Store2UnitConflictError,
    Store2UnknownOutcomeError, revisionTokenOf, type CompareToken, type Store2Backend, type Store2Read,
} from '../backend'
import { evaluateDeleterGate, type GateRefusal } from '../boot'
import { classifyCommitRead } from '../commitKey'
import { readFenceVerdict } from '../fence'
import type { SweepRecord } from '../format'
import { decideAge, ageOf, type AgePhase, type RecordRead } from '../sweep/ageRecord'
import { SWEEP_FUTURE_SKEW_MS, SWEEP_MIN_AGE_MS } from '../sweep/params'
import { markLiveKeys } from './mark'
import { UNIT_RECORD_CAP, unitKeepOf, type GcAgeDeps, type UnitRecordRead } from './unitAge'

/**
 * One garbage-collection pass: deletes the store2 units that no manifest the
 * commit key names (and no fence) keeps alive. A pure library function; it has no
 * notice, trigger or setting.
 *
 * One read of the commit key (R) decides everything: the mark walks R's trees, the
 * gate is evaluated on R, and every batch carries R's token. A commit that lands
 * after R therefore conflicts the next batch instead of being judged by a mark
 * that never saw it. The fence is read after the mark and before the listing, so
 * a fence that appears later is caught by the batch's fence token and one already
 * standing protects its keys.
 *
 * With `age` (a Node server) the pass is aged: it retires a unit only on its third sighting, each at least the minimum
 * age after the previous record in the earlier of the server's and the page's clock, and it writes the record that
 * names the next sighting. The order of a round is: peers, one clock sample and the record (a young record ends the
 * round before any store2 read), the listing, the commit read R, the own-base check, the refusal of a standing
 * marker, the mark, the fence and the gate, a second clock sample and the decision, the retire batches, and the record
 * write. The listing precedes R, so a unit uploaded after R is never in the record; every retire and the record write
 * carry the commit key and the fence at the gate's revisions, so a commit that lands after R conflicts them. A round that
 * stops early, for any reason, writes no record.
 */

export type GcRefusal =
    | GateRefusal | 'capability-missing' | 'mark-refused' | 'list-failed'
    /** Aged mode: the server's clock could not be read, and the page's clock alone never decides. */
    | 'no-server-time'
    /** Aged mode: the age record was written by a newer build and is kept as it is. */
    | 'record-too-new'
    /** Aged mode: the age record could not be read, so no clock may be started or trusted. */
    | 'record-io-failed'
    /** Another tab may be alive (or this tab's own presence is not proven), so nothing is deleted. */
    | 'other-tab'
    /** The host cannot prove that this tab is alone. */
    | 'no-web-locks'
    /** The commit key's current is not the manifest this page last acknowledged, so its base may predate the mark. */
    | 'stale-base'

/** The answer of the sole-tab proof: this page alone, another tab or an unproven own presence, or no way to ask. */
export type GcPeerAnswer = 'alone' | 'others' | 'unsupported'

/** The sole-tab proof, asked fresh each time and never cached. */
export type GcPeers = () => Promise<GcPeerAnswer>

export type GcStopReason =
    | 'commit-conflict'
    | 'fence-conflict'
    | 'unit-conflict'
    | 'backend-failure'
    /** A batch's outcome is unknown: the pass ends and nothing further is attempted. */
    | 'unknown-outcome'
    /** The caller's `shouldStop` turned true; every batch applied so far is whole. */
    | 'yielded'
    /** The sole-tab proof failed after earlier deletions (a rebuild round or between batches); every applied batch is whole. */
    | 'other-tab'
    /** The rebuild round after earlier deletions was refused; the done result's refusal says why. */
    | 'refused'

/** What an aged round did with the age record. `record` is `none` when nothing was written, whatever the reason. */
export interface GcAgeReport {
    phase: AgePhase
    candidates: number
    recordedItems: number
    record: 'written' | 'conflict' | 'unknown' | 'none'
    conflictOn?: 'record' | 'commit' | 'fence'
    /** The later clock minus the earlier one of the deciding sample. */
    clockGapMs: number
}

export type GcResult =
    | { status: 'refused', reason: GcRefusal, detail: string }
    | {
        status: 'done'
        /** Keys in batches that were applied (an unknown batch is not counted). */
        deleted: number
        batches: number
        stopped?: GcStopReason
        /** After an unknown outcome: whether the commit key read back differs from R. */
        commitMoved?: boolean
        /** With stopped: 'refused': the refusal of the rebuild round. */
        refusal?: { reason: GcRefusal, detail: string }
        /** Aged rounds only. */
        age?: GcAgeReport
    }

export interface GcDeps {
    backend: Store2Backend
    kind: AppStoreKind
    /** Read live before each pass attempt: why every deleter is idle, or `null`. */
    idleReason: () => string | null
    /** The guarded store's capability probe; required on Node. */
    probe?: () => Promise<GuardedCapabilities>
    /** Awaited between batches; none by default. */
    pace?: () => Promise<void>
    /**
     * Asked at the start of each round and before every batch, the first included; `true` ends the pass with
     * `stopped: 'yielded'` and the counts so far. Nothing is retried: every applied batch is whole.
     */
    shouldStop?: () => boolean
    /**
     * The web sole-tab proof; absent where the host needs none (the app runs one page). Asked at the start of each round
     * before any store2 read, and before every batch, after the pace and immediately before `shouldStop`: `removeBatch`
     * runs only on an `'alone'` answer given after the previous batch (or the mark). `'unsupported'` refuses in the first
     * round, `'others'` refuses there too, and either one ends a later round or a batch loop as `stopped: 'other-tab'`.
     */
    peers?: GcPeers
    /**
     * The manifest key this page last acknowledged, or `null` when none is settled; present only where `peers` is. In
     * every round the commit key's current must equal it, so a page whose base predates a peer's commit (or whose encoder
     * took a peer's tree) deletes nothing: the mark would not contain what the page can still read.
     */
    ownBase?: () => string | null
    /**
     * Present only on Node: the pass is aged (see the header). An aged pass proceeds on `'unsupported'`, because the
     * minimum age bounds a reader that no tab proof covers, and still refuses or stops on `'others'`.
     */
    age?: GcAgeDeps
}

type Attempt =
    | { status: 'refused', reason: GcRefusal, detail: string }
    | { status: 'rebuild', deleted: number, batches: number }
    | { status: 'done', deleted: number, batches: number, stopped?: GcStopReason, commitMoved?: boolean, age?: GcAgeReport }

async function probeNode(deps: GcDeps): Promise<{ reason: string } | null> {
    if (deps.probe === undefined) {
        return { reason: 'The Node server\'s capabilities cannot be probed.' }
    }
    try {
        const caps = await deps.probe()
        if (!caps.checkOnly || !caps.retire) {
            return { reason: 'The Node server lacks check-only or retire.' }
        }
    } catch (error) {
        return { reason: error instanceof Error ? error.message : 'The capability probe failed.' }
    }
    return null
}

/** What a failed sole-tab proof ends the round with: a refusal in the first round, a stop once something was deleted. */
function peerEnd(answer: GcPeerAnswer, round: number, aged: boolean): Attempt | null {
    if (answer === 'alone' || (aged && answer === 'unsupported')) {
        return null
    }
    if (round > 0) {
        return { status: 'done', deleted: 0, batches: 0, stopped: 'other-tab' }
    }
    return answer === 'unsupported'
        ? { status: 'refused', reason: 'no-web-locks', detail: 'This host cannot prove that no other tab is open.' }
        : { status: 'refused', reason: 'other-tab', detail: 'Another tab may be open, or this tab\'s own presence is not held.' }
}

/** The clock sample of an aged round, or `null` when the server's time could not be had. */
async function sampleOf(age: GcAgeDeps): Promise<{ early: number, late: number } | null> {
    try {
        return await age.sampleClock()
    } catch {
        return null
    }
}

const NO_SERVER_TIME: Attempt = { status: 'refused', reason: 'no-server-time', detail: 'The Node server\'s clock could not be read.' }

function recordReadOf(read: Extract<UnitRecordRead, { status: 'ok' | 'absent' | 'unreadable' }>): RecordRead {
    return read.status === 'ok' ? { status: 'ok', value: read.value } : { status: read.status }
}

async function attemptPass(deps: GcDeps, round: number): Promise<Attempt> {
    const { backend, age } = deps
    const aged = age !== undefined
    if (deps.peers !== undefined) {
        const ended = peerEnd(await deps.peers(), round, aged)
        if (ended !== null) {
            return ended
        }
    }

    let stored: Extract<UnitRecordRead, { status: 'ok' | 'absent' | 'unreadable' }> | null = null
    let listedEarly: string[] | null = null
    if (age !== undefined) {
        // A young record ends the round before any store2 read: nothing is listed, marked, deleted or written.
        const first = await sampleOf(age)
        if (first === null) {
            return NO_SERVER_TIME
        }
        const read = await age.readRecord()
        if (read.status === 'too-new') {
            return { status: 'refused', reason: 'record-too-new', detail: 'The age record was written by a newer build.' }
        }
        if (read.status === 'io-failed') {
            return { status: 'refused', reason: 'record-io-failed', detail: 'The age record could not be read.' }
        }
        stored = read
        const verdict = ageOf(read.status === 'ok' ? read.value : null, first, age.minAgeMs ?? SWEEP_MIN_AGE_MS, age.futureSkewMs ?? SWEEP_FUTURE_SKEW_MS)
        if (verdict === 'young') {
            return {
                status: 'done', deleted: 0, batches: 0,
                age: { phase: 'young', candidates: 0, recordedItems: 0, record: 'none', clockGapMs: first.late - first.early },
            }
        }
        // The listing comes before the commit read: a unit uploaded after R is then never in the record.
        try {
            listedEarly = await backend.listStore2()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'refused', reason: 'list-failed', detail: error.message }
            }
            throw error
        }
    }

    let commitRead: Store2Read
    try {
        commitRead = await backend.readCommit()
    } catch (error) {
        if (error instanceof Store2BackendError) {
            return { status: 'refused', reason: 'commit-unreadable', detail: error.message }
        }
        throw error
    }

    if (deps.ownBase !== undefined) {
        const classified = classifyCommitRead(commitRead)
        // An unparsed key or a key with no current falls through to the gate, which refuses it.
        if (classified.status === 'parsed' && classified.value.current !== null && classified.value.current.key !== deps.ownBase()) {
            return { status: 'refused', reason: 'stale-base', detail: 'The commit key names a manifest this page has not acknowledged.' }
        }
    }
    if (aged) {
        // No retire and no record write applies against a standing marker of any owner: a bulk writer under it stores
        // units that no manifest names yet.
        const classified = classifyCommitRead(commitRead)
        if (classified.status === 'parsed' && classified.value.staging !== null) {
            return { status: 'refused', reason: 'staging', detail: `A ${classified.value.staging.label} marker stands.` }
        }
    }

    const mark = await markLiveKeys(backend, commitRead)
    if (mark.status === 'refused') {
        // A refused mark can carry an all-ok or empty closure, so the gate never sees it.
        return { status: 'refused', reason: 'mark-refused', detail: `${mark.reason}: ${mark.detail}` }
    }

    const fence = await readFenceVerdict(backend)
    const gate = evaluateDeleterGate({ deleter: 'gc', commit: commitRead, fence, idleReason: deps.idleReason(), closure: mark.closure })
    if (gate.status === 'refused') {
        return gate
    }

    let listed: string[]
    if (listedEarly !== null) {
        listed = listedEarly
    } else {
        try {
            listed = await backend.listStore2()
        } catch (error) {
            if (error instanceof Store2BackendError) {
                return { status: 'refused', reason: 'list-failed', detail: error.message }
            }
            throw error
        }
    }
    const standing = gate.commit.staging === null ? null : gate.commit.staging.prefix
    const candidates = listed.filter(key =>
        !mark.live.has(key) && !gate.liveKeys.has(key) && (standing === null || !key.startsWith(standing)))

    let targets = candidates
    let report: GcAgeReport | undefined
    let next: SweepRecord | null = null
    if (age !== undefined && stored !== null) {
        // The deciding sample is taken after R and the mark, so the earlier clock never predates what the mark saw.
        const second = await sampleOf(age)
        if (second === null) {
            return NO_SERVER_TIME
        }
        const decision = decideAge({
            subject: 'unit',
            backend: 'node',
            record: recordReadOf(stored),
            candidates: candidates.map(name => ({ name, rev: null })),
            now: second.early,
            late: second.late,
            keep: unitKeepOf(mark, gate),
            nodeRecordCap: age.recordCap ?? UNIT_RECORD_CAP,
            minAgeMs: age.minAgeMs,
            futureSkewMs: age.futureSkewMs,
        })
        report = {
            phase: decision.phase, candidates: candidates.length, recordedItems: decision.nextRecord?.items.length ?? 0,
            record: 'none', clockGapMs: second.late - second.early,
        }
        if (decision.phase === 'young') {
            // Only a clock that went back between the two samples gets here: nothing is deleted or written.
            return { status: 'done', deleted: 0, batches: 0, age: report }
        }
        targets = decision.delete.map(deletion => deletion.name)
        next = decision.nextRecord
    }

    let deleted = 0
    let batches = 0
    for (let at = 0; at < targets.length; at += REMOVE_BATCH_MAX) {
        if (batches > 0 && deps.pace !== undefined) {
            await deps.pace()
        }
        if (deps.peers !== undefined && peerEnd(await deps.peers(), 1, aged) !== null) {
            return { status: 'done', deleted, batches, stopped: 'other-tab', age: report }
        }
        // No await sits between this check and `removeBatch`, so the proof and the stop rule both hold at the delete.
        if (deps.shouldStop?.() === true) {
            return { status: 'done', deleted, batches, stopped: 'yielded', age: report }
        }
        const batch = targets.slice(at, at + REMOVE_BATCH_MAX)
        try {
            await backend.removeBatch(batch, gate.commitToken, gate.fenceToken)
        } catch (error) {
            if (error instanceof Store2CommitConflictError) {
                return { status: 'rebuild', deleted, batches }
            }
            if (error instanceof Store2FenceConflictError) {
                return { status: 'done', deleted, batches, stopped: 'fence-conflict', age: report }
            }
            if (error instanceof Store2UnitConflictError) {
                return { status: 'done', deleted, batches, stopped: 'unit-conflict', age: report }
            }
            if (error instanceof Store2UnknownOutcomeError) {
                // Read the commit key back before reporting; the pass never retries the batch.
                let commitMoved: boolean | undefined
                try {
                    const again = await backend.readCommit()
                    commitMoved = !sameToken(again.token, commitRead.token)
                } catch (readError) {
                    if (!(readError instanceof Store2BackendError)) {
                        throw readError
                    }
                }
                return { status: 'done', deleted, batches, stopped: 'unknown-outcome', commitMoved, age: report }
            }
            if (error instanceof Store2BackendError) {
                return { status: 'done', deleted, batches, stopped: 'backend-failure', age: report }
            }
            throw error
        }
        deleted += batch.length
        batches++
    }
    if (age === undefined || stored === null || report === undefined || next === null) {
        return { status: 'done', deleted, batches }
    }

    // The record names only keys that no commit-key state from R to this write named: the write carries the commit key
    // and the fence at the gate's revisions. A stop writes nothing, and nothing is awaited between the stop check and the send.
    if (deps.peers !== undefined && peerEnd(await deps.peers(), 1, aged) !== null) {
        return { status: 'done', deleted, batches, stopped: 'other-tab', age: report }
    }
    if (deps.shouldStop?.() === true) {
        return { status: 'done', deleted, batches, stopped: 'yielded', age: report }
    }
    const written = await age.writeRecord(
        next, stored.version, revisionTokenOf(gate.commitToken).revision, revisionTokenOf(gate.fenceToken).revision,
    )
    if (written === 'written') {
        report = { ...report, record: 'written' }
    } else if (written === 'unknown') {
        report = { ...report, record: 'unknown' }
    } else {
        report = { ...report, record: 'conflict', conflictOn: written.conflict }
    }
    return { status: 'done', deleted, batches, age: report }
}

function sameToken(a: CompareToken, b: CompareToken): boolean {
    if (a.kind === 'revision') {
        return b.kind === 'revision' && a.revision === b.revision
    }
    if (b.kind !== 'bytes') {
        return false
    }
    const x = a.bytes
    const y = b.bytes
    if (x === null || y === null) {
        return x === y
    }
    return x.length === y.length && x.every((byte, index) => byte === y[index])
}

export async function gcPass(deps: GcDeps): Promise<GcResult> {
    if (deps.kind === 'node') {
        const missing = await probeNode(deps)
        if (missing !== null) {
            return { status: 'refused', reason: 'capability-missing', detail: missing.reason }
        }
    }
    let deleted = 0
    let batches = 0
    for (let round = 0; round < 2; round++) {
        if (deps.shouldStop?.() === true) {
            return { status: 'done', deleted, batches, stopped: 'yielded' }
        }
        const result = await attemptPass(deps, round)
        if (result.status === 'refused') {
            return deleted === 0 && batches === 0
                ? result
                : { status: 'done', deleted, batches, stopped: 'refused', refusal: { reason: result.reason, detail: result.detail } }
        }
        if (result.status === 'done') {
            return { ...result, deleted: deleted + result.deleted, batches: batches + result.batches }
        }
        // A commit landed under the pass: rebuild once from a fresh read.
        deleted += result.deleted
        batches += result.batches
    }
    return { status: 'done', deleted, batches, stopped: 'commit-conflict' }
}
