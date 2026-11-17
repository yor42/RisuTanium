// @vitest-environment jsdom
// The id the Studio detail publishes for the selected module and the way a module owner's raw id is found. The publish is a token game: a
// detail that ends after a newer one began must not clear the newer one's id.
import { afterEach, describe, expect, test } from 'vitest'
import { buildOwnerModel } from '../ownerModel'
import { makeInput, residentModule, stubModule } from '../studioFixtures.test-helpers'
import { clearOpenModuleId, moduleRowOf, openStudioModuleId, publishOpenModuleId, resetOpenModuleIdForTests } from './openModuleForm.svelte'

afterEach(() => {
    resetOpenModuleIdForTests()
})

describe('the published id of the selected module', () => {
    test('is null until the detail publishes, and is the id after', () => {
        expect(openStudioModuleId()).toBeNull()
        publishOpenModuleId('A')
        expect(openStudioModuleId()).toBe('A')
    })

    test('clearing with the token of the latest publish ends it', () => {
        const token = publishOpenModuleId('A')
        clearOpenModuleId(token)
        expect(openStudioModuleId()).toBeNull()
    })

    test('an older form that ends after a newer one began does not clear the newer id', () => {
        const older = publishOpenModuleId('A')
        publishOpenModuleId('B')
        clearOpenModuleId(older)
        expect(openStudioModuleId()).toBe('B')
    })

    test('a form that publishes null for a shared id is read back as no open module', () => {
        publishOpenModuleId('A')
        publishOpenModuleId(null)
        expect(openStudioModuleId()).toBeNull()
    })

    test('the same form clearing twice, or after a later publish of the same id, leaves the later publish', () => {
        const first = publishOpenModuleId('A')
        publishOpenModuleId('A')
        clearOpenModuleId(first)
        clearOpenModuleId(first)
        expect(openStudioModuleId()).toBe('A')
    })
})

describe('the stored id and slot of a module owner', () => {
    test('the first row of an id is its own owner id, and a later row has the row-suffixed one', () => {
        const rows = [{ id: 'A' }, { id: 'B' }, { id: 'A' }]
        expect(moduleRowOf(rows, 'A')).toEqual({ id: 'A', index: 0 })
        expect(moduleRowOf(rows, 'B')).toEqual({ id: 'B', index: 1 })
        expect(moduleRowOf(rows, 'A#2')).toEqual({ id: 'A', index: 2 })
    })

    test('a stored id that holds a "#" is read from the row, not cut out of the owner id', () => {
        const rows = [{ id: 'a#b' }, { id: 'a#b' }]
        expect(moduleRowOf(rows, 'a#b')).toEqual({ id: 'a#b', index: 0 })
        expect(moduleRowOf(rows, 'a#b#1')).toEqual({ id: 'a#b', index: 1 })
    })

    test('an owner id no row has names nothing', () => {
        expect(moduleRowOf([{ id: 'A' }], 'A#1')).toBeNull()
        expect(moduleRowOf([], 'A')).toBeNull()
    })

    // The rule is a copy of the owner model's: every module owner it builds resolves back to the row it was built from.
    test('agrees with the owner model for resident rows, stubs and shared ids alike', () => {
        // Every row has its own name, so the owner a row resolves to can be told from another row of the same id.
        const modules = [
            residentModule('A', { name: 'row0' }), stubModule('B', { name: 'row1' }), residentModule('A', { name: 'row2' }),
            residentModule('c#1', { name: 'row3' }), stubModule('A', { name: 'row4' }), residentModule('c#1', { name: 'row5' }),
        ]
        const model = buildOwnerModel(makeInput({ modules, enabledModules: ['A', 'B', 'c#1'] }))
        const owners = [...model.modules, ...model.otherModules]
        expect(owners).toHaveLength(modules.length)
        for (const owner of owners) {
            const row = moduleRowOf(modules, owner.id)
            expect(row).not.toBeNull()
            if (row !== null) {
                expect(modules[row.index].id).toBe(row.id)
                expect(modules[row.index].name).toBe(owner.name)
            }
        }
    })
})
