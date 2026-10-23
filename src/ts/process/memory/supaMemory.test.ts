/**
 * supaMemory over the real module with a stubbed database, summariser
 * (requestChatData answers `SUMMARY`), similarity processor and a
 * length-based tokenizer: a message costs one token per content character,
 * stored summaries cost one token per four characters (`tokenize`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, Message, character } from 'src/ts/storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'

const state = vi.hoisted(() => {
    ;(globalThis as { safeStructuredClone?: <T>(value: T) => T }).safeStructuredClone = (value) => structuredClone(value)
    return {
        db: {
            removePunctuationHypa: false,
            maxSupaChunkSize: 1200,
            supaModelType: 'subModel',
            supaMemoryPrompt: '',
            supaMemoryKey: '',
            hypaModel: 'MiniLM',
        },
        searchResults: ['a', 'b', 'c', 'd'],
        queryMemos: [] as (string | undefined)[],
    }
})

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => state.db }))
vi.mock('src/ts/tokenizer', () => ({ tokenize: async (text: string) => Math.ceil(text.length / 4) }))
vi.mock('src/ts/process/request/request', () => ({
    requestChatData: vi.fn(async () => ({ type: 'success', result: 'SUMMARY' })),
}))
vi.mock('src/ts/process/memory/hypamemory', () => ({
    HypaProcesser: class {
        oaikey = ''
        vectors: unknown[] = []
        async addText() {}
        async similaritySearch() { return state.searchResults }
    },
}))
// Records which messages the retrieval query was built from.
vi.mock('src/ts/process/stringlize', () => ({
    stringlizeChat: (chats: OpenAIChat[]) => {
        state.queryMemos = chats.map((chat) => chat.memo)
        return 'query'
    },
}))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/process/transformers', () => ({ runSummarizer: vi.fn() }))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('src/ts/util', () => ({ getUserName: () => 'User' }))
vi.mock('src/ts/secretRef', () => ({
    resolveSecret: async (secret: string) => secret,
    SecretRefError: class extends Error {},
}))

import { requestChatData } from 'src/ts/process/request/request'
import { supaMemory } from './supaMemory'
import { writeSupaMemoryData } from './supaResume'

const char = { name: 'C', type: 'character' } as character
const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer

function msg(id: string, tokens: number, role: OpenAIChat['role'] = 'user'): OpenAIChat {
    return { role, content: 'x'.repeat(tokens), memo: id }
}

function roomWith(supaMemoryData: string) {
    return { supaMemoryData } as Chat
}

/** A room whose `message` list carries the given chatIds in order; `hidden` ones are disabled. */
function roomOf(supaMemoryData: string, messages: { id: string, hidden?: boolean }[], covered?: string): Chat {
    const list: Message[] = messages.map(({ id, hidden }) => ({ role: 'user', data: 'x', chatId: id, ...(hidden ? { disabled: true as const } : {}) }))
    return { supaMemoryData, message: list, ...(covered === undefined ? {} : { supaMemoryCoveredId: covered }) } as Chat
}

const SUMMARY_TEXT = 'S'.repeat(400)
const firstLine = (memory: string | undefined) => memory?.split('\n')[0]
const memosOf = (chats: OpenAIChat[]) => chats.map((chat) => chat.memo)
/** The text the summariser was asked to summarise on its first call. */
const firstSummariserInput = () => (vi.mocked(requestChatData).mock.calls[0][0].formated[0].content as string)

beforeEach(() => {
    vi.mocked(requestChatData).mockClear()
    state.db.maxSupaChunkSize = 1200
    state.searchResults = ['a', 'b', 'c', 'd']
    state.queryMemos = []
})

