import { describe, expect, it, vi } from 'vitest'
import type { Chat, ChatAlt, Message } from '../../storage/database.svelte'
import {
    clearAltOnFullClear,
    detachTail,
    isChatAltReadable,
    reattachOrphans,
    refuseUnreadableAlt,
    siblingsAt,
    stampMissingIds,
    switchTo,
} from '../chatTree'

function msg(chatId: string | undefined, time?: number, role: 'user' | 'char' = 'char'): Message {
    const message: Message = { role, data: `data ${chatId ?? 'none'}` }
    if (chatId !== undefined) {
        message.chatId = chatId
    }
    if (time !== undefined) {
        message.time = time
    }
    return message
}

function chatOf(path: Message[], alt?: ChatAlt[]): Chat {
    const chat: Chat = { message: path, note: '', name: 'chat', localLore: [] }
    if (alt !== undefined) {
        chat.alt = alt
    }
    return chat
}

function record(m: Message, p: string | null, a: number): ChatAlt {
    return { m, p, a }
}

function ids(path: readonly Message[]): (string | undefined)[] {
    return path.map((m) => m.chatId)
}

function isAscending(alt: readonly ChatAlt[]): boolean {
    return alt.every((r, k) => k === 0 || alt[k - 1].a <= r.a)
}

describe('siblingsAt', () => {
    it('orders by time (a missing time is 0), then by chatId', () => {
        const chat = chatOf([msg('u'), msg('c2', 5)], [
            record(msg('c1', 5), 'u', 1),
            record(msg('c0'), 'u', 2),
            record(msg('c3', 9), 'u', 3),
        ])
        expect(ids(siblingsAt(chat, 1))).toEqual(['c0', 'c1', 'c2', 'c3'])
    })

    it('holds only the children of the last message at position message.length', () => {
        const chat = chatOf([msg('u'), msg('c')], [record(msg('x', 1), 'c', 1), record(msg('y', 2), 'u', 1)])
        expect(ids(siblingsAt(chat, 2))).toEqual(['x'])
        expect(siblingsAt(chat, 3)).toEqual([])
        expect(siblingsAt(chat, -1)).toEqual([])
    })

    it('puts a record with no parent, or with a parent nothing holds, at position 0', () => {
        const chat = chatOf([msg('a', 3)], [record(msg('r', 1), null, 1), record(msg('d', 2), 'missing', 2)])
        expect(ids(siblingsAt(chat, 0))).toEqual(['r', 'd', 'a'])
        expect(ids(siblingsAt(chat, 1))).toEqual([])
    })

    it('resolves a duplicated parent id to its first holder on the path', () => {
        const chat = chatOf([msg('dup'), msg('dup'), msg('z')], [record(msg('k', 1), 'dup', 1)])
        expect(ids(siblingsAt(chat, 1)).sort()).toEqual(['dup', 'k'])
        expect(ids(siblingsAt(chat, 2))).toEqual(['z'])
    })

    it('treats an alt that cannot be read as no alternatives', () => {
        const chat = chatOf([msg('u'), msg('c')])
        Object.assign(chat, { alt: 'text' })
        expect(ids(siblingsAt(chat, 1))).toEqual(['c'])
    })
})

describe('detachTail', () => {
    it('turns the tail into a chain of records with one new stamp, appended after the others', () => {
        const old = record(msg('o', 1), 'u', 4)
        const chat = chatOf([msg('u', 1), msg('c1', 2), msg('u2', 3), msg('c2', 4)], [old])
        expect(detachTail(chat, 1)).toBe(true)
        expect(ids(chat.message)).toEqual(['u'])
        expect(chat.alt?.map((r) => [r.m.chatId, r.p, r.a])).toEqual([['o', 'u', 4], ['c1', 'u', 5], ['u2', 'c1', 5], ['c2', 'u2', 5]])
        expect(isAscending(chat.alt ?? [])).toBe(true)
    })

    it('stamps a missing id before it cuts, so no record has an undefined parent', () => {
        const chat = chatOf([msg(undefined), msg(undefined), msg(undefined)])
        expect(detachTail(chat, 1)).toBe(true)
        const [first, second] = chat.alt ?? []
        expect(typeof chat.message[0].chatId).toBe('string')
        expect(first.p).toBe(chat.message[0].chatId)
        expect(typeof first.m.chatId).toBe('string')
        expect(second.p).toBe(first.m.chatId)
    })

    it('keeps every time and leaves the records it does not move as they are', () => {
        const extra = { m: msg('o', 7), p: 'u', a: 1, mem: { x: 1 } } as ChatAlt
        const chat = chatOf([msg('u', 3), msg('c', 8)], [extra])
        detachTail(chat, 1)
        expect(chat.message[0].time).toBe(3)
        expect(chat.alt?.[0]).toBe(extra)
        expect(chat.alt?.[1].m.time).toBe(8)
    })

    it('does nothing at or past the end, and at 0 it keeps every record and clears none', () => {
        const chat = chatOf([msg('u'), msg('c')], [record(msg('o'), 'u', 1)])
        expect(detachTail(chat, 2)).toBe(false)
        expect(detachTail(chat, -1)).toBe(false)
        expect(chat.message).toHaveLength(2)
        expect(detachTail(chat, 0)).toBe(true)
        expect(chat.message).toEqual([])
        expect(chat.alt).toHaveLength(3)
    })

    it('refuses a chat whose alt cannot be read and changes nothing', () => {
        const chat = chatOf([msg('u'), msg('c')])
        Object.assign(chat, { alt: { not: 'a list' } })
        expect(detachTail(chat, 1)).toBe(false)
        expect(chat.message).toHaveLength(2)
        expect(chat.alt).toEqual({ not: 'a list' })
    })
})

