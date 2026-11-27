// The restore slot of a registry path over the real registry. The character token bias pair is the only alias: `biasFix`
// shares its holder property with `bias` and is the slot of both; every other path is its own slot. The alias rule is
// checked here on the real rows so a later row that adds an alias must obey it.
import { describe, expect, test } from 'vitest'
import { propertyOf, registryPaths, restoreSlotOf } from '../fieldAccess'
import { noteRestoreWrites } from '../historyModel'
import type { SetPath } from '../fieldRegistry'
import { aliasGroups, aliasRuleViolations } from './aliasRegistry.test-helpers'

describe('restoreSlotOf over the real registry', () => {
    test('T2: the fix row is the slot of bias, and every other path is its own slot, including the module rows over the same property names', () => {
        for (const path of registryPaths()) {
            expect(restoreSlotOf(path), path).toBe(path === 'bias' ? 'biasFix' : path)
        }
        expect(restoreSlotOf('biasFix')).toBe('biasFix')
        expect(propertyOf('moduleLowLevelAccess')).toBe('lowLevelAccess')
        expect(restoreSlotOf('lowLevelAccess')).toBe('lowLevelAccess')
        expect(restoreSlotOf('moduleLowLevelAccess')).toBe('moduleLowLevelAccess')
        expect(restoreSlotOf('moduleName')).toBe('moduleName')
    })

    test('T3: paths that share a holder property obey the alias rule, and the group is exactly the bias pair', async () => {
        expect(await aliasGroups()).toEqual([['bias', 'biasFix']])
        expect(await aliasRuleViolations()).toEqual([])
    })

    test('T10 (compatibility guard): a base write on the real registry records the entry a main build stored', () => {
        const point = noteRestoreWrites(
            null,
            'v',
            1,
            [{ path: 'lowLevelAccess', before: { had: true, value: false }, after: { had: true, value: true } }],
            true,
        )
        expect(point).toEqual({
            visitId: 'v',
            at: 1,
            fields: { lowLevelAccess: { before: { had: true, value: false }, last: { had: true, value: true } } },
        })
    })
})
