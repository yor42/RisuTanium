import { MEASURE } from '../../process/memory/measureFlag'
import { startQuietTrigger, type QuietTrigger } from '../../process/memory/putBackQuiet'
import type { ByteStore } from '../store/contract'
import { getPageStorageMode } from '../pageStorageMode'
import { liveLockQuery, soleTabAnswer } from '../soleTab'
import { recordStartupCleanup } from '../startupCleanupState'
import { getStore2BootSession } from './bootActive'
import { batchPaceOf, runOldDataDeletion } from './oldData/delete'
import type { Store2Session } from './session'
import { installImportBench } from '../../drive/importBench'
import { runAutoGc, type AutoGcFacts } from './gc/autoGc'
import { installGcMeasure } from './gc/gcMeasure'
import { buildNodeGcAge } from './gc/unitAge'
import { installSweepDryRunMeasure } from './sweep/dryRunMeasure'
import { sizeAssets } from './sweep/assetSize'
import { runAssetSweep, type AssetSweepEnv, type AssetSweepResult } from './sweep/run'

/**
 * The deleters a store2 page runs on its own, one at a time, after the page has been quiet. Today that is the cutover
 * deletion of old-format files (`oldData/delete.ts`), followed on the app, on the web and on a Node server (`tauri`,
 * `indexeddb` and `node` sessions) by one collector pass over the store2 leftovers (`gc/autoGc.ts`; on the web it runs only
 * when the sole-tab proof and the own-base rule hold, and otherwise logs one refusal line and deletes nothing; on Node the
 * pass is aged: a unit is retired only on its third sighting a day apart, and it needs the server's guarded routes and
 * clock), followed on the app, on the web and on a Node server
 * (`tauri`, `indexeddb` and `node` sessions; the transitional OPFS page never lists `assets/`) by one asset
 * sweep (`sweep/run.ts`; on the web and on Node its tab check is the same sole-tab proof as the collector's, except that
 * the sweep also refuses where Web Locks are missing) that deletes stored assets nothing refers to once a record at least a
 * day old has named them (on Node, twice, each time at the asset's current revision, with the server's clock and guarded
 * routes). All three run inside the one registered step and each logs and swallows its
 * own failure, so a failed deleter never keeps the next one from running.
 *
 * - It runs only on a page whose own boot found a normal store2 profile (the "commit key parses with a readable tree" row),
 *   so the converted tree has been opened cold once before anything irreversible is deleted. The runner starts only on a
 *   boot whose session classified as a normal store2 boot (the commit key parses); a boot that installs the tree and then
 *   re-reads it cold in a later round can classify that way, which still meets the rule that deletion follows a cold read
 *   of the installed tree. A recovery boot and a legacy, block or read-only page never reach it.
 * - It waits for the quiet trigger of the character put-back: hidden after a committed save, or 30 s without input.
 * - The step is registered as the startup clean-up when it starts, so a backup load that waits on the startup clean-up
 *   waits for this step to end and no longer; the registered promise always settles and never rejects.
 * - It shows nothing to the person: the asset sweep logs one line of counts and never an asset name.
 *
 * The person's own entry, `runManualCleanUp`, runs the same asset sweep on demand (a plan step, the confirm, then the delete
 * step) and excludes this step: a manual run is refused `busy` while the step runs, and a step whose trigger fires while a
 * manual run is in progress starts when that run ends, not at a fresh quiet trigger; every deleter in it checks its own stop
 * facts again.
 *
 * A measurement build also installs the sweep dry run (`sweep/dryRunMeasure.ts`) on any store2 page; it deletes and writes nothing.
 * It installs the collector run (`gc/gcMeasure.ts`) too, which deletes only on an explicit `confirm: true` and refuses while this
 * step is active.
 */

/** What the page gives the runner: its byte store and the non-pruning numbered-backup listing. */
export interface MaintenanceEnv {
    store: () => Promise<ByteStore>
    listBackupTimes: () => Promise<number[]>
}

