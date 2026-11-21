import { expect, test } from 'vitest'
import { trimChatsToContext } from '../../../contextTrim'
import type { OpenAIChat } from '../../../index.svelte'
import { HEADER } from '../pack'
import { createSendCapture, type CapturedMessage } from '../records'
import { HISTORY_FLOOR, getLastChroMemoryTrace, runChroMemorySafely, type ShadowDeps, type ShadowSendArgs } from '../shadow'
import { chroMemoryTrace } from '../traceStore'

// A throwing subscriber leaves svelte/store's shared notification queue stuck for the
// rest of the module realm, so this is the only test in its file.

const len = (s: string): number => Math.ceil(s.length / 4)
const countChat = async (c: OpenAIChat): Promise<number> => c.content.length

test('E6 new rule: a throwing trace subscriber never fails the send, which still returns the block with the history spliced', async () => {
    const total = 24
    const d0 = 8
    const messages: OpenAIChat[] = Array.from({ length: total }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        content: i === total - 1 ? 'Tell me about the zebra' : `m${i} zebra `.padEnd(24, '.'),
    }))
    const refs: CapturedMessage[] = messages.map((m, i) => ({ msg: { chatId: `c${i}`, role: i % 2 ? 'char' : 'user', data: m.content }, chatIndex: i, name: 'Bot', preWrap: m.content, data: m.content }))
    const capture = createSendCapture()
    messages.forEach((m, i) => capture.add(m, refs[i]))
    const before = messages.slice()
    const keptTotal = messages.slice(d0).reduce((a, m) => a + m.content.length, 0)
    const step1 = await trimChatsToContext({ chats: messages, firstMessageChat: 0, tokensBeforeMessages: 0, tokensAfterMessages: [], countedMessages: new Map(), maxContextTokens: keptTotal, count: countChat })
    const k0 = messages.slice()
    const args: ShadowSendArgs = {
        capture, first: null, charName: 'Bot', userName: () => 'User',
        before, kept: messages, ownerId: 'owner', chatId: 'chat',
        ltmSettings: { budgetTokens: 400 }, maxContextTokens: keptTotal, countVaries: false, tokenizerKey: () => 'tk',
        inject: {
            chats: messages,
            step1: { currentTokens: step1.currentTokens, dropped: step1.dropped, counts: step1.counts },
            firstMessageChat: 0, tokensBeforeMessages: 0, tokensAfterMessages: [],
            reserveTokens: 0, floor: HISTORY_FLOOR, count: countChat,
        },
    }
    const deps: ShadowDeps = { countText: async (t) => len(t), countBlock: async (b) => len(b) + 3, now: () => 1 }
    const unsubscribe = chroMemoryTrace.subscribe((trace) => {
        if (trace) throw new Error('subscriber boom')
    })
    const placed = await runChroMemorySafely(args, deps)
    unsubscribe()
    expect(placed).not.toBeNull()
    expect(placed!.block.startsWith(HEADER)).toBe(true)
    expect(messages.length).toBeLessThan(k0.length)
    expect(getLastChroMemoryTrace()!.outcome).toBe('injected')
})
