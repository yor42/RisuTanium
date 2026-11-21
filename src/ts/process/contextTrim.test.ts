import { describe, test, expect } from 'vitest'
import type { OpenAIChat } from './index.svelte'
import { LAZY_BEFORE_LIMIT, LAZY_COUNT_LIMIT, LAZY_ENTRY_LIMIT, restateForKept, totalInSendOrder, trimChatsToContext } from './contextTrim'

/**
 * `trimChatsToContext` against a copy of the send's eager trim: the message
 * chats' counts added in order after `tokensBeforeMessages`, then the counts
 * after the messages, then the loop that drops the oldest chat while the total
 * is over the limit, failing when at most one chat is left. The lazy trim must
 * drop the same chats and fail with the same total, counting each chat at
 * most once, and count only the kept message chats and at most one more.
 *
 * Tests whose title starts with `guard:` hold for the eager trim too: it is
 * today's behaviour. The `precondition:` test shows what the caller must
 * guarantee.
 */

interface Case {
    chats: OpenAIChat[]
    counts: Map<OpenAIChat, number>
    firstMessageChat: number
    tokensBeforeMessages: number
    tokensAfterMessages: number[]
    maxContextTokens: number
    // Message chats the send counted in its loop.
    countedMessages: Map<OpenAIChat, number>
}

function eagerTrim(c: Case) {
    const chats = c.chats.slice()
    let currentTokens = c.tokensBeforeMessages
    for(let i = c.firstMessageChat; i < chats.length; i++){
        currentTokens += c.counts.get(chats[i])!
    }
    for(const tokens of c.tokensAfterMessages){
        currentTokens += tokens
    }
    while(currentTokens > c.maxContextTokens){
        if(chats.length <= 1){
            return { fits: false, currentTokens, kept: chats }
        }
        currentTokens -= c.counts.get(chats[0])!
        chats.splice(0, 1)
    }
    return { fits: true, currentTokens, kept: chats }
}

async function lazyTrim(c: Case) {
    const chats = c.chats.slice()
    const calls = new Map<OpenAIChat, number>()
    const result = await trimChatsToContext({
        chats,
        firstMessageChat: c.firstMessageChat,
        tokensBeforeMessages: c.tokensBeforeMessages,
        tokensAfterMessages: c.tokensAfterMessages,
        countedMessages: c.countedMessages,
        maxContextTokens: c.maxContextTokens,
        count: async (chat) => {
            calls.set(chat, (calls.get(chat) ?? 0) + 1)
            return c.counts.get(chat)!
        },
    })
    return { ...result, kept: chats, calls }
}

function makeCase(prefixCounts: number[], messageCounts: number[], tokensBeforeMessages: number, tokensAfterMessages: number[], maxContextTokens: number): Case {
    const chats: OpenAIChat[] = []
    const counts = new Map<OpenAIChat, number>()
    for(const [i, tokens] of [...prefixCounts, ...messageCounts].entries()){
        const chat: OpenAIChat = { role: 'user', content: `chat ${i}` }
        chats.push(chat)
        counts.set(chat, tokens)
    }
    return { chats, counts, firstMessageChat: prefixCounts.length, tokensBeforeMessages, tokensAfterMessages, maxContextTokens, countedMessages: new Map() }
}

async function expectSameAsEager(c: Case) {
    const eager = eagerTrim(c)
    const lazy = await lazyTrim(c)
    expect(lazy.fits).toBe(eager.fits)
    expect(Object.is(lazy.currentTokens, eager.currentTokens)).toBe(true)
    if(eager.fits){
        expect(lazy.kept).toEqual(eager.kept)
        lazy.kept.forEach((chat, i) => expect(chat).toBe(eager.kept[i]))
    }
    for(const times of lazy.calls.values()){
        expect(times).toBe(1)
    }
    return { eager, lazy }
}

// A small deterministic generator, so a failure names a reproducible seed.
function random(seed: number) {
    let state = seed
    return (below: number) => {
        state = (state * 1103515245 + 12345) % 2147483648
        return Math.floor(state / 2147483648 * below)
    }
}

