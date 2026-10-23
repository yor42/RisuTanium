/**
 * hypaMemoryV3 standard and experimental paths over the real module. The summariser
 * (requestChatData) records the text it is asked to summarise and answers
 * `SUMMARY`; embeddings, the database and the stores are stubbed. A message
 * costs 10 tokens unless a test installs its own tokenizer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, Message, character } from 'src/ts/storage/database.svelte'
import type { OpenAIChat } from '../index.svelte'
import type { HypaV3Settings, SerializableHypaV3Data } from './hypav3'

const state = vi.hoisted(() => ({
    settings: {} as HypaV3Settings,
    maxResponse: 0,
    fed: [] as string[],
}))

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({
        maxResponse: state.maxResponse,
        hypaV3Presets: [{ name: 'p', settings: state.settings }],
        hypaV3PresetId: 0,
        hypaAllocatedTokens: 0,
        hypaChunkSize: 0,
    }),
}))
vi.mock('src/ts/process/memory/hypamemory', () => ({
    HypaProcesser: class {
        constructor() {
            return new Proxy(this, { get: (_target, key) => (key === 'then' ? undefined : async () => []) })
        }
    },
    similarity: () => 0,
}))
vi.mock('src/ts/process/memory/contextualEmbedding', () => ({ isContextModel: () => false, getContextProvider: () => null }))
vi.mock('src/ts/process/memory/contextualEmbeddingCache', () => ({
    createContextualChunkCacheKey: () => '',
    mapContextualChunkEmbeddings: () => [],
}))
vi.mock('src/ts/process/memory/hypamemoryv2', () => ({ HypaProcessorV2: class {} }))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('src/ts/process/request/request', () => ({
    requestChatData: async (request: { formated: OpenAIChat[] }) => {
        state.fed.push(request.formated[0].content)
        return { type: 'success', result: 'SUMMARY' }
    },
}))
vi.mock('src/ts/process/webllm', () => ({ chatCompletion: async () => '', unloadEngine: async () => {} }))
vi.mock('src/ts/stores.svelte', () => ({
    selIdState: {},
    DBState: { db: {} },
    hypaV3ProgressStore: { set() {}, update() {}, subscribe() { return () => {} } },
}))
vi.mock('src/ts/util/inlayTokens', () => ({ inlayTokenRegex: /x^/ }))
vi.mock('src/ts/process/index.svelte', () => ({}))

import { createHypaV3Preset, hypaMemoryV3 } from './hypav3'

const char = {} as character
const constantTokenizer = { tokenizeChat: async () => 10 } as unknown as ChatTokenizer
const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer

function message(index: number, role: OpenAIChat['role'] = 'user'): OpenAIChat {
    return { role, content: `#${index}#`, memo: `m${index}` }
}

function story(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => message(i, i % 2 ? 'assistant' : 'user'))
}

function summary(text: string, memoIndexes: number[]) {
    return { text, chatMemos: memoIndexes.map((i) => `m${i}`), isImportant: false, tags: [] }
}

function roomWith(summaries: ReturnType<typeof summary>[], stored: Message[] = []) {
    return { hypaV3Data: { summaries } as unknown as SerializableHypaV3Data, message: stored } as Chat
}

/**
 * `Chat.message` for ids m0..m(count-1): a hidden message stays in the list with `disabled: true`
 * (the caller leaves it out of the sent `chats`), a deleted message is absent from the list.
 */
function storedMessages(count: number, { hidden = [], deleted = [] }: { hidden?: number[]; deleted?: number[] } = {}): Message[] {
    return Array.from({ length: count }, (_, i): Message => ({
        role: 'user',
        data: '',
        chatId: `m${i}`,
        ...(hidden.includes(i) ? { disabled: true } : {}),
    })).filter((_, i) => !deleted.includes(i))
}

// sendChat pushes the greeting without a memo and it has no entry in `Chat.message`, so a summary
// covering it lists an undefined memo that no stored chatId can match.
const greeting: OpenAIChat = { role: 'assistant', content: 'greeting' }
const greetingRoom = () => roomWith([
    { ...summary('G', [0, 1]), chatMemos: [undefined, 'm0', 'm1'] as unknown as string[] },
    summary('S1', [2, 3]),
], storedMessages(9))

function call(
    chats: OpenAIChat[],
    currentTokens: number,
    maxContextTokens: number,
    room: Chat,
    tokenizer: ChatTokenizer = constantTokenizer
) {
    return hypaMemoryV3(chats, currentTokens, maxContextTokens, room, char, tokenizer)
}

function setSettings(overrides: Partial<HypaV3Settings> = {}) {
    state.settings = createHypaV3Preset('p', overrides).settings
}

