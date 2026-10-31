/**
 * Per-branch memory and script state around `detachTail` and `switchTo`: what a departure parks on the
 * departed head record, what an arrival restores or carries, and that a send on the resulting path meets
 * no SupaMemory resolver error. The resolver is the real `supaMemory` over a stubbed database and
 * summariser.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ChatTokenizer } from 'src/ts/tokenizer'
import type { Chat, ChatAlt, Message, character } from '../../storage/database.svelte'
import type { SerializableHypaV2Data } from '../memory/hypav2'
import type { SerializableHypaV3Data } from '../memory/hypav3'
import type { OpenAIChat } from '../index.svelte'

vi.hoisted(() => {
    ;(globalThis as { safeStructuredClone?: <T>(value: T) => T }).safeStructuredClone = (value) => structuredClone(value)
})

vi.mock('src/ts/storage/database.svelte', () => ({
    getDatabase: () => ({ removePunctuationHypa: false, maxSupaChunkSize: 1200, supaModelType: 'subModel', supaMemoryPrompt: '', supaMemoryKey: '', hypaModel: 'MiniLM' }),
}))
vi.mock('src/ts/tokenizer', () => ({ tokenize: async (text: string) => Math.ceil(text.length / 4) }))
vi.mock('src/ts/process/request/request', () => ({
    requestChatData: vi.fn(async () => ({ type: 'success', result: 'SUMMARY' })),
}))
vi.mock('src/ts/process/memory/hypamemory', () => ({
    HypaProcesser: class {
        oaikey = ''
        vectors: unknown[] = []
        async addText() {}
        async similaritySearch() { return [] }
    },
}))
vi.mock('src/ts/process/stringlize', () => ({ stringlizeChat: () => 'query' }))
vi.mock('src/ts/globalApi.svelte', () => ({ globalFetch: vi.fn() }))
vi.mock('src/ts/process/transformers', () => ({ runSummarizer: vi.fn() }))
vi.mock('src/ts/parser/chatML', () => ({ parseChatML: () => null }))
vi.mock('src/ts/util', () => ({ getUserName: () => 'User' }))
vi.mock('src/ts/secretRef', () => ({
    resolveSecret: async (secret: string) => secret,
    SecretRefError: class extends Error {},
}))

import {
    branchState,
    detachTail,
    hypaV2WithoutMemos,
    hypaV3WithoutMemos,
    supaResumeResolvable,
    switchTo,
} from '../chatTree'
import { supaMemory } from '../memory/supaMemory'

const char = { name: 'C', type: 'character' } as character
const lengthTokenizer = { tokenizeChat: async (chat: OpenAIChat) => chat.content.length } as unknown as ChatTokenizer

function msg(chatId: string): Message {
    return { role: 'char', data: `data ${chatId}`, chatId }
}

function chatOf(path: string[], extra: Partial<Chat> = {}): Chat {
    return { message: path.map(msg), note: '', name: 'chat', localLore: [], ...extra }
}

function numbered(prefix: string, from: number, to: number): string[] {
    const out: string[] = []
    for (let k = from; k <= to; k++) {
        out.push(`${prefix}${k}`)
    }
    return out
}

function headOf(chat: Chat, chatId: string): ChatAlt {
    const found = chat.alt?.find((record) => record.m.chatId === chatId)
    if (found === undefined) {
        throw new Error(`no record for ${chatId}`)
    }
    return found
}

/**
 * What a send hands the resolver: every path message as a chat entry, far over the token budget.
 * Returns the resume-point error ("cannot be found", "chat ID not found") or undefined; later
 * summarisation outcomes are not part of this question.
 */
async function resolve(chat: Chat): Promise<string | undefined> {
    const chats: OpenAIChat[] = chat.message.map((message) => ({ role: 'user', content: 'x'.repeat(100), memo: message.chatId }))
    const result = await supaMemory(chats, 100000, 500, chat, char, lengthTokenizer)
    return result.error !== undefined && /cannot be found|chat ID not found/.test(result.error) ? result.error : undefined
}

