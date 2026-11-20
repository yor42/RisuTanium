import { describe, expect, test } from 'vitest'
import type { JsonObject } from '../storage/blockFrame'
import { mergeStatics } from '../storage/store2/fastForward/delta'
import { recordUsage, withoutClearedUsage } from './usageLedger'
import type { UsageEntry } from './usageTypes'

/**
 * Fast-forward merge (`mergeStatics`) over a ledger one tab cleared. T-M1 and T-M2 are compatibility guards. D-M1 is a
 * regression test for the additive merge: when both tabs cleared, each side holds its own count since the clear, so the
 * merge sums the two counts and never goes negative.
 */

const NOW = new Date(2026, 5, 15, 12, 0, 0)
const KEY = 'u1|2026-06|chat|n|gpt-test'
const entry: UsageEntry = { modelKey: 'gpt-test', purpose: 'chat', reported: null, estimated: null }

function recorded(from: JsonObject, times: number): JsonObject {
    const copy = structuredClone(from)
    for (let i = 0; i < times; i++) {
        recordUsage(copy, entry, NOW)
    }
    return copy
}

const cleared = (statics: JsonObject): JsonObject => withoutClearedUsage(statics, { kind: 'all' }).statics

/** The statics the page ends with: its own on `keep`, the decision's value otherwise. */
function merged(base: JsonObject, mine: JsonObject, theirs: JsonObject): JsonObject {
    const decision = mergeStatics(base, mine, theirs)
    if (decision.kind === 'park') {
        throw new Error('parked')
    }
    return decision.kind === 'keep' ? mine : decision.value as JsonObject
}

describe('mergeStatics with a cleared ledger', () => {
    const base = recorded({ messages: 3, imports: 0 }, 5)

    test('T-M1 a peer that did not change the ledger leaves the clear in place, from either side', () => {
        expect(mergeStatics(base, cleared(base), base).kind).toBe('keep')
        expect(merged(base, cleared(base), base)[KEY]).toBeUndefined()
        const taken = merged(base, base, cleared(base))
        expect(taken[KEY]).toBeUndefined()
        expect(taken.messages).toBe(3)
    })

    test('T-M2 a peer that recorded after the base keeps only its own increments; both cleared stays cleared; clear then record adds', () => {
        expect(merged(base, cleared(base), recorded(base, 2))[KEY]).toBe(2)
        expect(merged(base, cleared(base), cleared(base))[KEY]).toBeUndefined()
        expect(merged(base, recorded(cleared(base), 1), recorded(base, 2))[KEY]).toBe(3)
    })

    test('D-M1 both tabs cleared and one recorded gives y, both recorded gives y + z', () => {
        const y = 2
        expect(merged(base, cleared(base), recorded(cleared(base), y))[KEY]).toBe(y)
        const z = 1
        expect(merged(base, recorded(cleared(base), z), recorded(cleared(base), y))[KEY]).toBe(y + z)
    })
})
