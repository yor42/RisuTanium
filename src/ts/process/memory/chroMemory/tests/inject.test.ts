import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get } from 'svelte/store'
import { trimChatsToContext } from '../../../contextTrim'
import type { OpenAIChat } from '../../../index.svelte'
import { HEADER } from '../pack'
import { createSendCapture, recordOf, type CapturedMessage, type SendCapture } from '../records'
import {
    HISTORY_FLOOR,
    discardChroMemoryIndex,
    getLastChroMemoryTrace,
    markChroMemoryDroppedAtRecheck,
    resetChroMemoryShadowForTests,
    runChroMemorySafely,
    runChroMemoryShadow,
    type InjectInput,
    type ShadowDeps,
    type ShadowInput,
    type ShadowSendArgs,
} from '../shadow'
import { chroMemoryDiscarded, chroMemoryTrace } from '../traceStore'

const len = (s: string): number => Math.ceil(s.length / 4)
/** A chat costs its content length, so the arithmetic below is exact. */
const countChat = async (c: OpenAIChat): Promise<number> => c.content.length

function deps(over: Partial<ShadowDeps> = {}) {
    const countText = vi.fn(async (t: string) => len(t))
    const countBlock = vi.fn(async (b: string) => len(b) + 3)
    let t = 1000
    const d: ShadowDeps = { countText, countBlock, now: () => (t += 5), ...over }
    return { d, countText, countBlock }
}

interface Built {
    /** K0, the live array make-room splices. */
    chats: OpenAIChat[]
    /** K0 as it was before make-room. */
    k0: OpenAIChat[]
    input: ShadowInput
    inject: InjectInput
    capture: SendCapture
    args: ShadowSendArgs
    count: ReturnType<typeof vi.fn>
    afterTokens: number
    maxContext: number
}

/**
 * `total` message chats after `lead` system chats; step 1 (the real trim)
 * drops the lead chats and the first `d0` messages, leaving K0.
 */
async function build(o: { total?: number, d0?: number, lead?: number[], after?: number[], injectMax?: number, reserve?: number, budget?: number, countVaries?: boolean } = {}): Promise<Built> {
    const total = o.total ?? 24
    const d0 = o.d0 ?? 8
    const lead = o.lead ?? []
    const after = o.after ?? []
    const messages: OpenAIChat[] = Array.from({ length: total }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: i === total - 1 ? 'Tell me about the zebra' : `m${i} zebra `.padEnd(24, '.'),
    }))
    const leads: OpenAIChat[] = lead.map((n) => ({ role: 'system', content: 'S'.repeat(n) }))
    const all = [...leads, ...messages]
    const refs: CapturedMessage[] = messages.map((m, i) => ({ msg: { chatId: `c${i}`, role: i % 2 ? 'char' : 'user', data: m.content }, chatIndex: i, name: 'Bot', preWrap: m.content, data: m.content }))
    const capture = createSendCapture()
    messages.forEach((m, i) => capture.add(m, refs[i]))
    const before = all.slice()
    const afterTokens = after.reduce((a, b) => a + b, 0)
    const keptTotal = messages.slice(d0).reduce((a, m) => a + m.content.length, 0) + afterTokens
    const firstMessageChat = leads.length
    const tokensBeforeMessages = lead.reduce((a, b) => a + b, 0)
    const step1 = await trimChatsToContext({
        chats: all,
        firstMessageChat,
        tokensBeforeMessages,
        tokensAfterMessages: after,
        countedMessages: new Map(),
        maxContextTokens: keptTotal,
        count: countChat,
    })
    expect(step1.fits).toBe(true)
    expect(all).toHaveLength(total - d0)
    const count = vi.fn(countChat)
    const maxContext = o.injectMax ?? keptTotal
    const inject: InjectInput = {
        chats: all,
        step1: { currentTokens: step1.currentTokens, dropped: step1.dropped, counts: step1.counts },
        firstMessageChat,
        tokensBeforeMessages,
        tokensAfterMessages: after,
        maxContextTokens: maxContext,
        reserveTokens: o.reserve ?? 0,
        floor: HISTORY_FLOOR,
        count,
    }
    const input: ShadowInput = {
        chatKey: 'owner:chat',
        before,
        kept: all,
        recordOf: (chat) => {
            const i = messages.indexOf(chat)
            return i < 0 ? null : recordOf(refs[i], 'User')
        },
        queryRecord: () => recordOf(refs[total - 1], 'User'),
        budgetTokens: o.budget ?? 400,
        countVaries: o.countVaries ?? false,
        tokenizerKey: 'tk',
        inject,
    }
    const { maxContextTokens: _max, ...injectArgs } = inject
    const args: ShadowSendArgs = {
        capture,
        first: null,
        charName: 'Bot',
        userName: () => 'User',
        before,
        kept: all,
        ownerId: 'owner',
        chatId: 'chat',
        ltmSettings: { budgetTokens: o.budget ?? 400 },
        maxContextTokens: maxContext,
        countVaries: o.countVaries ?? false,
        tokenizerKey: () => 'tk',
        inject: injectArgs,
    }
    return { chats: all, k0: all.slice(), input, inject, capture, args, count, afterTokens, maxContext }
}

