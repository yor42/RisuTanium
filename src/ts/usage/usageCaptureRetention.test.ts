import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../stores.svelte', () => ({
    DBState: { db: {} as Record<string, unknown> },
}))
vi.mock('../tokenizer', () => ({
    ChatTokenizer: class {
        constructor(_a: number, _b: string) {}
        async tokenizeChat() { return 7 }
    },
    tokenize: vi.fn(async (s: string) => s?.length ?? 0),
}))

import { recordUsage } from './usageLedger'
import type { UsageEntry } from './usageTypes'

/**
 * Retention on the record path: the first usage record of a local month prunes the months before the retention cutoff
 * before the new count is written. Regression reproducer: a record path that never prunes keeps every old month.
 *
 * MOCKED: `stores.svelte` (a plain `DBState`) and the tokenizer. The capture module, the ledger and the retention gate are real.
 * The gate holds a month in module state, so each test imports `usageCapture` from a fresh module graph; the `DBState`
 * the capture reads is the one mocked above, so the test imports `DBState` dynamically from the same fresh graph and
 * assigns the database there. A statically imported `DBState` would belong to another graph and the capture would read an empty one.
 */

const old: UsageEntry = { modelKey: 'm1', purpose: 'chat', reported: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, estimated: null }

type Capture = typeof import('./usageCapture')
let capture: Capture
let state: { db: Record<string, unknown> }

beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 5, 15, 12, 0, 0))
    vi.resetModules()
    state = (await import('../stores.svelte')).DBState as unknown as { db: Record<string, unknown> }
    capture = await import('./usageCapture')
})

afterEach(() => {
    vi.useRealTimers()
})

function settleOne(): void {
    const arg = { aiModel: 'gpt-test', formated: [] }
    const meter = capture.beginUsageCapture(arg)
    meter.report({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 })
    capture.settleUsage(arg, 'model', { type: 'success', result: 'x' })
}

const hasMonth = (statics: object, month: string): boolean => Object.keys(statics).some((key) => key.startsWith(`u1|${month}|`))

describe('record() retention', () => {
    test('T-U1 the first record of the month prunes the months before the cutoff and then records into the current month', () => {
        const statics: Record<string, unknown> = { messages: 0, imports: 0 }
        for (let month = 0; month < 6; month++) {
            recordUsage(statics, old, new Date(2026, month, 3))
        }
        state.db = { statics, usageRetentionMonths: 3 }

        settleOne()

        // A prune replaces `db.statics`, so the result is read from the database, not from the object built above.
        const after = state.db.statics as Record<string, unknown>
        for (const gone of ['2026-01', '2026-02', '2026-03']) {
            expect(hasMonth(after, gone), gone).toBe(false)
        }
        for (const kept of ['2026-04', '2026-05', '2026-06']) {
            expect(hasMonth(after, kept), kept).toBe(true)
        }
        const recorded = Object.keys(after).filter((key) => key.startsWith('u1|2026-06|') && key.endsWith('|i|gpt-test'))
        expect(recorded).toHaveLength(1)
        expect(after[recorded[0]]).toBe(10)
    })

    test('without a retention setting every month stays', () => {
        const statics: Record<string, unknown> = { messages: 0, imports: 0 }
        recordUsage(statics, old, new Date(2026, 0, 3))
        state.db = { statics }
        settleOne()
        expect(hasMonth(statics, '2026-01')).toBe(true)
    })
})
