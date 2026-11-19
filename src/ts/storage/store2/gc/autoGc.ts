import { MEASURE } from '../../../process/memory/measureFlag'
import { getPageStorageMode } from '../../pageStorageMode'
import { liveLockQuery, soleTabAnswer } from '../../soleTab'
import type { ByteStore } from '../../store/contract'
import { batchPaceOf } from '../oldData/delete'
import type { Store2Session } from '../session'
import type { GcPageFacts } from './gcMeasure'
import { meterGcBackend, noteMeasuredGcResult, type GcMeter } from './gcMeter'
import { gcPass, type GcDeps, type GcPeers, type GcResult } from './pass'
import { buildNodeGcAge } from './unitAge'

/**
 * The automatic clean-up of store2 leftovers: one collector pass per page load, from the maintenance step after the
 * old-data deletion settled (`maintenance.ts` calls it, inside the step's own try/catch).
 *
 * - It runs on the app (`tauri` sessions), on the web (`indexeddb` sessions) and on a Node server (`node` sessions). A
 *   transitional OPFS session runs nothing, not even a read.
 * - A Node page runs the aged pass (`pass.ts`, `unitAge.ts`): a server cannot prove that no reader still holds an older
 *   base, so a unit is retired only on its third sighting, each at least a day after the previous record in the earlier of
 *   the server's and the page's clock. The pass needs the guarded routes and the server's clock and otherwise refuses
 *   `capability-missing` before any store2 read. The sole-tab proof still applies where Web Locks exist: another tab refuses
 *   the pass; plain HTTP has no proof and proceeds under the minimum age. The measurement-only single-phase Node pass of
 *   `gcMeasure.ts` is separate and stays manual.
 * - The app has one page and needs no peer check. A web page proves, before any store2 read in each round and before every
 *   batch, that it is the sole tab: exactly one presence holder in `navigator.locks.query()`, this tab's own presence claim
 *   true before and after the query, and no exclusive holder or pending request. The answer is never cached. A host
 *   without Web Locks (plain HTTP) answers `'unsupported'` and the pass refuses `no-web-locks`: it fails safe and cleans
 *   nothing there. Any other answer refuses `other-tab`, or ends a later round or batch loop as `stopped: 'other-tab'`.
 * - A web page also deletes only while the commit key's current is the manifest its own save loop acknowledged
 *   (`acknowledgedManifestKey`). Its own base then predates nothing the mark misses: a peer that committed and left would
 *   otherwise leave this page reading units that the mark no longer contains. The own-base fact answers `null` while an
 *   attempt is pending and, for the rest of the page load, once the page's save encoder fast-forwarded to a peer's tree (a
 *   page whose base is not its own boot read, commits or adoptions never runs the pass); the pass then refuses
 *   `stale-base`. That costs only liveness: the next page load collects.
 * - A page restored from the back/forward cache holds no valid presence claim (`holdsOwnTabPresence` is false), so the
 *   sole-tab proof refuses there. A restore run (a backup load) ends the pass at the next batch on every kind.
 * - It runs only on a store2 page with a backend; the synchronous checks come first and the page facts are resolved only
 *   after them. With injected facts the pass awaits nothing but backend calls and the pace; a measurement build then
 *   awaits the ring note after the pass.
 * - The pass gets the session's own backend (the flush tracker) and reads `session.idleReason` live at every attempt: a
 *   top-level write that is not known to be flushed makes the pass refuse `idle`, and nothing retries it. A copy of the
 *   session would freeze that answer, so the session itself is captured.
 * - The pass ends early, between batches, when a data action is registered, the save loop is parked, or the page holds
 *   unsaved changes. A stopped pass is harmless: every batch is a compare-and-remove against the commit key it was
 *   marked from, so a commit that lands mid-pass conflicts the next batch instead of being judged by a stale mark.
 * - It registers no busy action: that would only start the Android keep-alive on every backgrounding.
 * - It logs one plain result line per pass, which only a development page shows: every build strips the console. A
 *   measurement build adds the mark time of each round and records the line in the import phase ring through
 *   `noteImportPhase` (`gcMeter.ts`).
 */

/**
 * What the page contributes to the stop rule and to the web proofs; the rest of the page's state is the session's.
 * `peers` and `ownBase` are read only for an `indexeddb` or `node` session.
 */
export type AutoGcFacts = Pick<GcPageFacts, 'isBusy' | 'saveLoopParked'> & {
    isSaveClean(): boolean
    /** A backup load or restore run is open. */
    restoreInProgress(): boolean
    /** The web sole-tab proof, asked fresh each time. */
    peers: GcPeers
    /** The manifest key this page's save loop acknowledged, or `null` when none is settled. */
    ownBase(): string | null
}

