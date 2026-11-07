import type { ByteStore } from '../../store/contract'
import type { Store2Session } from '../session'
import { runSweepDryRun, type SweepDryRunReport, type SweepDryRunSession } from './dryRun'
import { measureAssetOrphans, type AssetOrphanOptions, type AssetOrphanReport } from './orphanMeasure'

/**
 * The development action that runs the sweep dry run on demand and logs its report.
 * It exists only in a measurement build: `maintenance.ts` calls `installSweepDryRunMeasure`
 * only under `if (MEASURE)`, so a normal build folds the call away and drops this module
 * and the global name with it. The action reads and writes
 * nothing that persists; see `dryRun.ts`.
 *
 * Use: in the console of a store2 page, `await __risuSweepDryRun.run()`, or
 * `await __risuSweepDryRun.orphans()` for the count and bytes of the assets no manifest refers to
 * (`orphanMeasure.ts`; the same read-only rule, and `{ measureBytes: false }` skips the size pass).
 */

/** What the live page contributes to a dry run: the references its resident database holds. */
export interface ResidentSources {
    residentRefs(): Iterable<string>
    writtenThisPage(): Iterable<string>
    residentInlays(ids: readonly string[]): Promise<ReadonlySet<string>>
}

export interface SweepDryRunMeasureDeps {
    session: SweepDryRunSession & Pick<Store2Session, 'kind'>
    store: () => Promise<ByteStore>
    /** Replaces the live sources, for tests; production loads the page's modules on the first run. */
    loadResident?: () => Promise<ResidentSources>
    now?: () => number
}

export interface SweepDryRunHandle {
    run(): Promise<SweepDryRunReport>
    /** A call made while another is running joins it and gets its report, so its `options` are ignored. */
    orphans(options?: AssetOrphanOptions): Promise<AssetOrphanReport>
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

function errorText(error: unknown): string {
    if (typeof error === 'string') {
        return error
    }
    return String((error as { message?: unknown } | null | undefined)?.message ?? error)
}

/**
 * The stored size of `key` through a zero-length ranged read, so no body crosses the bridge. A missing file answers null; any
 * other rejection propagates, so a failure is never counted as an absent file.
 */
export async function tauriAssetSize(key: string): Promise<number | null> {
    const transport = await import('../../tauriByteTransport')
    try {
        return await transport.statStoredSize(key)
    } catch (error) {
        if (transport.MISSING_FILE_ERROR.test(errorText(error))) {
            return null
        }
        throw error
    }
}

/**
 * The size probe for a session of `kind`: only the Tauri files store on android or desktop, the transports whose reads are
 * ranged (`tauriFilesStore.read` makes the same split). Every other store sizes through its own optional members or `read`.
 */
async function sizeProbeFor(kind: Store2Session['kind']): Promise<typeof tauriAssetSize | undefined> {
    if (kind !== 'tauri') {
        return undefined
    }
    const transport = await import('../../tauriByteTransport')
    return transport.transportKind() === 'other' ? undefined : tauriAssetSize
}

/** Installs the action on `target` and returns it. A second run while one is in progress joins the first. */
export function installSweepDryRunMeasure(deps: SweepDryRunMeasureDeps, target: object = globalThis): SweepDryRunHandle {
    let running: Promise<SweepDryRunReport> | null = null
    let runningOrphans: Promise<AssetOrphanReport> | null = null

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

    const executeOrphans = async (options: AssetOrphanOptions): Promise<AssetOrphanReport> => {
        const resident = await (deps.loadResident ?? loadLiveResident)()
        const report = await measureAssetOrphans({
            session: deps.session,
            store: await deps.store(),
            residentRefs: resident.residentRefs,
            writtenThisPage: resident.writtenThisPage,
            storeKind: deps.session.kind,
            sizeOf: await sizeProbeFor(deps.session.kind),
            ...options,
        })
        console.log('Asset orphan measure (nothing was deleted or written):', report)
        return report
    }

    const handle: SweepDryRunHandle = {
        run: () => {
            running ??= execute().finally(() => {
                running = null
            })
            return running
        },
        orphans: (options = {}) => {
            runningOrphans ??= executeOrphans(options).finally(() => {
                runningOrphans = null
            })
            return runningOrphans
        },
    }
    ;(target as { __risuSweepDryRun?: SweepDryRunHandle }).__risuSweepDryRun = handle
    return handle
}
