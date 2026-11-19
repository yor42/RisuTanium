import { describe, expect, it, test } from 'vitest'
import type { JsonValue } from '../../blockFrame'
import type { UnitKeepSet } from '../../store2/gc/unitAge'
import { decideAge, NODE_RECORD_CAP, SWEEP_FUTURE_SKEW_MS, SWEEP_MIN_AGE_MS, type RecordRead } from '../../store2/sweep'
import { SEEN_BEFORE, type AssetAgeInput, type UnitAgeInput } from '../../store2/sweep/ageRecord'
import { keepHolding } from './sweepFixtures'

const NOW = 10 * SWEEP_MIN_AGE_MS

function recordAt(at: number, items: [string, number | null, ...JsonValue[]][]): RecordRead {
    return { status: 'ok', value: { v: 1, at, items } }
}

function input(over: Partial<AssetAgeInput>): AssetAgeInput {
    return { record: { status: 'absent' }, candidates: [], now: NOW, backend: 'indexeddb', keep: keepHolding(), ...over }
}

describe('age record on a backend without revisions', () => {
    it('writes nothing and deletes nothing while the record is young', () => {
        const decision = decideAge(input({
            record: recordAt(NOW - SWEEP_MIN_AGE_MS + 1, [['a', null]]),
            candidates: [{ name: 'a', rev: null }, { name: 'new', rev: null }],
        }))
        expect(decision).toEqual({ phase: 'young', delete: [], nextRecord: null })
    })

    it('treats a record exactly one minimum age old as old', () => {
        const decision = decideAge(input({ record: recordAt(NOW - SWEEP_MIN_AGE_MS, [['a', null]]), candidates: [{ name: 'a', rev: null }] }))
        expect(decision.phase).toBe('swept')
        expect(decision.delete).toEqual([{ name: 'a', ifVersion: null }])
    })

    it('deletes only the intersection and records the rest with the current time, never an old one', () => {
        const at = NOW - 2 * SWEEP_MIN_AGE_MS
        const decision = decideAge(input({
            record: recordAt(at, [['both', null], ['gone-from-scan', null]]),
            candidates: [{ name: 'both', rev: null }, { name: 'fresh', rev: null }],
        }))
        expect(decision.phase).toBe('swept')
        expect(decision.delete).toEqual([{ name: 'both', ifVersion: null }])
        expect(decision.nextRecord).toEqual({ v: 1, at: NOW, items: [['fresh', null]] })
    })

    it('does not delete a candidate the fresh keep-set protects, and keeps it recorded as a candidate', () => {
        const decision = decideAge(input({
            record: recordAt(NOW - 2 * SWEEP_MIN_AGE_MS, [['held', null], ['free', null]]),
            candidates: [{ name: 'held', rev: null }, { name: 'free', rev: null }],
            keep: keepHolding('held'),
        }))
        expect(decision.delete).toEqual([{ name: 'free', ifVersion: null }])
        expect(decision.nextRecord?.items).toEqual([['held', null]])
        expect(decision.nextRecord?.at).toBe(NOW)
    })

    it('records fresh candidates and deletes nothing when the record is absent, unreadable or too new', () => {
        for (const status of ['absent', 'unreadable', 'too-new'] as const) {
            const decision = decideAge(input({ record: { status }, candidates: [{ name: 'a', rev: null }] }))
            expect(decision).toEqual({ phase: 'recorded', delete: [], nextRecord: { v: 1, at: NOW, items: [['a', null]] } })
        }
    })

    it('replaces a record dated more than ten minutes ahead and deletes nothing', () => {
        const decision = decideAge(input({
            record: recordAt(NOW + SWEEP_FUTURE_SKEW_MS + 1, [['a', null]]),
            candidates: [{ name: 'a', rev: null }],
        }))
        expect(decision).toEqual({ phase: 'recorded', delete: [], nextRecord: { v: 1, at: NOW, items: [['a', null]] } })
    })

    it('reads a record ahead by ten minutes or less as young', () => {
        for (const ahead of [1, SWEEP_FUTURE_SKEW_MS]) {
            const decision = decideAge(input({ record: recordAt(NOW + ahead, [['a', null]]), candidates: [{ name: 'a', rev: null }] }))
            expect(decision).toEqual({ phase: 'young', delete: [], nextRecord: null })
        }
    })

    it('names the minimum age, the skew and the limits as parameters', () => {
        const decision = decideAge(input({
            record: recordAt(NOW - 100, [['a', null]]), candidates: [{ name: 'a', rev: null }], minAgeMs: 100,
        }))
        expect(decision.delete).toEqual([{ name: 'a', ifVersion: null }])
        const far = decideAge(input({ record: recordAt(NOW + 50, [['a', null]]), candidates: [{ name: 'a', rev: null }], futureSkewMs: 10 }))
        expect(far.phase).toBe('recorded')
    })

    it('lists a repeated candidate once', () => {
        const decision = decideAge(input({ candidates: [{ name: 'a', rev: null }, { name: 'a', rev: null }] }))
        expect(decision.nextRecord?.items).toEqual([['a', null]])
    })
})

