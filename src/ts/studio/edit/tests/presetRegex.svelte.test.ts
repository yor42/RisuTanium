// @vitest-environment jsdom
// The preset owner's regex list through the real history service, the real preset adapter and the real `changeToPreset`
// over a real `$state` database: every edit, undo and redo lands in the copy that is live at that moment (`db.presetRegex`
// for the active preset, the slot's `regex` for any other), a switch between two actions never strands a row, and the
// working array is never edited in place, so a slot that shares it (setPreset) stays as it was until saveCurrentPreset.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getSaveMarkCount: () => h.marks,
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { changeToPreset, saveCurrentPreset } from 'src/ts/storage/database.svelte'
import { languageEnglish } from 'src/lang/en'
import { presetOwnerKey } from 'src/ts/studio/edit/presetTarget'
import { refusalTextOf } from 'src/ts/studio/edit/studioToasts'
import { holdsObjList, isOpAllowedFor } from 'src/ts/studio/history/historyModel'
import { createOwnerHistoryService, type OwnerHistoryService } from 'src/ts/studio/history/ownerHistory.svelte'
import type { OwnerKey } from 'src/ts/studio/history/ownerPhase'
import { SESSION_OWNER_KINDS } from 'src/ts/studio/history/sessionKinds'
import { createFakeClock } from 'src/ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from 'src/ts/studio/history/tests/studioStoreDoubles'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { regexAdd, regexDelete, regexFieldEdit, type RegexOp } from '../regexListOps'
import { presetNamed, seedPresetDb } from './presetFixture.test-helpers'

type Row = Record<string, unknown>

const row = (name: string, extra: Row = {}): Row => ({ comment: name, in: `in ${name}`, out: `out ${name}`, type: 'editinput', ...extra })

let service: OwnerHistoryService
let ids: string[]
let keys: OwnerKey[]

const regexOf = (index: number): Row[] => (DBState.db.botPresets[index] as unknown as { regex: Row[] }).regex
const working = (): Row[] => DBState.db.presetRegex as unknown as Row[]
const names = (rows: Row[]): unknown[] => rows.map((entry) => entry.comment)
const edit = (index: number, op: RegexOp) => service.objEdit(keys[index], op.build)

// A: active, its working list and its slot list are distinct arrays (the shape a load produces). B: inactive. C: no key.
function seed(): void {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B'), presetNamed('C', 'c=C')], 0, 'a=A')
    keys = ids.map((id) => presetOwnerKey(id))
    Object.assign(DBState.db.botPresets[0], { regex: [row('slotA0')] })
    Object.assign(DBState.db.botPresets[1], { regex: [row('B0'), row('B1', { x_future: { a: 1 } }), row('B2')] })
    DBState.db.presetRegex = [row('A0'), row('A1')] as unknown as typeof DBState.db.presetRegex
}

beforeEach(() => {
    h.marks = 0
    resetStudioScreenForTests()
    seed()
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock: createFakeClock(1000),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
})

