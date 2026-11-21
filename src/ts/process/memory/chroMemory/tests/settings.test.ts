import { describe, expect, test } from 'vitest'
import { BUDGET_CAP_TOKENS, defaultBudgetTokens, readLtmSettings } from '../settings'

describe('defaultBudgetTokens', () => {
    test('new rule: caps at the S0 budget and scales with a small context', () => {
        expect(BUDGET_CAP_TOKENS).toBe(2400)
        expect(defaultBudgetTokens(32768)).toBe(2400)
        expect(defaultBudgetTokens(8192)).toBe(1228)
        expect(defaultBudgetTokens(NaN)).toBe(2400)
        expect(defaultBudgetTokens(0)).toBe(2400)
        expect(defaultBudgetTokens(-5)).toBe(2400)
    })
})

describe('readLtmSettings', () => {
    const fallback = defaultBudgetTokens(8192)

    test('new rule: a bad shape reads as the defaults', () => {
        const bad: unknown[] = [undefined, null, 'x', 7, [], { budgetTokens: '9' }, { budgetTokens: 0 }, { budgetTokens: 1.5 }, { budgetTokens: -3 }, { budgetTokens: NaN }, {}]
        for (const raw of bad) {
            expect(readLtmSettings(raw, 8192), JSON.stringify(raw)).toEqual({ budgetTokens: fallback })
        }
    })

    test('new rule: a valid budget is used and unknown keys survive untouched on the holder', () => {
        const raw = { budgetTokens: 900, future: { a: [1] } }
        const clone = structuredClone(raw)
        const holder = { ltmSettings: raw as unknown }
        expect(readLtmSettings(holder.ltmSettings, 8192).budgetTokens).toBe(900)
        expect(raw).toEqual(clone)
        expect(holder.ltmSettings).toBe(raw)
    })
})