/** The replaceable parts, for tests. */
export interface MaintenanceSeams {
    session?: () => Store2Session | null
    startTrigger?: (run: () => void) => QuietTrigger
    deletion?: typeof runOldDataDeletion
    /** Replaces the live page's facts for the clean-up pass; the default loads the page's own modules on first use. */
    gcPageFacts?: AutoGcFacts
    /** Replaces the live page's facts for the asset sweep; the default loads the page's own modules on first use. */
    sweepFacts?: SweepPageFacts
}

/** What the page contributes to the asset sweep: the rest of the pass's environment is the session, the store and the pace. */
export type SweepPageFacts = Pick<AssetSweepEnv, 'residentRefs' | 'writtenCount' | 'writtenThisPage' | 'peers' | 'shouldStop' | 'release' | 'hold'>

/** The page's own modules, loaded when the sweep first needs them so that installing the step costs nothing. */
async function loadSweepFacts(): Promise<SweepPageFacts> {
    const [api, database, busy, loop, restore, hold] = await Promise.all([
        import('../../globalApi.svelte'),
        import('../database.svelte'),
        import('../../process/memory/busyActions'),
        import('./saveLoop'),
        import('../../drive/restoreInProgress'),
        import('../assetDeleteHold'),
    ])
    return {
        residentRefs: () => api.getUncleanablesSync(database.getDatabase()),
        writtenCount: () => api.assetsWrittenThisPageCount(),
        writtenThisPage: () => api.listAssetsWrittenThisPage(),
        peers: () => soleTabAnswer({ query: liveLockQuery(), holdsOwnPresence: api.holdsOwnTabPresence }),
        shouldStop: () => busy.isBusy() || loop.isSaveLoopParked() || !api.isSaveClean() || restore.restoreInProgress(),
        release: keys => api.releaseAssetObjectUrl(keys),
        hold: remove => hold.holdAssetDeletion(remove),
    }
}

/** The plain result line: the status, the counts and why the pass ended, never an asset name. */
export function formatSweepResult(result: AssetSweepResult): string {
    if (result.status === 'skipped') {
        return 'store2 asset sweep: status=skipped'
    }
    if (result.status === 'planned') {
        return `store2 asset sweep: status=planned phase=${result.phase ?? 'none'} candidates=${result.candidates} deletable=${result.deletable.length} later=${result.later}`
    }
    if (result.status === 'refused') {
        const earlier = result.deleted === undefined ? '' : ` deleted=${result.deleted} failed=${result.failed ?? 0}`
        return `store2 asset sweep: status=refused reason=${result.reason}${earlier}`
    }
    const stopped = result.stopped === undefined ? '' : ` stopped=${result.stopped}`
    return `store2 asset sweep: status=done phase=${result.phase ?? 'none'} candidates=${result.candidates} deleted=${result.deleted} failed=${result.failed} kept-live=${result.keptLive} batches=${result.batches} recorded=${result.recorded}${stopped}`
}

/**
 * Runs the asset sweep, or does nothing: only a `tauri`, `indexeddb` or `node` session with a backend on a store2 page, and
 * nothing is loaded or read before that is known. Throws what the pass throws; the caller logs and swallows it.
 */
async function runStore2AssetSweep(env: MaintenanceEnv, session: Store2Session, facts?: SweepPageFacts): Promise<void> {
    if ((session.kind !== 'tauri' && session.kind !== 'indexeddb' && session.kind !== 'node') || session.backend === null || getPageStorageMode().kind !== 'store2') {
        return
    }
    const live = facts ?? await loadSweepFacts()
    const store = await env.store()
    // The clocks of a Node page are the unit pass's own: the server's and the page's, read together. Without the server's
    // guarded clock there is none, and the pass ends `no-server-time` before it reads anything.
    const sampleClock = sweepClockOf(session, store)
    const result = await runAssetSweep({ session, store, pace: batchPaceOf(session.kind), sampleClock, ...live })
    console.info(formatSweepResult(result))
}

let stepActive = false
/** A manual clean-up is in progress. */
let manualActive = false
/** The automatic step whose trigger fired during a manual run; started when that run ends. */
let deferredStep: (() => void) | null = null

