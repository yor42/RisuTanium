import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { OpenAIChat } from '../../../index.svelte'
import { HEADER } from '../pack'
import { createSendCapture, recordOf, type CapturedMessage, type MessageRecord, type SendCapture } from '../records'
import {
    LINE_CACHE_MAX,
    getLastChroMemoryTrace,
    resetChroMemoryShadowForTests,
    runChroMemoryShadow,
    runChroMemorySafely,
    shadowLineCacheSizeForTests,
    type ShadowDeps,
    type ShadowInput,
} from '../shadow'

const len = (s: string): number => Math.ceil(s.length / 4)

function deps(over: Partial<ShadowDeps> = {}) {
    const countText = vi.fn(async (t: string) => len(t))
    const countBlock = vi.fn(async (b: string) => len(b) + 3)
    let t = 1000
    const d: ShadowDeps = { countText, countBlock, now: () => (t += 5), ...over }
    return { d, countText, countBlock }
}

interface World {
    chats: OpenAIChat[]
    refs: CapturedMessage[]
    capture: SendCapture
}

function world(texts: string[]): World {
    const chats: OpenAIChat[] = texts.map((t, i) => ({ role: i % 2 ? 'assistant' : 'user', content: t }))
    const refs: CapturedMessage[] = texts.map((t, i) => ({ msg: { chatId: `c${i}`, role: i % 2 ? 'char' : 'user', data: t }, chatIndex: i, name: 'Bot', preWrap: t, data: t }))
    const capture = createSendCapture()
    chats.forEach((c, i) => capture.add(c, refs[i]))
    return { chats, refs, capture }
}

function inputOf(w: World, droppedCount: number, over: Partial<ShadowInput> = {}): ShadowInput {
    return {
        chatKey: 'owner:chat',
        before: w.chats,
        kept: w.chats.slice(droppedCount),
        recordOf: (chat) => {
            const i = w.chats.indexOf(chat)
            return i < 0 ? null : recordOf(w.refs[i], 'User')
        },
        queryRecord: () => recordOf(w.refs[w.refs.length - 1], 'User'),
        budgetTokens: 400,
        countVaries: false,
        tokenizerKey: 'tk',
        ...over,
    }
}

const TEXTS = ['zebra stripes everywhere', 'omega apple pie', 'comet orbit sky', 'river bank mud', 'tulip garden bloom', 'Tell me about the zebra']

beforeEach(() => resetChroMemoryShadowForTests())

