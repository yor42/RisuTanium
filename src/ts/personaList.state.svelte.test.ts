/**
 * The persona-list helpers over a real Svelte `$state` store, the shape of `DBState.db` in production.
 * `structuredClone` throws on a reactive proxy, so a clone that bypasses `safeStructuredClone` passes on
 * plain objects and fails here. The real polyfill is imported and never stubbed.
 */
import 'src/ts/polyfill'
import { describe, expect, test } from 'vitest'
import type { RisuPersona } from 'src/ts/storage/database.svelte'
import { duplicatePersona, movePersona, removePersona, restorePersona, type PersonaStore } from './personaList'

function makeStore(): PersonaStore {
    const store: PersonaStore = $state({
        personas: [
            { name: 'a', icon: 'ia', personaPrompt: 'pa', note: 'na', id: 'id-a', embeddedModule: { name: 'm', id: 'm1' } as unknown as RisuPersona['embeddedModule'] },
            { name: 'b', icon: 'ib', personaPrompt: 'pb', note: 'nb', id: 'id-b' },
            { name: 'c', icon: 'ic', personaPrompt: 'pc', note: 'nc', id: 'id-c' },
        ],
        selectedPersona: 0,
        username: 'a',
        userIcon: 'ia',
        personaPrompt: 'pa',
        userNote: 'na',
    })
    return store
}

describe('persona helpers over a $state store', () => {
    test('LS1: duplicate does not throw and the copy is independent of the source', () => {
        const db = makeStore()

        const id = duplicatePersona(db, 'id-a')

        expect(id).toBeTruthy()
        expect(id).not.toBe('id-a')
        expect(db.personas).toHaveLength(4)
        const copy = db.personas[3]
        expect(copy.id).toBe(id)
        expect(copy.name).toBe('a')
        copy.name = 'changed'
        expect(db.personas[0].name).toBe('a')
        const module = copy.embeddedModule as unknown as { name: string }
        module.name = 'changed module'
        expect((db.personas[0].embeddedModule as unknown as { name: string }).name).toBe('m')
        expect(db.username).toBe('a')
    })

    test('LS2: the removal copy is detached from the store, and restore reinserts the same id and fields', () => {
        const db = makeStore()
        const entryBefore = db.personas[1]

        const result = removePersona(db, 'id-b')
        if (result === null || result === 'last') {
            throw new Error('expected a removal')
        }
        entryBefore.name = 'mutated after removal'
        expect(result.copy.name).toBe('b')

        expect(restorePersona(db, result.copy, result.index, result.wasActive)).toBe('restored')
        expect(db.personas[1].id).toBe('id-b')
        expect(db.personas[1].name).toBe('b')
        expect(db.personas[1].icon).toBe('ib')
        expect(db.selectedPersona).toBe(0)
        expect(db.username).toBe('a')
    })

    test('LS3: move keeps the active identity and the mirror', () => {
        const db = makeStore()
        db.selectedPersona = 1
        db.username = 'b'
        db.userIcon = 'ib'
        db.personaPrompt = 'pb'
        db.userNote = 'nb'

        expect(movePersona(db, 'id-c', 0)).toBe(true)

        expect(db.personas.map((entry) => entry.id)).toEqual(['id-c', 'id-a', 'id-b'])
        expect(db.selectedPersona).toBe(2)
        expect(db.personas[db.selectedPersona].name).toBe('b')
        expect(db.username).toBe('b')
    })
})
