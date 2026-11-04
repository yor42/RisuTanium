import { UNIT_TYPE, type UnitType } from '../../store2/format'

/**
 * The manifest positions whose unit names further units, which every test walker
 * (the commit invariant, the replay checker, the recovery closure and the live
 * server observer) must open. One table for all of them, written by hand and
 * independent of the production tables: a walker that shared a production table
 * would stop checking the unit that table lost. `descentTable.test.ts` compares the
 * three production tables against it.
 */
export const TEST_DESCENT: Readonly<Record<string, UnitType>> = {
    'shards[]': UNIT_TYPE.shard,
    'fixed.moduleIndex': UNIT_TYPE.moduleIndex,
    'fixed.moduleBuckets[]': UNIT_TYPE.moduleBucket,
    'fixed.pluginStorage.refs[]': UNIT_TYPE.pluginStorageBucket,
}

/** The unit types whose bodies name further units: the manifest and every type `TEST_DESCENT` descends into. */
export const TEST_PARENT_TYPES: ReadonlySet<UnitType> = new Set<UnitType>([UNIT_TYPE.manifest, ...Object.values(TEST_DESCENT)])
