/**
 * The console-free import phase ring: `noteImportPhase` records into `__risuImportPhases` only in a measurement build whose
 * `localStorage` says `on`, the ring keeps the newest 200 entries, and a failing push never reaches the import. A pass says
 * nothing about a device; the build-level proof that a normal bundle carries no trace is `util/checkReleaseDist.mjs`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const flag = vi.hoisted(() => ({ measure: true }))

vi.mock('src/ts/process/memory/measureFlag', () => ({
    get MEASURE() {
        return flag.measure
    },
}))

// The page modules `storeImport.ts` imports are not exercised here; the real ones start the application's effects.
const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/alert', inert)
vi.mock('src/ts/globalApi.svelte', inert)
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/backupWorkGuard', inert)
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/lang', inert)
vi.mock('src/ts/storage/store2/commit', inert)
vi.mock('src/ts/storage/store2/commitKey', inert)
vi.mock('src/ts/storage/store2/bootActive', inert)
vi.mock('src/ts/storage/store2/backend/errors', inert)
vi.mock('src/ts/storage/store2/lists', inert)
vi.mock('src/ts/storage/store2/saveActive', inert)
vi.mock('src/ts/storage/saveYield', inert)
vi.mock('src/ts/storage/risuSave', inert)
vi.mock('src/ts/storage/bootBlockLoad', inert)
vi.mock('src/ts/storage/store2/ui/bootText', inert)
vi.mock('src/ts/storage/store2/legacy/importTree', inert)
vi.mock('src/ts/storage/store2/legacy/storeReader', inert)
vi.mock('src/ts/storage/store2/legacy/binReader', inert)

import { IMPORT_PHASE_RING_LIMIT, noteMeasurePhase, pushImportPhase, type ImportPhaseRingHandle } from '../importPhaseRing'
import { noteImportPhase } from '../storeImport'

type RingGlobal = { __risuImportPhases?: ImportPhaseRingHandle }

function ringOf(): ImportPhaseRingHandle | undefined {
    return (globalThis as RingGlobal).__risuImportPhases
}

function setSwitch(value: string | null): void {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'risu-measure-import' ? value : null })
}

beforeEach(() => {
    flag.measure = true
    setSwitch('on')
})

afterEach(() => {
    const ring = ringOf()
    if (typeof ring?.reset === 'function') {
        ring.reset()
    }
    vi.unstubAllGlobals()
    delete (globalThis as RingGlobal).__risuImportPhases
})

describe('import phase ring', () => {
    test('records phases with time and heap, snapshot copies, reset empties', () => {
        noteImportPhase('walked')
        noteImportPhase('scanned')
        const ring = ringOf()
        expect(ring).toBeDefined()
        const snapshot = ring!.snapshot()
        expect(snapshot.map(record => record.phase)).toEqual(['walked', 'scanned'])
        expect(typeof snapshot[0].t).toBe('number')
        snapshot[0].phase = 'changed'
        expect(ring!.snapshot()[0].phase).toBe('walked')
        ring!.reset()
        expect(ring!.snapshot()).toEqual([])
    })

    test('keeps only the newest entries once past the cap', () => {
        for (let index = 0; index < IMPORT_PHASE_RING_LIMIT + 25; index++) {
            noteImportPhase(`p${index}`)
        }
        const snapshot = ringOf()!.snapshot()
        expect(snapshot).toHaveLength(IMPORT_PHASE_RING_LIMIT)
        expect(snapshot[0].phase).toBe('p25')
        expect(snapshot[snapshot.length - 1].phase).toBe(`p${IMPORT_PHASE_RING_LIMIT + 24}`)
    })

    test('a push that throws never reaches the caller', () => {
        // A read-only global makes the install assignment throw in strict code.
        Object.defineProperty(globalThis, '__risuImportPhases', { value: {}, writable: false, configurable: true })
        expect(() => noteImportPhase('walked')).not.toThrow()
        const hostile = new Proxy({}, { set() { throw new Error('refused') } })
        expect(() => pushImportPhase('walked', 1, null, hostile)).not.toThrow()
    })

    test('with the measurement flag off there is no global and nothing recorded', () => {
        flag.measure = false
        noteImportPhase('walked')
        expect(ringOf()).toBeUndefined()
    })

    test('noteMeasurePhase, used by the writers, shares the one switch and the one ring with noteImportPhase', () => {
        noteMeasurePhase('export note')
        noteImportPhase('import note')
        expect(ringOf()!.snapshot().map(record => record.phase)).toEqual(['export note', 'import note'])
        ringOf()!.reset()
        flag.measure = false
        noteMeasurePhase('export note')
        setSwitch('off')
        flag.measure = true
        noteMeasurePhase('export note')
        expect(ringOf()!.snapshot()).toEqual([])
    })

    test('with the localStorage switch not on there is no global and nothing recorded', () => {
        setSwitch(null)
        noteImportPhase('walked')
        expect(ringOf()).toBeUndefined()
        setSwitch('off')
        noteImportPhase('walked')
        expect(ringOf()).toBeUndefined()
    })
})
