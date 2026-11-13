import { describe, expect, test } from 'vitest'
import { SLICE_BUDGET_MS, WINDOWED_SCAN_MIN_CHARS, createSlicedRunner, textWindows } from './slicedRunner'

/** A simulated clock that only the work advances. */
function clock() {
    const state = { t: 0 }
    return { state, now: () => state.t }
}

describe('createSlicedRunner', () => {
    test('yields once a slice has used its budget and not before', async () => {
        const { state, now } = clock()
        let yields = 0
        const runner = createSlicedRunner({ now, yieldToLoop: async () => { yields++ } })
        // Three 3 ms units: the third crosses the 8 ms budget.
        for (let unit = 0; unit < 2; unit++) {
            state.t += 3
            expect(await runner.checkpoint()).toBe(true)
        }
        expect(yields).toBe(0)
        state.t += 3
        expect(await runner.checkpoint()).toBe(true)
        expect(yields).toBe(1)
        expect(SLICE_BUDGET_MS).toBe(8)
    })

    test('reports the longest slice and restarts the slice clock after a yield', async () => {
        const { state, now } = clock()
        const runner = createSlicedRunner({ now, yieldToLoop: async () => { } })
        state.t += 9
        await runner.checkpoint()
        state.t += 2
        await runner.checkpoint()
        expect(runner.longestSliceMs()).toBe(9)
    })

    test('time spent waiting on a read is not compute', async () => {
        const { state, now } = clock()
        let yields = 0
        const runner = createSlicedRunner({ now, yieldToLoop: async () => { yields++ } })
        state.t += 3
        await runner.io(new Promise<void>((resolve) => setTimeout(() => { state.t += 500; resolve() }, 0)))
        state.t += 3
        await runner.checkpoint()
        expect(yields).toBe(0)
        expect(runner.longestSliceMs()).toBe(3)
    })

    test('forEach stops at an abort and runs no further unit', async () => {
        const controller = new AbortController()
        const runner = createSlicedRunner({ signal: controller.signal, now: () => 0 })
        const seen: number[] = []
        const finished = await runner.forEach([0, 1, 2, 3, 4], (item) => {
            seen.push(item)
            if (item === 2) {
                controller.abort()
            }
        })
        expect(finished).toBe(false)
        expect(seen).toEqual([0, 1, 2])
    })

    test('a checkpoint after an abort during a yield resolves false', async () => {
        const controller = new AbortController()
        const { state, now } = clock()
        const runner = createSlicedRunner({ signal: controller.signal, now, yieldToLoop: async () => { controller.abort() } })
        state.t += 9
        expect(await runner.checkpoint()).toBe(false)
    })
})

describe('textWindows', () => {
    test('a string within the limit is one window', () => {
        expect([...textWindows(1000, 50)]).toEqual([{ start: 0, end: 1000, ownedFrom: 0, ownedTo: 1000 }])
        expect([...textWindows(WINDOWED_SCAN_MIN_CHARS, 50)].length).toBe(1)
    })

    test('a long string is cut into windows that overlap by the longest match and own disjoint ranges', () => {
        const length = 1000
        const windows = [...textWindows(length, 20, 100)]
        expect(windows.length).toBeGreaterThan(1)
        let expectedFrom = 0
        for (const window of windows) {
            expect(window.ownedFrom).toBe(expectedFrom)
            expect(window.end - window.start).toBeLessThanOrEqual(100)
            expect(window.end).toBe(Math.min(length, window.ownedTo + 20))
            expectedFrom = window.ownedTo
        }
        expect(expectedFrom).toBe(length)
    })

    test('every match, including one that straddles a cut, is found once by the window that owns its start', () => {
        const needle = 'NEEDLE-NEEDLE'
        const filler = 'x'.repeat(997)
        const text = filler + needle + filler + needle + 'x'.repeat(3) + needle
        const expected: number[] = []
        for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
            expected.push(at)
        }
        for (const windowChars of [64, 100, 101, 250, 997]) {
            const found: number[] = []
            for (const window of textWindows(text.length, needle.length, windowChars)) {
                const slice = text.slice(window.start, window.end)
                for (let at = slice.indexOf(needle); at !== -1; at = slice.indexOf(needle, at + 1)) {
                    const absolute = window.start + at
                    if (absolute >= window.ownedFrom && absolute < window.ownedTo) {
                        found.push(absolute)
                    }
                }
            }
            expect(found).toEqual(expected)
        }
    })
})