const sum = (chats: readonly OpenAIChat[]): number => chats.reduce((a, c) => a + c.content.length, 0)

beforeEach(() => resetChroMemoryShadowForTests())
afterEach(() => vi.restoreAllMocks())

describe('inject core: make-room', () => {
    function expectMadeRoom(b: Built, trace: Awaited<ReturnType<typeof runChroMemoryShadow>>, reserve = 0): void {
        expect(trace.outcome).toBe('injected')
        const m = trace.makeRoom!
        const keep = Math.max(1, Math.min(HISTORY_FLOOR, b.k0.length))
        expect(m.floor).toBe(keep)
        // The memory message's room is what the window leaves beside the floor's chats.
        expect(m.room).toBe(b.maxContext - reserve - (sum(b.k0.slice(-keep)) + b.afterTokens))
        expect(m.limit).toBe(b.maxContext - reserve - trace.T)
        expect(m.reserved).toBe(reserve)
        expect(trace.T).toBeLessThanOrEqual(m.room)
        const evicted = b.k0.length - b.chats.length
        expect(m.evictedChats).toBe(evicted)
        expect(m.evictedTokens).toBe(sum(b.k0.slice(0, evicted)))
        // The kept window is the newest suffix, within the limit, and maximal.
        b.chats.forEach((c, i) => expect(c).toBe(b.k0[evicted + i]))
        expect(sum(b.chats) + b.afterTokens).toBeLessThanOrEqual(m.limit)
        if (evicted > 0) expect(sum(b.chats) + b.afterTokens + b.k0[evicted - 1].content.length).toBeGreaterThan(m.limit)
        expect(b.chats.length).toBeGreaterThanOrEqual(Math.min(HISTORY_FLOOR, b.k0.length))
    }

    test('E1 new rule: room comes from step 1, the evicted set is the minimal oldest prefix and the second trim counts nothing', async () => {
        const b = await build()
        const placed = await runChroMemorySafely(b.args, deps().d)
        const trace = getLastChroMemoryTrace()!
        expect(placed).not.toBeNull()
        expect(placed!.block.startsWith(HEADER)).toBe(true)
        expect(trace.mode).toBe('inject')
        expect(trace.makeRoom!.evictedChats).toBeGreaterThan(0)
        expectMadeRoom(b, trace)
        expect(b.count).not.toHaveBeenCalled()
    })

    test('E1 new rule: leading system chats and counts after the messages are restated for the second trim', async () => {
        const b = await build({ lead: [30, 25], after: [11, 9] })
        const placed = await runChroMemorySafely(b.args, deps().d)
        expect(placed).not.toBeNull()
        expectMadeRoom(b, getLastChroMemoryTrace()!)
        expect(b.count).not.toHaveBeenCalled()
    })

    test('new rule: the depth-prompt reserve narrows the room and the limit, and is traced', async () => {
        const b = await build({ reserve: 50, injectMax: undefined })
        const placed = await runChroMemorySafely(b.args, deps().d)
        expect(placed).not.toBeNull()
        expectMadeRoom(b, getLastChroMemoryTrace()!, 50)
    })

    test('MR1 regression reproducer: a room tighter than the budget bounds T and the pack, and at least the floor is kept', async () => {
        const probe = await build()
        const floorTotal = sum(probe.k0.slice(-HISTORY_FLOOR))
        const b = await build({ injectMax: floorTotal + 60, d0: 10, budget: 4000 })
        const placed = await runChroMemorySafely(b.args, deps().d)
        const trace = getLastChroMemoryTrace()!
        expect(placed).not.toBeNull()
        expect(trace.makeRoom).not.toBeNull()
        expect(trace.makeRoom!.room).toBe(60)
        expect(trace.T).toBeLessThanOrEqual(trace.makeRoom!.room)
        expect(trace.makeRoom!.itemsDropped).toBeGreaterThan(0)
        expectMadeRoom(b, trace)
        expect(b.chats.length).toBeGreaterThanOrEqual(HISTORY_FLOOR)
    })

    test('new rule: a room of zero or less is no-room, counts nothing and leaves K0', async () => {
        const b = await build({ injectMax: 10 })
        const { d, countText, countBlock } = deps()
        expect(await runChroMemorySafely(b.args, d)).toBeNull()
        expect(getLastChroMemoryTrace()!.outcome).toBe('no-room')
        expect(countText).not.toHaveBeenCalled()
        expect(countBlock).not.toHaveBeenCalled()
        expect(b.chats).toEqual(b.k0)
        b.chats.forEach((c, i) => expect(c).toBe(b.k0[i]))
    })

    test('E2 new rule: a make-room trim that does not fit gives no block, no-room and the same array', async () => {
        const b = await build()
        const trim = vi.fn(async () => ({ fits: false, currentTokens: 0, dropped: [], counts: new Map<OpenAIChat, number>() }))
        expect(await runChroMemorySafely(b.args, deps({ trim }).d)).toBeNull()
        expect(trim).toHaveBeenCalledTimes(1)
        expect(getLastChroMemoryTrace()!.outcome).toBe('no-room')
        expect(getLastChroMemoryTrace()!.makeRoom).toBeNull()
        b.chats.forEach((c, i) => expect(c).toBe(b.k0[i]))
        expect(b.chats).toHaveLength(b.k0.length)
    })

    test('E3 new rule: a block count that throws is an error trace, no block and the same array', async () => {
        const b = await build()
        let calls = 0
        const countBlock = vi.fn(async (blk: string) => {
            calls++
            if (calls === 2) throw new Error('second block count boom')
            return len(blk) + 3
        })
        expect(await runChroMemorySafely(b.args, deps({ countBlock }).d)).toBeNull()
        const trace = getLastChroMemoryTrace()!
        expect(trace.outcome).toBe('error')
        expect(trace.error).toMatch(/second block count boom/)
        expect(b.chats).toHaveLength(b.k0.length)
        b.chats.forEach((c, i) => expect(c).toBe(b.k0[i]))
    })

    test('E6 new rule: a fault after the splice still returns the block, with the history spliced', async () => {
        const b = await build()
        const badCounts = { get: () => { throw new Error('counts boom') } } as unknown as ReadonlyMap<OpenAIChat, number>
        const trim: NonNullable<ShadowDeps['trim']> = async (a) => ({ ...(await trimChatsToContext(a)), counts: badCounts })
        const placed = await runChroMemorySafely(b.args, deps({ trim }).d)
        expect(placed).not.toBeNull()
        expect(placed!.block.startsWith(HEADER)).toBe(true)
        expect(b.chats.length).toBeLessThan(b.k0.length)
        const trace = getLastChroMemoryTrace()!
        expect(trace.outcome).toBe('error')
        expect(trace.error).toMatch(/counts boom/)
    })

    test('E6 new rule: a throwing measure never fails the send, on the result path and the error path', async () => {
        vi.spyOn(performance, 'measure').mockImplementation(() => { throw new Error('measure boom') })
        const b = await build()
        const placed = await runChroMemorySafely(b.args, deps().d)
        expect(placed).not.toBeNull()
        expect(getLastChroMemoryTrace()!.outcome).toBe('injected')
        expect(b.chats.length).toBeLessThan(b.k0.length)

        resetChroMemoryShadowForTests()
        const c = await build()
        const thrown = await runChroMemorySafely({ ...c.args, userName: () => { throw new Error('user boom') } }, deps().d)
        expect(thrown).toBeNull()
        expect(getLastChroMemoryTrace()!.outcome).toBe('error')
        expect(c.chats).toHaveLength(c.k0.length)
    })

    test('new rule: one measure entry per send, and the dropped-at-recheck mark republishes without a second entry', async () => {
        const measure = vi.spyOn(performance, 'measure')
        const b = await build()
        await runChroMemorySafely(b.args, deps().d)
        expect(measure).toHaveBeenCalledTimes(1)
        expect(measure.mock.calls[0][0]).toBe('risu:chromemory')
        const detail = (measure.mock.calls[0][1] as { detail: { outcome: string, mode: string, T: number } }).detail
        expect(detail).toMatchObject({ outcome: 'injected', mode: 'inject' })

        markChroMemoryDroppedAtRecheck('other:chat')
        expect(getLastChroMemoryTrace()!.outcome).toBe('injected')
        markChroMemoryDroppedAtRecheck('owner:chat')
        expect(getLastChroMemoryTrace()!.outcome).toBe('dropped-at-recheck')
        expect(get(chroMemoryTrace)).toBe(getLastChroMemoryTrace())
        expect(measure).toHaveBeenCalledTimes(1)
    })
})

