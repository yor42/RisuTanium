import { describe, test, expect } from 'vitest'
import type { Chat, Message } from 'src/ts/storage/database.svelte'
import { detachTail, switchTo, siblingsAt } from 'src/ts/process/chatTree'
import { treeView } from 'src/ts/process/chatTreeView'

function message(id: string, time: number): Message {
    return { role: 'user', data: id, chatId: id, time } as unknown as Message
}

function chatOf(path: Message[], extra: Record<string, unknown> = {}): Chat {
    return { id: 'chat', message: path, ...extra } as unknown as Chat
}

/** A small deterministic generator, so a failing round can be replayed. */
function random(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
    }
}

function expectAgreesWithSiblingsAt(chat: Chat): void {
    const view = treeView(chat)
    for (let i = 0; i < chat.message.length; i++) {
        const siblings = siblingsAt(chat, i)
        expect(view.at(i)).toEqual({ index: siblings.indexOf(chat.message[i]) + 1, count: siblings.length })
    }
    expect(view.at(-1)).toBeNull()
    expect(view.at(chat.message.length)).toBeNull()
    expect(view.continuation).toBe(siblingsAt(chat, chat.message.length).length)
}

describe('treeView', () => {
    test('TB25: agrees with siblingsAt at every position over random trees with tied times', () => {
        for (let seed = 1; seed <= 60; seed++) {
            const next = random(seed)
            let counter = 0
            const fresh = () => {
                counter++
                // Few distinct times, so ties are common.
                return message(`n${counter}`, Math.floor(next() * 3))
            }
            const chat = chatOf(Array.from({ length: 6 }, fresh))
            for (let step = 0; step < 25; step++) {
                const length = chat.message.length
                const roll = next()
                if (roll < 0.35 && length > 0) {
                    detachTail(chat, Math.floor(next() * length))
                } else if (roll < 0.7 && length > 0) {
                    const at = Math.floor(next() * length)
                    detachTail(chat, at)
                    chat.message.push(...Array.from({ length: 1 + Math.floor(next() * 3) }, fresh))
                } else {
                    const at = Math.floor(next() * (length + 1))
                    const heads = siblingsAt(chat, at)
                    if (heads.length > 0) {
                        switchTo(chat, at, heads[Math.floor(next() * heads.length)].chatId as string)
                    }
                }
                expectAgreesWithSiblingsAt(chat)
            }
        }
    })

    test('a tie in time is broken by chat id, not by list order', () => {
        const chat = chatOf([message('a', 1), message('z', 1)])
        detachTail(chat, 1)
        chat.message.push(message('m', 1))
        expect(siblingsAt(chat, 1).map((m) => m.chatId)).toEqual(['m', 'z'])
        expect(treeView(chat).at(1)).toEqual({ index: 1, count: 2 })
        switchTo(chat, 1, 'z')
        expect(treeView(chat).at(1)).toEqual({ index: 2, count: 2 })
    })

    test('the continuation counts the records that follow the last message', () => {
        const chat = chatOf([message('a', 1), message('b', 2), message('c', 3)])
        detachTail(chat, 2)
        expect(treeView(chat).continuation).toBe(1)
        expect(treeView(chat).at(1)).toEqual({ index: 1, count: 1 })
    })

    test('a chat whose alt cannot be read has an empty view', () => {
        for (const bad of ['broken', { not: 'a list' }, [{ m: 'no', p: null, a: 1 }]]) {
            const chat = chatOf([message('a', 1), message('b', 2)], { alt: bad })
            const view = treeView(chat)
            expect(view.at(0)).toEqual({ index: 1, count: 1 })
            expect(view.at(1)).toEqual({ index: 1, count: 1 })
            expect(view.continuation).toBe(0)
        }
    })

    test('an empty path counts the records that follow the root', () => {
        const chat = chatOf([message('a', 1), message('b', 2)])
        detachTail(chat, 1)
        detachTail(chat, 0)
        expect(chat.message).toHaveLength(0)
        expect(treeView(chat).continuation).toBe(siblingsAt(chat, 0).length)
    })
})
