import { describe, expect, test } from 'vitest'
import { claimRowKey } from './messageRowKey'

function keys(rows: { chatId?: string, index: number }[], owner = 'room'): string[] {
    const taken = new Set<string>()
    return rows.map((row) => claimRowKey(taken, row.chatId, owner, row.index))
}

describe('message row keys', () => {
    test('unique ids are the keys, and a message without an id is keyed by owner and index', () => {
        expect(keys([{ chatId: 'a', index: 2 }, { index: 1 }, { chatId: 'c', index: 0 }])).toEqual(['a', 'room:1', 'c'])
    })
    test('a repeated id keeps the first row its plain key and qualifies the later row by its index', () => {
        expect(keys([{ chatId: 'room', index: 5 }, { chatId: 'x', index: 4 }, { chatId: 'room', index: 0 }])).toEqual(['room', 'x', 'room#0'])
    })
    test('an empty id repeated is still keyed apart', () => {
        expect(keys([{ chatId: '', index: 1 }, { chatId: '', index: 0 }])).toEqual(['', '#0'])
    })
    test('a qualified key that another row already holds takes a counter, so every key differs', () => {
        const got = keys([{ chatId: 'a#3', index: 9 }, { chatId: 'a', index: 8 }, { chatId: 'a', index: 3 }, { chatId: 'a', index: 3 }])
        expect(got).toEqual(['a#3', 'a', 'a#3.1', 'a#3.2'])
        expect(new Set(got).size).toBe(got.length)
    })
    test('a stored id equal to the no-id key of another row does not collide with it', () => {
        const got = keys([{ chatId: 'room:1', index: 2 }, { index: 1 }])
        expect(got).toEqual(['room:1', 'room:1#1'])
    })
})
