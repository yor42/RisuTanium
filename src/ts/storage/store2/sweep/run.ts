import type { ByteStore, CheckOnlyEntry, GuardedOperations } from '../../store/contract'
import { StoreVersionConflictError } from '../../store/errors'
import { AssetDeleteHoldOverlapError } from '../../assetDeleteHold'
import {
    REMOVE_BATCH_MAX, revisionTokenOf, type Store2Backend,
} from '../backend/types'
import type { GateOpen, GateRefusal } from '../boot'
import { COMMIT_KEY, FENCE_KEY, SWEEP_KEY } from '../format'
import { readUnitAgeRecord, writeUnitAgeRecord, type UnitRecordRead } from '../gc/unitAge'
import type { Store2Session } from '../session'
import { ageOf, decideAge, type AgeCandidate, type AgeClock, type AgeDecision, type AgePhase, type RecordRead } from './ageRecord'
import { AssetKeySet } from './assetKey'
import { createBackendClosureReader } from './backendReader'
import { checkFences } from './fences'
import { gateFreshness } from './fresh'
import { buildClosureAssetKeepSet, legacyFilesOf } from './keepSet'
import { decideAutoSweep, type AssetCount } from './limit'
import { SWEEP_FUTURE_SKEW_MS, SWEEP_MIN_AGE_MS } from './params'
import { readSweepRecord, writeSweepRecord } from './record'

/**
 * The deleting pass of the asset sweep on a store2 page (`tauri`, `indexeddb` and `node` kinds; every other kind reads and
 * writes nothing). It deletes an `assets/` file only when all of these hold:
 *
 * - the closure keep-set over `{current} + retained + pins` is complete (an incomplete one deletes nothing and writes
 *   nothing), so an asset a restore point still names is never touched;
 * - an age record at least `minAgeMs` old named the asset and this pass's fresh scan names it again; on Node the asset
 *   must have been named by two such records (a third sighting), each time at the revision it still has;
 * - the deleter gate is open, the fences are clear and, per batch, the commit key and the fence are still what the gate
 *   read: a Tauri page proves it with a same-bytes `casCommit` on the gate's commit token (a page that a newer page
 *   superseded is refused by the native gate, so it deletes nothing and writes no record), a web page by a read, and a
 *   Node page by a read of the revisions the gate saw, its deletes and its record write carrying the same two
 *   revisions as check-only entries;
 * - at that very delete: no stop condition holds, this page did not write the asset, the resident database does not
 *   refer to it and, on the web and on Node, no other tab is open.
 *
 * The stop check, the written check, the resident check and the registration of the deletion hold are one synchronous
 * run, so a same-page writer of the key either was seen by the check or waits for the hold. The stored assets are
 * listed before the keep-set is built, so an asset written after the listing is never a candidate.
 *
 * The Node server differs in its order and in its proofs. The age is read first (a young record ends the pass before any
 * gate, listing or closure read), then the gate is opened, then the assets are listed with their revisions: a commit
 * that lands after the gate conflicts with every delete and with the record write, and an asset written or touched after
 * the listing has a revision the delete does not carry. A Node page refuses `'unsupported'` (plain HTTP, no Web Locks,
 * so no sole-tab proof) and the automatic sweep never proceeds on it, whereas the aged unit pass does proceed there under its
 * minimum age: the two passes differ here on purpose (PQ-1).
 *
 * The one data write is the age record. A stopped pass writes none. The pass is silent: it reports counts and reasons,
 * never an asset name.
 *
 * The manual entry (`env.manual`) is the same round with two differences. First, `decideAutoSweep` is not consulted, so an
 * over-limit or unknown count is allowed; every other refusal, stop and per-delete check stays. Second, a `plan` step
 * stops right after the age decision and returns what a following `delete` step would remove, with no batch, no hold, no
 * delete and no record write; a `delete` step removes only the names of its `approved` set that this round's own decision
 * also deletes, worked out again in every round, so the delete set never grows beyond what the person confirmed. The age
 * differs by kind. A Tauri or IndexedDB manual round deletes every fresh candidate at once and writes no record (it still
 * reads the record, so a newer build's record refuses), which leaves the per-batch `casCommit` probe as its only
 * ghost-write protection; the window between the probe and the removal is accepted because batches are small. A Node
 * manual round keeps the third-sighting rule, the revision binding and the record cap unchanged. A Node page accepts
 * `'unsupported'` (plain HTTP, no Web Locks) only for a manual round: the plan step only reads, and the delete step is
 * started only after the person's confirmation, which is the attestation that no other tab or device is open.
 */