describe('runChroMemoryShadow outcomes', () => {
    test('new rule: packed, with chronological items and a recorded trace', async () => {
        const w = world(TEXTS)
        const { d } = deps()
        const trace = await runChroMemoryShadow(inputOf(w, 5), d)
        expect(trace.outcome).toBe('packed')
        expect(trace.d0).toEqual({ records: 5, units: 5, firstChatId: 'c0', lastChatId: 'c4' })
        expect(trace.query).toEqual({ chatId: 'c5', terms: ['zebra'] })
        expect(trace.items[0]).toMatchObject({ source: { kind: 'turn', chatId: 'c0', index: 0, off: 0 }, rank: { lexical: 1, dense: null, fused: null } })
        expect(trace.rebuildCause).toBe('fresh')
        expect(trace.T).toBeLessThanOrEqual(400)
        expect(getLastChroMemoryTrace()).toBe(trace)
    })

    test('new rule: empty-d0 does nothing, calls no record function and never counts', async () => {
        const w = world(TEXTS)
        const { d, countText, countBlock } = deps()
        const recordSpy = vi.fn(() => null)
        const querySpy = vi.fn(() => null)
        const trace = await runChroMemoryShadow(inputOf(w, 0, { recordOf: recordSpy, queryRecord: querySpy }), d)
        expect(trace.outcome).toBe('empty-d0')
        expect(recordSpy).not.toHaveBeenCalled()
        expect(querySpy).not.toHaveBeenCalled()
        expect(countText).not.toHaveBeenCalled()
        expect(countBlock).not.toHaveBeenCalled()
    })

    test('new rule: records are made only for D0 chats, and the query record once', async () => {
        const w = world(Array.from({ length: 30 }, (_, i) => `message number ${i} word${i}`))
        const { d } = deps()
        const recordSpy = vi.fn((chat: OpenAIChat) => recordOf(w.refs[w.chats.indexOf(chat)], 'User'))
        const querySpy = vi.fn(() => recordOf(w.refs[29], 'User'))
        await runChroMemoryShadow(inputOf(w, 10, { recordOf: recordSpy, queryRecord: querySpy }), d)
        expect(recordSpy).toHaveBeenCalledTimes(10)
        expect(querySpy).toHaveBeenCalledTimes(1)
    })

    test('new rule: no-query when there is no query record or its text is empty', async () => {
        const w = world(TEXTS)
        const { d } = deps()
        expect((await runChroMemoryShadow(inputOf(w, 5, { queryRecord: () => null }), d)).outcome).toBe('no-query')
        const empty: MessageRecord = { ...recordOf(w.refs[5], 'User'), preWrap: '<Thoughts>only thoughts</Thoughts>' }
        expect((await runChroMemoryShadow(inputOf(w, 5, { queryRecord: () => empty }), d)).outcome).toBe('no-query')
    })

    test('new rule: nothing-packed when no line fits the budget', async () => {
        const w = world(TEXTS)
        const { d } = deps()
        const trace = await runChroMemoryShadow(inputOf(w, 5, { budgetTokens: 3 }), d)
        expect(trace.outcome).toBe('nothing-packed')
        expect(trace.items).toEqual([])
        expect(trace.T).toBe(0)
    })

    test('new rule: a dynamic-CBS rewrite uses the fresh text in the line and keeps the indexed text for ranking', async () => {
        const w = world(TEXTS)
        const { d } = deps()
        await runChroMemoryShadow(inputOf(w, 5), d)
        const countText = vi.fn(async (t: string) => len(t))
        const rewritten = w.refs.map((r, i) => (i === 0 ? { ...r, preWrap: 'rewritten by cbs' } : r))
        const trace = await runChroMemoryShadow(
            inputOf(w, 5, { recordOf: (chat) => recordOf(rewritten[w.chats.indexOf(chat)], 'User') }),
            deps({ countText }).d,
        )
        expect(trace.index).toMatchObject({ churn: 0, removed: 0 })
        expect(trace.query?.terms).toEqual(['zebra'])
        expect(countText.mock.calls.map((c) => c[0]).some((t) => t.includes('rewritten by cbs'))).toBe(true)
    })
})

describe('runChroMemoryShadow errors never reject and never mutate', () => {
    const cases: Array<[string, (w: World) => { input: Partial<ShadowInput>, deps?: Partial<ShadowDeps> }]> = [
        ['countText throws', () => ({ input: {}, deps: { countText: async () => { throw new Error('count boom') } } })],
        ['countBlock throws', () => ({ input: {}, deps: { countBlock: async () => { throw new Error('block boom') } } })],
        ['recordOf throws', () => ({ input: { recordOf: () => { throw new Error('record boom') } } })],
    ]
    for (const [name, make] of cases) {
        test(`new rule: ${name} gives an error trace and leaves the inputs untouched`, async () => {
            const w = world(TEXTS)
            const input = inputOf(w, 5, make(w).input)
            const beforeClone = structuredClone(w.chats)
            const refsClone = structuredClone(w.refs)
            const beforeRef = [...input.before]
            const keptRef = [...input.kept]
            const trace = await runChroMemoryShadow(input, deps(make(w).deps).d)
            expect(trace.outcome).toBe('error')
            expect(trace.error).toMatch(/boom/)
            expect(getLastChroMemoryTrace()).toBe(trace)
            expect(input.before).toEqual(beforeClone)
            expect(w.refs).toEqual(refsClone)
            input.before.forEach((c, i) => expect(c).toBe(beforeRef[i]))
            input.kept.forEach((c, i) => expect(c).toBe(keptRef[i]))
        })
    }

    test('new rule: a kept set that is not a suffix of before gives an error trace', async () => {
        const w = world(TEXTS)
        const trace = await runChroMemoryShadow(inputOf(w, 3, { kept: [w.chats[3], w.chats[5]] }), deps().d)
        expect(trace.outcome).toBe('error')
        expect(trace.error).toBe('kept set is not a suffix')
    })

    test('new rule: an error message is cut at 200 characters', async () => {
        const w = world(TEXTS)
        const long = 'x'.repeat(500)
        const trace = await runChroMemoryShadow(inputOf(w, 5), deps({ countText: async () => { throw new Error(long) } }).d)
        expect(trace.error).toHaveLength(200)
    })
})

