// @vitest-environment happy-dom

/**
 * The three retired Models-page flags (`seperateModelsForAxModels`, `auxModelUnderModelSettings`, `hideApiKey`) keep
 * their stored meaning for storage: `setDatabase`, preset save and preset apply leave the saved values as they are,
 * and the fork's preset shape matches upstream's mirror. Only the user interface and request routing stopped
 * reading them. The real `database.svelte` runs; only the modules its import graph would start effects in are
 * replaced (those of `presetMeta.test.ts`).
 */
import { describe, expect, test, vi } from 'vitest'
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

import { presetFromWorkingSettings, setDatabase, setPreset, type botPreset, type Database } from 'src/ts/storage/database.svelte'
import { setMirrorPresetApplier, upstreamSaveCurrentPreset } from 'src/ts/drive/tests/upstreamPresetMirror'

setMirrorPresetApplier(setPreset)

const SLOTS = { memory: 'm', emotion: 'e', translate: 't', otherAx: 'o' }

function working(fields: Record<string, unknown>): Database {
    return {
        botPresets: [{ name: 'P0' } as botPreset],
        botPresetsId: 0,
        NAIsettings: {},
        ...fields,
    } as unknown as Database
}

describe('PR1: preset save and apply keep the flag and the slots', () => {
    test.each([false, true])('compatibility guard (passes before and after): preset save matches upstream for the saved flag %s', (flag) => {
        const db = working({ seperateModelsForAxModels: flag, seperateModels: { ...SLOTS }, doNotChangeSeperateModels: false })

        const fork = presetFromWorkingSettings(db, 'P0', '')
        upstreamSaveCurrentPreset(db)
        const upstream = db.botPresets[0]

        expect(fork.seperateModelsForAxModels).toBe(flag)
        expect(fork.seperateModels).toEqual(SLOTS)
        expect(upstream.seperateModelsForAxModels).toBe(fork.seperateModelsForAxModels)
        expect(upstream.seperateModels).toEqual(fork.seperateModels)
    })

    test('compatibility guard (passes before and after): preset save of a profile that keeps its models writes false and no slots', () => {
        const db = working({ seperateModelsForAxModels: true, seperateModels: { ...SLOTS }, doNotChangeSeperateModels: true })

        const fork = presetFromWorkingSettings(db, 'P0', '')
        upstreamSaveCurrentPreset(db)

        expect(fork.seperateModelsForAxModels).toBe(false)
        expect(fork.seperateModels).toBeNull()
        expect(db.botPresets[0].seperateModelsForAxModels).toBe(false)
        expect(db.botPresets[0].seperateModels).toBeNull()
    })

    test.each([false, true])('compatibility guard (passes before and after): preset apply restores the preset flag %s and its slots', (flag) => {
        const preset = { name: 'P', seperateModelsForAxModels: flag, seperateModels: { ...SLOTS } } as unknown as botPreset
        const db = working({ seperateModelsForAxModels: !flag, seperateModels: { memory: '', emotion: '', translate: '', otherAx: '' }, doNotChangeSeperateModels: false })

        setPreset(db, preset)

        expect(db.seperateModelsForAxModels).toBe(flag)
        expect(db.seperateModels).toEqual(SLOTS)
    })

    test('compatibility guard (passes before and after): preset apply leaves both fields alone when the profile keeps its models', () => {
        const preset = { name: 'P', seperateModelsForAxModels: true, seperateModels: { ...SLOTS } } as unknown as botPreset
        const kept = { memory: 'k', emotion: '', translate: '', otherAx: '' }
        const db = working({ seperateModelsForAxModels: false, seperateModels: { ...kept }, doNotChangeSeperateModels: true })

        setPreset(db, preset)

        expect(db.seperateModelsForAxModels).toBe(false)
        expect(db.seperateModels).toEqual(kept)
    })
})

describe('PR1: setDatabase leaves the saved flags as they are', () => {
    test('compatibility guard (passes before and after): saved values survive normalisation', () => {
        const data = {
            hideApiKey: false,
            auxModelUnderModelSettings: true,
            seperateModelsForAxModels: false,
            seperateModels: { ...SLOTS },
        } as unknown as Database

        setDatabase(data)

        expect(data.hideApiKey).toBe(false)
        expect(data.auxModelUnderModelSettings).toBe(true)
        expect(data.seperateModelsForAxModels).toBe(false)
        expect(data.seperateModels).toEqual(SLOTS)
    })

    test('compatibility guard (passes before and after): an unset hide-key value still normalises to on', () => {
        const data = {} as unknown as Database

        setDatabase(data)

        expect(data.hideApiKey).toBe(true)
    })
})
