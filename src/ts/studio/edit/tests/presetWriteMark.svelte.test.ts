// A preset toggle write counts the save marks the database write hook already defines, and no more: the active
// preset's text is a top-level setting (no settings block flag, no character), an inactive preset's text lives under
// `botPresets` (the preset block flag). Real `$state` root, the real write hook and the real save marks; no change
// effects are registered, so only the hook can produce the marks. The session banner is the English key.
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
import { languageEnglish } from 'src/lang/en'
import { historyBannerText } from 'src/ts/studio/history/studioHistoryService.svelte'
import { presetAdapter } from '../presetTarget'
import { presetNamed, seedPresetDb, slotText } from './presetFixture.test-helpers'

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

function setOp(value: string): WriteOp {
    return { op: 'set', path: 'customModuleToggle', value: { had: true, value } }
}

let tracker: toSaveType
let scheduled: number
let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('A', 'a=A'), presetNamed('B', 'b=B')], 0, 'a=A')
    tracker = makeTracker()
    scheduled = 0
    installCharacterSaveMarks({ tracker, schedule: () => { scheduled += 1 } })
    installDbWriteHook(DBState, { selectedChaId: () => undefined })
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
})

describe('T4: marks per copy', () => {
    test('the active preset write counts a mark before it returns, with no preset flag and no character', () => {
        expect(scheduled).toBe(0)
        expect(presetAdapter.write(ids[0], [setOp('a=new')])).toBe(true)
        expect(DBState.db.customPromptTemplateToggle).toBe('a=new')
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
        expect(tracker.character).toEqual([])
    })

    test('an inactive preset write counts a mark and sets the preset flag, with no character', () => {
        expect(presetAdapter.write(ids[1], [setOp('b=new')])).toBe(true)
        expect(slotText(1)).toBe('b=new')
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(true)
        expect(tracker.character).toEqual([])
    })

    test('a refused write marks nothing', () => {
        expect(presetAdapter.write('nope', [setOp('x')])).toBe(false)
        expect(presetAdapter.write(ids[1], [{ op: 'set', path: 'customModuleToggle', value: { had: false } }])).toBe(false)
        expect(scheduled).toBe(0)
        expect(tracker.botPreset).toBe(false)
    })
})

describe('T4: the session banner', () => {
    test('historyBannerText of a session owner is the English key', () => {
        expect(languageEnglish.studioBannerPresetSession).toBe('Preset edit history lasts until this page closes.')
        expect(historyBannerText('session')).toBe(languageEnglish.studioBannerPresetSession)
    })
})

describe('S4a-T6: the form paths mark through the same hook (compatibility guard: the hook exists before)', () => {
    const formSet = (path: 'presetJsonSchema' | 'presetSendName' | 'presetName', value: string | boolean): WriteOp => ({ op: 'set', path, value: { had: true, value } })

    test('a working-setting write of the active preset counts a mark with no preset flag', () => {
        expect(presetAdapter.write(ids[0], [formSet('presetJsonSchema', 'schema')])).toBe(true)
        expect(DBState.db.jsonSchema).toBe('schema')
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(false)
    })

    test('a slot write of an inactive preset sets the preset flag', () => {
        expect(presetAdapter.write(ids[1], [formSet('presetJsonSchema', 'schema')])).toBe(true)
        expect(DBState.db.botPresets[1].jsonSchema).toBe('schema')
        expect(scheduled).toBeGreaterThan(0)
        expect(tracker.botPreset).toBe(true)
    })

    test('the name of the active preset is a slot write and sets the preset flag', () => {
        expect(presetAdapter.write(ids[0], [formSet('presetName', 'Renamed')])).toBe(true)
        expect(DBState.db.botPresets[0].name).toBe('Renamed')
        expect(tracker.botPreset).toBe(true)
    })

    test('a container created on the working copy counts a mark (a new top-level key)', () => {
        delete (DBState.db as unknown as Record<string, unknown>).promptSettings
        expect(presetAdapter.write(ids[0], [formSet('presetSendName', true)])).toBe(true)
        expect(DBState.db.promptSettings.sendName).toBe(true)
        expect(scheduled).toBeGreaterThan(0)
    })

    test('a container key written into an inactive slot sets the preset flag', () => {
        expect(presetAdapter.write(ids[1], [formSet('presetSendName', true)])).toBe(true)
        expect(DBState.db.botPresets[1].promptSettings?.sendName).toBe(true)
        expect(tracker.botPreset).toBe(true)
    })
})