describe('T17: edits land in the live copy', () => {
    test('T17a: an active add and field edit change db.presetRegex only', () => {
        const slotBefore = JSON.stringify(regexOf(0))
        expect(edit(0, regexAdd())).toEqual({ ok: true })
        expect(names(working())).toEqual(['A0', 'A1', ''])
        expect(edit(0, regexFieldEdit(2, 'in', 'typed', null))).toEqual({ ok: true })
        expect(working()[2].in).toBe('typed')
        expect(JSON.stringify(regexOf(0))).toBe(slotBefore)
    })

    test('T17b: an inactive edit changes its slot only, and a slot without regex gets one', () => {
        const workingBefore = JSON.stringify(working())
        expect(edit(1, regexFieldEdit(0, 'out', 'changed', null))).toEqual({ ok: true })
        expect(regexOf(1)[0].out).toBe('changed')
        expect(JSON.stringify(working())).toBe(workingBefore)
        expect(Object.hasOwn(DBState.db.botPresets[2], 'regex')).toBe(false)
        expect(edit(2, regexAdd())).toEqual({ ok: true })
        expect(regexOf(2)).toEqual([{ comment: '', in: '', out: '', type: 'editinput' }])
        expect(JSON.stringify(working())).toBe(workingBefore)
    })

    test('T17c: a switch keeps both edits, and undo and redo after a switch land in the copy live then', () => {
        const seedA = JSON.stringify(regexOf(0))
        expect(edit(0, regexAdd())).toEqual({ ok: true })
        expect(edit(1, regexAdd())).toEqual({ ok: true })
        changeToPreset(1)
        expect(names(working())).toEqual(['B0', 'B1', 'B2', ''])
        changeToPreset(0)
        expect(names(working())).toEqual(['A0', 'A1', ''])
        expect(names(regexOf(1))).toEqual(['B0', 'B1', 'B2', ''])

        changeToPreset(1)
        const bWorking = JSON.stringify(working())
        expect(service.undo(keys[0])).toEqual({ ok: true })
        expect(names(regexOf(0))).toEqual(['A0', 'A1'])
        expect(JSON.stringify(working())).toBe(bWorking)
        expect(JSON.stringify(regexOf(1))).toBe(bWorking)

        changeToPreset(0)
        const slotAfterSwitch = JSON.stringify(regexOf(0))
        expect(service.redo(keys[0])).toEqual({ ok: true })
        expect(names(working())).toEqual(['A0', 'A1', ''])
        expect(JSON.stringify(regexOf(0))).toBe(slotAfterSwitch)
        expect(seedA).not.toBe(slotAfterSwitch)
    })

    test('T17d: the preset kind holds the regex list and no other', () => {
        expect(SESSION_OWNER_KINDS.preset.objLists).toEqual(['regex'])
        expect(holdsObjList('preset', 'regex')).toBe(true)
        expect(holdsObjList('preset', 'lore')).toBe(false)
        expect(holdsObjList('preset', 'members')).toBe(false)
        const insert = { op: 'objInsert', list: 'regex', index: 0, entry: row('x'), counts: {} } as never
        const loreInsert = { op: 'objInsert', list: 'lore', index: 0, entry: row('x'), counts: {} } as never
        expect(isOpAllowedFor('preset', insert)).toBe(true)
        expect(isOpAllowedFor('preset', loreInsert)).toBe(false)
    })

    test('T17e: a removed preset and a duplicated id refuse as gone and change nothing', () => {
        const before = JSON.stringify(DBState.db)
        DBState.db.botPresets[2].id = ids[1]
        const duplicated = JSON.stringify(DBState.db)
        expect(edit(1, regexAdd())).toEqual({ ok: false, reason: 'gone' })
        expect(refusalTextOf({ reason: 'gone' }, keys[1])).toBe(languageEnglish.studioRefusalPresetGone)
        expect(JSON.stringify(DBState.db)).toBe(duplicated)
        DBState.db.botPresets[2].id = ids[2]
        expect(JSON.stringify(DBState.db)).toBe(before)
        DBState.db.botPresets.splice(1, 1)
        const removed = JSON.stringify(DBState.db)
        expect(edit(1, regexAdd())).toEqual({ ok: false, reason: 'gone' })
        expect(JSON.stringify(DBState.db)).toBe(removed)
    })

    test('T17f: a deleted row of an inactive preset returns at its index with its unknown key', () => {
        const original = JSON.stringify(regexOf(1)[1])
        const op = regexDelete(regexOf(1)[1], 1)
        expect(edit(1, op)).toEqual({ ok: true })
        expect(names(regexOf(1))).toEqual(['B0', 'B2'])
        const deletedId = op.landedDeletedId()
        expect(deletedId).not.toBeNull()
        expect(service.restoreDeleted(keys[1], deletedId as string)).toMatchObject({ ok: true })
        expect(names(regexOf(1))).toEqual(['B0', 'B1', 'B2'])
        expect(JSON.stringify(regexOf(1)[1])).toBe(original)
    })
})

describe('T18: the working array is never edited in place', () => {
    test('T18a: an active add leaves a sharing slot as it was until saveCurrentPreset', () => {
        changeToPreset(0, false)
        expect(DBState.db.presetRegex).toBe(regexOf(0))
        const shared = regexOf(0)
        const seedJson = JSON.stringify(shared)
        expect(edit(0, regexAdd())).toEqual({ ok: true })
        expect(regexOf(0)).toBe(shared)
        expect(JSON.stringify(shared)).toBe(seedJson)
        expect(working()).not.toBe(shared)
        expect(working()).toHaveLength(shared.length + 1)
        saveCurrentPreset()
        expect(regexOf(0)).toEqual(working())
        expect(regexOf(0)).toHaveLength(shared.length + 1)
    })

    test('T18b: an active field edit leaves the sharing slot row and its unknown key as they were', () => {
        DBState.db.botPresets[0].regex = [row('S0', { x_future: { a: 1 } })] as never
        changeToPreset(0, false)
        const slotRow = regexOf(0)[0]
        const rowJson = JSON.stringify(slotRow)
        expect(edit(0, regexFieldEdit(0, 'in', 'edited', null))).toEqual({ ok: true })
        expect(regexOf(0)[0]).toBe(slotRow)
        expect(JSON.stringify(slotRow)).toBe(rowJson)
        expect(working()[0].in).toBe('edited')
        expect(working()[0].x_future).toEqual({ a: 1 })
    })
})
