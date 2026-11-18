/**
 * The `.rtb` export (CHORE-128 S8): save first, then one streamed write of the units, the side data, the
 * inlays and the assets, then the manifest. It writes nothing to any store.
 *
 * Contracts:
 *  - Refusals (a read-only, non-store2 or session-less page) run before anything registers busy, opens a
 *    writer or saves.
 *  - Every store2 unit read of the walk happens while this export's busy entry is registered, and before the
 *    first `s/`, `i/` or `a/` entry is written. The automatic collection pass neither starts nor continues
 *    past a batch while busy, so the walk never reads a unit a pass removed.
 *  - `saveFirst` completes before the walk starts and before the file's clock is read; whether the page was
 *    fully saved is read after it.
 *  - `saved` is reported only after the writer's `close()` resolved. After a cancel or a failure the writer is
 *    never closed; the S7 shell reports what became of the file. The walk's promise always settles before the
 *    export returns, so nothing keeps running inside the busy entry.
 *  - Secrets in side data stay plaintext until the encryption stage (MC-687 item 6).
 */
import { withBusy } from '../process/memory/busyActions'
import { getDatabase, appVer } from '../storage/database.svelte'
import { getPageStorageMode, type PageStorageMode } from '../storage/pageStorageMode'
import { getAppStore, getAppStoreKind, pageStoreIsOpfsTransitional } from '../storage/store/appStore'
import type { ByteStore } from '../storage/store/contract'
import type { Store2Backend } from '../storage/store2/backend/types'
import { getStore2BootSession } from '../storage/store2/bootActive'
import type { Committer } from '../storage/store2/commit'
import type { KeyEnv } from '../storage/store2/format/keys'
import { exportClosure, type ExportClosure } from '../storage/store2/rtb/exportClosure'
import type { ReferencedNotice } from '../storage/store2/rtb/referencedSet'
import { assetBatchWriteMode, isAssetBatchReadAvailable, listAssetsSized, readAssetBatch } from '../storage/tauriAssetBatch'
import { ANDROID_EXPORT_PIECE_BYTES, ANDROID_PIECE_SOURCE, exportAssetPieceSource, exportTauriPieceSource, nodeAssetPieceSource } from './assetPieces'
import { moduleCommitVerdict, isSaveClean, type LocalWriter } from '../globalApi.svelte'
import { legacyInlayStore, listAppInlayKeys, withInlayLock } from '../process/files/inlayStore'
import { ensureGestureForWriter, runExport, type ExportSession } from './exportShell'
import { openInlay } from './inlayBackupExport'
import type { ExportOmitted, ExportOutcome } from './operationEnd'
import { CoalescingSink } from './rtb/coalescingSink'
import type { OmittedEntry } from './rtb/manifest'
import { writeRtb, type RtbWriteResult, type SideInput } from './rtb/rtbWriter'
import { defaultSideBackends, readSideStores, type SideBackends } from './rtb/sideStores'
import { RTB_SIDE_TAGS } from './rtb/sideTags'
import { createUnitBridge } from './rtb/unitBridge'
import {
    livePlatform, openRtbWriter, rtbAssetInputs, rtbBackupFileName, rtbInlayInputs,
    type RtbAssetDeps, type RtbExportProgress, type RtbInlayDeps, type RtbPlatform, type RtbSectionContext,
} from './rtbExportSources'
import { saveFirst, SAVE_FIRST_BOUND_MS } from './storeRestore'

export type { RtbExportProgress } from './rtbExportSources'

export interface RtbExportOptions {
    onProgress?: (event: RtbExportProgress) => void
    /**
     * The text the run's wait dialog shows for each progress event, in event order. Without it the run shows no wait
     * dialog, and so, on the web, offers no Cancel: the dialog is what carries the Cancel of the S7 shell's gate.
     */
    progressText?: (event: RtbExportProgress) => string
    /** The suggested name; `local-YYYYMMDD.rtb` of the device's local date when absent. */
    fileName?: string
}

