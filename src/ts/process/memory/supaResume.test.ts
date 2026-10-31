import { describe, expect, it } from 'vitest'
import type { Chat, Message } from 'src/ts/storage/database.svelte'
import {
    clearSupaMemoryIfEmpty, clearSupaMemoryIfEmptyIn, repointSupaMemory, withSupaRepoint, writeSupaMemoryData,
} from './supaResume'

function msg(chatId: string | undefined, extra: Partial<Message> = {}): Message {
    return { role: 'user', data: chatId ?? 'no id', ...(chatId === undefined ? {} : { chatId }), ...extra }
}

function chatOf(ids: (string | undefined)[], supaMemoryData?: string, covered?: string): Chat {
    return {
        message: ids.map((id) => msg(id)),
        ...(supaMemoryData === undefined ? {} : { supaMemoryData }),
        ...(covered === undefined ? {} : { supaMemoryCoveredId: covered }),
    } as Chat
}

const removeAt = (chat: Chat, index: number) => () => { chat.message.splice(index, 1) }

describe('repointSupaMemory / withSupaRepoint', () => {
    it('MC-714: the pointer moves to the first survivor after the removed message; the summary stays', () => {
        const chat = chatOf(['a', 'p', 'b', 'c'], 'p\nsummary\nsecond line', 'p')
        withSupaRepoint(chat, removeAt(chat, 1))
        expect(chat.supaMemoryData).toBe('b\nsummary\nsecond line')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    it('MC-715: with no survivor after it, the last survivor becomes the pointer and the covered field names it', () => {
        const chat = chatOf(['a', 'b', 'p'], 'p\nsummary')
        withSupaRepoint(chat, removeAt(chat, 2))
        expect(chat.supaMemoryData).toBe('b\nsummary')
        expect(chat.supaMemoryCoveredId).toBe('b')
    })

    it('MC-715 also covers a range cut from the pointer to the end', () => {
        const chat = chatOf(['a', 'b', 'p', 'q'], 'p\nsummary')
        withSupaRepoint(chat, () => { chat.message.splice(2) })
        expect(chat.supaMemoryData).toBe('b\nsummary')
        expect(chat.supaMemoryCoveredId).toBe('b')
    })

    it('nothing survives: the memory is emptied by the empty-chat rule, with no error', () => {
        const chat = chatOf(['p'], 'p\nsummary', 'p')
        withSupaRepoint(chat, removeAt(chat, 0))
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    it('repointSupaMemory alone: nothing survives leaves the data as it is', () => {
        const chat = chatOf([], 'p\nsummary')
        repointSupaMemory(chat, [msg('p')])
        expect(chat.supaMemoryData).toBe('p\nsummary')
    })

    it('pointer absent from the previous list: no change', () => {
        const chat = chatOf(['a', 'b'], 'gone\nsummary')
        withSupaRepoint(chat, removeAt(chat, 0))
        expect(chat.supaMemoryData).toBe('gone\nsummary')
    })

    it('a surviving pointer is untouched', () => {
        const chat = chatOf(['a', 'p', 'b'], 'p\nsummary')
        withSupaRepoint(chat, removeAt(chat, 0))
        expect(chat.supaMemoryData).toBe('p\nsummary')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    it('a hidden survivor after the removed pointer is the target', () => {
        const chat = chatOf(['p', 'h', 'b'], 'p\nsummary')
        chat.message[1].disabled = true
        withSupaRepoint(chat, removeAt(chat, 0))
        expect(chat.supaMemoryData).toBe('h\nsummary')
    })

    it('stamps a chatId on a survivor that has none, using object identity to find it', () => {
        const chat = chatOf(['a', 'p', undefined, 'c'], 'p\nsummary')
        const target = chat.message[2]
        withSupaRepoint(chat, removeAt(chat, 1))
        expect(target.chatId).toMatch(/^[0-9a-f-]{36}$/)
        expect(chat.supaMemoryData).toBe(target.chatId + '\nsummary')
    })

    it('stamps the last survivor in the end-of-chat pair', () => {
        const chat = chatOf(['a', undefined, 'p'], 'p\nsummary')
        const last = chat.message[1]
        withSupaRepoint(chat, removeAt(chat, 2))
        expect(last.chatId).toBeTruthy()
        expect(chat.supaMemoryCoveredId).toBe(last.chatId)
        expect(chat.supaMemoryData).toBe(last.chatId + '\nsummary')
    })

    it('a branch cut: copies of the messages are matched by chatId, the pointer beyond the cut takes the pair', () => {
        const parent = chatOf(['a', 'b', 'p', 'q'], 'p\nsummary', 'p')
        const branch = JSON.parse(JSON.stringify(parent)) as Chat
        const before = parent.message
        branch.message = branch.message.slice(0, 2)
        repointSupaMemory(branch, before)
        expect(branch.supaMemoryData).toBe('b\nsummary')
        expect(branch.supaMemoryCoveredId).toBe('b')
        expect(parent.supaMemoryData).toBe('p\nsummary')
    })

    it('MC-714 deletes a stale covered field', () => {
        const chat = chatOf(['p', 'b'], 'p\nsummary', 'p')
        withSupaRepoint(chat, removeAt(chat, 0))
        expect(chat.supaMemoryData).toBe('b\nsummary')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })
})

describe('empty-chat rule', () => {
    it('clears plain data', () => {
        const chat = chatOf(['a'], 'a\nsummary')
        withSupaRepoint(chat, () => { chat.message.length = 0 })
        expect(chat.supaMemoryData).toBe('')
    })

    it('clears hypa: data', () => {
        const chat = chatOf(['a'], 'hypa:\n[]', 'a')
        withSupaRepoint(chat, () => { chat.message.length = 0 })
        expect(chat.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    it('leaves hypa: data in a non-empty chat untouched, even when its first message is removed', () => {
        const chat = chatOf(['a', 'b'], 'hypa:\n[{"id":"a"}]')
        withSupaRepoint(chat, removeAt(chat, 0))
        expect(chat.supaMemoryData).toBe('hypa:\n[{"id":"a"}]')
    })

    it('leaves empty data untouched', () => {
        const chat = chatOf(['a'])
        withSupaRepoint(chat, () => { chat.message.length = 0 })
        expect('supaMemoryData' in chat).toBe(false)
        const blank = chatOf(['a'], '')
        withSupaRepoint(blank, () => { blank.message.length = 0 })
        expect(blank.supaMemoryData).toBe('')
    })

    it('fast path: without data the mutation runs once and its result is returned', () => {
        const chat = chatOf(['a', 'b'])
        let calls = 0
        const result = withSupaRepoint(chat, () => { calls += 1; chat.message.pop(); return 'done' })
        expect(result).toBe('done')
        expect(calls).toBe(1)
        expect(chat.message).toHaveLength(1)
    })

    it('clearSupaMemoryIfEmpty leaves a non-empty chat alone', () => {
        const chat = chatOf(['a'], 'a\nsummary')
        clearSupaMemoryIfEmpty(chat)
        expect(chat.supaMemoryData).toBe('a\nsummary')
    })

    it('clearSupaMemoryIfEmptyIn clears every empty chat of every character and no other', () => {
        const empty = chatOf([], 'hypa:\n[]')
        const full = chatOf(['a'], 'a\nsummary')
        const other = chatOf([], 'x\nsummary', 'x')
        clearSupaMemoryIfEmptyIn([{ chats: [empty, full] }, { chats: [other] }, {}])
        expect(empty.supaMemoryData).toBe('')
        expect(full.supaMemoryData).toBe('a\nsummary')
        expect(other.supaMemoryData).toBe('')
        expect('supaMemoryCoveredId' in other).toBe(false)
    })
})

describe('writeSupaMemoryData (the send writer)', () => {
    it('drops the covered field when the first line changes', () => {
        const chat = chatOf(['x', 'w'], 'x\nold', 'x')
        writeSupaMemoryData(chat, 'w\nnew')
        expect(chat.supaMemoryData).toBe('w\nnew')
        expect('supaMemoryCoveredId' in chat).toBe(false)
    })

    it('keeps the covered field while the first line is unchanged', () => {
        const chat = chatOf(['x'], 'x\nold', 'x')
        writeSupaMemoryData(chat, 'x\nnew summary')
        expect(chat.supaMemoryCoveredId).toBe('x')
    })

    it('a stale covered field is deleted even when the new first line matches it', () => {
        const emptied = chatOf(['a', 'x'], '', 'x')
        writeSupaMemoryData(emptied, 'x\nnew summary')
        expect(emptied.supaMemoryData).toBe('x\nnew summary')
        expect('supaMemoryCoveredId' in emptied).toBe(false)
        const differing = chatOf(['a', 'x'], 'a\nold', 'x')
        writeSupaMemoryData(differing, 'x\nnew summary')
        expect('supaMemoryCoveredId' in differing).toBe(false)
    })

    it('a send that returns no memory leaves data and field alone', () => {
        const chat = chatOf(['x'], 'x\nold', 'x')
        writeSupaMemoryData(chat, undefined)
        expect(chat.supaMemoryData).toBe('x\nold')
        expect(chat.supaMemoryCoveredId).toBe('x')
    })
})

describe('withSupaRepoint and the alternatives of the chat', () => {
    const withAlt = (ids: string[], supaMemoryData?: string): Chat => {
        const chat = chatOf(ids, supaMemoryData)
        chat.alt = [
            { m: msg('x'), p: 'c', a: 1 },
            { m: msg('y'), p: 'b', a: 2 },
            { m: msg('z'), p: 'x', a: 3 },
        ]
        return chat
    }

    // regression reproducer: without the wrap the records keep naming the removed message
    it('a removal re-attaches the records of the removed message to the nearest earlier survivor, with no SupaMemory data', () => {
        const chat = withAlt(['a', 'b', 'c', 'd'])
        withSupaRepoint(chat, removeAt(chat, 2))
        expect(chat.alt?.map((r) => r.p)).toEqual(['b', 'b', 'x'])
        expect(chat.alt).toHaveLength(3)
    })

    it('a removal re-attaches and still repoints SupaMemory', () => {
        const chat = withAlt(['a', 'b', 'c', 'd'], 'c\nsummary')
        withSupaRepoint(chat, removeAt(chat, 2))
        expect(chat.alt?.map((r) => r.p)).toEqual(['b', 'b', 'x'])
        expect(chat.supaMemoryData).toBe('d\nsummary')
    })

    it('a range cut moves the records to the root when no earlier message survives', () => {
        const chat = withAlt(['b', 'c'])
        withSupaRepoint(chat, () => { chat.message.splice(0) ; chat.message.push(msg('q')) })
        expect(chat.alt?.map((r) => r.p)).toEqual([null, null, 'x'])
    })

    // regression reproducer: the last-message delete is a full clear
    it('a removal that empties a non-empty path clears the alternatives', () => {
        const chat = withAlt(['c'])
        withSupaRepoint(chat, removeAt(chat, 0))
        expect('alt' in chat).toBe(false)
    })

    it('guard: a path that was already empty keeps its alternatives', () => {
        const chat = withAlt([])
        withSupaRepoint(chat, () => {})
        expect(chat.alt).toHaveLength(3)
    })

    it('guard: an alt that cannot be read is left as it is', () => {
        const chat = chatOf(['a', 'b'])
        Object.assign(chat, { alt: 'text' })
        withSupaRepoint(chat, removeAt(chat, 1))
        expect(chat.alt).toBe('text')
    })
})