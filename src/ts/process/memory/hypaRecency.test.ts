/**
 * Pure recency helpers: no database, store or network mocks are involved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    DAY_MS,
    effectiveHalfLifeDays,
    mergedCreatedAt,
    rankByRecency,
    recencyHalfLives,
    recencyLookup,
    summaryCreatedAt,
    weightedShuffle,
} from './hypaRecency'

const NOW = 1_763_424_000_000
const u = (): { createdAt?: number } => ({})
const t = (ms: number): { createdAt?: number } => ({ createdAt: ms })
const BAD_HALF_LIVES: (number | null | undefined)[] = [NaN, 0, -3, null, undefined, Infinity, 1 / 2880, 1e-310]

afterEach(() => {
    vi.restoreAllMocks()
})

/** Deterministic generator so the statistical assertions cannot flake. */
function mulberry32(seed: number) {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let x = Math.imul(a ^ (a >>> 15), 1 | a)
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
}

describe('summaryCreatedAt', () => {
    // compatibility guard: new API, pins the defensive read
    it('a finite positive number is a time; every other value is untimed', () => {
        expect(summaryCreatedAt({ createdAt: 1.7e12 })).toBe(1.7e12)
        const bad: unknown[] = [undefined, null, NaN, Infinity, 0, -1, '2026-11-18']
        for (const value of bad) {
            expect(summaryCreatedAt({ createdAt: value as number })).toBeUndefined()
        }
        expect(summaryCreatedAt({})).toBeUndefined()
    })
})

describe('effectiveHalfLifeDays', () => {
    // compatibility guard: new API
    it('keeps finite values of at least one minute and falls back to 30 days otherwise', () => {
        expect(effectiveHalfLifeDays(14)).toBe(14)
        expect(effectiveHalfLifeDays(0.5)).toBe(0.5)
        expect(effectiveHalfLifeDays(1 / 1440)).toBe(1 / 1440)
        for (const value of BAD_HALF_LIVES) expect(effectiveHalfLifeDays(value)).toBe(30)
    })
})

describe('recencyHalfLives', () => {
    // compatibility guard: new API
    it('timed summaries age in half-lives and a future time counts as age 0', () => {
        expect(recencyHalfLives([t(NOW)], NOW, 10)).toEqual([0])
        expect(recencyHalfLives([t(NOW - 10 * DAY_MS)], NOW, 10)).toEqual([1])
        expect(recencyHalfLives([t(NOW + 5 * DAY_MS)], NOW, 10)).toEqual([0])
    })

    // compatibility guard: new API; kills a skipped guard in recencyHalfLives and recencyLookup
    it('a bad half-life gives exactly the 30-day result, finite, in the helper and the lookup', () => {
        const fixture = [u(), t(NOW - 10 * DAY_MS), t(NOW)]
        const expected = recencyHalfLives(fixture, NOW, 30)
        expect(expected).toEqual([1 + 10 / 30, 10 / 30, 0])
        const reference = recencyLookup(fixture, NOW, 30)
        for (const value of BAD_HALF_LIVES) {
            const result = recencyHalfLives(fixture, NOW, value)
            expect(result).toEqual(expected)
            for (const entry of result) expect(Number.isFinite(entry)).toBe(true)
            const lookup = recencyLookup(fixture, NOW, value)
            for (const item of fixture) expect(lookup(item)).toBe(reference(item))
        }
    })

    // compatibility guard: new API
    it('untimed summaries sit above the oldest timed one, earliest first, spanning one half-life', () => {
        expect(recencyHalfLives([u(), u(), t(NOW - 10 * DAY_MS), t(NOW)], NOW, 10)).toEqual([2, 1.5, 1, 0])
        expect(recencyHalfLives([u(), u(), u(), u()], NOW, 10)).toEqual([1, 0.75, 0.5, 0.25])
        expect(recencyHalfLives([t(NOW), u()], NOW, 10)).toEqual([0, 1])
        expect(recencyHalfLives([{ createdAt: 'x' as unknown as number }, t(NOW)], NOW, 10)).toEqual([1, 0])
    })

    // compatibility guard: new API
    it('recencyLookup answers by object identity and gives 0 to an unknown item', () => {
        const a = t(NOW - 10 * DAY_MS)
        const b = t(NOW)
        const lookup = recencyLookup([a, b], NOW, 10)
        expect(lookup(a)).toBe(1)
        expect(lookup(b)).toBe(0)
        expect(lookup(t(NOW - 20 * DAY_MS))).toBe(0)
    })
})