describe('trace store and discard', () => {
    test('E5 new rule: the store holds the trace on success and on the adapter catch path', async () => {
        const b = await build()
        await runChroMemorySafely(b.args, deps().d)
        expect(get(chroMemoryTrace)).toBe(getLastChroMemoryTrace())
        expect(get(chroMemoryTrace)!.outcome).toBe('injected')

        const c = await build()
        await runChroMemorySafely({ ...c.args, userName: () => { throw new Error('user boom') } }, deps().d)
        expect(get(chroMemoryTrace)!.outcome).toBe('error')
        expect(get(chroMemoryTrace)).toBe(getLastChroMemoryTrace())
    })

    test('E4 new rule: discard makes the next run fresh and clears when a trace arrives; another key leaves the slot alone but still sets its notice', async () => {
        const run = async () => {
            const b = await build({ d0: 20, total: 24 })
            await runChroMemorySafely({ ...b.args, inject: null }, deps().d)
            return getLastChroMemoryTrace()!
        }
        const first = await run()
        expect(first.index!.fresh).toBe(true)
        expect((await run()).index!.fresh).toBe(false)

        discardChroMemoryIndex('other:chat')
        expect(get(chroMemoryDiscarded)).toBe('other:chat')
        expect((await run()).index!.fresh).toBe(false)

        discardChroMemoryIndex('owner:chat')
        expect(get(chroMemoryDiscarded)).toBe('owner:chat')
        const again = await run()
        expect(again.index!.fresh).toBe(true)
        expect(again.rebuildCause).toBe('fresh')
        expect(get(chroMemoryDiscarded)).toBeNull()
    })
})

