import { LEGACY_MAIN_FILE_KEY } from '../../blockKeys'
import type { Store2Backend, Store2Read } from '../backend/types'
import type { BlockedReason } from '../bootActive'
import type { ListDerivation } from '../codec/types'
import type { BuildContext, BuiltCommit } from '../commit'
import { firstLifeInstall, firstLifeInstallStreamed, installBuilt, installStreamed, type BuiltInstall, type FirstLifeGrant, type FirstLifeResult } from '../firstLife'
import { defaultKeyEnv, type CommitKey, type KeyEnv, type LegacyList } from '../format'
import { LegacyListBuilder } from '../lists/legacyList'
import { planOldDataSnapshot, withSnapshot, type OldDataSource } from '../oldData/plan'
import type { ForeignClearHook } from '../owner'
import { runExit, type ExitResult } from '../recovery'
import { withLegacyKeep } from './convert'
import type { ImportHooks, ImportSource, PrepareStop, RepairSummary } from './importTree'
import type { StreamPrepared, StreamSource } from './importStream'
import type { LegacyEntryReader, ResolveOptions } from './resolve'
import type { ColdUnitRead } from './storeReader'

/**
 * The boot-time import of a decoded legacy-shaped tree (a `.bin` the person picked at start-up) into a store that has no
 * `current`: the first-life install of row 1 or a fenced recovery exit. The tree is repaired, resolved, confirmed and
 * planned exactly as the page import does it (`prepareImport`) and installed with the page import's own `build`
 * (`buildImport`), so a boot import and a Settings import produce the same tree.
 *
 * Invariants:
 *  - Nothing is written before every question is answered and the plan exists. The first write is then the marker on the
 *    first-life entry and the fence on the `exit` entry.
 *  - A first-life entry's grant must carry the `import` label: a crashed install then classifies as row 11 (the
 *    recovery screen), never as row 9, whose re-run would seed an empty profile over the backups. The entry never goes
 *    through `runExit`, because `runExit` writes a fence that nothing on the first-life path discards.
 *  - The old upstream files the store still holds are never read here and never deleted: each is listed `unreadable` in
 *    `fixed.legacyKeep`, so a keep set fails safe and the stage 5 asset sweep removes no asset until the old data is
 *    discarded. The deletion snapshot (type 24) is planned from what the store holds, as the conversion plans it.
 *  - The cold-storage units of the old upstream profile are read through the injected reader and never written.
 *  - `installBuiltTree` installs a tree built elsewhere through the same entries, keep list, snapshot and `import` label. Its
 *    `beforeFirstWrite` runs after the keep listing and the snapshot plan, immediately before the installer call. On the
 *    `exit` entry `runExit` can still end with no profile write after it; the fence may have been written.
 *  - The start-up `.rtb` restore (`drive/rtbBootRestore.ts`) is its caller.
 */

export type BootImportEntry =
    | { kind: 'first-life', grant: FirstLifeGrant }
    | { kind: 'exit', commitRead: Store2Read, foreignClear?: ForeignClearHook | null }

export interface BootImportRequest {
    source: ImportSource
    /** Reads the cold-storage units the tree's pointers name. */
    reader: LegacyEntryReader
    backend: Store2Backend
    entry: BootImportEntry
    /** The marker's owner. */
    owner: string
    lists: ListDerivation
    env?: KeyEnv
    resolve?: ResolveOptions
    /** The store the old upstream files are listed in; they are listed, never read. */
    oldData: OldDataSource
    /** Whether the upstream main file exists, including one the store cannot hand out as bytes. */
    upstreamMainFile: () => Promise<boolean>
}

export type BootImportResult =
    | { status: 'installed', manifestKey: string, value: CommitKey, flushed: boolean | undefined, repair: RepairSummary }
    | PrepareStop
    /** The marker or the final write did not land and the store may have moved: classify the boot again. */
    | { status: 'reclassify' }
    | { status: 'blocked', reason: BlockedReason, detail: string }
    /** An `exit` entry only: the fenced exit did not end `marked`. Every question was answered first. */
    | { status: 'exit', exit: Exclude<ExitResult, { status: 'marked' }> }

/** A boot import that wrote nothing or came to a result the dispatch acts on; the questions and refusals have been shown. */
export type BootImportFinish = Extract<BootImportResult, { status: 'installed' | 'reclassify' | 'blocked' | 'exit' }>

