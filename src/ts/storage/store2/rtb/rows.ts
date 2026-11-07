import { REFS_TABLE, UNIT_TYPE, type RefRow, type UnitType } from '../format'

/**
 * The reference positions a `.rtb` export walks and a restore rewrites.
 *
 * `WALK_TABLE` is the one schema table (`REFS_TABLE`) without the commit key's rows and without the old-file keep list
 * (`fixed.legacyKeep.unit`): the export never ships a commit key, and the keep list belongs to the device that restores
 * the file, so the unit it names is neither exported nor visited. A position `REFS_TABLE` gains is walked here without a
 * second list.
 */

/** The id of a row as the manifest's `meta.refs` and the notices spell it: `<parent type decimal>:<path>`. */
export function rowId(row: { type: number, path: string }): string {
    return `${row.type}:${row.path}`
}

/** The old-file keep list's row, which a walk never visits. */
const KEEP_ROW_ID = rowId({ type: UNIT_TYPE.manifest, path: 'fixed.legacyKeep.unit' })

export const WALK_TABLE: readonly RefRow[] = REFS_TABLE.filter(row =>
    row.type !== UNIT_TYPE.commit && rowId(row) !== KEEP_ROW_ID)

/**
 * The rows at which a damaged (or absent) unit is left out of the file and named instead of failing the export: the task
 * presets of the manifest and the chat alternatives of a shard. The store's own boot drops a unit at exactly these two
 * positions and flags it; every other position holds data the file cannot do without.
 */
export const O3_ROWS: readonly string[] = [
    rowId({ type: UNIT_TYPE.manifest, path: 'fixed.taskPresets[]' }),
    rowId({ type: UNIT_TYPE.shard, path: 'entries[].chats[].alt[]' }),
]

/** The unit types whose bodies name further units: a walk parses these and descends, and copies every other type as bytes. */
export const WALK_PARENT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([
    UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.moduleBucket, UNIT_TYPE.pluginStorageBucket,
])
