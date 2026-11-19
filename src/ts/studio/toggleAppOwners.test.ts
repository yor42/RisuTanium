import { describe, expect, test, vi } from 'vitest'

const store = vi.hoisted(() => ({ db: {} as Record<string, unknown> }))
vi.mock('../stores.svelte', () => ({
    get DBState() { return store },
}))

import { makeCharacter, makeInput, makePreset, residentModule, studioDbOf } from './studioFixtures.test-helpers'
import { appToggleOwners } from './toggleAppOwners'

/**
 * AO-1, class G (new behaviour guard): the module is new, so its red proof is the named mutant. The database is laid
 * out as the app holds it (`studioDbOf`), with the extra characters added the way the character list holds them.
 */

type Row = Record<string, unknown>
const character = (chaId: string, name: string, extra: Row = {}): Row => ({ ...makeCharacter({ chaId, name }), type: 'character', ...extra })

function setDb(characters: Row[], presets = [makePreset('Zero', { toggles: 'stored0=S0' }), makePreset('One', { toggles: 'stored1=S1' })], activePreset = 1, working = 'working=W'): void {
    const base = studioDbOf(makeInput({ presets, activePreset, modules: [residentModule('m', { customModuleToggle: 'mod=Mod' })] }))
    store.db = { ...base, characters: [...base.characters.slice(0, 1), ...characters], customPromptTemplateToggle: working }
}

describe('AO-1 appToggleOwners', () => {
    test('names the other resident characters and the non-active presets, and not the bound character or the active preset', () => {
        setDb([
            character('B', 'Bea', { customModuleToggle: 'tone=Tone\nonlyb=B' }),
            character('C', 'Cy', { customModuleToggle: 'tone=Tone' }),
        ])
        const bound = store.db.characters as Row[]
        bound[0].customModuleToggle = 'bound=Bound'
        const owners = appToggleOwners('cha-1', 1)
        expect([...owners.entries()]).toStrictEqual([
            ['tone', ['Bea', 'Cy']],
            ['onlyb', ['Bea']],
            ['stored0', ['Zero']],
        ])
        expect(owners.has('bound')).toBe(false)
        expect(owners.has('stored1')).toBe(false)
        expect(owners.has('working')).toBe(false)
    })

    test('the active preset is read from the working settings, not its stored entry', () => {
        setDb([], undefined, 0, 'working=W')
        expect([...appToggleOwners('cha-1', 1).entries()]).toStrictEqual([['working', ['Zero']]])
        expect([...appToggleOwners('cha-1', 0).entries()]).toStrictEqual([['stored1', ['One']]])
    })

    test('a private, cold-storage or group character is skipped: neither its keys nor its name appear', () => {
        setDb([
            character('P', 'Pia', { license: 'private', customModuleToggle: 'secret=S' }),
            character('Cold', 'Cole', { coldstorage: 'unit-1', customModuleToggle: 'cold=C' }),
            { chaId: 'G', type: 'group', name: 'Gus', customModuleToggle: 'group=G' },
            character('Ok', 'Olive', { customModuleToggle: 'ok=Ok' }),
        ])
        const owners = appToggleOwners('cha-1', 1)
        expect([...owners.entries()].filter(([, names]) => !names.includes('Zero'))).toStrictEqual([['ok', ['Olive']]])
        expect(JSON.stringify([...owners.entries()])).not.toMatch(/Pia|Cole|Gus|secret|cold|group/)
    })

    test('a character without toggle text, a non-string text and an empty slot add nothing', () => {
        setDb([character('B', 'Bea'), character('C', 'Cy', { customModuleToggle: 7 }), null as unknown as Row])
        expect([...appToggleOwners('cha-1', 1).keys()]).toStrictEqual(['stored0'])
    })

    test('modules are not read, and keys are exact', () => {
        setDb([character('B', 'Bea', { customModuleToggle: 'Tone=A\ntone =B' })])
        const owners = appToggleOwners('cha-1', 1)
        expect(owners.has('mod')).toBe(false)
        expect(owners.get('Tone')).toStrictEqual(['Bea'])
        expect(owners.get('tone ')).toStrictEqual(['Bea'])
        expect(owners.has('tone')).toBe(false)
    })

    test('an owner that defines a key twice is named once, and two owners with one name are named once', () => {
        setDb([character('B', 'Bea', { customModuleToggle: 'k=A\nk=B' }), character('B2', 'Bea', { customModuleToggle: 'k=C' }), character('C', 'Cy', { customModuleToggle: 'k=D' })])
        expect(appToggleOwners('cha-1', 1).get('k')).toStrictEqual(['Bea', 'Cy'])
    })

    test('a database without characters or presets gives an empty map', () => {
        store.db = {}
        expect(appToggleOwners('cha-1', 0).size).toBe(0)
    })

    test('it reads only: the database is as it was', () => {
        setDb([character('B', 'Bea', { customModuleToggle: 'k=A' })])
        const before = JSON.stringify(store.db)
        appToggleOwners('cha-1', 1)
        expect(JSON.stringify(store.db)).toBe(before)
    })
})
