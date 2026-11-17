/**
 * hypaMemoryV2 with no summary model (`supaModelType` 'none'): it sends no
 * summary request, returns an error that names the missing model and the
 * setting that fixes it, and changes no data. When no summary is due the
 * setting is never consulted and the call returns no error.
 *
 * Same module mocks as `hypav2.test.ts`, except that the database is one
 * shared object so the test can see that nothing was written to it, and the
 * summarizer is a spy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import { language } from 'src/lang'

const mocks = vi.hoisted(() => ({
    db: {
        supaModelType: 'none',
        maxResponse: 0,
        hypaAllocatedTokens: 100,
        hypaChunkSize: 30,
        hypaModel: 'MiniLM',
    } as Record<string, unknown>,
    globalFetch: vi.fn(),
    requestChatData: vi.fn(),
    runSummarizer: vi.fn(),
    resolveSecret: vi.fn(async (secret: string) => secret),
    SecretRefError: class SecretRefError extends Error {},
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => mocks.db,
}))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('src/ts/process/request/request', () => ({ requestChatData: mocks.requestChatData }))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: mocks.globalFetch }))
vi.mock('src/ts/secretRef', () => ({
    resolveSecret: mocks.resolveSecret,
    SecretRefError: mocks.SecretRefError,
}))
vi.mock('src/ts/process/memory/hypamemory', () => ({
    HypaProcesser: class {
        oaikey = ''
        async addText() {}
        async similaritySearchScored() { return [] }
    },
}))
vi.mock('src/ts/process/transformers', () => ({ runSummarizer: mocks.runSummarizer }))

import { hypaMemoryV2 } from './hypav2'

const tokenizer = { tokenizeChat: async () => 10 } as unknown as ChatTokenizer
const char = {} as character

const newChatMarker: OpenAIChat = { role: 'system', content: '[Start a new chat]', memo: 'NewChat' }

function story(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `m${i + 1}`,
        memo: `id${i + 1}`,
    }))
}

function callV2(chats: OpenAIChat[], maxContextTokens: number) {
    return hypaMemoryV2(chats, chats.length * 10, maxContextTokens, { message: [] } as unknown as Chat, char, tokenizer)
}

beforeEach(() => {
    mocks.db.supaModelType = 'none'
    mocks.globalFetch.mockReset()
    mocks.globalFetch.mockResolvedValue({ ok: false, data: null })
    mocks.requestChatData.mockReset()
    mocks.runSummarizer.mockReset()
    mocks.resolveSecret.mockReset()
    mocks.resolveSecret.mockImplementation(async (secret: string) => secret)
})

describe('hypaMemoryV2 without a summary model', () => {
    // regression reproducer: MC-2092
    it('sends no summary request and returns the missing-model error with its setting', async () => {
        const result = await callV2([newChatMarker, ...story(20)], 200)

        expect(mocks.globalFetch).not.toHaveBeenCalled()
        expect(mocks.requestChatData).not.toHaveBeenCalled()
        expect(mocks.runSummarizer).not.toHaveBeenCalled()
        expect(result.error).toBe(language.errors.hypaV2NoSummaryModel)
        expect(result.errorSetting).toBe('summaryModel')
        expect(result.memory).toBeUndefined()
    })

    // regression reproducer: MC-2092
    it('changes no setting and reports the error at once instead of retrying', async () => {
        const result = await callV2([newChatMarker, ...story(20)], 200)

        expect(mocks.db.supaModelType).toBe('none')
        expect(result.error).not.toContain('failed multiple times')
    })

    it('guard: the error names the missing model and where to set it', () => {
        expect(language.errors.hypaV2NoSummaryModel).toContain('SupaMemory Model')
        expect(language.errors.hypaV2NoSummaryModel).toContain('Settings > Other Bots > Long Term Memory')
    })

    // guard: passes before and after; fails if the unresolvable-key branch gains a setting error
    it('guard: an unresolvable key stops at once with no setting error', async () => {
        mocks.db.supaModelType = 'davinci'
        mocks.resolveSecret.mockRejectedValue(new mocks.SecretRefError('key missing'))

        const result = await callV2([newChatMarker, ...story(20)], 200)

        expect(result.error).toBe('SupaMemory: key missing')
        expect(result.errorSetting).toBeUndefined()
        expect(mocks.globalFetch).not.toHaveBeenCalled()
        expect(mocks.resolveSecret).toHaveBeenCalledTimes(1)
    })

    it('guard: with no summary due, a run with no summary model returns no error', async () => {
        const result = await callV2([newChatMarker, ...story(4)], 1000)

        expect(result.error).toBeUndefined()
        expect(result.errorSetting).toBeUndefined()
        expect(mocks.globalFetch).not.toHaveBeenCalled()
    })

    it('guard: a summary model that is set still summarises and carries no setting error', async () => {
        mocks.db.supaModelType = 'distilbart'
        mocks.runSummarizer.mockResolvedValue('SUMMARY')

        const result = await callV2([newChatMarker, ...story(20)], 200)

        expect(result.error).toBeUndefined()
        expect(result.errorSetting).toBeUndefined()
        expect(mocks.runSummarizer).toHaveBeenCalled()
    })
})
