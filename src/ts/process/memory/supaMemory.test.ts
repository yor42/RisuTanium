/**
 * supaMemory over the real module with a stubbed database, summariser
 * (requestChatData answers `SUMMARY`), similarity processor and a
 * length-based tokenizer: a message costs one token per content character,
 * stored summaries cost one token per four characters (`tokenize`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, character } from 'src/ts/storage/database.svelte'
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

import { supaMemory } from './supaMemory'

const char = { name: 'C', type: 'character' } as character
const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer

function msg(id: string, tokens: number, role: OpenAIChat['role'] = 'user'): OpenAIChat {
    return { role, content: 'x'.repeat(tokens), memo: id }
}

function roomWith(supaMemoryData: string) {
    return { supaMemoryData } as Chat
}

beforeEach(() => {
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
    // Data whose resume message no longer exists (for example from an upstream backup) must fail the
    // send with an error other than the bare "chat ID not found". Only that old text is excluded here;
    // the wording of the new message is judged at the fix's review.
    // The one-click reset of the SupaMemory data is UI work and is not exercised here.
    it.fails('a resume message that no longer exists fails with an error other than the old chat-ID-not-found text', async () => {
        const chats = [msg('m1', 100), msg('m3', 100), msg('m4', 100), msg('m5', 100)]
        const result = await supaMemory(chats, 600, 500, roomWith('m2\nold summary text'), char, lengthTokenizer)
        expect(result.error).toBeDefined()
        expect(result.error).not.toBe('SupaMemory: chat ID not found')
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
    it.fails('a leading system entry larger than the chunk size returns an error instead of looping', async () => {
        state.db.maxSupaChunkSize = 20
        const { tokenizer } = guardedTokenizer(5000, (chat) => (chat.memo === 'NewChat' ? 50 : 10))
        const outcome = await run(tokenizer, [msg('NewChat', 5, 'system'), msg('a', 5), msg('b', 5)])
        expect(outcome.looped).toBe(false)
        expect(typeof outcome.result?.error).toBe('string')
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
    it.fails('the returned token count includes the loaded summary', async () => {
        const result = await call()
        expect(result.error).toBeUndefined()
        const held = result.chats.reduce(
            (sum, chat) => sum + (chat.memo === 'supaMemory' ? Math.ceil(chat.content.length / 4) : chat.content.length),
            0
        )
        expect(result.currentTokens).toBeGreaterThanOrEqual(held)
    })

    // regression reproducer: CHORE-10 SUPA-2, MC-712 5
    it.fails('retrieved results are joined with newlines', async () => {
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
