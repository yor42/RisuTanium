/**
 * hanuraiMemory retrieval over the REAL HypaProcesser similarity path with a
 * fake embedding (every text embeds to the same vector, so every embedded
 * message is a candidate). Messages the prompt still holds must not be
 * inserted again, inserted text is the stored message, and retrieval is
 * bounded by the Chunk Size setting (`hanuraiTokens`).
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
const embedBox = vi.hoisted(() => ({
    inputs: [] as string[],
    store: new Map<string, unknown>(),
}))

vi.mock('src/ts/process/transformers', () => ({
    runEmbedding: async (inputs: string[]) => {
        embedBox.inputs.push(...inputs)
        return inputs.map(() => [1, 0])
    },
}))
vi.mock('src/ts/process/inFlightWork', () => ({
    withInFlight: <T>(_key: string, work: () => Promise<T>) => work(),
}))
vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: async (key: string) => embedBox.store.get(key) ?? null,
            setItem: async (key: string, value: unknown) => { embedBox.store.set(key, value) },
        }),
    },
}))

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
    dbState.hypaModel = 'MiniLM'
    embedBox.inputs.length = 0
    embedBox.store.clear()
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
    it('does not insert a message the prompt still holds', async () => {
        dbState.hanuraiTokens = 100
        const { block, prompt } = await run(story(8), 40, 100000)
        expect(prompt).toHaveLength(8)
        const inserted = block.split('\n\n').map((text) => text.trim())
        expect(inserted.filter((text) => prompt.includes(text))).toEqual([])
    })

    // regression reproducer: CHORE-10 HAN-1, MC-713 4
    it('inserted text starts with the stored message (no prefix residue)', async () => {
        dbState.hanuraiTokens = 30
        const { block } = await trimmedRun()
        expect(block.length).toBeGreaterThan(0)
        expect(block).toMatch(/^message number/)
        expect(block).not.toMatch(/\n\n /)
    })

    // regression reproducer: CHORE-10 HAN-2, MC-713 4
    it('bounds the retrieved text by the Chunk Size setting', async () => {
        dbState.hanuraiTokens = 30
        const { block } = await trimmedRun()
        expect(block.length).toBeGreaterThan(0)
        expect(await tokenizer.tokenizeChat({ role: 'system', memo: 'supaMemory', content: block })).toBeLessThanOrEqual(30)
    })
})

describe('hanuraiMemory embedding inputs', () => {
    const prefixes = ['search_document: ', 'search_query: ']
    const occurrences = (text: string, part: string) => text.split(part).length - 1

    // regression reproducer: the caller no longer adds the nomic prefixes (the base sends them to every model)
    it('sends the stored messages and the queries to a MiniLM model without any prefix', async () => {
        await run(story(8), 800, 500)
        expect(embedBox.inputs.length).toBeGreaterThan(0)
        for (const input of embedBox.inputs) {
            for (const prefix of prefixes) expect(input).not.toContain(prefix)
        }
        expect(embedBox.inputs).toContain('message number 7')
    })

    // compatibility guard: with nomic the processor adds each prefix exactly once, passes before and after
    it('guard: a nomic model gets each prefix once on the documents and the queries, and the block holds raw messages', async () => {
        dbState.hypaModel = 'nomic'
        const { block } = await run(story(8), 800, 500)
        const documents = embedBox.inputs.filter((input) => input.startsWith('search_document: '))
        const queries = embedBox.inputs.filter((input) => input.startsWith('search_query: '))
        expect(documents.length).toBeGreaterThan(0)
        expect(queries.length).toBeGreaterThan(0)
        expect(documents.length + queries.length).toBe(embedBox.inputs.length)
        for (const input of embedBox.inputs) {
            expect(occurrences(input, 'search_document: ') + occurrences(input, 'search_query: ')).toBe(1)
        }
        expect(block).toMatch(/message number [0-3]/)
        for (const prefix of prefixes) expect(block).not.toContain(prefix)
    })
})

describe('hanuraiMemory retrieval with paragraph splitting', () => {
    const paragraphs = (index: number) => `alpha ${index}\n\nbeta ${index}`
    const storyWith = (first: string): OpenAIChat[] => {
        const chats = story(8)
        chats[0] = { role: 'user', content: first }
        return chats
    }

    // regression reproducer: CHORE-10 HAN-1, MC-713 4
    it('does not insert a paragraph of a multi-paragraph message the prompt still holds', async () => {
        dbState.hanuraiSplit = true
        const { block, prompt } = await run(storyWith(paragraphs(0)), 40, 100000)
        expect(prompt[0]).toBe(paragraphs(0))
        expect(block).not.toMatch(/alpha 0|beta 0/)
    })

    // regression reproducer: CHORE-10 HAN-1, MC-713 4
    it('does not insert a message the prompt holds with surrounding whitespace', async () => {
        const { block, prompt } = await run(storyWith('  padded message  '), 40, 100000)
        expect(prompt[0]).toBe('  padded message  ')
        expect(block).not.toContain('padded message')
    })

    // The positive control: the in-prompt check must not suppress retrieval of trimmed-out paragraphs.
    it('guard: paragraphs of a message trimmed out of the prompt are retrieved', async () => {
        dbState.hanuraiSplit = true
        dbState.hanuraiTokens = 100
        const { block, prompt } = await run(storyWith(paragraphs(0)), 800, 500)
        expect(prompt).toEqual(['message number 4', 'message number 5', 'message number 6', 'message number 7'])
        expect(block).toContain('alpha 0')
        expect(block).toContain('beta 0')
    })

    // regression reproducer: CHORE-10 HAN-2, MC-713 4
    // Each retrieved paragraph is counted with the +2 per-item overhead, so the cap is slightly conservative against the joined block.
    it('bounds the retrieved text by the Chunk Size setting', async () => {
        dbState.hanuraiSplit = true
        dbState.hanuraiTokens = 30
        const chats = story(8).map((chat, i) => ({ ...chat, content: paragraphs(i) }))
        const { block } = await run(chats, 800, 500)
        expect(block.length).toBeGreaterThan(0)
        expect(await tokenizer.tokenizeChat({ role: 'system', memo: 'supaMemory', content: block })).toBeLessThanOrEqual(30)
    })

    // regression reproducer: CHORE-10 HAN-2, MC-713 4
    it('skips a retrieved text larger than the Chunk Size and still retrieves a smaller one', async () => {
        dbState.hanuraiTokens = 30
        const { block } = await run(storyWith('x'.repeat(60)), 800, 500)
        expect(block).not.toContain('xxxx')
        expect(block).toContain('message number 1')
    })
})
