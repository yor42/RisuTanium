import { LEGACY_MAIN_FILE_KEY } from '../../blockKeys'
import type { Store2Backend, Store2Read } from '../backend/types'
import type { BlockedReason } from '../bootActive'
import type { ListDerivation } from '../codec/types'
import { firstLifeInstall, installBuilt, type BuiltInstall, type FirstLifeGrant, type FirstLifeResult } from '../firstLife'
import { defaultKeyEnv, type KeyEnv, type LegacyList } from '../format'
import { LegacyListBuilder } from '../lists/legacyList'
import { planOldDataSnapshot, withSnapshot, type OldDataSource } from '../oldData/plan'
import type { ForeignClearHook } from '../owner'
import { runExit, type ExitResult } from '../recovery'
import { withLegacyKeep } from './convert'
import type { ImportHooks, ImportSource, PrepareStop, RepairSummary } from './importTree'
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
    | { status: 'installed', manifestKey: string, flushed: boolean | undefined, repair: RepairSummary }
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
    /** Answers an id the file holds no accepted entry for: the old upstream unit the store still holds. */
    readColdStorageItem: (key: string) => Promise<ColdUnitRead>
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
function resultOfMarker(marker: Extract<FirstLifeResult, { status: 'not-marked' }>['marker']): BootImportResult {
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

function resultOfInstall(result: FirstLifeResult, repair: RepairSummary): BootImportResult {
    switch (result.status) {
        case 'installed':
            return { status: 'installed', manifestKey: result.manifestKey, flushed: result.flushed, repair }
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
    const keep = await listOldFilesUnreadable(request)
    if (keep.status === 'blocked') {
        return keep
    }
    // Both vehicles take this one `build` object: the page commit builds the same tree with `keep.base`.
    const built = buildImport(prepared.plan)
    const base: BuiltInstall = { ...built, convertedFrom: 'import' }
    const snapshot = await planOldDataSnapshot(request.oldData, null)
    const install = withSnapshot(keep.status === 'none' ? base : withLegacyKeep(base, keep.list), snapshot)
    const env: KeyEnv = { ...defaultKeyEnv, ...request.env }
    if (request.entry.kind === 'first-life') {
        return resultOfInstall(await firstLifeInstall(request.backend, request.entry.grant, install, { owner: request.owner, env }), prepared.repair)
    }
    const exit = await runExit(request.backend, request.entry.commitRead, { kind: 'import' }, { owner: request.owner, env, foreignClear: request.entry.foreignClear })
    if (exit.status !== 'marked') {
        return { status: 'exit', exit }
    }
    return resultOfInstall(await installBuilt({ backend: request.backend, env, marked: exit }, install), prepared.repair)
}
