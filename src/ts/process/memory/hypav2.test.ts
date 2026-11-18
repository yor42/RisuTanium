/**
 * hypaMemoryV2 over the real module with a stubbed summarizer (it echoes the
 * summarised messages as `SUMMARY[...]`, so coverage gaps can only come from
 * hypaMemoryV2's own control flow), a stubbed similarity processor and a
 * constant 10-token message cost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, Message, character } from 'src/ts/storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import type { SerializableHypaV2Data } from './hypav2'
import { toPlainJson } from 'src/ts/storage/store2/codec/normalize'

const summarizer = vi.hoisted(() => ({ calls: 0, failOn: new Set<number>(), inputs: [] as string[] }))
/** What the stubbed similarity processor received. With `echo` set, a search returns every added text with score 1. */
const processorBox = vi.hoisted(() => ({ added: [] as string[], queries: [] as string[], echo: false }))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({
        supaModelType: 'distilbart',
        maxResponse: 0,
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
        async addText(texts: string[]) { processorBox.added.push(...texts) }
        async similaritySearchScored(query: string): Promise<[string, number][]> {
            processorBox.queries.push(query)
            return processorBox.echo ? processorBox.added.map((text): [string, number] => [text, 1]) : []
        }
    },
}))
vi.mock('src/ts/process/transformers', () => ({
    runSummarizer: async (text: string) => {
        summarizer.calls++
        summarizer.inputs.push(text)
        if (summarizer.failOn.has(summarizer.calls)) throw new Error('summarizer unavailable')
        return `SUMMARY[${text.split('\n').map((line) => line.split(': ')[1]).join(',')}]`
    },
}))

import { cleanInvalidChunks, hypaMemoryV2, type HypaV2Data } from './hypav2'
import { hypaV2WithoutMemos } from '../chatTree'

const tokenizer = { tokenizeChat: async () => 10 } as unknown as ChatTokenizer
const char = {} as character

type Room = Pick<Chat, 'hypaV2Data'> & Partial<Pick<Chat, 'message'>>
let room: Room

const newChatMarker: OpenAIChat = { role: 'system', content: '[Start a new chat]', memo: 'NewChat' }
const exampleMarker: OpenAIChat = { role: 'system', content: '[Start a new chat]', memo: 'NewChatExample' }

function story(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `m${i + 1}`,
        memo: `id${i + 1}`,
    }))
}

function exampleTurns(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: `ex${i + 1}`,
        name: i % 2 ? 'example_assistant' : 'example_user',
    }))
}

function callV2(
    chats: OpenAIChat[],
    maxContextTokens: number,
    currentTokens = chats.length * 10,
    chatTokenizer: ChatTokenizer = tokenizer,
) {
    return hypaMemoryV2(chats, currentTokens, maxContextTokens, { message: [], ...room } as Chat, char, chatTokenizer)
}

function summaryTexts(memory: SerializableHypaV2Data | undefined) {
    return (memory?.mainChunks ?? []).map((mainChunk) => mainChunk.text)
}

function coveredMemos(memory: SerializableHypaV2Data | undefined) {
    return new Set((memory?.mainChunks ?? []).flatMap((mainChunk) => mainChunk.chatMemos))
}

beforeEach(() => {
    summarizer.calls = 0
    summarizer.failOn = new Set()
    summarizer.inputs = []
    processorBox.added = []
    processorBox.queries = []
    processorBox.echo = false
    room = {}
})