function hypaLegacy(...ids: string[]): string {
    return 'hypa:\n' + JSON.stringify(ids.map((id) => ({ id, supa: 'S', hypa: ['h'] })))
}

function v3Of(...rows: { text: string, memos: string[], important?: boolean }[]): SerializableHypaV3Data {
    return {
        summaries: rows.map((row) => ({ text: row.text, chatMemos: row.memos, isImportant: row.important ?? false })),
        categories: [{ id: 'c1', name: 'cat' }],
        metrics: { lastImportantSummaries: [0], lastRecentSummaries: [], lastSimilarSummaries: [], lastRandomSummaries: [] },
    }
}

function v2Of(...rows: { id: number, memos: string[] }[]): SerializableHypaV2Data {
    return {
        lastMainChunkID: rows.length > 0 ? rows[rows.length - 1].id : 0,
        mainChunks: rows.map((row) => ({ id: row.id, text: `t${row.id}`, chatMemos: row.memos, lastChatMemo: row.memos[row.memos.length - 1] })),
        chunks: rows.map((row) => ({ mainChunkID: row.id, text: `c${row.id}` })),
    }
}

describe('F12 sequences: a send after any switch has no resolver error', () => {
    // The sequence of the finding: P = m5, reroll m9, continue to m30 with P = m20, press back.
    function rerollThenContinue(supaMemoryData: (id: string) => string): Chat {
        const chat = chatOf(numbered('m', 0, 9), { supaMemoryData: supaMemoryData('m5') })
        detachTail(chat, 9)
        chat.message.push(msg('r9'), ...numbered('m', 10, 30).map(msg))
        chat.supaMemoryData = supaMemoryData('m20')
        return chat
    }

    it('T44 plain SupaMemory: back to the replaced reply restores the pointer of that branch', async () => {
        const chat = rerollThenContinue((id) => `${id}\nsummary text of ${id}`)
        expect(switchTo(chat, 9, 'm9')).toBe(true)
        expect(chat.supaMemoryData).toBe('m5\nsummary text of m5')
        expect(await resolve(chat)).toBeUndefined()
    })

    it('T44 plain SupaMemory: forward again restores the continued branch', async () => {
        const chat = rerollThenContinue((id) => `${id}\nsummary text of ${id}`)
        switchTo(chat, 9, 'm9')
        expect(switchTo(chat, 9, 'r9')).toBe(true)
        expect(chat.supaMemoryData).toBe('m20\nsummary text of m20')
        expect(await resolve(chat)).toBeUndefined()
    })

    it('T45 legacy hypa: data follows its branch and resolves', async () => {
        const chat = rerollThenContinue((id) => hypaLegacy(id))
        switchTo(chat, 9, 'm9')
        expect(chat.supaMemoryData).toBe(hypaLegacy('m5'))
        expect(await resolve(chat)).toBeUndefined()
    })

    it('a branch that was never shown clears a pointer that names a departing message, so the send resolves', async () => {
        const chat = chatOf(numbered('m', 0, 9), { supaMemoryData: 'm8\nsummary text', supaMemoryCoveredId: 'm8', lastMemory: 'm8' })
        chat.alt = [{ m: msg('x9'), p: 'm8', a: 1 }]
        detachTail(chat, 6)
        expect(chat.supaMemoryData).toBeUndefined()
        expect(chat.supaMemoryCoveredId).toBeUndefined()
        expect(chat.lastMemory).toBeUndefined()
        expect(await resolve(chat)).toBeUndefined()
    })

    it('a never-shown sibling keeps a pointer that sits in the shared messages', async () => {
        const chat = chatOf(numbered('m', 0, 9), { supaMemoryData: 'm3\nsummary text', supaMemoryCoveredId: 'm3', lastMemory: 'm3' })
        detachTail(chat, 6)
        expect(chat.supaMemoryData).toBe('m3\nsummary text')
        expect(chat.supaMemoryCoveredId).toBe('m3')
        expect(chat.lastMemory).toBe('m3')
        expect(await resolve(chat)).toBeUndefined()
    })

    it('a parked pointer whose message was deleted meanwhile is dropped on arrival, not restored', async () => {
        const chat = chatOf(numbered('m', 0, 9), { supaMemoryData: 'm9\nsummary text' })
        detachTail(chat, 9)
        chat.message.push(msg('r9'))
        chat.supaMemoryData = 'r9\nother summary'
        switchTo(chat, 9, 'm9')
        // m9 is back and holds the pointer; delete it from the path, then return to it from a sibling.
        chat.message.splice(9)
        chat.alt = [{ m: msg('r9'), p: 'm8', a: 5, mem: { supaMemoryData: 'gone\nsummary text', supaMemoryCoveredId: null } }]
        switchTo(chat, 9, 'r9')
        expect(chat.supaMemoryData).toBeUndefined()
        expect(await resolve(chat)).toBeUndefined()
    })
})

