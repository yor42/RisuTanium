// S4b-T7: the model and parameter paths mark the save through the database write hook that already exists, including a
// top-level key the write itself creates (`seperateModels` on a fresh profile). Real `$state` root, the real write hook
// and the real save marks; no change effects are registered, so only the hook can produce the marks.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { WriteOp } from 'src/ts/studio/history/historyModel'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { presetAdapter } from '../presetTarget'
import { presetNamed, seedPresetDb } from './presetFixture.test-helpers'

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const setOp = (path: 'presetAuxMemory' | 'presetTemperature' | 'presetAiModel', value: string | number): WriteOp => ({ op: 'set', path, value: { had: true, value } })

let tracker: toSaveType
let scheduled: number
let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('A', 'a'), presetNamed('B', 'b')], 0, 'a')
    tracker = makeTracker()
    scheduled = 0
    installCharacterSaveMarks({ tracker, schedule: () => { scheduled += 1 } })
    installDbWriteHook(DBState, { selectedChaId: () => undefined })
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
})

describe('S4b-T7: marks per copy', () => {
    test('an auxiliary model written onto a working copy with no container creates the seed container and counts a mark', () => {
        delete (DBState.db as unknown as Record<string, unknown>).seperateModels
        expect(presetAdapter.write(ids[0], [setOp('presetAuxMemory', 'mem')])).toBe(true)
        expect(DBState.db.seperateModels).toEqual({ memory: 'mem', emotion: '', translate: '', otherAx: '' })
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
    })

    test('an auxiliary model written into an inactive slot sets the preset flag', () => {
        expect(presetAdapter.write(ids[1], [setOp('presetAuxMemory', 'mem')])).toBe(true)
        expect(DBState.db.botPresets[1].seperateModels).toEqual({ memory: 'mem', emotion: '', translate: '', otherAx: '' })
        expect(tracker.botPreset).toBe(true)
    })

    test('a number on the working copy counts a mark and on a slot sets the preset flag', () => {
        expect(presetAdapter.write(ids[0], [setOp('presetTemperature', 90)])).toBe(true)
        expect(DBState.db.temperature).toBe(90)
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
        expect(presetAdapter.write(ids[1], [setOp('presetTemperature', 91)])).toBe(true)
        expect(tracker.botPreset).toBe(true)
    })

    test('a refused number marks nothing', () => {
        expect(presetAdapter.write(ids[1], [setOp('presetTemperature', Number.NaN)])).toBe(false)
        expect(presetAdapter.write(ids[1], [setOp('presetTemperature', '90' as unknown as number)])).toBe(false)
        expect(scheduled).toBe(0)
        expect(tracker.botPreset).toBe(false)
    })
})
