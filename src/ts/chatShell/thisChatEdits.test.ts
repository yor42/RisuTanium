import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    mark: vi.fn(),
    db: { characters: [] as unknown[], promptTemplate: undefined as unknown, jailbreak: '' },
}))

vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
}) as unknown as typeof import('src/ts/stores.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: h.mark,
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

import { chatStats, normalizeChatName, promptHasJailbreakToggle, relativeTime, setChatHideNames, writeChatName, writeChatNote } from 'src/ts/chatShell/thisChatEdits'
import type { Chat } from 'src/ts/storage/database.svelte'

type ChatFixture = { id?: string, name: string, note: string, hideNames?: boolean, message: { time?: number }[] }
type OwnerFixture = { chaId: string, chats: ChatFixture[], coldstorage?: string }

const asChat = (chat: ChatFixture) => chat as unknown as Chat
const owners = () => h.db.characters as OwnerFixture[]
let chat: ChatFixture
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    h.mark.mockReset()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    chat = { id: 'chat-1', name: 'One', note: '', message: [] }
    h.db.characters = [{ chaId: 'char-a', chats: [chat, { id: 'chat-2', name: 'Two', note: '', message: [] }] }] satisfies OwnerFixture[]
    h.db.promptTemplate = undefined
    h.db.jailbreak = ''
})

afterEach(() => {
    warn.mockRestore()
})

/**
 * F-T19: the deferred writers (note autosave and flush, rename commit) land on the live owner and chat with one save
 * mark, or are refused with no write and no mark. Fixtures: the clone models the cold restore copy (same `chaId`,
 * same chat ids, new objects); the stub is the `residency.stubFor` shape (`coldstorage` set, one placeholder chat
 * with a fresh id).
 */
