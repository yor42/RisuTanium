import type { ByteStore } from '../../store/contract'
import { AssetDeleteHoldOverlapError } from '../../assetDeleteHold'
import { Store2BackendError, Store2CommitConflictError, Store2StalePageError } from '../backend/errors'
import { REMOVE_BATCH_MAX, bytesTokenOf, tokenMatches, type Store2Backend } from '../backend/types'
import type { GateOpen, GateRefusal } from '../boot'
import type { Store2Session } from '../session'
import { decideAge, type AgeCandidate, type AgePhase, type RecordRead } from './ageRecord'
import { AssetKeySet } from './assetKey'
import { createBackendClosureReader } from './backendReader'
import { checkFences } from './fences'
import { buildClosureAssetKeepSet, legacyFilesOf } from './keepSet'
import { decideAutoSweep, type AssetCount } from './limit'
import { readSweepRecord, writeSweepRecord } from './record'

/**
 * The deleting pass of the asset sweep on a store2 page (`tauri` and `indexeddb` kinds; every other kind reads and writes
 * nothing). It deletes an `assets/` file only when all of these hold:
 *
 * - the closure keep-set over `{current} + retained + pins` is complete (an incomplete one deletes nothing and writes
 *   nothing), so an asset a restore point still names is never touched;
 * - an age record at least `minAgeMs` old named the asset and this pass's fresh scan names it again;
 * - the deleter gate is open, the fences are clear and, per batch, the commit key and the fence are still what the gate
 *   read: a Tauri page proves it with a same-bytes `casCommit` on the gate's commit token (a page that a newer page
 *   superseded is refused by the native gate, so it deletes nothing and writes no record), a web page by a read;
 * - at that very delete: no stop condition holds, this page did not write the asset, the resident database does not
 *   refer to it and, on the web, no other tab is open.
 *
 * The stop check, the written check, the resident check and the registration of the deletion hold are one synchronous
 * run, so a same-page writer of the key either was seen by the check or waits for the hold. The stored assets are
 * listed before the keep-set is built, so an asset written after the listing is never a candidate.
 *
 * The one data write is the age record. A stopped pass writes none. The pass is silent: it reports counts and reasons,
 * never an asset name.
 */

/** What a web page learns about other tabs of the app (the answer of the sole-tab proof, `soleTabAnswer`). */
export type SweepPeers = 'alone' | 'others' | 'unsupported'

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
}

export type SweepStopReason =
    | 'yielded' | 'idle' | 'other-tab' | 'fence-conflict' | 'commit-conflict' | 'stale-page' | 'probe-failed'

export type SweepRefusalReason =
    | GateRefusal
    | 'no-backend' | 'no-web-locks' | 'other-tab' | 'listing-failed' | 'over-limit' | 'unknown-count'
    | 'keep-incomplete' | 'fences' | 'record-too-new' | 'record-io-failed'

export type AssetSweepResult =
    | { status: 'skipped' }
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
 * write. A moved commit key is `moved` (rebuild the keep-set); a moved fence, a stale page or a failed probe ends the pass.
 */
async function checkFresh(env: AssetSweepEnv, gate: GateOpen, backend: Store2Backend, tally: Tally): Promise<'fresh' | 'moved'> {
    const { session } = env
    try {
        const fence = await backend.readFence()
        if (!tokenMatches(gate.fenceToken, fence.bytes)) {
            throw stopped(tally, 'fence-conflict')
        }
        if (session.kind === 'tauri') {
            const bytes = bytesTokenOf(gate.commitToken).bytes
            if (bytes === null) {
                throw stopped(tally, 'probe-failed')
            }
            // The same bytes under the gate's own token: it succeeds only while the commit key is unchanged, and the
            // native gate refuses it when a newer page has registered.
            await backend.casCommit(gate.commitToken, bytes)
        } else {
            const commit = await backend.readCommit()
            if (!tokenMatches(gate.commitToken, commit.bytes)) {
                return 'moved'
            }
        }
    } catch (error) {
        if (error instanceof Ended) {
            throw error
        }
        if (error instanceof Store2CommitConflictError) {
            return 'moved'
        }
        if (error instanceof Store2StalePageError) {
            throw stopped(tally, 'stale-page')
        }
        if (error instanceof Store2BackendError) {
            throw stopped(tally, 'probe-failed')
        }
        throw error
    }
    if (session.idleReason !== null) {
        throw stopped(tally, 'idle')
    }
    return 'fresh'
}

