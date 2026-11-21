import { inlayIdFromBodyKey, inlayIdFromMetaKey, INLAY_PREFIX } from 'src/ts/process/files/inlayKeys'
import type { InlayVeto, RemoveUnusedInlayResult } from 'src/ts/process/files/inlayStore'
import type { ByteStore } from '../../store/contract'
import type { AppStoreKind } from '../../store/appStore'
import { REMOVE_BATCH_MAX, type Store2Backend } from '../backend/types'
import type { GateRefusal } from '../boot'
import { createBackendClosureReader } from './backendReader'
import { checkFences } from './fences'
import { gateFreshness, type GateFreshness } from './fresh'
import { decideInlayDeletions } from './inlayRule'
import { buildInlayKeepSet, legacyFilesOf } from './keepSet'
import type { AssetSweepSession } from './run'

/**
 * The deleting pass of the inlay sweep on a store2 page (`tauri` kind only; every other kind, the Node server
 * included, reads and writes nothing: MC-2865). It deletes an `inlays/m-<id>` metadata and the bodies of that id only when
 * all of these hold:
 *
 * - the inlay keep-set over `{current} + retained + pins` and the legacy unit is complete and names no owner whose list
 *   overflowed, and does not name the id;
 * - the id is not listed in the legacy store: its copy would otherwise be written back by the copy-in of a later start.
 *   The legacy store is only listed here, never written; an id becomes deletable once the verified clean-up of the copy-in
 *   has removed its legacy entry. A legacy listing that fails refuses the round;
 * - the deleter gate is open, the fences are clear and, per batch, the commit key and the fence are still what the gate
 *   read; a Tauri page is the sole page (the same-bytes `casCommit` probe of the batch). `unsupported` refuses: an automatic pass has no attestation;
 * - at that very delete: no stop condition holds, the save marks and the database object are what the resident walk
 *   saw, and this page did not write the id.
 *
 * Order of a round: the gate, the listing of `inlays/`, the listing of the legacy store, the keep-set, the fences, the
 * decision, then the resident walk (only when an id still has no protection). The app store is listed before the keep-set
 * is built, so an inlay written after the listing is never a candidate.
 *
 * Each id is deleted under its id lock. The stop check, the save-mark and database check and the written check are one
 * synchronous call made after the metadata is read and right before its delete. The metadata is deleted first (the
 * commit point, so a live metadata never names a missing body), then the body it names, then the other listed bodies of
 * the id. A metadata this build cannot read is kept. A failed metadata delete leaves the inlay whole.
 *
 * After the resident walk, protection against a database change rests on dirty tracking: every mutation moves the save
 * marks or leaves the page unsaved, which `shouldStop` reports. Bodies listed for an id without a listed metadata are
 * never touched.
 *
 * The pass writes no record (MC-2860) and nothing to the legacy store. It is silent: it reports counts and reasons,
 * never an inlay id.
 */

/** Whether a page of this store kind runs the pass: the Node server never does (MC-2865). */
export function inlaySweepKind(kind: AppStoreKind): boolean {
    return kind === 'tauri'
}

/** What the resident walk found, and whether it still speaks for the page's database. */
export interface InlayResident {
    /** The ids (of those asked) the resident database refers to. */
    mentioned: ReadonlySet<string>
    /** True while the page's database is still the object the walk read. */
    sameDatabase(): boolean
}

export interface InlaySweepEnv {
    session: AssetSweepSession
    /** The page's byte store: `inlays/`. */
    store: ByteStore
    /** A data action, a parked save loop, unsaved changes or a restore: the pass ends before its next delete. */
    shouldStop(): boolean
    /** The page's save-mark count; it only grows, so a changed count means the database changed. */
    saveMarks(): number
    /** Whether this page wrote the inlay since it started. */
    writtenThisPage(id: string): boolean
    /** The ids of the legacy store, a read only. Rejects when the store cannot be listed. */
    legacyInlayIds(): Promise<readonly string[]>
    /** Walks the resident database for the ids; null when the walk could not finish. */
    residentInlays(ids: readonly string[]): Promise<InlayResident | null>
    /** Runs work under the page's lock of the inlay id. */
    lock<T>(id: string, work: () => Promise<T>): Promise<T>
    /** Awaited between batches. */
    pace?(): Promise<void>
}

