import { describe, expect, test, vi } from 'vitest'
import { repairCharacterTree, repairPersonas } from '../characterTreeRepair'

type Entry = Record<string, unknown>

function character(chaId: unknown, extra: Entry = {}): Entry {
    return { chaId, type: 'character', name: `name-${String(chaId)}`, chats: [], ...extra }
}

function stub(chaId: unknown, unit = 'unit-1', extra: Entry = {}): Entry {
    return { chaId, type: 'character', name: `stub-${String(chaId)}`, coldstorage: unit, chats: [], ...extra }
}

function ids(tree: { characters: Entry[] }): unknown[] {
    return tree.characters.map((c) => c.chaId)
}

describe('repairCharacterTree: entries and ids (unit of the new planner)', () => {
    test('drops entries that are not characters and says how many', async () => {
        const tree = { characters: [character('a'), 5, null, [], 'x', character('b')] as unknown[] }
        const result = await repairCharacterTree(tree, 'boot')
        expect(tree.characters.length).toBe(2)
        expect(result.notices).toEqual([{ kind: 'entries-dropped', count: 4 }])
    })

    test('fills a missing id with a new one, in every mode, with no remap', async () => {
        for (const mode of ['boot', 'restore', 'export'] as const) {
            const tree = { characters: [character('a'), character(''), character(undefined)] }
            const result = await repairCharacterTree(tree, mode)
            const [a, second, third] = ids(tree) as string[]
            expect(a).toBe('a')
            expect(second).toMatch(/^[0-9a-f-]{36}$/)
            expect(third).toMatch(/^[0-9a-f-]{36}$/)
            expect(second).not.toBe(third)
            expect(result.notices.map((n) => n.kind)).toEqual(['id-filled', 'id-filled'])
        }
    })

    test('leaves well-formed trees and duplicate ids exactly as they are', async () => {
        const tree = { characters: [character('a'), character('a'), character('b')], characterOrder: ['a', 'b'] }
        const before = JSON.stringify(tree)
        const result = await repairCharacterTree(tree, 'restore')
        expect(JSON.stringify(tree)).toBe(before)
        expect(result).toEqual({ notices: [], refusals: [] })
    })
})

describe('repairCharacterTree: a non-archived character with an unusable id', () => {
    function treeWithLinks() {
        return {
            characters: [
                character('a', { chats: [{ message: [
                    { role: 'char', data: 'hi', saying: 'preset' },
                    { role: 'user', data: 'yo', saying: 'preset' },
                    { role: 'char', data: 'other', saying: 'a' },
                    { role: 'char', data: 'none' },
                ] }] }),
                character('preset', { chats: [{ message: [{ role: 'char', data: 'mine', saying: 'preset' }] }] }),
                { chaId: 'group-1', type: 'group', name: 'group', characters: ['a', 'preset'], chats: [] },
            ] as Entry[],
            characterOrder: ['a', { id: 'folder', name: 'F', data: ['preset'] }, 'preset', 'group-1'] as unknown[],
            loadouts: [{ characterIds: ['preset', 'a'] }],
        }
    }

    test('gets a new id and every list that named the old one follows it', async () => {
        const tree = treeWithLinks()
        const result = await repairCharacterTree(tree, 'restore')
        const fresh = tree.characters[1].chaId as string
        expect(fresh).not.toBe('preset')
        expect(fresh).toMatch(/^[0-9a-f-]{36}$/)
        expect(tree.characterOrder).toEqual(['a', { id: 'folder', name: 'F', data: [fresh] }, fresh, 'group-1'])
        expect(tree.characters[2].characters).toEqual(['a', fresh])
        expect(tree.loadouts[0].characterIds).toEqual([fresh, 'a'])
        expect(result.notices).toEqual([{ kind: 'id-replaced', name: 'name-preset' }])
    })

    test('a character message follows only when it names the old id as its own speaker', async () => {
        const tree = treeWithLinks()
        await repairCharacterTree(tree, 'restore')
        const fresh = tree.characters[1].chaId as string
        const first = (tree.characters[0].chats as Entry[])[0].message as Entry[]
        expect(first[0].saying).toBe(fresh)
        expect(first[1].saying).toBe('preset')
        expect(first[2].saying).toBe('a')
        expect(Object.hasOwn(first[3], 'saying')).toBe(false)
        expect(((tree.characters[1].chats as Entry[])[0].message as Entry[])[0].saying).toBe(fresh)
    })

    test('the first holder by position takes the references and a later holder gets an id of its own', async () => {
        const tree = { characters: [character('config'), character('config')], characterOrder: ['config'] as unknown[], loadouts: [] }
        await repairCharacterTree(tree, 'boot')
        const [first, second] = ids(tree) as string[]
        expect(first).not.toBe(second)
        expect(tree.characterOrder).toEqual([first])
    })

    test('is the same at boot, restore and export', async () => {
        for (const mode of ['boot', 'restore', 'export'] as const) {
            const tree = { characters: [character('x'.repeat(300))] }
            const result = await repairCharacterTree(tree, mode)
            expect(result.notices.map((n) => n.kind)).toEqual(['id-replaced'])
            expect(result.refusals).toEqual([])
        }
    })
})