/** The names under `assets/` (top level only) and their count. */
async function listAssets(store: ByteStore): Promise<{ names: string[], count: AssetCount }> {
    const keys = await store.list(ASSETS_PREFIX)
    const names = keys.map(key => key.slice(ASSETS_PREFIX.length)).filter(name => !name.includes('/'))
    const count: AssetCount = store.countPrefix === undefined ? keys.length : (await store.countPrefix(ASSETS_PREFIX)) ?? 'unknown'
    return { names, count }
}

/** One scan and delete round: a commit key that moved ends it with `rebuild`. */
async function runRound(env: AssetSweepEnv, backend: Store2Backend, tally: Tally): Promise<'finished' | 'rebuild'> {
    const { session, store } = env
    const web = session.kind === 'indexeddb'
    if (env.shouldStop()) {
        throw stopped(tally, 'yielded')
    }
    if (web) {
        const peers = await env.peers()
        if (peers === 'unsupported') {
            throw refused('no-web-locks')
        }
        if (peers === 'others') {
            throw refused('other-tab')
        }
    }
    const gate = await session.openGate('sweep')
    if (gate.status === 'refused') {
        throw refused(gate.reason)
    }

    // Listed before the keep-set is built: an asset written after this point is never a candidate.
    let listed: { names: string[], count: AssetCount }
    try {
        listed = await listAssets(store)
    } catch {
        throw refused('listing-failed')
    }
    const limit = decideAutoSweep(listed.count, env.limit)
    if (!limit.auto) {
        throw refused(limit.reason === 'over-limit' ? 'over-limit' : 'unknown-count')
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
        // A web pass runs only while it is the sole tab and a Tauri pass is the sole page, so no other writer's bulk
        // operation runs; this page's own restore is covered by the busy check, the written set and the hold.
        bulkMarkersSet: true,
    })
    if (fences.status === 'refused') {
        throw refused('fences')
    }

    const candidates: AgeCandidate[] = listed.names.filter(name => !keep.holds(name)).map(name => ({ name, rev: null }))
    tally.candidates = candidates.length
    const recordRead = await readSweepRecord(store)
    if (recordRead.status === 'too-new') {
        throw refused('record-too-new')
    }
    if (recordRead.status === 'io-failed') {
        throw refused('record-io-failed')
    }
    const record: RecordRead = recordRead
    const decision = decideAge({
        record,
        candidates,
        now: (env.now ?? Date.now)(),
        backend: session.kind === 'tauri' ? 'tauri' : 'indexeddb',
        keep,
        minAgeMs: env.minAgeMs,
    })
    tally.phase = decision.phase
    if (decision.phase === 'young') {
        return 'finished'
    }

    const names = decision.delete.map(deletion => deletion.name)
    const written = new AssetKeySet()
    let writtenSeen = 0
    for (let start = 0; start < names.length; start += REMOVE_BATCH_MAX) {
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
        try {
            for (const name of names.slice(start, start + REMOVE_BATCH_MAX)) {
                if (web && await env.peers() !== 'alone') {
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
                    await env.hold(() => store.delete(key, 'unconditional'))
                    removed.push(key)
                    tally.deleted++
                } catch (error) {
                    if (error instanceof AssetDeleteHoldOverlapError) {
                        throw error
                    }
                    tally.failed++
                }
            }
        } finally {
            if (removed.length > 0) {
                env.release(removed)
            }
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
    await writeSweepRecord(store, decision.nextRecord)
    tally.recorded = true
    return 'finished'
}

/** Runs the pass; rejects only with what the store or the backend threw unexpectedly, or with a hold overlap. */
export async function runAssetSweep(env: AssetSweepEnv): Promise<AssetSweepResult> {
    const { session } = env
    if ((session.kind !== 'tauri' && session.kind !== 'indexeddb') || session.backend === null) {
        return { status: 'skipped' }
    }
    const tally: Tally = { phase: null, candidates: 0, deleted: 0, failed: 0, keptLive: 0, batches: 0, recorded: false }
    try {
        for (let round = 0; round < MAX_ROUNDS; round++) {
            // Read live: the session's backend is the flush tracker, never a copy.
            const backend = session.backend
            if (backend === null) {
                throw refused('no-backend')
            }
            if (await runRound(env, backend, tally) === 'finished') {
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
