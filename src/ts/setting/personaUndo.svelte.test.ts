/**
 * The Undo for a removed persona. `DBState` is a real `$state` object, as in production, so a copy
 * that aliased a reactive proxy would show here. The real polyfill supplies `safeStructuredClone`.
 */
import 'src/ts/polyfill'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database, RisuPersona } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ holder: { db: undefined as unknown as Database } }))

vi.mock('src/ts/stores.svelte', () => ({
    get DBState() {
        return h.holder
    },
}))

import { language } from 'src/lang'
import { removePersona } from 'src/ts/personaList'
import { personaUndoAction } from './personaUndo'

function resetDb() {
    const store = $state({
        personas: [
            { name: 'a', icon: 'ia', personaPrompt: 'pa', note: 'na', id: 'id-a' },
            { name: 'b', icon: 'ib', personaPrompt: 'pb', note: 'nb', id: 'id-b' },
        ],
        selectedPersona: 0,
        username: 'a',
        userIcon: 'ia',
        personaPrompt: 'pa',
        userNote: 'na',
    })
    h.holder.db = store as unknown as Database
}

function removeB(): { copy: RisuPersona, index: number, wasActive: boolean } {
    const result = removePersona(h.holder.db, 'id-b')
    if (result === null || result === 'last') {
        throw new Error('expected a removal')
    }
    return result
}

beforeEach(resetDb)

describe('personaUndoAction', () => {
    test('U1: restores the persona with its id and reports the restored text; a second run is refused', () => {
        const { copy, index, wasActive } = removeB()
        const action = personaUndoAction(copy, index, wasActive)

        expect(action.run()).toEqual({ ok: true, text: language.settingsShellPersonaRestored })
        expect(h.holder.db.personas.map((entry) => entry.id)).toEqual(['id-a', 'id-b'])
        expect(action.run()).toEqual({ ok: false, text: language.settingsShellPersonaUndoRefused })
        expect(h.holder.db.personas).toHaveLength(2)
    })

    test('U2: carries the failed text and a stable id', () => {
        const { copy, index, wasActive } = removeB()
        const action = personaUndoAction(copy, index, wasActive)

        expect(action.failedText).toBe(language.settingsShellPersonaUndoFailed)
        expect(action.id).toBe('persona:id-b')
    })

    test('U3: closes over a copy, so a later mutation of the source does not leak in', () => {
        const { copy, index, wasActive } = removeB()
        const action = personaUndoAction(copy, index, wasActive)
        copy.name = 'mutated'

        action.run()

        expect(h.holder.db.personas[1].name).toBe('b')
        expect(h.holder.db.personas[1].id).toBe('id-b')
    })
})
