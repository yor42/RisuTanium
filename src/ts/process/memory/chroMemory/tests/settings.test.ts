import { describe, expect, test } from 'vitest'
import { BUDGET_CAP_TOKENS, LORE_RECALL_CAP_DEFAULT, SEARCH_LORE_DEFAULT, budgetInputValue, defaultBudgetTokens, loreRecallCapInputValue, normalizeBudgetInput, readLtmSettings, writeLtmSettings } from '../settings'

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
            expect(readLtmSettings(raw, 8192), JSON.stringify(raw)).toEqual({ budgetTokens: fallback, shadow: false, searchLore: SEARCH_LORE_DEFAULT, loreRecallCap: LORE_RECALL_CAP_DEFAULT })
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

describe('readLtmSettings lore recall (T19)', () => {
    test('new rule: searchLore reads only a boolean; anything else is the default', () => {
        expect(SEARCH_LORE_DEFAULT).toBe(false)
        expect(readLtmSettings({ searchLore: true }, 8192).searchLore).toBe(true)
        expect(readLtmSettings({ searchLore: false }, 8192).searchLore).toBe(false)
        for (const v of ['true', 1, null, undefined, {}, [], 'yes', 0]) {
            expect(readLtmSettings({ searchLore: v }, 8192).searchLore, String(v)).toBe(SEARCH_LORE_DEFAULT)
        }
        expect(readLtmSettings({}, 8192).searchLore).toBe(SEARCH_LORE_DEFAULT)
    })

    test('new rule: loreRecallCap reads only a positive integer; anything else is 5000', () => {
        expect(LORE_RECALL_CAP_DEFAULT).toBe(5000)
        expect(readLtmSettings({ loreRecallCap: 1234 }, 8192).loreRecallCap).toBe(1234)
        for (const v of [0, -1, 2.5, '5000', NaN, Infinity, null, undefined, true]) {
            expect(readLtmSettings({ loreRecallCap: v }, 8192).loreRecallCap, String(v)).toBe(5000)
        }
    })

    test('new rule: unknown keys are kept and nothing is written back', () => {
        const raw = { searchLore: 'x', loreRecallCap: 0, future: { a: [1] } }
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

    test('T19: searchLore and loreRecallCap are written, unknown keys stay, and a null cap removes the key', () => {
        const db: { ltmSettings?: unknown } = { ltmSettings: { budgetTokens: 900, future: 1 } }
        writeLtmSettings(db, { searchLore: true, loreRecallCap: 1234 })
        expect(db.ltmSettings).toEqual({ budgetTokens: 900, future: 1, searchLore: true, loreRecallCap: 1234 })
        writeLtmSettings(db, { searchLore: false })
        expect(db.ltmSettings).toEqual({ budgetTokens: 900, future: 1, searchLore: false, loreRecallCap: 1234 })
        writeLtmSettings(db, { loreRecallCap: null })
        expect(db.ltmSettings).toEqual({ budgetTokens: 900, future: 1, searchLore: false })
        expect('loreRecallCap' in (db.ltmSettings as object)).toBe(false)
        const bare: { ltmSettings?: unknown } = { ltmSettings: 'garbage' }
        writeLtmSettings(bare, { loreRecallCap: null })
        expect(bare.ltmSettings).toEqual({})
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

describe('loreRecallCapInputValue', () => {
    test('shows the stored cap only when it is a positive integer, else blank', () => {
        expect(loreRecallCapInputValue({ loreRecallCap: 1234, budgetTokens: 5 })).toBe(1234)
        for (const v of [0, -1, 2.5, '5000', null, undefined]) {
            expect(loreRecallCapInputValue({ loreRecallCap: v }), String(v)).toBeNull()
        }
        for (const raw of [undefined, null, 'x', [], 7]) expect(loreRecallCapInputValue(raw), JSON.stringify(raw)).toBeNull()
    })
})
