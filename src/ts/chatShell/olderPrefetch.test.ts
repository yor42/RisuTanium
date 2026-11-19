import { describe, expect, test } from 'vitest'
import { DEFAULT_LOAD_MS, MAX_LOAD_MS, MAX_SPEED_PX_PER_MS, NEAR_TOP_PX, createUpwardSpeed, nextLoadEstimate, olderPrefetchDistance } from './olderPrefetch'

function run(points: [number, number][]): number {
    const tracker = createUpwardSpeed()
    for (const [top, at] of points) tracker.sample(top, at)
    return tracker.speed()
}
const free = { held: false }

describe('olderPrefetchDistance', () => {
    test('P1 the base is one screen, and never below the near-top distance', () => {
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 0, loadMs: 600, ...free })).toBe(800)
        expect(olderPrefetchDistance({ clientHeight: 0, speed: 0, loadMs: 600, ...free })).toBe(NEAR_TOP_PX)
        expect(olderPrefetchDistance({ clientHeight: 50, speed: 0, loadMs: 600, ...free })).toBe(NEAR_TOP_PX)
        expect(olderPrefetchDistance({ clientHeight: NaN, speed: 0, loadMs: 600, ...free })).toBe(NEAR_TOP_PX)
    })

    test('P2 the lead is the speed times the load time, and the default load time applies until one is measured', () => {
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 10, loadMs: 500, ...free })).toBe(5800)
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 10, loadMs: null, ...free })).toBe(800 + 10 * DEFAULT_LOAD_MS)
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 10, loadMs: null, ...free })).toBe(6800)
    })

    test('P3 no speed or a negative speed gives no lead', () => {
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 0, loadMs: 1000, ...free })).toBe(800)
        expect(olderPrefetchDistance({ clientHeight: 800, speed: -5, loadMs: 1000, ...free })).toBe(800)
    })

    test('P4 the speed and the load time are capped', () => {
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 100, loadMs: 500, ...free })).toBe(800 + MAX_SPEED_PX_PER_MS * 500)
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 10, loadMs: 5000, ...free })).toBe(800 + 10 * MAX_LOAD_MS)
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 10, loadMs: -100, ...free })).toBe(800)
    })

    test('P5 a held position keeps only the near-top distance', () => {
        expect(olderPrefetchDistance({ clientHeight: 800, speed: 25, loadMs: 1500, held: true })).toBe(NEAR_TOP_PX)
    })
})

describe('nextLoadEstimate', () => {
    test('E1 the first measurement replaces the default, a higher one counts at once and a lower one counts halfway', () => {
        expect(nextLoadEstimate(null, 420)).toBe(420)
        expect(nextLoadEstimate(420, 700)).toBe(700)
        expect(nextLoadEstimate(700, 100)).toBe(400)
    })

    test('E2 the estimate is capped', () => {
        expect(nextLoadEstimate(null, 5000)).toBe(MAX_LOAD_MS)
        expect(nextLoadEstimate(MAX_LOAD_MS, 5000)).toBe(MAX_LOAD_MS)
    })

    test('E3 a negative or non-finite measurement counts as 0', () => {
        expect(nextLoadEstimate(null, -3)).toBe(0)
        expect(nextLoadEstimate(null, NaN)).toBe(0)
    })
})

describe('createUpwardSpeed', () => {
    test('T1 fewer than three samples give no speed', () => {
        expect(run([])).toBe(0)
        expect(run([[1000, 0]])).toBe(0)
        expect(run([[1000, 0], [900, 10]])).toBe(0)
        expect(run([[1000, 0], [900, 10], [800, 20]])).toBe(10)
    })

    test('T2 a move toward newer rows ends the run', () => {
        const tracker = createUpwardSpeed()
        tracker.sample(1000, 0)
        tracker.sample(900, 10)
        tracker.sample(950, 20)
        expect(tracker.speed()).toBe(0)
        tracker.sample(850, 30)
        tracker.sample(750, 40)
        expect(tracker.speed()).toBe(10)
    })

    test('T3 a gap longer than the idle gap ends the run', () => {
        const tracker = createUpwardSpeed()
        tracker.sample(1000, 0)
        tracker.sample(900, 10)
        tracker.sample(800, 400)
        expect(tracker.speed()).toBe(0)
        tracker.sample(700, 416)
        tracker.sample(600, 432)
        expect(tracker.speed()).toBe(6.25)
    })

    test('T4 only the last samples count', () => {
        expect(run([[2000, 0], [1990, 16], [1980, 32], [1680, 48], [1380, 64], [1080, 80], [780, 96]])).toBe(18.75)
    })

    test('T5 samples that are not frame-paced give no speed, and a zero span is not a division by zero', () => {
        expect(run([[1000, 0], [990, 3], [980, 6]])).toBe(0)
        expect(run([[1000, 5], [900, 5], [800, 5]])).toBe(0)
    })

    test('T6 float jitter toward newer does not end the run, and a still reader has no speed', () => {
        expect(run([[1000, 0], [900, 16], [900.3, 32]])).toBeCloseTo((1000 - 900.3) / 32, 10)
        expect(run([[1000, 0], [1000, 16], [1000, 32]])).toBe(0)
    })

    test('T7 a clock that goes backwards ends the run', () => {
        expect(run([[1000, 50], [900, 40], [800, 60]])).toBe(0)
    })
})