export interface RtbExportDeps {
    pageMode(): PageStorageMode
    /** Must not reject: a failed store selection is not "read-only". */
    opfsTransitional(): Promise<boolean>
    session(): { committer: Committer | null, backend: Store2Backend | null } | null
    openWriter(session: ExportSession, fileName: string): Promise<LocalWriter | null>
    saveFirst(): Promise<void>
    isSaveClean(): boolean
    /** The commit verdict of each module of the page. */
    moduleVerdicts(): Array<'saved' | 'unsavable' | 'blocked'>
    store(): Promise<ByteStore>
    sideBackends: SideBackends
    assets: RtbAssetDeps
    inlays: RtbInlayDeps
    writerInfo: { app: string, version: string, build: string }
    platform(): RtbPlatform
    clock(): number
    keyEnv?: KeyEnv
    /** Tests only: runs between two unit batches, inside the walk. */
    afterUnitBatch?: () => Promise<void>
}

export type RtbExportRefusal = 'read-only' | 'not-store2' | 'no-session'

export interface RtbExportReport {
    fileName: string
    length: number
    snapshotId: string
    createdAt: number
    committedAt: number
    unsavedExcluded: boolean
    /** Exactly the manifest's list. */
    omitted: OmittedEntry[]
    referencedNotices: ReferencedNotice[]
    oldInlayStoreUnlisted: boolean
    counts: { units: number, inlays: number, assets: number }
}

export type RtbExportResult =
    | { status: 'refused', reason: RtbExportRefusal }
    /** `report` is set only when the outcome is `saved`. */
    | { status: 'ended', outcome: ExportOutcome, report: RtbExportReport | null }

async function refusalOf(deps: RtbExportDeps): Promise<RtbExportRefusal | null> {
    if (await deps.opfsTransitional()) {
        return 'read-only'
    }
    const mode = deps.pageMode()
    if (mode.kind === 'read-only') {
        return 'read-only'
    }
    if (mode.kind !== 'store2') {
        return 'not-store2'
    }
    const session = deps.session()
    if (session === null || session.committer === null || session.backend === null) {
        return 'no-session'
    }
    return null
}

/**
 * Why the page would refuse an export now, without opening, saving or registering anything: the same check, in the
 * same order, as the first step of `runRtbExportGuarded`. A caller that asks before it prompts uses this.
 */
export async function rtbExportRefusal(deps: RtbExportDeps = liveRtbExportDeps()): Promise<RtbExportRefusal | null> {
    return await refusalOf(deps)
}

/** A side input whose first pull announces its section and checks for a cancel. */
function announcedSide(id: string, input: SideInput, context: RtbSectionContext): SideInput {
    if ('unreadable' in input) {
        return input
    }
    const records = input.records
    return {
        records: (async function* () {
            context.cancel.throwIfCancelled()
            context.onProgress({ phase: 'side', section: id })
            yield* records
        })(),
    }
}

function namesOf(omitted: readonly OmittedEntry[], kind: string): string[] {
    return omitted.filter((entry) => entry.kind === kind).map((entry) => entry.name)
}

function rowEntries(result: RtbWriteResult, id: string): number {
    return result.manifest.sections.find((row) => row.id === id)?.entries ?? 0
}