describe('age record on Node', () => {
    const node = (over: Partial<AssetAgeInput>): AssetAgeInput => input({ backend: 'node', ...over })
    const old = NOW - 2 * SWEEP_MIN_AGE_MS

    it('records only candidates with a revision, and caps them per pass', () => {
        const candidates = Array.from({ length: NODE_RECORD_CAP + 20 }, (_, i) => ({ name: `a${i}`, rev: i + 2 }))
        const decision = decideAge(node({ candidates: [{ name: 'no-rev', rev: null }, ...candidates] }))
        expect(decision.nextRecord?.items).toHaveLength(NODE_RECORD_CAP)
        expect(decision.nextRecord?.items.every(item => item[1] !== null)).toBe(true)
        expect(decision.nextRecord?.items.some(item => item[0] === 'no-rev')).toBe(false)
    })

    it('never deletes an item recorded without a revision', () => {
        const decision = decideAge(node({ record: recordAt(old, [['a', null]]), candidates: [{ name: 'a', rev: 4 }] }))
        expect(decision.delete).toEqual([])
        expect(decision.nextRecord?.items).toEqual([['a', 4]])
    })

    it('never deletes a candidate observed without a revision', () => {
        const decision = decideAge(node({ record: recordAt(old, [['a', 4]]), candidates: [{ name: 'a', rev: null }] }))
        expect(decision.delete).toEqual([])
        expect(decision.nextRecord?.items).toEqual([])
    })

    it('deletes only at the recorded revision and not when the revision moved', () => {
        const decision = decideAge(node({
            record: recordAt(old, [['same', 4], ['moved', 5]]),
            candidates: [{ name: 'same', rev: 4 }, { name: 'moved', rev: 9 }],
        }))
        expect(decision.delete).toEqual([{ name: 'same', ifVersion: 4 }])
        expect(decision.nextRecord).toEqual({ v: 1, at: NOW, items: [['moved', 9]] })
    })

    it('replaces a far-future record and deletes nothing', () => {
        const decision = decideAge(node({
            record: recordAt(NOW + SWEEP_FUTURE_SKEW_MS + 1, [['a', 4]]), candidates: [{ name: 'a', rev: 4 }],
        }))
        expect(decision.delete).toEqual([])
        expect(decision.nextRecord).toEqual({ v: 1, at: NOW, items: [['a', 4]] })
    })
})