describe('small fields are always parked', () => {
    it('parks an absent value as null on the departed head', () => {
        const chat = chatOf(['a', 'b'])
        detachTail(chat, 1)
        expect(headOf(chat, 'b').mem).toEqual({
            supaMemoryData: null,
            supaMemoryCoveredId: null,
            lastMemory: null,
            scriptstate: null,
        })
    })

    it('T46 an empty branch does not receive the script state of the other branch', () => {
        const chat = chatOf(['r', 'a'])
        detachTail(chat, 1)
        chat.message.push(msg('b'))
        chat.scriptstate = { x: 1 }
        switchTo(chat, 1, 'a')
        expect(chat.scriptstate).toBeUndefined()
        switchTo(chat, 1, 'b')
        expect(chat.scriptstate).toEqual({ x: 1 })
    })

    it('an arrival at a record that parked nothing (a never-shown sibling) gets no script state, and the arrived record keeps no parked memory', () => {
        const chat = chatOf(['r', 'a'], { scriptstate: { x: 1 } })
        chat.alt = [{ m: msg('s'), p: 'r', a: 1 }]
        const arrived = chat.alt[0]
        arrived.mem = {}
        switchTo(chat, 1, 's')
        expect(chat.scriptstate).toBeUndefined()
        expect(arrived.mem).toBeUndefined()
        expect(headOf(chat, 'a').mem?.scriptstate).toEqual({ x: 1 })
    })

    it('T38 script state away and back is deep-equal; suggestions are cleared; bookmarks stay', () => {
        const chat = chatOf(['r', 'a'], { scriptstate: { n: 3, s: 'v', f: true }, suggestMessages: ['s1'], bookmarks: ['a'], bookmarkNames: { a: 'mark' } })
        switchTo(chat, 1, 'a')
        detachTail(chat, 1)
        chat.message.push(msg('b'))
        chat.scriptstate = { n: 9 }
        chat.suggestMessages = ['s2']
        expect(switchTo(chat, 1, 'a')).toBe(true)
        expect(chat.scriptstate).toEqual({ n: 3, s: 'v', f: true })
        expect(chat.suggestMessages).toBeUndefined()
        expect(chat.bookmarks).toEqual(['a'])
        expect(chat.bookmarkNames).toEqual({ a: 'mark' })
    })

    it('OQ2 a detach keeps the live script state and parks the departing one on the replaced reply', () => {
        const chat = chatOf(['r', 's1'], { scriptstate: { n: 1 } })
        detachTail(chat, 1)
        expect(chat.scriptstate).toEqual({ n: 1 })
        expect(headOf(chat, 's1').mem?.scriptstate).toEqual({ n: 1 })
    })

    it('T57 (tree level) reroll then arrows restore each reply\'s script state', () => {
        const chat = chatOf(['r', 's1'], { scriptstate: { n: 1 } })
        detachTail(chat, 1)
        chat.message.push(msg('s2'))
        chat.scriptstate = { n: 2 }
        switchTo(chat, 1, 's1')
        expect(chat.scriptstate).toEqual({ n: 1 })
        switchTo(chat, 1, 's2')
        expect(chat.scriptstate).toEqual({ n: 2 })
    })
})