/** What a web page learns about other tabs of the app (the answer of the sole-tab proof, `soleTabAnswer`). */
export type SweepPeers = 'alone' | 'others' | 'unsupported'

/** The manual entry: `plan` reads only; `delete` removes the approved names that the round's own decision also deletes. */
export type ManualSweep =
    | { step: 'plan' }
    | { step: 'delete', approved: ReadonlySet<string> }

/**
 * Whether the page's tab answer lets the pass go on. `unsupported` passes only on a Node page in a manual round; every
 * other page and the automatic pass refuse it, and `others` always refuses.
 */
export function peersAllow(kind: AssetSweepSession['kind'], answer: SweepPeers, manual: ManualSweep | undefined): 'go' | 'no-web-locks' | 'other-tab' {
    if (answer === 'alone') {
        return 'go'
    }
    if (answer === 'others') {
        return 'other-tab'
    }
    return kind === 'node' && manual !== undefined ? 'go' : 'no-web-locks'
}

/** The pieces of the session the pass reads live: a copy would freeze `idleReason`. */
export type AssetSweepSession = Pick<Store2Session, 'kind' | 'backend' | 'openGate' | 'idleReason'>

export interface AssetSweepEnv {
    session: AssetSweepSession
    /** The page's byte store: `assets/` and the age record. */
    store: ByteStore
    now?: () => number
    /** The asset names the live database refers to now; read again for every batch. */
    residentRefs(): Iterable<string>
    /** How many `assets/<name>` keys this page wrote or tried to write; the set only grows, so a changed count means new entries. */
    writtenCount(): number
    /** The keys counted by `writtenCount`, in insertion order. */
    writtenThisPage(): Iterable<string>
    /** Whether this page is the sole tab; it needs this page's own presence claim, and a failed query answers `others`. Asked before every delete on the web. */
    peers(): Promise<SweepPeers>
    /** A data action, a parked save loop, unsaved changes or a restore: the pass ends before its next delete. */
    shouldStop(): boolean
    /** Awaited between batches. */
    pace?(): Promise<void>
    /** Releases the object URLs and caches of removed `assets/<name>` keys. */
    release(keys: readonly string[]): void
    /** Runs a delete with the page's deletion hold registered. */
    hold(remove: () => Promise<void>): Promise<void>
    /** The automatic-sweep limit; defaults to the sweep limit. */
    limit?: number
    /** The minimum record age; defaults to 24 hours. */
    minAgeMs?: number
    /**
     * One sample of the Node server's clock and the page's, read together (`buildNodeGcAge(store)?.sampleClock`). Node
     * only: a Node pass without it, or whose sample rejects, ends `no-server-time` before it deletes or writes anything.
     */
    sampleClock?(): Promise<AgeClock>
    /** Present only for the manual clean-up; absent means the automatic pass. */
    manual?: ManualSweep
}

export type SweepStopReason =
    | 'yielded' | 'idle' | 'other-tab' | 'fence-conflict' | 'commit-conflict' | 'stale-page' | 'probe-failed'
    | 'record-conflict' | 'record-unknown'

export type SweepRefusalReason =
    | GateRefusal
    | 'no-backend' | 'no-web-locks' | 'other-tab' | 'listing-failed' | 'over-limit' | 'unknown-count'
    | 'keep-incomplete' | 'fences' | 'record-too-new' | 'record-io-failed' | 'no-server-time'

