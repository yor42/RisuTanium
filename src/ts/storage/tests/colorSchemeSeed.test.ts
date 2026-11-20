// @vitest-environment happy-dom

/**
 * The built-in Default colour scheme is repainted in place, so saved colour data must not move:
 * `setDatabase` only fills fields that are absent. A saved copy of an older Default and a saved
 * custom scheme stay byte-identical; a fresh database and an absent custom scheme take the current
 * values. Compatibility guards: they pass before and after the retune of the Default.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: {} },
    selectedCharID: writable(-1),
    selIdState: { selId: -1 },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { setDatabase, type Database } from '../database.svelte'
import { defaultColorScheme, type ColorScheme } from '../../gui/colorscheme'
import { DBState } from '../../stores.svelte'

// An older build's Default, written as a literal on purpose: it must survive untouched.
const OLD_DEFAULT: ColorScheme = {
    bgcolor: '#282a36', darkbg: '#21222c', borderc: '#6272a4', selected: '#44475a', draculared: '#ff5555',
    textcolor: '#f8f8f2', textcolor2: '#94a3b8', darkBorderc: '#4b5563', darkbutton: '#374151', type: 'dark',
}
const OLD_CUSTOM: ColorScheme = {
    bgcolor: '#102030', darkbg: '#0a1520', borderc: '#336699', selected: '#223344', draculared: '#cc3344',
    textcolor: '#e0e8f0', textcolor2: '#8899aa', darkBorderc: '#445566', darkbutton: '#1a2a3a', type: 'dark',
}

function baseDatabase(extra: Record<string, unknown>): Database {
    return {
        characters: [],
        botPresets: [],
        botPresetsId: -1,
        personas: [],
        selectedPersona: 0,
        enabledModules: [],
        globalChatVariables: {},
        ...extra,
    } as unknown as Database
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
})

describe('colour scheme seeding', () => {
    test('an existing database keeps its saved Default copy and its saved custom scheme byte-identical', () => {
        const db = baseDatabase({
            colorSchemeName: 'default',
            colorScheme: structuredClone(OLD_DEFAULT),
            customColorScheme: structuredClone(OLD_CUSTOM),
        })
        setDatabase(db)
        expect(DBState.db.colorScheme).toEqual(OLD_DEFAULT)
        expect(DBState.db.customColorScheme).toEqual(OLD_CUSTOM)
        expect(DBState.db.colorSchemeName).toBe('default')
    })

    test('a fresh database selects the default scheme and copies the current table value', () => {
        setDatabase(baseDatabase({}))
        expect(DBState.db.colorSchemeName).toBe('default')
        expect(DBState.db.colorScheme).toEqual(defaultColorScheme)
        expect(DBState.db.customColorScheme).toEqual(defaultColorScheme)
    })

    test('with the custom scheme selected and no saved custom copy, the seed copies the working scheme', () => {
        const db = baseDatabase({ colorSchemeName: 'custom', colorScheme: structuredClone(OLD_CUSTOM) })
        setDatabase(db)
        expect(DBState.db.customColorScheme).toEqual(OLD_CUSTOM)
        expect(DBState.db.colorScheme).toEqual(OLD_CUSTOM)
    })
})