/** The clocks of a Node page (the server's and the page's, read together); none on any other kind. */
function sweepClockOf(session: Pick<Store2Session, 'kind'>, store: ByteStore): AssetSweepEnv['sampleClock'] {
    return session.kind === 'node' ? buildNodeGcAge(store)?.sampleClock : undefined
}

/** Whether the boot that opened this session found the profile ready (row 5) instead of installing it. */
export function bootDidNotInstall(session: Store2Session): boolean {
    const decision = session.decision
    return decision.row === 5 && decision.mode === 'normal'
}

async function runStep(env: MaintenanceEnv, session: Store2Session, deletion: typeof runOldDataDeletion, gcPageFacts?: AutoGcFacts, sweepFacts?: SweepPageFacts): Promise<void> {
    if (stepActive) {
        return
    }
    if (manualActive) {
        deferredStep = () => { void runStep(env, session, deletion, gcPageFacts, sweepFacts) }
        return
    }
    stepActive = true
    const step = (async () => {
        try {
            try {
                // A Node server draws every request on one budget: its batches keep the floor between them.
                const pace = session.kind === 'node' ? batchPaceOf('node') : undefined
                await deletion(session, { store: await env.store(), listBackupTimes: env.listBackupTimes, pace })
            } catch (error) {
                console.error(error)
            }
            // After the deletion settled, even a refused or failed one, and on its own: a thrown pass is logged and swallowed.
            try {
                await runAutoGc(session, gcPageFacts, await env.store())
            } catch (error) {
                console.error(error)
            }
            // Last, on its own: a thrown sweep (a hold overlap included) is logged and swallowed, and the step still ends.
            try {
                await runStore2AssetSweep(env, session, sweepFacts)
            } catch (error) {
                console.error(error)
            }
        } finally {
            stepActive = false
        }
    })()
    recordStartupCleanup(step)
    await step
}

/**
 * Starts the runner on this page, or does nothing: the page must be a store2 page whose boot did not install. Detached
 * by design: it never throws and the boot never awaits it. Returns the armed trigger, or `null` when nothing was started.
 */
export function startStore2Maintenance(env: MaintenanceEnv, seams: MaintenanceSeams = {}): QuietTrigger | null {
    try {
        if (getPageStorageMode().kind !== 'store2') {
            return null
        }
        const session = (seams.session ?? getStore2BootSession)()
        if (MEASURE && session !== null) {
            // The sweep dry run and the collector run are development actions: this branch folds away in a normal build and
            // takes both modules with it.
            installSweepDryRunMeasure({ session, store: env.store })
            installGcMeasure({ session, store: env.store, deletionActive: () => stepActive || manualActive })
            installImportBench()
        }
        if (session === null || !bootDidNotInstall(session)) {
            return null
        }
        const deletion = seams.deletion ?? runOldDataDeletion
        const trigger = (seams.startTrigger ?? startQuietTrigger)(() => {
            trigger.stop()
            void runStep(env, session, deletion, seams.gcPageFacts, seams.sweepFacts)
        })
        trigger.arm()
        return trigger
    } catch (error) {
        console.error(error)
        return null
    }
}

export function resetMaintenanceForTests(): void {
    stepActive = false
    manualActive = false
    deferredStep = null
}

/** What the manual clean-up shows the person: the progress popups (with the way to cancel) and the confirm. */
export interface ManualCleanUpUi {
    progress(step: 'measuring' | 'deleting', cancel: () => void): void
    /** Resolves true on Yes, which is also the person's attestation that no other tab or device is open. */
    confirm(plan: ManualCleanUpPlan): Promise<boolean>
}

export interface ManualCleanUpPlan {
    kind: 'tauri' | 'indexeddb' | 'node'
    /** Files the delete step can remove now. */
    deletable: number
    /** Their total stored size, or null when it could not be told. */
    bytes: number | null
    /** Files only a later clean-up can delete (Node's age rule). */
    later: number
}

export type ManualCleanUpOutcome =
    | { status: 'busy' }
    | { status: 'unavailable' }
    | { status: 'declined' }
    | { status: 'nothing' }
    | { status: 'wait' }
    | { status: 'cancelled', deleted: number }
    | { status: 'ended', result: AssetSweepResult, approved: number }

