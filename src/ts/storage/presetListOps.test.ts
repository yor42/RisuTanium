import { describe, expect, test } from 'vitest'
import type { botPreset } from './database.svelte'
import { movePresetById, movePresetIndex, newPresetFromTemplate, presetIndexById, removePresetKeepingActive, type PresetListDb } from './presetListOps'

const preset = (id: string, extra: Partial<botPreset> = {}): botPreset => ({ id, name: id.toUpperCase(), ...extra } as botPreset)

function dbOf(ids: string[], active: number): PresetListDb {
    return { botPresets: ids.map((id) => preset(id)), botPresetsId: active }
}

const idsOf = (db: PresetListDb) => db.botPresets.map((p) => p.id)

// The body classic's list ran before the extraction, kept here as the reference the extracted one must equal.
function classicMove(db: PresetListDb, fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= db.botPresets.length || toIndex > db.botPresets.length) return
    const botPresets = [...db.botPresets]
    const movedItem = botPresets.splice(fromIndex, 1)[0]
    if (!movedItem) return
    const adjustedToIndex = fromIndex < toIndex ? toIndex - 1 : toIndex
    botPresets.splice(adjustedToIndex, 0, movedItem)
    const currentId = db.botPresetsId
    if (currentId === fromIndex) db.botPresetsId = adjustedToIndex
    else if (fromIndex < currentId && adjustedToIndex >= currentId) db.botPresetsId = currentId - 1
    else if (fromIndex > currentId && adjustedToIndex <= currentId) db.botPresetsId = currentId + 1
    db.botPresets = botPresets
}

describe('movePresetIndex (compatibility guard: equals classic move; passes before and after the extraction)', () => {
    test('L-a1: every from/to/active combination ends in classic\'s list and pointer', () => {
        const ids = ['a', 'b', 'c', 'd', 'e']
        for (let active = -1; active <= 5; active++) {
            for (let from = -1; from <= 5; from++) {
                for (let to = -1; to <= 6; to++) {
                    const expected = dbOf(ids, active)
                    const actual = dbOf(ids, active)
                    classicMove(expected, from, to)
                    movePresetIndex(actual, from, to)
                    expect({ ids: idsOf(actual), active: actual.botPresetsId }, `${from}->${to} active ${active}`).toEqual({ ids: idsOf(expected), active: expected.botPresetsId })
                }
            }
        }
    })

    test('the active pointer stays on the same preset when another preset crosses it', () => {
        const db = dbOf(['a', 'b', 'c', 'd'], 2)
        movePresetIndex(db, 0, 4)
        expect(idsOf(db)).toEqual(['b', 'c', 'd', 'a'])
        expect(db.botPresets[db.botPresetsId].id).toBe('c')
    })

    test('movePresetById moves the holder of the id and refuses an unknown id', () => {
        const db = dbOf(['a', 'b', 'c'], 0)
        expect(movePresetById(db, 'c', 0)).toBe(true)
        expect(idsOf(db)).toEqual(['c', 'a', 'b'])
        expect(db.botPresets[db.botPresetsId].id).toBe('a')
        expect(movePresetById(db, 'zz', 0)).toBe(false)
        expect(idsOf(db)).toEqual(['c', 'a', 'b'])
    })
})

describe('removePresetKeepingActive', () => {
    test('L-a4: removing before the active preset shifts the pointer onto the same preset', () => {
        const db = dbOf(['a', 'b', 'c', 'd'], 2)
        expect(removePresetKeepingActive(db, 'a')).toBe(true)
        expect(idsOf(db)).toEqual(['b', 'c', 'd'])
        expect(db.botPresets[db.botPresetsId].id).toBe('c')
    })

    test('removing after the active preset leaves the pointer', () => {
        const db = dbOf(['a', 'b', 'c', 'd'], 1)
        expect(removePresetKeepingActive(db, 'd')).toBe(true)
        expect(db.botPresetsId).toBe(1)
        expect(db.botPresets[1].id).toBe('b')
    })

    test('the active preset is refused: it needs the caller\'s switch sequence', () => {
        const db = dbOf(['a', 'b'], 1)
        expect(removePresetKeepingActive(db, 'b')).toBe(false)
        expect(idsOf(db)).toEqual(['a', 'b'])
    })

    test('the only preset, an unknown id and an id with two holders are refused and nothing is written', () => {
        const only = dbOf(['a'], 0)
        expect(removePresetKeepingActive(only, 'a')).toBe(false)
        const db = dbOf(['a', 'b', 'a'], 1)
        expect(removePresetKeepingActive(db, 'a')).toBe(false)
        expect(removePresetKeepingActive(db, 'zz')).toBe(false)
        expect(idsOf(db)).toEqual(['a', 'b', 'a'])
    })

    test('L-F1: a pointer of -1 or past the end is left alone and names no preset', () => {
        const low = dbOf(['a', 'b', 'c'], -1)
        expect(removePresetKeepingActive(low, 'b')).toBe(true)
        expect(low.botPresetsId).toBe(-1)
        const high = dbOf(['a', 'b', 'c'], 9)
        expect(removePresetKeepingActive(high, 'a')).toBe(true)
        expect(high.botPresetsId).toBe(9)
    })
})

describe('presetIndexById and newPresetFromTemplate', () => {
    test('exactly one holder resolves; none, two or an empty id do not', () => {
        const list = [preset('a'), preset('b'), preset('a')]
        expect(presetIndexById(list, 'b')).toBe(1)
        expect(presetIndexById(list, 'a')).toBe(-1)
        expect(presetIndexById(list, 'x')).toBe(-1)
        expect(presetIndexById(list, '')).toBe(-1)
    })

    test('L-a9: a new preset has a fresh id, no folder, no slot and the given name; the template is untouched', () => {
        const template = preset('tpl', { folderId: 'f1', slot: 3 })
        const created = newPresetFromTemplate(template, 'N', (value) => structuredClone(value))
        expect(created.name).toBe('N')
        expect(created.id).not.toBe('tpl')
        expect(created.folderId).toBeUndefined()
        expect(created.slot).toBeUndefined()
        expect(template).toMatchObject({ id: 'tpl', folderId: 'f1', slot: 3, name: 'TPL' })
    })
})
