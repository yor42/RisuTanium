import { describe, expect, test } from 'vitest'
import { recordUsage, retentionCutoff, retentionMonthsOf, USAGE_KEY_CAP, withoutClearedUsage } from './usageLedger'
import type { UsageEntry } from './usageTypes'

/**
 * Pure clear and retention rules over ledgers built by the real producer (`recordUsage`). Labels: (G) guards over new
 * functions, backed by the scratch mutants listed in the ticket plan.
 */

const entry = (modelKey = 'm1', purpose: UsageEntry['purpose'] = 'chat'): UsageEntry => ({
    modelKey,
    purpose,
    reported: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
    estimated: null,
})

const JUNE = new Date(2026, 5, 15)
const JULY = new Date(2026, 6, 2)
const AUGUST = new Date(2026, 7, 9)

function ledger(...months: Date[]): Record<string, unknown> {
    const statics: Record<string, unknown> = { messages: 7, imports: 2, s: 1 }
    for (const when of months) {
        recordUsage(statics, entry(), when)
    }
    return statics
}

/** A ledger filled to the cap, so the next new combination goes to the overflow keys. */
function ledgerWithOverflow(...months: Date[]): Record<string, unknown> {
    const statics = ledger(...months)
    for (let i = 0; Object.keys(statics).filter((key) => key.startsWith('u1|2')).length < USAGE_KEY_CAP; i++) {
        recordUsage(statics, entry(`fill-${i}`, 'utility'), AUGUST)
    }
    recordUsage(statics, entry('over', 'utility'), AUGUST)
    expect(Object.keys(statics).some((key) => key.startsWith('u1|ovf|')), 'fixture reaches overflow').toBe(true)
    return statics
}

const monthKeysOf = (statics: object, month: string): string[] => Object.keys(statics).filter((key) => key.startsWith(`u1|${month}|`))
const overflowKeysOf = (statics: object): string[] => Object.keys(statics).filter((key) => key.startsWith('u1|ovf|'))

describe('withoutClearedUsage, clear all (G)', () => {
    test('T-C1 removes every month key and every overflow key, and counts them', () => {
        const statics = ledgerWithOverflow(JUNE, JULY, AUGUST)
        const usageKeys = Object.keys(statics).filter((key) => key.startsWith('u1|'))
        const result = withoutClearedUsage(statics, { kind: 'all' })
        expect(Object.keys(result.statics).filter((key) => key.startsWith('u1|'))).toEqual([])
        expect(result.removed).toBe(usageKeys.length)
        expect(overflowKeysOf(statics).length).toBeGreaterThan(0)
    })

    test('T-C2 keeps unknown-version keys and malformed u1 keys', () => {
        const statics = { ...ledger(JUNE), 'u2|2026-06|chat|n|x': 4, 'u1|2026-06|chat': 3, 'u1|ovf|zz': 9 }
        const result = withoutClearedUsage(statics, { kind: 'all' }).statics as Record<string, unknown>
        expect(result['u2|2026-06|chat|n|x']).toBe(4)
        expect(result['u1|2026-06|chat']).toBe(3)
        expect(result['u1|ovf|zz']).toBe(9)
    })

    test('T-C3 keeps messages, imports and other non-usage keys', () => {
        for (const scope of [{ kind: 'all' }, { kind: 'before', month: '2026-08' }] as const) {
            const result = withoutClearedUsage(ledger(JUNE, JULY), scope).statics as Record<string, unknown>
            expect(result.messages).toBe(7)
            expect(result.imports).toBe(2)
            expect(result.s).toBe(1)
        }
    })

    test('T-C6 never changes its argument; nothing to remove returns the same reference; a non-object and a bad month remove nothing', () => {
        const statics = ledger(JUNE, JULY)
        const before = structuredClone(statics)
        withoutClearedUsage(statics, { kind: 'all' })
        withoutClearedUsage(statics, { kind: 'before', month: '2026-07' })
        expect(statics).toEqual(before)

        const plain = { messages: 1, imports: 0 }
        const same = withoutClearedUsage(plain, { kind: 'all' })
        expect(same).toEqual({ statics: plain, removed: 0, months: 0 })
        expect(same.statics).toBe(plain)

        for (const odd of [null, undefined, 5, 'x', [1]]) {
            const result = withoutClearedUsage(odd as unknown as object, { kind: 'all' })
            expect(result.removed).toBe(0)
            expect(result.months).toBe(0)
            expect(result.statics).toBe(odd)
        }

        const bad = withoutClearedUsage(statics, { kind: 'before', month: '2026-7' })
        expect(bad.removed).toBe(0)
        expect(bad.statics).toBe(statics)
    })

    test('T-C7 removes a well-formed key whatever its value, and counts its month', () => {
        const statics = { messages: 1, 'u1|2026-05|chat|n|a': 'x', 'u1|2026-04|chat|n|a': -5 }
        const result = withoutClearedUsage(statics, { kind: 'all' })
        expect(result.statics).toEqual({ messages: 1 })
        expect(result.removed).toBe(2)
        expect(result.months).toBe(2)
    })

    test('T-C8 counts distinct months, not keys, and never counts overflow', () => {
        const statics: Record<string, unknown> = { messages: 0, imports: 0 }
        for (const when of [new Date(2026, 0, 5), new Date(2026, 1, 5)]) {
            for (const model of ['m1', 'm2']) {
                for (const purpose of ['chat', 'utility'] as const) {
                    recordUsage(statics, entry(model, purpose), when)
                }
            }
        }
        recordUsage(statics, entry(), JULY)
        statics['u1|ovf|n'] = 3
        const before = withoutClearedUsage(statics, { kind: 'before', month: '2026-06' })
        expect(before.removed).toBeGreaterThan(10)
        expect(before.months).toBe(2)
        const all = withoutClearedUsage(statics, { kind: 'all' })
        expect(all.months).toBe(3)
        expect(all.removed).toBeGreaterThan(before.removed)
        const overflowOnly = withoutClearedUsage({ messages: 0, 'u1|ovf|n': 3 }, { kind: 'all' })
        expect(overflowOnly.removed).toBe(1)
        expect(overflowOnly.months).toBe(0)
    })
})