beforeEach(() => {
    state.maxResponse = 0
    state.fed = []
    setSettings()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** Message indexes (`#n#`) that the summariser was asked to summarise. */
function fedIndexes() {
    return state.fed.flatMap((text) => [...text.matchAll(/#(\d+)#/g)].map((match) => Number(match[1])))
}

/** Deterministic generator so the statistical assertion cannot flake. */
function mulberry32(seed: number) {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// Three equal-size summaries, memory budget for exactly one: the shuffle alone decides which one is kept.
async function pickedIndex(overrides: Partial<HypaV3Settings> = {}) {
    setSettings({ recentMemoryRatio: 0, similarMemoryRatio: 0, ...overrides })
    const summaries = [0, 1, 2].map((i) => summary(`S${i}`.padEnd(100, '.'), [i]))
    const result = await call(story(6), 10, 1000, roomWith(summaries), lengthTokenizer)
    expect(result.error).toBeUndefined()
    const picked = [...result.chats[0].content.matchAll(/S(\d)\./g)].map((match) => Number(match[1]))
    expect(picked).toHaveLength(1)
    return picked[0]
}

async function pickFrequencies(samples: number, overrides: Partial<HypaV3Settings> = {}) {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(20260101))
    const counts = [0, 0, 0]
    for (let i = 0; i < samples; i++) counts[await pickedIndex(overrides)]++
    return counts.map((count) => count / samples)
}

describe('hypaMemoryV3 resume point', () => {
    // 12 messages; 120 input tokens against 60 forces summarisation in both layouts.
    it('guard: summaries in chronological order resume after the last covered message', async () => {
        const room = roomWith([summary('A', [0, 1]), summary('B', [2, 3])])
        const result = await call(story(12), 120, 60, room)
        expect(result.error).toBeUndefined()
        const fed = fedIndexes()
        expect(fed.length).toBeGreaterThan(0)
        expect(Math.min(...fed)).toBe(4)
    })

    // regression reproducer: CHORE-10 V3-2, MC-711 2
    it.fails('summaries not ordered by coverage resume after the latest covered message', async () => {
        // A non-contiguous merge leaves the summary covering m4,m5 first and the newest-by-position summary last.
        const room = roomWith([summary('AC', [0, 1, 4, 5]), summary('B', [2, 3])])
        const result = await call(story(12), 120, 60, room)
        expect(result.error).toBeUndefined()
        const fed = fedIndexes()
        expect(fed.length).toBeGreaterThan(0)
        expect(fed.filter((index) => index <= 5)).toEqual([])
    })
})

describe('hypaMemoryV3 summary batch size', () => {
    /** Message lines of the first summariser request, as `role: #n#`. */
    function firstBatchRoles() {
        return state.fed[0].split('\n').map((line) => line.split(': ')[0])
    }

    it('guard: without the user-message option a batch holds maxChatsPerSummary messages', async () => {
        setSettings({ maxChatsPerSummary: 3, doNotSummarizeUserMessage: false })
        const result = await call(story(20), 200, 100, roomWith([]))
        expect(result.error).toBeUndefined()
        expect(firstBatchRoles()).toEqual(['user', 'assistant', 'user'])
    })

    it('guard: with the user-message option no user message is summarised', async () => {
        setSettings({ maxChatsPerSummary: 3, doNotSummarizeUserMessage: true })
        const result = await call(story(20), 200, 100, roomWith([]))
        expect(result.error).toBeUndefined()
        expect(state.fed.length).toBeGreaterThan(0)
        expect(state.fed.join('\n')).not.toMatch(/^user: /m)
    })

    // regression reproducer: CHORE-10 V3-3, MC-711 3
    it.fails('with the user-message option a batch holds maxChatsPerSummary non-user messages', async () => {
        setSettings({ maxChatsPerSummary: 3, doNotSummarizeUserMessage: true })
        const result = await call(story(20), 200, 100, roomWith([]))
        expect(result.error).toBeUndefined()
        expect(firstBatchRoles()).toEqual(['assistant', 'assistant', 'assistant'])
    })
})

describe('hypaMemoryV3 orphaned summaries', () => {
    // `chats` holds only the sent messages. A hidden message is missing from `chats` but still in
    // `room.message` (`disabled: true`); a deleted message is missing from both.
    const sentWithoutM2 = () => story(9).filter((chat) => chat.memo !== 'm2')
    const twoSummaries = (stored: Message[]) => roomWith([summary('S0', [0, 1, 2]), summary('S1', [3, 4])], stored)
    const hiddenM2 = () => storedMessages(9, { hidden: [2] })
    const deletedM2 = () => storedMessages(9, { deleted: [2] })
    const keptTexts = (result: Awaited<ReturnType<typeof call>>) => result.memory?.summaries.map((s) => s.text)

    // regression reproducer: CHORE-10 V3-4 (V3), MC-711 1
    it.fails('a summary covering a hidden message is kept when Preserve Orphaned Memory is off', async () => {
        const result = await call(sentWithoutM2(), 10, 100000, twoSummaries(hiddenM2()))
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['S0', 'S1'])
    })

    it('guard: a summary covering a deleted message is removed when Preserve Orphaned Memory is off', async () => {
        const result = await call(sentWithoutM2(), 10, 100000, twoSummaries(deletedM2()))
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['S1'])
    })

    it('guard: a summary covering the memo-less greeting is kept when Preserve Orphaned Memory is off', async () => {
        const result = await call([greeting, ...story(9)], 10, 100000, greetingRoom())
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['G', 'S1'])
    })

    it('guard: Preserve Orphaned Memory keeps a summary whose message is missing', async () => {
        setSettings({ preserveOrphanedMemory: true })
        const result = await call(sentWithoutM2(), 10, 100000, twoSummaries(deletedM2()))
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['S0', 'S1'])
    })
})

describe('hypaMemoryV3 random memory selection', () => {
    // regression reproducer: CHORE-10 V3-5, MC-711 4
    it.fails('every unselected summary is equally likely to be picked', async () => {
        const frequencies = await pickFrequencies(6000)
        for (const frequency of frequencies) expect(Math.abs(frequency - 1 / 3)).toBeLessThan(0.03)
    })

    it('guard: exactly one summary fits the random budget and it is one of the stored summaries', async () => {
        expect([0, 1, 2]).toContain(await pickedIndex())
    })
})

describe('hypaMemoryV3 response reservation', () => {
    // regression reproducer: CHORE-10 TOK-1, MC-712 3
    it('the returned token count keeps the response reservation of the input count', async () => {
        state.maxResponse = 100
        // sendChat starts its count at maxResponse plus the prompt; nothing here needs summarising.
        const inputTokens = 150
        const result = await call(story(4), inputTokens, 1000, roomWith([]))
        expect(result.error).toBeUndefined()
        expect(result.currentTokens).toBeGreaterThanOrEqual(inputTokens)
    })
})

// The experimental implementation (`useExperimentalImpl`) is a separate function with its own copy of
// each rule. Similar-memory retrieval is disabled (ratio 0) because it needs the embedding processor.
describe('hypaMemoryV3 experimental implementation', () => {
    const experimental: Partial<HypaV3Settings> = { useExperimentalImpl: true, similarMemoryRatio: 0 }
    const useExperimental = (overrides: Partial<HypaV3Settings> = {}) => setSettings({ ...experimental, ...overrides })
    const keptTexts = (result: Awaited<ReturnType<typeof call>>) => result.memory?.summaries.map((s) => s.text)

    it('guard: summaries in chronological order resume after the last covered message', async () => {
        useExperimental()
        const room = roomWith([summary('A', [0, 1]), summary('B', [2, 3])])
        const result = await call(story(12), 120, 60, room)
        expect(result.error).toBeUndefined()
        const fed = fedIndexes()
        expect(fed.length).toBeGreaterThan(0)
        expect(Math.min(...fed)).toBe(4)
    })

    // regression reproducer: CHORE-10 V3-2 (experimental path), MC-711 2
    it.fails('summaries not ordered by coverage resume after the latest covered message', async () => {
        useExperimental()
        const room = roomWith([summary('AC', [0, 1, 4, 5]), summary('B', [2, 3])])
        const result = await call(story(12), 120, 60, room)
        expect(result.error).toBeUndefined()
        const fed = fedIndexes()
        expect(fed.length).toBeGreaterThan(0)
        expect(fed.filter((index) => index <= 5)).toEqual([])
    })

    const sentWithoutM2 = () => story(9).filter((chat) => chat.memo !== 'm2')
    const twoSummaries = (stored: Message[]) => roomWith([summary('S0', [0, 1, 2]), summary('S1', [3, 4])], stored)

    // regression reproducer: CHORE-10 V3-4 (experimental path), MC-711 1
    it.fails('a summary covering a hidden message is kept when Preserve Orphaned Memory is off', async () => {
        useExperimental()
        const result = await call(sentWithoutM2(), 10, 100000, twoSummaries(storedMessages(9, { hidden: [2] })))
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['S0', 'S1'])
    })

    it('guard: a summary covering a deleted message is removed when Preserve Orphaned Memory is off', async () => {
        useExperimental()
        const result = await call(sentWithoutM2(), 10, 100000, twoSummaries(storedMessages(9, { deleted: [2] })))
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['S1'])
    })

    it('guard: a summary covering the memo-less greeting is kept when Preserve Orphaned Memory is off', async () => {
        useExperimental()
        const result = await call([greeting, ...story(9)], 10, 100000, greetingRoom())
        expect(result.error).toBeUndefined()
        expect(keptTexts(result)).toEqual(['G', 'S1'])
    })

    // regression reproducer: CHORE-10 V3-5 (experimental path), MC-711 4
    it.fails('every unselected summary is equally likely to be picked', async () => {
        const frequencies = await pickFrequencies(6000, experimental)
        for (const frequency of frequencies) expect(Math.abs(frequency - 1 / 3)).toBeLessThan(0.03)
    })

    // regression reproducer: CHORE-10 TOK-1 (experimental path), MC-712 3
    it('the returned token count keeps the response reservation of the input count', async () => {
        useExperimental()
        state.maxResponse = 100
        const inputTokens = 150
        const result = await call(story(4), inputTokens, 1000, roomWith([]))
        expect(result.error).toBeUndefined()
        expect(result.currentTokens).toBeGreaterThanOrEqual(inputTokens)
    })
})
