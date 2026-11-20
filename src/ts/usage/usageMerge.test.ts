import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../storage/blockFrame'
import { mergeStatics } from '../storage/store2/fastForward/delta'
import { isUsageKey, recordUsage, USAGE_KEY_CAP } from './usageLedger'
import type { UsageEntry } from './usageTypes'

/**
 * The real `mergeStatics` (fast-forward) with ledger outputs as inputs. Two tabs that make the same change to one key
 * between fast-forwards add both changes; a key both tabs deleted stays deleted; two tabs that both reset sum what
 * each recorded afterwards. Accepted limitation L2 (MC-2553): when this page's own write landed but its save loop
 * never learned it, the next fast-forward merges a tree that already holds that increment against the earlier base and
 * counts it twice; `ffLoopStatics.test.ts` pins it.
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

describe('mergeStatics over recordUsage outputs', () => {
    const base = recorded({ messages: 3, imports: 0 }, 5)

    test('(a) two tabs that changed a key by different amounts add: 5 + 2 + 1 = 8', () => {
        const result = merged(base, recorded(base, 2), recorded(base, 1))
        expect(result[KEY_N]).toBe(8)
        expect(result[KEY_I]).toBe(80)
    })

    test('(b) equal change: each tab records one request under the same key, both count (7)', () => {
        const decision = mergeStatics(base, recorded(base, 1), recorded(base, 1))
        expect(decision.kind).toBe('merge')
        const result = merged(base, recorded(base, 1), recorded(base, 1))
        expect(result[KEY_N]).toBe(7)
        expect(result[KEY_I]).toBe(70)
    })

    test('(c) equal new key: both tabs create the key with 1, the merge holds 2', () => {
        const empty: JsonObject = { messages: 3, imports: 0 }
        const result = merged(empty, recorded(empty, 1), recorded(empty, 1))
        expect(result[KEY_N]).toBe(2)
    })

    /** Stands for the reset of the usage statistics: it deletes every usage key and leaves the other statics. */
    function reset(from: JsonObject): JsonObject {
        const copy = structuredClone(from)
        for (const key of Object.keys(copy)) {
            if (isUsageKey(key)) {
                delete copy[key]
            }
        }
        return copy
    }

    test('both tabs reset: no usage key returns, the other statics stay, nothing parks (compatibility guard)', () => {
        const result = merged(base, reset(base), reset(base))
        expect(Object.keys(result).filter(isUsageKey)).toEqual([])
        expect(result.messages).toBe(3)
        expect(result.imports).toBe(0)
    })

    test('both tabs reset, then each records one request: the two requests add (2)', () => {
        const result = merged(base, recorded(reset(base), 1), recorded(reset(base), 1))
        expect(result[KEY_N]).toBe(2)
        expect(result[KEY_I]).toBe(20)
    })

    test('one tab resets and the other records two requests: the reset side loses the old count (2, compatibility guard)', () => {
        const result = merged(base, reset(base), recorded(base, 2))
        expect(result[KEY_N]).toBe(2)
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
