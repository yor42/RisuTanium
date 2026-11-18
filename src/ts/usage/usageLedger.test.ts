import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../storage/blockFrame'
import {
    hasUsageData, isUsageKey, localMonth, MAX_MODEL_LABEL, parseUsageKey, readUsage, recordUsage, usageCarryOf, USAGE_KEY_CAP,
    usageKey, withPageUsage, withoutUsageKeys,
} from './usageLedger'
import type { UsageEntry } from './usageTypes'

/** Compatibility guards on a new module (no pre-change base); the mutant kills in the S3 report back them. */

const NOW = new Date(2026, 5, 15, 12, 0, 0)

const reportedEntry = (modelKey = 'gpt-test', purpose: UsageEntry['purpose'] = 'chat'): UsageEntry => ({
    modelKey,
    purpose,
    reported: { input: 10, output: 20, cacheRead: 3, cacheWrite: 0 },
    estimated: null,
})

describe('recordUsage keys (T9)', () => {
    test('one reported attempt writes exactly the golden key set; a zero counter is not written', () => {
        const statics: JsonObject = { messages: 7, imports: 2 }
        recordUsage(statics, reportedEntry(), NOW)
        expect(statics).toEqual({
            messages: 7,
            imports: 2,
            'u1|2026-06|chat|n|gpt-test': 1,
            'u1|2026-06|chat|i|gpt-test': 10,
            'u1|2026-06|chat|o|gpt-test': 20,
            'u1|2026-06|chat|cr|gpt-test': 3,
        })
    })

    test('an estimated attempt writes ei/eo and never i/o', () => {
        const statics: JsonObject = {}
        recordUsage(statics, { modelKey: 'm', purpose: 'utility', reported: null, estimated: { input: 4, output: 9 } }, NOW)
        expect(statics).toEqual({ 'u1|2026-06|utility|n|m': 1, 'u1|2026-06|utility|ei|m': 4, 'u1|2026-06|utility|eo|m': 9 })
    })

    test('a second record increments the same keys', () => {
        const statics: JsonObject = {}
        recordUsage(statics, reportedEntry(), NOW)
        recordUsage(statics, reportedEntry(), NOW)
        expect(statics['u1|2026-06|chat|n|gpt-test']).toBe(2)
        expect(statics['u1|2026-06|chat|o|gpt-test']).toBe(40)
    })

    test('the month is the local calendar month', () => {
        expect(localMonth(new Date(2026, 0, 31, 23, 59))).toBe('2026-01')
        expect(localMonth(new Date(2026, 11, 1, 0, 0))).toBe('2026-12')
    })

    test('a `|` in the model label round-trips through the key', () => {
        const statics: JsonObject = {}
        recordUsage(statics, reportedEntry('a|b|c'), NOW)
        const { rows } = readUsage(statics)
        expect(rows.map((row) => row.model)).toEqual(['a|b|c', 'a|b|c', 'a|b|c', 'a|b|c'])
        expect(parseUsageKey('u1|2026-06|chat|n|a|b|c')).toEqual({ overflow: false, month: '2026-06', purpose: 'chat', counter: 'n', model: 'a|b|c' })
    })

    test('a model label longer than the limit is cut to it', () => {
        const statics: JsonObject = {}
        recordUsage(statics, reportedEntry('x'.repeat(MAX_MODEL_LABEL + 50)), NOW)
        for (const key of Object.keys(statics)) {
            expect(key.split('|')[4]).toHaveLength(MAX_MODEL_LABEL)
        }
    })

    test('messages and imports are never touched; a non-object statics is a no-op', () => {
        const statics: JsonObject = { messages: 7, imports: 2 }
        recordUsage(statics, reportedEntry(), NOW)
        expect(statics.messages).toBe(7)
        expect(statics.imports).toBe(2)
        expect(() => recordUsage(null, reportedEntry(), NOW)).not.toThrow()
        expect(() => recordUsage([1], reportedEntry(), NOW)).not.toThrow()
        expect(() => recordUsage('x', reportedEntry(), NOW)).not.toThrow()
    })
})