export type BootImportEnd =
    /** The person backed out, or a refusal was shown: nothing was written and the boot asks again. */
    | { kind: 'cancelled' }
    | { kind: 'finished', result: BootImportFinish }

/**
 * What the dispatch hands the page's file flow for a boot `.bin` import: the installer over the boot's session, backend
 * and entry, and the page's reader of the old upstream cold units. The flow reads the picked file's cold entries lazily
 * and never writes a cold-storage unit, because the import target is a boot, not a residency.
 */
export interface BootImportTarget {
    install(source: ImportSource, reader: LegacyEntryReader, hooks: ImportHooks): Promise<BootImportResult>
    /**
     * The streamed counterpart of `install`, in two steps. `prepareStream` is the dry pass over the file (nothing is
     * written): 'whole' for a file the whole path must take, a stop before any write, or what `installStream` must
     * reproduce. `installStream` is the install over a second read of the file, the units uploaded as they are encoded.
     * A target without them takes every file through `install`.
     */
    prepareStream?(input: BootStreamInput, reader: LegacyEntryReader, hooks: ImportHooks): Promise<'whole' | PrepareStop | StreamPrepared>
    installStream?(input: BootStreamInput, prepared: StreamPrepared, reader: LegacyEntryReader, hooks: ImportHooks): Promise<BootImportResult>
    /** Answers an id the file holds no accepted entry for: the old upstream unit the store still holds. */
    readColdStorageItem: (key: string) => Promise<ColdUnitRead>
    /**
     * Installs a tree built elsewhere over the same entry, keep list, snapshot and `import` label; optional so `.bin` test
     * doubles need not provide it. Its result `reclassify` also comes from a first-life marker that ended `conflict`,
     * `abandoned`, `unknown` or was refused with `store-not-empty`, and from an install that ended `abandoned`, not only
     * from a throw: a caller must not treat `reclassify` as proof of a throw.
     */
    installBuiltTree?(request: BootBuiltRequest): Promise<BootBuiltResult>
}

/** A tree built outside this module for the boot installer, and the check that runs immediately before the installer call. */
export interface BootBuiltRequest {
    newUnits: number
    build(context: BuildContext): BuiltCommit | Promise<BuiltCommit>
    /**
     * Asked once, after the keep listing and the snapshot plan and immediately before the entry's installer call. `false`:
     * nothing is written. After `true` on the `exit` entry the installer (`runExit`) can still end with no profile write; the
     * fence may have been written.
     */
    beforeFirstWrite(): Promise<boolean>
}

export type BootBuiltOutcome = BootImportFinish | { status: 'not-started' }

/** `entry` tells the caller a first-life end from an exit end. */
export interface BootBuiltResult { entry: BootImportEntry['kind'], outcome: BootBuiltOutcome }

/** The file of a streamed boot import and how it yields. */
export interface BootStreamInput {
    stream: StreamSource
    yieldToMain: () => Promise<void>
}

function backupKey(time: number): string {
    return `database/dbbackup-${time}.bin`
}

export type OldFilesKeep =
    | { status: 'list', list: LegacyList }
    /** The store holds no old upstream file. */
    | { status: 'none' }
    | { status: 'blocked', reason: BlockedReason, detail: string }

/** The keep list of the old upstream files the store holds, each `unreadable`. */
export async function listOldFilesUnreadable(
    request: Pick<BootImportRequest, 'oldData' | 'upstreamMainFile'>,
): Promise<OldFilesKeep> {
    const builder = new LegacyListBuilder()
    let any = false
    try {
        if (await request.upstreamMainFile()) {
            builder.addUnreadable(LEGACY_MAIN_FILE_KEY)
            any = true
        }
    } catch (error) {
        return { status: 'blocked', reason: 'main-file-unknown', detail: error instanceof Error ? error.message : String(error) }
    }
    let times: number[]
    try {
        times = await request.oldData.listBackupTimes()
    } catch (error) {
        return { status: 'blocked', reason: 'backups-unlistable', detail: error instanceof Error ? error.message : String(error) }
    }
    for (const time of times) {
        builder.addUnreadable(backupKey(time))
        any = true
    }
    return any ? { status: 'list', list: builder.build() } : { status: 'none' }
}