describe('runChroMemoryShadow count caps', () => {
    const cold = (n: number) => world(Array.from({ length: n }, (_, i) => `unit${i} ` + 'filler '.repeat(60)).concat('unit0 query'))

    test('new rule: a cold D0 of 2,500 units makes at most 64 counter calls on a deterministic counter', async () => {
        const w = cold(2500)
        const { d, countText, countBlock } = deps()
        const trace = await runChroMemoryShadow(inputOf(w, 2500, { budgetTokens: 40 }), d)
        expect(trace.d0.units).toBe(2500)
        expect(trace.outcome).toBe('nothing-packed')
        expect(trace.countCapped).toBe(true)
        expect(trace.slots).toBeLessThanOrEqual(64)
        expect(countText.mock.calls.length + countBlock.mock.calls.length).toBeLessThanOrEqual(64)
        expect(trace.countCap).toBe(64)
    })

    test('new rule: a varying counter makes at most 12 counter calls and no cache is kept', async () => {
        const w = cold(300)
        const { d, countText, countBlock } = deps()
        const trace = await runChroMemoryShadow(inputOf(w, 300, { budgetTokens: 40, countVaries: true }), d)
        expect(trace.countCap).toBe(12)
        expect(trace.counted).toBeLessThanOrEqual(12)
        expect(countText.mock.calls.length + countBlock.mock.calls.length).toBeLessThanOrEqual(12)
        expect(shadowLineCacheSizeForTests()).toBe(0)
    })

    test('new rule: the line cache is dropped with its slot and cleared when the tokenizer changes', async () => {
        const w = cold(80)
        await runChroMemoryShadow(inputOf(w, 80, { budgetTokens: 40, chatKey: 'a:1' }), deps().d)
        expect(shadowLineCacheSizeForTests()).toBeGreaterThan(0)
        const b = deps()
        const traceB = await runChroMemoryShadow(inputOf(w, 80, { budgetTokens: 40, chatKey: 'b:1' }), b.d)
        // Chat switch: the new slot starts empty, so every visited line (and the header) was counted once.
        expect(b.countText.mock.calls.length).toBe(shadowLineCacheSizeForTests())
        expect(traceB.rebuildCause).toBe('chat-switch')

        const again = deps()
        await runChroMemoryShadow(inputOf(w, 80, { budgetTokens: 40, chatKey: 'b:1' }), again.d)
        expect(again.countText).not.toHaveBeenCalled()

        const other = deps({ countText: vi.fn(async (t: string) => len(t) + 7) })
        const changed = await runChroMemoryShadow(inputOf(w, 80, { budgetTokens: 40, chatKey: 'b:1', tokenizerKey: 'tk2' }), other.d)
        expect(other.d.countText).toHaveBeenCalledTimes(b.countText.mock.calls.length)
        expect(changed.slots).toBeGreaterThan(0)
    })

    test('new rule: the line cache never exceeds 512 entries after any run', async () => {
        const w = cold(200)
        for (let run = 0; run < 20; run++) {
            // Dynamic text changes every visited line on each run, so each run adds new cache entries.
            const rewritten = w.refs.map((r) => ({ ...r, preWrap: r.preWrap + ` run${run}` }))
            await runChroMemoryShadow(
                inputOf(w, 200, { budgetTokens: 40, recordOf: (chat) => (w.chats.indexOf(chat) < 0 ? null : recordOf(rewritten[w.chats.indexOf(chat)], 'User')) }),
                deps().d,
            )
            expect(shadowLineCacheSizeForTests()).toBeLessThanOrEqual(LINE_CACHE_MAX)
        }
    })
})