describe('shadow packs as inject does', () => {
    test('SH1 new rule: shadow and inject pick the same items and T when the room is not binding, and both take the head from the block count', async () => {
        const shadowWorld = await build({ budget: 120 })
        const rest = shadowWorld.input
        const shadowDeps = deps()
        const shadowTrace = await runChroMemoryShadow({ ...rest, kept: shadowWorld.chats, inject: undefined }, shadowDeps.d)
        expect(shadowTrace.mode).toBe('shadow')
        expect(shadowDeps.countBlock.mock.calls.filter((c) => c[0] === HEADER)).toHaveLength(1)
        expect(shadowDeps.countText.mock.calls.filter((c) => c[0] === HEADER)).toHaveLength(0)

        resetChroMemoryShadowForTests()
        const injectWorld = await build({ budget: 120, injectMax: 100000 })
        const injectDeps = deps()
        await runChroMemorySafely(injectWorld.args, injectDeps.d)
        const injectTrace = getLastChroMemoryTrace()!
        expect(injectTrace.outcome).toBe('injected')
        expect(injectTrace.items).toEqual(shadowTrace.items)
        expect(injectTrace.T).toBe(shadowTrace.T)
    })

    test('SH1 new rule: on a varying counter a first block count over the budget keeps picks, within 12 counts', async () => {
        const b = await build({ countVaries: true, budget: 120, d0: 20, total: 24 })
        let blockCalls = 0
        const countBlock = vi.fn(async (blk: string) => {
            if (blk === HEADER) return len(blk) + 3
            blockCalls++
            return blockCalls === 1 ? 100000 : len(blk) + 3
        })
        const rest = b.input
        const d = deps({ countBlock })
        const trace = await runChroMemoryShadow({ ...rest, inject: undefined }, d.d)
        expect(trace.outcome).toBe('packed')
        expect(trace.items.length).toBeGreaterThan(0)
        expect(d.countText.mock.calls.length + countBlock.mock.calls.length).toBeLessThanOrEqual(12)
    })
})

describe('I1 outcomes leave the history alone', () => {
    test('new rule: empty D0 and a missing query give no block and the same array', async () => {
        const b = await build({ d0: 0 })
        expect(await runChroMemorySafely(b.args, deps().d)).toBeNull()
        expect(getLastChroMemoryTrace()!.outcome).toBe('empty-d0')
        expect(b.chats).toHaveLength(b.k0.length)

        const c = await build()
        expect(await runChroMemoryShadow({ ...c.input, queryRecord: () => null }, deps().d)).toMatchObject({ outcome: 'no-query' })
        expect(c.chats).toHaveLength(c.k0.length)
    })

    test('new rule: nothing packed (budget below one line) gives no block and the same array', async () => {
        const b = await build({ budget: 3 })
        expect(await runChroMemorySafely(b.args, deps().d)).toBeNull()
        expect(getLastChroMemoryTrace()!.outcome).toBe('nothing-packed')
        expect(b.chats).toHaveLength(b.k0.length)
    })
})
