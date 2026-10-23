// @vitest-environment happy-dom

/**
 * Message removal by the REAL `processMultiCommand` (`/cut <chatId>`) against plain SupaMemory's
 * resume pointer.
 *
 * Invariant pinned here: `Chat.supaMemoryData` is `<resume chatId>\n<summary>`; removing the message
 * that the pointer names must leave the pointer on a message that still exists (the next one) with
 * the summary text unchanged. Only the `/cut <chatId>` branch is pinned. The other removal paths are
 * untested: `/cut <index>`, `/cut <a>-<b>`, `/del`, the remove button in `Chat.svelte`, the scripting
 * `cutChat`/`removeChat` calls and the trigger cuts.
 *
 * Alerts, the parser, generation, the trigger engine and the database are fakes.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from '../storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: { characters: [] as unknown[] } }))

vi.mock(import('../alert'), () => ({
    alertInput: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}) as unknown as typeof import('../alert'))
vi.mock(import('./tts'), () => ({ sayTTS: vi.fn() }) as unknown as typeof import('./tts'))
vi.mock(import('../parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('../parser/parser.svelte'))
vi.mock(import('./index.svelte'), () => ({
    doingChat: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
    sendChat: vi.fn(),
}) as unknown as typeof import('./index.svelte'))
vi.mock(import('./lorebook.svelte'), () => ({ loadLoreBookV3Prompt: vi.fn() }) as unknown as typeof import('./lorebook.svelte'))
vi.mock(import('./triggers'), () => ({ runTrigger: vi.fn() }) as unknown as typeof import('./triggers'))
vi.mock(import('./generationOwnership.svelte'), () => ({
    isComposerWindowOpen: vi.fn(() => false),
}) as unknown as typeof import('./generationOwnership.svelte'))
vi.mock(import('../stores.svelte'), () => ({
    get DBState() { return dbBox },
    selectedCharID: { subscribe: (run: (value: number) => void) => { run(0); return () => {} } },
}) as unknown as typeof import('../stores.svelte'))
vi.mock(import('../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
    getCurrentCharacter: vi.fn(() => dbBox.db.characters[0]),
    getCurrentChat: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('../storage/database.svelte'))

import { processMultiCommand } from './command'

const origin = { chaId: 'char-a', chatId: 'chat-a' }

function install(supaMemoryData: string): Chat {
    const chat = {
        id: 'chat-a',
        scriptstate: {},
        supaMemoryData,
        message: ['m1', 'm2', 'm3', 'm4'].map((chatId) => ({ role: 'user', data: chatId, chatId })),
    } as unknown as Chat
    dbBox.db = {
        characters: [{ chaId: 'char-a', name: 'Alpha', type: 'character', chatPage: 0, chats: [chat], characters: [] }],
    }
    return chat
}

const remainingIds = (chat: Chat) => chat.message.map((message) => message.chatId)

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('message removal and the SupaMemory resume pointer', () => {
    test('guard: /cut <chatId> removes only that message', async () => {
        const chat = install('m2\nold summary text')

        await processMultiCommand('/cut m2', { origin })

        expect(remainingIds(chat)).toEqual(['m1', 'm3', 'm4'])
    })

    test('guard: removing a message other than the resume message leaves the pointer and summary', async () => {
        const chat = install('m2\nold summary text')

        // Both cut messages have a following message, so a repoint after any cut would move the pointer.
        await processMultiCommand('/cut m3', { origin })
        expect(chat.supaMemoryData).toBe('m2\nold summary text')

        await processMultiCommand('/cut m1', { origin })
        expect(chat.supaMemoryData).toBe('m2\nold summary text')
    })

    // regression reproducer: CHORE-10 SUPA-3 (removal half), MC-714 1
    test.fails('removing the resume message repoints SupaMemory at the next message and keeps the summary', async () => {
        const chat = install('m2\nold summary text')

        await processMultiCommand('/cut m2', { origin })

        expect(chat.supaMemoryData).toBe('m3\nold summary text')
    })
})