async function writeExport(deps: RtbExportDeps, options: RtbExportOptions, session: ExportSession, backend: Store2Backend, holder: { report: RtbExportReport | null }): Promise<ExportOutcome> {
    const emit = (event: RtbExportProgress): void => {
        options.onProgress?.(event)
        if (options.progressText !== undefined) {
            session.gate.wait(options.progressText(event))
        }
    }
    const fileName = options.fileName ?? rtbBackupFileName(new Date(deps.clock()))

    emit({ phase: 'opening' })
    session.cancel.throwIfCancelled()
    await ensureGestureForWriter(session)
    const writer = await deps.openWriter(session, fileName)
    // A cancel that came while the writer opened has already aborted it; nothing else of the export may run.
    session.cancel.throwIfCancelled()
    if (writer === null) {
        return { status: 'declined', cause: 'save-dialog-cancelled' }
    }
    session.writer = writer

    emit({ phase: 'saving' })
    await deps.saveFirst()
    session.cancel.throwIfCancelled()
    const unsavedExcluded = !deps.isSaveClean() || deps.moduleVerdicts().some((verdict) => verdict !== 'saved')

    const store = await deps.store()
    const sides = await readSideStores(deps.sideBackends)
    const context: RtbSectionContext = { cancel: session.cancel, lateOmitted: [], onProgress: emit }
    const platform = deps.platform()
    const inlayState = { oldStoreUnlisted: false, unsupported: [] as string[] }

    const walk: { closure: ExportClosure | null, promise: Promise<void> | null, units: number } = { closure: null, promise: null, units: 0 }
    const bridge = createUnitBridge(() => {
        walk.promise = exportClosure(backend, {
            onUnits: async (batch) => {
                walk.units += batch.length
                await bridge.push(batch)
            },
            yield: async () => {
                session.cancel.throwIfCancelled()
                emit({ phase: 'units', units: walk.units })
                await deps.afterUnitBatch?.()
                // A cancel that came while the batch was handled stops the walk before it reads another one.
                session.cancel.throwIfCancelled()
            },
        }).then(
            (closure) => {
                walk.closure = closure
                bridge.end()
            },
            (error: unknown) => {
                bridge.fail(error)
            },
        )
    })
    const walked = (): ExportClosure => {
        if (walk.closure === null) {
            throw new Error('The unit walk had not finished when its result was needed.')
        }
        return walk.closure
    }

    async function* inlays() {
        yield* rtbInlayInputs(store, deps.inlays, walked().referenced.inlays, inlayState, context)
    }
    async function* assets() {
        yield* rtbAssetInputs(store, deps.assets, walked().referenced.assets, context)
    }

    const sink = new CoalescingSink((chunk) => writer.write(chunk))
    let result: RtbWriteResult
    try {
        result = await writeRtb({
            sink,
            writer: deps.writerInfo,
            clock: deps.clock,
            keyEnv: deps.keyEnv,
            store2: {
                units: bridge.iterable,
                summary: () => {
                    const closure = walked()
                    const [tail, bytes, crc] = closure.root
                    return {
                        root: [tail, bytes, crc],
                        req: closure.req,
                        refs: closure.refRows,
                        units: closure.units,
                        omitted: closure.omitted.map(({ kind, name, reason }) => ({ kind, name, reason })),
                    }
                },
            },
            late: () => ({
                source: { device: { label: platform.label, platform: platform.platform }, committedAt: walked().committedAt, unsavedExcluded },
                omitted: [...context.lateOmitted],
            }),
            sides: Object.fromEntries(Object.entries(sides).map(([id, input]) => [id, announcedSide(id, input, context)])),
            sideTags: RTB_SIDE_TAGS,
            inlays: inlays(),
            assets: assets(),
        })
    } finally {
        bridge.abort()
        await walk.promise
    }

    emit({ phase: 'finishing' })
    await sink.flush()
    await writer.close()

    const closure = walked()
    const manifestOmitted = result.manifest.omitted
    const leftOutInlays = manifestOmitted
        .filter((entry) => entry.kind === 'inlay')
        .map((entry) => ({ id: entry.name, reason: inlayState.unsupported.includes(entry.name) ? 'unsupported' as const : 'unreadable' as const }))
    const omitted: ExportOmitted = {
        assets: namesOf(manifestOmitted, 'asset'),
        oversize: [],
        units: namesOf(manifestOmitted, 'unit'),
        inlays: leftOutInlays,
        oldStoreUnlisted: inlayState.oldStoreUnlisted,
        repaired: null,
    }
    holder.report = {
        fileName,
        length: result.length,
        snapshotId: result.snapshotId,
        createdAt: result.createdAt,
        committedAt: closure.committedAt,
        unsavedExcluded,
        omitted: [...manifestOmitted],
        referencedNotices: closure.referenced.notices,
        oldInlayStoreUnlisted: inlayState.oldStoreUnlisted,
        // Writer v1 writes two entries per inlay (`i/*.meta` and `i/*.body`).
        counts: { units: closure.units, inlays: rowEntries(result, 'inlays') / 2, assets: rowEntries(result, 'assets') },
    }
    return {
        status: 'saved',
        notices: [],
        suggestedName: fileName,
        omitted,
        inlays: { exported: rowEntries(result, 'inlays') / 2, leftOut: leftOutInlays, oldStoreUnlisted: inlayState.oldStoreUnlisted },
    }
}

