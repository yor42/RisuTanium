import { describe, expect, it } from 'vitest'
import type { Chat, ChatAlt, Message } from '../../storage/database.svelte'
import { altTreeIndex, detachTail, siblingsAt, switchTo, treeLeaves } from '../chatTree'

function msg(chatId: string, role: 'user' | 'char' = 'char'): Message {
    return { role, data: `data ${chatId}`, chatId }
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

function idsOf(chat: Chat, chain: readonly number[]): (string | undefined)[] {
    return chain.map((k) => chat.alt?.[k].m.chatId)
}

/** Produced by the engine: the main path u1 c2 u3 c4 is cut at u3, continued with u5 c6, and c6 is rerolled. */
function branchedChat(): Chat {
    const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('u3', 'user'), msg('c4')])
    expect(detachTail(chat, 2)).toBe(true)
    chat.message.push(msg('u5', 'user'), msg('c6'))
    expect(detachTail(chat, 3)).toBe(true)
    chat.message.push(msg('c6b'))
    return chat
}

/** Produced by the engine: run a1 a2 a3 departs and returns, a2 a3 branch off a1, and a1 itself is switched away. */
function nestedChat(): Chat {
    const chat = chatOf([msg('u1', 'user'), msg('c2'), msg('a1', 'user'), msg('a2'), msg('a3', 'user')])
    expect(detachTail(chat, 2)).toBe(true)
    chat.message.push(msg('x1', 'user'), msg('x2'))
    expect(switchTo(chat, 2, 'a1')).toBe(true)
    expect(detachTail(chat, 3)).toBe(true)
    chat.message.push(msg('y1', 'user'), msg('y2'))
    expect(switchTo(chat, 2, 'x1')).toBe(true)
    return chat
}

describe('altTreeIndex', () => {
    it('lets a path holder win over an alternative holder of the same id', () => {
        const alt = [record(msg('dup'), null, 1), record(msg('k'), 'dup', 1)]
        expect(altTreeIndex([msg('dup')], alt).children.get('P0')).toEqual([1])
        expect(altTreeIndex([msg('other')], alt).children.get('A0')).toEqual([1])
    })

    it('lets the first alternative holder win among duplicates', () => {
        const alt = [record(msg('dup'), null, 1), record(msg('dup'), null, 1), record(msg('k'), 'dup', 2)]
        const { children } = altTreeIndex([], alt)
        expect(children.get('A0')).toEqual([2])
        expect(children.get('A1')).toBeUndefined()
        expect(children.get('R')).toEqual([0, 1])
    })

    it('gives an unknown parent and a null parent to the root', () => {
        const alt = [record(msg('r1'), 'missing', 1), record(msg('r2'), null, 1)]
        expect(altTreeIndex([msg('u')], alt).children.get('R')).toEqual([0, 1])
    })
})

describe('treeLeaves', () => {
    it('finds the continued branch and the rerolled reply of a produced tree', () => {
        const chat = branchedChat()
        const tree = treeLeaves(chat)
        expect(tree?.unreachable).toEqual([])
        expect(tree?.leaves.map((leaf) => ({ attachAt: leaf.attachAt, ids: idsOf(chat, leaf.chain) }))).toEqual([
            { attachAt: 1, ids: ['u3', 'c4'] },
            { attachAt: 2, ids: ['c6'] },
        ])
    })

    it('walks a nested branch to every leaf below its first record', () => {
        const chat = nestedChat()
        const tree = treeLeaves(chat)
        expect(tree?.unreachable).toEqual([])
        const leaves = (tree?.leaves ?? []).map((leaf) => ({ attachAt: leaf.attachAt, ids: idsOf(chat, leaf.chain) }))
        expect(leaves).toContainEqual({ attachAt: 1, ids: ['a1', 'a2', 'a3'] })
        expect(leaves).toContainEqual({ attachAt: 1, ids: ['a1', 'y1', 'y2'] })
        expect(leaves).toHaveLength(2)
    })

    it('attaches a chain cut at the first message, and a record with an unknown parent, to the root', () => {
        const chat = chatOf([msg('u1', 'user'), msg('c2')])
        expect(detachTail(chat, 0)).toBe(true)
        chat.message.push(msg('n1', 'user'))
        // hand-built (older build/import shape): a record whose parent no message holds
        chat.alt?.push(record(msg('lost', 'user'), 'missing', 2))
        const leaves = treeLeaves(chat)?.leaves ?? []
        expect(leaves.map((leaf) => ({ attachAt: leaf.attachAt, ids: idsOf(chat, leaf.chain) }))).toEqual([
            { attachAt: -1, ids: ['u1', 'c2'] },
            { attachAt: -1, ids: ['lost'] },
        ])
    })

    it('makes the second holder of a duplicated id a leaf and hangs a follower under the first', () => {
        // hand-built (older build/import shape): duplicate ids
        const chat = chatOf([msg('u1', 'user')], [
            record(msg('d'), 'u1', 1),
            record(msg('d'), 'u1', 1),
            record(msg('after', 'user'), 'd', 2),
        ])
        const leaves = treeLeaves(chat)?.leaves ?? []
        expect(leaves.map((leaf) => leaf.chain)).toEqual([[0, 2], [1]])
        expect(treeLeaves(chat)?.unreachable).toEqual([])
    })

    it('lists the records of a cycle as unreachable without throwing', () => {
        // hand-built (older build/import shape): a cycle and a self-cycle
        const chat = chatOf([msg('u1', 'user')], [
            record(msg('ok', 'user'), 'u1', 1),
            record(msg('A'), 'B', 1),
            record(msg('B'), 'A', 1),
            record(msg('S'), 'S', 1),
            record(msg('below'), 'S', 2),
        ])
        const tree = treeLeaves(chat)
        expect(tree?.unreachable).toEqual([1, 2, 3, 4])
        expect(tree?.leaves.map((leaf) => leaf.chain)).toEqual([[0]])
    })

    it('reads an alt that cannot be read as null, and an absent or empty alt as no leaves', () => {
        // hand-built (older build/import shape): an unreadable alt
        const text = chatOf([msg('u1')])
        Object.assign(text, { alt: 'text' })
        const malformed = chatOf([msg('u1')])
        Object.assign(malformed, { alt: [{ m: 1 }] })
        expect(treeLeaves(text)).toBeNull()
        expect(treeLeaves(malformed)).toBeNull()
        expect(treeLeaves(chatOf([msg('u1')]))).toEqual({ leaves: [], unreachable: [] })
        expect(treeLeaves(chatOf([msg('u1')], []))).toEqual({ leaves: [], unreachable: [] })
    })
})