/** A marker that did not land: a peer moved first or the write may have landed (classify again), or the write failed. */
function resultOfMarker(marker: Extract<FirstLifeResult, { status: 'not-marked' }>['marker']): BootImportFinish {
    switch (marker.status) {
        case 'conflict':
        case 'abandoned':
        case 'unknown':
            return { status: 'reclassify' }
        case 'refused':
            return marker.reason === 'store-not-empty'
                ? { status: 'reclassify' }
                : { status: 'blocked', reason: 'presence-unknown', detail: 'The store2 listing failed before the import marker was written.' }
        case 'failed':
            return { status: 'blocked', reason: 'marker-failed', detail: marker.cause.message }
    }
}

function resultOfInstall(result: FirstLifeResult, repair: RepairSummary): BootImportFinish {
    switch (result.status) {
        case 'installed':
            return { status: 'installed', manifestKey: result.manifestKey, value: result.value, flushed: result.flushed, repair }
        case 'abandoned':
            return { status: 'reclassify' }
        case 'not-marked':
            return resultOfMarker(result.marker)
        case 'unknown':
            return { status: 'blocked', reason: 'install-unknown', detail: result.cause.message }
        case 'invalid':
            return { status: 'blocked', reason: 'install-invalid', detail: result.problem.kind }
        case 'upload-failed':
        case 'failed':
            return { status: 'blocked', reason: `install-${result.status}`, detail: result.cause.message }
    }
}

/** The installer a file flow is handed: everything of the request but the picked tree and its reader. */
export function createBootImportTarget(
    base: Omit<BootImportRequest, 'source' | 'reader'>, readColdStorageItem: BootImportTarget['readColdStorageItem'],
): BootImportTarget {
    return {
        readColdStorageItem,
        install: (source, reader, hooks) => bootImportLegacyTree({ ...base, source, reader }, hooks),
        async prepareStream(input, reader, hooks) {
            // Loaded on first use, like `importTree`: a boot that never imports a file does not need the stream.
            const { prepareImportStream } = await import('./importStream')
            return prepareImportStream({ ...input, reader, lists: base.lists, env: base.env, resolve: base.resolve }, hooks)
        },
        installStream: (input, prepared, reader, hooks) => bootImportStreamed({ ...base, ...input, reader, prepared }, hooks),
        installBuiltTree: (built) => installBuiltTreeOn(base, built),
    }
}

/** The boot's own copy of importTree.ts's `notePhase`, which this module cannot import statically: an observer never decides the import. */
function notePhase(hooks: ImportHooks, phase: string): void {
    try {
        hooks.onPhase?.(phase)
    } catch {
        // An observer that fails is ignored.
    }
}

export async function bootImportLegacyTree(request: BootImportRequest, hooks: ImportHooks): Promise<BootImportResult> {
    if (request.entry.kind === 'first-life' && request.entry.grant.label !== 'import') {
        throw new TypeError('A boot import installs under a grant labelled import.')
    }
    // Loaded on first use: the tree repairs behind `importTree` pull in the app's page code, which a boot that never imports does not need.
    const { buildImport, prepareImport } = await import('./importTree')
    const prepared = await prepareImport(request, hooks)
    if ('status' in prepared) {
        return prepared
    }
    // Both vehicles take this one `build` object: the page commit builds the same tree with `keep.base`.
    const built = buildImport(prepared.plan)
    return installOnEntry(request, { ...built, convertedFrom: 'import' }, prepared.repair, { onCommitStart: () => notePhase(hooks, 'import commit start') })
}

/** What the shared tail needs of a boot import request: the store, the entry and the old files to keep. */
type TailRequest = Pick<BootImportRequest, 'backend' | 'entry' | 'owner' | 'env' | 'oldData' | 'upstreamMainFile'>

interface TailOptions {
    /** Asked once, after the keep listing and the snapshot plan and immediately before the installer call; `false` writes nothing. */
    beforeFirstWrite?: () => Promise<boolean>
    /** Called immediately before the installer call, never when the keep listing is blocked or the gate refused. */
    onCommitStart?: () => void
}

/**
 * The tail every boot install shares: the keep list of the old files, the deletion snapshot, then the entry's installer
 * (`firstLifeInstall`, or `runExit` and `installBuilt`). With `beforeFirstWrite` the outcome can also be `not-started`.
 * A throw from the gate or from the installer propagates to the caller.
 */
