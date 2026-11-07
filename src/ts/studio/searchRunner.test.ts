import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createSearchRunner, type RunnerState, type SearchWork } from './searchRunner'

// A clock that moves one millisecond per read, so a slice of 8 ms scans exactly 8 items.
function steppingClock(): () => number {
    let ticks = 0
    return () => ticks++
}

/** One unit per list; an item is a hit when it is a non-empty string. */
function listWork(lists: readonly (readonly (string | undefined)[])[]): SearchWork<string> {
    return {
        unitCount: lists.length,
        itemCount: (unit) => lists[unit].length,
        scan: (unit, index) => lists[unit][index] || null,
    }
}

const names = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${prefix}-${index}`)

interface Harness {
    states: RunnerState<string>[]
    visit: { visitId: number, modelVersion: number }
    runner: ReturnType<typeof createSearchRunner<string>>
}

function harness(limit?: number): Harness {
    const states: RunnerState<string>[] = []
    const visit = { visitId: 1, modelVersion: 1 }
    const runner = createSearchRunner<string>({
        current: () => ({ ...visit }),
        onUpdate: (state) => { states.push(state) },
        now: steppingClock(),
        limit,
    })
    return { states, visit, runner }
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('5e slices, cancellation and the cap', () => {
    test('a long scan yields between slices of a few items and finishes with every hit', () => {
        const { states, runner } = harness()
        runner.start('q', () => listWork([names('a', 60), names('b', 40)]))

        // Nothing is scanned before the first slice runs, and the page is told a search is running.
        expect(states).toHaveLength(1)
        expect(states[0]).toEqual({ results: [], more: 0, running: true })

        vi.advanceTimersToNextTimer()
        expect(states).toHaveLength(2)
        expect(states[1].running).toBe(true)
        expect(states[1].results).toHaveLength(8)
        expect(vi.getTimerCount()).toBe(1)

        vi.runAllTimers()
        const last = states[states.length - 1]
        expect(last.running).toBe(false)
        expect(last.results).toHaveLength(100)
        // 100 items in slices of 8, one update per slice and one for the start.
        expect(states.length).toBe(1 + Math.ceil(100 / 8))
        expect(vi.getTimerCount()).toBe(0)
    })

    test('a new query cancels the run in progress: none of its hits arrive afterwards', () => {
        const { states, runner } = harness()
        runner.start('a', () => listWork([names('a', 50)]))
        vi.advanceTimersToNextTimer()
        const startedSecond = states.length
        runner.start('b', () => listWork([names('b', 20)]))
        // The slice queued for the first query is gone; only the second query's is left.
        expect(vi.getTimerCount()).toBe(1)
        vi.runAllTimers()

        const after = states.slice(startedSecond)
        expect(after.length).toBeGreaterThan(0)
        for (const state of after) expect(state.results.every((hit) => hit.startsWith('b-'))).toBe(true)
        const last = states[states.length - 1]
        expect(last.running).toBe(false)
        expect(last.results).toEqual(names('b', 20))
    })

    test('hits beyond the limit are counted and not kept', () => {
        const { states, runner } = harness()
        runner.start('q', () => listWork([names('hit', 500)]))
        vi.runAllTimers()
        const last = states[states.length - 1]
        expect(last.results).toHaveLength(200)
        expect(last.more).toBe(300)
        expect(last.running).toBe(false)
        expect(last.results[199]).toBe('hit-199')
    })

    test('a custom limit applies', () => {
        const { states, runner } = harness(5)
        runner.start('q', () => listWork([names('hit', 7)]))
        vi.runAllTimers()
        expect(states[states.length - 1]).toMatchObject({ more: 2, running: false })
        expect(states[states.length - 1].results).toHaveLength(5)
    })

    test('a search with no work is idle and schedules nothing', () => {
        const { states, runner } = harness()
        runner.start('', () => null)
        expect(states).toEqual([{ results: [], more: 0, running: false }])
        expect(vi.getTimerCount()).toBe(0)
    })

    test('an empty unit and a unit with no hits are walked without a hit', () => {
        const { states, runner } = harness()
        runner.start('q', () => listWork([[], [undefined, ''], ['x']]))
        vi.runAllTimers()
        expect(states[states.length - 1]).toEqual({ results: ['x'], more: 0, running: false })
    })
})

describe('5e2 a model change restarts the query, a closed search discards it', () => {
    test('a list replaced between slices restarts the scan on the new list', () => {
        const { states, visit, runner } = harness()
        let source = names('old', 100)
        runner.start('q', () => listWork([[...source]]))
        vi.advanceTimersToNextTimer()
        expect(states[states.length - 1].results[0]).toBe('old-0')

        source = names('new', 5)
        visit.modelVersion += 1
        expect(() => vi.runAllTimers()).not.toThrow()

        const last = states[states.length - 1]
        expect(last.running).toBe(false)
        expect(last.results).toEqual(names('new', 5))
        // Nothing of the old list is in any state after the restart.
        const restart = states.findIndex((state, at) => at > 1 && state.results.length === 0 && state.running)
        expect(restart).toBeGreaterThan(1)
        for (const state of states.slice(restart)) expect(state.results.every((hit) => hit.startsWith('new-'))).toBe(true)
    })

    test('a list that shrank under a unit leaves a miss, not an error', () => {
        const { states, runner } = harness()
        const live = names('row', 30)
        // The unit reports the length it had when entered; the list then loses entries before they are read.
        const work: SearchWork<string> = {
            unitCount: 1,
            itemCount: () => live.length,
            scan: (_unit, index) => {
                if (index === 0) live.length = 3
                return live[index] || null
            },
        }
        runner.start('q', () => work)
        expect(() => vi.runAllTimers()).not.toThrow()
        expect(states[states.length - 1]).toEqual({ results: ['row-0', 'row-1', 'row-2'], more: 0, running: false })
    })

    test('closing the search discards a running scan: no further slice and no further update', () => {
        const { states, runner } = harness()
        runner.start('q', () => listWork([names('hit', 100)]))
        vi.advanceTimersToNextTimer()
        const seen = states.length
        runner.cancel()
        expect(vi.getTimerCount()).toBe(0)
        vi.runAllTimers()
        expect(states).toHaveLength(seen)
    })

    test('a scan that outlives its visit stops without an update', () => {
        const { states, visit, runner } = harness()
        runner.start('q', () => listWork([names('hit', 100)]))
        vi.advanceTimersToNextTimer()
        const seen = states.length
        visit.visitId += 1
        vi.runAllTimers()
        expect(states).toHaveLength(seen)
        expect(vi.getTimerCount()).toBe(0)
    })

    test('the restart builds its work again for the same query', () => {
        const { visit, runner } = harness()
        const build = vi.fn(() => listWork([names('hit', 30)]))
        runner.start('q', build)
        expect(build).toHaveBeenCalledTimes(1)
        vi.advanceTimersToNextTimer()
        visit.modelVersion += 1
        vi.advanceTimersToNextTimer()
        expect(build).toHaveBeenCalledTimes(2)
    })
})
