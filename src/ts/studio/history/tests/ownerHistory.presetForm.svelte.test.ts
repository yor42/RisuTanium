// @vitest-environment jsdom
// The preset advanced form's paths through the real history service, the real history model and the real preset adapter
// over a real `$state` database and the real `changeToPreset`: bool and enum edits replay on the copy that is live at
// that moment, a replay that would delete a required working setting is refused whole (the adapter check hook), a
// restore point that holds such a write is refused with its other paths, and the preset save keeps the auto-suggest
// prefix and clean.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
import { changeToPreset, presetFromWorkingSettings, savedPresetFor, saveCurrentPreset, type Database } from 'src/ts/storage/database.svelte'
import { presetOwnerKey } from 'src/ts/studio/edit/presetTarget'
import { keylessPreset, presetNamed, seedPresetDb } from 'src/ts/studio/edit/tests/presetFixture.test-helpers'
import { readOwnerFields } from 'src/ts/studio/ownerFields'
import { changedFieldTarget } from 'src/ts/studio/historyFocus'
import { resetStudioScreenForTests } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../ownerHistory.svelte'
import type { OwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

let service: OwnerHistoryService
let ids: string[]
let keys: OwnerKey[]

const dbBag = (): Record<string, unknown> => DBState.db as unknown as Record<string, unknown>
const slotBag = (index: number): Record<string, unknown> => DBState.db.botPresets[index] as unknown as Record<string, unknown>

function build(): void {
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({ pageSession: 'p1' }),
        claim: createClaimDouble(),
        clock: createFakeClock(1000),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => h.marks,
        registerLeaveFlush: () => () => {},
    })
}

function seed(presets = [presetNamed('A', 'a'), presetNamed('B', 'b'), presetNamed('C', 'c')], active = 0): void {
    ids = seedPresetDb(presets, active, 'a')
    keys = ids.map((id) => presetOwnerKey(id))
}

beforeEach(() => {
    h.marks = 0
    resetStudioScreenForTests()
    seed()
    build()
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('S4a-T5: the check hook keeps the working copy complete', () => {
    function seedKeyless(): void {
        const keyless = keylessPreset('K')
        delete keyless.mainPrompt
        delete keyless.jsonSchema
        seed([presetNamed('Q', 'q'), keyless], 0)
        expect(Object.hasOwn(DBState.db.botPresets[1], 'mainPrompt')).toBe(false)
    }

    test('undo of a main prompt edit made while inactive is refused after the switch and changes nothing', () => {
        seedKeyless()
        expect(service.editText(keys[1], 'presetMainPrompt', 'new prompt', 'single')).toEqual({ ok: true })
        changeToPreset(1)
        expect(dbBag().mainPrompt).toBe('new prompt')
        const before = JSON.stringify(DBState.db)
        expect(service.undo(keys[1])).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(dbBag().mainPrompt).toBe('new prompt')
        // The step stays where it was: it can still be undone once the preset is inactive again.
        expect(service.view(keys[1]).done).toHaveLength(1)
        changeToPreset(0)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(Object.hasOwn(DBState.db.botPresets[1], 'mainPrompt')).toBe(false)
    })

    test('allow arm: the same with an optional container key lands and deletes that key from the working container', () => {
        seedKeyless()
        expect(service.editValue(keys[1], 'presetTrimStartNewChat', true)).toEqual({ ok: true })
        changeToPreset(1)
        expect((dbBag().promptSettings as Record<string, unknown>).trimStartNewChat).toBe(true)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(Object.hasOwn(dbBag().promptSettings as object, 'trimStartNewChat')).toBe(false)
    })

    test('a restore point that holds a keeps write onto the now-active copy is refused whole', () => {
        seedKeyless()
        expect(service.editText(keys[1], 'presetMainPrompt', 'new prompt', 'single')).toEqual({ ok: true })
        expect(service.editText(keys[1], 'presetJsonSchema', 'schema', 'single')).toEqual({ ok: true })
        changeToPreset(1)
        const before = JSON.stringify(DBState.db)
        expect(service.restore(keys[1], new Set())).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(dbBag().jsonSchema).toBe('schema')
    })

    test('a restore point whose keeps write is not its first op is refused whole too, and nothing changes', () => {
        seedKeyless()
        // The name precedes the main prompt in the restore order, so the refused op is not first in the batch.
        expect(service.editText(keys[1], 'presetName', 'Renamed', 'single')).toEqual({ ok: true })
        expect(service.editText(keys[1], 'presetMainPrompt', 'new prompt', 'single')).toEqual({ ok: true })
        changeToPreset(1)
        const before = JSON.stringify(DBState.db)
        expect(service.restore(keys[1], new Set())).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db)).toBe(before)
        expect(dbBag().mainPrompt).toBe('new prompt')
    })
})