describe('guard: the lazy context trim keeps what the eager trim keeps', () => {
    test('generated cases: prefix chats (some never added to the total), message chats, counts before and after', async () => {
        for(let seed = 1; seed <= 3000; seed++){
            const next = random(seed)
            const prefix = Array.from({ length: next(4) }, () => next(40))
            const messages = Array.from({ length: next(60) }, () => next(50))
            const after = Array.from({ length: next(3) }, () => next(30))
            // The send adds most prefix counts before the loop; `[Start a new chat]` is pushed but not added.
            const addedPrefix = prefix.reduce((sum, tokens, i) => sum + (i === 0 && next(2) === 0 ? 0 : tokens), 0)
            const before = next(200) + addedPrefix
            const max = next(1500)
            const c = makeCase(prefix, messages, before, after, max)
            const { lazy } = await expectSameAsEager(c)
            // Only the kept message chats, at most one more, and the dropped prefix chats are counted.
            const keptMessages = lazy.kept.filter((chat) => c.chats.indexOf(chat) >= c.firstMessageChat).length
            const countedMessages = [...lazy.calls.keys()].filter((chat) => c.chats.indexOf(chat) >= c.firstMessageChat).length
            expect(countedMessages).toBeLessThanOrEqual(keptMessages + 1)
        }
    })

    test('a long chat with a small context counts the kept window, not the chat', async () => {
        const c = makeCase([5, 7], Array.from({ length: 3000 }, () => 120), 400, [30], 3000)
        const { eager, lazy } = await expectSameAsEager(c)
        expect(eager.kept.length).toBe(21)
        expect(lazy.calls.size).toBeLessThanOrEqual(2 + 21 + 1)
    })

    test('the exact boundary keeps the chat that fills the context', async () => {
        const c = makeCase([10], [20, 30, 40], 10, [], 10 + 30 + 40)
        const { eager } = await expectSameAsEager(c)
        expect(eager.kept.map((chat) => chat.content)).toEqual(['chat 2', 'chat 3'])
        await expectSameAsEager(makeCase([10], [20, 30, 40], 10, [], 10 + 30 + 40 - 1))
    })

    test('nothing to trim: no chats, a total under the limit, and a total that fits exactly', async () => {
        const empty = makeCase([], [], 50, [], 100)
        const { lazy } = await expectSameAsEager(empty)
        expect(lazy.fits).toBe(true)
        expect(lazy.kept).toEqual([])
        await expectSameAsEager(makeCase([3], [4, 5], 3, [2], 14))
        await expectSameAsEager(makeCase([3], [4, 5], 3, [2], 13))
    })

    test('the failure when at most one chat is left reports the total the eager trim reports', async () => {
        await expectSameAsEager(makeCase([], [], 500, [], 100))
        await expectSameAsEager(makeCase([], [900], 50, [], 100))
        await expectSameAsEager(makeCase([20], [], 50, [], 30))
        await expectSameAsEager(makeCase([20, 0], [300, 900], 70, [5], 100))
    })

    test('limits that are not plain numbers decide as in the eager trim', async () => {
        for(const limit of [NaN, undefined, 'abc', '1200', null, Infinity, -Infinity, -5, 12.5] as unknown as number[]){
            await expectSameAsEager(makeCase([4, 0], [10, 20, 30], 4, [3], limit))
            await expectSameAsEager(makeCase([], [5000], 4, [], limit))
        }
        const c = makeCase([4], [10, 20, 30], 4, [], NaN)
        expect((await lazyTrim(c)).kept.length).toBe(4)
    })

    test('totals near 2^53 take the eager trim, whose own sums are inexact there', async () => {
        // The eager total also adds the old messages the walk never counts,
        // so the walk's exact sums would decide differently.
        const big = 2 ** 53 - 100
        await expectSameAsEager(makeCase([], [1000, 1, 1], big, [], big))
        await expectSameAsEager(makeCase([], [1000, 1, 1, 1], big, [], big + 2))
        await expectSameAsEager(makeCase([3], [30, 5], Number.MAX_SAFE_INTEGER - 20, [], Number.MAX_SAFE_INTEGER - 10))
        await expectSameAsEager(makeCase([], [7], big, [], 10))
        await expectSameAsEager(makeCase([], [7], 2 ** 60, [], 10))
        await expectSameAsEager(makeCase([], [1000, 1, 1], -big, [], 0))
        await expectSameAsEager(makeCase([], [1000, 1, 1], 10, [big], big))
        // Counts after the messages of either sign that cancel in the end.
        const half = 2 ** 51
        await expectSameAsEager(makeCase([], [1], 0, [half, half, half, half, -half, -half, -half, -half], 0))
        await expectSameAsEager(makeCase([], [1], half, [half, half, half, -half, -half, -half], half))
        for(const limit of [2 ** 53, 2 ** 53 + 2, 2 ** 53 + 4, 2 ** 53 + 12, 2 ** 53 + 14, 2 ** 53 + 1012, 2 ** 53 + 1014]){
            for(const before of [11, 13, 1013]){
                await expectSameAsEager(makeCase([], [1000, 1, 1], before, [half, half, half, half], limit))
                await expectSameAsEager(makeCase([], [1000, 1, 1, 1], before, [half, half, half, half], limit))
            }
        }
    })

    test('a multimodal count taken in the loop beyond the bound takes the eager trim', async () => {
        // A stored inlay of width 1e18 and height 100 counts 3906250000000088.
        const huge = 3906250000000088
        for(let limit = 5300; limit <= 5420; limit += 2){
            const c = makeCase([], [huge, 9, huge, 7, huge, 11, 13], 5353, [17], limit)
            for(const i of [0, 2, 4]){
                c.counts.set(c.chats[i], huge)
                c.countedMessages.set(c.chats[i], huge)
            }
            await expectSameAsEager(c)
        }
    })

    test('a prefix count beyond the bound takes the eager trim', async () => {
        for(const limit of [-(2 ** 54), -(2 ** 53) - 2, 0, 2 ** 53]){
            await expectSameAsEager(makeCase([2 ** 53 - 1, 3], [5, 7], 2 ** 53 + 2, [], limit))
            await expectSameAsEager(makeCase([LAZY_COUNT_LIMIT + 1], [5, 7], 9, [], 3))
        }
    })

    test('the bounds keep every sum the walk forms below 2^53', () => {
        expect(LAZY_BEFORE_LIMIT + LAZY_ENTRY_LIMIT * LAZY_COUNT_LIMIT).toBeLessThan(2 ** 53)
    })

    test('within the bounds the walk is lazy; one past any bound and it is eager', async () => {
        const lazyCalls = async (c: Case) => (await expectSameAsEager(c)).lazy.calls.size
        const messages = () => Array.from({ length: 200 }, () => 10)
        expect(await lazyCalls(makeCase([], messages(), LAZY_BEFORE_LIMIT - 100, [], LAZY_BEFORE_LIMIT - 50))).toBeLessThanOrEqual(6)
        expect(await lazyCalls(makeCase([], messages(), -LAZY_BEFORE_LIMIT, [], -LAZY_BEFORE_LIMIT + 50))).toBeLessThanOrEqual(6)
        expect(await lazyCalls(makeCase([], messages(), LAZY_BEFORE_LIMIT + 2, [], LAZY_BEFORE_LIMIT + 52))).toBe(200)
        expect(await lazyCalls(makeCase([], messages(), -LAZY_BEFORE_LIMIT - 2, [], -LAZY_BEFORE_LIMIT + 50))).toBe(200)
        expect(await lazyCalls(makeCase([], messages(), 0, [LAZY_COUNT_LIMIT], LAZY_COUNT_LIMIT + 50))).toBeLessThanOrEqual(6)
        expect(await lazyCalls(makeCase([], messages(), 0, [LAZY_COUNT_LIMIT + 1], LAZY_COUNT_LIMIT + 51))).toBe(200)
        expect(await lazyCalls(makeCase([], messages(), 0, [-1], 50))).toBe(200)
        const entries = makeCase([], messages(), 0, Array.from({ length: LAZY_ENTRY_LIMIT - 200 - 1 }, () => 0), 50)
        expect(await lazyCalls(entries)).toBeLessThanOrEqual(6)
        entries.tokensAfterMessages.push(0)
        expect(await lazyCalls(entries)).toBe(200)
    })

    test('a fractional total before the messages, a count past 2^53 in the last chat left and a prefix count past 2^53 take the eager trim', async () => {
        // Each rounds differently when added in another order.
        await expectSameAsEager(makeCase([], [2, 7, 9], 0.1, [], 10))
        await expectSameAsEager(makeCase([], [1, 2], 0.1, [1], 0))
        await expectSameAsEager(makeCase([], [2 ** 53], 1, [2], 0))
        await expectSameAsEager(makeCase([2 ** 53 + 2], [1, 1], 1, [], 0))
        await expectSameAsEager(makeCase([2 ** 53 + 2], [1, 1], 1, [], -(2 ** 54)))
    })

    test('zero counts', async () => {
        await expectSameAsEager(makeCase([0, 0], [0, 0, 0, 10], 0, [0], 5))
        await expectSameAsEager(makeCase([0], [0, 0, 0], 10, [], 5))
    })

    test('a count the send took in its loop that is not a non-negative integer takes the eager trim: NaN keeps every chat', async () => {
        for(const odd of [NaN, -3, 2.5, Infinity]){
            const c = makeCase([4], [10, odd, 10, 10], 4, [], 15)
            c.countedMessages.set(c.chats[2], odd)
            const { eager, lazy } = await expectSameAsEager(c)
            if(Number.isNaN(odd)){
                expect(lazy.kept.length).toBe(5)
            }
            // The chat counted in the loop is not counted again.
            expect(lazy.calls.has(c.chats[2])).toBe(false)
            expect(eager.kept.length).toBe(lazy.kept.length)
        }
    })

    test('a count the walk takes that is not a non-negative integer within the bound takes the eager trim', async () => {
        await expectSameAsEager(makeCase([23], [18, 13.1, 9, 25], 27, [], 49))
        for(const odd of [NaN, -3, 2.5, 13.1, LAZY_COUNT_LIMIT + 1, 2 ** 53]){
            await expectSameAsEager(makeCase([4], [10, 10, odd, 10], 4, [], 15))
            await expectSameAsEager(makeCase([4], [10, 10, 10, odd], 4, [], 15))
        }
    })

    test('precondition: a message the walk never counts is assumed to have a non-negative integer count', async () => {
        // The eager trim keeps every chat once any count is NaN; the lazy walk
        // never sees the dropped NaN and keeps the window. The send counts any
        // chat whose count could be NaN in its loop instead.
        const c = makeCase([4], [10, NaN, 10, 10], 4, [], 15)
        expect(eagerTrim(c).kept.length).toBe(5)
        expect((await lazyTrim(c)).kept.length).toBe(1)
    })

    test('fractional totals round as the eager sum does', async () => {
        // 13.1 + 50 + ... is not exact in binary; the error text shows the eager sum's rounding.
        const c = makeCase([], [7], 63.1, [], 10)
        const { eager, lazy } = await expectSameAsEager(c)
        expect(eager.fits).toBe(false)
        expect(`${lazy.currentTokens}`).toBe(`${eager.currentTokens}`)
        await expectSameAsEager(makeCase([3], [7, 9, 11], 13.1 + 50 + 3, [2.2], 30))
    })
})

