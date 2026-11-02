// @vitest-environment happy-dom

/**
 * `applyLoadout` records the current character on the loadout once: nothing is
 * pushed when no character is selected, and a character the loadout already
 * holds is not pushed again.
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

import { applyLoadout, type Loadout } from './loadout'
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
