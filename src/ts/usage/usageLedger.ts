import type { JsonObject, JsonValue } from '../storage/blockFrame'
import type { UsageEntry, UsageRetentionMonths } from './usageTypes'

/**
 * The usage ledger kept in `db.statics`: flat numeric keys
 * `u1|<YYYY-MM local>|<purpose>|<counter>|<model>`, plus `u1|ovf|<counter>` for what no longer fits.
 *
 * Invariants:
 *  - Every value the ledger writes is a finite non-negative number, so the fast-forward merge never parks on it.
 *  - A key holding anything else is never overwritten (an increment for it goes to overflow; one for an overflow key is dropped).
 *  - Unknown versions (`u2|...`) and malformed keys are ignored by readers and never deleted or rewritten here.
 *  - `messages` and `imports` are never touched.
 *  - `u1` keys are deleted only by `withoutClearedUsage`, on the person's clear or the retention setting.
 *  - This module has only type imports from outside `src/ts/usage/`, so the store2 import files can use it
 *    without a runtime dependency.
 */

export const USAGE_KEY_VERSION = 'u1'
/** Distinct `u1` month keys the ledger creates before a new combination goes to overflow. Overflow keys are outside the cap. */
export const USAGE_KEY_CAP = 1000
/** Longest model label kept in a key; a longer one is cut. */
export const MAX_MODEL_LABEL = 120

export type UsageCounter = 'n' | 'i' | 'o' | 'cr' | 'cw' | 'ei' | 'eo'

export const USAGE_COUNTERS: readonly UsageCounter[] = ['n', 'i', 'o', 'cr', 'cw', 'ei', 'eo']

const OVERFLOW_MONTH = 'ovf'
const MONTH_PATTERN = /^\d{4}-\d{2}$/
const ANY_USAGE_KEY = /^u\d+\|/

export interface UsageRow {
    month: string
    purpose: string
    counter: UsageCounter
    model: string
    value: number
}

export type UsageOverflow = Partial<Record<UsageCounter, number>>

export interface UsageReadout {
    rows: UsageRow[]
    overflow: UsageOverflow
}