describe('guard: the total in send order', () => {
    test('adds the message counts in order, then the counts after the messages', async () => {
        const c = makeCase([1, 2], [0.1, 0.2, 0.3], 13.1, [0.7], 0)
        const total = await totalInSendOrder({
            chats: c.chats,
            firstMessageChat: c.firstMessageChat,
            tokensBeforeMessages: c.tokensBeforeMessages,
            tokensAfterMessages: c.tokensAfterMessages,
            countedMessages: new Map([[c.chats[3], 0.2]]),
            count: async (chat) => c.counts.get(chat)!,
        })
        expect(Object.is(total, 13.1 + 0.1 + 0.2 + 0.3 + 0.7)).toBe(true)
    })
})
describe('keepAtLeast, dropped, counts and restateForKept', () => {
    // A fractional `tokensBeforeMessages` forces the eager form; an integer one takes the lazy walk.
    const forms: Array<[string, number]> = [['lazy', 0], ['eager', 0.5]]

    async function run(c: Case, extra: number, keepAtLeast?: number) {
        const chats = c.chats.slice()
        const result = await trimChatsToContext({
            chats,
            firstMessageChat: c.firstMessageChat,
            tokensBeforeMessages: c.tokensBeforeMessages + extra,
            tokensAfterMessages: c.tokensAfterMessages,
            countedMessages: c.countedMessages,
            maxContextTokens: c.maxContextTokens,
            count: async (chat) => c.counts.get(chat)!,
            ...(keepAtLeast === undefined ? {} : { keepAtLeast }),
        })
        return { ...result, kept: chats }
    }

    test('CT1 regression reproducer: a total that needs dropping past keepAtLeast fails before any splice', async () => {
        for(const [form, extra] of forms){
            const c = makeCase([], [10, 10, 10, 10, 10], 0, [], 25)
            // Three chats must go to fit 25; keeping 4 forbids it.
            const out = await run(c, extra, 4)
            expect(out.fits, form).toBe(false)
            expect(out.dropped, form).toEqual([])
            expect(out.kept, form).toEqual(c.chats)
            const ok = await run(c, extra, 2)
            expect(ok.fits, form).toBe(true)
            expect(ok.kept.length, form).toBe(2)
        }
    })

    test('CT2 guard: the default keepAtLeast is 1, and dropped is the removed prefix with every counted chat in counts', async () => {
        for(let seed = 1; seed <= 500; seed++){
            const next = random(seed)
            const prefix = Array.from({ length: next(3) }, () => next(40))
            const messages = Array.from({ length: next(30) }, () => next(50))
            const before = next(100) + prefix.reduce((a, b) => a + b, 0)
            const c = makeCase(prefix, messages, before, [next(20)], next(900))
            for(const [form, extra] of forms){
                const implicit = await run(c, extra)
                const explicit = await run(c, extra, 1)
                expect(implicit.fits, form).toBe(explicit.fits)
                expect(implicit.kept, form).toEqual(explicit.kept)
                expect(Object.is(implicit.currentTokens, explicit.currentTokens), form).toBe(true)
                expect(implicit.dropped, form).toEqual(c.chats.slice(0, c.chats.length - implicit.kept.length))
                if(implicit.fits){
                    for(const chat of implicit.dropped.filter((_, i) => i < c.firstMessageChat)){
                        expect(implicit.counts.get(chat), form).toBe(c.counts.get(chat))
                    }
                    for(const chat of implicit.kept.filter((chat) => implicit.counts.has(chat))){
                        expect(implicit.counts.get(chat), form).toBe(c.counts.get(chat))
                    }
                }
                else{
                    expect(implicit.dropped, form).toEqual([])
                }
            }
        }
    })

    test('CT3 composition: trim to L1, restate, trim to L2 <= L1 equals one trim to L2', async () => {
        for(let seed = 1; seed <= 800; seed++){
            const next = random(seed)
            const prefix = Array.from({ length: next(4) }, () => 1 + next(40))
            const messages = Array.from({ length: 1 + next(40) }, () => 1 + next(50))
            const before = next(100) + prefix.reduce((a, b) => a + b, 0)
            const after = [next(20)]
            const total = before + messages.reduce((a, b) => a + b, 0) + after[0]
            const l2 = next(total + 1)
            const l1 = l2 + next(total - l2 + 1)
            for(const [form, extra] of forms){
                const c = makeCase(prefix, messages, before, after, l1)
                const first = await run(c, extra)
                if(!first.fits) continue
                const restated = restateForKept({ firstMessageChat: c.firstMessageChat, tokensBeforeMessages: c.tokensBeforeMessages + extra, dropped: first.dropped, counts: first.counts })
                const rest = first.kept
                const second = await trimChatsToContext({
                    chats: rest,
                    firstMessageChat: restated.firstMessageChat,
                    tokensBeforeMessages: restated.tokensBeforeMessages,
                    tokensAfterMessages: after,
                    countedMessages: new Map([...first.counts].filter(([chat]) => rest.includes(chat))),
                    maxContextTokens: l2,
                    count: async (chat) => c.counts.get(chat)!,
                })
                const single = await run({ ...c, maxContextTokens: l2 }, extra)
                expect(second.fits, `${form} seed ${seed}`).toBe(single.fits)
                if(single.fits){
                    expect(rest, `${form} seed ${seed}`).toEqual(single.kept)
                    expect(Object.is(second.currentTokens, single.currentTokens), `${form} seed ${seed}`).toBe(true)
                }
            }
        }
    })

    test('restateForKept: the message index shifts by the dropped count and only dropped prefix chats leave tokensBeforeMessages', () => {
        const chats: OpenAIChat[] = [0, 1, 2, 3, 4].map((i) => ({ role: 'user', content: `c${i}` }))
        const counts = new Map(chats.map((chat, i) => [chat, 10 * (i + 1)] as [OpenAIChat, number]))
        expect(restateForKept({ firstMessageChat: 2, tokensBeforeMessages: 100, dropped: chats.slice(0, 1), counts })).toEqual({ firstMessageChat: 1, tokensBeforeMessages: 90 })
        expect(restateForKept({ firstMessageChat: 2, tokensBeforeMessages: 100, dropped: chats.slice(0, 4), counts })).toEqual({ firstMessageChat: 0, tokensBeforeMessages: 70 })
        expect(restateForKept({ firstMessageChat: 2, tokensBeforeMessages: 100, dropped: [], counts })).toEqual({ firstMessageChat: 2, tokensBeforeMessages: 100 })
    })
})
