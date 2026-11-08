// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { assembleDatabase, checkUnit, unitMapSource } from 'src/ts/storage/store2/codec'
import { UNIT_TYPE } from 'src/ts/storage/store2/format'
import { asDatabase, buildSmall, encodeWith, type Obj } from './codecFixtures'

/**
 * `visibleModes` and `hideUnusedModes` are config-root fields (CHORE-584). Neither is in `CONFIG_PARTITIONED_FIELDS`,
 * so the config unit keeps them and the assembled database returns them with no store2 schema change. Guards: both
 * pass with and without the `Database` interface fields.
 */

function withModes(visibleModes: unknown, hideUnusedModes: unknown) {
    return asDatabase({ ...(JSON.parse(JSON.stringify(buildSmall(2))) as Obj), visibleModes, hideUnusedModes })
}

describe('the mode fields in the store2 config unit', () => {
    test('guard: the decoded config body holds both values', () => {
        const tree = encodeWith(withModes(['rp'], true))
        const checked = checkUnit(unitMapSource(tree.units), tree.manifest.fixed.config, UNIT_TYPE.configRoot)
        expect(checked.status).toBe('ok')
        const fields = (checked as unknown as { body: { f: Record<string, unknown> } }).body.f
        expect(fields.visibleModes).toEqual(['rp'])
        expect(fields.hideUnusedModes).toBe(true)
    })

    test.each([
        [['rp'], true],
        [['hybrid', 'utility'], false],
        [['rp', 'hybrid', 'utility'], false],
    ])('guard: encode and assemble return %j and %j', (visible, hidden) => {
        const tree = encodeWith(withModes(visible, hidden))
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as Record<string, unknown>
        expect(assembled.visibleModes).toEqual(visible)
        expect(assembled.hideUnusedModes).toBe(hidden)
    })

    test('guard: a database without the fields assembles without them, so the loader supplies the defaults', () => {
        const tree = encodeWith(buildSmall(2))
        const assembled = assembleDatabase(tree.manifest, unitMapSource(tree.units)) as unknown as Record<string, unknown>
        expect('visibleModes' in assembled).toBe(false)
        expect('hideUnusedModes' in assembled).toBe(false)
    })
})