describe('switchTo', () => {
    it('swaps the tail for the sibling chain: departures are appended, arrivals removed where they were', () => {
        const chat = chatOf([msg('u'), msg('c', 5), msg('n', 6)], [
            record(msg('s', 7), 'u', 1),
            record(msg('t', 8), 's', 1),
            record(msg('w', 9), 'u', 2),
        ])
        expect(switchTo(chat, 1, 's')).toBe(true)
        expect(ids(chat.message)).toEqual(['u', 's', 't'])
        expect(chat.alt?.map((r) => [r.m.chatId, r.p, r.a])).toEqual([['w', 'u', 2], ['c', 'u', 3], ['n', 'c', 3]])
        expect(isAscending(chat.alt ?? [])).toBe(true)
    })

    it('follows the highest stamp at each step, and the last in list order among equal stamps', () => {
        const chat = chatOf([msg('u'), msg('c')], [
            record(msg('s'), 'u', 1),
            record(msg('older'), 's', 1),
            record(msg('first'), 's', 3),
            record(msg('last'), 's', 3),
        ])
        switchTo(chat, 1, 's')
        expect(ids(chat.message)).toEqual(['u', 's', 'last'])
    })

    it('arrives at position message.length without departing anything', () => {
        const chat = chatOf([msg('u'), msg('c')], [record(msg('x'), 'c', 1), record(msg('y'), 'x', 1)])
        expect(switchTo(chat, 2, 'x')).toBe(true)
        expect(ids(chat.message)).toEqual(['u', 'c', 'x', 'y'])
        expect(chat.alt).toEqual([])
    })

    it('does nothing for the head already on the path, an id that is no sibling here, and an unreadable alt', () => {
        const chat = chatOf([msg('u'), msg('c')], [record(msg('x'), 'c', 1)])
        expect(switchTo(chat, 1, 'c')).toBe(false)
        expect(switchTo(chat, 1, 'x')).toBe(false)
        expect(switchTo(chat, 5, 'x')).toBe(false)
        const bad = chatOf([msg('u'), msg('c')])
        Object.assign(bad, { alt: [{ m: 'text', p: null, a: 1 }] })
        expect(switchTo(bad, 1, 'x')).toBe(false)
        expect(ids(bad.message)).toEqual(['u', 'c'])
        expect(ids(chat.message)).toEqual(['u', 'c'])
        expect(chat.alt).toHaveLength(1)
    })

    it('stamps a missing id on the departing tail before it becomes records', () => {
        const chat = chatOf([msg('u'), msg(undefined), msg(undefined)], [record(msg('s'), 'u', 1)])
        switchTo(chat, 1, 's')
        const [head, next] = (chat.alt ?? []).slice(-2)
        expect(typeof head.m.chatId).toBe('string')
        expect(head.p).toBe('u')
        expect(next.p).toBe(head.m.chatId)
    })

    it('away and back restores the exact path, keeps every record and every time, over random trees', () => {
        let seed = 12345
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            return seed % n
        }
        for (let round = 0; round < 200; round++) {
            let counter = 0
            const fresh = () => msg(`m${counter++}`, random(4))
            const chat = chatOf([fresh()])
            for (let step = 0; step < 14; step++) {
                const op = random(3)
                if (op === 0 || chat.message.length === 0) {
                    chat.message.push(fresh())
                } else if (op === 1) {
                    detachTail(chat, random(chat.message.length))
                    chat.message.push(fresh())
                } else {
                    const i = random(chat.message.length + 1)
                    const heads = siblingsAt(chat, i)
                    const target = heads[random(heads.length)]
                    if (target?.chatId) {
                        switchTo(chat, i, target.chatId)
                    }
                }
                expect(isAscending(chat.alt ?? [])).toBe(true)
            }
            const total = chat.message.length + (chat.alt?.length ?? 0)
            const times = new Map<string, number | undefined>()
            for (const m of [...chat.message, ...(chat.alt ?? []).map((r) => r.m)]) {
                times.set(m.chatId ?? '', m.time)
            }
            const before = JSON.parse(JSON.stringify(chat.message))
            const i = random(chat.message.length)
            const others = siblingsAt(chat, i).filter((m) => m.chatId !== chat.message[i].chatId)
            if (others.length === 0) {
                continue
            }
            const headId = chat.message[i].chatId ?? ''
            expect(switchTo(chat, i, others[0].chatId ?? '')).toBe(true)
            expect(switchTo(chat, i, headId)).toBe(true)
            expect(JSON.parse(JSON.stringify(chat.message))).toEqual(before)
            expect(chat.message.length + (chat.alt?.length ?? 0)).toBe(total)
            for (const m of [...chat.message, ...(chat.alt ?? []).map((r) => r.m)]) {
                expect(m.time).toBe(times.get(m.chatId ?? ''))
            }
            expect(isAscending(chat.alt ?? [])).toBe(true)
        }
    })
})

