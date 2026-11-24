import { describe, expect, test } from 'vitest'
import type { loreBook } from '../storage/database.svelte'
import { liveLoreListOf, loreIndexOfEntryId } from './loreEntryLookup'
import { loreEntries, makeCharacter, makeChat, residentModule, stubModule } from './studioFixtures.test-helpers'

describe('loreIndexOfEntryId', () => {
    test('the index of the one entry holding the id', () => {
        expect(loreIndexOfEntryId([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b')).toBe(1)
    })

    test('skips null, string, number and array elements and still finds a later entry', () => {
        expect(loreIndexOfEntryId([{ id: 'a' }, null, 'x', 4, ['x'], { id: 'x' }], 'x')).toBe(5)
    })

    test('no match, a shared id, an empty id and a non-string id give null', () => {
        expect(loreIndexOfEntryId([{ id: 'a' }], 'z')).toBeNull()
        expect(loreIndexOfEntryId([{ id: 'a' }, { id: 'a' }], 'a')).toBeNull()
        expect(loreIndexOfEntryId([{ id: '' }, { id: 'a' }], '')).toBeNull()
        expect(loreIndexOfEntryId([{ id: 7 }, { id: 'a' }], '7')).toBeNull()
    })

    test('a folder row sharing the id counts toward the share', () => {
        expect(loreIndexOfEntryId([{ id: 'a', mode: 'folder' }, { id: 'a' }], 'a')).toBeNull()
        expect(loreIndexOfEntryId([{ id: 'a', mode: 'folder' }, { id: 'b' }], 'a')).toBe(0)
    })

    test('a list that is not an array gives null', () => {
        expect(loreIndexOfEntryId({ id: 'a' }, 'a')).toBeNull()
        expect(loreIndexOfEntryId('a', 'a')).toBeNull()
        expect(loreIndexOfEntryId(undefined, 'a')).toBeNull()
    })
})

describe('liveLoreListOf', () => {
    const globalLore = loreEntries(2, 'g')
    const localLore = loreEntries(1, 'l')
    const character = makeCharacter({ globalLore, chats: [makeChat({ id: 'chat-1', name: 'First', localLore })] })
    const lorebook: loreBook[] = loreEntries(3, 'm').map((entry) => ({ key: entry.key ?? '', comment: entry.comment, secondkey: '', insertorder: 100, content: '', mode: 'normal', alwaysActive: false, selective: false }))
    const modules = [residentModule('m1', { lorebook }), stubModule('s1')]

    test('reads the list of each owner type', () => {
        expect(liveLoreListOf({ type: 'character', id: 'cha-1' }, character, modules)).toBe(globalLore)
        expect(liveLoreListOf({ type: 'chat', id: 'chat-1' }, character, modules)).toBe(localLore)
        expect(liveLoreListOf({ type: 'module', id: 'm1' }, character, modules)).toBe(lorebook)
    })

    test('a stub module, an unknown module and another owner type have none', () => {
        expect(liveLoreListOf({ type: 'module', id: 's1' }, character, modules)).toBeUndefined()
        expect(liveLoreListOf({ type: 'module', id: 'ghost' }, character, modules)).toBeUndefined()
        expect(liveLoreListOf({ type: 'preset', id: '0' }, character, modules)).toBeUndefined()
    })
})
