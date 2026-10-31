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
    reattachOrphans,
    siblingsAt,
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
            hypaV2Data: null,
            hypaV3Data: null,
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

describe('summary stores are always parked', () => {
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

    it('T18 names nothing after the fork: both stores are parked whole', () => {
        const stored3 = v3Of({ text: 'shared', memos: ['m0', 'm1'] })
        const stored2 = v2Of({ id: 1, memos: ['m0'] })
        const chat = chatOf(['m0', 'm1', 'm2', 'm3'], { hypaV3Data: structuredClone(stored3), hypaV2Data: structuredClone(stored2) })
        detachTail(chat, 2)
        const mem = headOf(chat, 'm2').mem
        expect(mem?.hypaV3Data).toEqual(stored3)
        expect(mem?.hypaV2Data).toEqual(stored2)
        expect(mem?.hypaV3Data).not.toBe(chat.hypaV3Data)
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

/**
 * Reach of a parked branch: every departure parks all six fields, an arrival follows the run that departed
 * together, and nothing a branch left is lost by an arrow, a reroll, a delete of the last message or the end
 * press. The end control arrives at the highest stamp after the last message; `endOf` is the same rule
 * written locally.
 */
describe('park-always reach', () => {
    const SIX_KEYS = ['hypaV2Data', 'hypaV3Data', 'lastMemory', 'scriptstate', 'supaMemoryCoveredId', 'supaMemoryData']

    function endOf(chat: Chat): string {
        const last = chat.message.length === 0 ? null : chat.message[chat.message.length - 1].chatId ?? null
        let best: ChatAlt | undefined
        for (const record of chat.alt ?? []) {
            if (record.p === last && (best === undefined || record.a >= best.a)) {
                best = record
            }
        }
        if (best?.m.chatId === undefined) {
            throw new Error('no end target')
        }
        return best.m.chatId
    }

    function ids(chat: Chat): (string | undefined)[] {
        return chat.message.map((message) => message.chatId)
    }

    function texts(chat: Chat): string[] {
        return chat.hypaV3Data?.summaries.map((summary) => summary.text) ?? []
    }

    function holds(chat: Chat, token: string): boolean {
        return JSON.stringify(chat).includes(token)
    }

    function msgAt(chatId: string, time: number): Message {
        return { role: 'char', data: `data ${chatId}`, chatId, time }
    }

    /** I15' and I34 for a chat holding only producer data: six keys on each run head, no `mem` elsewhere, none on an arrived record. */
    function expectStructure(chat: Chat, arrived: readonly ChatAlt[], where: string): void {
        for (const record of chat.alt ?? []) {
            if (record.mem === undefined) {
                continue
            }
            expect(Object.keys(record.mem).sort(), `${where}: keys of ${record.m.chatId}`).toEqual(SIX_KEYS)
            const runPredecessor = (chat.alt ?? []).some((other) => other !== record && other.a === record.a && other.m.chatId === record.p)
            expect(runPredecessor, `${where}: ${record.m.chatId} is a run head`).toBe(false)
        }
        for (const record of arrived) {
            expect(record.mem, `${where}: arrived ${record.m.chatId} keeps no mem`).toBeUndefined()
            expect((chat.alt ?? []).includes(record), `${where}: arrived ${record.m.chatId} left alt`).toBe(false)
        }
    }

    function checkedSwitch(chat: Chat, i: number, headId: string, where: string): boolean {
        const before = (chat.alt ?? []).slice()
        const ok = switchTo(chat, i, headId)
        expectStructure(chat, before.filter((record) => !(chat.alt ?? []).includes(record)), where)
        return ok
    }

    function checkedDetach(chat: Chat, i: number, where: string): boolean {
        const ok = detachTail(chat, i)
        expectStructure(chat, [], where)
        return ok
    }

    // T70 regression reproducer: the Branch's old tail, S-m5 included, survives a reroll and an arrow
    it('T70 a reroll after Branch and the arrow back lose nothing; the end control returns the old tail as it was', () => {
        const chat = chatOf(numbered('m', 0, 5), {
            hypaV3Data: v3Of({ text: 'S-m1', memos: ['m1'] }, { text: 'S-m5', memos: ['m5'], important: true }),
            supaMemoryData: 'm5\nsummary through m5',
            scriptstate: { at: 'm5' },
        })
        expect(detachTail(chat, 5)).toBe(true)
        chat.scriptstate = { at: 'm4-branch' }
        expect(detachTail(chat, 4)).toBe(true)
        chat.message.push(msg('n4'))
        chat.scriptstate = { at: 'n4' }
        expect(switchTo(chat, 4, 'm4')).toBe(true)
        expect(holds(chat, 'S-m5')).toBe(true)
        expect(ids(chat)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
        expect(chat.scriptstate).toEqual({ at: 'm4-branch' })
        expect(switchTo(chat, 5, endOf(chat))).toBe(true)
        expect(ids(chat)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
        expect(chat.hypaV3Data?.summaries.find((summary) => summary.text === 'S-m5')?.isImportant).toBe(true)
        expect(chat.supaMemoryData).toBe('m5\nsummary through m5')
        expect(chat.scriptstate).toEqual({ at: 'm5' })
        expect(headOf(chat, 'n4').mem?.scriptstate).toEqual({ at: 'n4' })
    })

    // T71 regression reproducer: the arrival ends where the user left the chat, not at the old tail
    it('T71 Branch, a reroll and the arrow back end at the branch point', () => {
        const chat = chatOf(numbered('m', 0, 5), { scriptstate: { at: 'm5' } })
        detachTail(chat, 5)
        chat.scriptstate = { W: true }
        detachTail(chat, 4)
        chat.message.push(msg('n4'))
        chat.scriptstate = { at: 'n4' }
        switchTo(chat, 4, 'm4')
        expect(ids(chat)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
        expect(chat.scriptstate).toEqual({ W: true })
        expect(siblingsAt(chat, 5).map((message) => message.chatId)).toEqual(['m5'])
    })

    // T72 regression reproducer: an older sibling record shaped like a real detach, arrows away and back
    it('T72 an arrow to an older reply and back ends at the branch point', () => {
        const chat = chatOf(numbered('m', 0, 5), { scriptstate: { at: 'm5' } })
        const sibling = chatOf(['m0', 'm1', 'm2', 'm3', 'x4'], { scriptstate: { at: 'x4' } })
        detachTail(sibling, 4)
        chat.alt = [{ m: msg('x4'), p: 'm3', a: 1, mem: sibling.alt?.[0].mem }]
        detachTail(chat, 5)
        chat.scriptstate = { W: true }
        switchTo(chat, 4, 'x4')
        switchTo(chat, 4, 'm4')
        expect(ids(chat)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
        expect(chat.scriptstate).toEqual({ W: true })
    })

    // T73 regression reproducer: an arrow arrival that ends where children remain, then the end control
    it('T73 an arrow that ends where children remain, then the end control, loses neither branch', () => {
        const chat = chatOf(['u0', 'a1', 'a2'])
        chat.hypaV2Data = { ...v2Of({ id: 1, memos: ['a2'] }), mainChunks: [{ id: 1, text: 'S-a2', chatMemos: ['a2'], lastChatMemo: 'a2' }] }
        detachTail(chat, 2)
        detachTail(chat, 1)
        chat.message.push(msg('b1'))
        chat.hypaV2Data = { ...v2Of({ id: 1, memos: ['u0'] }), mainChunks: [{ id: 1, text: 'T-u0', chatMemos: ['u0'], lastChatMemo: 'u0' }] }
        expect(switchTo(chat, 1, 'a1')).toBe(true)
        expect(ids(chat)).toEqual(['u0', 'a1'])
        expect(switchTo(chat, chat.message.length, endOf(chat))).toBe(true)
        expect(JSON.stringify(chat.hypaV2Data ?? null).includes('S-a2')).toBe(true)
        expect(JSON.stringify(headOf(chat, 'b1').mem?.hypaV2Data ?? null).includes('T-u0')).toBe(true)
    })

    // T74 regression reproducer: any end child is an ordinary arrival and loses nothing
    it('T74 the press at the end target keeps the live summary; an arrival at the older end child loses nothing', () => {
        function build(): Chat {
            const chat = chatOf(numbered('m', 0, 4), { hypaV3Data: v3Of({ text: 'S-m1', memos: ['m1'] }, { text: 'S-m5', memos: ['m5'] }) })
            chat.message.push(msgAt('m5', 5))
            detachTail(chat, 5)
            chat.message.push(msgAt('m5b', 10))
            switchTo(chat, 5, 'm5')
            chat.hypaV3Data = v3Of({ text: 'S-m1', memos: ['m1'] }, { text: 'TOK-T', memos: ['m1'] })
            detachTail(chat, 5)
            return chat
        }
        const pressed = build()
        expect(endOf(pressed)).toBe('m5')
        expect(switchTo(pressed, 5, 'm5')).toBe(true)
        expect(texts(pressed)).toContain('TOK-T')
        const older = build()
        expect(switchTo(older, 5, 'm5b')).toBe(true)
        expect(holds(older, 'TOK-T')).toBe(true)
        expect(switchTo(older, 5, 'm5')).toBe(true)
        expect(texts(older)).toContain('TOK-T')
    })

    // T78 compatibility guard: passes before and after; the press replaces a changed store with the parked one
    it('T78 OQ4 (a) at the press: a store the Branch left and the window changed is replaced', () => {
        const chat = chatOf(numbered('m', 0, 3), { scriptstate: { n: 1 }, hypaV3Data: v3Of({ text: 'S-m3', memos: ['m3'] }) })
        detachTail(chat, 3)
        chat.scriptstate = { n: 99 }
        chat.hypaV3Data = v3Of({ text: 'S-window', memos: ['m1'] })
        expect(switchTo(chat, 3, 'm3')).toBe(true)
        expect(chat.scriptstate).toEqual({ n: 1 })
        expect(texts(chat)).toEqual(['S-m3'])
    })

    // T85 regression reproducer: the summary of a branch left by an arrow survives a delete of the last message and the end control
    it('T85 a delete of the last message after an arrow, then the end control, keeps the summary of the branch left', () => {
        const chat = chatOf(['m0', 'a1', 'a2'], { hypaV3Data: v3Of({ text: 'S-a2', memos: ['a2'] }) })
        detachTail(chat, 2)
        chat.message.push(msg('b2'))
        detachTail(chat, 1)
        chat.message.push(msg('d1'))
        chat.hypaV3Data = v3Of({ text: 'S-V', memos: ['m0'] })
        expect(switchTo(chat, 1, 'a1')).toBe(true)
        const previous = chat.message.slice()
        chat.message.pop()
        reattachOrphans(chat, previous)
        expect(switchTo(chat, chat.message.length, endOf(chat))).toBe(true)
        expect(holds(chat, 'S-V')).toBe(true)
        expect(switchTo(chat, 1, 'd1')).toBe(true)
        expect(texts(chat)).toContain('S-V')
    })

    // T86 regression reproducer of I15': a chat without hypaV2Data still parks null for it
    it('T86 every record with mem holds all six keys and is a run head; an arrived record keeps none', () => {
        const chat = chatOf(numbered('m', 0, 3), { hypaV3Data: v3Of({ text: 'S-m0', memos: ['m0'] }), scriptstate: { n: 1 } })
        checkedDetach(chat, 3, 'Branch at m2')
        chat.message.push(msg('n3'))
        checkedDetach(chat, 3, 'reroll n3')
        chat.message.push(msg('o3'))
        checkedSwitch(chat, 3, 'm3', 'arrow to m3')
        checkedSwitch(chat, 3, 'n3', 'arrow to n3')
        checkedDetach(chat, 2, 'Branch at m1')
        checkedSwitch(chat, 2, endOf(chat), 'end press')
        checkedSwitch(chat, 1, 'm1', 'arrow to the head on the path')
    })

    // T87 regression reproducer (OQ4 (a) literal): the press replaces a store the Branch left unchanged
    it('T87 the press restores a store the Branch left unchanged and drops what the window added', () => {
        const chat = chatOf(numbered('m', 0, 3), { hypaV3Data: v3Of({ text: 'S-m0', memos: ['m0'] }) })
        detachTail(chat, 3)
        chat.hypaV3Data?.summaries.push({ text: 'S-window', chatMemos: ['m1'], isImportant: false })
        expect(switchTo(chat, 3, endOf(chat))).toBe(true)
        expect(texts(chat)).toEqual(['S-m0'])
    })

    // T88 regression reproducer (F2 (a) literal): a branch returns as it was left, with no store if it had none
    it('T88 a store the branch did not have when left is absent on return; the other branch keeps its own', () => {
        const chat = chatOf(['m0', 'm1'])
        detachTail(chat, 1)
        chat.message.push(msg('n1'))
        chat.hypaV3Data = v3Of({ text: 'S-n', memos: ['m0'] })
        expect(switchTo(chat, 1, 'm1')).toBe(true)
        expect(chat.hypaV3Data).toBeUndefined()
        expect(switchTo(chat, 1, 'n1')).toBe(true)
        expect(texts(chat)).toEqual(['S-n'])
    })

    it('an arrival at a record without mem carries the live stores as copies', () => {
        const chat = chatOf(['r', 'a'], { hypaV3Data: v3Of({ text: 'shared', memos: ['r'] }, { text: 'tail', memos: ['a'] }) })
        chat.alt = [{ m: msg('s'), p: 'r', a: 1 }]
        expect(switchTo(chat, 1, 's')).toBe(true)
        expect(texts(chat)).toEqual(['shared'])
        expect(headOf(chat, 'a').mem?.hypaV3Data?.summaries.map((summary) => summary.text)).toEqual(['shared', 'tail'])
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
