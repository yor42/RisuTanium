import { describe, expect, it } from 'vitest'
import { decideAge, NODE_RECORD_CAP, SWEEP_FUTURE_SKEW_MS, SWEEP_MIN_AGE_MS, type AgeInput, type RecordRead } from '../../store2/sweep'
import { keepHolding } from './sweepFixtures'

const NOW = 10 * SWEEP_MIN_AGE_MS

function recordAt(at: number, items: [string, number | null][]): RecordRead {
    return { status: 'ok', value: { v: 1, at, items } }
}

function input(over: Partial<AgeInput>): AgeInput {
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
    const node = (over: Partial<AgeInput>): AgeInput => input({ backend: 'node', ...over })
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