export type ParsedUsageKey =
    | { overflow: false, month: string, purpose: string, counter: UsageCounter, model: string }
    | { overflow: true, counter: UsageCounter }

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCounter(value: string): value is UsageCounter {
    return (USAGE_COUNTERS as readonly string[]).includes(value)
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** The local calendar month of `date`, as `YYYY-MM`. */
export function localMonth(date: Date): string {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** A key of any ledger version: what the export leave-out and the import overlay treat as usage data. */
export function isUsageKey(key: string): boolean {
    return ANY_USAGE_KEY.test(key)
}

export function usageKey(month: string, purpose: string, counter: UsageCounter, model: string): string {
    return `${USAGE_KEY_VERSION}|${month}|${purpose}|${counter}|${model.slice(0, MAX_MODEL_LABEL)}`
}

function overflowKey(counter: UsageCounter): string {
    return `${USAGE_KEY_VERSION}|${OVERFLOW_MONTH}|${counter}`
}

/** The parts of a `u1` key; null for another version or a malformed key. The model label is everything after the fourth `|`. */
export function parseUsageKey(key: string): ParsedUsageKey | null {
    if (!key.startsWith(`${USAGE_KEY_VERSION}|`)) {
        return null
    }
    const rest = key.slice(USAGE_KEY_VERSION.length + 1)
    const parts = rest.split('|')
    if (parts[0] === OVERFLOW_MONTH) {
        return parts.length === 2 && isCounter(parts[1]) ? { overflow: true, counter: parts[1] } : null
    }
    if (parts.length < 4 || !MONTH_PATTERN.test(parts[0]) || parts[1] === '' || !isCounter(parts[2])) {
        return null
    }
    return { overflow: false, month: parts[0], purpose: parts[1], counter: parts[2], model: parts.slice(3).join('|') }
}

function countersOf(entry: UsageEntry): [UsageCounter, number][] {
    const all: [UsageCounter, number][] = [['n', 1]]
    if (entry.reported !== null) {
        all.push(['i', entry.reported.input], ['o', entry.reported.output], ['cr', entry.reported.cacheRead], ['cw', entry.reported.cacheWrite])
    } else if (entry.estimated !== null) {
        all.push(['ei', entry.estimated.input], ['eo', entry.estimated.output])
    }
    return all.filter(([, amount]) => isCount(amount) && amount > 0).map(([counter, amount]) => [counter, Math.round(amount)])
}

/**
 * Adds one settled attempt to `statics`. A no-op when `statics` is not a plain object. An existing finite number is
 * incremented; a key holding anything else is left alone and its increment goes to overflow; a new key goes to overflow
 * once the object holds `USAGE_KEY_CAP` month keys. An overflow key holding a non-number drops the increment.
 */
export function recordUsage(statics: unknown, entry: UsageEntry, now: Date): void {
    if (!isPlainObject(statics)) {
        return
    }
    const month = localMonth(now)
    let monthKeys = -1
    const ledger = statics
    const bumpOverflow = (counter: UsageCounter, amount: number): void => {
        const key = overflowKey(counter)
        const current = ledger[key]
        if (!(key in ledger)) {
            ledger[key] = amount
        } else if (isCount(current)) {
            ledger[key] = current + amount
        }
    }
    for (const [counter, amount] of countersOf(entry)) {
        const key = usageKey(month, entry.purpose, counter, entry.modelKey)
        if (key in ledger) {
            const current = ledger[key]
            if (isCount(current)) {
                ledger[key] = current + amount
            } else {
                bumpOverflow(counter, amount)
            }
            continue
        }
        if (monthKeys < 0) {
            monthKeys = Object.keys(ledger).filter((name) => name.startsWith(`${USAGE_KEY_VERSION}|`) && parseUsageKey(name)?.overflow === false).length
        }
        if (monthKeys >= USAGE_KEY_CAP) {
            bumpOverflow(counter, amount)
        } else {
            ledger[key] = amount
            monthKeys++
        }
    }
}

/** Every well-formed `u1` key with a finite non-negative number, and the overflow counters. Nothing is changed. */
export function readUsage(statics: unknown): UsageReadout {
    const rows: UsageRow[] = []
    const overflow: UsageOverflow = {}
    if (!isPlainObject(statics)) {
        return { rows, overflow }
    }
    for (const key of Object.keys(statics)) {
        const value = statics[key]
        const parsed = parseUsageKey(key)
        if (parsed === null || !isCount(value)) {
            continue
        }
        // `in` narrows the union even without strictNullChecks, where a boolean discriminant does not.
        if (!('month' in parsed)) {
            overflow[parsed.counter] = value
        } else {
            rows.push({ month: parsed.month, purpose: parsed.purpose, counter: parsed.counter, model: parsed.model, value })
        }
    }
    return { rows, overflow }
}

/** A new object without the usage keys of any version; the argument is never changed. */
export function withoutUsageKeys<T extends object>(statics: T): T {
    // The kept keys are a subset of T's own keys, so the copy has T's shape for every field the caller reads.
    return Object.fromEntries(Object.entries(statics).filter(([key]) => !isUsageKey(key))) as T
}

export type UsageClearScope = { kind: 'all' } | { kind: 'before', month: string }

/**
 * A new object without the well-formed `u1` keys in `scope`; the argument is never changed and, with nothing to remove,
 * is returned as the same reference. `all` takes every well-formed `u1` key including overflow; `before` takes the month
 * keys of the months before `scope.month` and never overflow. Values are not judged, so a key holding a non-number goes
 * too. `removed` counts the keys, `months` the distinct months among them (overflow is never a month).
 */
export function withoutClearedUsage<T extends object>(statics: T, scope: UsageClearScope): { statics: T, removed: number, months: number } {
    if (!isPlainObject(statics) || (scope.kind === 'before' && !MONTH_PATTERN.test(scope.month))) {
        return { statics, removed: 0, months: 0 }
    }
    const months = new Set<string>()
    const kept: [string, unknown][] = []
    let removed = 0
    for (const entry of Object.entries(statics)) {
        const parsed = parseUsageKey(entry[0])
        // `in` narrows the union even without strictNullChecks, where a boolean discriminant does not.
        const month = parsed !== null && 'month' in parsed ? parsed.month : null
        const taken = parsed !== null && (scope.kind === 'all' || (month !== null && month < scope.month))
        if (!taken) {
            kept.push(entry)
            continue
        }
        removed++
        if (month !== null) {
            months.add(month)
        }
    }
    if (removed === 0) {
        return { statics, removed: 0, months: 0 }
    }
    // The kept keys are a subset of T's own keys, so the copy has T's shape for every field the caller reads.
    return { statics: Object.fromEntries(kept) as T, removed, months: months.size }
}

export const USAGE_RETENTION_CHOICES: readonly UsageRetentionMonths[] = [3, 6, 12, 24]

/** The retention period a stored value names; null (off) for anything but 3, 6, 12 or 24. */
export function retentionMonthsOf(value: unknown): UsageRetentionMonths | null {
    return USAGE_RETENTION_CHOICES.find((choice) => choice === value) ?? null
}

/** The oldest month kept when retaining `months` months counted back from `now`'s local month, which is one of them. */
export function retentionCutoff(now: Date, months: number): string {
    // Day 1 avoids month-end overflow; the Date constructor carries a negative month into earlier years.
    return localMonth(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1))
}

/** True when `statics` holds a usage key of any version. */
export function hasUsageKeys(statics: unknown): boolean {
    return isPlainObject(statics) && Object.keys(statics).some(isUsageKey)
}

/** True when the profile holds usage statistics or price overrides: what a `.bin` export leaves out. */
export function hasUsageData(db: { statics?: unknown, usagePriceOverrides?: unknown }): boolean {
    return hasUsageKeys(db.statics) || (isPlainObject(db.usagePriceOverrides) && Object.keys(db.usagePriceOverrides).length > 0)
}

/**
 * What a `.bin` import keeps from the page: its usage keys, values as they are (a non-number value is carried, not
 * judged), and its price overrides. Each is returned only when the page holds some.
 */
export function usageCarryOf(statics: JsonValue | undefined, overrides: JsonValue | undefined): { usageStatics?: JsonObject, usagePriceOverrides?: JsonObject } {
    const carry: { usageStatics?: JsonObject, usagePriceOverrides?: JsonObject } = {}
    if (isPlainObject(statics)) {
        const kept: JsonObject = {}
        for (const key of Object.keys(statics)) {
            if (isUsageKey(key)) {
                kept[key] = statics[key] as JsonValue
            }
        }
        if (Object.keys(kept).length > 0) {
            carry.usageStatics = kept
        }
    }
    if (isPlainObject(overrides) && Object.keys(overrides).length > 0) {
        carry.usagePriceOverrides = overrides as JsonObject
    }
    return carry
}

/**
 * The statics an import gives the profile: the file's own non-usage keys, then the page's usage keys. The file's usage keys
 * (any version) are always dropped. A file `statics` that is not a plain object is replaced by the defaults when the page
 * has usage to keep. With no usage on either side the file's value is returned as the same reference.
 */
export function withPageUsage(fileStatics: JsonValue | undefined, carry: JsonObject | undefined): JsonValue | undefined {
    const hasCarry = carry !== undefined && Object.keys(carry).length > 0
    if (!hasCarry) {
        return isPlainObject(fileStatics) && hasUsageKeys(fileStatics) ? withoutUsageKeys(fileStatics) as JsonObject : fileStatics
    }
    const base: JsonObject = isPlainObject(fileStatics) ? withoutUsageKeys(fileStatics) as JsonObject : { messages: 0, imports: 0 }
    return { ...base, ...carry }
}