export type AssetSweepResult =
    | { status: 'skipped' }
    | {
        /** The manual `plan` step: what a `delete` step would remove now (`deletable`) and what only a later pass can (`later`). */
        status: 'planned'
        phase: AgePhase | null
        candidates: number
        deletable: readonly string[]
        later: number
    }
    | {
        status: 'refused'
        reason: SweepRefusalReason
        /** Deletes of an earlier round of this pass, present only when a refusal followed a rebuild that had deleted or failed. */
        deleted?: number
        failed?: number
    }
    | {
        status: 'done'
        /** The age phase decided; null when the pass ended before deciding. */
        phase: AgePhase | null
        /** Assets nothing in the keep-set protects. */
        candidates: number
        deleted: number
        /** Deletes the store failed. */
        failed: number
        /** Planned deletions skipped because this page wrote the asset or the resident database refers to it. */
        keptLive: number
        batches: number
        /** Whether this pass wrote the age record. */
        recorded: boolean
        stopped?: SweepStopReason
    }

const ASSETS_PREFIX = 'assets/'
const MAX_ROUNDS = 2

interface Tally {
    phase: AgePhase | null
    candidates: number
    deleted: number
    failed: number
    keptLive: number
    batches: number
    recorded: boolean
}

/** What the `plan` step hands back besides the tally: the names its decision deletes. */
interface PlanOut {
    deletable: string[]
}

/** Control flow of the pass: the result that ends it. */
class Ended extends Error {
    constructor(readonly result: AssetSweepResult) {
        super('The asset sweep ended.')
        this.name = 'Ended'
    }
}

function refused(reason: SweepRefusalReason): Ended {
    return new Ended({ status: 'refused', reason })
}

function stopped(tally: Tally, reason: SweepStopReason): Ended {
    return new Ended({ status: 'done', ...tally, stopped: reason })
}

/**
 * Whether the commit key and the fence are still what the gate read, in the check that precedes a batch or the record
 * write. A moved commit key is `moved` (rebuild the keep-set); a moved fence, a stale page, a failed probe or an idle
 * session ends the pass. The checks are `gateFreshness`.
 */
async function checkFresh(env: AssetSweepEnv, gate: GateOpen, backend: Store2Backend, tally: Tally): Promise<'fresh' | 'moved'> {
    const freshness = await gateFreshness(env.session, gate, backend)
    if (freshness === 'fresh' || freshness === 'moved') {
        return freshness
    }
    throw stopped(tally, freshness)
}

/** The names under `assets/` (top level only), their count and, on Node, the revision each is listed at (null: none is known). */
interface AssetListing {
    names: string[]
    count: AssetCount
    revisions: ReadonlyMap<string, number | null> | null
}

/** The names under `assets/` (top level only) and their count. */
async function listAssets(store: ByteStore): Promise<AssetListing> {
    const keys = await store.list(ASSETS_PREFIX)
    const names = keys.map(key => key.slice(ASSETS_PREFIX.length)).filter(name => !name.includes('/'))
    const count: AssetCount = store.countPrefix === undefined ? keys.length : (await store.countPrefix(ASSETS_PREFIX)) ?? 'unknown'
    return { names, count, revisions: null }
}

/**
 * The names under `assets/` (top level only) with the revision the server lists each at, from one listing that reads no
 * value. A store that cannot list revisions or cannot delete under a condition cannot sweep: it rejects.
 */
async function listAssetRevisions(store: ByteStore): Promise<AssetListing> {
    if (store.listRevisions === undefined || store.guarded === undefined) {
        throw new Error('The store cannot list revisions or delete under a condition.')
    }
    const rows = await store.listRevisions(ASSETS_PREFIX)
    if (rows === null) {
        throw new Error('The server does not list revisions.')
    }
    const names: string[] = []
    const revisions = new Map<string, number | null>()
    for (const row of rows) {
        const name = row.key.slice(ASSETS_PREFIX.length)
        if (!name.includes('/')) {
            names.push(name)
            revisions.set(name, row.rev)
        }
    }
    return { names, count: rows.length, revisions }
}

type NodeRecordRead = Extract<UnitRecordRead, { status: 'ok' | 'absent' | 'unreadable' }>