export type InlaySweepRefusal =
    | GateRefusal
    | 'no-backend' | 'no-web-locks' | 'other-tab' | 'listing-failed' | 'legacy-unlisted'
    | 'keep-incomplete' | 'unknown-owner' | 'fences' | 'resident-incomplete'

export type InlaySweepStop = 'yielded' | 'idle' | 'other-tab' | 'fence-conflict' | 'stale-page' | 'probe-failed' | 'changed'

export type InlaySweepResult =
    | { status: 'skipped' }
    | {
        status: 'refused'
        reason: InlaySweepRefusal
        /** Deletes of an earlier round of this pass, present only when a refusal followed a rebuild that had deleted or failed. */
        deleted?: number
        failed?: number
    }
    | {
        status: 'done'
        /** Ids nothing protects (after the legacy and resident filters). */
        candidates: number
        deleted: number
        /** Bodies deleted. */
        bodies: number
        /** Metadata deletes and body deletes the store failed. */
        failed: number
        /** Planned deletions kept: this page wrote the id, or its metadata could not be read. */
        keptLive: number
        /** Unprotected ids kept because the legacy store still lists them. */
        keptLegacy: number
        batches: number
        stopped?: InlaySweepStop
    }

const MAX_ROUNDS = 2

interface Tally {
    candidates: number
    deleted: number
    bodies: number
    failed: number
    keptLive: number
    keptLegacy: number
    batches: number
}

/** Control flow of the pass: the result that ends it. */
class Ended extends Error {
    constructor(readonly result: InlaySweepResult) {
        super('The inlay sweep ended.')
        this.name = 'Ended'
    }
}

function refused(reason: InlaySweepRefusal): Ended {
    return new Ended({ status: 'refused', reason })
}

function stopped(tally: Tally, reason: InlaySweepStop): Ended {
    return new Ended({ status: 'done', ...tally, stopped: reason })
}

/** The listing of `inlays/`: the ids whose metadata is listed and, per such id, the bodies listed for it. */
interface InlayListing {
    ids: string[]
    bodiesById: Map<string, string[]>
}

async function listInlays(store: ByteStore): Promise<InlayListing> {
    const keys = await store.list(INLAY_PREFIX)
    const ids: string[] = []
    for (const key of keys) {
        const id = inlayIdFromMetaKey(key)
        if (id !== null) {
            ids.push(id)
        }
    }
    const listed = new Set(ids)
    const bodiesById = new Map<string, string[]>()
    for (const key of keys) {
        const id = inlayIdFromBodyKey(key)
        if (id !== null && listed.has(id)) {
            const bodies = bodiesById.get(id)
            if (bodies === undefined) {
                bodiesById.set(id, [key])
            } else {
                bodies.push(key)
            }
        }
    }
    return { ids, bodiesById }
}

function stopOf(freshness: Exclude<GateFreshness, 'fresh' | 'moved'>): InlaySweepStop {
    return freshness
}

