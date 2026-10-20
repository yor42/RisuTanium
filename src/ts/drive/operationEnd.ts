import type { BlockedReason } from '../storage/store2/bootActive'
import type { Store2ImportRefusal } from './storeImport'

/**
 * What a backup, import, export or restore operation came to, as a returned value for the shell around it. Nothing here
 * is persisted and nothing is displayed from it yet: the shells keep their own alerts, and a later view reads the end.
 *
 * Mapping invariants (a shell sets `outcome`; a library core never does):
 *  - `canceled`: the person declined or the picker was dismissed and no write began. A shell decides this from its own
 *    "a write may have begun" flag, which defaults to "began"; once any asset, inlay or unit write may have started, no
 *    exit maps to `canceled`.
 *  - `nothing-replaced`: the operation ended without replacing the profile although a write may have begun. Every
 *    refused commit is this: the compare-and-swap of the commit key did not land.
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
 * restore point, the backup time of a numbered restore.
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