/** The replaceable parts, for tests. */
export interface ManualCleanUpSeams {
    session?: () => Store2Session | null
    store?: () => Promise<ByteStore>
    sweepFacts?: SweepPageFacts
    sizeOf?: (key: string) => Promise<number | null>
}

async function defaultManualStore(): Promise<ByteStore> {
    return (await import('../store/appStore')).getAppStore()
}

function deletedOf(result: AssetSweepResult): number {
    if (result.status === 'done') {
        return result.deleted
    }
    return result.status === 'refused' ? result.deleted ?? 0 : 0
}

/**
 * The person's "clean up unused files": a read-only plan, the confirm, then the delete of exactly the planned names. It
 * returns `busy` while the automatic step runs and holds the automatic step off until it ends. The delete step starts only
 * after `confirm` resolved true. Throws what the pass or the confirm throws; the exclusion is cleared either way.
 */
export async function runManualCleanUp(ui: ManualCleanUpUi, seams: ManualCleanUpSeams = {}): Promise<ManualCleanUpOutcome> {
    if (stepActive || manualActive) {
        return { status: 'busy' }
    }
    manualActive = true
    try {
        const session = (seams.session ?? getStore2BootSession)()
        if (session === null || getPageStorageMode().kind !== 'store2' || session.backend === null || !bootDidNotInstall(session)
            || (session.kind !== 'tauri' && session.kind !== 'indexeddb' && session.kind !== 'node')) {
            return { status: 'unavailable' }
        }
        const kind = session.kind
        const facts = seams.sweepFacts ?? await loadSweepFacts()
        const store = await (seams.store ?? defaultManualStore)()
        let cancelled = false
        const cancel = (): void => { cancelled = true }
        const shouldStop = (): boolean => facts.shouldStop() || cancelled
        const sampleClock = sweepClockOf(session, store)
        const pace = batchPaceOf(session.kind)
        const round = (manual: NonNullable<AssetSweepEnv['manual']>): Promise<AssetSweepResult> =>
            runAssetSweep({ session, store, pace, sampleClock, ...facts, shouldStop, manual })

        ui.progress('measuring', cancel)
        const plan = await round({ step: 'plan' })
        console.info(formatSweepResult(plan))
        if (plan.status !== 'planned') {
            return cancelled ? { status: 'cancelled', deleted: 0 } : { status: 'ended', result: plan, approved: 0 }
        }
        if (cancelled) {
            return { status: 'cancelled', deleted: 0 }
        }
        if (plan.phase === 'young') {
            return { status: 'wait' }
        }
        if (plan.deletable.length === 0 && plan.later === 0) {
            return { status: 'nothing' }
        }
        let bytes: number | null = null
        if (plan.deletable.length > 0) {
            const sized = await sizeAssets({ kind, store, names: plan.deletable, pace, shouldStop, sizeOf: seams.sizeOf })
            if (sized.status === 'stopped') {
                return cancelled ? { status: 'cancelled', deleted: 0 } : { status: 'busy' }
            }
            bytes = sized.bytes
        }
        // Invariant: no confirm is ever shown after a Cancel, whichever await the Cancel landed in.
        if (cancelled) {
            return { status: 'cancelled', deleted: 0 }
        }
        if (!await ui.confirm({ kind, deletable: plan.deletable.length, bytes, later: plan.later })) {
            return { status: 'declined' }
        }
        ui.progress('deleting', cancel)
        const result = await round({ step: 'delete', approved: new Set(plan.deletable) })
        console.info(formatSweepResult(result))
        const deleted = deletedOf(result)
        if (cancelled && result.status !== 'planned' && !(result.status === 'done' && result.stopped === undefined)) {
            return { status: 'cancelled', deleted }
        }
        // Another device's pass wrote the Node record between the plan and the Yes: nothing was deleted or written.
        if (result.status === 'done' && result.phase === 'young' && deleted === 0) {
            return { status: 'wait' }
        }
        return { status: 'ended', result, approved: plan.deletable.length }
    } finally {
        manualActive = false
        const next = deferredStep
        deferredStep = null
        next?.()
    }
}
