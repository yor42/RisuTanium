import { describe, expect, test } from 'vitest'
import { assembleDatabase } from '../../store2/codec'
import type { Database } from '../../database.svelte'
import {
    dbWithCharacters, encodeWith, mulberry32, previousFrom, prosePool, roundTrip, seededEnv, sparseCharacter, storeOf, type Obj,
} from './codecFixtures'

/**
 * A reordered chat list and a reordered folder list store and read back as written.
 *
 * Invariant: the store keeps the order of `chats` and of `chatFolders`, including for chats without an id and for chats that
 * share an id (they are addressed by position), and a re-encode after a reorder reads back in the new order with every chat's
 * messages still attached to the right chat.
 */

function message(data: string): Obj {
    return { role: 'user', data, time: 1 }
}

function holder(chats: Obj[], chatFolders: Obj[]): Obj {
    const rng = mulberry32(5)
    return Object.assign(sparseCharacter(rng, prosePool(rng, 5, 10, 40), 'holder', 'Holder', chats, []), { chatFolders })
}

function chatsOf(): Obj[] {
    return [
        { message: [message('one-a'), message('one-b')], name: 'one', id: 'id-one', folderId: 'f1' },
        { message: [message('noid-a')], name: 'noid' },
        { message: [message('twin1')], name: 'twin1', id: 'twin' },
        { message: [message('twin2')], name: 'twin2', id: 'twin' },
        { message: [message('four')], name: 'four', id: 'id-four' },
    ]
}

function foldersOf(): Obj[] {
    return [{ id: 'f1', name: 'F1', folded: false }, { id: 'f2', name: 'F2', folded: true, color: 'red' }, { id: 'f3', name: 'F3', folded: false }]
}

function summary(db: Database): { chats: unknown[], folders: unknown[] } {
    const character = db.characters[0]
    return {
        chats: character.chats.map((chat) => [chat.name, chat.id ?? null, chat.folderId ?? null, chat.message.map((m) => m.data)]),
        folders: (character.chatFolders ?? []).map((folder) => [folder.id, folder.name, folder.folded, folder.color ?? null]),
    }
}

describe('a reordered chat list', () => {
    const permuted = () => [chatsOf()[4], chatsOf()[2], chatsOf()[1], chatsOf()[3], chatsOf()[0]]

    test('reads back in the new order, with id-less and shared-id chats keeping their own messages', () => {
        const { assembled } = roundTrip(dbWithCharacters([holder(permuted(), foldersOf())]))
        expect(summary(assembled).chats).toEqual([
            ['four', 'id-four', null, ['four']],
            ['twin1', 'twin', null, ['twin1']],
            ['noid', null, null, ['noid-a']],
            ['twin2', 'twin', null, ['twin2']],
            ['one', 'id-one', 'f1', ['one-a', 'one-b']],
        ])
    })

    test('a re-encode after the reorder, reusing the earlier units, reads back the same', () => {
        const before = encodeWith(dbWithCharacters([holder(chatsOf(), foldersOf())]), { env: seededEnv(1) })
        const reordered = dbWithCharacters([holder(permuted(), foldersOf().reverse())])
        const after = encodeWith(reordered, { env: seededEnv(2), previous: previousFrom(before) })
        const assembled = assembleDatabase(after.manifest, storeOf(before, after))
        expect(summary(assembled)).toEqual(summary(roundTrip(reordered).assembled))
        expect(summary(assembled).chats.map((row) => (row as unknown[])[0])).toEqual(['four', 'twin1', 'noid', 'twin2', 'one'])
        expect(summary(assembled).folders.map((row) => (row as unknown[])[0])).toEqual(['f3', 'f2', 'f1'])
    })
})

describe('a reordered folder list', () => {
    test('keeps each folder\'s fields and reads back in the new order', () => {
        const [f1, f2, f3] = foldersOf()
        const { assembled } = roundTrip(dbWithCharacters([holder(chatsOf(), [f3, f1, f2])]))
        expect(summary(assembled).folders).toEqual([
            ['f3', 'F3', false, null],
            ['f1', 'F1', false, null],
            ['f2', 'F2', true, 'red'],
        ])
    })
})
