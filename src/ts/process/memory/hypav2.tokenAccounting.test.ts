/**
 * hypaMemoryV2 token accounting over the real module with a stubbed database,
 * similarity processor and a constant 10-token message cost. The caller's
 * count starts at the response reservation (Max Response) plus the prompt, so
 * the returned count must still contain that reservation.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({
        supaModelType: 'distilbart',
        maxResponse: 100,
        hypaAllocatedTokens: 100,
        hypaChunkSize: 30,
        hypaModel: 'MiniLM',
    }),
}))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('src/ts/process/request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/secretRef', () => ({
    resolveSecret: async (secret: string) => secret,
    SecretRefError: class extends Error {},
}))
// hypamemory imports ts/util, whose import graph cycles back into the memory modules.
vi.mock('src/ts/process/memory/hypamemory', () => ({
    HypaProcesser: class {
        oaikey = ''
        async addText() {}
        async similaritySearchScored() { return [] }
    },
}))
vi.mock('src/ts/process/transformers', () => ({ runSummarizer: vi.fn() }))

import { hypaMemoryV2 } from './hypav2'

const tokenizer = { tokenizeChat: async () => 10 } as unknown as ChatTokenizer

describe('hypaMemoryV2 response reservation', () => {
    // regression reproducer: CHORE-10 TOK-1, MC-712 3
    it('the returned token count keeps the response reservation of the input count', async () => {
        const chats: OpenAIChat[] = [
            { role: 'user', content: 'one', memo: 'id1' },
            { role: 'assistant', content: 'two', memo: 'id2' },
        ]
        // Nothing needs summarising: 150 tokens fit a 1000-token context.
        const inputTokens = 150
        const result = await hypaMemoryV2(chats, inputTokens, 1000, {} as Chat, {} as character, tokenizer)
        expect(result.error).toBeUndefined()
        expect(result.currentTokens).toBeGreaterThanOrEqual(inputTokens)
    })

    it('guard: the memory block is added to the returned token count', async () => {
        const chats: OpenAIChat[] = [{ role: 'user', content: 'one', memo: 'id1' }]
        const result = await hypaMemoryV2(chats, 150, 1000, {} as Chat, {} as character, tokenizer)
        expect(result.error).toBeUndefined()
        expect(result.chats[0].memo).toBe('supaMemory')
        expect(result.currentTokens).toBeGreaterThan(0)
    })
})
