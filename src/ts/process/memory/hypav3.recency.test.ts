/**
 * Summary recency in both hypaMemoryV3 implementations over the real module. Similarity is scripted
 * through the embedding mocks: a chunk text carries its score as an `@0.9` suffix. The summariser
 * answers `SUMMARY`; the database and the stores are stubbed. This file deliberately does not import
 * the recency helpers, so every row exercises the module as a user of the setting would.
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

const scripted = vi.hoisted(() => ({
    scoreOf: (text: string): number => {
        const match = /@(\d+(?:\.\d+)?)/.exec(text)
        return match ? Number(match[1]) : 0
    },
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
        vectors: { content: string; embedding: number[] }[] = []
        model = 'test-embedding'
        oaikey = ''

        async addText(texts: string[]) {
            for (const content of texts) {
                this.vectors.push({ content, embedding: [scripted.scoreOf(content)] })
            }
        }

        async getEmbeds() {
            return [[1]]
        }
    },
    similarity: (_query: number[], vector: number[]) => vector[0],
}))
vi.mock('src/ts/process/memory/contextualEmbedding', () => ({ isContextModel: () => false, getContextProvider: () => null }))
vi.mock('src/ts/process/memory/contextualEmbeddingCache', () => ({
    createContextualChunkCacheKey: () => '',
    mapContextualChunkEmbeddings: () => [],
}))
vi.mock('src/ts/process/memory/hypamemoryv2', () => ({
    HypaProcessorV2: class {
        progressCallback: unknown = null
        texts: { id: string; content: string; metadata?: unknown }[] = []
        scored: [{ id: string; content: string; metadata?: unknown; embedding: number[] }, number][] | null = null

        async addTexts(texts: { id: string; content: string; metadata?: unknown }[]) {
            this.texts.push(...texts)
        }

        async similaritySearchScoredBatch(queries: string[]) {
            // The same result objects answer every query, so the chunk fusion sees stable identities.
            this.scored ??= this.texts
                .map((text): [typeof text & { embedding: number[] }, number] => {
                    const score = scripted.scoreOf(text.content)
                    return [{ ...text, embedding: [score] }, score]
                })
                .sort((a, b) => b[1] - a[1])
            return queries.map(() => this.scored)
        }
    },
}))
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

const NOW = 1_763_424_000_000
const DAY = 86_400_000
const char = {} as character
const constantTokenizer = { tokenizeChat: async () => 10 } as unknown as ChatTokenizer
const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer

const IMPLEMENTATIONS: [string, Partial<HypaV3Settings>][] = [
    ['standard', {}],
    ['experimental', { useExperimentalImpl: true }],
]

function message(index: number, role: OpenAIChat['role'] = 'user'): OpenAIChat {
    return { role, content: `#${index}#`, memo: `m${index}` }
}

function story(count: number): OpenAIChat[] {
    return Array.from({ length: count }, (_, i) => message(i, i % 2 ? 'assistant' : 'user'))
}

/** Shaped like the summary literal the summarizers push; `createdAt` is absent when untimed. */
function summary(text: string, memoIndexes: number[], createdAt?: number) {
    return {
        text,
        chatMemos: memoIndexes.map((i) => `m${i}`),
        isImportant: false,
        tags: [],
        ...(createdAt === undefined ? {} : { createdAt }),
    }
}

function roomWith(summaries: ReturnType<typeof summary>[], stored: Message[] = []) {
    return { hypaV3Data: { summaries } as unknown as SerializableHypaV3Data, message: stored } as Chat
}

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