describe('supaMemory resume point (plain SupaMemory)', () => {
    it('guard: a surviving resume message keeps the stored summary', async () => {
        const chats = [msg('m1', 100), msg('m3', 100), msg('m4', 100), msg('m5', 100)]
        const result = await supaMemory(chats, 600, 500, roomWith('m3\nold summary text'), char, lengthTokenizer)
        expect(result.error).toBeUndefined()
        expect(result.memory).toContain('old summary text')
    })

    // regression reproducer: CHORE-10 SUPA-3 (dangling pointer half), MC-714 1
    // A resume message that is in neither the sent list nor the chat fails with an error that differs from
    // the bare "chat ID not found" and names the Reset button.
    it('a resume message that no longer exists fails with an error naming the Reset button', async () => {
        const chats = [msg('m1', 100), msg('m3', 100), msg('m4', 100), msg('m5', 100)]
        const result = await supaMemory(chats, 600, 500, roomWith('m2\nold summary text'), char, lengthTokenizer)
        expect(result.error).toBeDefined()
        expect(result.error).not.toBe('SupaMemory: chat ID not found')
        expect(result.error).toContain('Reset SupaMemory data')
    })

    it('guard: a resume message that no longer exists fails the send today', async () => {
        const chats = [msg('m1', 100), msg('m3', 100), msg('m4', 100), msg('m5', 100)]
        const result = await supaMemory(chats, 600, 500, roomWith('m2\nold summary text'), char, lengthTokenizer)
        expect(result.error).toBeDefined()
    })
})

describe('supaMemory no-progress guard', () => {
    /** Tokenizer that throws after `limit` calls so a non-terminating loop fails instead of hanging. */
    function guardedTokenizer(limit: number, cost: (chat: OpenAIChat) => number) {
        const counter = { calls: 0 }
        const tokenizer = {
            tokenizeChat: async (chat: OpenAIChat) => {
                if (++counter.calls > limit) throw new Error('loop did not terminate')
                return cost(chat)
            },
        } as unknown as ChatTokenizer
        return { counter, tokenizer }
    }

    async function run(tokenizer: ChatTokenizer, chats: OpenAIChat[]) {
        try {
            return { looped: false, result: await supaMemory(chats, 5000, 300, roomWith(''), char, tokenizer) }
        } catch (error) {
            if (error instanceof Error && error.message === 'loop did not terminate') return { looped: true, result: undefined }
            throw error
        }
    }

    it('guard: a leading system entry within the chunk size terminates with an error', async () => {
        state.db.maxSupaChunkSize = 20
        const { tokenizer } = guardedTokenizer(5000, () => 10)
        const outcome = await run(tokenizer, [msg('NewChat', 5, 'system'), msg('a', 5), msg('b', 5)])
        expect(outcome.looped).toBe(false)
        expect(typeof outcome.result?.error).toBe('string')
    })

    // regression reproducer: CHORE-10 SUPA-4, MC-712 6
    it('a leading system entry larger than the chunk size returns an error instead of looping', async () => {
        state.db.maxSupaChunkSize = 20
        const { tokenizer } = guardedTokenizer(5000, (chat) => (chat.memo === 'NewChat' ? 50 : 10))
        const outcome = await run(tokenizer, [msg('NewChat', 5, 'system'), msg('a', 5), msg('b', 5)])
        expect(outcome.looped).toBe(false)
        expect(typeof outcome.result?.error).toBe('string')
    })

    // compatibility guard: passes before and after; an oversized leading user message is taken alone, not an error
    it('guard: an oversized leading user message is still summarised alone', async () => {
        state.db.maxSupaChunkSize = 20
        const result = await supaMemory([msg('big', 150), msg('a', 10)], 400, 300, roomWith(''), char, lengthTokenizer)
        expect(result.error).toBeUndefined()
        expect(result.chats.map((chat) => chat.memo)).not.toContain('big')
    })

    // compatibility guard: passes before and after; summarising the loaded summary alone can end the pass
    // without taking any message, which is progress and must not be reported as an error
    it('guard: summarising an oversized loaded summary alone brings the count under the limit without an error', async () => {
        const result = await supaMemory([msg('m0', 100), msg('m1', 10), msg('m2', 10)], 570, 500, roomWith('m1\n' + 'S'.repeat(4000)), char, lengthTokenizer)
        expect(result.error).toBeUndefined()
        expect(result.currentTokens).toBeLessThanOrEqual(500)
    })
})