export { soleTabAnswer, type SoleTabInput } from '../../soleTab'

/** The page's own modules, loaded when the pass first needs them so that installing the step costs nothing. */
async function loadLiveFacts(): Promise<AutoGcFacts> {
    const [busy, loop, api, restore] = await Promise.all([
        import('../../../process/memory/busyActions'),
        import('../saveLoop'),
        import('../../../globalApi.svelte'),
        import('../../../drive/restoreInProgress'),
    ])
    return {
        isBusy: () => busy.isBusy(),
        saveLoopParked: () => loop.isSaveLoopParked(),
        isSaveClean: () => api.isSaveClean(),
        restoreInProgress: () => restore.restoreInProgress(),
        peers: () => soleTabAnswer({ query: liveLockQuery(), holdsOwnPresence: api.holdsOwnTabPresence }),
        ownBase: () => loop.acknowledgedManifestKey(),
    }
}

/**
 * The pass's dependencies for this session, or `null` when it has no backend. `session` is read live, never copied. A
 * `node` session gets the probe and the aged dependencies from the page's byte store; without a store that has the guarded
 * routes and a server clock it gets no `age`, and `runAutoGc` then refuses.
 */
export function buildAutoGcDeps(session: Pick<Store2Session, 'kind' | 'backend' | 'idleReason'>, facts: AutoGcFacts, store?: ByteStore): GcDeps | null {
    const { backend } = session
    if (backend === null) {
        return null
    }
    const deps: GcDeps = {
        backend,
        kind: session.kind,
        idleReason: () => session.idleReason,
        pace: batchPaceOf(session.kind),
        shouldStop: () => facts.isBusy() || facts.saveLoopParked() || !facts.isSaveClean() || facts.restoreInProgress(),
    }
    if (session.kind === 'indexeddb' || session.kind === 'node') {
        deps.peers = () => facts.peers()
        deps.ownBase = () => facts.ownBase()
    }
    if (session.kind === 'node' && store !== undefined) {
        const { guarded } = store
        deps.probe = guarded === undefined ? undefined : () => guarded.probe()
        const age = buildNodeGcAge(store)
        if (age !== null) {
            deps.age = age
        }
    }
    return deps
}

/** The plain result line: the status, the counts and why the pass ended, never a key. */
export function formatGcResult(result: GcResult): string {
    if (result.status === 'refused') {
        return `store2 clean-up: status=refused reason=${result.reason}`
    }
    const stopped = result.stopped === undefined ? '' : ` stopped=${result.stopped}`
    const { age } = result
    const aged = age === undefined
        ? ''
        : ` phase=${age.phase} candidates=${age.candidates} recorded-items=${age.recordedItems} record=${age.record}${age.conflictOn === undefined ? '' : ` conflict=${age.conflictOn}`} clock-gap=${age.clockGapMs}`
    return `store2 clean-up: status=done deleted=${result.deleted} batches=${result.batches}${stopped}${aged}`
}

/**
 * Runs the pass, or does nothing; returns the result, or `null` when nothing ran. Throws what `gcPass` throws; the caller
 * logs and swallows it. A `node` session without the aged dependencies is refused `capability-missing` before any store2 read.
 */
export async function runAutoGc(session: Store2Session, facts?: AutoGcFacts, store?: ByteStore): Promise<GcResult | null> {
    if ((session.kind !== 'tauri' && session.kind !== 'indexeddb' && session.kind !== 'node') || session.backend === null || getPageStorageMode().kind !== 'store2') {
        return null
    }
    const deps = buildAutoGcDeps(session, facts ?? await loadLiveFacts(), store)
    if (deps === null) {
        return null
    }
    if (session.kind === 'node' && deps.age === undefined) {
        const refused: GcResult = {
            status: 'refused', reason: 'capability-missing',
            detail: 'The Node server\'s guarded routes or clock are not available.',
        }
        console.info(formatGcResult(refused))
        return refused
    }
    let meter: GcMeter | null = null
    if (MEASURE) {
        // The mark timing is a measurement-build tool: this branch folds away in a normal build and takes the module with it.
        meter = meterGcBackend(deps.backend)
        deps.backend = meter.backend
    }
    const result = await gcPass(deps)
    if (MEASURE) {
        // The build strips `console.*` calls with their arguments, so the ring write is a statement of its own: on a
        // measurement build the phase ring is the only output. This block folds away in a normal build.
        const measured = await noteMeasuredGcResult(formatGcResult(result), meter)
        console.info(measured)
    } else {
        console.info(formatGcResult(result))
    }
    return result
}
