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
        async addText() {}
        async similaritySearchScored() { return [] }
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
    room = {}
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