describe('deferred writers', () => {
    test('a note lands on the live chat and marks the owner once', () => {
        expect(writeChatNote({ chaId: 'char-a', chat: asChat(chat) }, 'remember the lamp')).toBe(true)
        expect(chat.note).toBe('remember the lamp')
        expect(h.mark).toHaveBeenCalledTimes(1)
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('a rename lands on the live chat and marks the owner once', () => {
        expect(writeChatName({ chaId: 'char-a', chat: asChat(chat) }, 'Harbour night')).toBe(true)
        expect(chat.name).toBe('Harbour night')
        expect(h.mark).toHaveBeenCalledTimes(1)
    })

    test('after the owner is replaced by a clone the note lands on the clone\'s chat, not the captured one', () => {
        const clone = structuredClone(owners()[0])
        owners()[0] = clone
        expect(writeChatNote({ chaId: 'char-a', chat: asChat(chat) }, 'on the clone')).toBe(true)
        expect(clone.chats[0].note).toBe('on the clone')
        expect(chat.note).toBe('')
        expect(h.mark).toHaveBeenCalledWith('char-a')
    })

    test('after the owner is replaced by a clone the rename lands on the clone\'s chat', () => {
        const clone = structuredClone(owners()[0])
        owners()[0] = clone
        expect(writeChatName({ chaId: 'char-a', chat: asChat(chat) }, 'Renamed')).toBe(true)
        expect(clone.chats[0].name).toBe('Renamed')
        expect(chat.name).toBe('One')
    })

    test('after the owner became a stub the note is refused: nothing is written or marked', () => {
        owners()[0] = { chaId: 'char-a', coldstorage: 'unit', chats: [{ id: 'placeholder', name: '', note: '', message: [] }] }
        expect(writeChatNote({ chaId: 'char-a', chat: asChat(chat) }, 'lost')).toBe(false)
        expect(chat.note).toBe('')
        expect(owners()[0].chats[0].note).toBe('')
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('after the owner became a stub the rename is refused', () => {
        owners()[0] = { chaId: 'char-a', coldstorage: 'unit', chats: [{ id: 'placeholder', name: '', note: '', message: [] }] }
        expect(writeChatName({ chaId: 'char-a', chat: asChat(chat) }, 'lost')).toBe(false)
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('after the chat was removed the note is refused', () => {
        owners()[0].chats.shift()
        expect(writeChatNote({ chaId: 'char-a', chat: asChat(chat) }, 'lost')).toBe(false)
        expect(h.mark).not.toHaveBeenCalled()
    })

    test('after the owner was removed the note is refused', () => {
        h.db.characters = []
        expect(writeChatNote({ chaId: 'char-a', chat: asChat(chat) }, 'lost')).toBe(false)
        expect(h.mark).not.toHaveBeenCalled()
    })
})

describe('normalizeChatName', () => {
    test('trims, and an empty or blank name is no name', () => {
        expect(normalizeChatName('  Harbour  ')).toBe('Harbour')
        expect(normalizeChatName('')).toBeNull()
        expect(normalizeChatName('   ')).toBeNull()
    })
})

describe('setChatHideNames', () => {
    test('turning it on writes true, turning it off removes the key, and each marks the owner', () => {
        setChatHideNames({ chaId: 'char-a', chat: asChat(chat) }, true)
        expect(chat.hideNames).toBe(true)
        expect(h.mark).toHaveBeenCalledTimes(1)
        setChatHideNames({ chaId: 'char-a', chat: asChat(chat) }, false)
        expect('hideNames' in chat).toBe(false)
        expect(h.mark).toHaveBeenCalledTimes(2)
        expect(h.mark).toHaveBeenLastCalledWith('char-a')
    })
})

describe('chatStats and relativeTime', () => {
    test('the count is the message count and the last time is the last message\'s time', () => {
        chat.message = [{ time: 10 }, { time: 20 }, { time: 30 }]
        expect(chatStats(asChat(chat))).toEqual({ count: 3, lastTime: 30 })
    })

    test('an empty chat and a last message without a time have no last time', () => {
        expect(chatStats(asChat(chat))).toEqual({ count: 0, lastTime: undefined })
        chat.message = [{ time: 10 }, {}]
        expect(chatStats(asChat(chat))).toEqual({ count: 2, lastTime: undefined })
    })

    test('relativeTime reads in the largest whole unit and never goes into the future', () => {
        const now = Date.UTC(2026, 10, 7, 12, 0, 0)
        expect(relativeTime(now - 30_000, now, 'en')).toBe('now')
        expect(relativeTime(now - 3 * 60_000, now, 'en')).toBe('3 minutes ago')
        expect(relativeTime(now - 2 * 3_600_000, now, 'en')).toBe('2 hours ago')
        expect(relativeTime(now - 3 * 86_400_000, now, 'en')).toBe('3 days ago')
        expect(relativeTime(now + 60_000, now, 'en')).toBe('now')
    })
})

describe('promptHasJailbreakToggle', () => {
    test('without a template the jailbreak text decides', () => {
        expect(promptHasJailbreakToggle(h.db as never)).toBe(false)
        h.db.jailbreak = '  text  '
        expect(promptHasJailbreakToggle(h.db as never)).toBe(true)
    })

    test('with a template a jailbreak item, or {{jbtoggled}} in any text field, decides', () => {
        h.db.promptTemplate = [{ type: 'plain', type2: 'main', text: 'x', role: 'system' }]
        expect(promptHasJailbreakToggle(h.db as never)).toBe(false)
        h.db.promptTemplate = [{ type: 'jailbreak', type2: 'normal', text: '', role: 'system' }]
        expect(promptHasJailbreakToggle(h.db as never)).toBe(true)
        h.db.promptTemplate = [{ type: 'plain', type2: 'main', text: 'a {{jbtoggled}} b', role: 'system' }]
        expect(promptHasJailbreakToggle(h.db as never)).toBe(true)
        h.db.promptTemplate = [{ type: 'persona', innerFormat: '{{jbtoggled}}' }]
        expect(promptHasJailbreakToggle(h.db as never)).toBe(true)
        h.db.promptTemplate = [{ type: 'authornote', defaultText: '{{jbtoggled}}' }]
        expect(promptHasJailbreakToggle(h.db as never)).toBe(true)
    })
})