async function installOnEntry(request: TailRequest, install: BuiltInstall, repair: RepairSummary, options: { onCommitStart?: () => void }): Promise<BootImportFinish>
async function installOnEntry(request: TailRequest, install: BuiltInstall, repair: RepairSummary, options: TailOptions & { beforeFirstWrite: () => Promise<boolean> }): Promise<BootBuiltOutcome>
async function installOnEntry(request: TailRequest, install: BuiltInstall, repair: RepairSummary, options: TailOptions): Promise<BootBuiltOutcome> {
    const keep = await listOldFilesUnreadable(request)
    if (keep.status === 'blocked') {
        return keep
    }
    const snapshot = await planOldDataSnapshot(request.oldData, null)
    const wrapped = withSnapshot(keep.status === 'none' ? install : withLegacyKeep(install, keep.list), snapshot)
    if (options.beforeFirstWrite !== undefined && !(await options.beforeFirstWrite())) {
        return { status: 'not-started' }
    }
    options.onCommitStart?.()
    const env: KeyEnv = { ...defaultKeyEnv, ...request.env }
    if (request.entry.kind === 'first-life') {
        return resultOfInstall(await firstLifeInstall(request.backend, request.entry.grant, wrapped, { owner: request.owner, env }), repair)
    }
    const exit = await runExit(request.backend, request.entry.commitRead, { kind: 'import' }, { owner: request.owner, env, foreignClear: request.entry.foreignClear })
    if (exit.status !== 'marked') {
        return { status: 'exit', exit }
    }
    return resultOfInstall(await installBuilt({ backend: request.backend, env, marked: exit }, wrapped), repair)
}

/** The summary of a tree that no repair touched: the shape of `summarizeRepair([])`. */
const NO_REPAIR: RepairSummary = { dropped: 0, changed: 0, recovered: 0 }

async function installBuiltTreeOn(request: Omit<BootImportRequest, 'source' | 'reader'>, built: BootBuiltRequest): Promise<BootBuiltResult> {
    if (request.entry.kind === 'first-life' && request.entry.grant.label !== 'import') {
        throw new TypeError('A boot install of a built tree runs under a grant labelled import.')
    }
    const outcome = await installOnEntry(request, { newUnits: built.newUnits, build: built.build, convertedFrom: 'import' }, NO_REPAIR, { beforeFirstWrite: built.beforeFirstWrite })
    return { entry: request.entry.kind, outcome }
}

export interface BootStreamRequest extends Omit<BootImportRequest, 'source'>, BootStreamInput {
    /** What the dry pass of `prepareImportStream` learned; the install reads the file again and must reproduce it. */
    prepared: StreamPrepared
}

/**
 * `bootImportLegacyTree` for a file the dry pass (`prepareImportStream`) accepted: the same steps after the prepare (the
 * keep list of the old files, the page import's own build, the snapshot, `convertedFrom: 'import'`, the same installer
 * entries), with the characters uploaded as the file is read. A failed upload is the result `blocked` as in the whole
 * path; any other throw of the build (the file changed, a unit could not be read) leaves the marker standing and
 * surfaces as `Store2InstallAbortError`.
 */
export async function bootImportStreamed(request: BootStreamRequest, hooks: ImportHooks): Promise<BootImportResult> {
    if (request.entry.kind === 'first-life' && request.entry.grant.label !== 'import') {
        throw new TypeError('A boot import installs under a grant labelled import.')
    }
    const { buildImport } = await import('./importTree')
    const { streamedImportUnits } = await import('./importStream')
    const keep = await listOldFilesUnreadable(request)
    if (keep.status === 'blocked') {
        return keep
    }
    const units = streamedImportUnits(request.prepared, {
        stream: request.stream, yieldToMain: request.yieldToMain, reader: request.reader, lists: request.lists, env: request.env, resolve: request.resolve,
    }, hooks)
    const base: BuiltInstall = { ...buildImport(units), convertedFrom: 'import' }
    const snapshot = await planOldDataSnapshot(request.oldData, null)
    const install = withSnapshot(keep.status === 'none' ? base : withLegacyKeep(base, keep.list), snapshot)
    const env: KeyEnv = { ...defaultKeyEnv, ...request.env }
    if (request.entry.kind === 'first-life') {
        return resultOfInstall(await firstLifeInstallStreamed(request.backend, request.entry.grant, install, { owner: request.owner, env }), request.prepared.repair)
    }
    const exit = await runExit(request.backend, request.entry.commitRead, { kind: 'import' }, { owner: request.owner, env, foreignClear: request.entry.foreignClear })
    if (exit.status !== 'marked') {
        return { status: 'exit', exit }
    }
    return resultOfInstall(await installStreamed({ backend: request.backend, env, marked: exit }, install), request.prepared.repair)
}
