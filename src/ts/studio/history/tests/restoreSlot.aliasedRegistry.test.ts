// The restore slot over the real registry plus one synthetic alias row over `hideChatIcon`: the later row of a holder
// property is the slot of every path on it, for the real fix rows (the risky flags and the token bias list) and the synthetic one alike, and the alias rule holds.
import { describe, expect, test, vi } from 'vitest'
import { restoreSlotOf } from '../fieldAccess'
import { ALIAS_FACTS, BASE, FIX, SYNTH_ALIAS, SYNTH_BASE, UTILITY_FIX, aliasGroups, aliasRuleViolations } from './aliasRegistry.test-helpers'

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
        expect(restoreSlotOf(SYNTH_BASE)).toBe(SYNTH_ALIAS)
        expect(restoreSlotOf(SYNTH_ALIAS)).toBe(SYNTH_ALIAS)
        expect(restoreSlotOf('bias')).toBe('biasFix')
        expect(restoreSlotOf('biasFix')).toBe('biasFix')
        expect(restoreSlotOf('moduleLowLevelAccess')).toBe('moduleLowLevelAccess')
        expect(restoreSlotOf('desc')).toBe('desc')
    })

    test('T4: the alias groups are the four real pairs plus the synthetic pair, and the rule holds for them', async () => {
        expect(await aliasGroups()).toEqual([
            [SYNTH_BASE, SYNTH_ALIAS],
            [BASE, FIX],
            ['utilityBot', UTILITY_FIX],
            ['escapeOutput', 'escapeOutputFix'],
            ['bias', 'biasFix'],
        ])
        expect(await aliasRuleViolations()).toEqual([])
    })

    test('T4: the synthetic alias row carries every reading of the base row', () => {
        expect(ALIAS_FACTS.hideChatIconAlias).toMatchObject({ keepForeign: true, editWhenAbsent: true, absent: 'delete', holders: ['character'] })
    })
})
