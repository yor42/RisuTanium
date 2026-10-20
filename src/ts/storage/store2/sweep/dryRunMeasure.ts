import type { ByteStore } from '../../store/contract'
import { runSweepDryRun, type SweepDryRunReport, type SweepDryRunSession } from './dryRun'

/**
 * The development action that runs the sweep dry run on demand and logs its report.
 * It exists only in a measurement build: `maintenance.ts` calls `installSweepDryRunMeasure`
 * only under `if (MEASURE)`, so a normal build folds the call away and drops this module
 * and the global name with it. The action reads and writes
 * nothing that persists; see `dryRun.ts`.
 *
 * Use: in the console of a store2 page, `await __risuSweepDryRun.run()`.
 */

/** What the live page contributes to a dry run: the references its resident database holds. */
export interface ResidentSources {
    residentRefs(): Iterable<string>
    writtenThisPage(): Iterable<string>
    residentInlays(ids: readonly string[]): Promise<ReadonlySet<string>>
}

export interface SweepDryRunMeasureDeps {
    session: SweepDryRunSession
    store: () => Promise<ByteStore>
    /** Replaces the live sources, for tests; production loads the page's modules on the first run. */
    loadResident?: () => Promise<ResidentSources>
    now?: () => number
}

export interface SweepDryRunHandle {
    run(): Promise<SweepDryRunReport>
}

/** The page's own modules, loaded when the action first runs so that installing it costs nothing. */
async function loadLiveResident(): Promise<ResidentSources> {
    const [api, database, cleanup] = await Promise.all([
        import('../../../globalApi.svelte'),
        import('../../database.svelte'),
        import('../../../process/files/inlayCleanup'),
    ])
    return {
        residentRefs: () => api.getUncleanablesSync(database.getDatabase()),
        writtenThisPage: () => api.listAssetsWrittenThisPage(),
        residentInlays: async ids => {
            const matcher = new cleanup.IdMatcher(ids)
            const scanner = new cleanup.Scanner(matcher, null)
            const pacer = new cleanup.Pacer()
            await cleanup.walkStrings(database.getDatabase(), text => scanner.scan(text, pacer), pacer)
            const unmentioned = new Set(matcher.remaining())
            return new Set(ids.filter(id => !unmentioned.has(id)))
        },
    }
}

/** Installs the action on `target` and returns it. A second run while one is in progress joins the first. */
export function installSweepDryRunMeasure(deps: SweepDryRunMeasureDeps, target: object = globalThis): SweepDryRunHandle {
    let running: Promise<SweepDryRunReport> | null = null

    const execute = async (): Promise<SweepDryRunReport> => {
        const resident = await (deps.loadResident ?? loadLiveResident)()
        const report = await runSweepDryRun({
            session: deps.session,
            store: await deps.store(),
            residentRefs: resident.residentRefs,
            writtenThisPage: resident.writtenThisPage,
            residentInlays: resident.residentInlays,
            // The dry run cannot tell whether an unloaded character or a module holds the same ids as the resident database, so
            // an id of any other shape stays out of the would-delete list.
            isOwnerResident: () => false,
            now: deps.now,
        })
        console.log('Sweep dry run (nothing was deleted or written):', report)
        return report
    }

    const handle: SweepDryRunHandle = {
        run: () => {
            running ??= execute().finally(() => {
                running = null
            })
            return running
        },
    }
    ;(target as { __risuSweepDryRun?: SweepDryRunHandle }).__risuSweepDryRun = handle
    return handle
}
