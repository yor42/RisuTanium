// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createLiveCheckGate, LIVE_CHECK_IDLE_INTERVAL_MS, type LiveCheckSignal } from '../../store2/liveCheckGate'

/**
 * `createLiveCheckGate` decides when `liveCheck` walks the character list. Labels: new-rule tests. On the base the module
 * does not exist, so these fail at import and are guards by construction, not reproducers; the behavioural reproducer
 * is in liveCheckGateWiring.svelte.test.ts.
 */

const START = 1_700_000_000_000
const db = {}
const characters: object[] = []

function quiet(): LiveCheckSignal {
    return { db, characters, length: 3, marks: 7, dirty: false, due: false, failed: false }
}

/** A gate that walked at `START` over the quiet reading. */
function walkedGate(intervalMs?: number) {
    const gate = createLiveCheckGate({ intervalMs })
    gate.walked(quiet(), START)
    return gate
}

describe('the first call', () => {
    test('walks, whatever the reading', () => {
        expect(createLiveCheckGate().due(quiet(), START)).toBe(true)
    })

    test('a call that is not followed by walked() keeps the gate due', () => {
        const gate = createLiveCheckGate()
        expect(gate.due(quiet(), START)).toBe(true)
        expect(gate.due(quiet(), START + 1)).toBe(true)
    })
})

describe('a quiet reading is not due until the interval has passed', () => {
    test('the same reading right after a walk is not due', () => {
        expect(walkedGate().due(quiet(), START)).toBe(false)
        expect(walkedGate().due(quiet(), START + 1)).toBe(false)
    })

    test('29.9 s is not due and 30 s is due, from the walk and not from the first call', () => {
        const gate = walkedGate()
        expect(LIVE_CHECK_IDLE_INTERVAL_MS).toBe(30_000)
        expect(gate.due(quiet(), START + 29_999)).toBe(false)
        expect(gate.due(quiet(), START + 30_000)).toBe(true)
    })

    test('the interval is a parameter', () => {
        const gate = walkedGate(5_000)
        expect(gate.due(quiet(), START + 4_999)).toBe(false)
        expect(gate.due(quiet(), START + 5_000)).toBe(true)
    })

    test('a clock that moved backwards is due, so a stepped-back clock cannot stall the walk', () => {
        expect(walkedGate().due(quiet(), START - 1)).toBe(true)
    })
})

describe('each signal alone makes the gate due', () => {
    const changes: Array<[string, Partial<LiveCheckSignal>]> = [
        ['a replaced database object', { db: {} }],
        ['a database that appears', { db: undefined }],
        ['a replaced character array', { characters: [] }],
        ['a character array that goes away', { characters: null }],
        ['a changed length', { length: 4 }],
        ['a shorter list', { length: 2 }],
        ['a save mark', { marks: 8 }],
        ['dirty edits', { dirty: true }],
        ['a pass that is due', { due: true }],
        ['a failed last pass', { failed: true }],
    ]

    test.each(changes)('%s', (_name, change) => {
        const gate = walkedGate()
        expect(gate.due({ ...quiet(), ...change }, START + 1)).toBe(true)
    })

    test('the unchanged reading beside them stays not due', () => {
        expect(walkedGate().due({ ...quiet() }, START + 1)).toBe(false)
    })
})

describe('walked() records the reading and the time', () => {
    test('after a walk at the changed reading the same reading is quiet again', () => {
        const gate = walkedGate()
        const changed = { ...quiet(), marks: 8, length: 4, characters: [], db: {} }
        expect(gate.due(changed, START + 1)).toBe(true)
        gate.walked(changed, START + 1)
        expect(gate.due(changed, START + 2)).toBe(false)
    })

    test('the interval restarts at the latest walk', () => {
        const gate = walkedGate()
        gate.walked(quiet(), START + 20_000)
        expect(gate.due(quiet(), START + 30_000)).toBe(false)
        expect(gate.due(quiet(), START + 49_999)).toBe(false)
        expect(gate.due(quiet(), START + 50_000)).toBe(true)
    })

    test('a later reading is compared with the last walked one, not the first', () => {
        const gate = walkedGate()
        gate.walked({ ...quiet(), marks: 9 }, START + 1)
        expect(gate.due({ ...quiet(), marks: 8 }, START + 2)).toBe(true)
        expect(gate.due({ ...quiet(), marks: 9 }, START + 2)).toBe(false)
    })

    test('a stored reading is a copy: mutating the caller\'s object later does not change what was recorded', () => {
        const gate = createLiveCheckGate()
        const reading = quiet()
        gate.walked(reading, START)
        reading.marks = 99
        expect(gate.due(quiet(), START + 1)).toBe(false)
    })
})

describe('a failed last pass', () => {
    test('stays due on every call while the pass keeps failing, and is quiet once the failure is gone', () => {
        const gate = walkedGate()
        const failing = { ...quiet(), failed: true }
        for (let step = 1; step <= 3; step++) {
            expect(gate.due(failing, START + step)).toBe(true)
            gate.walked(failing, START + step)
        }
        expect(gate.due(quiet(), START + 4)).toBe(false)
    })

    test('is due inside the quiet window, long before the interval', () => {
        expect(walkedGate().due({ ...quiet(), failed: true }, START + 1_000)).toBe(true)
    })
})
