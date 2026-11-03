import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../database.svelte'
import { registerDbChangeEffects } from '../dbChangeEffects.svelte'
import type { toSaveType } from '../risuSave'
import { resetTopLevelChangesForTests, topLevelChangeCount } from '../topLevelChanges'

// The settings-level change counter: every save effect that covers a non-character top-level key bumps it on a
// run after its first, and the character partitions and the identity tracker never do. A reader that stores the
// count and compares it later therefore learns whether any setting changed, without comparing values.

//#region module mocks

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../stores.svelte')
})

//#endregion

import { DBState, selectedCharID } from '../../stores.svelte'

function installDb() {
    DBState.db = {
        botPresetsId: 0,
        botPresets: [{ name: 'Preset 0', promptTemplate: [{ text: 'a' }] }],
        modules: [{ id: 'm0', name: 'Module', lorebook: [] }],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        personas: [{ name: 'A', note: '' }],
        zoomsize: 100,
        characters: [{
            chaId: 'c0',
            name: 'Char',
            chatPage: 0,
            chats: [{ id: 'chat0', message: [{ role: 'char', data: 'hello' }] }],
        }],
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

let cleanup: (() => void) | undefined

function register() {
    installDb()
    selectedCharID.set(0)
    const tracker = makeTracker()
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker, markChanged: vi.fn() })
    })
    flushSync()
}

/** The count change caused by one mutation, after the registration has settled. */
function countAfter(mutate: () => void): number {
    const before = topLevelChangeCount()
    mutate()
    flushSync()
    return topLevelChangeCount() - before
}

afterEach(() => {
    cleanup?.()
    cleanup = undefined
    selectedCharID.set(-1)
    resetTopLevelChangesForTests()
})

describe('settings-level change counter', () => {
    test('registration and every first run count nothing', () => {
        resetTopLevelChangesForTests()
        register()
        expect(topLevelChangeCount()).toBe(0)
    })

    test('a primitive top-level write counts', () => {
        register()
        expect(countAfter(() => { DBState.db.zoomsize = 120 })).toBeGreaterThan(0)
    })

    test('an in-place nested write counts', () => {
        register()
        expect(countAfter(() => { DBState.db.personas[0].name = 'B' })).toBeGreaterThan(0)
    })

    test('a preset rename in place counts', () => {
        register()
        expect(countAfter(() => { DBState.db.botPresets[0].name = 'renamed' })).toBeGreaterThan(0)
    })

    test('a module leaf write counts', () => {
        register()
        expect(countAfter(() => { DBState.db.modules[0].name = 'Renamed' })).toBeGreaterThan(0)
    })

    test('a module push counts', () => {
        register()
        expect(countAfter(() => { DBState.db.modules.push({ id: 'm1', name: 'Second', lorebook: [] } as never) })).toBeGreaterThan(0)
    })

    test('a loadouts write counts', () => {
        register()
        expect(countAfter(() => { DBState.db.loadouts.push({ name: 'L' } as never) })).toBeGreaterThan(0)
    })

    test('a plugins write counts', () => {
        register()
        expect(countAfter(() => { DBState.db.plugins.push({ name: 'P' } as never) })).toBeGreaterThan(0)
    })

    test('a pluginCustomStorage write counts', () => {
        register()
        expect(countAfter(() => { DBState.db.pluginCustomStorage['k'] = 'v' })).toBeGreaterThan(0)
    })

    test('a character field write counts nothing', () => {
        register()
        expect(countAfter(() => { DBState.db.characters[0].name = 'Renamed' })).toBe(0)
    })

    test('a message push counts nothing', () => {
        register()
        expect(countAfter(() => {
            DBState.db.characters[0].chats[0].message.push({ role: 'user', data: 'more' } as never)
        })).toBe(0)
    })

    test('adding a character counts nothing', () => {
        register()
        expect(countAfter(() => {
            DBState.db.characters.push({
                chaId: 'c1', name: 'Other', chatPage: 0,
                chats: [{ id: 'chat1', message: [] }],
            } as never)
        })).toBe(0)
    })
})