/** One sample of the Node server's clock and the page's; a missing or rejected sample ends the pass `no-server-time`. */
async function sampleOf(env: AssetSweepEnv): Promise<AgeClock> {
    if (env.sampleClock === undefined) {
        throw refused('no-server-time')
    }
    try {
        return await env.sampleClock()
    } catch {
        throw refused('no-server-time')
    }
}

/**
 * Clock sample A and the versioned read of the record (`store2-sweep`), before the gate: the record a Node write is bound
 * to. `young` is a record younger than the minimum age; the round then ends before any gate, listing or closure read.
 */
async function readNodeRecord(env: AssetSweepEnv): Promise<NodeRecordRead | 'young'> {
    const first = await sampleOf(env)
    const read = await readUnitAgeRecord(env.store, SWEEP_KEY)
    if (read.status === 'too-new') {
        throw refused('record-too-new')
    }
    if (read.status === 'io-failed') {
        throw refused('record-io-failed')
    }
    const verdict = ageOf(read.status === 'ok' ? read.value : null, first, env.minAgeMs ?? SWEEP_MIN_AGE_MS, SWEEP_FUTURE_SKEW_MS)
    return verdict === 'young' ? 'young' : read
}

/** The revisions a Node delete and the record write carry as check-only entries: the commit key's and the fence's, as the gate read them. */
function checkOnlyOf(gate: GateOpen): CheckOnlyEntry[] {
    return [
        { key: COMMIT_KEY, version: revisionTokenOf(gate.commitToken).revision },
        { key: FENCE_KEY, version: revisionTokenOf(gate.fenceToken).revision },
    ]
}

function nodeGuarded(store: ByteStore): GuardedOperations {
    if (store.guarded === undefined) {
        throw new Error('The store has no guarded routes.')
    }
    return store.guarded
}

/**
 * Removes one asset at the revision the record named, with the commit key and the fence compared in the same step. A Node
 * page never sends a removal without a revision: it is refused here.
 */
async function removeAtRevision(store: ByteStore, key: string, ifVersion: number | null, checkOnly: readonly CheckOnlyEntry[]): Promise<void> {
    if (ifVersion === null) {
        throw new RangeError('A Node deletion needs the recorded revision.')
    }
    await nodeGuarded(store).removeChecked([{ key, condition: { ifVersion } }], checkOnly)
}