describe('runChroMemoryShadow overlap', () => {
    function deferred() {
        let resolve!: (n: number) => void
        const promise = new Promise<number>((r) => { resolve = r })
        return { promise, resolve }
    }
    const strip = (t: Awaited<ReturnType<typeof runChroMemoryShadow>>) => ({ outcome: t.outcome, d0: t.d0, query: t.query, items: t.items, T: t.T, slots: t.slots, countCapped: t.countCapped })

    test('new rule: overlapping calls on different chatKeys each equal their solo run, and the later finisher is last', async () => {
        const wA = world(TEXTS)
        const wB = world(TEXTS.map((t) => t + ' extra'))
        const solo = async (w: World, key: string) => strip(await runChroMemoryShadow(inputOf(w, 5, { chatKey: key }), deps().d))
        const soloA = await solo(wA, 'a:1')
        resetChroMemoryShadowForTests()
        const soloB = await solo(wB, 'b:1')
        resetChroMemoryShadowForTests()

        const gateA = deferred()
        const gateB = deferred()
        const dA = deps({ countBlock: (b) => (b === HEADER ? gateA.promise : Promise.resolve(len(b) + 3)) })
        const dB = deps({ countBlock: (b) => (b === HEADER ? gateB.promise : Promise.resolve(len(b) + 3)) })
        const pA = runChroMemoryShadow(inputOf(wA, 5, { chatKey: 'a:1' }), dA.d)
        const pB = runChroMemoryShadow(inputOf(wB, 5, { chatKey: 'b:1' }), dB.d)
        gateB.resolve(len(HEADER) + 3)
        const tB = await pB
        gateA.resolve(len(HEADER) + 3)
        const tA = await pA
        expect(strip(tA)).toEqual(soloA)
        expect(strip(tB)).toEqual(soloB)
        expect(getLastChroMemoryTrace()).toBe(tA)
    })

    test('new rule: overlapping calls on one chatKey keep the first call equal to its solo picks', async () => {
        const w = world(TEXTS)
        const soloT = await runChroMemoryShadow(inputOf(w, 5), deps().d)
        resetChroMemoryShadowForTests()
        const gate = deferred()
        const slow = deps({ countBlock: (b) => (b === HEADER ? gate.promise : Promise.resolve(len(b) + 3)) })
        const first = runChroMemoryShadow(inputOf(w, 5), slow.d)
        const second = await runChroMemoryShadow(inputOf(w, 5), deps().d)
        gate.resolve(len(HEADER) + 3)
        const firstT = await first
        expect(firstT.items).toEqual(soloT.items)
        expect(firstT.outcome).toBe(soloT.outcome)
        expect(second.outcome).toBe(soloT.outcome)
        expect(getLastChroMemoryTrace()).toBe(firstT)
    })
})

describe('runChroMemorySafely', () => {
    function sendArgs(w: World, over: Record<string, unknown> = {}) {
        return {
            capture: w.capture,
            first: null,
            charName: 'Bot',
            userName: () => 'User',
            before: w.chats,
            kept: w.chats.slice(5),
            ownerId: 'owner',
            chatId: 'chat1',
            ltmSettings: undefined as unknown,
            maxContextTokens: 8192,
            countVaries: false,
            tokenizerKey: () => 'tk',
            inject: null,
            ...over,
        }
    }

    test('new rule: resolves with an error trace when userName, a captured data getter or tokenizerKey throws', async () => {
        for (const make of [
            (w: World) => sendArgs(w, { userName: () => { throw new Error('user boom') } }),
            (w: World) => {
                Object.defineProperty(w.refs[1], 'data', { get: () => { throw new Error('data boom') } })
                return sendArgs(w)
            },
            (w: World) => sendArgs(w, { tokenizerKey: () => { throw new Error('key boom') } }),
        ]) {
            resetChroMemoryShadowForTests()
            const w = world(TEXTS)
            const args = make(w)
            const beforeRef = [...args.before]
            await expect(runChroMemorySafely(args, deps().d)).resolves.toBeNull()
            const trace = getLastChroMemoryTrace()
            expect(trace?.outcome).toBe('error')
            expect(trace?.error).toMatch(/boom/)
            args.before.forEach((c, i) => expect(c).toBe(beforeRef[i]))
            expect(args.kept).toHaveLength(1)
        }
    })

    test('new rule: the first message maps to #first, other chats through the capture, strangers have no record', async () => {
        const w = world(TEXTS)
        const firstChat: OpenAIChat = { role: 'assistant', content: 'Bot: Hello!' }
        const example: OpenAIChat = { role: 'assistant', content: 'example' }
        const before = [firstChat, example, ...w.chats]
        await runChroMemorySafely(
            sendArgs(w, {
                before,
                kept: w.chats.slice(5),
                first: { chat: firstChat, preWrap: 'Hello!', raw: 'Hello!' },
                ltmSettings: { budgetTokens: 777 },
            }),
            deps().d,
        )
        const trace = getLastChroMemoryTrace()!
        expect(trace.chatKey).toBe('owner:chat1')
        expect(trace.budgetTokens).toBe(777)
        expect(trace.d0.firstChatId).toBe('#first')
        expect(trace.d0.records).toBe(6)
        expect(trace.d0.lastChatId).toBe('c4')
        expect(trace.query?.chatId).toBe('c5')
    })

    test('new rule: the default budget follows the context size', async () => {
        const w = world(TEXTS)
        await runChroMemorySafely(sendArgs(w, { maxContextTokens: 8192 }), deps().d)
        expect(getLastChroMemoryTrace()?.budgetTokens).toBe(1228)
    })
})
