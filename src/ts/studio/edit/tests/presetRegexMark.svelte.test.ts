// A preset regex write counts the save marks the database write hook already defines, and no more: the active
// preset's list is the top-level setting `presetRegex` (no preset block flag, no character), an inactive preset's list
// lives under `botPresets` (the preset block flag), also when the working array is shared with the slot. A refused
// batch changes and marks nothing, whichever op of the batch is the bad one. Real `$state` root, the real write hook,
// the real save marks and the real `changeToPreset`.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { WriteOp } from 'src/ts/studio/history/historyModel'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset } from 'src/ts/storage/database.svelte'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { presetAdapter } from '../presetTarget'
import { presetNamed, seedPresetDb, slotText } from './presetFixture.test-helpers'

type Row = { comment: string; in: string; out: string; type: string }

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const row = (name: string): Row => ({ comment: name, in: name, out: name, type: 'editinput' })
const insertOp = (index: number, name = 'new'): WriteOp => ({ op: 'objInsert', list: 'regex', index, entry: row(name) })
const removeOp = (index: number): WriteOp => ({ op: 'objRemove', list: 'regex', index })
const toggleOp = (value: string): WriteOp => ({ op: 'set', path: 'customModuleToggle', value: { had: true, value } })

let tracker: toSaveType
let scheduled: number
let ids: string[]

const slotRegex = (index: number): unknown => (DBState.db.botPresets[index] as unknown as { regex?: unknown }).regex
const workingRegex = (): unknown => DBState.db.presetRegex
const resetCounters = (): void => {
    scheduled = 0
    tracker.botPreset = false
    tracker.character = []
}

beforeEach(() => {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B')], 0, 'a=A')
    Object.assign(DBState.db.botPresets[0], { regex: [row('slotA')] })
    Object.assign(DBState.db.botPresets[1], { regex: [row('B0'), row('B1')] })
    DBState.db.presetRegex = [row('A0'), row('A1')] as unknown as typeof DBState.db.presetRegex
    tracker = makeTracker()
    scheduled = 0
    installCharacterSaveMarks({ tracker, schedule: () => { scheduled += 1 } })
    installDbWriteHook(DBState, { selectedChaId: () => undefined })
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
})

describe('T19: marks per copy', () => {
    test('T19a: an active regex write counts a mark with no preset flag and no character, also on a shared array', () => {
        resetCounters()
        expect(presetAdapter.write(ids[0], [insertOp(2)])).toBe(true)
        expect(workingRegex()).toHaveLength(3)
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
        expect(tracker.character).toEqual([])

        changeToPreset(0, false)
        expect(workingRegex()).toBe(slotRegex(0))
        resetCounters()
        expect(presetAdapter.write(ids[0], [{ op: 'objSet', list: 'regex', index: 0, field: 'in', value: { had: true, value: 'edited' } }])).toBe(true)
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
        expect(tracker.character).toEqual([])
    })

    test('T19b: an inactive regex write counts a mark and sets the preset flag, with no character', () => {
        expect(presetAdapter.write(ids[1], [insertOp(2)])).toBe(true)
        expect(slotRegex(1)).toHaveLength(3)
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(true)
        expect(tracker.character).toEqual([])
    })
})

describe('T19c: a refused batch marks and changes nothing', () => {
    const objSetOp = (index: number): WriteOp => ({ op: 'objSet', list: 'regex', index, field: 'in', value: { had: true, value: 'x' } })

    function expectUntouched(before: string, text: () => unknown, textBefore: unknown): void {
        expect(JSON.stringify([DBState.db.presetRegex, DBState.db.botPresets.map((slot) => (slot as unknown as { regex?: unknown }).regex)])).toBe(before)
        expect(text()).toBe(textBefore)
        expect(scheduled).toBe(0)
        expect(tracker.botPreset).toBe(false)
    }
    const listsJson = (): string => JSON.stringify([DBState.db.presetRegex, DBState.db.botPresets.map((slot) => (slot as unknown as { regex?: unknown }).regex)])

    test('a gone id, a bad index, a non-object row, a foreign field and a lore op each refuse', () => {
        const before = listsJson()
        DBState.db.botPresets[1].regex = [row('B0'), 'not an object'] as never
        const withText = listsJson()
        resetCounters()
        expect(presetAdapter.write('nope', [insertOp(0)])).toBe(false)
        expect(presetAdapter.write(ids[0], [insertOp(0), removeOp(99)])).toBe(false)
        expect(presetAdapter.write(ids[0], [insertOp(3)])).toBe(false)
        expect(presetAdapter.write(ids[1], [objSetOp(1)])).toBe(false)
        expect(presetAdapter.write(ids[0], [{ op: 'objSet', list: 'regex', index: 0, field: 'bogus', value: { had: true, value: 'x' } }])).toBe(false)
        expect(presetAdapter.write(ids[0], [{ op: 'objRemove', list: 'lore', index: 0 }])).toBe(false)
        expectUntouched(withText, () => slotText(1), 'b=B')
        expect(before).not.toBe(withText)
    })

    test('a mixed batch of a valid set, a valid insert and a bad remove changes nothing, active or inactive', () => {
        const before = listsJson()
        expect(presetAdapter.write(ids[0], [toggleOp('x'), insertOp(2), removeOp(99)])).toBe(false)
        expectUntouched(before, () => DBState.db.customPromptTemplateToggle, 'a=A')
        expect(presetAdapter.write(ids[1], [toggleOp('x'), insertOp(2), removeOp(99)])).toBe(false)
        expectUntouched(before, () => slotText(1), 'b=B')
    })

    test('a regex list that is not an array refuses as a precondition and the batch is not applied', () => {
        DBState.db.botPresets[1].regex = 'broken' as never
        const before = listsJson()
        resetCounters()
        const writes = [toggleOp('x'), insertOp(0)]
        expect(presetAdapter.check?.(ids[1], writes)).toBe('precondition')
        expect(presetAdapter.write(ids[1], writes)).toBe(false)
        expectUntouched(before, () => slotText(1), 'b=B')
        expect(presetAdapter.check?.(ids[1], [toggleOp('x')])).toBe('ok')
    })
})