describe('OQ4 an arrival that departs nothing', () => {
    it('T56 after Branch, the arrow to the old tail restores its parked state and discards the live changes', () => {
        const chat = chatOf(numbered('m', 0, 5), { scriptstate: { n: 1 }, lastMemory: 'm2' })
        detachTail(chat, 3)
        chat.scriptstate = { n: 99 }
        chat.lastMemory = 'm1'
        expect(switchTo(chat, 3, 'm3')).toBe(true)
        expect(chat.scriptstate).toEqual({ n: 1 })
        expect(chat.lastMemory).toBe('m2')
        expect(chat.alt?.length ?? 0).toBe(0)
    })
})

describe('summary stores are parked only when the switch changes them', () => {
    it('T17 summaries are intact after a switch, a cleanup of the other path and the switch back', () => {
        const stored = v3Of({ text: 'shared', memos: ['m0', 'm1'] }, { text: 'tail', memos: ['m2', 'm3'] })
        const chat = chatOf(['m0', 'm1', 'm2', 'm3'], { hypaV3Data: structuredClone(stored) })
        detachTail(chat, 2)
        chat.message.push(msg('n2'))
        // The send-time orphan cleanup: only summaries whose memos are all on the path survive.
        const onPath = new Set(chat.message.map((message) => message.chatId))
        const live = chat.hypaV3Data
        if (live !== undefined) {
            live.summaries = live.summaries.filter((summary) => summary.chatMemos.every((memo) => onPath.has(memo)))
        }
        expect(chat.hypaV3Data?.summaries.map((summary) => summary.text)).toEqual(['shared'])
        switchTo(chat, 2, 'm2')
        expect(chat.hypaV3Data).toEqual(stored)
    })

    it('T18 names nothing after the fork: no summary store is parked', () => {
        const chat = chatOf(['m0', 'm1', 'm2', 'm3'], {
            hypaV3Data: v3Of({ text: 'shared', memos: ['m0', 'm1'] }),
            hypaV2Data: v2Of({ id: 1, memos: ['m0'] }),
        })
        detachTail(chat, 2)
        const mem = headOf(chat, 'm2').mem
        expect(mem).toBeDefined()
        expect('hypaV3Data' in (mem ?? {})).toBe(false)
        expect('hypaV2Data' in (mem ?? {})).toBe(false)
    })

    it('T47 the summaries naming departing messages are parked, the shared ones stay, whatever the orphan setting', () => {
        const chat = chatOf(['m0', 'm1', 'm2', 'm3'], {
            hypaV3Data: v3Of({ text: 'shared', memos: ['m0'] }, { text: 'tail', memos: ['m2'] }),
            hypaV2Data: v2Of({ id: 1, memos: ['m0'] }, { id: 2, memos: ['m3'] }),
        })
        detachTail(chat, 2)
        expect(chat.hypaV3Data?.summaries.map((summary) => summary.text)).toEqual(['shared'])
        expect(chat.hypaV3Data?.categories).toEqual([{ id: 'c1', name: 'cat' }])
        expect(chat.hypaV2Data?.mainChunks.map((chunk) => chunk.id)).toEqual([1])
        expect(chat.hypaV2Data?.chunks.map((chunk) => chunk.mainChunkID)).toEqual([1])
        expect(chat.hypaV2Data?.lastMainChunkID).toBe(1)
        expect(headOf(chat, 'm2').mem?.hypaV3Data?.summaries.map((summary) => summary.text)).toEqual(['shared', 'tail'])
    })

    it('newer summaries of the shared messages are parked before a parked copy replaces them', () => {
        const chat = chatOf(['m0', 'm1', 'm2'], { hypaV3Data: v3Of({ text: 'old', memos: ['m0'] }, { text: 'tail', memos: ['m2'] }) })
        detachTail(chat, 2)
        chat.message.push(msg('n2'))
        chat.hypaV3Data = v3Of({ text: 'old', memos: ['m0'] }, { text: 'newer shared', memos: ['m1'] }, { text: 'n2 sum', memos: ['n2'] })
        const before = structuredClone(chat.hypaV3Data)
        switchTo(chat, 2, 'm2')
        expect(chat.hypaV3Data?.summaries.map((summary) => summary.text)).toEqual(['old', 'tail'])
        switchTo(chat, 2, 'n2')
        expect(chat.hypaV3Data).toEqual(before)
    })

    it('T59 a toggle on a live summary after a switch leaves the parked copy unchanged', () => {
        const chat = chatOf(['m0', 'm1', 'm2'], { hypaV3Data: v3Of({ text: 'shared', memos: ['m0'] }, { text: 'tail', memos: ['m2'] }) })
        detachTail(chat, 2)
        const live = chat.hypaV3Data
        if (live === undefined) {
            throw new Error('live summaries missing')
        }
        live.summaries[0].isImportant = true
        live.categories?.push({ id: 'c2', name: 'extra' })
        const parked = headOf(chat, 'm2').mem?.hypaV3Data
        expect(parked?.summaries[0].isImportant).toBe(false)
        expect(parked?.categories).toEqual([{ id: 'c1', name: 'cat' }])
    })

    it('the restored value is a copy: the record keeps no parked memory and later edits do not reach the departed one', () => {
        const chat = chatOf(['m0', 'm1', 'm2'], { hypaV3Data: v3Of({ text: 'shared', memos: ['m0'] }, { text: 'tail', memos: ['m2'] }) })
        detachTail(chat, 2)
        chat.message.push(msg('n2'))
        switchTo(chat, 2, 'm2')
        const departed = headOf(chat, 'n2').mem
        const live = chat.hypaV3Data
        if (live === undefined) {
            throw new Error('live summaries missing')
        }
        live.summaries[0].isImportant = true
        expect(departed?.hypaV3Data?.summaries[0]?.isImportant ?? false).toBe(false)
        expect(chat.alt?.some((record) => record.m.chatId === 'm2')).toBe(false)
    })
})

