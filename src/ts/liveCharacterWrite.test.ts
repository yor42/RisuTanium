import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    mark: vi.fn(),
    db: { characters: [] as unknown[] },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: h.mark,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

import { writeLiveCharacter, writeLiveChat } from 'src/ts/liveCharacterWrite'
import type { Chat } from 'src/ts/storage/database.svelte'

type Fixture = { chaId: string, name: string, coldstorage?: string }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    h.mark.mockReset()
    h.db.characters = [
        { chaId: 'char-a', name: 'Alpha' },
        { chaId: 'char-b', name: 'Beta' },
    ] satisfies Fixture[]
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
    warn.mockRestore()
})

const rename = (to: string) => (target: { name: string }) => { target.name = to }

/**
 * LW1: a deferred chat write lands on the live owner and chat with one save mark, or it is refused with no write
 * and no mark. Guard by construction: `writeLiveChat` is a new export. Fixtures: the replacement owner is a
 * structured clone of the element, which models the cold restore copy (same `chaId`, same chat ids, new objects);
 * the stub carries `coldstorage` as `residency.stubFor` builds it, once with a fresh placeholder chat (the real
 * shape) and once with the captured chat's id (so that a resolver which ignores `coldstorage` is observable).
 */
describe('writeLiveChat', () => {
    type ChatFixture = { id?: string, name: string, note: string }
    type OwnerFixture = { chaId: string, chats: ChatFixture[], coldstorage?: string }
    const asChat = (chat: ChatFixture) => chat as unknown as Chat
    const setNote = (note: string) => (live: Chat) => { live.note = note }
    const owners = () => h.db.characters as OwnerFixture[]
    let chat: ChatFixture

    beforeEach(() => {
        chat = { id: 'chat-1', name: 'One', note: '' }
        h.db.characters = [
            { chaId: 'char-a', chats: [chat, { id: 'chat-2', name: 'Two', note: '' }] },
        ] satisfies OwnerFixture[]
    })

    test('the live element is written and the owner is marked once, after the write', () => {
        const order: string[] = []
        h.mark.mockImplementation(() => { order.push('mark') })

        const landed = writeLiveChat('char-a', asChat(chat), (live) => {
            order.push('write')
            expect(live).toBe(chat)
            live.note = 'changed'
        })

        expect(landed).toBe(true)
        expect(order).toEqual(['write', 'mark'])
        expect(chat.note).toBe('changed')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('an element replaced by a clone is written through the chat id, and the captured object stays untouched', () => {
        const clone = structuredClone(owners()[0])
        owners()[0] = clone

        expect(writeLiveChat('char-a', asChat(chat), setNote('on the clone'))).toBe(true)

        expect(clone.chats[0].note).toBe('on the clone')
        expect(chat.note).toBe('')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('an owner that became a stub is refused, whatever it holds: nothing is written or marked', () => {
        // The stub holds a chat with the captured id, which only the `coldstorage` check can refuse.
        owners()[0] = { chaId: 'char-a', coldstorage: 'entry-1', chats: [{ id: 'chat-1', name: 'Stub', note: '' }] }
        const write = vi.fn()

        expect(writeLiveChat('char-a', asChat(chat), write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
    })

    test('a producer-shaped stub (one placeholder chat with a fresh id) is refused', () => {
        owners()[0] = { chaId: 'char-a', coldstorage: 'entry-1', chats: [{ id: 'fresh-placeholder', name: 'Stub', note: '' }] }
        const write = vi.fn()

        expect(writeLiveChat('char-a', asChat(chat), write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('an owner that was removed is refused', () => {
        h.db.characters = []
        const write = vi.fn()

        expect(writeLiveChat('char-a', asChat(chat), write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
    })

    test('a chat that is gone from its owner is refused', () => {
        owners()[0].chats = [{ id: 'chat-2', name: 'Two', note: '' }]
        const write = vi.fn()

        expect(writeLiveChat('char-a', asChat(chat), write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('a chat without an id that is not the live object is refused, even when the owner holds a lookalike', () => {
        const idless: ChatFixture = { name: 'One', note: '' }
        owners()[0].chats = [idless]
        const replaced = structuredClone(owners()[0])
        owners()[0] = replaced
        const write = vi.fn()

        expect(writeLiveChat('char-a', asChat(idless), write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('an id that two chats share is refused when the captured chat is not one of them', () => {
        const replaced: OwnerFixture = {
            chaId: 'char-a',
            chats: [{ id: 'chat-1', name: 'Copy 1', note: '' }, { id: 'chat-1', name: 'Copy 2', note: '' }],
        }
        owners()[0] = replaced
        const write = vi.fn()

        expect(writeLiveChat('char-a', asChat(chat), write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('guard: a captured chat that is itself live is written by identity even when its id is shared', () => {
        const twin: ChatFixture = { id: 'chat-1', name: 'Twin', note: '' }
        owners()[0].chats.push(twin)

        expect(writeLiveChat('char-a', asChat(twin), setNote('twin'))).toBe(true)

        expect(twin.note).toBe('twin')
        expect(chat.note).toBe('')
    })

    test('a write that vetoes (returns false) reports false and marks nothing', () => {
        const veto = vi.fn(() => false)

        expect(writeLiveChat('char-a', asChat(chat), veto)).toBe(false)

        expect(veto).toHaveBeenCalledTimes(1)
        expect(h.mark).not.toHaveBeenCalled()
    })
})

describe('writeLiveCharacter', () => {
    test('a character found by id is written, then marked for save, and the call reports true', () => {
        const order: string[] = []
        h.mark.mockImplementation(() => { order.push('mark') })

        const landed = writeLiveCharacter('char-b', (target) => {
            order.push('write')
            rename('Changed')(target as never)
        })

        expect(landed).toBe(true)
        expect(order).toEqual(['write', 'mark'])
        expect((h.db.characters[1] as Fixture).name).toBe('Changed')
        expect((h.db.characters[0] as Fixture).name).toBe('Alpha')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-b')
        expect(warn).not.toHaveBeenCalled()
    })

    test('the live element at lookup time is written, so a replacement with the same id receives the write', () => {
        const replacement: Fixture = { chaId: 'char-a', name: 'Replacement' }
        h.db.characters[0] = replacement

        writeLiveCharacter('char-a', rename('Written') as never)

        expect(replacement.name).toBe('Written')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('an id that no character has drops the write with one warning and marks nothing', () => {
        const write = vi.fn()

        expect(writeLiveCharacter('char-gone', write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('an archived stub is not written into: the write is dropped with one warning and nothing is marked', () => {
        h.db.characters[0] = { chaId: 'char-a', name: 'Stub', coldstorage: 'entry-1' } satisfies Fixture
        const write = vi.fn()

        expect(writeLiveCharacter('char-a', write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })

    test('an empty id never matches, even a character whose own id is empty', () => {
        h.db.characters.push({ chaId: '', name: 'Unlabelled' } satisfies Fixture)
        const write = vi.fn()

        expect(writeLiveCharacter('', write)).toBe(false)

        expect(write).not.toHaveBeenCalled()
        expect(h.mark).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledTimes(1)
    })
})
