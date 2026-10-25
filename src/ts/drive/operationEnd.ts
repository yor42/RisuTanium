import type { SalvageOmittedBlock } from '../storage/risuSave'
import type { BlockedReason } from '../storage/store2/bootActive'
import type { BootImportFinish } from '../storage/store2/legacy/bootImport'
import type { RepairSummary } from '../storage/store2/legacy/importTree'
import type { IncompleteItem } from '../storage/store2/legacy/resolve'
import type { InlayExportResult, InlayLeftOutReason } from './inlayBackupExport'
import type { InlayRestoreResult } from './inlayBackupImport'
import type { Store2ImportRefusal } from './storeImport'

/**
 * What a backup, import, export or restore operation came to, as a returned value for the shell around it. Nothing here
 * is persisted and nothing is displayed from it yet: the shells keep their own alerts, and a later view reads the end.
 *
 * Mapping invariants (a shell sets `outcome`; a library core never does):
 *  - `canceled`: the person declined or the picker was dismissed and no write began. A shell decides this from its own
 *    "a write may have begun" flag, which starts false and is set before the first asset, inlay or unit write of the
 *    pass; from then on no exit maps to `canceled`. Every exit that is not a decline is `nothing-replaced` or another
 *    outcome, and only a decline made before any write is `canceled`.
 *  - `nothing-replaced`: the operation ended without replacing the profile although a write may have begun, or it was
 *    refused before any write for a reason other than the person's own decline. Every refused commit is this: the
 *    compare-and-swap of the commit key did not land.
 *  - `committed`: the profile was replaced (an import landed), or an export finished with nothing omitted.
 *  - `permitted-partial`: an export finished and omitted data the person was told about. Any of assets, oversize, units,
 *    inlays (full backup only: the partial export always leaves inlays out, and that alone does not make it partial) or
 *    old-store entries left unlisted makes it partial; repaired items are not omissions.
 *  - `failed`: the operation ended in an error; an export carries what became of its file (kept, deleted or untouched).
 *  - `unknown`: it cannot be told whether the profile was replaced (an unconfirmed or conflicting commit, a boot
 *    `reclassify`, `blocked` `install-unknown`, an `exit` that is unknown, conflicting or abandoned, and any boot reason
 *    not mapped to `nothing-replaced`).
 *  - Boot `blocked` with `install-failed`, `install-upload-failed`, `install-invalid`, `marker-failed` or
 *    `presence-unknown` is `nothing-replaced`.
 *
 * `target` names what the operation acted on: the file name (or null) for an export and an import, the row label of a
 * restore point, the backup time of a numbered restore as an ISO 8601 string (locale independent).
 */
export type OperationName = 'export' | 'export-partial' | 'import' | 'boot-import' | 'restore-point' | 'restore-numbered'

export type OperationOutcome = 'canceled' | 'nothing-replaced' | 'committed' | 'failed' | 'permitted-partial' | 'unknown'

/** Why an operation ended as it did, where its library core distinguishes a cause. */
export type OperationCause = Store2ImportRefusal | BlockedReason

export interface OperationEnd<D, C extends string = OperationCause> {
    operation: OperationName
    target: string | null
    outcome: OperationOutcome
    cause: C | null
    detail: D
}

// ---- import, boot import and restore ----

/** Where an imported profile came from. `none`: the operation ended before anything was chosen. */
export type ImportSourceFact =
    | { kind: 'none' }
    | { kind: 'file', name: string, size: number, lastModified: number }
    /** A numbered backup (`database/dbbackup-<n>.bin`): `time` is `n`, tenths of a second since the epoch. */
    | { kind: 'numbered', time: number }
    | { kind: 'restore-point', label: string }

/** An asset a restore left out: the store cannot hold its name, or the Node server cannot take a body that large. */
export interface SkippedAssetFact {
    name: string
    reason: 'invalidName' | 'tooLarge'
}

/**
 * What an import or restore knew when it ended. Fields an operation has no notion of keep their empty value (`omitted`
 * empty, `incomplete` empty, the others null). `omitted` is the salvage map of the decoded file, kept after the person
 * confirmed it, not the decoded tree.
 */
export interface ImportFacts {
    source: ImportSourceFact
    /** A Tauri write the device did not confirm is `false`; undefined where the commit does not say. */
    flushed: boolean | undefined
    omitted: ReadonlyMap<string, SalvageOmittedBlock>
    incomplete: readonly IncompleteItem[]
    repair: RepairSummary | null
    /** `written` is counted after the asset pipeline has drained. */
    assets: { written: number, skipped: readonly SkippedAssetFact[] } | null
    inlays: InlayRestoreResult | null
}

