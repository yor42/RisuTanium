// @vitest-environment happy-dom

/**
 * Message removal and clearing by the REAL `processMultiCommand` (`/cut` by index, range and chatId,
 * `/del N`, `/multisend clear`) against plain SupaMemory's resume pointer.
 *
 * Invariants pinned here: `Chat.supaMemoryData` is `<resume chatId>\n<summary>`; removing the message
 * that the pointer names leaves the pointer on a message that still exists with the summary text
 * unchanged (MC-714: the next message in chat order, hidden included; MC-715: when nothing follows,
 * the last survivor plus a covered-ID field naming it). A chat left with no messages keeps no
 * SupaMemory data, plain or `hypa:`, and no covered-ID field (MC-721 1, MC-722 2). `hypa:` data in a
 * non-empty chat is never repointed.
 *
 * Test kinds: "guard:" rows pass before and after the change; every other row is a regression
 * reproducer that fails on the code without the repoint/clear calls.
 *
 * Alerts, the parser, generation, the trigger engine and the database are fakes; the summariser,
 * tokenizer and similarity processor are fakes for the end-to-end row.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Chat } from '../storage/database.svelte'
import type { ChatTokenizer } from '../tokenizer'
import type { OpenAIChat } from './index.svelte'
import type { character } from '../storage/database.svelte'

vi.hoisted(() => {
    ;(globalThis as { safeStructuredClone?: <T>(value: T) => T }).safeStructuredClone = (value) => structuredClone(value)
})

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

vi.mock(import('../tokenizer'), async (importOriginal) => ({
    ...(await importOriginal()),
    tokenize: async (text: string) => Math.ceil(text.length / 4),
}) as unknown as typeof import('../tokenizer'))
vi.mock(import('./request/request'), () => ({
    requestChatData: vi.fn(async () => ({ type: 'success', result: 'SUMMARY' })),
}) as unknown as typeof import('./request/request'))
vi.mock(import('./memory/hypamemory'), () => ({
    HypaProcesser: class {
        oaikey = ''
        vectors: unknown[] = []
        async addText() {}
        async similaritySearch() { return [] }
    },
}) as unknown as typeof import('./memory/hypamemory'))

import { processMultiCommand } from './command'
import { supaMemory } from './memory/supaMemory'
import { writeSupaMemoryData } from './memory/supaResume'

const origin = { chaId: 'char-a', chatId: 'chat-a' }

interface MessageSpec {
    chatId?: string
    hidden?: boolean
}

function install(supaMemoryData: string, specs: MessageSpec[] = ['m1', 'm2', 'm3', 'm4'].map((chatId) => ({ chatId }))): Chat {
    const chat = {
        id: 'chat-a',
        scriptstate: {},
        supaMemoryData,
        message: specs.map((spec, i) => ({
            role: 'user',
            data: spec.chatId ?? `unstamped${i}`,
            ...(spec.chatId ? { chatId: spec.chatId } : {}),
            ...(spec.hidden ? { disabled: true } : {}),
        })),
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
    test('removing the resume message repoints SupaMemory at the next message and keeps the summary', async () => {
        const chat = install('m2\nold summary text')

        await processMultiCommand('/cut m2', { origin })

        expect(chat.supaMemoryData).toBe('m3\nold summary text')
    })
})

describe('every command removal form repoints', () => {
    // regression reproducer (each row): fails without the repoint at that form
    test('/cut <index> repoints', async () => {
        const chat = install('m2\nold summary text')
        await processMultiCommand('/cut 1', { origin })
        expect(remainingIds(chat)).toEqual(['m1', 'm3', 'm4'])
        expect(chat.supaMemoryData).toBe('m3\nold summary text')
    })

    test('/cut <index> with a negative index repoints', async () => {
        const chat = install('m3\nold summary text')
        await processMultiCommand('/cut -2', { origin })
        expect(chat.supaMemoryData).toBe('m4\nold summary text')
    })

    test('/cut <a>-<b> repoints to the first survivor after the removed range', async () => {
        const chat = install('m2\nold summary text')
        await processMultiCommand('/cut 1-3', { origin })
        expect(remainingIds(chat)).toEqual(['m1', 'm4'])
        expect(chat.supaMemoryData).toBe('m4\nold summary text')
    })

    test('/del N repoints to the last survivor and writes the covered pair when nothing follows', async () => {
        const chat = install('m3\nold summary text')
        await processMultiCommand('/del 2', { origin })
        expect(remainingIds(chat)).toEqual(['m1', 'm2'])
        expect(chat.supaMemoryData).toBe('m2\nold summary text')
        expect(chat.supaMemoryCoveredId).toBe('m2')
    })

    test('/cut <chatId> of the last message writes the covered pair (MC-715)', async () => {
        const chat = install('m4\nold summary text')
        await processMultiCommand('/cut m4', { origin })
        expect(chat.supaMemoryData).toBe('m3\nold summary text')
        expect(chat.supaMemoryCoveredId).toBe('m3')
    })

    test('a hidden survivor after the removed pointer is the new pointer', async () => {
        const chat = install('m2\nold summary text', [{ chatId: 'm1' }, { chatId: 'm2' }, { chatId: 'm3', hidden: true }, { chatId: 'm4' }])
        await processMultiCommand('/cut m2', { origin })
        expect(chat.supaMemoryData).toBe('m3\nold summary text')
    })

    test('a stale covered-ID field is dropped when the pointer moves forward (MC-714)', async () => {
        const chat = install('m2\nold summary text')
        chat.supaMemoryCoveredId = 'm2'
        await processMultiCommand('/cut m2', { origin })
        expect(chat.supaMemoryData).toBe('m3\nold summary text')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    test('a successor without a chatId is stamped and becomes the pointer', async () => {
        const chat = install('m2\nold summary text', [{ chatId: 'm1' }, { chatId: 'm2' }, {}, { chatId: 'm4' }])
        await processMultiCommand('/cut m2', { origin })
        const stamped = chat.message[1].chatId
        expect(stamped).toEqual(expect.any(String))
        expect(chat.supaMemoryData).toBe(`${stamped}\nold summary text`)
    })

    test('guard: removing a message other than the resume message leaves the pointer, by index, range and /del', async () => {
        const chat = install('m2\nold summary text')
        await processMultiCommand('/cut 0', { origin })
        await processMultiCommand('/cut 1-2', { origin })
        await processMultiCommand('/del 1', { origin })
        expect(chat.supaMemoryData).toBe('m2\nold summary text')
        expect(chat.supaMemoryCoveredId).toBeUndefined()
    })

    test('guard: without SupaMemory data a removal writes none', async () => {
        const chat = install('')
        await processMultiCommand('/cut 1', { origin })
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    test('guard: hypa: data in a non-empty chat is not repointed', async () => {
        const chat = install('hypa:m2\nold summary text')
        await processMultiCommand('/cut m2', { origin })
        expect(chat.supaMemoryData).toBe('hypa:m2\nold summary text')
    })
})

describe('end-of-chat deletion followed by the next send (MC-715, T4 end to end)', () => {
    const SUMMARY_TEXT = 'S'.repeat(400)
    const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer
    const sent = (id: string, tokens: number): OpenAIChat => ({ role: 'user', content: id.repeat(tokens), memo: id })

    // regression reproducer: without the repoint the pointer names a removed message and the send errors
    test('/del 1 on the pointer message, then a send: no error, only the summary is sent, the pair persists', async () => {
        const chat = install(`m3\n${SUMMARY_TEXT}`, [{ chatId: 'm1' }, { chatId: 'm2' }, { chatId: 'm3' }])
        await processMultiCommand('/del 1', { origin })
        expect(chat.supaMemoryCoveredId).toBe('m2')

        const chats = [sent('m1', 60), sent('m2', 10)]
        const result = await supaMemory(chats, 70, 60, chat, { name: 'C', type: 'character' } as character, lengthTokenizer)

        expect(result.error).toBeUndefined()
        expect(result.chats.map((entry) => entry.memo)).toEqual(['supaMemory'])
        writeSupaMemoryData(chat, result.memory)
        expect(chat.supaMemoryData.split('\n')[0]).toBe('m2')
        expect(chat.supaMemoryCoveredId).toBe('m2')
    })
})

describe('an emptied chat keeps no SupaMemory data (MC-721 1, MC-722 2)', () => {
    // regression reproducer (each row)
    test.each([
        ['/cut 0-4', 'plain'],
        ['/del 4', 'plain'],
        ['/del 9', 'plain'],
        ['/cut 0-4', 'hypa'],
        ['/del 4', 'hypa'],
    ])('%s empties a chat with %s data and clears the data and the covered field', async (command, kind) => {
        const chat = install(kind === 'hypa' ? 'hypa:m2\nold summary text' : 'm2\nold summary text')
        chat.supaMemoryCoveredId = 'm2'
        await processMultiCommand(command, { origin })
        expect(chat.message.length).toBe(0)
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    test.each(['m2\nold summary text', 'hypa:m2\nold summary text'])('/multisend clear clears %j at the assignment', async (data) => {
        const chat = install(data)
        chat.supaMemoryCoveredId = 'm2'
        await processMultiCommand('/multisend clear|||hello', { origin })
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
        expect(chat.message.map((message) => message.data)).toEqual(['hello'])
    })

    test('guard: /multisend without clear keeps the data', async () => {
        const chat = install('m2\nold summary text')
        await processMultiCommand('/multisend hello', { origin })
        expect(chat.supaMemoryData).toBe('m2\nold summary text')
    })
})
