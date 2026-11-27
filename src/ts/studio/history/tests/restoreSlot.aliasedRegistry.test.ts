// The restore slot over the real registry plus the synthetic alias rows `lowLevelAccessFix` and `utilityBotFix`: the
// later row of a holder property is the slot of every path on it, for the real `bias` pair and the synthetic pairs
// alike, and the alias rule holds for the rows.
import { describe, expect, test, vi } from 'vitest'
import { restoreSlotOf } from '../fieldAccess'
import { ALIAS_FACTS, BASE, FIX, UTILITY_FIX, aliasGroups, aliasRuleViolations } from './aliasRegistry.test-helpers'

vi.mock('../fieldRegistry', async (importOriginal) => {
    const { withAliasRows } = await import('./aliasRegistry.test-helpers')
    return withAliasRows(await importOriginal<typeof import('../fieldRegistry')>())
})

describe('restoreSlotOf over the aliased registry', () => {
    test('T4: the later alias is the slot of both paths, and other paths stay their own slot', () => {
        expect(restoreSlotOf(BASE)).toBe(FIX)
        expect(restoreSlotOf(FIX)).toBe(FIX)
        expect(restoreSlotOf('utilityBot')).toBe(UTILITY_FIX)
        expect(restoreSlotOf(UTILITY_FIX)).toBe(UTILITY_FIX)
        expect(restoreSlotOf('bias')).toBe('biasFix')
        expect(restoreSlotOf('biasFix')).toBe('biasFix')
        expect(restoreSlotOf('moduleLowLevelAccess')).toBe('moduleLowLevelAccess')
        expect(restoreSlotOf('desc')).toBe('desc')
    })

    test('T4: the alias groups are the two fixture pairs plus the real bias pair, and the rule holds for them', async () => {
        expect(await aliasGroups()).toEqual([
            [BASE, FIX],
            ['utilityBot', UTILITY_FIX],
            ['bias', 'biasFix'],
        ])
        expect(await aliasRuleViolations()).toEqual([])
    })

    test('T4: the fixture alias rows carry every reading of the base row', () => {
        expect(ALIAS_FACTS.lowLevelAccessFix).toMatchObject({ keepForeign: true, editWhenAbsent: true, absent: 'delete', holders: ['character'] })
    })
})
