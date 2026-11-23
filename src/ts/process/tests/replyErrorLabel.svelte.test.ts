/**
 * `replyChatLabel`: the "Character: chat" first line of a reply's error. The names are read through the failing
 * unit's own origin over a synthetic database (real `chatOrigin`); the hint stands in only when the origin no longer
 * reads, and an unnameable chat gives null so the error shows without the line.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database, Chat } from '../../storage/database.svelte'

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

import { language } from '../../../lang'
import { DBState } from '../../stores.svelte'
import { replyChatLabel } from '../replyErrorLabel'

type CharacterFixture = Database['characters'][number]

function makeChat(id: string, name: string): Chat {
    return { id, message: [], note: '', name, localLore: [] } as unknown as Chat
}

function makeCharacter(chaId: string, name: string, chats: Chat[]): CharacterFixture {
    return {
        chaId, name, type: 'character', chatPage: 0, chats,
        firstMessage: '', desc: '', notes: '', chatFolders: [], viewScreen: 'none',
        bias: [], emotionImages: [], globalLore: [],
    } as unknown as CharacterFixture
}

function makeGroup(chaId: string, name: string, chats: Chat[]): CharacterFixture {
    return {
        chaId, type: 'group', image: '', firstMessage: '', chats, chatFolders: [], chatPage: 0,
        name, viewScreen: 'multiple', characters: [], characterTalks: [], characterActive: [],
        globalLore: [], autoMode: false, useCharacterLore: false, emotionImages: [], customscript: [],
    } as unknown as CharacterFixture
}

function installDb(characters: CharacterFixture[]): void {
    DBState.db = {
        formatversion: 5, botPresetsId: 0, botPresets: [], modules: [], loadouts: [], plugins: [],
        pluginCustomStorage: {}, characterOrder: characters.map((c) => (c as { chaId: string }).chaId),
        characters,
    } as unknown as Database
}

afterEach(() => {
    vi.restoreAllMocks()
})

describe('replyChatLabel', () => {
    test('E14: a named character and chat give "Character: chat"', () => {
        installDb([makeCharacter('a', 'Alpha', [makeChat('c1', 'Morning')])])
        expect(replyChatLabel({ chaId: 'a', chatId: 'c1' })).toBe('Alpha: Morning')
    })

    test('E14: an unnamed chat shows the chat list label', () => {
        installDb([makeCharacter('a', 'Alpha', [makeChat('c1', '')])])
        expect(replyChatLabel({ chaId: 'a', chatId: 'c1' })).toBe(`Alpha: ${language.settingsPage.unnamed}`)
    })

    test('E14: an unnamed owner shows the unnamed label', () => {
        installDb([makeCharacter('a', '', [makeChat('c1', 'Morning')])])
        expect(replyChatLabel({ chaId: 'a', chatId: 'c1' })).toBe(`${language.settingsPage.unnamed}: Morning`)
    })

    test('E14: in a group chat the owner is the group\'s name', () => {
        installDb([makeGroup('g', 'The Band', [makeChat('c1', 'Gig')])])
        expect(replyChatLabel({ chaId: 'g', chatId: 'c1' })).toBe('The Band: Gig')
    })

    test('E14: an origin that no longer reads falls back to the hint\'s names', () => {
        installDb([])
        const hint = { owner: { name: 'Alpha' }, chat: { name: 'Morning' } }
        expect(replyChatLabel({ chaId: 'a', chatId: 'gone' }, hint)).toBe('Alpha: Morning')
    })

    test('E14: the origin wins over a stale hint', () => {
        installDb([makeCharacter('a', 'Alpha', [makeChat('c1', 'Renamed')])])
        expect(replyChatLabel({ chaId: 'a', chatId: 'c1' }, { owner: { name: 'Alpha' }, chat: { name: 'Old' } })).toBe('Alpha: Renamed')
    })

    test('E14: neither the origin nor a hint names the chat: null', () => {
        installDb([])
        expect(replyChatLabel({ chaId: 'a', chatId: 'gone' })).toBeNull()
    })

    test('E14: a read that throws gives null and never throws', () => {
        DBState.db = { get characters(): CharacterFixture[] { throw new Error('boom') } } as unknown as Database
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(replyChatLabel({ chaId: 'a', chatId: 'c1' })).toBeNull()
    })
})
