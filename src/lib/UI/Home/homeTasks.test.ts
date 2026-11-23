/**
 * `taskRows`: the Tasks dialog's row model. Names resolve through the characters and fall back to the
 * unnamed word, so an id never becomes visible text, and an empty target list never reads the characters.
 *
 * Diagnostic (new module): there is no earlier version to fail against.
 */

import { describe, expect, test } from 'vitest'
import { taskRows, type HomeTaskCharacter } from './homeTasks'

const UNNAMED = 'Unnamed'

const characters: HomeTaskCharacter[] = [
    { chaId: 'cha-x', name: 'Xena', chats: [{ id: 'chat-a', name: 'Alpha' }, { id: 'chat-b', name: 'Beta' }] },
    { chaId: 'grp-g', name: 'Guild', chats: [{ id: 'chat-g', name: 'Hall' }] },
]

describe('taskRows', () => {
    test('T-S6-20: no targets returns no rows and never reads the characters', () => {
        const throwing = new Proxy([] as HomeTaskCharacter[], {
            get() { throw new Error('characters were read') },
        })

        expect(taskRows([], throwing, UNNAMED)).toEqual([])
    })

    test('T-S6-21: resolves the character name and the chat name, and falls back for each missing one', () => {
        const rows = taskRows([
            { chaId: 'cha-x', chatId: 'chat-a' },
            { chaId: 'cha-x', chatId: 'chat-zz' },
            { chaId: 'cha-q', chatId: 'chat-q' },
        ], characters, UNNAMED)

        expect(rows.map((row) => [row.name, row.chatName])).toEqual([
            ['Xena', 'Alpha'],
            ['Xena', UNNAMED],
            [UNNAMED, UNNAMED],
        ])
        const empty = taskRows([{ chaId: 'cha-e', chatId: 'chat-e' }], [{ chaId: 'cha-e', name: '', chats: [{ id: 'chat-e', name: '' }] }], UNNAMED)
        expect([empty[0].name, empty[0].chatName]).toEqual([UNNAMED, UNNAMED])
    })

    test('T-S6-22: two targets under one chaId are two rows with distinct keys, in the targets\' order', () => {
        const rows = taskRows([{ chaId: 'cha-x', chatId: 'chat-b' }, { chaId: 'cha-x', chatId: 'chat-a' }], characters, UNNAMED)

        expect(rows.map((row) => row.chatName)).toEqual(['Beta', 'Alpha'])
        expect(new Set(rows.map((row) => row.key)).size).toBe(2)
    })

    test('T-S6-23: a group target is named after the group', () => {
        const rows = taskRows([{ chaId: 'grp-g', chatId: 'chat-g' }], characters, UNNAMED)

        expect([rows[0].name, rows[0].chatName]).toEqual(['Guild', 'Hall'])
    })

    test('T-S6-24: no id appears in the name or chat name on any fallback', () => {
        const rows = taskRows([
            { chaId: 'cha-q', chatId: 'chat-q' },
            { chaId: 'cha-x', chatId: 'chat-zz' },
        ], characters, UNNAMED)

        for (const row of rows) {
            for (const text of [row.name, row.chatName]) {
                for (const id of [row.chaId, row.chatId]) expect(text).not.toContain(id)
            }
        }
    })
})