export function emptyImportFacts(source: ImportSourceFact = { kind: 'none' }): ImportFacts {
    return { source, flushed: undefined, omitted: new Map(), incomplete: [], repair: null, assets: null, inlays: null }
}

/** The ISO 8601 time of a numbered backup named `time` (tenths of a second). */
export function numberedBackupTarget(time: number): string {
    const when = new Date(time * 100)
    return Number.isNaN(when.getTime()) ? String(time) : when.toISOString()
}

const BOOT_NOTHING_REPLACED: readonly BlockedReason[] = ['install-failed', 'install-upload-failed', 'install-invalid', 'marker-failed', 'presence-unknown']

/** The outcome of a boot import that came to a result the dispatch acts on; any result or reason not named is `unknown`. */
export function outcomeOfBootFinish(result: BootImportFinish): { outcome: 'committed' | 'nothing-replaced' | 'unknown', cause: BlockedReason | null } {
    switch (result.status) {
        case 'installed':
            return { outcome: 'committed', cause: null }
        case 'blocked':
            return { outcome: BOOT_NOTHING_REPLACED.includes(result.reason) ? 'nothing-replaced' : 'unknown', cause: result.reason }
        case 'reclassify':
        case 'exit':
        default:
            return { outcome: 'unknown', cause: null }
    }
}

// ---- export ----

/** What the person chose not to write, or was refused, when an export ended without writing a file. */
export type ExportDeclinedCause = 'incomplete-data-declined' | 'save-dialog-cancelled' | 'partial-explanation-declined' | 'oversize-declined' | 'export-cancelled'

/** What became of the file of an export that failed. */
export type ExportFile = 'untouched' | 'deleted' | 'kept'

/** What a finished export left out. `repaired` is the notice about repaired character ids, not an omission. */
export interface ExportOmitted {
    /** Asset keys that were missing or unreadable. */
    assets: string[]
    /** Items named and left out for being too large for the file. */
    oversize: string[]
    /** Cold storage unit keys that were not in the backup. */
    units: string[]
    inlays: { id: string, reason: InlayLeftOutReason }[]
    oldStoreUnlisted: boolean
    repaired: string | null
}

/** The facts an export end carries. A field the outcome has no notion of is null. */
export interface ExportFacts {
    omitted: ExportOmitted | null
    /** Null for the partial export, which writes no inlays. */
    inlays: InlayExportResult | null
    /** Set when the export failed or was cancelled. */
    file: ExportFile | null
}

/**
 * How an export ended. `saved`: the file was written and closed; `notices` holds the report the person was shown,
 * empty on a plain success, and `omitted` and `inlays` say what the file lacks. `declined`: the person chose not to
 * write it (a prompt answered Cancel, or the Tauri save dialog was cancelled). A web export that was cancelled while
 * it ran is `declined` with cause `export-cancelled`, which also carries the file state: `kept` when a download stream
 * had opened, so the browser may hold an incomplete file and the person was told so; `untouched` otherwise.
 * `failed`: the export threw; the person was told, `cause` is what was thrown and `file` what became of the file.
 */
export type ExportOutcome =
    | { status: 'saved', notices: string[], omitted: ExportOmitted, inlays: InlayExportResult | null }
    | { status: 'declined', cause: Exclude<ExportDeclinedCause, 'export-cancelled'> }
    | { status: 'declined', cause: 'export-cancelled', file: 'untouched' | 'kept' }
    | { status: 'failed', cause: unknown, file: ExportFile }

/** Whether a finished export left out anything the person was told about; the partial export's missing inlays do not count. */
export function exportOmitsData(operation: 'export' | 'export-partial', omitted: ExportOmitted): boolean {
    return omitted.assets.length > 0
        || omitted.oversize.length > 0
        || omitted.units.length > 0
        || (operation === 'export' && omitted.inlays.length > 0)
        || omitted.oldStoreUnlisted
}

/** The end an export outcome maps to (see the mapping invariants above). */
export function endOfExport(operation: 'export' | 'export-partial', outcome: ExportOutcome, target: string | null = null): OperationEnd<ExportFacts, ExportDeclinedCause> {
    switch (outcome.status) {
        case 'declined':
            return { operation, target, outcome: 'canceled', cause: outcome.cause, detail: { omitted: null, inlays: null, file: outcome.cause === 'export-cancelled' ? outcome.file : null } }
        case 'failed':
            return { operation, target, outcome: 'failed', cause: null, detail: { omitted: null, inlays: null, file: outcome.file } }
        case 'saved':
            return {
                operation,
                target,
                outcome: exportOmitsData(operation, outcome.omitted) ? 'permitted-partial' : 'committed',
                cause: null,
                detail: { omitted: outcome.omitted, inlays: outcome.inlays, file: null },
            }
    }
}
