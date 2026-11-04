// @vitest-environment node
/**
 * Drift guard of the manifest descent tables. The test walkers share TEST_DESCENT;
 * the three production walks (the tree read, the commit's tree check and the
 * recovery pick) each keep their own table. A parent position that one of them
 * loses, or a new one the walkers do not open, makes this guard fail instead of
 * leaving a unit unmarked, unchecked or unwalked.
 */
import { describe, expect, test } from 'vitest'
import { DESCENT } from '../../store2/commit'
import { REFS_TABLE, UNIT_TYPE, UNITS_WITHOUT_REFS, type UnitType } from '../../store2/format'
import { PATH_TYPES } from '../../store2/recoveryPick'
import { TREE_READ_TYPES } from '../../store2/tree'
import { TEST_DESCENT, TEST_PARENT_TYPES } from './descentTable'

const MANIFEST_PATHS: ReadonlySet<string> = new Set(
    REFS_TABLE.filter(row => row.type === UNIT_TYPE.manifest).map(row => row.path),
)

/** The positions of `table` that are manifest positions and name a unit type that itself names further units. */
function parentPositions(table: Readonly<Record<string, UnitType>>): [string, UnitType][] {
    return Object.entries(table)
        .filter(([path, type]) => MANIFEST_PATHS.has(path) && !UNITS_WITHOUT_REFS.includes(type))
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
}

const EXPECTED = parentPositions(TEST_DESCENT)

describe('descent tables', () => {
    test('guard: the test table holds the four parent positions of a manifest', () => {
        expect(EXPECTED).toEqual([
            ['fixed.moduleBuckets[]', UNIT_TYPE.moduleBucket],
            ['fixed.moduleIndex', UNIT_TYPE.moduleIndex],
            ['fixed.pluginStorage.refs[]', UNIT_TYPE.pluginStorageBucket],
            ['shards[]', UNIT_TYPE.shard],
        ])
        expect(Object.keys(TEST_DESCENT)).toHaveLength(EXPECTED.length)
    })

    test('guard: the production tree-read table has the same parent positions as the test table', () => {
        expect(parentPositions(TREE_READ_TYPES)).toEqual(EXPECTED)
    })

    test('guard: the production commit descent table has the same parent positions as the test table', () => {
        expect(parentPositions(DESCENT)).toEqual(EXPECTED)
    })

    test('guard: the production recovery path table has the same parent positions as the test table', () => {
        expect(parentPositions(PATH_TYPES)).toEqual(EXPECTED)
    })

    test('guard: the test parent types are the manifest and every type of the test table, and the types that hold refs other than the commit key', () => {
        expect([...TEST_PARENT_TYPES].sort((a, b) => a - b)).toEqual([
            UNIT_TYPE.manifest, UNIT_TYPE.shard, UNIT_TYPE.moduleIndex, UNIT_TYPE.moduleBucket, UNIT_TYPE.pluginStorageBucket,
        ].sort((a, b) => a - b))
        const holdingRefs = new Set(REFS_TABLE.map(row => row.type))
        holdingRefs.delete(UNIT_TYPE.commit)
        expect([...TEST_PARENT_TYPES].sort((a, b) => a - b)).toEqual([...holdingRefs].sort((a, b) => a - b))
    })
})