describe('withoutClearedUsage, clear before a month (G)', () => {
    test('T-C4 removes earlier months and keeps the named month and later ones', () => {
        const result = withoutClearedUsage(ledger(JUNE, JULY, AUGUST), { kind: 'before', month: '2026-07' })
        expect(monthKeysOf(result.statics, '2026-06')).toEqual([])
        expect(monthKeysOf(result.statics, '2026-07').length).toBeGreaterThan(0)
        expect(monthKeysOf(result.statics, '2026-08').length).toBeGreaterThan(0)
        expect(result.months).toBe(1)
    })

    test('T-C5 keeps overflow', () => {
        const statics = ledgerWithOverflow(JUNE, JULY)
        const overflow = overflowKeysOf(statics)
        const result = withoutClearedUsage(statics, { kind: 'before', month: '2026-08' })
        expect(overflowKeysOf(result.statics)).toEqual(overflow)
    })
})

describe('retention cutoff and setting (G)', () => {
    test('T-R1 the current month is one of the N kept', () => {
        expect(retentionCutoff(new Date(2026, 10, 20), 3)).toBe('2026-09')
        expect(retentionCutoff(new Date(2027, 0, 1, 0, 0), 3)).toBe('2026-11')
        expect(retentionCutoff(new Date(2026, 2, 31, 23, 59), 12)).toBe('2025-04')
        expect(retentionCutoff(new Date(2026, 10, 20), 24)).toBe('2024-12')
        expect(retentionCutoff(new Date(2026, 4, 31), 3)).toBe('2026-03')
    })

    test('T-R2 across a year boundary the earlier December is kept and October is removed', () => {
        const statics = ledger(new Date(2026, 9, 3), new Date(2026, 10, 3), new Date(2026, 11, 3), new Date(2027, 0, 3))
        const cutoff = retentionCutoff(new Date(2027, 0, 1, 0, 0), 3)
        const result = withoutClearedUsage(statics, { kind: 'before', month: cutoff }).statics
        expect(monthKeysOf(result, '2026-10')).toEqual([])
        for (const month of ['2026-11', '2026-12', '2027-01']) {
            expect(monthKeysOf(result, month).length, month).toBeGreaterThan(0)
        }
    })

    test('T-R3 retention keeps overflow and a month later than the current one', () => {
        const statics = ledgerWithOverflow(JUNE, new Date(2027, 1, 3))
        const overflow = overflowKeysOf(statics)
        const result = withoutClearedUsage(statics, { kind: 'before', month: retentionCutoff(new Date(2026, 10, 20), 3) }).statics
        expect(overflowKeysOf(result)).toEqual(overflow)
        expect(monthKeysOf(result, '2027-02').length).toBeGreaterThan(0)
        expect(monthKeysOf(result, '2026-06')).toEqual([])
    })

    test('T-R4 only 3, 6, 12 and 24 are on', () => {
        for (const on of [3, 6, 12, 24]) {
            expect(retentionMonthsOf(on)).toBe(on)
        }
        for (const off of [undefined, 0, 5, '6', NaN, null, 3.5, -3]) {
            expect(retentionMonthsOf(off)).toBeNull()
        }
    })
})