/** Deterministic generator so the statistical assertions cannot flake. */
function mulberry32(seed: number) {
    let a = seed
    return () => {
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

beforeEach(() => {
    state.maxResponse = 0
    state.fed = []
    setSettings()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** One of the equal-size summaries fits the random budget; `ages` are creation offsets in ms (undefined = untimed). */
async function pickedIndex(ages: (number | undefined)[], overrides: Partial<HypaV3Settings>) {
    setSettings({ recentMemoryRatio: 0, similarMemoryRatio: 0, ...overrides })
    const summaries = ages.map((age, i) => summary(`S${i}`.padEnd(100, '.'), [i], age === undefined ? undefined : NOW - age))
    const result = await call(story(6), 10, 1000, roomWith(summaries), lengthTokenizer)
    expect(result.error).toBeUndefined()
    const picked = [...result.chats[0].content.matchAll(/S(\d)\./g)].map((match) => Number(match[1]))
    expect(picked).toHaveLength(1)
    return picked[0]
}

async function pickSequence(samples: number, ages: (number | undefined)[], overrides: Partial<HypaV3Settings>, seed = 20260101) {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(seed))
    const picks: number[] = []
    for (let i = 0; i < samples; i++) picks.push(await pickedIndex(ages, overrides))
    return picks
}

function frequenciesOf(picks: number[], size: number) {
    const counts = new Array<number>(size).fill(0)
    for (const pick of picks) counts[pick]++
    return counts.map((count) => count / picks.length)
}

function expectFrequencies(actual: number[], expected: number[], tolerance = 0.03) {
    expected.forEach((value, i) => expect(Math.abs(actual[i] - value)).toBeLessThan(tolerance))
}

/** Summary texts named in the memory prompt of a similar-only call, in prompt order. */
function selectedTexts(result: Awaited<ReturnType<typeof call>>) {
    return [...result.chats[0].content.matchAll(/[A-Z]+@[\d.]+/g)].map((match) => match[0])
}

describe.each(IMPLEMENTATIONS)('hypaMemoryV3 summary recency (%s)', (_name, impl) => {
    const settingsFor = (overrides: Partial<HypaV3Settings> = {}) => ({ ...impl, ...overrides })
    const useSettings = (overrides: Partial<HypaV3Settings> = {}) => setSettings(settingsFor({ similarMemoryRatio: 0, ...overrides }))

    describe('stamping', () => {
        const T0 = NOW - 40 * DAY
        const stampedRoom = () => roomWith([summary('A', [0, 1]), summary('B', [2, 3], T0)], [])

        // regression reproducer: base never stamps
        it('I1: summaries added by a call carry the clock time with the option off', async () => {
            useSettings()
            const result = await call(story(12), 120, 60, stampedRoom())
            expect(result.error).toBeUndefined()
            const added = result.memory!.summaries.filter((s) => s.text === 'SUMMARY')
            expect(added.length).toBeGreaterThan(0)
            expect(added.map((s) => s.createdAt)).toEqual(added.map(() => NOW))
            const [first, second] = result.memory!.summaries
            expect(first).not.toHaveProperty('createdAt')
            expect(second.createdAt).toBe(T0)
        })

        // compatibility guard: passes before and after (summaries are spread, unknown fields survive)
        it('I2: the JSON round trip keeps a stored time and leaves an untimed summary untimed', async () => {
            useSettings()
            const first = await call(story(12), 120, 60, stampedRoom())
            const stored = JSON.parse(JSON.stringify(first.memory)) as SerializableHypaV3Data
            const second = await call(story(12), 10, 1000, { hypaV3Data: stored, message: [] } as Chat)
            expect(second.error).toBeUndefined()
            const [a, b] = second.memory!.summaries
            expect(a).not.toHaveProperty('createdAt')
            expect(b.createdAt).toBe(T0)
        })

        // regression reproducer: base never stamps, so there is nothing to keep
        it('I2b: a time stamped by the first call is unchanged after the round trip and a later call', async () => {
            useSettings()
            const first = await call(story(12), 120, 60, stampedRoom())
            const stored = JSON.parse(JSON.stringify(first.memory)) as SerializableHypaV3Data
            vi.spyOn(Date, 'now').mockReturnValue(NOW + DAY)
            const second = await call(story(12), 10, 1000, { hypaV3Data: stored, message: [] } as Chat)
            expect(second.error).toBeUndefined()
            const added = second.memory!.summaries.filter((s) => s.text === 'SUMMARY')
            expect(added.length).toBeGreaterThan(0)
            for (const s of added) expect(s.createdAt).toBe(NOW)
        })
    })

    describe('random memory', () => {
        const AGES = [60 * DAY, 30 * DAY, 0]

        // compatibility guard: passes before and after (the option is off)
        it('I3: with the option off, timed and untimed summaries give the same pick sequence', async () => {
            const timed = await pickSequence(200, AGES, settingsFor())
            const untimed = await pickSequence(200, [undefined, undefined, undefined], settingsFor())
            expect(timed).toEqual(untimed)
        })

        // regression reproducer: base runs as off (uniform)
        it('I4: with the option on, pick frequencies follow 2^-age/half-life', async () => {
            const picks = await pickSequence(6000, AGES, settingsFor({ enableRecencyWeighting: true }))
            expectFrequencies(frequenciesOf(picks, 3), [1 / 7, 2 / 7, 4 / 7])
        })

        // regression reproducer: base runs as off (uniform)
        it('I5: untimed summaries count as older than every timed one, earliest first', async () => {
            const on = settingsFor({ enableRecencyWeighting: true })
            const mixed = await pickSequence(6000, [undefined, 30 * DAY, 0], on)
            expectFrequencies(frequenciesOf(mixed, 3), [1 / 7, 2 / 7, 4 / 7])
            const allUntimed = await pickSequence(6000, [undefined, undefined, undefined], on)
            expectFrequencies(frequenciesOf(allUntimed, 3), [0.2599, 0.3275, 0.4126])
        })

        // regression reproducer: base runs as off (uniform)
        it('I10: the configured half-life is used', async () => {
            const picks = await pickSequence(6000, [60 * DAY, 0], settingsFor({ enableRecencyWeighting: true, recencyHalfLifeDays: 60 }))
            expectFrequencies(frequenciesOf(picks, 2), [1 / 3, 2 / 3])
        })

        // regression reproducer (assertion a); assertion b also holds on base where both runs are off
        it('I11: a half-life of 0 behaves exactly like the default', async () => {
            const zero = await pickSequence(6000, AGES, settingsFor({ enableRecencyWeighting: true, recencyHalfLifeDays: 0 }))
            expectFrequencies(frequenciesOf(zero, 3), [1 / 7, 2 / 7, 4 / 7])
            const standard = await pickSequence(6000, AGES, settingsFor({ enableRecencyWeighting: true }))
            expect(zero).toEqual(standard)
        })
    })

    describe('similar and recent memory', () => {
        // One summary fits: 25 reserved - 10 for the empty wrapper = 15, and a summary costs 10.
        const similarOnly = (overrides: Partial<HypaV3Settings> = {}) =>
            setSettings(settingsFor({ recentMemoryRatio: 0, similarMemoryRatio: 1, ...overrides }))
        const similarCall = (summaries: ReturnType<typeof summary>[]) =>
            call(story(4), 10, 100, roomWith(summaries.map((s, i) => ({ ...s, chatMemos: [`m${i}`] }))))
        const OLD_NEW = () => [summary('OLD@0.9', [0], NOW - 30 * DAY), summary('NEW@0.8', [1], NOW)]

        beforeEach(() => {
            state.settings = createHypaV3Preset('p').settings
        })

        // compatibility guard: passes before and after (the option is off)
        it('I6: with the option off the most similar summary wins', async () => {
            similarOnly()
            const result = await similarCall(OLD_NEW())
            expect(result.error).toBeUndefined()
            expect(selectedTexts(result)).toEqual(['OLD@0.9'])
            expect(result.memory!.metrics!.lastSimilarSummaries).toEqual([0])
        })

        // regression reproducer: base runs as off and selects OLD@0.9
        it('I7: with the option on, a much older summary yields to a slightly less similar newer one', async () => {
            similarOnly({ enableRecencyWeighting: true })
            const result = await similarCall(OLD_NEW())
            expect(result.error).toBeUndefined()
            expect(selectedTexts(result)).toEqual(['NEW@0.8'])

            const untimedFirst = await similarCall([summary('UNT@0.9', [0]), summary('T@0.8', [1], NOW - DAY)])
            expect(selectedTexts(untimedFirst)).toEqual(['T@0.8'])
        })

        // compatibility guard: passes before and after (recent selection is positional)
        it('I8: the recent bucket is unchanged by the option', async () => {
            setSettings(settingsFor({ recentMemoryRatio: 1, similarMemoryRatio: 0, enableRecencyWeighting: true }))
            const room = roomWith([summary('S0', [0], NOW), summary('S1', [1], NOW - 90 * DAY)])
            const result = await call(story(4), 10, 100, room)
            expect(result.error).toBeUndefined()
            expect([...result.chats[0].content.matchAll(/S\d/g)].map((match) => match[0])).toEqual(['S1'])
        })

        // compatibility guard: passes before and after (equal weights keep the similarity order)
        it('I9: equal times keep the similarity order', async () => {
            similarOnly({ enableRecencyWeighting: true })
            const result = await similarCall([summary('OLD@0.9', [0], NOW), summary('NEW@0.8', [1], NOW)])
            expect(result.error).toBeUndefined()
            expect(selectedTexts(result)).toEqual(['OLD@0.9'])
        })
    })
})