/** One scan and delete round: a commit key that moved ends it with `rebuild`. */
async function runRound(env: AssetSweepEnv, backend: Store2Backend, tally: Tally, plan: PlanOut): Promise<'finished' | 'rebuild'> {
    const { session, store, manual } = env
    const web = session.kind === 'indexeddb'
    const node = session.kind === 'node'
    if (env.shouldStop()) {
        throw stopped(tally, 'yielded')
    }
    if (web || node) {
        const verdict = peersAllow(session.kind, await env.peers(), manual)
        if (verdict !== 'go') {
            throw refused(verdict)
        }
    }
    // The age is judged before anything else is read: a young record ends the round with no gate, listing or closure read.
    const nodeRecord = node ? await readNodeRecord(env) : null
    if (nodeRecord === 'young') {
        tally.phase = 'young'
        return 'finished'
    }
    const gate = await session.openGate('sweep')
    if (gate.status === 'refused') {
        throw refused(gate.reason)
    }
    const checkOnly = node ? checkOnlyOf(gate) : []

    // Listed before the keep-set is built: an asset written after this point is never a candidate.
    let listed: AssetListing
    try {
        listed = node ? await listAssetRevisions(store) : await listAssets(store)
    } catch {
        throw refused('listing-failed')
    }
    if (manual === undefined) {
        const limit = decideAutoSweep(listed.count, env.limit)
        if (!limit.auto) {
            throw refused(limit.reason === 'over-limit' ? 'over-limit' : 'unknown-count')
        }
    }

    const reader = createBackendClosureReader(backend)
    const keepResult = await buildClosureAssetKeepSet({
        commitKey: gate.commit,
        reader,
        residentRefs: env.residentRefs(),
        writtenThisPage: env.writtenThisPage(),
    })
    if (keepResult.status === 'incomplete') {
        throw refused('keep-incomplete')
    }
    const { keep } = keepResult
    const fences = checkFences({
        commitKey: { status: 'ok', value: gate.commit },
        fence: gate.fence === 'absent' ? 'absent' : 'present',
        legacyFiles: legacyFilesOf([...reader.manifests().values()]),
        tauriFlushPending: session.idleReason !== null,
        // The caller vouches that no bulk operation's asset writes can be lost to the pass. A web pass runs only while
        // it is the sole tab and a Tauri pass is the sole page, so no other writer's bulk operation runs; this page's own
        // restore is covered by the busy check, the written set and the hold. On the Node server, every bulk operation
        // that decides by the store's contents holds its marker before it lists (the gate refuses `staging`), and every
        // other asset write moves the key's revision, which a deletion must have seen in two bound sightings.
        bulkMarkersSet: true,
    })
    if (fences.status === 'refused') {
        throw refused('fences')
    }

    const candidates: AgeCandidate[] = listed.names
        .filter(name => !keep.holds(name))
        .map(name => ({ name, rev: listed.revisions?.get(name) ?? null }))
    tally.candidates = candidates.length
    let decision: AgeDecision
    if (nodeRecord !== null) {
        // The deciding sample is taken after the listing and the keep-set; a rejected one ends the pass here, before any delete.
        const second = await sampleOf(env)
        const record: RecordRead = nodeRecord.status === 'ok' ? { status: 'ok', value: nodeRecord.value } : { status: nodeRecord.status }
        decision = decideAge({
            subject: 'asset', backend: 'node', record, candidates, now: second.early, late: second.late, keep, minAgeMs: env.minAgeMs,
        })
    } else {
        const recordRead = await readSweepRecord(store)
        if (recordRead.status === 'too-new') {
            throw refused('record-too-new')
        }
        if (recordRead.status === 'io-failed') {
            throw refused('record-io-failed')
        }
        if (manual !== undefined) {
            // The person's confirmation replaces the age wait: every fresh candidate is deletable and no record is written.
            decision = {
                phase: 'swept',
                delete: [...new Set(candidates.map(candidate => candidate.name))].map(name => ({ name, ifVersion: null })),
                nextRecord: null,
            }
        } else {
            const record: RecordRead = recordRead
            decision = decideAge({
                record,
                candidates,
                now: (env.now ?? Date.now)(),
                backend: session.kind === 'tauri' ? 'tauri' : 'indexeddb',
                keep,
                minAgeMs: env.minAgeMs,
            })
        }
    }
    tally.phase = decision.phase
    if (decision.phase === 'young') {
        return 'finished'
    }
    if (manual?.step === 'plan') {
        plan.deletable = decision.delete.map(deletion => deletion.name)
        return 'finished'
    }

    const deletes = manual?.step === 'delete' ? decision.delete.filter(deletion => manual.approved.has(deletion.name)) : decision.delete
    const written = new AssetKeySet()
    let writtenSeen = 0
    for (let start = 0; start < deletes.length; start += REMOVE_BATCH_MAX) {
        if (start > 0 && env.pace !== undefined) {
            await env.pace()
        }
        if (env.shouldStop()) {
            throw stopped(tally, 'yielded')
        }
        if (session.idleReason !== null) {
            throw stopped(tally, 'idle')
        }
        if (await checkFresh(env, gate, backend, tally) === 'moved') {
            return 'rebuild'
        }
        tally.batches++
        const resident = new AssetKeySet()
        for (const name of env.residentRefs()) {
            resident.addName(name)
        }
        const removed: string[] = []
        let moved = false
        try {
            for (const { name, ifVersion } of deletes.slice(start, start + REMOVE_BATCH_MAX)) {
                if ((web || node) && peersAllow(session.kind, await env.peers(), manual) !== 'go') {
                    throw stopped(tally, 'other-tab')
                }
                // One synchronous run from the stop check to the registration of the hold; no await may enter it.
                if (env.shouldStop()) {
                    throw stopped(tally, 'yielded')
                }
                if (env.writtenCount() !== writtenSeen) {
                    let index = 0
                    for (const key of env.writtenThisPage()) {
                        if (index++ >= writtenSeen) {
                            written.addName(key)
                        }
                    }
                    writtenSeen = index
                }
                if (written.holds(name) || resident.holds(name)) {
                    tally.keptLive++
                    continue
                }
                const key = ASSETS_PREFIX + name
                try {
                    await env.hold(() => node ? removeAtRevision(store, key, ifVersion, checkOnly) : store.delete(key, 'unconditional'))
                    removed.push(key)
                    tally.deleted++
                } catch (error) {
                    if (error instanceof AssetDeleteHoldOverlapError) {
                        throw error
                    }
                    if (node && error instanceof StoreVersionConflictError) {
                        // The server names the first failing key: the asset (its revision moved), the commit key (a
                        // commit landed) or the fence. Nothing was removed in any case.
                        if (error.key === key) {
                            tally.keptLive++
                            continue
                        }
                        if (error.key === COMMIT_KEY) {
                            moved = true
                            break
                        }
                        if (error.key === FENCE_KEY) {
                            throw stopped(tally, 'fence-conflict')
                        }
                    }
                    tally.failed++
                }
            }
        } finally {
            if (removed.length > 0) {
                env.release(removed)
            }
        }
        if (moved) {
            return 'rebuild'
        }
    }

    if (decision.nextRecord === null) {
        return 'finished'
    }
    // The stop check directly before the record write: a stop that turns true after the last delete writes no record.
    if (env.shouldStop()) {
        throw stopped(tally, 'yielded')
    }
    if (await checkFresh(env, gate, backend, tally) === 'moved') {
        return 'rebuild'
    }
    if (nodeRecord !== null) {
        // The record is bound to the version it was read at and to the commit key and fence the gate saw, and is never
        // retried: a conflict or an unknown outcome leaves the record as it was. Nothing is awaited between the last stop
        // check and the send.
        if (peersAllow(session.kind, await env.peers(), manual) !== 'go') {
            throw stopped(tally, 'other-tab')
        }
        if (env.shouldStop()) {
            throw stopped(tally, 'yielded')
        }
        const outcome = await writeUnitAgeRecord(
            nodeGuarded(store), decision.nextRecord, nodeRecord.version, checkOnly[0].version, checkOnly[1].version, SWEEP_KEY,
        )
        if (outcome !== 'written') {
            throw stopped(tally, outcome === 'unknown' ? 'record-unknown' : 'record-conflict')
        }
    } else {
        await writeSweepRecord(store, decision.nextRecord)
    }
    tally.recorded = true
    return 'finished'
}

