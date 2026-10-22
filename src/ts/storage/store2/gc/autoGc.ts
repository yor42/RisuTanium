import { MEASURE } from '../../../process/memory/measureFlag'
import { getPageStorageMode } from '../../pageStorageMode'
import { batchPaceOf } from '../oldData/delete'
import type { Store2Session } from '../session'
import type { GcPageFacts } from './gcMeasure'
import { meterGcBackend, noteMeasuredGcResult, type GcMeter } from './gcMeter'
import { gcPass, type GcDeps, type GcResult } from './pass'

/**
 * The automatic clean-up of store2 leftovers: one collector pass per page load, from the maintenance step after the
 * old-data deletion settled (`maintenance.ts` calls it, inside the step's own try/catch).
 *
 * - It runs only on the app (`tauri` sessions). A `node` or `indexeddb` session runs nothing, not even a read: protecting a
 *   server or a browser page from a peer that still needs the units waits for the asset stage.
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

/** What the page contributes to the stop rule; the rest of the page's state is the session's. */
export type AutoGcFacts = Pick<GcPageFacts, 'isBusy' | 'saveLoopParked'> & { isSaveClean(): boolean }

/** The page's own modules, loaded when the pass first needs them so that installing the step costs nothing. */
async function loadLiveFacts(): Promise<AutoGcFacts> {
    const [busy, loop, api] = await Promise.all([
        import('../../../process/memory/busyActions'),
        import('../saveLoop'),
        import('../../../globalApi.svelte'),
    ])
    return {
        isBusy: () => busy.isBusy(),
        saveLoopParked: () => loop.isSaveLoopParked(),
        isSaveClean: () => api.isSaveClean(),
    }
}

/**
 * The pass's dependencies for this session, or `null` when it has no backend. `session` is read live, never copied.
 */
export function buildAutoGcDeps(session: Pick<Store2Session, 'kind' | 'backend' | 'idleReason'>, facts: AutoGcFacts): GcDeps | null {
    const { backend } = session
    if (backend === null) {
        return null
    }
    return {
        backend,
        kind: session.kind,
        idleReason: () => session.idleReason,
        pace: batchPaceOf(session.kind),
        shouldStop: () => facts.isBusy() || facts.saveLoopParked() || !facts.isSaveClean(),
    }
}

/** The plain result line: the status, the counts and why the pass ended, never a key. */
export function formatGcResult(result: GcResult): string {
    if (result.status === 'refused') {
        return `store2 clean-up: status=refused reason=${result.reason}`
    }
    const stopped = result.stopped === undefined ? '' : ` stopped=${result.stopped}`
    return `store2 clean-up: status=done deleted=${result.deleted} batches=${result.batches}${stopped}`
}

/**
 * Runs the pass, or does nothing; returns the result, or `null` when nothing ran. Throws what `gcPass` throws; the caller
 * logs and swallows it.
 */
export async function runAutoGc(session: Store2Session, facts?: AutoGcFacts): Promise<GcResult | null> {
    if (session.kind !== 'tauri' || session.backend === null || getPageStorageMode().kind !== 'store2') {
        return null
    }
    const deps = buildAutoGcDeps(session, facts ?? await loadLiveFacts())
    if (deps === null) {
        return null
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