describe('readers and foreign keys (T9)', () => {
    test('u2 and malformed keys are ignored by readUsage and kept by recordUsage', () => {
        const statics: JsonObject = {
            messages: 1, imports: 0,
            'u2|2026-06|chat|n|m': 5,
            'u1|bad': 9,
            'u1|2026-06|chat|zz|m': 9,
            'u1|2026-6|chat|n|m': 9,
        }
        recordUsage(statics, reportedEntry('m'), NOW)
        const { rows, overflow } = readUsage(statics)
        expect(rows.every((row) => row.model === 'm' && row.month === '2026-06')).toBe(true)
        expect(rows.map((row) => row.counter).sort()).toEqual(['cr', 'i', 'n', 'o'])
        expect(overflow).toEqual({})
        expect(statics['u2|2026-06|chat|n|m']).toBe(5)
        expect(statics['u1|bad']).toBe(9)
        expect(statics['u1|2026-06|chat|zz|m']).toBe(9)
    })

    test('a non-number value is kept and its increment goes to overflow', () => {
        const statics: JsonObject = { 'u1|2026-06|chat|n|gpt-test': 'oops' }
        recordUsage(statics, reportedEntry(), NOW)
        expect(statics['u1|2026-06|chat|n|gpt-test']).toBe('oops')
        expect(statics['u1|ovf|n']).toBe(1)
        expect(statics['u1|2026-06|chat|i|gpt-test']).toBe(10)
    })

    test('a non-finite or negative number value is not a number the ledger increments', () => {
        const statics: JsonObject = { 'u1|2026-06|chat|n|gpt-test': -4 }
        recordUsage(statics, reportedEntry(), NOW)
        expect(statics['u1|2026-06|chat|n|gpt-test']).toBe(-4)
        expect(statics['u1|ovf|n']).toBe(1)
    })

    test('readUsage ignores a non-number value and a non-object statics', () => {
        expect(readUsage({ 'u1|2026-06|chat|n|m': 'x' }).rows).toEqual([])
        expect(readUsage(undefined)).toEqual({ rows: [], overflow: {} })
    })
})

describe('the cap and overflow (T9)', () => {
    function atCap(): JsonObject {
        const statics: JsonObject = { messages: 1, imports: 1 }
        for (let i = 0; i < USAGE_KEY_CAP; i++) {
            statics[usageKey('2026-01', 'chat', 'n', `m${i}`)] = 1
        }
        return statics
    }

    test('a new combination at the cap goes to overflow while existing keys keep counting', () => {
        const statics = atCap()
        recordUsage(statics, reportedEntry('brand-new'), NOW)
        expect(statics['u1|ovf|n']).toBe(1)
        expect(statics['u1|ovf|i']).toBe(10)
        expect(statics['u1|2026-06|chat|n|brand-new']).toBeUndefined()
        recordUsage(statics, { ...reportedEntry('m5'), purpose: 'chat' }, new Date(2026, 0, 3))
        expect(statics['u1|2026-01|chat|n|m5']).toBe(2)
        recordUsage(statics, reportedEntry('brand-new'), NOW)
        expect(statics['u1|ovf|n']).toBe(2)
    })

    test('overflow keys are outside the cap: below the cap a new key is created normally', () => {
        const statics = atCap()
        delete statics[usageKey('2026-01', 'chat', 'n', 'm0')]
        statics['u1|ovf|n'] = 5
        recordUsage(statics, { modelKey: 'fresh', purpose: 'chat', reported: null, estimated: null }, NOW)
        expect(statics['u1|2026-06|chat|n|fresh']).toBe(1)
        expect(statics['u1|ovf|n']).toBe(5)
    })

    test('an overflow key that holds a non-number drops the increment and is not overwritten', () => {
        const statics = atCap()
        statics['u1|ovf|n'] = 'oops'
        statics['u1|ovf|i'] = 4
        recordUsage(statics, reportedEntry('brand-new'), NOW)
        expect(statics['u1|ovf|n']).toBe('oops')
        expect(statics['u1|ovf|i']).toBe(14)
    })

    test('overflow is read back as overflow, not as a row', () => {
        const statics = atCap()
        recordUsage(statics, reportedEntry('brand-new'), NOW)
        const { rows, overflow } = readUsage(statics)
        expect(rows).toHaveLength(USAGE_KEY_CAP)
        expect(overflow).toEqual({ n: 1, i: 10, o: 20, cr: 3 })
    })

    test('messages and imports are unchanged at the cap', () => {
        const statics = atCap()
        recordUsage(statics, reportedEntry('brand-new'), NOW)
        expect(statics.messages).toBe(1)
        expect(statics.imports).toBe(1)
    })
})

