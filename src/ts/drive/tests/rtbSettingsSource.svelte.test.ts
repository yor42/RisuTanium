import { describe, test, expect, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'

// The stand-in of `stores.svelte.ts` the source reads: a reactive state holding the database.
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
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

import { DBState } from 'src/ts/stores.svelte'
import { settingsSource } from 'src/ts/drive/rtbSettingsSource.svelte'
import { DEVICE_LIST_KEYS } from 'src/ts/drive/rtb/settingsPayload'
import { SETTINGS_FIELDS } from 'src/ts/drive/rtb/settingsFields'

function liveDb(reads: string[]): Database {
    const db: Record<string, unknown> = {
        theme: 'dark', temperature: 50, botPresets: [{ id: 'a', name: 'A' }], botPresetsId: 0,
        presetFolders: [], hypaV3Presets: [], hypaV3PresetId: 0, translatorPresets: [], translatorPresetId: 0,
    }
    for (const name of ['characters', 'koboldURL', 'proxyConnectionId', 'connections']) {
        let held: unknown = [{ secret: 'nope' }]
        Object.defineProperty(db, name, {
            enumerable: true,
            get() { reads.push(name); return held },
            set(value) { held = value },
        })
    }
    return db as unknown as Database
}

describe('T22 (guard): the settings source reads one value per asked key and nothing else', () => {
    test('get is a plain copy of that value; a later change of the live value is not seen through it', () => {
        const reads: string[] = []
        DBState.db = liveDb(reads)
        const source = settingsSource(['theme', 'botPresets'])
        const theme = source.get('theme')
        const presets = source.get('botPresets')
        expect(theme).toBe('dark')
        expect(presets).toEqual([{ id: 'a', name: 'A' }])
        expect(presets).not.toBe(DBState.db.botPresets)
        DBState.db.botPresets[0].name = 'changed'
        expect(presets[0].name).toBe('A')
    })

    test('a key that was not asked for throws, and no excluded value is touched', () => {
        const reads: string[] = []
        DBState.db = liveDb(reads)
        const source = settingsSource(DEVICE_LIST_KEYS)
        for (const key of DEVICE_LIST_KEYS) source.get(key)
        for (const key of ['characters', 'koboldURL', 'proxyConnectionId', 'connections', 'theme'] as const) {
            expect(() => source.get(key), key).toThrow()
        }
        expect(reads).toEqual([])
    })

    test('the export keys include no excluded field', () => {
        const reads: string[] = []
        DBState.db = liveDb(reads)
        const source = settingsSource(SETTINGS_FIELDS)
        for (const key of SETTINGS_FIELDS) source.get(key)
        expect(reads).toEqual([])
    })
})