describe('hypaMemoryV2 embedding texts', () => {
    const chunkTexts = (memory: SerializableHypaV2Data | undefined) => (memory?.chunks ?? []).map((chunk) => chunk.text.trim())
    const detailSegments = (content: string) =>
        (content.match(/<Past Events Details>([\s\S]*?)<\/Past Events Details>/)?.[1] ?? '').split('\n\n').filter((part) => part.length > 0)

    // regression reproducer: the processor owns the model prefix, so hypaMemoryV2 adds none (the base adds the nomic prefix)
    it('adds the trimmed chunk texts to the processor without a prefix', async () => {
        const result = await callV2([newChatMarker, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        expect(chunkTexts(result.memory).length).toBeGreaterThan(0)
        expect(processorBox.added).toEqual(chunkTexts(result.memory))
    })

    // compatibility guard: a retrieved text is inserted whole (the base cuts the prefix length off the echoed prefixed text)
    it('guard: inserts each retrieved chunk text verbatim in the details section', async () => {
        processorBox.echo = true
        const result = await callV2([newChatMarker, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        const chunks = chunkTexts(result.memory)
        const segments = detailSegments(result.chats[0].content)
        expect(segments.length).toBeGreaterThan(0)
        for (const segment of segments) expect(chunks).toContain(segment)
    })

    // regression reproducer: the queries are the raw last messages (the base adds the nomic query prefix)
    it('queries with the raw content of the latest messages', async () => {
        const chats = [newChatMarker, ...story(20)]
        const expected = [chats[20].content, chats[19].content, chats[18].content]
        await callV2(chats, 200)
        expect(processorBox.queries).toEqual(expected)
    })

    // regression reproducer: a latest message without text sends no empty query (the base sent the non-empty query prefix)
    it('skips messages with empty or whitespace-only content when querying', async () => {
        const chats = [newChatMarker, ...story(20)]
        chats[20] = { ...chats[20], content: '' }
        chats[19] = { ...chats[19], content: '  \n' }
        await callV2(chats, 200)
        expect(processorBox.queries).toEqual([chats[18].content])
    })
})

describe('hypaMemoryV2 summarisation coverage', () => {
    /** Memos of messages the call removed from the prompt, apart from the marker and the memory block. */
    function removedMemos(before: OpenAIChat[], after: OpenAIChat[]) {
        const kept = new Set(after.map((chat) => chat.memo))
        return before.map((chat) => chat.memo ?? '').filter((memo) => !kept.has(memo) && memo !== 'NewChat')
    }

    it('guard: without failures every message removed from the prompt is covered by a summary', async () => {
        const chats = [newChatMarker, ...story(20)]
        const result = await callV2(chats, 200)
        expect(result.error).toBeUndefined()
        const covered = coveredMemos(result.memory)
        const removed = removedMemos(chats, result.chats)
        expect(removed.length).toBeGreaterThan(0)
        expect(removed.filter((memo) => !covered.has(memo))).toEqual([])
    })

    // regression reproducer: CHORE-10 V2-1, MC-713 1
    it('a failed summary batch followed by a success leaves no removed message uncovered', async () => {
        summarizer.failOn = new Set([1])
        const chats = [newChatMarker, ...story(20)]
        const result = await callV2(chats, 200)
        expect(result.error).toBeUndefined()
        const covered = coveredMemos(result.memory)
        expect(removedMemos(chats, result.chats).filter((memo) => !covered.has(memo))).toEqual([])
    })

    it('guard: the first fail-once run still summarises later batches', async () => {
        summarizer.failOn = new Set([1])
        const result = await callV2([newChatMarker, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory).length).toBeGreaterThan(0)
    })
})

describe('hypaMemoryV2 skip rules', () => {
    const summarised = (result: Awaited<ReturnType<typeof callV2>>) => summaryTexts(result.memory).join('\n')

    it('guard: story messages are summarised when examples precede the new-chat marker', async () => {
        const chats = [exampleMarker, ...exampleTurns(2), newChatMarker, ...story(18)]
        const result = await callV2(chats, 100 + chats.length * 7)
        expect(result.error).toBeUndefined()
        expect(summarised(result)).toMatch(/m2/)
    })

    // regression reproducer: CHORE-10 V2-2, MC-713 2
    it('never summarises the example marker, example turns or the new-chat marker', async () => {
        const chats = [exampleMarker, ...exampleTurns(2), newChatMarker, ...story(18)]
        const result = await callV2(chats, 100 + chats.length * 7)
        expect(summarised(result)).not.toMatch(/ex1|ex2|Start a new chat/)
    })

    // regression reproducer: CHORE-10 V2-2, MC-713 2
    it('never summarises example turns that have no leading example marker', async () => {
        const chats = [...exampleTurns(2), newChatMarker, ...story(18)]
        const result = await callV2(chats, 100 + chats.length * 7)
        expect(summarised(result)).not.toMatch(/ex1|ex2|Start a new chat/)
    })

    // regression reproducer: CHORE-10 V2-2, MC-713 2
    it('summarises the first message when the new-chat marker is trimmed and there are no examples', async () => {
        const chats = story(20)
        const result = await callV2(chats, 100 + chats.length * 7)
        expect(summarised(result)).toMatch(/m1[,\]]/)
    })
})

describe('hypaMemoryV2 summary section', () => {
    const stored = (count: number): SerializableHypaV2Data => ({
        lastMainChunkID: count,
        chunks: [],
        mainChunks: Array.from({ length: count }, (_, i) => ({
            id: i + 1,
            text: `S${i + 1}`,
            chatMemos: [`id${i + 1}`],
            lastChatMemo: `id${i + 1}`,
        })),
    })
    const sectionOf = (content: string) =>
        content.match(/<Past Events Summary>([\s\S]*?)<\/Past Events Summary>/)?.[1] ?? ''
    const shown = (content: string) => Array.from(sectionOf(content).matchAll(/S(\d+)/g), (m) => Number(m[1]))

    async function memoryBlock(summaries: number) {
        room = { hypaV2Data: stored(summaries) }
        const result = await callV2([newChatMarker, ...story(20)], 1000, 60)
        expect(result.error).toBeUndefined()
        return result.chats[0].content
    }

    it('guard: summaries that fit in half the allocation are all shown, oldest to newest', async () => {
        expect(shown(await memoryBlock(4))).toEqual([1, 2, 3, 4])
    })

    it('guard: shown summaries keep oldest-to-newest order when not all fit', async () => {
        const ids = shown(await memoryBlock(8))
        expect(ids.length).toBeGreaterThan(0)
        expect(ids).toEqual([...ids].sort((a, b) => a - b))
    })

    // regression reproducer: CHORE-10 V2-3, MC-713 3
    it('shows the newest summary when the summaries exceed half the allocation', async () => {
        expect(shown(await memoryBlock(8))).toContain(8)
    })
})

describe('hypaMemoryV2 token count', () => {
    const recount = async (chats: OpenAIChat[]) => {
        let total = 0
        for (const chat of chats) total += await tokenizer.tokenizeChat(chat)
        return total
    }

    // regression reproducer: CHORE-10 V2-4, MC-713 5
    it('returns the token count of the chats it returns when it skips a blank message', async () => {
        const blank: OpenAIChat = { role: 'user', content: '   ', memo: 'blank' }
        const chats = [newChatMarker, blank, ...story(18)]
        const result = await callV2(chats, 170)
        expect(result.error).toBeUndefined()
        expect(result.chats.length).toBeLessThan(chats.length)
        expect(result.currentTokens).toBe(await recount(result.chats))
    })

    it('guard: the returned token count matches the returned chats when nothing is summarised', async () => {
        const chats = story(20)
        const result = await callV2(chats, 100000)
        expect(result.error).toBeUndefined()
        expect(result.chats).toHaveLength(chats.length + 1)
        expect(result.currentTokens).toBe(await recount(result.chats))
    })
})

describe('hypaMemoryV2 orphan cleanup', () => {
    /** A V2 memory whose first summary covers m0, m1 and m2. */
    const storedMemory = (): SerializableHypaV2Data => ({
        lastMainChunkID: 2,
        chunks: [{ mainChunkID: 1, text: 'c1' }, { mainChunkID: 2, text: 'c2' }],
        mainChunks: [
            { id: 1, text: 'M1 covers m0,m1,m2', chatMemos: ['m0', 'm1', 'm2'], lastChatMemo: 'm2' },
            { id: 2, text: 'M2 covers m3,m4', chatMemos: ['m3', 'm4'], lastChatMemo: 'm4' },
        ],
    })
    const memoChats = (memos: string[]): OpenAIChat[] =>
        memos.map((memo) => ({ role: 'user', content: `content ${memo}`, memo }))

    /**
     * `Chat.message` for ids m0..m8: a hidden message stays in the list with `disabled: true` (the
     * caller leaves it out of the sent `chats`), a deleted message is absent from the list.
     */
    const storedMessages = ({ hidden = [], deleted = [], count = 9 }: { hidden?: number[]; deleted?: number[]; count?: number }): Message[] =>
        Array.from({ length: count }, (_, i): Message => ({
            role: 'user',
            data: '',
            chatId: `m${i}`,
            ...(hidden.includes(i) ? { disabled: true } : {}),
        })).filter((_, i) => !deleted.includes(i))
    const sentWithoutM2 = () => memoChats(['m0', 'm1', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'])

    // regression reproducer: CHORE-10 V3-4 (V2 half), MC-711 1
    it('keeps a summary that covers a hidden message', async () => {
        room = { hypaV2Data: storedMemory(), message: storedMessages({ hidden: [2] }) }
        const result = await callV2(sentWithoutM2(), 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toContain('M1 covers m0,m1,m2')
    })

    it('guard: a summary covering a really deleted message is removed', async () => {
        room = { hypaV2Data: storedMemory(), message: storedMessages({ deleted: [2] }) }
        const result = await callV2(sentWithoutM2(), 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M2 covers m3,m4'])
    })

    it('guard: a summary whose messages are all present is kept', async () => {
        room = { hypaV2Data: storedMemory(), message: storedMessages({}) }
        const result = await callV2(memoChats(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']), 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
    })

    it('guard: a summary covering the memo-less greeting is kept', async () => {
        // sendChat pushes the greeting without a memo and it has no entry in `Chat.message`.
        const memory = storedMemory()
        memory.mainChunks[0].chatMemos = [undefined, 'm0', 'm1'] as unknown as string[]
        room = { hypaV2Data: memory, message: storedMessages({}) }
        const greeting: OpenAIChat = { role: 'assistant', content: 'greeting' }
        const result = await callV2([greeting, ...memoChats(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])], 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
    })

    // guard (passes at HEAD): the stored shape of the greeting's memo is null
    it('guard: a summary covering the memo-less greeting is kept when its memo is stored as null', async () => {
        const memory = storedMemory()
        memory.mainChunks[0].chatMemos = [null, 'm0', 'm1']
        room = { hypaV2Data: memory, message: storedMessages({}) }
        const greeting: OpenAIChat = { role: 'assistant', content: 'greeting' }
        const result = await callV2([greeting, ...memoChats(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])], 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
    })

    // regression reproducer (fails at HEAD): an allBefore reset leaves the greeting and the earlier
    // messages out of `chats`, but they still exist
    it.each([
        ['undefined memo', [undefined, 'm0', 'm1']],
        ['null memo', [null, 'm0', 'm1']],
        ['memo-less only', [undefined]],
    ])('keeps a greeting-covering summary after an allBefore reset (%s)', async (_label, covered) => {
        const memory = storedMemory()
        memory.mainChunks[0].chatMemos = covered as string[]
        room = { hypaV2Data: memory, message: storedMessages({}) }
        const result = await callV2(memoChats(['m5', 'm6', 'm7', 'm8']), 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
    })

    // regression reproducer (fails at HEAD): summaries before the reset point are not orphans
    it('keeps summaries covering messages before the allBefore reset', async () => {
        room = { hypaV2Data: storedMemory(), message: storedMessages({}) }
        const result = await callV2(memoChats(['m5', 'm6', 'm7', 'm8']), 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
    })

    // regression reproducer (fails at HEAD, which also drops the hidden-covered summary): a hidden message
    // elsewhere does not save a summary whose message was removed
    it('a summary whose message left the chat is removed although another covered message is hidden', async () => {
        room = { hypaV2Data: storedMemory(), message: storedMessages({ deleted: [2], hidden: [3] }) }
        const result = await callV2(memoChats(['m0', 'm1', 'm4', 'm5', 'm6', 'm7', 'm8']), 100000, 10)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['M2 covers m3,m4'])
    })

    describe('last covered message hidden', () => {
        const sent = (hidden: number[]) => memoChats(Array.from({ length: 20 }, (_, i) => `m${i}`).filter((_, i) => !hidden.includes(i)))
        const fedLines = () => summarizer.inputs.flatMap((input) => input.split('\n'))

        // regression reproducer (fails at HEAD: the hidden message deletes the second summary, so m3 is fed again)
        it('resumes after the latest covered message, feeds nothing twice and keeps both summaries', async () => {
            room = { hypaV2Data: storedMemory(), message: storedMessages({ hidden: [4], count: 20 }) }
            const result = await callV2(sent([4]), 200)
            expect(result.error).toBeUndefined()
            expect(summarizer.calls).toBeGreaterThan(0)
            expect(summaryTexts(result.memory).slice(0, 2)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
            for (const covered of ['m0', 'm1', 'm2', 'm3', 'm4']) expect(fedLines().some((line) => new RegExp(`content ${covered}\\b`).test(line))).toBe(false)
            expect(new Set(fedLines()).size).toBe(fedLines().length)
        })

        // regression reproducer (fails at HEAD)
        it('keeps the same summary when the message is shown again', async () => {
            room = { hypaV2Data: storedMemory(), message: storedMessages({ hidden: [4], count: 20 }) }
            const hiddenRun = await callV2(sent([4]), 200)
            expect(summaryTexts(hiddenRun.memory).slice(0, 2)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
            summarizer.inputs = []
            room = { hypaV2Data: hiddenRun.memory, message: storedMessages({ count: 20 }) }
            const shown = await callV2(sent([]), 200)
            expect(shown.error).toBeUndefined()
            expect(summaryTexts(shown.memory).slice(0, 2)).toEqual(['M1 covers m0,m1,m2', 'M2 covers m3,m4'])
            expect(fedLines().some((line) => /content m4\b/.test(line))).toBe(false)
        })
    })
})

describe('hypaMemoryV2 failed batch retry', () => {
    const chatsWithMarker = () => [newChatMarker, ...story(20)]

    // regression reproducer: CHORE-10 V2-1, MC-713 1 (HEAD feeds the summarizer a different batch after a failure)
    it('retries the same batch after a failed summary', async () => {
        summarizer.failOn = new Set([1])
        const result = await callV2(chatsWithMarker(), 200)
        expect(result.error).toBeUndefined()
        expect(summarizer.inputs.length).toBeGreaterThan(1)
        expect(summarizer.inputs[1]).toBe(summarizer.inputs[0])
    })

    // regression reproducer: CHORE-10 V2-1, MC-713 1 (HEAD fails on the equality of the three attempts)
    it('aborts after three failures on one batch, all three attempts with the same input', async () => {
        summarizer.failOn = new Set([1, 2, 3])
        const result = await callV2(chatsWithMarker(), 200)
        expect(result.error).toMatch(/failed multiple times/)
        expect(result.memory).toBeUndefined()
        expect(summarizer.inputs).toHaveLength(3)
        expect(new Set(summarizer.inputs).size).toBe(1)
    })

    // compatibility guard: the success reset exists at HEAD
    it('guard: non-consecutive failures never abort', async () => {
        summarizer.failOn = new Set([1, 3, 5])
        const result = await callV2([newChatMarker, ...story(60)], 500)
        expect(result.error).toBeUndefined()
        expect(summarizer.calls).toBeGreaterThanOrEqual(6)
        expect(summaryTexts(result.memory).length).toBeGreaterThan(0)
    })

    // regression reproducer: CHORE-10 V2-1 and V2-4 (HEAD miscounts: the failed batch is skipped and the blank is not deducted)
    it('deducts skipped messages exactly once when a batch fails and is retried', async () => {
        summarizer.failOn = new Set([1])
        const blank: OpenAIChat = { role: 'user', content: '   ', memo: 'blank' }
        const chats = [newChatMarker, blank, ...story(30)]
        const result = await callV2(chats, 250)
        expect(result.error).toBeUndefined()
        expect(result.chats.length).toBeLessThan(chats.length)
        let recount = 0
        for (const chat of result.chats) recount += await tokenizer.tokenizeChat(chat)
        expect(result.currentTokens).toBe(recount)
    })
})

describe('hypaMemoryV2 memo-less chats and resume', () => {
    const greeting: OpenAIChat = { role: 'assistant', content: 'greeting' }
    const fed = (text: string) => summarizer.inputs.some((input) => new RegExp(`\\b${text}\\b`).test(input))
    /** Real producer shape: one mainChunk with `chatMemos` as a list and `lastChatMemo` of the batch. */
    const stored = (
        chatMemos: (string | null | undefined)[],
        lastChatMemo: string | undefined,
    ): SerializableHypaV2Data => ({
        lastMainChunkID: 1,
        chunks: [{ mainChunkID: 1, text: 'S1' }],
        mainChunks: [{ id: 1, text: 'S1', chatMemos, lastChatMemo }],
    })
    /** A tokenizer whose `big` messages fill a whole batch alone. */
    const sizedTokenizer = {
        tokenizeChat: async (chat: OpenAIChat) => (chat.content.startsWith('big') ? 25 : 10),
    } as unknown as ChatTokenizer

    // regression reproducer: loader null mapping (store2 saves the greeting's undefined memo as null)
    it('keeps a greeting-covering summary after the saved data is reloaded', async () => {
        const chats = [newChatMarker, greeting, ...story(20)]
        const first = await callV2(chats, 200)
        expect(first.error).toBeUndefined()
        expect(fed('greeting')).toBe(true)
        room = { hypaV2Data: toPlainJson(first.memory) as unknown as SerializableHypaV2Data }
        expect(room.hypaV2Data.mainChunks[0].chatMemos).toContain(null)
        summarizer.inputs = []
        const second = await callV2(chats, 200)
        expect(second.error).toBeUndefined()
        expect(summaryTexts(second.memory)[0]).toBe(summaryTexts(first.memory)[0])
        expect(fed('greeting')).toBe(false)
    })

    // regression reproducer: loader null mapping (HEAD drops the summary because null is not a current memo)
    it('does not re-summarise a greeting covered by the only summary, stored with a null memo', async () => {
        room = { hypaV2Data: stored([null], undefined) }
        const result = await callV2([newChatMarker, greeting, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        expect(fed('greeting')).toBe(false)
        expect(summaryTexts(result.memory)[0]).toBe('S1')
    })

    // compatibility guard (MC-723 limitation): examples + a greeting-only batch, then later batches
    it('guard: a greeting summarised alone is summarised once and not fed again on the next send', async () => {
        const chats = [exampleMarker, ...exampleTurns(2), newChatMarker, greeting, { role: 'user', content: 'big1', memo: 'id1' }, ...story(18).map((chat, i) => ({ ...chat, memo: `id${i + 2}` }))] as OpenAIChat[]
        const first = await callV2(chats, 200, 300, sizedTokenizer)
        expect(first.error).toBeUndefined()
        expect(summarizer.inputs.filter((input) => input.includes('greeting'))).toHaveLength(1)
        room = { hypaV2Data: toPlainJson(first.memory) as unknown as SerializableHypaV2Data }
        summarizer.inputs = []
        const second = await callV2(chats, 200, 300, sizedTokenizer)
        expect(second.error).toBeUndefined()
        expect(fed('greeting')).toBe(false)
    })

    // compatibility guard: a summary upstream wrote over an example turn only never hides the greeting
    it.each([
        ['stored null memo', null],
        ['in-memory undefined memo', undefined],
    ])('guard: the greeting is summarised or kept, not lost, after an example-only summary (%s)', async (_label, memo) => {
        room = { hypaV2Data: stored([memo], undefined) }
        const chats = [exampleMarker, ...exampleTurns(2), newChatMarker, greeting, ...story(18)]
        const result = await callV2(chats, 100 + chats.length * 7)
        expect(result.error).toBeUndefined()
        expect(fed('greeting') || result.chats.some((chat) => chat.content === 'greeting')).toBe(true)
    })

    // compatibility guard (passes at HEAD): a summary covering only the new-chat marker resumes at the greeting
    it('guard: feeds the greeting when the only summary covers the new-chat marker', async () => {
        room = { hypaV2Data: stored(['NewChat'], 'NewChat') }
        const result = await callV2([newChatMarker, greeting, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        expect(fed('greeting')).toBe(true)
    })

    // compatibility guard: a set that reaches a real id resumes after it
    it('guard: a set holding the marker and a real id resumes after the real id', async () => {
        room = { hypaV2Data: stored(['NewChat', 'id2'], 'id2') }
        const result = await callV2([newChatMarker, greeting, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        expect(fed('greeting')).toBe(false)
        expect(fed('m2')).toBe(false)
        expect(fed('m3')).toBe(true)
    })

    // regression reproducer: HEAD resumes by lastChatMemo (id1) and feeds m2 and m3 again
    it('resumes after the latest memo of a set that lists it first', async () => {
        room = { hypaV2Data: stored(['id3', 'id1'], 'id1') }
        const result = await callV2(story(20), 200)
        expect(result.error).toBeUndefined()
        expect(fed('m3')).toBe(false)
        expect(fed('m4')).toBe(true)
    })

    // compatibility guard: the undefined member does not win over a later real id
    it('guard: a set {id1, undefined} resumes after id1', async () => {
        room = { hypaV2Data: stored([undefined, 'id1'], 'id1') }
        const result = await callV2([greeting, ...story(20)], 200)
        expect(result.error).toBeUndefined()
        expect(summarizer.inputs[0].startsWith('assistant: m2')).toBe(true)
        expect(fed('m1')).toBe(false)
        expect(fed('m2')).toBe(true)
    })
})

// Old-format data names chat ids; the converter must resolve them against the whole message list, not only the visible `chats`.
describe('hypaMemoryV2 old-format conversion', () => {
    const greeting: OpenAIChat = { role: 'assistant', content: 'greeting' }
    const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `m${from + i}`)
    const chatOf = (id: string): OpenAIChat => ({ role: 'user', content: id, memo: id })
    const messageOf = (chatId: string, disabled?: true | 'allBefore') =>
        ({ role: 'char', data: chatId, chatId, ...(disabled ? { disabled } : {}) }) as Message
    /** A hidden message that was never sent has no chat id. */
    const unsent = { role: 'char', data: 'unsent', disabled: true } as Message
    const at = (text: string, targetId: string) => ({ text, targetId })
    /** Real producer shape: `mainChunks` newest first, every entry `{text, targetId, chatRange}`; the 2024-05 producer omitted `chatRange`. */
    const oldData = (
        mainChunks: { text: string, targetId: string }[],
        chunks: { text: string, targetId: string }[],
        withRange = true,
    ) => {
        const entry = (item: { text: string, targetId: string }) => (withRange ? { ...item, chatRange: [0, 0] } : item)
        return { mainChunks: mainChunks.map(entry), chunks: chunks.map(entry) } as unknown as SerializableHypaV2Data
    }
    const old3 = () => oldData(
        [at('S3', 'm8'), at('S2', 'm5'), at('S1', 'm2')],
        [at('c1', 'm2'), at('c2', 'm5'), at('c3a', 'm8'), at('c3b', 'm8')],
    )
    /** m0..m11 with m5 hidden; `chats` leaves m5 out. */
    const h12 = () => ({
        messages: ids(0, 11).map((id) => messageOf(id, id === 'm5' ? true : undefined)),
        chats: [newChatMarker, greeting, ...ids(0, 4).map(chatOf), ...ids(6, 11).map(chatOf)],
    })
    /** m0..m11 with m4 an `allBefore` reset; `chats` starts after it and has no greeting. */
    const rst = () => ({
        messages: ids(0, 11).map((id) => messageOf(id, id === 'm4' ? 'allBefore' : undefined)),
        chats: [newChatMarker, ...ids(5, 11).map(chatOf)],
    })
    const rstOld = (previousTarget: string) => oldData(
        [at('S3', 'm9'), at('S2', 'm6'), at('S1', previousTarget)],
        [at('c1', previousTarget), at('c2', 'm6'), at('c3', 'm9')],
    )
    const fed = (text: string) => summarizer.inputs.some((input) => new RegExp(`\\b${text}\\b`).test(input))
    const run = (
        fixture: { messages: Message[], chats: OpenAIChat[] },
        hypaV2Data: SerializableHypaV2Data,
        maxContextTokens = 100000,
        currentTokens = 10,
    ) => {
        room = { hypaV2Data, message: fixture.messages }
        return callV2(fixture.chats, maxContextTokens, currentTokens)
    }
    const summary = (memory: SerializableHypaV2Data | undefined, text: string) =>
        memory?.mainChunks.find((mainChunk) => mainChunk.text === text)

    // regression reproducer: a hidden target and a hidden previous target each lost their summary
    it('keeps the summaries whose target is hidden, with their sub-chunks', async () => {
        const { messages, chats } = h12()
        const result = await run({ messages, chats }, old3())
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2', 'S3'])
        expect(summary(result.memory, 'S1')?.chatMemos).toStrictEqual(['NewChat', undefined, 'm0', 'm1', 'm2'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['m2', 'm3', 'm4', 'm5'])
        expect(result.memory?.chunks).toContainEqual({ mainChunkID: 1, text: 'c2' })
    })

    // regression reproducer: only the previous target is hidden
    it('keeps a summary whose previous target is hidden, with both sub-chunks', async () => {
        const { messages, chats } = h12()
        const result = await run({ messages, chats }, old3())
        expect(result.error).toBeUndefined()
        const s3 = summary(result.memory, 'S3')
        expect(s3?.chatMemos).toStrictEqual(['m5', 'm6', 'm7', 'm8'])
        expect(s3?.id).toBe(2)
        expect(result.memory?.chunks.filter((chunk) => chunk.mainChunkID === s3?.id).map((chunk) => chunk.text)).toEqual(['c3a', 'c3b'])
    })

    // regression reproducer: summaries before an allBefore reset
    it('keeps the summaries before an allBefore reset and leaves the visible one unchanged', async () => {
        const result = await run(rst(), rstOld('m2'))
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2', 'S3'])
        expect(summary(result.memory, 'S1')?.chatMemos).toStrictEqual(['NewChat', 'm2'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['m2', 'm5', 'm6'])
        expect(result.memory?.mainChunks[2]).toStrictEqual({ id: 2, text: 'S3', chatMemos: ['m6', 'm7', 'm8', 'm9'], lastChatMemo: 'm9' })
        expect(result.memory?.lastMainChunkID).toBe(2)
    })

    // regression reproducer: the allBefore marker itself is a target, and the next summary's previous target
    it('keeps summaries whose target is the allBefore marker', async () => {
        const old = oldData(
            [at('S3', 'm9'), at('S2', 'm4'), at('S1', 'm2')],
            [at('c1', 'm2'), at('c2', 'm4'), at('c3', 'm9')],
        )
        const result = await run(rst(), old)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2', 'S3'])
        expect(summary(result.memory, 'S1')?.chatMemos).toStrictEqual(['NewChat', 'm2'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['m2', 'm4'])
        expect(summary(result.memory, 'S3')?.chatMemos).toStrictEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'm9'])
    })

    // regression reproducer: base resumes after m2 and feeds m3..m8 again
    it('does not summarise again a message the restored summaries cover', async () => {
        const messages = ids(0, 19).map((id) => messageOf(id, id === 'm5' ? true : undefined))
        const chats = [newChatMarker, greeting, ...ids(0, 4).map(chatOf), ...ids(6, 19).map(chatOf)]
        const result = await run({ messages, chats }, old3(), 150, chats.length * 10)
        expect(result.error).toBeUndefined()
        expect(summarizer.calls).toBeGreaterThan(0)
        for (const id of ids(0, 8)) expect(fed(id)).toBe(false)
        const lines = summarizer.inputs.flatMap((input) => input.split('\n'))
        expect(new Set(lines).size).toBe(lines.length)
    })

    // regression reproducer: a marker is the previous target and the target is hidden
    it('keeps a summary whose previous target is the new-chat marker and whose target is hidden', async () => {
        const messages = ids(0, 9).map((id) => messageOf(id, id === 'm5' ? true : undefined))
        const chats = [newChatMarker, greeting, ...ids(0, 4).map(chatOf), ...ids(6, 9).map(chatOf)]
        const old = oldData([at('S2', 'm5'), at('S1', 'NewChat')], [at('c1', 'NewChat'), at('c2', 'm5')], false)
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['NewChat', undefined, 'm0', 'm1', 'm2', 'm3', 'm4', 'm5'])
    })

    // regression reproducer: an unsent hidden message inside a restored range is not a chat id
    it('keeps an unsent hidden message out of a restored range', async () => {
        const messages = [
            ...ids(0, 3).map((id) => messageOf(id)), unsent, messageOf('m4'), messageOf('m5', true), ...ids(6, 9).map((id) => messageOf(id)),
        ]
        const chats = [newChatMarker, greeting, ...ids(0, 4).map(chatOf), ...ids(6, 9).map(chatOf)]
        const old = oldData([at('S2', 'm5'), at('S1', 'm2')], [at('c1', 'm2'), at('c2', 'm5')])
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['m2', 'm3', 'm4', 'm5'])
    })

    // compatibility guard (passes before and after): all visible, examples present; the output is what the unfixed converter writes
    it('guard: all-visible old data converts to the same summaries as before', async () => {
        const messages = ids(0, 11).map((id) => messageOf(id))
        const chats = [exampleMarker, ...exampleTurns(2), newChatMarker, greeting, ...ids(0, 11).map(chatOf)]
        const result = await run({ messages, chats }, old3())
        expect(result.error).toBeUndefined()
        expect(result.memory).toStrictEqual({
            lastMainChunkID: 2,
            mainChunks: [
                { id: 0, text: 'S1', chatMemos: ['NewChatExample', undefined, 'NewChat', 'm0', 'm1', 'm2'], lastChatMemo: 'm2' },
                { id: 1, text: 'S2', chatMemos: ['m2', 'm3', 'm4', 'm5'], lastChatMemo: 'm5' },
                { id: 2, text: 'S3', chatMemos: ['m5', 'm6', 'm7', 'm8'], lastChatMemo: 'm8' },
            ],
            chunks: [
                { mainChunkID: 0, text: 'c1' },
                { mainChunkID: 1, text: 'c2' },
                { mainChunkID: 2, text: 'c3a' },
                { mainChunkID: 2, text: 'c3b' },
            ],
        })
    })

    // compatibility guard (passes before and after): a new-chat marker target still converts
    it('guard: a new-chat marker target still converts', async () => {
        const messages = ids(0, 9).map((id) => messageOf(id))
        const chats = [newChatMarker, greeting, ...ids(0, 9).map(chatOf)]
        const old = oldData([at('S2', 'm3'), at('S1', 'NewChat')], [at('c1', 'NewChat'), at('c2', 'm3')], false)
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2'])
        expect(summary(result.memory, 'S1')?.chatMemos).toStrictEqual(['NewChat'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['NewChat', undefined, 'm0', 'm1', 'm2', 'm3'])
    })

    // compatibility guard (passes before and after): an unsent hidden message between visible targets
    it('guard: an unsent hidden message between visible targets stays out of the range', async () => {
        const messages = [...ids(0, 3).map((id) => messageOf(id)), unsent, ...ids(4, 9).map((id) => messageOf(id))]
        const chats = [newChatMarker, greeting, ...ids(0, 9).map(chatOf)]
        const old = oldData([at('S2', 'm5'), at('S1', 'm2')], [at('c1', 'm2'), at('c2', 'm5')])
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['m2', 'm3', 'm4', 'm5'])
    })

    // compatibility guard (passes before and after): a deleted target drops its summary, its sub-chunks and the next summary
    it('guard: a target that is no message at all is still dropped with its sub-chunks', async () => {
        const messages = ids(0, 11).filter((id) => id !== 'm5').map((id) => messageOf(id))
        const chats = [newChatMarker, greeting, ...ids(0, 11).filter((id) => id !== 'm5').map(chatOf)]
        const result = await run({ messages, chats }, old3())
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1'])
        expect(result.memory?.chunks).toEqual([{ mainChunkID: 0, text: 'c1' }])
        expect(result.memory?.lastMainChunkID).toBe(0)
    })

    // compatibility guard (passes before and after): the converted output is kept unchanged when it is saved and sent again
    it.each([
        ['all visible', () => ({
            messages: ids(0, 11).map((id) => messageOf(id)),
            chats: [exampleMarker, ...exampleTurns(2), newChatMarker, greeting, ...ids(0, 11).map(chatOf)],
        })],
        ['hidden target', h12],
    ])('guard: the converted data survives a save and a second send (%s)', async (_label, build) => {
        const fixture = build()
        const first = await run(fixture, old3())
        expect(first.error).toBeUndefined()
        room = { hypaV2Data: toPlainJson(first.memory) as unknown as SerializableHypaV2Data, message: fixture.messages }
        const second = await callV2(fixture.chats, 100000, 10)
        expect(second.error).toBeUndefined()
        expect(second.memory?.mainChunks).toStrictEqual(first.memory?.mainChunks)
        expect(second.memory?.chunks).toStrictEqual(first.memory?.chunks)
    })

    // compatibility guard (passes before and after): a second new-chat example marker as target resolves at its first occurrence
    it('guard: a repeated example marker target resolves at its first occurrence', async () => {
        const messages = ids(0, 9).map((id) => messageOf(id))
        const chats = [
            exampleMarker, ...exampleTurns(2), exampleMarker, ...exampleTurns(2), newChatMarker, greeting, ...ids(0, 9).map(chatOf),
        ]
        const old = oldData([at('S2', 'm2'), at('S1', 'NewChatExample')], [at('c1', 'NewChatExample'), at('c2', 'm2')])
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(result.memory?.mainChunks).toStrictEqual([
            { id: 0, text: 'S1', chatMemos: ['NewChatExample'], lastChatMemo: 'NewChatExample' },
            { id: 1, text: 'S2', chatMemos: ['NewChatExample', undefined, 'NewChat', 'm0', 'm1', 'm2'], lastChatMemo: 'm2' },
        ])
    })

    // compatibility guard (passes before and after): a duplicated chat id keeps the range over `chats`
    it('guard: a duplicated chat id with a hidden earlier copy keeps the ranges over chats', async () => {
        const messages = [
            messageOf('m0'), messageOf('m1'), messageOf('dup', true), messageOf('m2'), messageOf('m3'), messageOf('dup'), ...ids(4, 9).map((id) => messageOf(id)),
        ]
        const chats = [newChatMarker, greeting, ...ids(0, 3).map(chatOf), chatOf('dup'), ...ids(4, 9).map(chatOf)]
        const old = oldData([at('S3', 'm6'), at('S2', 'dup'), at('S1', 'm2')], [at('c1', 'm2'), at('c2', 'dup'), at('c3', 'm6')])
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(result.memory?.mainChunks.map((mainChunk) => mainChunk.chatMemos)).toStrictEqual([
            ['NewChat', undefined, 'm0', 'm1', 'm2'],
            ['m2', 'm3', 'dup'],
            ['dup', 'm4', 'm5', 'm6'],
        ])
    })

    // compatibility guard (passes before and after): a summary the old code kept in a reset chat is unchanged apart from its id
    it('guard: a summary kept before the fix keeps its memos and sub-chunks when others are restored', async () => {
        const result = await run(rst(), rstOld('m2'))
        expect(result.error).toBeUndefined()
        const s3 = summary(result.memory, 'S3')
        expect({ text: s3?.text, chatMemos: s3?.chatMemos, lastChatMemo: s3?.lastChatMemo }).toStrictEqual({
            text: 'S3',
            chatMemos: ['m6', 'm7', 'm8', 'm9'],
            lastChatMemo: 'm9',
        })
        expect(result.memory?.chunks.filter((chunk) => chunk.mainChunkID === s3?.id).map((chunk) => chunk.text)).toEqual(['c3'])
    })

    // compatibility guard (passes before and after; must pass on the unmodified converter): a hidden message strictly between two visible targets stays out
    it('guard: a hidden message between two visible targets stays out of the range', async () => {
        const messages = ids(0, 9).map((id) => messageOf(id, id === 'm3' ? true : undefined))
        const chats = [newChatMarker, greeting, ...ids(0, 2).map(chatOf), ...ids(4, 9).map(chatOf)]
        const old = oldData([at('S2', 'm5'), at('S1', 'm2')], [at('c1', 'm2'), at('c2', 'm5')])
        const result = await run({ messages, chats }, old)
        expect(result.error).toBeUndefined()
        expect(summaryTexts(result.memory)).toEqual(['S1', 'S2'])
        expect(summary(result.memory, 'S2')?.chatMemos).toStrictEqual(['m2', 'm4', 'm5'])
    })
})

// The tree module's `hypaV2WithoutMemos` stands in for the send-time cleanup on a branch switch; this ties the two together.
describe('cleanInvalidChunks and hypaV2WithoutMemos', () => {
    const pathIds = ['p1', 'p2', 'p3']
    const departing = new Set(['d1'])

    function withSets(rows: { id: number, memos: string[] }[]): HypaV2Data {
        return {
            lastMainChunkID: rows[rows.length - 1].id,
            mainChunks: rows.map((row) => ({ id: row.id, text: `t${row.id}`, chatMemos: new Set(row.memos), lastChatMemo: row.memos[row.memos.length - 1] })),
            chunks: rows.map((row) => ({ mainChunkID: row.id, text: `c${row.id}` })),
        }
    }

    function asArrays(data: HypaV2Data): SerializableHypaV2Data {
        return { ...data, mainChunks: data.mainChunks.map((mainChunk) => ({ ...mainChunk, chatMemos: [...mainChunk.chatMemos] })) }
    }

    function roomOf(ids: string[]): Chat {
        return { message: ids.map((chatId) => ({ role: 'char', data: chatId, chatId }) as Message) } as Chat
    }

    // compatibility guard: passes before and after; a change to either side's rule breaks the equality
    it('guard: both drop the summaries that name a departing message, with their chunks and the last id', () => {
        const data = withSets([{ id: 1, memos: ['p1', 'p2'] }, { id: 2, memos: ['d1'] }, { id: 3, memos: ['p3', 'd1'] }, { id: 4, memos: ['p3'] }])
        const expected = hypaV2WithoutMemos(asArrays(data), departing)
        cleanInvalidChunks([], roomOf(pathIds), data)
        expect(asArrays(data)).toEqual(expected)
        expect(expected.mainChunks.map((mainChunk) => mainChunk.id)).toEqual([1, 4])
    })

    // compatibility guard: hypaV2WithoutMemos returns its input unchanged when nothing is removed, so its last id is the stored
    // one, while cleanInvalidChunks recomputes it; the fixture's stored id is the last id, so the two agree
    it('guard: both leave data alone when no summary names a departing message', () => {
        const data = withSets([{ id: 1, memos: ['p1'] }, { id: 2, memos: ['p2', 'p3'] }])
        const expected = hypaV2WithoutMemos(asArrays(data), departing)
        cleanInvalidChunks([], roomOf(pathIds), data)
        expect(asArrays(data)).toEqual(expected)
    })
})