describe('S4a-T8: bool and enum steps replay on the copy live now, by id', () => {
    test('undo, redo and a restore point of a bool and an enum on an inactive preset, through a reorder', () => {
        expect(service.editValue(keys[1], 'presetSendName', true)).toEqual({ ok: true })
        expect(service.editText(keys[1], 'presetGroupOtherBotRole', 'system', 'single')).toEqual({ ok: true })
        expect((slotBag(1).promptSettings as Record<string, unknown>).sendName).toBe(true)
        expect(slotBag(1).groupOtherBotRole).toBe('system')
        // Move the preset to the end: the keys carry the id, not the row.
        const [moved] = DBState.db.botPresets.splice(1, 1)
        DBState.db.botPresets.push(moved)
        const row = DBState.db.botPresets.length - 1
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(slotBag(row).groupOtherBotRole).toBe('user')
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect((slotBag(row).promptSettings as Record<string, unknown>).sendName).toBe(false)
        expect(service.redo(keys[1])).toEqual({ ok: true })
        expect(service.redo(keys[1])).toEqual({ ok: true })
        expect(slotBag(row).groupOtherBotRole).toBe('system')
        expect(service.restore(keys[1], new Set())).toMatchObject({ ok: true })
        expect(slotBag(row).groupOtherBotRole).toBe('user')
        expect((slotBag(row).promptSettings as Record<string, unknown>).sendName).toBe(false)
        expect(dbBag().groupOtherBotRole).toBeUndefined()
    })

    test('a switch between the edit and its undo sends the undo to the working copy', () => {
        expect(service.editValue(keys[1], 'presetOutputImageModal', true)).toEqual({ ok: true })
        changeToPreset(1)
        expect(dbBag().outputImageModal).toBe(true)
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(dbBag().outputImageModal).toBe(false)
        expect(slotBag(1).outputImageModal).toBe(true)
    })

    test('an imported unknown enum value is put back exactly by undo', () => {
        slotBag(1).groupOtherBotRole = 'bot'
        expect(service.editText(keys[1], 'presetGroupOtherBotRole', 'user', 'single')).toEqual({ ok: true })
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(slotBag(1).groupOtherBotRole).toBe('bot')
    })
})

describe('S4a-T9: a preset that is gone', () => {
    test('a write after the preset was deleted is refused gone and nothing changes', () => {
        service.useOwner(keys[2])
        DBState.db.botPresets.splice(2, 1)
        const before = JSON.stringify(DBState.db)
        expect(service.editValue(keys[2], 'presetSendName', true)).toEqual({ ok: false, reason: 'gone' })
        expect(service.editText(keys[2], 'presetJsonSchema', 'x', 'single')).toEqual({ ok: false, reason: 'gone' })
        expect(JSON.stringify(DBState.db)).toBe(before)
    })
})

