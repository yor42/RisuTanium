import { describe, expect, it } from 'vitest'
import type { Chat, ChatAltMemory } from 'src/ts/storage/database.svelte'
import { detachTail, endTarget, switchTo } from '../chatTree'
import { withSupaRepoint } from './supaResume'

/**
 * A parked SupaMemory pair names a message by id, so a delete that removes that message must repoint it on the
 * branch its record would arrive at (MC-714/715), exactly as the live pair is. Summaries are longer than four
 * characters on purpose: the send-time resolver treats a pair of four characters or fewer as always resolvable,
 * which would hide a pair that names a deleted id.
 */

const SUMMARY = 'SUMMARY-TEXT'

function chatOf(count: number, supaMemoryData: string): Chat {
    return {
        message: Array.from({ length: count }, (_, i) => ({ role: 'char', data: `m${i}`, chatId: `m${i}`, time: i + 1 })),
        supaMemoryData,
        note: '',
        name: 'chat',
        localLore: [],
    }
}

function memOf(chat: Chat, id: string): ChatAltMemory {
    const mem = chat.alt?.find((record) => record.m.chatId === id)?.mem
    if (mem === undefined) {
        throw new Error(`no parked state on ${id}`)
    }
    return mem
}

const ids = (chat: Chat): (string | undefined)[] => chat.message.map((message) => message.chatId)

describe('parked SupaMemory pairs follow a delete', () => {
    it('TC-4a: a delete of the pointer message repoints the parked pair and the end press restores it', () => {
        const chat = chatOf(5, `m2\n${SUMMARY}`)
        detachTail(chat, 4)
        withSupaRepoint(chat, () => chat.message.splice(2, 1))

        const mem = memOf(chat, 'm4')
        expect(mem.supaMemoryData).toBe(`m3\n${SUMMARY}`)
        expect(mem.supaMemoryCoveredId).toBe(null)
        expect(Object.keys(mem).sort()).toEqual(['hypaV2Data', 'hypaV3Data', 'lastMemory', 'scriptstate', 'supaMemoryCoveredId', 'supaMemoryData'])

        const target = endTarget(chat)
        expect(target).toBe('m4')
        expect(switchTo(chat, chat.message.length, target!)).toBe(true)
        expect(chat.supaMemoryData).toBe(`m3\n${SUMMARY}`)
    })

    it('TC-4b: a pair parked on a record whose parent is itself alternative survives both arrivals', () => {
        const chat = chatOf(5, `m1\n${SUMMARY}`)
        detachTail(chat, 4)
        chat.message.push({ role: 'char', data: 'n4', chatId: 'n4', time: 10 })
        detachTail(chat, 3)
        withSupaRepoint(chat, () => chat.message.splice(1, 1))
        expect(ids(chat)).toEqual(['m0', 'm2'])

        expect(switchTo(chat, 2, 'm3')).toBe(true)
        expect(ids(chat)).toEqual(['m0', 'm2', 'm3', 'n4'])
        expect(chat.supaMemoryData ?? '').toContain(SUMMARY)

        expect(switchTo(chat, 3, 'm4')).toBe(true)
        expect(ids(chat)).toEqual(['m0', 'm2', 'm3', 'm4'])
        expect(chat.supaMemoryData ?? '').toContain(SUMMARY)
    })

    it('TC-4c: a delete of the head\'s own parent moves the parked pair onto the head', () => {
        const chat = chatOf(5, `m3\n${SUMMARY}`)
        detachTail(chat, 4)
        withSupaRepoint(chat, () => chat.message.pop())

        const mem = memOf(chat, 'm4')
        expect(mem.supaMemoryData).toBe(`m4\n${SUMMARY}`)
        expect(mem.supaMemoryCoveredId).toBe(null)
    })

    it('TC-4d (compatibility guard, passes before and after): parked hypa data and a parked pair that names a surviving id are untouched', () => {
        // The removed message's id carries the hypa prefix, so only the prefix check keeps the data out of the repoint.
        const hypa = chatOf(5, `hypa:m2\n${SUMMARY}`)
        hypa.message[2].chatId = 'hypa:m2'
        detachTail(hypa, 4)
        const hypaBefore = structuredClone(memOf(hypa, 'm4'))
        withSupaRepoint(hypa, () => deleteM2(hypa))
        expect(memOf(hypa, 'm4')).toEqual(hypaBefore)

        const surviving = chatOf(5, `m1\n${SUMMARY}`)
        detachTail(surviving, 4)
        const survivingBefore = structuredClone(memOf(surviving, 'm4'))
        withSupaRepoint(surviving, () => deleteM2(surviving))
        expect(memOf(surviving, 'm4')).toEqual(survivingBefore)
    })

    it('TC-4e: the pointer is the head\'s attach point and the path continues past it; a middle delete of the pointer', () => {
        const chat = chatOf(3, `m1\n${SUMMARY}`)
        detachTail(chat, 2)
        chat.message.push({ role: 'char', data: 'n2', chatId: 'n2', time: 10 }, { role: 'char', data: 'n3', chatId: 'n3', time: 11 })
        withSupaRepoint(chat, () => chat.message.splice(1, 1))

        expect(memOf(chat, 'm2').supaMemoryData).toBe(`m2\n${SUMMARY}`)
        expect(switchTo(chat, 1, 'm2')).toBe(true)
        expect(chat.supaMemoryData).toBe(`m2\n${SUMMARY}`)
    })
})

/** Deletes m2, a message that is neither a pointer nor a head in the guard fixtures. */
function deleteM2(chat: Chat): void {
    chat.message.splice(2, 1)
}