describe('repairCharacterTree: an archived character', () => {
    test('at boot an unusable id is installed as it is and no unit is read', async () => {
        const read = vi.fn(async () => ({ chaId: 'b' }))
        const tree = { characters: [stub('preset')] }
        const result = await repairCharacterTree(tree, 'boot', { readUnitCharacter: read })
        expect(ids(tree)).toEqual(['preset'])
        expect(read).not.toHaveBeenCalled()
        expect(result).toEqual({ notices: [], refusals: [] })
    })

    test('at boot a missing id is filled, as the boot repair does', async () => {
        const tree = { characters: [stub('')] }
        const result = await repairCharacterTree(tree, 'boot')
        expect(ids(tree)[0]).toMatch(/^[0-9a-f-]{36}$/)
        expect(result.notices.map((n) => n.kind)).toEqual(['id-filled'])
    })

    test.each(['restore', 'export'] as const)('in %s an unusable id takes back the id its unit records and the lists follow', async (mode) => {
        const read = vi.fn(async () => ({ chaId: 'b' }))
        const tree = { characters: [stub('preset')], characterOrder: ['preset'] as unknown[], loadouts: [{ characterIds: ['preset'] }] }
        const result = await repairCharacterTree(tree, mode, { readUnitCharacter: read })
        expect(ids(tree)).toEqual(['b'])
        expect(tree.characterOrder).toEqual(['b'])
        expect(tree.loadouts[0].characterIds).toEqual(['b'])
        expect(result.notices).toEqual([{ kind: 'stub-id-recovered', name: 'stub-preset' }])
    })

    test.each(['restore', 'export'] as const)('in %s a missing id takes its unit\'s id as well', async (mode) => {
        const tree = { characters: [stub(undefined)] }
        await repairCharacterTree(tree, mode, { readUnitCharacter: async () => ({ chaId: 'b' }) })
        expect(ids(tree)).toEqual(['b'])
    })

    test('a usable id is never looked up, whatever the unit holds', async () => {
        const read = vi.fn(async () => ({ chaId: 'something-else' }))
        const tree = { characters: [stub('mine')] }
        await repairCharacterTree(tree, 'restore', { readUnitCharacter: read })
        expect(ids(tree)).toEqual(['mine'])
        expect(read).not.toHaveBeenCalled()
    })

    test.each([
        ['cannot be read', null, 'unit-unreadable'],
        ['is not an object', 'text', 'unit-not-object'],
        ['is a list', [], 'unit-not-object'],
        ['holds an unusable id', { chaId: 'config' }, 'unit-id-unusable'],
        ['holds no id', {}, 'unit-id-unusable'],
        ['holds an id another character has', { chaId: 'taken' }, 'unit-id-duplicate'],
    ])('a restore is refused by name when the unit %s', async (_label, unit, reason) => {
        const tree = { characters: [character('taken'), stub('preset')] }
        const result = await repairCharacterTree(tree, 'restore', { readUnitCharacter: async () => unit })
        expect(result.refusals).toEqual([{ name: 'stub-preset', reason }])
    })

    test('a restore with no way to read a unit refuses an unusable id', async () => {
        const result = await repairCharacterTree({ characters: [stub('preset')] }, 'restore')
        expect(result.refusals).toEqual([{ name: 'stub-preset', reason: 'unit-unreadable' }])
    })

    test('an export never refuses: it gives a fresh id and says the content cannot be restored', async () => {
        const tree = { characters: [stub('preset')], characterOrder: ['preset'] as unknown[] }
        const result = await repairCharacterTree(tree, 'export', { readUnitCharacter: async () => null })
        const fresh = ids(tree)[0] as string
        expect(fresh).toMatch(/^[0-9a-f-]{36}$/)
        expect(tree.characterOrder).toEqual([fresh])
        expect(result.refusals).toEqual([])
        expect(result.notices).toEqual([{ kind: 'stub-unrestorable', name: 'stub-preset' }])
    })

    test('a missing id whose unit cannot be read is filled, not refused', async () => {
        const tree = { characters: [stub('')] }
        const result = await repairCharacterTree(tree, 'restore', { readUnitCharacter: async () => null })
        expect(result.refusals).toEqual([])
        expect(ids(tree)[0]).toMatch(/^[0-9a-f-]{36}$/)
    })
})

