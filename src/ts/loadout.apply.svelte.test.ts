// @vitest-environment happy-dom

/**
 * `applyLoadout` records the current character on the loadout once: nothing is
 * pushed when no character is selected, and a character the loadout already
 * holds is not pushed again.
 *
 * The preset a loadout targets is the entry its `presetId` resolves to, so a renamed
 * preset is still the one applied; a loadout without an id, or with an id that
 * resolves to nothing, applies the first preset of its stored name (upstream's rule).
 * `makeLoadout` stores the current preset's id beside its name.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const spies = vi.hoisted(() => ({ changeToPreset: vi.fn() }))

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => ({
    ...(await importOriginal()),
    changeToPreset: spies.changeToPreset,
}))

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

import { applyLoadout, loadoutPresetIndex, makeLoadout, type Loadout } from './loadout'
import { DBState, selectedCharID } from './stores.svelte'
import type { Database } from './storage/database.svelte'

function loadout(characterIds: string[]): Loadout {
    return {
        name: 'Loadout',
        id: 'loadout-id',
        lastUsed: 0,
        favorite: false,
        characterIds,
        modules: [],
        globalVariables: {},
        presetName: '',
        personaId: '',
    }
}

beforeEach(() => {
    spies.changeToPreset.mockReset()
    vi.stubGlobal('safeStructuredClone', <T>(value: T): T => JSON.parse(JSON.stringify(value)))
    DBState.db = {
        characters: [{ chaId: 'a' }],
        botPresets: [],
        botPresetsId: -1,
        personas: [],
        selectedPersona: 0,
        enabledModules: [],
        globalChatVariables: {},
    } as unknown as Database
})

describe('applyLoadout', () => {
    test('with no character selected nothing is added to the loadout', () => {
        selectedCharID.set(-1)
        const target = loadout([])

        applyLoadout(target, [])

        expect(target.characterIds).toEqual([])
    })

    test('applying twice with a character selected holds its id once', () => {
        selectedCharID.set(0)
        const target = loadout(['a'])

        applyLoadout(target, [])
        applyLoadout(target, [])

        expect(target.characterIds).toEqual(['a'])
    })

    test('a selected character the loadout does not hold is added', () => {
        selectedCharID.set(0)
        const target = loadout(['b'])

        applyLoadout(target, [])

        expect(target.characterIds).toEqual(['b', 'a'])
    })
})

function seedPresets(): void {
    DBState.db.botPresets = [
        { name: 'Alpha', id: 'id-a' },
        { name: 'Beta Renamed', id: 'id-b' },
        { name: 'Beta Renamed', id: 'id-c' },
    ] as unknown as Database['botPresets']
}

describe('applyLoadout preset target', () => {
    test('C1 regression reproducer: a renamed preset is applied by its id', () => {
        seedPresets()
        const target = { ...loadout([]), presetName: 'Beta', presetId: 'id-b' }

        applyLoadout(target, ['preset'])

        expect(spies.changeToPreset).toHaveBeenCalledTimes(1)
        expect(spies.changeToPreset).toHaveBeenCalledWith(1)
    })

    test('the id wins over an earlier preset of the same name', () => {
        seedPresets()
        const target = { ...loadout([]), presetName: 'Beta Renamed', presetId: 'id-c' }

        applyLoadout(target, ['preset'])

        expect(spies.changeToPreset).toHaveBeenCalledWith(2)
    })

    test('C3 guard: a loadout without an id applies by name (passes before and after)', () => {
        seedPresets()
        const target = { ...loadout([]), presetName: 'Alpha' }

        applyLoadout(target, ['preset'])

        expect(spies.changeToPreset).toHaveBeenCalledWith(0)
    })

    test('C3 guard: a dangling id applies by name and is not re-linked (passes before and after)', () => {
        seedPresets()
        const target = { ...loadout([]), presetName: 'Alpha', presetId: 'id-gone' }

        applyLoadout(target, ['preset'])

        expect(spies.changeToPreset).toHaveBeenCalledWith(0)
        expect(target.presetId).toBe('id-gone')
    })

    test('a loadout whose id and name resolve to nothing switches nothing', () => {
        seedPresets()
        const target = { ...loadout([]), presetName: 'Nobody', presetId: 'id-gone' }

        applyLoadout(target, ['preset'])

        expect(spies.changeToPreset).not.toHaveBeenCalled()
    })

    test('the preset is not touched when the preset option is off', () => {
        seedPresets()
        const target = { ...loadout([]), presetName: 'Alpha', presetId: 'id-a' }

        applyLoadout(target, ['modules'])

        expect(spies.changeToPreset).not.toHaveBeenCalled()
    })

    test('loadoutPresetIndex answers -1 for a missing list', () => {
        expect(loadoutPresetIndex(undefined, { presetName: 'Alpha', presetId: 'id-a' })).toBe(-1)
    })
})

describe('makeLoadout', () => {
    test('stores the current preset id beside its name', () => {
        seedPresets()
        DBState.db.botPresetsId = 1
        DBState.db.personas = [{ id: 'persona-1' }] as unknown as Database['personas']

        const made = makeLoadout({ name: 'Mine' })

        expect(made.presetName).toBe('Beta Renamed')
        expect(made.presetId).toBe('id-b')
    })
})
