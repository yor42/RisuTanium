import { flushSync } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../database.svelte'
import { registerDbChangeEffects } from '../dbChangeEffects.svelte'
import { setLocked } from '../presetLocks'
import type { toSaveType } from '../risuSave'

// Compatibility guards (they pass before and after the stage 4 UI): a lock written through `setLocked` on the reactive
// settings reaches the settings block's dirty tracking, in particular the first write of `presetFieldLocks`, a key that
// is absent from a fresh database and so is added rather than changed. Same harness as dbChangeEffects.svelte.test.ts.

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as typeof import('../../stores.svelte')
})

import { DBState } from '../../stores.svelte'

function installDb(extra: Record<string, unknown> = {}) {
    DBState.db = {
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [],
        doNotChangeSeperateModels: false,
        doNotChangeFallbackModels: false,
        disableSeperateParameterChangeOnPresetChange: false,
        ...extra,
    } as unknown as Database
}

function makeTracker(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

let cleanup: (() => void) | undefined

afterEach(() => {
    cleanup?.()
    cleanup = undefined
})

function arm(): { markChanged: ReturnType<typeof vi.fn> } {
    const markChanged = vi.fn()
    cleanup = $effect.root(() => {
        registerDbChangeEffects({ tracker: makeTracker(), markChanged })
    })
    flushSync()
    markChanged.mockClear()
    return { markChanged }
}

describe('a lock write reaches the settings dirty tracking', () => {
    test('the first sampling lock on a database without presetFieldLocks marks the settings changed', () => {
        installDb()
        expect('presetFieldLocks' in DBState.db).toBe(false)
        const { markChanged } = arm()
        expect(setLocked(DBState.db, 'sampling', true)).toBe(true)
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('unlocking the group marks the settings changed again', () => {
        installDb({ presetFieldLocks: ['sampling'] })
        const { markChanged } = arm()
        setLocked(DBState.db, 'sampling', false)
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test.each([
        ['auxModels'],
        ['fallbackModels'],
        ['separateParameters'],
    ])('a legacy flag toggle (%s) marks the settings changed', (id) => {
        installDb()
        const { markChanged } = arm()
        setLocked(DBState.db, id, true)
        flushSync()
        expect(markChanged).toHaveBeenCalledWith(true)
    })

    test('a no-op toggle writes and marks nothing', () => {
        installDb()
        const { markChanged } = arm()
        expect(setLocked(DBState.db, 'reasoning', false)).toBe(false)
        flushSync()
        expect(markChanged).not.toHaveBeenCalled()
    })
})