describe('repairPersonas', () => {
    test('drops entries that are not objects and keeps the same persona selected', () => {
        const chosen = { name: 'chosen' }
        const db = { personas: [null, 5, { name: 'a' }, chosen] as unknown[], selectedPersona: 3 }
        expect(repairPersonas(db)).toBe(2)
        expect(db.personas).toEqual([{ name: 'a' }, chosen])
        expect(db.selectedPersona).toBe(1)
    })

    test('falls back to the first persona when the selected one was dropped', () => {
        const db = { personas: [{ name: 'a' }, null] as unknown[], selectedPersona: 1 }
        repairPersonas(db)
        expect(db.selectedPersona).toBe(0)
    })

    test('a missing or non-list personas becomes an empty list', () => {
        for (const value of [undefined, null, 5, {}]) {
            const db = { personas: value as unknown, selectedPersona: 0 }
            expect(repairPersonas(db)).toBe(0)
            expect(db.personas).toEqual([])
        }
    })

    test('a clean list is left alone', () => {
        const personas = [{ name: 'a' }]
        const db = { personas: personas as unknown, selectedPersona: 0 }
        expect(repairPersonas(db)).toBe(0)
        expect(db.personas).toBe(personas)
    })
})
describe('repairCharacterTree: an export works on a copy and never touches the page\'s objects', () => {
    test('a replaced id and every reference are changed in the copy only', async () => {
        const held = character('preset', { chats: [{ message: [{ role: 'char', data: 'hi', saying: 'preset' }] }] })
        const group = { chaId: 'g', type: 'group', name: 'g', characters: ['preset'], chats: [] }
        const folder = { id: 'F', name: 'F', data: ['preset'] }
        const live = {
            characters: [character('a'), held, group] as Entry[],
            characterOrder: ['a', folder, 'preset'] as unknown[],
            loadouts: [{ characterIds: ['preset'] }],
        }
        const before = JSON.stringify(live)
        const copy = { characters: live.characters, characterOrder: live.characterOrder, loadouts: live.loadouts }

        const result = await repairCharacterTree(copy, 'export')

        expect(JSON.stringify(live)).toBe(before)
        expect(live.characters[1]).toBe(held)
        const fresh = (copy.characters[1] as Entry).chaId as string
        expect(fresh).toMatch(/^[0-9a-f-]{36}$/)
        expect(((copy.characters[1].chats as Entry[])[0].message as Entry[])[0].saying).toBe(fresh)
        expect((copy.characters[2] as Entry).characters).toEqual([fresh])
        expect(copy.characterOrder).toEqual(['a', { id: 'F', name: 'F', data: [fresh] }, fresh])
        expect(copy.loadouts[0].characterIds).toEqual([fresh])
        expect(result.notices.map((n) => n.kind)).toEqual(['id-replaced'])
    })

    test('a tree that needs nothing keeps the same entries', async () => {
        const entries = [character('a'), character('b')]
        const copy = { characters: entries }
        await repairCharacterTree(copy, 'export')
        expect(copy.characters.every((c, i) => c === entries[i])).toBe(true)
    })
})