function mulberry32(seed: number): () => number {
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/** A tree made only by the engine's own operations: append, cut a tail, switch to a sibling. */
function randomChat(seed: number, steps: number): Chat {
    const random = mulberry32(seed)
    let counter = 0
    const next = (): Message => {
        counter++
        return msg(`m${counter}`, random() < 0.5 ? 'user' : 'char')
    }
    const chat = chatOf([next(), next()])
    for (let step = 0; step < steps; step++) {
        const roll = random()
        if (roll < 0.4 || chat.message.length === 0) {
            chat.message.push(next(), ...(random() < 0.5 ? [next()] : []))
        } else if (roll < 0.7) {
            detachTail(chat, Math.floor(random() * chat.message.length))
        } else {
            const i = Math.floor(random() * (chat.message.length + 1))
            const others = siblingsAt(chat, i).filter((m) => m.chatId !== chat.message[i]?.chatId)
            if (others.length > 0) {
                switchTo(chat, i, others[Math.floor(random() * others.length)].chatId ?? '')
            }
        }
    }
    return chat
}

/** The leaves by their own definition, apart from `altTreeIndex`: a record no record's parent resolves to. */
function oracleLeaves(chat: Chat): number[] {
    const alt = chat.alt ?? []
    const followed = new Set<number>()
    for (const r of alt) {
        if (r.p === null || chat.message.some((m) => m.chatId === r.p)) {
            continue
        }
        const holder = alt.findIndex((other) => other.m.chatId === r.p)
        if (holder !== -1) {
            followed.add(holder)
        }
    }
    return alt.map((_r, k) => k).filter((k) => !followed.has(k))
}

describe('treeLeaves over engine-made trees', () => {
    it('reaches every record, ends at the oracle leaves and starts each chain at a sibling of its branch point', () => {
        let withLeaves = 0
        for (let seed = 1; seed <= 60; seed++) {
            const chat = randomChat(seed, 25)
            const tree = treeLeaves(chat)
            const alt = chat.alt ?? []
            expect(tree?.unreachable, `seed ${seed}`).toEqual([])
            const leafIndexes = (tree?.leaves ?? []).map((leaf) => leaf.chain[leaf.chain.length - 1])
            expect([...leafIndexes].sort((a, b) => a - b), `seed ${seed}`).toEqual(oracleLeaves(chat))
            const reached = new Set<number>()
            for (const leaf of tree?.leaves ?? []) {
                const head = alt[leaf.chain[0]].m.chatId
                expect(siblingsAt(chat, leaf.attachAt + 1).some((m) => m.chatId === head), `seed ${seed}`).toBe(true)
                for (let n = 1; n < leaf.chain.length; n++) {
                    expect(alt[leaf.chain[n]].p, `seed ${seed}`).toBe(alt[leaf.chain[n - 1]].m.chatId)
                }
                leaf.chain.forEach((k) => reached.add(k))
            }
            expect(reached.size, `seed ${seed}`).toBe(alt.length)
            withLeaves += leafIndexes.length > 0 ? 1 : 0
        }
        expect(withLeaves).toBeGreaterThan(30)
    })
})
