// The name a module's Low Level Access question gives the module: the owner key carries the raw stored id, so the name
// is read from the first holder of that id, including the row whose stored id looks like another row's owner id.
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/lang', () => ({ language: { modules: 'Modules' } }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: { modules: [] } } }))

import { DBState } from 'src/ts/stores.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../history/ownerPhase'
import { lowLevelAskName } from '../riskyText'

function put(...modules: unknown[]): void {
    DBState.db.modules = modules as unknown as typeof DBState.db.modules
}

beforeEach(() => {
    put()
})

describe('lowLevelAskName for a module owner', () => {
    test('a shared id names its first holder, not a later copy', () => {
        put({ id: 'X', name: 'first' }, { id: 'X', name: 'second' })
        expect(lowLevelAskName(moduleOwnerKey('X'))).toBe('first')
    })

    test('T14c the row stored as "X#1" after two rows of X names itself, not the second row of X', () => {
        put({ id: 'X', name: 'row one' }, { id: 'X', name: 'row two' }, { id: 'X#1', name: 'row three' })
        expect(lowLevelAskName(moduleOwnerKey('X#1'))).toBe('row three')
        expect(lowLevelAskName(moduleOwnerKey('X'))).toBe('row one')
    })

    test('a missing id, a blank name and a name of another type fall back to the plural label', () => {
        put({ id: 'B', name: '   ' }, { id: 'N', name: 7 })
        expect(lowLevelAskName(moduleOwnerKey('missing'))).toBe('Modules')
        expect(lowLevelAskName(moduleOwnerKey('B'))).toBe('Modules')
        expect(lowLevelAskName(moduleOwnerKey('N'))).toBe('Modules')
    })

    test('a character owner has no module name', () => {
        put({ id: 'X', name: 'first' })
        expect(lowLevelAskName(characterOwnerKey('X'))).toBe('Modules')
    })
})
