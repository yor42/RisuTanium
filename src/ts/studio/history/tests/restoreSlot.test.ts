// The restore slot of a registry path over the real registry. The three risky-flag fix rows and `biasFix` are the only aliases:
// each shares its holder property with its base row and is the slot of both; every other path is its own slot. The alias
// rule is checked here on the real rows so a later row that adds an alias must obey it.
import { describe, expect, test } from 'vitest'
import { propertyOf, registryPaths, restoreSlotOf } from '../fieldAccess'
import { noteRestoreWrites } from '../historyModel'
import type { SetPath } from '../fieldRegistry'
import { aliasGroups, aliasRuleViolations } from './aliasRegistry.test-helpers'

describe('restoreSlotOf over the real registry', () => {
    test('T2: the fix row is the slot of its base row, and every other path is its own slot, including the module rows over the same property names', () => {
        const slots: Record<string, string> = {
            lowLevelAccess: 'lowLevelAccessFix',
            utilityBot: 'utilityBotFix',
            escapeOutput: 'escapeOutputFix',
            bias: 'biasFix',
        }
        for (const path of registryPaths()) {
            expect(restoreSlotOf(path), path).toBe(slots[path] ?? path)
        }
        expect(restoreSlotOf('biasFix')).toBe('biasFix')
        expect(propertyOf('moduleLowLevelAccess')).toBe('lowLevelAccess')
        expect(restoreSlotOf('lowLevelAccessFix')).toBe('lowLevelAccessFix')
        expect(restoreSlotOf('moduleLowLevelAccess')).toBe('moduleLowLevelAccess')
        expect(restoreSlotOf('moduleName')).toBe('moduleName')
    })

    test('T3: paths that share a holder property obey the alias rule, and the groups are exactly the three flag pairs and the bias pair', async () => {
        expect(await aliasGroups()).toEqual([
            ['lowLevelAccess', 'lowLevelAccessFix'],
            ['utilityBot', 'utilityBotFix'],
            ['escapeOutput', 'escapeOutputFix'],
            ['bias', 'biasFix'],
        ])
        expect(await aliasRuleViolations()).toEqual([])
    })

    test('T10: a base write on the real registry records its entry under the fix slot', () => {
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
            fields: { lowLevelAccessFix: { before: { had: true, value: false }, last: { had: true, value: true } } },
        })
    })
})