describe('S4a-T14: the intents carry their own kind of path', () => {
    test('editText refuses a bool path and editValue refuses a text path and a path the owner kind does not carry', () => {
        const before = JSON.stringify(DBState.db)
        expect(service.editText(keys[1], 'presetSendName', 'true', 'single')).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[1], 'presetJsonSchema', true)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[1], 'hideChatIcon', true)).toEqual({ ok: false, reason: 'precondition' })
        expect(service.editValue(keys[1], 'presetSendName', 'true' as never)).toEqual({ ok: false, reason: 'precondition' })
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('an unchanged bool is no step', () => {
        expect(service.editValue(keys[1], 'presetStrictJsonSchema', true)).toEqual({ ok: true, unchanged: true })
        expect(service.view(keys[1]).done).toHaveLength(0)
    })
})

describe('S4a-T13: the overwrite arm of the fallback note', () => {
    test('with the global switch on, an edit of an inactive preset is replaced when it is switched to and away again', () => {
        dbBag().doNotChangeFallbackModels = true
        dbBag().fallbackWhenBlankResponse = false
        expect(service.editValue(keys[1], 'presetFallbackWhenBlank', true)).toEqual({ ok: true })
        expect(slotBag(1).fallbackWhenBlankResponse).toBe(true)
        changeToPreset(1)
        expect(dbBag().fallbackWhenBlankResponse).toBe(false)
        changeToPreset(2)
        expect(slotBag(1).fallbackWhenBlankResponse).toBe(false)
    })
})

describe('S4a-T16 and T17: the preset save keeps the auto-suggest prefix and clean', () => {
    test('the save-on-switch of a preset keeps both keys', () => {
        dbBag().autoSuggestPrefix = ''
        dbBag().autoSuggestClean = true
        const withKeys = { ...presetFromWorkingSettings({ ...DBState.db, autoSuggestPrefix: 'pfx', autoSuggestClean: false } as unknown as Database, 'P', ''), id: ids[1] }
        DBState.db.botPresets[1] = withKeys
        expect(DBState.db.botPresets[1].autoSuggestPrefix).toBe('pfx')
        changeToPreset(1)
        expect(dbBag().autoSuggestPrefix).toBe('pfx')
        expect(dbBag().autoSuggestClean).toBe(false)
        changeToPreset(2)
        expect(slotBag(1).autoSuggestPrefix).toBe('pfx')
        expect(slotBag(1).autoSuggestClean).toBe(false)
    })

    test('the page save and the fast-forward rebuild of the saved preset are equal', () => {
        dbBag().autoSuggestPrefix = 'pfx'
        dbBag().autoSuggestClean = false
        const rebuilt = savedPresetFor(structuredClone($state.snapshot(DBState.db)) as unknown as Database, structuredClone($state.snapshot(DBState.db.botPresets[0])))
        saveCurrentPreset()
        expect($state.snapshot(DBState.db.botPresets[0])).toEqual(rebuilt)
        expect(rebuilt.autoSuggestPrefix).toBe('pfx')
        expect(rebuilt.autoSuggestClean).toBe(false)
    })
})

describe('S4a-T19 (data half): the fields read through a session owner name the changed path', () => {
    test('readOwnerFields of a preset owner reads the live copy and changedFieldTarget names the changed field', () => {
        const before = readOwnerFields(keys[1])
        expect(before).not.toBeNull()
        expect(service.editText(keys[1], 'presetJsonSchema', 'schema', 'single')).toEqual({ ok: true })
        expect(service.editText(keys[1], 'presetGroupOtherBotRole', 'system', 'single')).toEqual({ ok: true })
        const after = readOwnerFields(keys[1])
        expect(changedFieldTarget(before!, after!)).toEqual({ kind: 'presetJsonSchema' })
        const mid = readOwnerFields(keys[1])
        expect(service.undo(keys[1])).toEqual({ ok: true })
        expect(changedFieldTarget(mid!, readOwnerFields(keys[1])!)).toEqual({ kind: 'presetGroupOtherBotRole' })
    })

    test('a gone preset has no fields', () => {
        DBState.db.botPresets.splice(1, 1)
        expect(readOwnerFields(keys[1])).toBeNull()
    })
})
