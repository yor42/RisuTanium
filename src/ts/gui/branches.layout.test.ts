import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    character: {} as unknown,
}))

vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: () => h.character,
}))

import { getChatBranches } from './branches'

type ChatSeed = { fmIndex?: number, message: Array<{ role: string, data: string }> }

const chatOf = (texts: string[], fmIndex?: number): ChatSeed => ({
    ...(fmIndex === undefined ? {} : { fmIndex }),
    message: texts.map((data, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data })),
})

const seed = (firstMessage: string, alternateGreetings: string[], chats: ChatSeed[]): void => {
    h.character = { firstMessage, alternateGreetings, chats }
}

const FIXTURES: Record<string, () => void> = {
    // Chat 0 ends in a leaf that shares its depth with the second chat's divergent message.
    BF: () => seed('Hello from Alice\nSecond line', [], [
        chatOf(['\n\n   Hi there\nmore', '   \t ']),
        chatOf(['\n\n   Hi there\nmore', 'A'.repeat(30) + ' ' + 'B'.repeat(20), '**Bold** <img src=x onerror=alert(1)>']),
    ]),
    BF2: () => seed('Greeting', ['Other greeting'], [chatOf(['a1', 'a2']), chatOf(['b1', 'b2']), chatOf(['c1'], 0)]),
    // 'Aa' and 'BB' hash alike, so the two chats share one node and the two leaves under it are siblings.
    CF: () => seed('Hi', [], [chatOf(['Aa', 'x']), chatOf(['BB', 'y'])]),
    // Two chats that differ only in their last message.
    LAST: () => seed('Hi', [], [chatOf(['same', 'one']), chatOf(['same', 'two'])]),
    // Two first messages while the first chat holds only its greeting.
    GREETINGS: () => seed('Greeting', ['Other greeting'], [chatOf([]), chatOf([], 0)]),
}

beforeEach(() => {
    h.character = {}
})

describe('getChatBranches layout', () => {
    test('regression reproducer: a leaf takes one column, so the next node on its row is drawn beside it', () => {
        FIXTURES.BF()
        const nodes = getChatBranches()
        expect(nodes.map((node) => node.y)).toEqual([0, 1, 2, 2, 3])
        expect(nodes[2].x).not.toBe(nodes[3].x)
        expect([nodes[2].x, nodes[3].x]).toEqual([0, 1])
    })

    test('regression reproducer: two chats that differ only in their last message draw two leaves in two columns', () => {
        FIXTURES.LAST()
        const leaves = getChatBranches().filter((node) => node.y === 2)
        expect(leaves).toHaveLength(2)
        expect(leaves[0].x).not.toBe(leaves[1].x)
    })

    test.each(Object.keys(FIXTURES))('no two nodes of %s share a position', (name) => {
        FIXTURES[name]()
        const positions = getChatBranches().map((node) => `${node.x},${node.y}`)
        expect(new Set(positions).size).toBe(positions.length)
    })
})
