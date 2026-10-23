import { describe, expect, test } from 'vitest'
import { asDatabase, bodyOf, buildSmall, roundTrip, type Obj } from './codecFixtures'
import type { Database } from '../../database.svelte'

/**
 * `Chat.supaMemoryCoveredId` is a chat-level field the codecs know nothing about: it travels in the chat
 * core beside `supaMemoryData` (store2) and inside the database entry of a legacy `.bin`.
 */
const POINTER = 'chat-id-of-the-last-summarised-message'

function databaseWithPair(): { db: Database, source: Obj } {
    const source = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    const chats = (source.characters as Obj[])[0].chats as Obj[]
    chats[0].supaMemoryData = POINTER + '\nsummary text'
    chats[0].supaMemoryCoveredId = POINTER
    return { db: asDatabase(source), source }
}

describe('supaMemoryCoveredId store2 persistence', () => {
    test('store2: the field is in the chat core with supaMemoryData and comes back whole', () => {
        const { db } = databaseWithPair()
        const { first, second, assembled } = roundTrip(db)
        const cores = first.units
            .filter(unit => unit.identity.startsWith('chat:') && unit.identity.endsWith(':core'))
            .map(unit => bodyOf(unit).f as Obj)
        const withPair = cores.filter(f => f.supaMemoryCoveredId === POINTER)
        expect(withPair).toHaveLength(1)
        expect(withPair[0].supaMemoryData).toBe(POINTER + '\nsummary text')
        const chat = assembled.characters[0].chats[0]
        expect(chat.supaMemoryCoveredId).toBe(POINTER)
        expect(chat.supaMemoryData).toBe(POINTER + '\nsummary text')
        expect(second.units.map(unit => unit.identity).sort()).toEqual(first.units.map(unit => unit.identity).sort())
    })

    test('store2: a chat without the field stays without it', () => {
        const { db } = databaseWithPair()
        const assembled = roundTrip(db).assembled
        expect('supaMemoryCoveredId' in assembled.characters[0].chats[1]).toBe(false)
    })
})