/** Runs the pass; rejects only with what the store or the backend threw unexpectedly, or with a hold overlap. */
export async function runAssetSweep(env: AssetSweepEnv): Promise<AssetSweepResult> {
    const { session } = env
    if ((session.kind !== 'tauri' && session.kind !== 'indexeddb' && session.kind !== 'node') || session.backend === null) {
        return { status: 'skipped' }
    }
    const tally: Tally = { phase: null, candidates: 0, deleted: 0, failed: 0, keptLive: 0, batches: 0, recorded: false }
    const plan: PlanOut = { deletable: [] }
    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            // Read live: the session's backend is the flush tracker, never a copy.
            const backend = session.backend
            if (backend === null) {
                throw refused('no-backend')
            }
            if (await runRound(env, backend, tally, plan) === 'finished') {
                if (env.manual?.step === 'plan') {
                    // Only Node has later passes: the other kinds delete every candidate at once.
                    const later = session.kind === 'node' && tally.phase !== 'young' ? Math.max(0, tally.candidates - plan.deletable.length) : 0
                    return { status: 'planned', phase: tally.phase, candidates: tally.candidates, deletable: plan.deletable, later }
                }
                return { status: 'done', ...tally }
            }
        }
        throw stopped(tally, 'commit-conflict')
    } catch (error) {
        if (error instanceof Ended) {
            const result = error.result
            if (result.status === 'refused' && (tally.deleted > 0 || tally.failed > 0)) {
                return { ...result, deleted: tally.deleted, failed: tally.failed }
            }
            return result
        }
        throw error
    }
}
