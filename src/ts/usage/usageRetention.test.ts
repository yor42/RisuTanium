import { beforeEach, describe, expect, test } from 'vitest'
import { applyUsageRetention, resetUsageRetentionGate } from './usageRetention'
import { recordUsage } from './usageLedger'
import type { UsageEntry } from './usageTypes'

/**
 * The once-per-local-month retention gate over a plain object, with ledgers built by the real producer.
 * Labels: (G) guards over a new module, backed by the scratch mutants listed in the ticket plan.
 */

const entry: UsageEntry = { modelKey: 'm1', purpose: 'chat', reported: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimated: null }

const NOW = new Date(2026, 10, 20)
const NEXT_MONTH = new Date(2026, 11, 2)

function dbWith(months: Date[], retention: unknown = 3): { statics: Record<string, unknown>, usageRetentionMonths?: unknown } {
    const statics: Record<string, unknown> = { messages: 1, imports: 0 }
    for (const when of months) {
        recordUsage(statics, entry, when)
    }
    return { statics, usageRetentionMonths: retention }
}

const hasMonth = (statics: object, month: string): boolean => Object.keys(statics).some((key) => key.startsWith(`u1|${month}|`))

beforeEach(() => {
    resetUsageRetentionGate()
})

describe('applyUsageRetention (G)', () => {
    test('T-G1 the first call prunes the months before the cutoff and returns the removed key count', () => {
        const db = dbWith([new Date(2026, 5, 1), new Date(2026, 6, 1), new Date(2026, 8, 1), NOW])
        const removed = applyUsageRetention(db, NOW)
        expect(removed).toBeGreaterThan(0)
        expect(hasMonth(db.statics, '2026-06')).toBe(false)
        expect(hasMonth(db.statics, '2026-07')).toBe(false)
        expect(hasMonth(db.statics, '2026-09')).toBe(true)
        expect(hasMonth(db.statics, '2026-11')).toBe(true)
        expect(db.statics.messages).toBe(1)
    })

    test('T-G2 an old month added later in the same month survives an unforced call', () => {
        const db = dbWith([NOW])
        applyUsageRetention(db, NOW)
        recordUsage(db.statics, entry, new Date(2026, 0, 3))
        expect(applyUsageRetention(db, new Date(2026, 10, 28))).toBe(0)
        expect(hasMonth(db.statics, '2026-01')).toBe(true)
    })

    test('T-G3 an unforced call in the next month prunes again', () => {
        const db = dbWith([NOW])
        applyUsageRetention(db, NOW)
        recordUsage(db.statics, entry, new Date(2026, 7, 3))
        expect(applyUsageRetention(db, NEXT_MONTH)).toBeGreaterThan(0)
        expect(hasMonth(db.statics, '2026-08')).toBe(false)
    })

    test('T-G4 Off removes nothing and keeps the statics object', () => {
        for (const off of [undefined, 0, '6', 5]) {
            resetUsageRetentionGate()
            const db = dbWith([new Date(2026, 0, 1), NOW])
            db.usageRetentionMonths = off
            const statics = db.statics
            expect(applyUsageRetention(db, NOW)).toBe(0)
            expect(db.statics).toBe(statics)
            expect(hasMonth(db.statics, '2026-01')).toBe(true)
        }
    })

    test('T-G4b nothing old enough keeps the statics object', () => {
        const db = dbWith([NOW])
        const statics = db.statics
        expect(applyUsageRetention(db, NOW)).toBe(0)
        expect(db.statics).toBe(statics)
    })

    test('T-G5 a call on an unloaded db does not use up the month, and force prunes again in the same month', () => {
        expect(applyUsageRetention({ usageRetentionMonths: 3 }, NOW)).toBe(0)
        expect(applyUsageRetention(null, NOW)).toBe(0)
        expect(applyUsageRetention({ statics: 'x', usageRetentionMonths: 3 }, NOW)).toBe(0)

        const db = dbWith([new Date(2026, 0, 1), NOW])
        expect(applyUsageRetention(db, NOW)).toBeGreaterThan(0)
        expect(hasMonth(db.statics, '2026-01')).toBe(false)

        recordUsage(db.statics, entry, new Date(2026, 1, 1))
        expect(applyUsageRetention(db, NOW)).toBe(0)
        expect(hasMonth(db.statics, '2026-02')).toBe(true)
        expect(applyUsageRetention(db, NOW, { force: true })).toBeGreaterThan(0)
        expect(hasMonth(db.statics, '2026-02')).toBe(false)
    })
})
