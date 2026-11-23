// S4c-T6 (compatibility guard: the hook exists before): a list write marks the save through the database write hook that
// already exists, on the working copy (a mark count) and in an inactive slot (the preset flag), including a container the
// write itself creates and a list that is replaced rather than mutated. Real `$state` root, the real write hook and the
// real save marks; no change effects are registered, so only the hook can produce the marks.
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

const textList = (path: 'presetModelTools' | 'presetFallbackMemory' | 'presetLocalStopStrings' | 'presetFormatingOrder', value: string[]): WriteOp => ({ op: 'set', path, value: { had: true, value } })
const biasList = (value: [string, number][]): WriteOp => ({ op: 'set', path: 'presetBias', value: { had: true, value } })

let tracker: toSaveType
let scheduled: number
let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('A', 'a'), presetNamed('B', 'b')], 0, 'a')
    const working = DBState.db as unknown as Record<string, unknown>
    working.bias = []
    working.modelTools = []
    working.formatingOrder = ['main', 'jailbreak']
    tracker = makeTracker()
    scheduled = 0
    installCharacterSaveMarks({ tracker, schedule: () => { scheduled += 1 } })
    installDbWriteHook(DBState, { selectedChaId: () => undefined })
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
})

describe('S4c-T6: marks per copy', () => {
    test('a list written to the working copy counts a mark and leaves the preset flag alone', () => {
        expect(presetAdapter.write(ids[0], [textList('presetModelTools', ['search'])])).toBe(true)
        expect(DBState.db.modelTools).toEqual(['search'])
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
        scheduled = 0
        expect(presetAdapter.write(ids[0], [biasList([['a', 5]])])).toBe(true)
        expect(DBState.db.bias).toEqual([['a', 5]])
        expect(scheduled).toBeGreaterThan(0)
    })

    test('a list written into an inactive slot sets the preset flag, also through a container the write creates', () => {
        expect(presetAdapter.write(ids[1], [textList('presetFallbackMemory', ['m'])])).toBe(true)
        expect(DBState.db.botPresets[1].fallbackModels).toEqual({ memory: ['m'], emotion: [], translate: [], otherAx: [], model: [] })
        expect(tracker.botPreset).toBe(true)
    })

    test('a fallback list written onto a working copy with no container creates the seed container and counts a mark', () => {
        delete (DBState.db as unknown as Record<string, unknown>).fallbackModels
        expect(presetAdapter.write(ids[0], [textList('presetFallbackMemory', ['m'])])).toBe(true)
        expect(DBState.db.fallbackModels).toEqual({ memory: ['m'], emotion: [], translate: [], otherAx: [], model: [] })
        expect(scheduled).toBeGreaterThan(0)
    })

    test('a stop-strings list written to a slot and an off write marks the flag', () => {
        expect(presetAdapter.write(ids[1], [textList('presetLocalStopStrings', ['x'])])).toBe(true)
        expect(tracker.botPreset).toBe(true)
        tracker.botPreset = false
        expect(presetAdapter.write(ids[1], [{ op: 'set', path: 'presetLocalStopStrings', value: { had: false } }])).toBe(true)
        expect(DBState.db.botPresets[1].localStopStrings).toBeNull()
        expect(tracker.botPreset).toBe(true)
    })

    test('a refused list marks nothing', () => {
        expect(presetAdapter.write(ids[1], [{ op: 'set', path: 'presetModelTools', value: { had: true, value: 'search' as unknown as string[] } }])).toBe(false)
        expect(presetAdapter.write(ids[1], [{ op: 'set', path: 'presetBias', value: { had: true, value: [['a', Number.NaN]] } }])).toBe(false)
        expect(presetAdapter.write(ids[1], [{ op: 'set', path: 'presetMainPrompt', value: { had: true, value: ['x'] } }])).toBe(false)
        expect(scheduled).toBe(0)
        expect(tracker.botPreset).toBe(false)
    })
})
