import type { BusyHandle } from '../../../process/memory/busyActions'
import { getPageStorageMode } from '../../pageStorageMode'
import type { ByteStore } from '../../store/contract'
import { batchPaceOf } from '../oldData/delete'
import type { Store2Session } from '../session'
import type { GcResult } from './pass'

/**
 * The development action that runs one real collector pass on demand and logs what it did. It exists only in a measurement
 * build: `maintenance.ts` calls `installGcMeasure` only under `if (MEASURE)`, so a normal build folds the call away and
 * drops this module and the global name with it. Unlike the sweep dry run it deletes: the pass is `gcPass` itself, on the
 * page's own backend, and it refuses to start without `confirm: true`.
 *
 * Use: in the console of a store2 page, `await __risuGcNow.run({ confirm: true })`.
 *
 * The page may not be doing anything else that the pass could cut across, so the action refuses, with nothing deleted,
 * unless all of these hold:
 *
 * - the page runs on store2 with a backend (a read-only session has none);
 * - no data action is registered (an export, an import, a backup load or another clean-up);
 * - this page's save loop is not parked on a commit it did not make: a parked page may still hold the only copy of its
 *   own base, and an export of it reads that base's units;
 * - the old-data deletion step is not running;
 * - on a browser page, Web Locks exist and no other tab holds the storage presence lock, which the action then holds
 *   exclusively for the run. A browser page without Web Locks cannot know of another tab, so it refuses.
 *
 * What it cannot know is a peer on another device or a Node page in another process: those must be closed by the person
 * running it.
 */

export type GcMeasureRefusal =
    | 'confirm-required'
    | 'not-store2'
    | 'read-only'
    | 'busy'
    | 'save-loop-parked'
    | 'old-data-deletion'
    | 'no-web-locks'
    | 'other-tab'

export type GcMeasureReport =
    | { status: 'refused', reason: GcMeasureRefusal, detail: string }
    | { status: 'ran', result: GcResult }

/** The hold on the storage presence lock; releasing it also gives back the page's write lock. */
export type GcExclusiveHold = (keepWriteLock?: boolean) => Promise<void>

/** What the live page contributes to a run: the state the action must see unchanged and the locks it takes. */
export interface GcPageFacts {
    pageMode(): string
    isBusy(): boolean
    /** Registers the run as a clean-up action; the returned handle ends it. */
    beginBusy(): BusyHandle
    saveLoopParked(): boolean
    locks: {
        /** Whether Web Locks exist in this browser. */
        supported: boolean
        /** Resolves once this tab's own presence lock has been granted. */
        ready(): Promise<void>
        /** Takes the presence lock exclusively; `null` when another tab holds it or the wait ran out. */
        acquire(timeoutMs: number): Promise<GcExclusiveHold | null>
    }
}

export interface GcMeasureDeps {
    session: Pick<Store2Session, 'kind' | 'backend' | 'idleReason'>
    store: () => Promise<ByteStore>
    /** True while the old-data deletion step runs. */
    deletionActive: () => boolean
    /** Replaces the live page, for tests; production loads the page's modules on the first run. */
    loadPage?: () => Promise<GcPageFacts>
    /** Replaces the pacing timer, for tests. */
    sleep?: (ms: number) => Promise<void>
}

export interface GcMeasureRunOptions {
    confirm?: boolean
}

export interface GcMeasureHandle {
    run(options?: GcMeasureRunOptions): Promise<GcMeasureReport>
}

/** How long the run waits for another tab to let go of the presence lock before it refuses. */
export const OTHER_TAB_WAIT_MS = 1500

/**
 * Whether Web Locks can be used. The page's `locksSupported` tests only for `undefined`, so a falsy `navigator.locks`
 * (`null`) is checked as well: it cannot hold a lock, so it counts as no Web Locks.
 */
export function webLocksAvailable(pageSupported: boolean | undefined, locks: unknown): boolean {
    return pageSupported !== false && !!locks
}

/** The page's own modules, loaded when the action first runs so that installing it costs nothing. */
async function loadLivePage(): Promise<GcPageFacts> {
    const [busy, loop, api] = await Promise.all([
        import('../../../process/memory/busyActions'),
        import('../saveLoop'),
        import('../../../globalApi.svelte'),
    ])
    return {
        pageMode: () => getPageStorageMode().kind,
        isBusy: () => busy.isBusy(),
        beginBusy: () => busy.beginBusy('cleanup'),
        saveLoopParked: () => loop.isSaveLoopParked(),
        locks: {
            supported: webLocksAvailable(api.locksSupported, typeof navigator === 'undefined' ? undefined : navigator.locks),
            ready: () => api.tabPresenceLockAcquired,
            acquire: timeoutMs => api.acquireExclusiveStorageMigrationLock(timeoutMs),
        },
    }
}

function refused(reason: GcMeasureRefusal, detail: string): GcMeasureReport {
    return { status: 'refused', reason, detail }
}

/** Installs the action on `target` and returns it. */
export function installGcMeasure(deps: GcMeasureDeps, target: object = globalThis): GcMeasureHandle {
    const { session } = deps

    const execute = async (options: GcMeasureRunOptions | undefined): Promise<GcMeasureReport> => {
        if (options?.confirm !== true) {
            return refused('confirm-required', 'This deletes. Call run({ confirm: true }) to start a pass.')
        }
        const page = await (deps.loadPage ?? loadLivePage)()
        const { backend } = session
        const web = session.kind !== 'tauri'

        // Every check below is synchronous, and the registration follows them without an await: a second call that
        // started meanwhile finds the first one's registration and refuses.
        if (page.pageMode() !== 'store2') {
            return refused('not-store2', 'This page does not run on store2.')
        }
        if (backend === null) {
            return refused('read-only', 'This page has no store2 backend.')
        }
        if (page.isBusy()) {
            return refused('busy', 'A data action is in progress on this page.')
        }
        if (page.saveLoopParked()) {
            return refused('save-loop-parked', 'This page\'s save loop is parked on a commit it did not make.')
        }
        if (deps.deletionActive()) {
            return refused('old-data-deletion', 'The old-data deletion is running.')
        }
        if (web && !page.locks.supported) {
            return refused('no-web-locks', 'This browser has no Web Locks, so another tab cannot be ruled out.')
        }

        const busy = page.beginBusy()
        let release: GcExclusiveHold | null = null
        try {
            if (web) {
                await page.locks.ready()
                release = await page.locks.acquire(OTHER_TAB_WAIT_MS)
                if (release === null) {
                    return refused('other-tab', 'Another tab holds the storage presence lock.')
                }
            }
            const store = await deps.store()
            const guarded = store.guarded
            const { gcPass } = await import('./pass')
            const result = await gcPass({
                backend,
                kind: session.kind,
                // Read at every attempt: a later unflushed write sets it.
                idleReason: () => session.idleReason,
                probe: session.kind === 'node' && guarded !== undefined ? () => guarded.probe() : undefined,
                pace: batchPaceOf(session.kind, deps.sleep),
            })
            return { status: 'ran', result }
        } finally {
            busy.end()
            await release?.()
        }
    }

    const handle: GcMeasureHandle = {
        run: async options => {
            const report = await execute(options)
            console.log('Collector run:', report)
            return report
        },
    }
    ;(target as { __risuGcNow?: GcMeasureHandle }).__risuGcNow = handle
    return handle
}
