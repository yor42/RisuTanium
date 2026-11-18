import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../storage/blockFrame'
import { mergeStatics } from '../storage/store2/fastForward/delta'
import { recordUsage, USAGE_KEY_CAP } from './usageLedger'
import type { UsageEntry } from './usageTypes'

/**
 * Compatibility guard over the real `mergeStatics` (fast-forward) with ledger outputs as inputs. The merge half runs
 * against the unchanged `delta.ts`. Two tabs that make the SAME change to one key between fast-forwards keep one copy
 * of it (accepted limitation L1, follow-up FU-1 makes `mergeStatics` add them); cases (b) and (c) pin that, and flip
 * only when FU-1 lands. They must not be rewritten with unequal values.
 */

const NOW = new Date(2026, 5, 15, 12, 0, 0)
const MONTH = '2026-06'
const KEY_N = `u1|${MONTH}|chat|n|gpt-test`
const KEY_I = `u1|${MONTH}|chat|i|gpt-test`

const entry = (modelKey = 'gpt-test'): UsageEntry => ({
    modelKey,
    purpose: 'chat',
    reported: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
    estimated: null,
})

function recorded(from: JsonObject, times: number, modelKey = 'gpt-test'): JsonObject {
    const copy = structuredClone(from)
    for (let i = 0; i < times; i++) {
        recordUsage(copy, entry(modelKey), NOW)
    }
    return copy
}

/** The statics the page ends with: its own on `keep`, the decision's value otherwise. */
function merged(base: JsonObject, mine: JsonObject, theirs: JsonObject): JsonObject {
    const decision = mergeStatics(base, mine, theirs)
    expect(decision.kind).not.toBe('park')
    if (decision.kind === 'keep') {
        return mine
    }
    if (decision.kind === 'park') {
        throw new Error('parked')
    }
    return decision.value as JsonObject
}

describe('mergeStatics over recordUsage outputs (L1, FU-1)', () => {
    const base = recorded({ messages: 3, imports: 0 }, 5)

    test('(a) two tabs that changed a key by different amounts add: 5 + 2 + 1 = 8', () => {
        const result = merged(base, recorded(base, 2), recorded(base, 1))
        expect(result[KEY_N]).toBe(8)
        expect(result[KEY_I]).toBe(80)
    })

    test('(b) L1 equal change: each tab records one request under the same key, one change is lost (6, not 7)', () => {
        const decision = mergeStatics(base, recorded(base, 1), recorded(base, 1))
        expect(decision.kind).toBe('keep')
        const result = merged(base, recorded(base, 1), recorded(base, 1))
        expect(result[KEY_N]).toBe(6)
        expect(result[KEY_I]).toBe(60)
    })

    test('(c) L1 equal new key: both tabs create the key with 1, the merge holds 1 (not 2)', () => {
        const empty: JsonObject = { messages: 3, imports: 0 }
        const result = merged(empty, recorded(empty, 1), recorded(empty, 1))
        expect(result[KEY_N]).toBe(1)
    })

    test('(d) a new key with differing values adds: 2 + 1 = 3', () => {
        const empty: JsonObject = { messages: 3, imports: 0 }
        expect(merged(empty, recorded(empty, 2), recorded(empty, 1))[KEY_N]).toBe(3)
    })

    test('(e) disjoint keys are unioned, overflow keys included, and nothing parks', () => {
        const full: JsonObject = { messages: 1, imports: 0 }
        for (let i = 0; i < USAGE_KEY_CAP; i++) {
            full[`u1|2026-01|chat|n|m${i}`] = 1
        }
        const mine = recorded(full, 1, 'overflowing-model')
        const theirs = structuredClone(full)
        theirs[`u1|${MONTH}|utility|n|other`] = 4
        expect(mine['u1|ovf|n']).toBe(1)
        const result = merged(full, mine, theirs)
        expect(result['u1|ovf|n']).toBe(1)
        expect(result[`u1|${MONTH}|utility|n|other`]).toBe(4)
        expect(result['u1|ovf|i']).toBe(10)
        expect(Object.keys(result)).toHaveLength(Object.keys(full).length + 3)
    })

    test('(f) messages with differing deltas stays additive', () => {
        const start: JsonObject = { messages: 3, imports: 0 }
        expect(merged(start, { ...start, messages: 5 }, { ...start, messages: 4 }).messages).toBe(6)
    })

    test('no combination of ledger outputs ever parks', () => {
        for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [1, 3]]) {
            const decision = mergeStatics(base, recorded(base, a), recorded(base, b))
            expect(decision.kind).not.toBe('park')
        }
    })
})
