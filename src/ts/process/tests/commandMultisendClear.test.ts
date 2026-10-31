// @vitest-environment happy-dom

/**
 * `/multisend clear|||...` against a chat with alternatives, through the REAL `processMultiCommand`.
 * The clear empties a non-empty path, which is a full clear: the chat's alternatives go with it.
 *
 * Test kinds: "guard:" rows pass before and after the change; the other row is a regression reproducer
 * that fails on the code that clears the path and keeps `alt`.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from '../../storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: { characters: [] as unknown[] } }))

vi.mock(import('../../alert'), () => ({
    alertInput: vi.fn(),
    alertMd: vi.fn(),
    alertNormal: vi.fn(),
    alertSelect: vi.fn(),
}) as unknown as typeof import('../../alert'))
vi.mock(import('../tts'), () => ({ sayTTS: vi.fn() }) as unknown as typeof import('../tts'))
vi.mock(import('../../parser/parser.svelte'), () => ({
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('../../parser/parser.svelte'))
vi.mock(import('../index.svelte'), () => ({
    doingChat: { subscribe: (run: (value: boolean) => void) => { run(false); return () => {} } },
    sendChat: vi.fn(),
}) as unknown as typeof import('../index.svelte'))
vi.mock(import('../lorebook.svelte'), () => ({ loadLoreBookV3Prompt: vi.fn() }) as unknown as typeof import('../lorebook.svelte'))
vi.mock(import('../triggers'), () => ({ runTrigger: vi.fn() }) as unknown as typeof import('../triggers'))
vi.mock(import('../generationOwnership.svelte'), () => ({
    isComposerWindowOpen: vi.fn(() => false),
}) as unknown as typeof import('../generationOwnership.svelte'))
vi.mock(import('../../stores.svelte'), () => ({
    get DBState() { return dbBox },
    selectedCharID: { subscribe: (run: (value: number) => void) => { run(0); return () => {} } },
}) as unknown as typeof import('../../stores.svelte'))
vi.mock(import('../../storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
    getCurrentCharacter: vi.fn(() => dbBox.db.characters[0]),
    getCurrentChat: vi.fn(),
    setDatabase: vi.fn(),
}) as unknown as typeof import('../../storage/database.svelte'))

import { processMultiCommand } from '../command'

const origin = { chaId: 'char-a', chatId: 'chat-a' }

function install(withAlt: boolean): Chat {
    const chat = {
        id: 'chat-a',
        scriptstate: {},
        message: [
            { role: 'user', data: 'one', chatId: 'm1' },
            { role: 'char', data: 'two', chatId: 'm2' },
        ],
        ...(withAlt ? { alt: [{ m: { role: 'char', data: 'other', chatId: 'x' }, p: 'm1', a: 1 }] } : {}),
    } as unknown as Chat
    dbBox.db = {
        characters: [{ chaId: 'char-a', name: 'Alpha', type: 'character', chatPage: 0, chats: [chat], characters: [] }],
    }
    return chat
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('/multisend clear and the alternatives of the chat', () => {
    test('clearing a non-empty path clears the alternatives', async () => {
        const chat = install(true)
        await processMultiCommand('/multisend clear|||hello', { origin })
        expect(chat.message.map((message) => message.data)).toEqual(['hello'])
        expect('alt' in chat).toBe(false)
    })

    test('guard: /multisend without clear keeps the alternatives', async () => {
        const chat = install(true)
        await processMultiCommand('/multisend hello', { origin })
        expect(chat.message).toHaveLength(3)
        expect(chat.alt).toHaveLength(1)
    })

    test('guard: clearing a chat with no alternatives adds none', async () => {
        const chat = install(false)
        await processMultiCommand('/multisend clear|||hello', { origin })
        expect('alt' in chat).toBe(false)
    })
})