describe('the aged unit rule on Node (guards of the two-sighting rule)', () => {
    const DAY = SWEEP_MIN_AGE_MS
    const stale = NOW - 2 * DAY
    const CAP = 3

    function unitKeep(...held: string[]): UnitKeepSet {
        const names = new Set(held)
        return { holds: (name: string) => names.has(name) } as UnitKeepSet
    }

    function unitInput(over: Partial<UnitAgeInput>): UnitAgeInput {
        return { subject: 'unit', backend: 'node', record: { status: 'absent' }, candidates: [], now: NOW, keep: unitKeep(), nodeRecordCap: CAP, ...over }
    }

    const names = (...list: string[]) => list.map(name => ({ name, rev: null }))

    test('no record: every candidate is recorded unmarked and nothing is deleted', () => {
        const decision = decideAge(unitInput({ candidates: names('a', 'b') }))

        expect(decision).toEqual({ phase: 'recorded', delete: [], nextRecord: { v: 1, at: NOW, items: [['a', null], ['b', null]] } })
    })

    test('an unmarked item is not deleted and is marked in the next record; a fresh candidate is recorded unmarked (MU1, MU20, MU26)', () => {
        const decision = decideAge(unitInput({ record: recordAt(stale, [['a', null]]), candidates: names('a', 'fresh') }))

        expect(decision.phase).toBe('swept')
        expect(decision.delete).toEqual([])
        expect(decision.nextRecord).toEqual({ v: 1, at: NOW, items: [['a', null, SEEN_BEFORE], ['fresh', null]] })
        expect(decision.nextRecord?.items[1], 'the fresh candidate has no third element').toHaveLength(2)
    })

    test('a marked item that is a candidate again is deleted and leaves the record', () => {
        const decision = decideAge(unitInput({ record: recordAt(stale, [['a', null, SEEN_BEFORE], ['b', null]]), candidates: names('a', 'b', 'c') }))

        expect(decision.delete).toEqual([{ name: 'a', ifVersion: null }])
        expect(decision.nextRecord?.items).toEqual([['b', null, SEEN_BEFORE], ['c', null]])
    })

    test('a marked item that is no longer a candidate, or that the keep-set holds, is dropped and not deleted', () => {
        const decision = decideAge(unitInput({
            record: recordAt(stale, [['gone', null, SEEN_BEFORE], ['held', null, SEEN_BEFORE], ['held2', null]]),
            candidates: names('held', 'held2'),
            keep: unitKeep('held', 'held2'),
        }))

        expect(decision.delete).toEqual([])
        expect(decision.nextRecord?.items).toEqual([])
    })

    test.each<[string, JsonValue]>([['a string', 'x'], ['true', true], ['the number 2', 2], ['the string 1', '1']])(
        'only the number 1 marks an item as seen: %s reads as a first sighting (MU27)', (_label, third) => {
            const decision = decideAge(unitInput({ record: recordAt(stale, [['a', null, third]]), candidates: names('a') }))

            expect(decision.delete).toEqual([])
            expect(decision.nextRecord?.items).toEqual([['a', null, SEEN_BEFORE]])
        })

    test('the earlier clock judges the age (MU2, MU4, MU5): a record 12 hours old by the earlier clock is young however late the later one is', () => {
        const at = NOW - 3 * DAY
        const young = decideAge(unitInput({ record: recordAt(at, [['a', null, SEEN_BEFORE]]), candidates: names('a'), now: at + DAY / 2, late: at + 2 * DAY }))
        const old = decideAge(unitInput({ record: recordAt(at, [['a', null, SEEN_BEFORE]]), candidates: names('a'), now: at + DAY, late: at + 2 * DAY }))

        expect(young).toEqual({ phase: 'young', delete: [], nextRecord: null })
        expect(old.phase).toBe('swept')
        expect(old.delete).toEqual([{ name: 'a', ifVersion: null }])
    })

    test('the later clock dates the next record, in a recorded and in a swept decision (MU3, MU28)', () => {
        const late = NOW + 5_000
        const recorded = decideAge(unitInput({ candidates: names('a'), late }))
        const swept = decideAge(unitInput({ record: recordAt(stale, [['a', null]]), candidates: names('a'), late }))

        expect(recorded.phase).toBe('recorded')
        expect(recorded.nextRecord?.at).toBe(late)
        expect(swept.phase).toBe('swept')
        expect(swept.nextRecord?.at).toBe(late)
    })

    test('a record ahead of the later clock by more than the skew restarts the clock; within the skew of the later clock it is young', () => {
        const ahead = decideAge(unitInput({
            record: recordAt(NOW + SWEEP_FUTURE_SKEW_MS + 1, [['a', null, SEEN_BEFORE]]), candidates: names('a'),
        }))
        expect(ahead).toEqual({ phase: 'recorded', delete: [], nextRecord: { v: 1, at: NOW, items: [['a', null]] } })

        const late = NOW + 3 * SWEEP_FUTURE_SKEW_MS
        const within = decideAge(unitInput({
            record: recordAt(NOW + 2 * SWEEP_FUTURE_SKEW_MS, [['a', null, SEEN_BEFORE]]), candidates: names('a'), late,
        }))
        expect(within, 'ahead of the earlier clock by more than the skew but within it of the later one').toEqual({ phase: 'young', delete: [], nextRecord: null })
    })

    test('each class is capped separately: 3 marked and 3 unmarked from 5 prior items and 5 fresh candidates (MU21)', () => {
        const prior = ['p1', 'p2', 'p3', 'p4', 'p5']
        const fresh = ['f1', 'f2', 'f3', 'f4', 'f5']
        const decision = decideAge(unitInput({
            record: recordAt(stale, prior.map((name): [string, null] => [name, null])), candidates: names(...fresh, ...prior),
        }))

        const items = decision.nextRecord?.items ?? []
        expect(items.filter(item => item[2] === SEEN_BEFORE).map(item => item[0])).toEqual(['p1', 'p2', 'p3'])
        expect(items.filter(item => item[2] !== SEEN_BEFORE)).toHaveLength(CAP)
    })

    test('the retires of one pass are capped like a class', () => {
        const marked = ['m1', 'm2', 'm3', 'm4', 'm5']
        const decision = decideAge(unitInput({
            record: recordAt(stale, marked.map((name): [string, null, number] => [name, null, SEEN_BEFORE])), candidates: names(...marked),
        }))

        expect(decision.delete.map(item => item.name)).toEqual(['m1', 'm2', 'm3'])
        expect(decision.nextRecord?.items.every(item => item[2] !== SEEN_BEFORE), 'the uncapped marked items restart unmarked').toBe(true)
    })
})