describe('key predicates and helpers', () => {
    test('isUsageKey matches every version and nothing else', () => {
        expect(isUsageKey('u1|2026-06|chat|n|m')).toBe(true)
        expect(isUsageKey('u2|anything')).toBe(true)
        expect(isUsageKey('u12|x')).toBe(true)
        expect(isUsageKey('messages')).toBe(false)
        expect(isUsageKey('imports')).toBe(false)
        expect(isUsageKey('u1')).toBe(false)
        expect(isUsageKey('xu1|a')).toBe(false)
    })

    test('withoutUsageKeys returns a new object and never mutates', () => {
        const statics = { messages: 2, imports: 1, 'u1|2026-06|chat|n|m': 3, 'u2|x': 1 }
        const copy = withoutUsageKeys(statics)
        expect(copy).toEqual({ messages: 2, imports: 1 })
        expect(copy).not.toBe(statics)
        expect(Object.keys(statics)).toHaveLength(4)
    })

    test('hasUsageData is true for any usage key or a non-empty override map, false otherwise', () => {
        expect(hasUsageData({ statics: { messages: 1, imports: 0 } })).toBe(false)
        expect(hasUsageData({ statics: { messages: 1, imports: 0, 'u1|2026-06|chat|n|m': 1 } })).toBe(true)
        expect(hasUsageData({ statics: { 'u2|x': 1 } })).toBe(true)
        expect(hasUsageData({ statics: {}, usagePriceOverrides: {} })).toBe(false)
        expect(hasUsageData({ statics: {}, usagePriceOverrides: { m: { input: '1' } } })).toBe(true)
        expect(hasUsageData({})).toBe(false)
    })
})

describe('the import overlay helpers (T27)', () => {
    const pageStatics: JsonObject = { messages: 99, imports: 98, 'u1|2026-06|chat|n|m': 4, 'u1|2026-06|chat|o|m': 'odd' }

    test('usageCarryOf takes the usage keys only, values as they are, and the overrides only when non-empty', () => {
        const carry = usageCarryOf(pageStatics, { m: { input: '2' } })
        expect(carry.usageStatics).toEqual({ 'u1|2026-06|chat|n|m': 4, 'u1|2026-06|chat|o|m': 'odd' })
        expect(carry.usagePriceOverrides).toEqual({ m: { input: '2' } })
    })

    test('usageCarryOf gives nothing for a page without usage', () => {
        expect(usageCarryOf({ messages: 1, imports: 0 }, {})).toEqual({})
        expect(usageCarryOf(undefined, undefined)).toEqual({})
        expect(usageCarryOf([1], 'x')).toEqual({})
    })

    test('withPageUsage: the file keeps its non-usage keys, the page adds its usage keys, the file usage keys are dropped', () => {
        const file: JsonObject = { messages: 3, imports: 2, 'u1|2026-01|chat|n|f': 9, 'u2|z': 1 }
        const carry = usageCarryOf(pageStatics, undefined).usageStatics
        expect(withPageUsage(file, carry)).toEqual({ messages: 3, imports: 2, 'u1|2026-06|chat|n|m': 4, 'u1|2026-06|chat|o|m': 'odd' })
    })

    test('withPageUsage without a carry still drops the file usage keys', () => {
        const file: JsonObject = { messages: 3, imports: 2, 'u1|2026-01|chat|n|f': 9 }
        expect(withPageUsage(file, undefined)).toEqual({ messages: 3, imports: 2 })
        expect(withPageUsage(file, {})).toEqual({ messages: 3, imports: 2 })
    })

    test('withPageUsage with an absent or non-object file statics and a carry gives the defaults plus the carry', () => {
        const carry = usageCarryOf(pageStatics, undefined).usageStatics
        const expected = { messages: 0, imports: 0, 'u1|2026-06|chat|n|m': 4, 'u1|2026-06|chat|o|m': 'odd' }
        expect(withPageUsage(undefined, carry)).toEqual(expected)
        expect(withPageUsage('broken', carry)).toEqual(expected)
        expect(withPageUsage([1, 2], carry)).toEqual(expected)
        expect(withPageUsage(null, carry)).toEqual(expected)
    })

    test('withPageUsage returns the same reference when neither side has usage', () => {
        const file: JsonObject = { messages: 3, imports: 2 }
        expect(withPageUsage(file, undefined)).toBe(file)
        expect(withPageUsage(undefined, undefined)).toBeUndefined()
        expect(withPageUsage('broken', undefined)).toBe('broken')
    })
})
