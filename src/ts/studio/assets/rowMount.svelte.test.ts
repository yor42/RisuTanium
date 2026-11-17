/**
 * The gate of the chunked first mount: how the rows of a long list split into the first flush and the queue, in which
 * order the slices take them, what `release` and `dispose` do, and that the gate is finished for good once the queue is
 * empty. The scheduler is a fake that runs a slice only when the test says so.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { createRowMount, FIRST_ROWS, setRowSliceSchedulerForTests, SLICE_ROWS } from './rowMount.svelte'

interface FakeScheduler {
    runs: (() => void)[]
    scheduled: number
    cancelled: number
}

function installScheduler(): FakeScheduler {
    const fake: FakeScheduler = { runs: [], scheduled: 0, cancelled: 0 }
    setRowSliceSchedulerForTests({
        schedule(run) {
            fake.scheduled += 1
            fake.runs.push(run)
            return () => {
                fake.cancelled += 1
                const at = fake.runs.indexOf(run)
                if (at >= 0) fake.runs.splice(at, 1)
            }
        },
    })
    return fake
}

const keysOf = (count: number): string[] => Array.from({ length: count }, (_, n) => `k${n}`)
const runNext = (fake: FakeScheduler): void => { fake.runs.shift()?.() }

afterEach(() => {
    setRowSliceSchedulerForTests(undefined)
})

describe('the first mount of a list', () => {
    test('mounts the first rows at once and defers the rest in order, asking the scheduler once', () => {
        const fake = installScheduler()
        const keys = keysOf(100)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        keys.slice(0, FIRST_ROWS).forEach((key) => expect(gate.mounted(key), key).toBe(true))
        keys.slice(FIRST_ROWS).forEach((key) => expect(gate.mounted(key), key).toBe(false))
        expect(gate.done).toBe(false)
        expect(fake.scheduled).toBe(1)
    })

    test('a list that fits the first mount is done at once and schedules nothing', () => {
        const fake = installScheduler()
        const keys = keysOf(FIRST_ROWS)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        expect(gate.done).toBe(true)
        expect(fake.scheduled).toBe(0)
        keys.forEach((key) => expect(gate.mounted(key)).toBe(true))
    })

    test('a key that was not in the initial set is mounted', () => {
        installScheduler()
        const keys = keysOf(100)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        expect(gate.mounted('late')).toBe(true)
    })
})

describe('a slice', () => {
    // No deferred row is shown, so the queue alone decides the order.
    test('mounts at most SLICE_ROWS rows, in the queue\'s order, and schedules the next slice', () => {
        const fake = installScheduler()
        const keys = keysOf(100)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => [] })
        runNext(fake)
        const mountedNow = keys.filter((key) => gate.mounted(key))
        expect(mountedNow).toEqual(keys.slice(0, FIRST_ROWS + SLICE_ROWS))
        expect(fake.scheduled).toBe(2)
        runNext(fake)
        expect(keys.filter((key) => gate.mounted(key))).toEqual(keys.slice(0, FIRST_ROWS + 2 * SLICE_ROWS))
    })

    test('takes the rows that are shown now before the rest of the queue', () => {
        const fake = installScheduler()
        const keys = keysOf(100)
        const shown = ['k90', 'k91', 'k92']
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => shown })
        runNext(fake)
        expect(shown.every((key) => gate.mounted(key))).toBe(true)
        // The remaining places of the slice go to the queue's head.
        expect(keys.slice(FIRST_ROWS, FIRST_ROWS + SLICE_ROWS - shown.length).every((key) => gate.mounted(key))).toBe(true)
        expect(gate.mounted(keys[FIRST_ROWS + SLICE_ROWS - shown.length])).toBe(false)
        expect(keys.filter((key) => gate.mounted(key))).toHaveLength(FIRST_ROWS + SLICE_ROWS)
    })

    test('is done after the last slice, mounts every key from then on and schedules nothing more', () => {
        const fake = installScheduler()
        const keys = keysOf(100)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        let slices = 0
        while (fake.runs.length > 0) {
            runNext(fake)
            slices += 1
            expect(slices).toBeLessThan(50)
        }
        expect(slices).toBe(Math.ceil((100 - FIRST_ROWS) / SLICE_ROWS))
        expect(gate.done).toBe(true)
        keys.forEach((key) => expect(gate.mounted(key), key).toBe(true))
        expect(gate.mounted('another')).toBe(true)
    })

    test('does not wait for a row that was released: the queue skips it', () => {
        const fake = installScheduler()
        const keys = keysOf(40)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        gate.release(keys.slice(32))
        expect(keys.every((key) => gate.mounted(key))).toBe(true)
        runNext(fake)
        expect(gate.done).toBe(true)
        expect(fake.runs).toHaveLength(0)
    })
})

describe('release', () => {
    test('mounts the named keys ahead of their slice and leaves the others', () => {
        installScheduler()
        const keys = keysOf(100)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        gate.release(['k50', 'k51', 'unknown'])
        expect(gate.mounted('k50')).toBe(true)
        expect(gate.mounted('k51')).toBe(true)
        expect(gate.mounted('k52')).toBe(false)
    })
})

describe('dispose', () => {
    test('cancels the scheduled slice, and a slice that still runs mounts nothing and ends nothing', () => {
        const fake = installScheduler()
        const keys = keysOf(100)
        const gate = createRowMount({ initialKeys: keys, shownKeys: () => keys })
        const stale = fake.runs[0]
        gate.dispose()
        expect(fake.cancelled).toBe(1)
        stale()
        expect(gate.mounted('k32')).toBe(false)
        expect(gate.done).toBe(false)
        expect(fake.scheduled).toBe(1)
    })
})
