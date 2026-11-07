/**
 * `chatSearch.ts`: what the sidebar search finds.
 *
 * Invariants exercised here:
 * - Characters and chats match by name; a query of consonant jamo (초성) matches Hangul names.
 * - A chat also matches by the last line of its conversation, unless it is archived; message bodies are never searched.
 * - Hidden system characters and trashed ones are dropped; archived stubs and groups are kept.
 * - The chats come in the current sort's display order and include the members of folded folders.
 * - Each group is capped; the result carries how many were found before the cap.
 */
import { describe, expect, test } from 'vitest'
import type { Chat, ChatFolder, Database } from '../storage/database.svelte'
import { coldStorageHeader } from '../process/coldstorageData'
import { SEARCH_CAP, searchSidebar } from './chatSearch'

type Entry = Database['characters'][number]

function chat(name: string, lines: string[] = [], extra: Partial<Chat> & { time?: number } = {}): Chat {
    const { time, ...rest } = extra
    const message = lines.map((data, i) => ({ role: i % 2 === 0 ? 'char' : 'user', data, time: (time ?? 1) + i }))
    return { id: `id-${name}`, name, message, note: '', localLore: [], fmIndex: -1, ...rest } as unknown as Chat
}

function character(chaId: string, name: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name, image: '', chats: [], chatPage: 0, chatFolders: [], ...extra } as unknown as Entry
}

function owner(chats: Chat[], chatFolders: ChatFolder[] = []): Entry {
    return character('owner', 'Owner', { chats, chatFolders })
}

const chatNames = (chats: Chat[]) => chats.map((c) => c.name)
const characterNames = (entries: Entry[]) => entries.map((e) => e.name)

describe('characters', () => {
    test('TS1: a name matches case-insensitively, and a jamo query matches the initials of a Hangul name', () => {
        const all = [character('a', 'Alice'), character('b', '한국어 도우미'), character('c', 'Bob')]
        expect(characterNames(searchSidebar(all, undefined, 'recent', 'ALI').characters)).toEqual(['Alice'])
        expect(characterNames(searchSidebar(all, undefined, 'recent', 'ㅎㄱㅇ').characters)).toEqual(['한국어 도우미'])
        expect(searchSidebar(all, undefined, 'recent', 'ㅎㄱㅇ').total).toBe(1)
    })

    test('TS1: hidden system characters and trashed ones are dropped; stubs and groups stay', () => {
        const all = [
            character('§playground', 'Play ground'),
            character('§temp', 'Play temp'),
            character('t', 'Play trashed', { trashTime: 5 }),
            character('s', 'Play stub', { coldstorage: true, chats: [chat('', [''])] }),
            character('g', 'Play group', { type: 'group' }),
            character('k', 'Play kept'),
        ]
        expect(characterNames(searchSidebar(all, undefined, 'recent', 'play').characters)).toEqual(['Play stub', 'Play group', 'Play kept'])
    })

    test('TS1: an empty or blank query finds nothing, and no owner means no chats', () => {
        const all = [character('a', 'Alice')]
        expect(searchSidebar(all, undefined, 'recent', '')).toMatchObject({ shown: 0, total: 0 })
        expect(searchSidebar(all, undefined, 'recent', '   ')).toMatchObject({ shown: 0, total: 0 })
        const found = searchSidebar(all, undefined, 'recent', 'alice')
        expect(found.chats).toEqual([])
        expect(found.shown).toBe(1)
    })
})

describe('chats of the owner', () => {
    test('TS1: a chat matches by name or by its last line, not by an earlier message', () => {
        const o = owner([
            chat('Trip', ['hello there', 'see you at the harbour']),
            chat('Notes', ['needle in the first line', 'nothing here']),
            chat('needle holder', ['plain']),
        ])
        const found = searchSidebar([o], o, 'manual', 'harbour')
        expect(chatNames(found.chats)).toEqual(['Trip'])
        // The earlier message is a body: only the name and the last line are read.
        expect(chatNames(searchSidebar([o], o, 'manual', 'needle').chats)).toEqual(['needle holder'])
    })

    test('TS1: an archived chat matches by name only, never by its placeholder text', () => {
        const archived = chat('Old archive', [`${coldStorageHeader}secretword`])
        const o = owner([archived, chat('Live', ['secretword'])])
        expect(chatNames(searchSidebar([o], o, 'manual', 'secretword').chats)).toEqual(['Live'])
        expect(chatNames(searchSidebar([o], o, 'manual', 'archive').chats)).toEqual(['Old archive'])
    })

    test('TS1: the members of a folded folder are searched, and the order follows the sort', () => {
        const folders: ChatFolder[] = [{ id: 'f1', name: 'Work', folded: true }]
        const o = owner([
            chat('match old', ['x'], { time: 10 }),
            chat('match folded', ['x'], { time: 20, folderId: 'f1' }),
            chat('match new', ['x'], { time: 90 }),
        ], folders)
        expect(chatNames(searchSidebar([o], o, 'recent', 'match').chats)).toEqual(['match folded', 'match new', 'match old'])
        expect(chatNames(searchSidebar([o], o, 'manual', 'match').chats)).toEqual(['match folded', 'match old', 'match new'])
        // The search did not open the folder it looked into.
        expect(folders[0].folded).toBe(true)
    })

    test('TS1: a changed last message is searched again, not read from the cache', () => {
        const trip = chat('Trip', ['first words'])
        const o = owner([trip])
        expect(chatNames(searchSidebar([o], o, 'manual', 'first').chats)).toEqual(['Trip'])
        trip.message.push({ role: 'user', data: 'later words', time: 99 } as Chat['message'][number])
        expect(searchSidebar([o], o, 'manual', 'first').chats).toEqual([])
        expect(chatNames(searchSidebar([o], o, 'manual', 'later').chats)).toEqual(['Trip'])
    })
})

describe('cap', () => {
    test('TS1: each group stops at the cap and the total counts what was found', () => {
        const people = Array.from({ length: 60 }, (_, i) => character(`p${i}`, `Match person ${i}`))
        const chats = Array.from({ length: 55 }, (_, i) => chat(`Match chat ${i}`, ['x']))
        const o = owner(chats)
        const found = searchSidebar([...people, o], o, 'manual', 'match')
        expect(SEARCH_CAP).toBe(50)
        expect(found.characters).toHaveLength(50)
        expect(found.chats).toHaveLength(50)
        expect(found.shown).toBe(100)
        expect(found.total).toBe(115)
        expect(searchSidebar([...people, o], o, 'manual', 'match', 5)).toMatchObject({ shown: 10, total: 115 })
    })
})