describe('branchState', () => {
    it('shares no object between next, park, live and the parked copy', () => {
        const live = { scriptstate: { n: 1 }, hypaV3Data: v3Of({ text: 'a', memos: ['x'] }, { text: 'b', memos: ['y'] }) }
        const parked = { scriptstate: { n: 2 }, hypaV3Data: v3Of({ text: 'p', memos: ['q'] }) }
        const { next, park } = branchState(live, new Set(['x']), new Set(['y']), parked, false)
        expect(next.scriptstate).not.toBe(parked.scriptstate)
        expect(next.hypaV3Data).not.toBe(parked.hypaV3Data)
        expect(park.scriptstate).not.toBe(live.scriptstate)
        expect(park.hypaV3Data).not.toBe(live.hypaV3Data)
        expect(park.hypaV3Data?.summaries[0]).not.toBe(live.hypaV3Data.summaries[0])
        expect(next.hypaV3Data?.summaries).toEqual(parked.hypaV3Data.summaries)
        expect(park.hypaV3Data?.summaries.map((summary) => summary.text)).toEqual(['a', 'b'])
    })
})

describe('pure seams', () => {
    it('supaResumeResolvable follows the resolver', () => {
        const path = new Set(['m1', 'm2'])
        expect(supaResumeResolvable(undefined, path)).toBe(true)
        expect(supaResumeResolvable('', path)).toBe(true)
        expect(supaResumeResolvable('m1\nsummary', path)).toBe(true)
        expect(supaResumeResolvable('m9\nsummary', path)).toBe(false)
        expect(supaResumeResolvable(hypaLegacy('m9', 'm2'), path)).toBe(true)
        expect(supaResumeResolvable(hypaLegacy('m9'), path)).toBe(false)
        expect(supaResumeResolvable('hypa:\n[]', path)).toBe(false)
        expect(supaResumeResolvable('hypa:\n{not json', path)).toBe(true)
    })

    it('the summary-store filters return their input when nothing is removed', () => {
        const v2 = v2Of({ id: 1, memos: ['a'] })
        const v3 = v3Of({ text: 't', memos: ['a'] })
        expect(hypaV2WithoutMemos(v2, new Set(['z']))).toBe(v2)
        expect(hypaV3WithoutMemos(v3, new Set(['z']))).toBe(v3)
        expect(hypaV2WithoutMemos(v2, new Set(['a'])).lastMainChunkID).toBe(0)
    })
})
