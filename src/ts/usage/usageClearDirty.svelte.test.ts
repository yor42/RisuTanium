import { afterAll, describe, expect, test } from 'vitest'
import type { DbWriteMark } from '../storage/characterSaveMarks'
import { installDbWriteHook } from '../storage/dbWriteHook'
import { setStateWriteHook } from '../storage/svelteStatePatch'
import { recordUsage } from './usageLedger'
import { applyUsageRetention, resetUsageRetentionGate } from './usageRetention'
import type { UsageEntry } from './usageTypes'

/**
 * The retention writer over the patched state proxy with the explicit write hook installed: a prune that removes keys
 * reaches the sink as a `setting:statics` mark, one that removes nothing marks nothing. T-D3 is a compatibility guard on
 * the premise that an in-place delete on the statics proxy is seen as well (it passes with or without the change).
 */

const entry: UsageEntry = { modelKey: 'm1', purpose: 'chat', reported: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, estimated: null }
const NOW = new Date(2026, 10, 20)

type Marks = { kind: string, key?: string }[]

afterAll(() => {
    setStateWriteHook(null)
})

async function hookedState(months: Date[], retention: number | undefined): Promise<{ state: { db: { statics: Record<string, unknown>, usageRetentionMonths?: number } }, marks: Marks }> {
    const { proxy } = await import('svelte/internal/client')
    const statics: Record<string, unknown> = { messages: 1, imports: 0 }
    for (const when of months) {
        recordUsage(statics, entry, when)
    }
    const state = proxy({ db: {} as { statics: Record<string, unknown>, usageRetentionMonths?: number } })
    const marks: Marks = []
    installDbWriteHook(state, {
        selectedChaId: () => undefined,
        sink: (mark: DbWriteMark) => { marks.push(mark as { kind: string, key?: string }) },
    })
    state.db = { statics, usageRetentionMonths: retention }
    marks.length = 0
    resetUsageRetentionGate()
    return { state, marks }
}

describe('retention marks the statics setting dirty', () => {
    test('T-D1 a prune assigns statics through the proxy: one setting:statics mark, old keys gone', async () => {
        const { state, marks } = await hookedState([new Date(2026, 0, 1), NOW], 3)

        expect(applyUsageRetention(state.db, NOW)).toBeGreaterThan(0)

        expect(marks).toContainEqual({ kind: 'setting', key: 'statics' })
        expect(Object.keys(state.db.statics).some((key) => key.startsWith('u1|2026-01|'))).toBe(false)
        expect(Object.keys(state.db.statics).some((key) => key.startsWith('u1|2026-11|'))).toBe(true)
    })

    test('T-D2 nothing to prune writes nothing and marks nothing', async () => {
        const { state, marks } = await hookedState([NOW], 3)
        const statics = state.db.statics

        expect(applyUsageRetention(state.db, NOW)).toBe(0)

        expect(marks.filter((mark) => mark.key === 'statics')).toEqual([])
        expect(state.db.statics).toBe(statics)
    })

    test('T-D3 compatibility guard: an in-place delete on the statics proxy is seen as a setting:statics mark', async () => {
        const { state, marks } = await hookedState([NOW], undefined)

        delete state.db.statics.messages

        expect(marks).toContainEqual({ kind: 'setting', key: 'statics' })
    })
})