/**
 * The guarded export: refusals, then the busy entry, then the S7 shell around the core. `withBusy` and `runExport`
 * are the production ones, so a test of this function exercises the real busy registry and shell.
 */
export async function runRtbExportGuarded(deps: RtbExportDeps, options: RtbExportOptions = {}): Promise<RtbExportResult> {
    const reason = await refusalOf(deps)
    if (reason !== null) {
        return { status: 'refused', reason }
    }
    const backend = deps.session()?.backend
    if (backend === null || backend === undefined) {
        return { status: 'refused', reason: 'no-session' }
    }
    const holder: { report: RtbExportReport | null } = { report: null }
    const outcome = await withBusy('backupSave', () => runExport((session) => writeExport(deps, options, session, backend, holder)))
    return { status: 'ended', outcome, report: outcome.status === 'saved' ? holder.report : null }
}

const ANDROID_EXPORT_READER_LIMITS = { budgetBytes: 8 * 1024 * 1024, maxFlights: 2 }

async function assetBatchReadUsable(): Promise<boolean> {
    if (!isAssetBatchReadAvailable()) {
        return false
    }
    try {
        return await getAppStoreKind() === 'tauri'
    } catch {
        return false
    }
}

export function liveRtbExportDeps(): RtbExportDeps {
    return {
        pageMode: getPageStorageMode,
        opfsTransitional: async () => {
            try {
                return await pageStoreIsOpfsTransitional()
            } catch {
                return false
            }
        },
        session: getStore2BootSession,
        openWriter: openRtbWriter,
        saveFirst: () => saveFirst(SAVE_FIRST_BOUND_MS),
        isSaveClean,
        moduleVerdicts: () => (getDatabase().modules ?? []).map((module) => moduleCommitVerdict(module.id)),
        store: getAppStore,
        sideBackends: defaultSideBackends,
        assets: {
            listSized: async () => {
                if (!await assetBatchReadUsable()) {
                    return null
                }
                try {
                    return await listAssetsSized()
                } catch (error) {
                    console.error(error)
                    return null
                }
            },
            readBatch: (keys) => readAssetBatch(keys),
            readerLimits: assetBatchWriteMode() === 'b64' ? ANDROID_EXPORT_READER_LIMITS : {},
            pieceSource: exportAssetPieceSource,
        },
        inlays: {
            legacyKeys: () => legacyInlayStore.keys(),
            appIds: async (store) => (await listAppInlayKeys(store)).ids,
            open: openInlay,
            withLock: withInlayLock,
            options: async () => {
                const tauri = await exportTauriPieceSource()
                const node = tauri === null ? await nodeAssetPieceSource() : null
                return {
                    streaming: tauri !== null,
                    openPieces: node?.open,
                    pieceBytes: tauri === ANDROID_PIECE_SOURCE ? ANDROID_EXPORT_PIECE_BYTES : undefined,
                }
            },
        },
        writerInfo: { app: 'risutanium', version: appVer, build: import.meta.env.MODE },
        platform: livePlatform,
        clock: Date.now,
    }
}

export function exportRtb(options: RtbExportOptions = {}): Promise<RtbExportResult> {
    return runRtbExportGuarded(liveRtbExportDeps(), options)
}
