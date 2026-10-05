// @vitest-environment happy-dom

/**
 * `repairBotPresetsId` on a database that has just been loaded, and the readers
 * of the current preset that must survive `-1`. The real `database.svelte`
 * (`saveCurrentPreset`, `changeToPreset`) runs against the real `DBState`, so
 * "the working settings survive the next preset switch" is shown on the code
 * that switches. Only the modules a preset switch never reaches are replaced.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))


import { repairBotPresetsId } from '../botPresetRepair'
import { currentPresetOf, setCurrentPresetImage } from '../currentPreset'
import { changeToPreset, setDatabase, type Database, type botPreset } from '../database.svelte'
import { DBState } from '../../stores.svelte'
import { makeLoadout } from '../../loadout'

function preset(name: string, mainPrompt: string): botPreset {
    return { name, mainPrompt } as unknown as botPreset
}

function databaseWith(presets: botPreset[], id: unknown, working = 'working prompt'): Database {
    return {
        characters: [],
        botPresets: presets,
        botPresetsId: id,
        mainPrompt: working,
        apiType: 'working-api',
        temperature: 77,
        NAIsettings: {},
        personas: [],
        selectedPersona: 0,
        enabledModules: [],
        globalChatVariables: {},
    } as unknown as Database
}

const BAD_IDS: Array<[string, unknown]> = [
    ['an id at the end of the list', 2],
    ['an id far past the end of the list', 40],
    ['an id below -1', -2],
    ['a fractional id', 1.5],
    ['an id that is not a number', 'one'],
    ['NaN', Number.NaN],
]

describe('repairBotPresetsId', () => {
    test.each(BAD_IDS)('%s: the working settings are appended as a new preset and the id points at it, with no stored preset overwritten', (_title, id) => {
        const stored = [preset('First', 'first prompt'), preset('Second', 'second prompt')]
        const db = databaseWith(stored, id)

        expect(repairBotPresetsId(db)).toBe(true)

        expect(db.botPresets).toHaveLength(3)
        expect(db.botPresets[0]).toMatchObject({ name: 'First', mainPrompt: 'first prompt' })
        expect(db.botPresets[1]).toMatchObject({ name: 'Second', mainPrompt: 'second prompt' })
        expect(db.botPresets[2]).toMatchObject({ name: 'New Preset', mainPrompt: 'working prompt', apiType: 'working-api', temperature: 77 })
        expect(db.botPresetsId).toBe(2)
    })

    test('an empty preset list gets the working settings as its only preset', () => {
        const db = databaseWith([], 0)

        expect(repairBotPresetsId(db)).toBe(true)

        expect(db.botPresets).toHaveLength(1)
        expect(db.botPresets[0]).toMatchObject({ name: 'New Preset', mainPrompt: 'working prompt' })
        expect(db.botPresetsId).toBe(0)
    })

    test.each([[0], [1], [-1]])('guard: id %i names a preset, or is the "no current preset" value: nothing is repaired', (id) => {
        const stored = [preset('First', 'first prompt'), preset('Second', 'second prompt')]
        const db = databaseWith(stored, id)

        expect(repairBotPresetsId(db)).toBe(false)

        expect(db.botPresets).toBe(stored)
        expect(db.botPresets).toHaveLength(2)
        expect(db.botPresetsId).toBe(id)
    })

    test('guard: an id that is not set at all is left to setDatabase', () => {
        const db = databaseWith([preset('First', 'first prompt')], undefined)

        expect(repairBotPresetsId(db)).toBe(false)

        expect(db.botPresets).toHaveLength(1)
    })

    test('switching presets afterwards keeps the working settings in the appended preset and overwrites no other', () => {
        const db = databaseWith([preset('First', 'first prompt'), preset('Second', 'second prompt')], 9)
        repairBotPresetsId(db)
        DBState.db = db

        // The person edits the working settings, then switches to the first preset.
        DBState.db.mainPrompt = 'edited working prompt'
        changeToPreset(0)

        expect(DBState.db.botPresets).toHaveLength(3)
        expect(DBState.db.botPresets[2]).toMatchObject({ name: 'New Preset', mainPrompt: 'edited working prompt' })
        expect(DBState.db.botPresets[0]).toMatchObject({ name: 'First', mainPrompt: 'first prompt' })
        expect(DBState.db.botPresets[1]).toMatchObject({ name: 'Second', mainPrompt: 'second prompt' })
        expect(DBState.db.botPresetsId).toBe(0)
    })
})

describe('setDatabase is not a load path', () => {
    test('guard: a database a plugin hands to setDatabase with an id past the end of the list is stored as it came', () => {
        const stored = [preset('First', 'first prompt')]
        const db = databaseWith(stored, 7)

        setDatabase(db)

        expect(db.botPresetsId).toBe(7)
        expect(db.botPresets).toBe(stored)
        expect(db.botPresets).toHaveLength(1)
    })
})

describe('the readers of the current preset survive -1', () => {
    beforeEach(() => {
        DBState.db = databaseWith([preset('First', 'first prompt')], -1)
    })

    test('the current preset of a database with no current preset is none', () => {
        expect(currentPresetOf(DBState.db)).toBeUndefined()
    })

    test('a loadout made with no current preset has an empty preset name and does not throw', () => {
        expect(() => makeLoadout({ name: 'Loadout' })).not.toThrow()
        expect(makeLoadout({ name: 'Loadout' }).presetName).toBe('')
    })

    test('the preset image write with no current preset does not throw and changes no preset', () => {
        expect(() => setCurrentPresetImage(DBState.db, 'data:image/jpeg;base64,AAAA')).not.toThrow()
        expect(setCurrentPresetImage(DBState.db, 'data:image/jpeg;base64,AAAA')).toBe(false)
        expect(DBState.db.botPresets[0].image).toBeUndefined()
    })

    test('guard: the preset image write sets the image of the current preset', () => {
        DBState.db.botPresetsId = 0

        expect(setCurrentPresetImage(DBState.db, 'data:image/jpeg;base64,AAAA')).toBe(true)

        expect(DBState.db.botPresets[0].image).toBe('data:image/jpeg;base64,AAAA')
    })
})
