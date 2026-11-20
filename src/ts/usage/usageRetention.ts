import { localMonth, retentionCutoff, retentionMonthsOf, withoutClearedUsage } from './usageLedger'

/**
 * Usage retention: months of the ledger older than the chosen period are deleted, once per local month per page.
 * Invariants:
 *  - It runs only through `withoutClearedUsage`, so overflow, unknown-version keys, `messages` and `imports` stay.
 *  - The month is recorded only after a loaded `statics` was seen, so an early call on an unloaded profile does not use it up.
 *  - `db.statics` is assigned once, through the caller's (reactive) object, and only when a key was removed, so a call
 *    that removes nothing marks nothing dirty.
 *  - In an unchanged month and without `force` a call is one string compare and scans no keys.
 */

let checkedMonth: string | null = null

function isStaticsObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns the number of keys removed. `force` skips the once-per-month gate: boot and a changed setting use it. */
export function applyUsageRetention(
    db: { statics?: unknown, usageRetentionMonths?: unknown } | null | undefined,
    now: Date,
    options?: { force?: boolean },
): number {
    if (!db || !isStaticsObject(db.statics)) {
        return 0
    }
    const month = localMonth(now)
    if (!options?.force && month === checkedMonth) {
        return 0
    }
    checkedMonth = month
    const months = retentionMonthsOf(db.usageRetentionMonths)
    if (months === null) {
        return 0
    }
    const { statics, removed } = withoutClearedUsage(db.statics, { kind: 'before', month: retentionCutoff(now, months) })
    if (removed > 0) {
        db.statics = statics
    }
    return removed
}

/** Forgets the checked month; for tests, which share the module. */
export function resetUsageRetentionGate(): void {
    checkedMonth = null
}