describe('supaMemory HypaMemory v1 path', () => {
    const supaText = 'S'.repeat(2000)

    function hypaRoom() {
        const snapshot = [{ id: 'm3', supa: supaText, hypa: ['chunk one text', 'chunk two text'] }]
        return roomWith('hypa:\n' + JSON.stringify(snapshot))
    }

    function chatsToResume() {
        return ['m1', 'm3', 'm4', 'm5', 'm6', 'm7'].map((id) => msg(id, 100))
    }

    function call() {
        return supaMemory(chatsToResume(), 700, 600, hypaRoom(), char, lengthTokenizer, { asHyper: true })
    }

    // regression reproducer: CHORE-10 SUPA-1, MC-712 4
    it('the returned token count includes the loaded summary', async () => {
        const result = await call()
        expect(result.error).toBeUndefined()
        const held = result.chats.reduce(
            (sum, chat) => sum + (chat.memo === 'supaMemory' ? Math.ceil(chat.content.length / 4) : chat.content.length),
            0
        )
        expect(result.currentTokens).toBeGreaterThanOrEqual(held)
    })

    // regression reproducer: CHORE-10 SUPA-2, MC-712 5
    it('retrieved results are joined with newlines', async () => {
        const result = await call()
        const retrieved = result.chats.find((chat) => chat.memo === 'hypaMemory')
        expect(retrieved?.content).toContain('a\nb\nc')
    })

    it('guard: retrieval is queried with the oldest four remaining non-system messages and keeps three results', async () => {
        const result = await call()
        expect(state.queryMemos).toEqual(['m3', 'm4', 'm5', 'm6'])
        const retrieved = result.chats.find((chat) => chat.memo === 'hypaMemory')
        expect(retrieved?.content.startsWith('past events: ')).toBe(true)
        expect(retrieved?.content).not.toContain('d')
    })
})