describe('rankByRecency', () => {
    // compatibility guard: new API
    it('a lower score loses to a much newer one; ties keep input order or favor the newer', () => {
        expect(rankByRecency([['A', 1 / 61], ['B', 1 / 62]], (item) => (item === 'A' ? 1 : 0))).toEqual(['B', 'A'])
        expect(rankByRecency([['A', 1 / 61], ['B', 1 / 62]], () => 0)).toEqual(['A', 'B'])
        expect(rankByRecency([['A', 1], ['B', 1]], (item) => (item === 'A' ? 2 : 1))).toEqual(['B', 'A'])
        expect(rankByRecency([['P', 0], ['Q', 0]], () => 0)).toEqual(['P', 'Q'])
    })

    // compatibility guard: new API; linear weights would underflow both to 0 and keep input order
    it('a very old summary does not underflow to weight 0', () => {
        const halfLives: Record<string, number> = { X: 3000, Y: 2000 }
        expect(rankByRecency([['X', 1 / 61], ['Y', 1 / 62]], (item) => halfLives[item])).toEqual(['Y', 'X'])
    })
})

describe('weightedShuffle', () => {
    // compatibility guard: new API
    it('returns a permutation and draws one random number per item', () => {
        const random = vi.spyOn(Math, 'random').mockImplementation(mulberry32(7))
        const result = weightedShuffle([0, 1, 2, 3], () => 0)
        expect([...result].sort()).toEqual([0, 1, 2, 3])
        expect(random).toHaveBeenCalledTimes(4)
    })

    // compatibility guard: new API
    it('first picks follow the weights 2^-halfLives', () => {
        vi.spyOn(Math, 'random').mockImplementation(mulberry32(20260101))
        const halfLives = [2, 1, 0]
        const counts = [0, 0, 0]
        const draws = 10000
        for (let i = 0; i < draws; i++) counts[weightedShuffle([0, 1, 2], (item) => halfLives[item])[0]]++
        const expected = [1 / 7, 2 / 7, 4 / 7]
        counts.forEach((count, i) => expect(Math.abs(count / draws - expected[i])).toBeLessThan(0.02))
    })

    // compatibility guard: new API
    it('equal half-lives give a uniform first pick', () => {
        vi.spyOn(Math, 'random').mockImplementation(mulberry32(99))
        const counts = [0, 0, 0]
        const draws = 10000
        for (let i = 0; i < draws; i++) counts[weightedShuffle([0, 1, 2], () => 3)[0]]++
        counts.forEach((count) => expect(Math.abs(count / draws - 1 / 3)).toBeLessThan(0.02))
    })

    // compatibility guard: new API
    it('a vastly older item never comes first', () => {
        vi.spyOn(Math, 'random').mockImplementation(mulberry32(5))
        for (let i = 0; i < 500; i++) {
            expect(weightedShuffle(['old', 'new'], (item) => (item === 'old' ? 5000 : 0))[0]).toBe('new')
        }
    })
})

describe('mergedCreatedAt', () => {
    // compatibility guard: new API
    it('is the earliest time when every source is timed and no time otherwise', () => {
        const T1 = NOW - 5 * DAY_MS
        const T2 = NOW - 2 * DAY_MS
        const T3 = NOW - DAY_MS
        expect(mergedCreatedAt([t(T3), t(T1), t(T2)])).toBe(T1)
        expect(mergedCreatedAt([])).toBeUndefined()
        expect(mergedCreatedAt([u(), u()])).toBeUndefined()
        expect(mergedCreatedAt([u(), t(T1)])).toBeUndefined()
        expect(mergedCreatedAt([t(T1), u()])).toBeUndefined()
        expect(mergedCreatedAt([t(T1), { createdAt: 'x' as unknown as number }])).toBeUndefined()
    })
})
