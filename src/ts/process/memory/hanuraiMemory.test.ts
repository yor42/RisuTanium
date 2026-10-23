/**
 * hanuraiMemory retrieval over the REAL HypaProcesser similarity path with a
 * fake embedding (every text embeds to the same vector, so every embedded
 * message is a candidate). Messages the prompt still holds must not be
 * inserted again, inserted text is the stored message without the
 * `search_document: ` prefix residue, and retrieval is bounded by the Chunk
 * Size setting (`hanuraiTokens`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { OpenAIChat } from '../index.svelte'

const dbState = vi.hoisted(() => ({
    hanuraiSplit: false,
    hanuraiTokens: 100,
    hypaModel: 'MiniLM',
    hypaCustomSettings: {},
}))

vi.mock('src/ts/storage/database.svelte', () => ({ getDatabase: () => dbState }))
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/lang', () => ({ language: { errors: { toomuchtoken: 'too much' } } }))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/secretRef', () => ({ resolveSecret: async (secret: string) => secret }))
// hypamemory imports ts/util, whose import graph cycles back into the memory modules.
vi.mock('src/ts/util', () => ({ appendLastPath: (a: string, b: string) => `${a}/${b}` }))
vi.mock('src/ts/process/transformers', () => ({
    runEmbedding: async (inputs: string[]) => inputs.map(() => [1, 0]),
}))
vi.mock('src/ts/process/inFlightWork', () => ({
    withInFlight: <T>(_key: string, work: () => Promise<T>) => work(),
}))
vi.mock('localforage', () => {
    const store = new Map<string, unknown>()
    return {
        default: {
            createInstance: () => ({
                getItem: async (key: string) => store.get(key) ?? null,
                setItem: async (key: string, value: unknown) => { store.set(key, value) },
            }),
        },
    }
})

import { hanuraiMemory } from './hanuraiMemory'

function story(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `message number ${i}`,
    }))
}

/** Prompt tokens: a message costs 100, the inserted memory block costs its length. */
const tokenizer = {
    tokenizeChat: async (chat: OpenAIChat) => (chat.memo === 'supaMemory' ? chat.content.length : 100),
} as unknown as ChatTokenizer

async function run(chats: OpenAIChat[], currentTokens: number, maxContextTokens: number) {
    const result = await hanuraiMemory(chats, { currentTokens, maxContextTokens, tokenizer })
    if (!result) throw new Error('hanuraiMemory refused the prompt')
    const [block, ...prompt] = result.chats
    return { block: block.content, prompt: prompt.map((chat) => chat.content) }
}

beforeEach(() => {
    dbState.hanuraiSplit = false
    dbState.hanuraiTokens = 100
})

describe('hanuraiMemory retrieval', () => {
    // Four oldest messages are trimmed out of the prompt; message 4 is embedded and stays in it.
    const trimmedRun = () => run(story(8), 800, 500)

    it('guard: messages trimmed out of the prompt are retrieved into the memory block', async () => {
        dbState.hanuraiTokens = 30
        const { block, prompt } = await trimmedRun()
        expect(prompt).toEqual(['message number 4', 'message number 5', 'message number 6', 'message number 7'])
        expect(block.trim().length).toBeGreaterThan(0)
        expect(block).toMatch(/message number [0-3]/)
    })

    // regression reproducer: CHORE-10 HAN-1, MC-713 4
    it.fails('does not insert a message the prompt still holds', async () => {
        dbState.hanuraiTokens = 100
        const { block, prompt } = await run(story(8), 40, 100000)
        expect(prompt).toHaveLength(8)
        const inserted = block.split('\n\n').map((text) => text.trim())
        expect(inserted.filter((text) => prompt.includes(text))).toEqual([])
    })

    // regression reproducer: CHORE-10 HAN-1, MC-713 4
    it.fails('inserted text carries no leading space from the document prefix', async () => {
        dbState.hanuraiTokens = 30
        const { block } = await trimmedRun()
        expect(block.length).toBeGreaterThan(0)
        expect(block).toMatch(/^message number/)
        expect(block).not.toMatch(/\n\n /)
    })

    // regression reproducer: CHORE-10 HAN-2, MC-713 4
    it.fails('bounds the retrieved text by the Chunk Size setting', async () => {
        dbState.hanuraiTokens = 30
        const { block } = await trimmedRun()
        expect(block.length).toBeGreaterThan(0)
        expect(await tokenizer.tokenizeChat({ role: 'system', memo: 'supaMemory', content: block })).toBeLessThanOrEqual(30)
    })
})