describe('supaMemory resume pointer over room.message (hidden and end-of-chat pointers)', () => {
    const MAX = 60
    const call = (chats: OpenAIChat[], room: Chat, max = MAX) =>
        supaMemory(chats, chats.reduce((total, chat) => total + chat.content.length, 0), max, room, char, lengthTokenizer)
    /** A sent entry whose content names its id, so a summariser input shows which entries it held. */
    const emsg = (id: string, tokens: number): OpenAIChat => ({ role: 'user', content: id.repeat(tokens), memo: id })
    /** A sent entry without a memo: the greeting or an example turn. */
    const headEntry = (tokens: number): OpenAIChat => ({ role: 'assistant', content: 'g'.repeat(tokens) })
    const heldTokens = (chats: OpenAIChat[]) => chats.reduce(
        (total, chat) => total + (chat.memo === 'supaMemory' ? Math.ceil(chat.content.length / 4) : chat.content.length),
        0
    )

    // Every row is built so the send is over budget before and after the resolver: an under-budget send
    // returns before it sets `memory` and `lastId`. Entries before the pointer carry the excess.

    // T5: compatibility guard, passes before and after (the loop stops at a visible, uncovered pointer)
    it('T5 guard: a visible pointer, compression only, keeps the pointer and its messages', async () => {
        const room = roomOf('X\n' + SUMMARY_TEXT, [{ id: 'a' }, { id: 'X' }, { id: 'Y' }])
        const result = await call([emsg('a', 40), emsg('X', 10), emsg('Y', 10)], room)
        expect(result.error).toBeUndefined()
        expect(memosOf(result.chats)).toEqual(['supaMemory', 'X', 'Y'])
        expect(firstLine(result.memory)).toBe('X')
    })

    // T2: regression reproducer, fails at HEAD (X is sent again)
    it('T2: a covered pointer message is neither sent nor summarised', async () => {
        const room = roomOf('X\n' + SUMMARY_TEXT, [{ id: 'a' }, { id: 'X' }, { id: 'Y' }], 'X')
        const result = await call([emsg('a', 40), emsg('X', 10), emsg('Y', 10)], room)
        expect(result.error).toBeUndefined()
        expect(memosOf(result.chats)).toEqual(['supaMemory', 'Y'])
        expect(firstLine(result.memory)).toBe('X')
    })

    // T3: regression reproducer, fails at HEAD (X is in the summariser input)
    it('T3: a chunk forming after the covered message moves the pointer and the writer drops the field', async () => {
        const room = roomOf('X\n' + SUMMARY_TEXT, ['a', 'X', 'Y', 'Z', 'W'].map((id) => ({ id })), 'X')
        const result = await call([emsg('a', 40), emsg('X', 10), emsg('Y', 10), emsg('Z', 10), emsg('W', 10)], room, 63)
        expect(result.error).toBeUndefined()
        expect(firstSummariserInput()).not.toContain('X'.repeat(10))
        expect(firstSummariserInput()).toContain('Y'.repeat(10))
        expect(firstLine(result.memory)).toBe('W')
        writeSupaMemoryData(room, result.memory)
        expect(room.supaMemoryCoveredId).toBeUndefined()
    })

    // T4: regression reproducer, fails at HEAD (X is sent again)
    it('T4: a covered pointer with nothing after it succeeds, keeps the pair and sends only the summary', async () => {
        const room = roomOf('X\n' + SUMMARY_TEXT, [{ id: 'a' }, { id: 'X' }], 'X')
        const result = await call([emsg('a', 60), emsg('X', 10)], room)
        expect(result.error).toBeUndefined()
        expect(memosOf(result.chats)).toEqual(['supaMemory'])
        writeSupaMemoryData(room, result.memory)
        expect(firstLine(room.supaMemoryData)).toBe('X')
        expect(room.supaMemoryCoveredId).toBe('X')
    })

    // T1: compatibility guard, passes before and after; fails if lastId were set to the first remaining entry
    it('T1: a message unhidden after a compression-only send is still sent', async () => {
        const room = roomOf('X\n' + SUMMARY_TEXT, [{ id: 'a' }, { id: 'X' }, { id: 'H', hidden: true }, { id: 'Y' }], 'X')
        const first = await call([emsg('a', 40), emsg('X', 10), emsg('Y', 10)], room)
        expect(first.error).toBeUndefined()
        writeSupaMemoryData(room, first.memory)
        room.message[2].disabled = false
        const second = await call([emsg('a', 40), emsg('X', 10), emsg('H', 10), emsg('Y', 10)], room)
        expect(second.error).toBeUndefined()
        expect(memosOf(second.chats)).toContain('H')
    })

    describe('hidden pointer', () => {
        const messages = [{ id: 'a' }, { id: 'P', hidden: true }, { id: 'b' }, { id: 'c' }]
        const sentList = () => [
            headEntry(5),
            { ...emsg('NewChatExample', 1), content: 'e'.repeat(5) },
            { ...emsg('NewChat', 1), content: 'n'.repeat(5), role: 'system' as const },
            emsg('a', 40),
            emsg('b', 10),
            emsg('c', 10),
        ]

        // (1) regression reproducer, fails at HEAD ('chat ID not found')
        it('(1) drops the head entries and everything before the pointer, keeps what follows it', async () => {
            const result = await call(sentList(), roomOf('P\n' + SUMMARY_TEXT, messages))
            expect(result.error).toBeUndefined()
            expect(memosOf(result.chats)).toEqual(['supaMemory', 'b', 'c'])
            expect(firstLine(result.memory)).toBe('P')
            expect(result.lastId).toBe('P')
        })

        // (2) regression reproducer, fails at HEAD
        it('(2) a covered field on a hidden pointer changes nothing', async () => {
            const withField = await call(sentList(), roomOf('P\n' + SUMMARY_TEXT, messages, 'P'))
            const without = await call(sentList(), roomOf('P\n' + SUMMARY_TEXT, messages))
            expect(withField.error).toBeUndefined()
            expect(without.error).toBeUndefined()
            expect(withField.chats).toEqual(without.chats)
            expect(firstLine(withField.memory)).toBe('P')
            expect(withField.memory).toBe(without.memory)
            expect(withField.lastId).toBe(without.lastId)
        })

        // (3) regression reproducer, fails at HEAD
        it('(3) the returned token count is the recount of the returned chats', async () => {
            const result = await call(sentList(), roomOf('P\n' + SUMMARY_TEXT, messages))
            expect(result.error).toBeUndefined()
            expect(result.currentTokens).toBe(heldTokens(result.chats) + 10)
        })

        // (4) regression reproducer, fails at HEAD
        it('(4) a hidden pointer with nothing after it succeeds and keeps the pointer', async () => {
            const room = roomOf('P\n' + SUMMARY_TEXT, [{ id: 'a' }, { id: 'P', hidden: true }])
            const result = await call([emsg('a', 70)], room)
            expect(result.error).toBeUndefined()
            expect(memosOf(result.chats)).toEqual(['supaMemory'])
            expect(result.lastId).toBe('P')
            writeSupaMemoryData(room, result.memory)
            expect(firstLine(room.supaMemoryData)).toBe('P')
        })

        // (6) regression reproducer, fails at HEAD: the pointer lies before an 'allBefore' message
        it('(6) a pointer before the allBefore cut drops only the head entries', async () => {
            const cut: Message[] = [
                { role: 'user', data: 'x', chatId: 'P', disabled: true },
                { role: 'user', data: 'x', chatId: 'a' },
                { role: 'user', data: 'x', chatId: 'B', disabled: 'allBefore' },
                { role: 'user', data: 'x', chatId: 'c' },
            ]
            const room = { supaMemoryData: 'P\n' + SUMMARY_TEXT, message: cut } as Chat
            const result = await call([headEntry(60), emsg('c', 10)], room)
            expect(result.error).toBeUndefined()
            expect(memosOf(result.chats)).toEqual(['supaMemory', 'c'])
            expect(result.lastId).toBe('P')
        })

        // (7) regression reproducer, fails at HEAD; also fails if lastId were set to the first remaining entry
        it('(7) hide, compression-only send, unhide, send again: the pointer message is sent', async () => {
            const room = roomOf('P\n' + SUMMARY_TEXT, [{ id: 'P', hidden: true }, { id: 'b' }])
            const first = await call([headEntry(60), emsg('b', 10)], room)
            expect(first.error).toBeUndefined()
            writeSupaMemoryData(room, first.memory)
            expect(firstLine(room.supaMemoryData)).toBe('P')
            room.message[0].disabled = false
            const second = await call([headEntry(60), emsg('P', 10), emsg('b', 10)], room)
            expect(second.error).toBeUndefined()
            expect(memosOf(second.chats)).toEqual(['supaMemory', 'P', 'b'])
            writeSupaMemoryData(room, second.memory)
            expect(firstLine(room.supaMemoryData)).toBe('P')
        })
    })

    // regression reproducer, fails with the writer that revalidates a stale field: data cleared by hand, field left at X
    it('a stale covered field is not revalidated by a fresh summary that ends on it; X is sent or summarised next', async () => {
        const room = roomOf('', ['a', 'b', 'X', 'Y', 'Z'].map((id) => ({ id })), 'X')
        const sent = () => [emsg('a', 30), emsg('b', 30), emsg('X', 30), emsg('Y', 60), emsg('Z', 60)]
        const first = await call(sent(), room, 200)
        expect(first.error).toBeUndefined()
        expect(firstLine(first.memory)).toBe('X')
        expect(firstSummariserInput()).not.toContain('X'.repeat(30))
        writeSupaMemoryData(room, first.memory)
        expect(room.supaMemoryCoveredId).toBeUndefined()
        vi.mocked(requestChatData).mockClear()
        room.message.push({ role: 'user', data: 'x', chatId: 'Q' } as Message)
        const next = [...sent(), emsg('Q', 30)]
        const second = await call(next, room, 200)
        const summarisedX = vi.mocked(requestChatData).mock.calls.some((c) => (c[0].formated[0].content as string).includes('X'.repeat(30)))
        expect(memosOf(second.chats).includes('X') || summarisedX).toBe(true)
    })

    // (5) the flipped dangling row, with a room.message list that lacks the pointer
    it('(5) a pointer in neither list fails with the Reset-naming error', async () => {
        const room = roomOf('m2\n' + SUMMARY_TEXT, [{ id: 'm1' }, { id: 'm3' }])
        const result = await call([emsg('m1', 40), emsg('m3', 30)], room)
        expect(result.error).toContain('Reset SupaMemory data')
        expect(result.error).not.toBe('SupaMemory: chat ID not found')
    })
})
