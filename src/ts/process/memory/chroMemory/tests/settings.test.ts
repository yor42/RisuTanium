import { describe, expect, test } from 'vitest'
import { BUDGET_CAP_TOKENS, budgetInputValue, defaultBudgetTokens, normalizeBudgetInput, readLtmSettings, writeLtmSettings } from '../settings'

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
            expect(readLtmSettings(raw, 8192), JSON.stringify(raw)).toEqual({ budgetTokens: fallback, shadow: false })
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
describe('readLtmSettings shadow', () => {
    test('ST1: only the boolean true reads as shadow; other shapes read false and the input is not mutated', () => {
        expect(readLtmSettings({ shadow: true }, 8192).shadow).toBe(true)
        const others: unknown[] = [{}, { shadow: false }, { shadow: 'yes' }, { shadow: 1 }, { shadow: null }, [], [true], null, undefined, 'shadow', 5]
        for (const raw of others) {
            expect(readLtmSettings(raw, 8192).shadow, JSON.stringify(raw)).toBe(false)
        }
        const raw = { shadow: 'yes', future: 1 }
        const clone = structuredClone(raw)
        readLtmSettings(raw, 8192)
        expect(raw).toEqual(clone)
    })
})

describe('budget input helpers', () => {
    test('normalizeBudgetInput and budgetInputValue accept only positive integers', () => {
        expect(normalizeBudgetInput(900)).toBe(900)
        for (const v of [0, -1, 1.5, NaN, '5', null, undefined, Infinity]) expect(normalizeBudgetInput(v), String(v)).toBeNull()
        expect(budgetInputValue({ budgetTokens: 700 })).toBe(700)
        for (const raw of [{ budgetTokens: 0 }, { budgetTokens: 2.5 }, {}, [], null, 'x', undefined]) expect(budgetInputValue(raw), JSON.stringify(raw)).toBeNull()
    })
})

describe('writeLtmSettings', () => {
    test('ST2: an object keeps every unknown key (nested too) and is replaced, not mutated', () => {
        const old = { budgetTokens: 900, future: { x: [1, { y: 2 }] } }
        const snapshot = structuredClone(old)
        const db: { ltmSettings?: unknown } = { ltmSettings: old }
        writeLtmSettings(db, { shadow: true })
        expect(db.ltmSettings).toEqual({ budgetTokens: 900, future: { x: [1, { y: 2 }] }, shadow: true })
        expect(db.ltmSettings).not.toBe(old)
        expect(old).toEqual(snapshot)
        writeLtmSettings(db, { budgetTokens: 1200 })
        expect(db.ltmSettings).toEqual({ budgetTokens: 1200, future: { x: [1, { y: 2 }] }, shadow: true })
    })

    test('ST2: budgetTokens null removes the key and writes no null', () => {
        const db: { ltmSettings?: unknown } = { ltmSettings: { budgetTokens: 900, shadow: false, future: 1 } }
        writeLtmSettings(db, { budgetTokens: null })
        expect(db.ltmSettings).toEqual({ shadow: false, future: 1 })
        expect('budgetTokens' in (db.ltmSettings as object)).toBe(false)
    })

    test('ST2: a value that is not an object is replaced by the patch alone', () => {
        for (const bad of ['garbage', 7, null, undefined, [1, 2]]) {
            const db: { ltmSettings?: unknown } = { ltmSettings: bad }
            writeLtmSettings(db, { shadow: true, budgetTokens: 500 })
            expect(db.ltmSettings, JSON.stringify(bad)).toEqual({ shadow: true, budgetTokens: 500 })
        }
        const db: { ltmSettings?: unknown } = { ltmSettings: 'garbage' }
        writeLtmSettings(db, { budgetTokens: null })
        expect(db.ltmSettings).toEqual({})
    })
})
