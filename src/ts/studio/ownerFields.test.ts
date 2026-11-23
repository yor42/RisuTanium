// @vitest-environment jsdom
// T5-FOCUS-RO: a module owner's fields are read through the published open-module id, a foreign reading is a tagged
// value that never equals a typed one, and two reads of an unchanged foreign value compare equal.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0 }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

import { DBState } from 'src/ts/stores.svelte'
import { publishOpenModuleId, resetOpenModuleIdForTests } from './assets/openModuleForm.svelte'
import { moduleOwnerKey } from './history/ownerPhase'
import { changedFieldTarget, isForeignFieldRead } from './historyFocus'
import { readOwnerFields } from './ownerFields'

const M1 = moduleOwnerKey('M1')

function putModule(extra: Record<string, unknown>): void {
    DBState.db.modules = [{ id: 'M1', name: 'N', description: 'd', ...extra }] as unknown as typeof DBState.db.modules
}

function read(): NonNullable<ReturnType<typeof readOwnerFields>> {
    const fields = readOwnerFields(M1)
    if (fields === null) {
        throw new Error('the module owner was not resolved')
    }
    return fields
}

beforeEach(() => {
    resetOpenModuleIdForTests()
})

afterEach(() => {
    resetOpenModuleIdForTests()
    DBState.db.modules = [] as unknown as typeof DBState.db.modules
})

describe('T5-FOCUS-RO: readOwnerFields for a module owner', () => {
    test('it reads the module while its id is published and is null when it is not', () => {
        putModule({ namespace: 'ns', hideIcon: true, backgroundEmbedding: 'bg' })
        expect(readOwnerFields(M1)).toBeNull()
        publishOpenModuleId('M1')
        const fields = read()
        expect(fields.greetings).toEqual([])
        expect(fields.moduleName).toBe('N')
        expect(fields.moduleDescription).toBe('d')
        expect(fields.moduleNamespace).toBe('ns')
        expect(fields.moduleHideIcon).toBe(true)
        expect(fields.moduleLowLevelAccess).toBeUndefined()
        expect(fields.backgroundEmbedding).toBe('bg')
        publishOpenModuleId('M2')
        expect(readOwnerFields(M1)).toBeNull()
    })

    test('two reads of an unchanged foreign object value compare equal', () => {
        putModule({ hideIcon: { x: 1, y: [1, { z: null }] }, namespace: null })
        publishOpenModuleId('M1')
        const first = read()
        const second = read()
        expect(isForeignFieldRead(first.moduleHideIcon)).toBe(true)
        expect(first.moduleHideIcon).not.toBe(second.moduleHideIcon)
        expect(changedFieldTarget(first, second)).toBeNull()
    })

    test('a changed foreign value is a change', () => {
        putModule({ hideIcon: { x: 1 } })
        publishOpenModuleId('M1')
        const first = read()
        putModule({ hideIcon: { x: 2 } })
        expect(changedFieldTarget(first, read())).toEqual({ kind: 'moduleHideIcon' })
    })

    test.each([
        ['5', 5],
        ['true', true],
    ])('a foreign %s never equals the typed text of the same spelling, in both directions', (typedText, foreignValue) => {
        publishOpenModuleId('M1')
        putModule({ name: foreignValue })
        const foreign = read()
        putModule({ name: typedText })
        const typed = read()
        expect(changedFieldTarget(foreign, typed)).toEqual({ kind: 'moduleName' })
        expect(changedFieldTarget(typed, foreign)).toEqual({ kind: 'moduleName' })
    })

    test('a foreign value against an absent one is a change', () => {
        publishOpenModuleId('M1')
        putModule({ namespace: null })
        const foreign = read()
        putModule({})
        expect(changedFieldTarget(foreign, read())).toEqual({ kind: 'moduleNamespace' })
    })
})