/** One scan and delete round: a commit key that moved ends it with `rebuild`. */
async function runRound(env: InlaySweepEnv, backend: Store2Backend, tally: Tally): Promise<'finished' | 'rebuild'> {
    const { session, store } = env
    if (env.shouldStop()) {
        throw stopped(tally, 'yielded')
    }
    const marks = env.saveMarks()
    const gate = await session.openGate('inlay-cleanup')
    if (gate.status === 'refused') {
        throw refused(gate.reason)
    }

    // Listed before the keep-set is built: an inlay written after this point is never a candidate.
    let listing: InlayListing
    try {
        listing = await listInlays(store)
    } catch {
        throw refused('listing-failed')
    }
    let legacy: ReadonlySet<string>
    try {
        legacy = new Set(await env.legacyInlayIds())
    } catch {
        throw refused('legacy-unlisted')
    }

    const reader = createBackendClosureReader(backend)
    const keepResult = await buildInlayKeepSet({ commitKey: gate.commit, reader })
    if (keepResult.status === 'incomplete') {
        throw refused('keep-incomplete')
    }
    const { keep } = keepResult
    if (keep.unknownOwners.length > 0) {
        throw refused('unknown-owner')
    }
    const fences = checkFences({
        commitKey: { status: 'ok', value: gate.commit },
        fence: gate.fence === 'absent' ? 'absent' : 'present',
        legacyFiles: legacyFilesOf([...reader.manifests().values()]),
        tauriFlushPending: session.idleReason !== null,
        // The caller vouches that no bulk operation's inlay writes can be lost to the pass: a web pass runs only while it
        // is the sole tab and a Tauri pass is the sole page, and this page's own writes are covered by the written check.
        bulkMarkersSet: true,
    })
    if (fences.status === 'refused') {
        throw refused('fences')
    }

    // Without a resident walk: ids the keep-set and the legacy store leave unprotected.
    const pre = decideInlayDeletions({ keep, candidates: listing.ids, inResidentDatabase: () => false, isOwnerResident: () => false })
    const pending = pre.delete.filter(id => !legacy.has(id))
    tally.keptLegacy = pre.delete.length - pending.length
    if (pending.length === 0) {
        tally.candidates = 0
        return 'finished'
    }
    const resident = await env.residentInlays(pending)
    if (resident === null) {
        throw refused('resident-incomplete')
    }
    const decision = decideInlayDeletions({
        keep, candidates: pending, inResidentDatabase: id => resident.mentioned.has(id), isOwnerResident: () => false,
    })
    tally.candidates = decision.delete.length
    // Loaded here and not at the top of the module: the inlay store pulls in the page's UI and storage modules, which the
    // sweep modules never import.
    const { removeUnusedAppInlay } = await import('src/ts/process/files/inlayStore')

    const deletes = decision.delete
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
        const freshness = await gateFreshness(session, gate, backend)
        if (freshness === 'moved') {
            return 'rebuild'
        }
        if (freshness !== 'fresh') {
            throw stopped(tally, stopOf(freshness))
        }
        tally.batches++
        for (const id of deletes.slice(start, start + REMOVE_BATCH_MAX)) {
            const mayDelete = (): InlayVeto | null => {
                if (env.shouldStop()) {
                    return 'stop'
                }
                if (env.saveMarks() !== marks || !resident.sameDatabase()) {
                    return 'changed'
                }
                return env.writtenThisPage(id) ? 'written' : null
            }
            let outcome: RemoveUnusedInlayResult
            try {
                outcome = await env.lock(id, () => removeUnusedAppInlay(store, id, listing.bodiesById.get(id) ?? [], mayDelete))
            } catch {
                tally.failed++
                continue
            }
            if (outcome.status === 'removed') {
                tally.deleted++
                tally.bodies += outcome.bodies
                tally.failed += outcome.bodyFailures
            } else if (outcome.reason === 'unreadable') {
                tally.keptLive++
            } else if (outcome.veto === 'stop') {
                throw stopped(tally, 'yielded')
            } else if (outcome.veto === 'changed') {
                throw stopped(tally, 'changed')
            } else {
                tally.keptLive++
            }
        }
    }
    return 'finished'
}

/** Runs the pass; rejects only with what the store or the backend threw unexpectedly. */
export async function runInlaySweep(env: InlaySweepEnv): Promise<InlaySweepResult> {
    const { session } = env
    if (!inlaySweepKind(session.kind) || session.backend === null) {
        return { status: 'skipped' }
    }
    const tally: Tally = { candidates: 0, deleted: 0, bodies: 0, failed: 0, keptLive: 0, keptLegacy: 0, batches: 0 }
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
        throw stopped(tally, 'changed')
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