describe('reattachOrphans', () => {
    it('moves a record whose parent left the path to the nearest earlier survivor', () => {
        const previous = [msg('a'), msg('b'), msg('c'), msg('d')]
        const chat = chatOf([previous[0], previous[2]], [record(msg('x'), 'd', 1), record(msg('y'), 'b', 1)])
        expect(reattachOrphans(chat, previous)).toBe(true)
        expect(chat.alt?.map((r) => r.p)).toEqual(['c', 'a'])
    })

    it('attaches to the root when no earlier message survives', () => {
        const previous = [msg('a'), msg('b')]
        const chat = chatOf([msg('z')], [record(msg('x'), 'b', 1)])
        reattachOrphans(chat, previous)
        expect(chat.alt?.[0].p).toBeNull()
    })

    it('leaves a parent that is on the path or is itself an alternative, and one that previousPath never held', () => {
        const previous = [msg('a'), msg('b')]
        const chat = chatOf([previous[0]], [
            record(msg('x'), 'a', 1),
            record(msg('y'), 'x', 1),
            record(msg('z'), 'unknown', 1),
        ])
        expect(reattachOrphans(chat, previous)).toBe(false)
        expect(chat.alt?.map((r) => r.p)).toEqual(['a', 'x', 'unknown'])
    })

    it('leaves an alt that cannot be read alone', () => {
        const chat = chatOf([msg('a')])
        Object.assign(chat, { alt: [{ m: {}, p: 'b', a: 'one' }] })
        expect(reattachOrphans(chat, [msg('a'), msg('b')])).toBe(false)
        expect(chat.alt).toEqual([{ m: {}, p: 'b', a: 'one' }])
    })
})

describe('helpers', () => {
    it('stampMissingIds stamps only the messages without an id', () => {
        const chat = chatOf([msg('keep'), msg(undefined)])
        expect(stampMissingIds(chat)).toBe(1)
        expect(chat.message[0].chatId).toBe('keep')
        expect(typeof chat.message[1].chatId).toBe('string')
        expect(stampMissingIds(chat)).toBe(0)
    })

    it('clearAltOnFullClear deletes the alt, an unreadable one included', () => {
        const chat = chatOf([], [record(msg('x'), null, 1)])
        clearAltOnFullClear(chat)
        expect('alt' in chat).toBe(false)
        Object.assign(chat, { alt: 7 })
        clearAltOnFullClear(chat)
        expect('alt' in chat).toBe(false)
    })

    it('refuseUnreadableAlt notifies and refuses only for an alt that cannot be read', () => {
        const notify = vi.fn()
        const good = chatOf([msg('a')], [record(msg('x'), null, 1)])
        expect(refuseUnreadableAlt(good, notify)).toBe(false)
        expect(refuseUnreadableAlt(chatOf([msg('a')]), notify)).toBe(false)
        expect(notify).not.toHaveBeenCalled()
        const bad = chatOf([msg('a')])
        Object.assign(bad, { alt: null })
        expect(refuseUnreadableAlt(bad, notify)).toBe(true)
        expect(notify).toHaveBeenCalledTimes(1)
        expect(isChatAltReadable(bad)).toBe(false)
    })
})
